import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CameraOff,
  CheckCircle2,
  Download,
  FileText,
  FolderOpen,
  HelpCircle,
  Loader2,
  Pause,
  Play,
  Repeat,
  Save,
  Upload,
} from 'lucide-react';
import {
  analyzeLiveCameraFrame,
  getReportDownloadUrl,
  getStorageUrl,
  RateLimitError,
  runImageInspection,
  saveLiveInspection,
} from '../services/api';
import type {
  CameraConnectionState,
  InspectionMode,
  InspectionRecord,
  LiveFrameResult,
  SampleImageItem,
  SiteSettings,
} from '../types/inspection';
import { type ContainedRect, DetectionOverlay } from './DetectionOverlay';

interface InspectionWorkspaceProps {
  defaultMode: InspectionMode;
  lockMode?: boolean;
  settings: SiteSettings | null;
  samples: SampleImageItem[];
  cameraState: CameraConnectionState;
  onCameraStateChange: (state: CameraConnectionState) => void;
  onInspectionCompleted: (record: InspectionRecord) => void;
  onViewReport: (record: InspectionRecord) => void;
}

type ViewportLayer = 'overlay' | 'annotated' | 'original';

const SCAN_INTERVAL_OPTIONS = [1, 2, 3, 5, 10] as const;
const MAX_LIVE_FRAME_DIMENSION = 1280;

function computeContainedRect(
  containerW: number,
  containerH: number,
  mediaW: number,
  mediaH: number,
): ContainedRect | null {
  if (containerW <= 0 || containerH <= 0 || mediaW <= 0 || mediaH <= 0) {
    return null;
  }
  const scale = Math.min(containerW / mediaW, containerH / mediaH);
  const width = Math.round(mediaW * scale);
  const height = Math.round(mediaH * scale);
  const left = Math.round((containerW - width) / 2);
  const top = Math.round((containerH - height) / 2);
  return { left, top, width, height };
}

export function InspectionWorkspace({
  defaultMode,
  lockMode = false,
  settings,
  samples,
  cameraState,
  onCameraStateChange,
  onInspectionCompleted,
  onViewReport,
}: InspectionWorkspaceProps) {
  const [mode, setMode] = useState<InspectionMode>(defaultMode);
  const [scanIntervalSec, setScanIntervalSec] = useState<number>(3);
  const [continuousScan, setContinuousScan] = useState<boolean>(true);
  const [isPaused, setIsPaused] = useState<boolean>(false);

  // Still-image upload / sample state
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pendingBlob, setPendingBlob] = useState<Blob | null>(null);
  const [pendingFilename, setPendingFilename] = useState<string>('upload.jpg');
  const [savedRecord, setSavedRecord] = useState<InspectionRecord | null>(null);
  const [viewportLayer, setViewportLayer] = useState<ViewportLayer>('overlay');

  // Continuous live detection state
  const [liveResult, setLiveResult] = useState<LiveFrameResult | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isSavingSnapshot, setIsSavingSnapshot] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [rateLimitUntil, setRateLimitUntil] = useState<number>(0);
  const [videoDims, setVideoDims] = useState<{ w: number; h: number }>({ w: 1280, h: 720 });
  const [imageDims, setImageDims] = useState<{ w: number; h: number } | null>(null);
  const [stageDims, setStageDims] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [framesAnalyzed, setFramesAnalyzed] = useState<number>(0);
  const [framesSkipped, setFramesSkipped] = useState<number>(0);
  const [sampleMenuOpen, setSampleMenuOpen] = useState<boolean>(false);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const sampleContainerRef = useRef<HTMLDivElement | null>(null);
  const inFlightRef = useRef<boolean>(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastLiveBlobRef = useRef<Blob | null>(null);
  const lastLiveResultRef = useRef<LiveFrameResult | null>(null);
  const sessionHasUnsavedLiveRef = useRef<boolean>(false);
  const modeRef = useRef<InspectionMode>(mode);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    setMode(defaultMode);
  }, [defaultMode]);

  useEffect(() => {
    if (settings?.auto_scan_interval_sec) {
      const nearest = SCAN_INTERVAL_OPTIONS.includes(
        settings.auto_scan_interval_sec as (typeof SCAN_INTERVAL_OPTIONS)[number],
      )
        ? settings.auto_scan_interval_sec
        : 3;
      setScanIntervalSec(nearest);
    }
  }, [settings?.auto_scan_interval_sec]);

  // Measure the 16:9 preview stage so object-fit: contain overlays stay strictly inside preview bounds
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;

    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      setStageDims({ w: Math.round(rect.width), h: Math.round(rect.height) });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Close sample menu when clicking outside
  useEffect(() => {
    if (!sampleMenuOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (sampleContainerRef.current && !sampleContainerRef.current.contains(e.target as Node)) {
        setSampleMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [sampleMenuOpen]);

  /**
   * Captures current live video frame, scaling proportionally up to 1280px
   * so thin hairline cracks preserve sharp detail without oversized uploads.
   */
  const captureResizedFrameFromVideo = useCallback(async (): Promise<{
    blob: Blob;
    width: number;
    height: number;
  } | null> => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      return null;
    }

    const srcW = video.videoWidth;
    const srcH = video.videoHeight;
    const scale = Math.min(1, MAX_LIVE_FRAME_DIMENSION / Math.max(srcW, srcH));
    const dstW = Math.max(16, Math.round(srcW * scale));
    const dstH = Math.max(16, Math.round(srcH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = dstW;
    canvas.height = dstH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, dstW, dstH);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.9),
    );
    if (!blob) return null;
    return { blob, width: dstW, height: dstH };
  }, []);

  const runLiveFrameInference = useCallback(async () => {
    if (inFlightRef.current) {
      setFramesSkipped((n) => n + 1);
      return;
    }
    if (Date.now() < rateLimitUntil) {
      return;
    }

    const captured = await captureResizedFrameFromVideo();
    if (!captured) return;

    inFlightRef.current = true;
    setIsProcessing(true);
    setErrorMsg(null);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const activeMode = modeRef.current;
      const res = await analyzeLiveCameraFrame({
        mode: activeMode,
        blob: captured.blob,
        signal: controller.signal,
      });

      lastLiveBlobRef.current = captured.blob;
      lastLiveResultRef.current = res;
      sessionHasUnsavedLiveRef.current = true;
      setLiveResult(res);
      setFramesAnalyzed((n) => n + 1);
      setStatusBanner(null);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      if (err instanceof RateLimitError) {
        setRateLimitUntil(Date.now() + 10000);
        setErrorMsg(`${err.message} Holding scan for 10s while preserving latest detections.`);
      } else {
        setErrorMsg(
          err instanceof Error
            ? `${err.message} (Retaining last valid detection results.)`
            : 'Live frame analysis failed.',
        );
      }
    } finally {
      inFlightRef.current = false;
      abortControllerRef.current = null;
      setIsProcessing(false);
    }
  }, [captureResizedFrameFromVideo, rateLimitUntil]);

  const persistSnapshotToDatabase = useCallback(
    async (blob: Blob, resultSnapshot: LiveFrameResult, label: string) => {
      setIsSavingSnapshot(true);
      try {
        const record = await saveLiveInspection({
          mode: resultSnapshot.mode,
          blob,
          liveResult: resultSnapshot,
        });
        sessionHasUnsavedLiveRef.current = false;
        setSavedRecord(record);
        setStatusBanner(`${label}: ${record.id} saved with PDF report.`);
        onInspectionCompleted(record);
        return record;
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Failed to save inspection snapshot.');
        return null;
      } finally {
        setIsSavingSnapshot(false);
      }
    },
    [onInspectionCompleted],
  );

  const stopInspection = useCallback(async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    inFlightRef.current = false;
    setIsProcessing(false);
    setIsPaused(false);

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    onCameraStateChange('inactive');

    if (
      sessionHasUnsavedLiveRef.current &&
      lastLiveBlobRef.current &&
      lastLiveResultRef.current
    ) {
      await persistSnapshotToDatabase(
        lastLiveBlobRef.current,
        lastLiveResultRef.current,
        'Session report saved',
      );
    }
  }, [onCameraStateChange, persistSnapshotToDatabase]);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

  const startInspection = async () => {
    setCameraError(null);
    setErrorMsg(null);
    setStatusBanner(null);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      onCameraStateChange('error');
      setCameraError('Browser camera API (getUserMedia) is unavailable in this context.');
      return;
    }

    onCameraStateChange('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = stream;
      setPreviewUrl(null);
      setPendingBlob(null);
      setImageDims(null);
      setSavedRecord(null);
      setLiveResult(null);
      lastLiveBlobRef.current = null;
      lastLiveResultRef.current = null;
      sessionHasUnsavedLiveRef.current = false;
      setFramesAnalyzed(0);
      setFramesSkipped(0);
      setIsPaused(false);
      setContinuousScan(true);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        if (videoRef.current.videoWidth && videoRef.current.videoHeight) {
          setVideoDims({
            w: videoRef.current.videoWidth,
            h: videoRef.current.videoHeight,
          });
        }
      }

      onCameraStateChange('active');
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        onCameraStateChange('denied');
        setCameraError('Camera permission denied. Allow camera access in browser settings or upload an image.');
      } else {
        onCameraStateChange('error');
        setCameraError(
          err instanceof Error ? `Unable to access camera: ${err.message}` : 'Unable to access camera hardware.',
        );
      }
    }
  };

  useEffect(() => {
    if (cameraState !== 'active' || !continuousScan || isPaused) {
      return;
    }

    const initialDelay = window.setTimeout(() => {
      void runLiveFrameInference();
    }, 350);

    const timer = window.setInterval(() => {
      void runLiveFrameInference();
    }, scanIntervalSec * 1000);

    return () => {
      window.clearTimeout(initialDelay);
      window.clearInterval(timer);
    };
  }, [cameraState, continuousScan, isPaused, scanIntervalSec, runLiveFrameInference]);

  const handleManualCapture = async () => {
    setErrorMsg(null);
    if (cameraState !== 'active') return;

    const captured = await captureResizedFrameFromVideo();
    if (!captured) {
      setErrorMsg('Camera stream is not ready yet. Wait a moment and try again.');
      return;
    }

    setIsProcessing(true);
    try {
      const record = await runImageInspection({
        mode,
        blob: captured.blob,
        filename: `manual_capture_${Date.now()}.jpg`,
        sourceType: 'webcam',
      });
      setSavedRecord(record);
      const nextLive: LiveFrameResult = {
        timestamp: record.created_at,
        mode: record.mode,
        status: record.status,
        image_width: record.image_width,
        image_height: record.image_height,
        inference_engine: record.inference_engine,
        processing_time_ms: record.processing_time_ms,
        crack_results: record.crack_results,
        helmet_results: record.helmet_results,
        summary: record.summary,
      };
      setLiveResult(nextLive);
      lastLiveBlobRef.current = captured.blob;
      lastLiveResultRef.current = nextLive;
      sessionHasUnsavedLiveRef.current = false;
      setStatusBanner(`Manual snapshot captured: ${record.id} saved with PDF.`);
      onInspectionCompleted(record);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Manual capture inspection failed.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSaveCurrentLiveSnapshot = async () => {
    if (!lastLiveBlobRef.current || !lastLiveResultRef.current) return;
    await persistSnapshotToDatabase(
      lastLiveBlobRef.current,
      lastLiveResultRef.current,
      'Snapshot saved',
    );
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (cameraState === 'active') {
      void stopInspection();
    }
    setErrorMsg(null);
    setCameraError(null);
    setStatusBanner(null);
    const objUrl = URL.createObjectURL(file);
    setPreviewUrl(objUrl);
    setPendingBlob(file);
    setPendingFilename(file.name);
    setImageDims(null);
    setSavedRecord(null);
    setLiveResult(null);
    setViewportLayer('overlay');
    e.target.value = '';
  };

  const handleLoadSample = async (sample: SampleImageItem) => {
    setSampleMenuOpen(false);
    if (cameraState === 'active') {
      void stopInspection();
    }
    setErrorMsg(null);
    setCameraError(null);
    setStatusBanner(null);
    try {
      const res = await fetch(sample.url);
      if (!res.ok) throw new Error('Failed to load sample image');
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      setPreviewUrl(objUrl);
      setPendingBlob(blob);
      setPendingFilename(sample.filename);
      setImageDims(null);
      if (!lockMode) {
        setMode(sample.mode);
      }
      setSavedRecord(null);
      setLiveResult(null);
      setViewportLayer('overlay');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to load sample image');
    }
  };

  const handleRunStillInspection = async () => {
    if (!pendingBlob) {
      setErrorMsg('Start Inspection for live camera monitoring or upload/select an image.');
      return;
    }
    setIsProcessing(true);
    setErrorMsg(null);
    setStatusBanner(null);
    try {
      const record = await runImageInspection({
        mode,
        blob: pendingBlob,
        filename: pendingFilename,
        sourceType: 'upload',
      });
      setSavedRecord(record);
      setLiveResult({
        timestamp: record.created_at,
        mode: record.mode,
        status: record.status,
        image_width: record.image_width,
        image_height: record.image_height,
        inference_engine: record.inference_engine,
        processing_time_ms: record.processing_time_ms,
        crack_results: record.crack_results,
        helmet_results: record.helmet_results,
        summary: record.summary,
      });
      setViewportLayer('overlay');
      onInspectionCompleted(record);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Inspection failed.');
    } finally {
      setIsProcessing(false);
    }
  };

  const isCameraActive = cameraState === 'active';
  const showLiveVideo = isCameraActive && !previewUrl;

  const displayedResults = liveResult;
  const activeCracks = displayedResults?.crack_results?.detections ?? [];
  const activeHelmets = displayedResults?.helmet_results?.detections ?? [];

  const activeImageSrc =
    savedRecord && !showLiveVideo
      ? viewportLayer === 'annotated'
        ? getStorageUrl(savedRecord.annotated_image_key)
        : viewportLayer === 'original'
          ? getStorageUrl(savedRecord.original_image_key)
          : previewUrl || getStorageUrl(savedRecord.original_image_key)
      : previewUrl;

  const showOverlayBoxes = showLiveVideo
    ? Boolean(displayedResults)
    : Boolean(displayedResults && viewportLayer === 'overlay');

  const overlayBounds = useMemo(() => {
    const media = showLiveVideo
      ? videoDims
      : imageDims ||
        (displayedResults
          ? { w: displayedResults.image_width, h: displayedResults.image_height }
          : null);
    if (!media) return null;
    return computeContainedRect(stageDims.w, stageDims.h, media.w, media.h);
  }, [displayedResults, imageDims, showLiveVideo, stageDims.h, stageDims.w, videoDims]);

  const aiStatusLabel = isProcessing
    ? 'Inferencing...'
    : isCameraActive
      ? isPaused
        ? 'Paused (Camera Live)'
        : Date.now() < rateLimitUntil
          ? 'Rate Limit Cooldown'
          : continuousScan
            ? `Monitoring (${scanIntervalSec}s)`
            : 'Camera Live (Manual)'
      : savedRecord
        ? 'Completed'
        : 'Standby';

  const aiStatusColor = isProcessing
    ? 'text-[#FACC15]'
    : isPaused || Date.now() < rateLimitUntil
      ? 'text-[#EA580C]'
      : isCameraActive && continuousScan
        ? 'text-[#16A34A]'
        : 'text-[#9CA3AF]';

  const crackRes = displayedResults?.crack_results;
  const crackStatusBadge = crackRes
    ? crackRes.module_error
      ? { label: 'Module Error', cls: 'border-[#DC2626]/50 bg-[#DC2626]/10 text-[#FCA5A5]' }
      : crackRes.total_cracks > 0
        ? { label: 'Cracks Detected', cls: 'border-[#FACC15]/50 bg-[#FACC15]/10 text-[#FACC15]' }
        : crackRes.image_quality === 'uncertain'
          ? { label: 'Uncertain Result', cls: 'border-[#EA580C]/50 bg-[#EA580C]/10 text-[#FDBA74]' }
          : { label: 'No Cracks Detected', cls: 'border-[#16A34A]/50 bg-[#16A34A]/10 text-[#86EFAC]' }
    : null;

  return (
    <div className="flex flex-col gap-3">
      {/* Main Responsive Workspace: Preview + Below Toolbar (Left) | Results Panel (Right) */}
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start">
        {/* LEFT COLUMN: Dedicated 16:9 Preview Container + Dedicated Control Toolbar Below */}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {/* 1. Dedicated Camera / Inspection Preview Card */}
          <section
            aria-label="Camera and inspection preview"
            className="flex flex-col overflow-hidden rounded-[4px] border border-[#2A303C] bg-[#13161D]"
          >
            {/* Preview Top Metadata Header */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#2A303C] bg-[#161A22] px-3.5 py-2 text-xs">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="font-semibold text-[#F3F4F6]">
                  {showLiveVideo
                    ? isPaused
                      ? 'Live Camera Feed · Detection Paused'
                      : continuousScan
                        ? 'Live Camera Feed · Continuous AI Monitoring'
                        : 'Live Camera Feed · Manual Capture Mode'
                    : activeImageSrc
                      ? 'Inspection Image Viewport'
                      : 'Camera / Inspection Viewport'}
                </span>
                {displayedResults && (
                  <span className="font-mono text-[#9CA3AF]">
                    {displayedResults.image_width}×{displayedResults.image_height}px · {displayedResults.processing_time_ms}ms
                  </span>
                )}
                {isCameraActive && framesAnalyzed > 0 && (
                  <span className="hidden font-mono text-[11px] text-[#6B7280] sm:inline">
                    Frames: {framesAnalyzed}
                    {framesSkipped > 0 ? ` (${framesSkipped} skipped)` : ''}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="hidden items-center gap-3 text-[11px] text-[#9CA3AF] md:flex">
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-2.5 w-2.5 bg-[#FACC15]" /> Crack
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-2.5 w-2.5 bg-[#16A34A]" /> Helmet OK
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-2.5 w-2.5 bg-[#DC2626]" /> No Helmet
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-2.5 w-2.5 bg-[#EA580C]" /> Uncertain
                  </span>
                </div>

                {savedRecord && !showLiveVideo && (
                  <div className="flex items-center rounded-[4px] border border-[#2A303C] bg-[#0E1116] p-0.5 text-[11px]">
                    {(
                      [
                        ['overlay', 'Live Overlay'],
                        ['annotated', 'Annotated Image'],
                        ['original', 'Original'],
                      ] as const
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setViewportLayer(key)}
                        className={`rounded-[3px] px-2 py-1 font-medium whitespace-nowrap ${
                          viewportLayer === key
                            ? 'bg-[#222732] text-[#FACC15]'
                            : 'text-[#9CA3AF] hover:text-[#F3F4F6]'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Dedicated Responsive 16:9 Preview Container (object-fit: contain, bounded overlays) */}
            <div className="w-full bg-[#0B0D11] p-2 sm:p-3">
              <div
                ref={stageRef}
                className="relative mx-auto aspect-video w-full max-h-[60vh] min-h-[220px] overflow-hidden rounded-[3px] bg-[#0B0D11]"
              >
                {/* Live Video (always object-contain inside 16:9 container) */}
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  onLoadedMetadata={(e) => {
                    const v = e.currentTarget;
                    if (v.videoWidth && v.videoHeight) {
                      setVideoDims({ w: v.videoWidth, h: v.videoHeight });
                    }
                  }}
                  className={showLiveVideo ? 'block h-full w-full object-contain' : 'hidden'}
                />

                {/* Static Uploaded / Sample / Annotated Image */}
                {!showLiveVideo && activeImageSrc && (
                  <img
                    src={activeImageSrc}
                    alt="Construction inspection viewport"
                    onLoad={(e) => {
                      const img = e.currentTarget;
                      if (img.naturalWidth && img.naturalHeight) {
                        setImageDims({ w: img.naturalWidth, h: img.naturalHeight });
                      }
                    }}
                    className="block h-full w-full object-contain"
                    referrerPolicy="no-referrer"
                  />
                )}

                {/* Detection Overlay constrained to exact contained media rectangle */}
                {showOverlayBoxes && (showLiveVideo || Boolean(activeImageSrc)) && (
                  <DetectionOverlay
                    cracks={activeCracks}
                    helmets={activeHelmets}
                    bounds={overlayBounds}
                  />
                )}

                {/* Idle Empty State */}
                {!showLiveVideo && !activeImageSrc && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-[4px] border border-[#2A303C] bg-[#161A22] text-[#FACC15]">
                      <Camera className="h-6 w-6" />
                    </div>
                    <h2 className="mt-3 text-sm font-semibold text-[#F3F4F6]">
                      Live Site Monitoring Ready
                    </h2>
                    <p className="mt-1 max-w-md text-xs leading-relaxed text-[#9CA3AF]">
                      Click <strong className="text-[#F3F4F6]">Start Inspection</strong> below to activate
                      your camera with continuous AI scanning (every {scanIntervalSec}s), or upload a site photo.
                    </p>
                    {cameraError && (
                      <p className="mt-3 max-w-md rounded-[4px] border border-[#DC2626]/50 bg-[#DC2626]/10 px-3 py-2 text-xs text-[#FCA5A5]">
                        {cameraError}
                      </p>
                    )}
                  </div>
                )}

                {/* Non-blocking processing badge inside preview bounds */}
                {isProcessing && (
                  <div className="pointer-events-none absolute right-3 top-3 flex items-center gap-2 rounded-[4px] border border-[#FACC15]/60 bg-[#0E1116]/95 px-3 py-1.5 text-xs font-medium text-[#FACC15]">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Analyzing {mode} frame...
                  </div>
                )}
              </div>
            </div>

            {statusBanner && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#16A34A]/40 bg-[#16A34A]/10 px-4 py-2 text-xs text-[#86EFAC]">
                <span>{statusBanner}</span>
                {savedRecord && (
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => onViewReport(savedRecord)}
                      className="font-semibold text-[#F3F4F6] underline"
                    >
                      View Report
                    </button>
                    <a
                      href={getReportDownloadUrl(savedRecord.id)}
                      download={`${savedRecord.id}_inspection_report.pdf`}
                      className="font-semibold text-[#FACC15] underline"
                    >
                      Download PDF
                    </a>
                  </div>
                )}
              </div>
            )}

            {errorMsg && (
              <div className="flex items-center gap-2 border-t border-[#DC2626]/50 bg-[#DC2626]/10 px-4 py-2 text-xs text-[#FCA5A5]">
                <AlertTriangle className="h-4 w-4 shrink-0 text-[#DC2626]" />
                <span>{errorMsg}</span>
              </div>
            )}
          </section>

          {/* 2. Dedicated Inspection Control Toolbar BELOW Camera Preview */}
          <section
            aria-label="Inspection controls"
            className="rounded-[4px] border border-[#2A303C] bg-[#161A22] p-3"
          >
            <div className="flex flex-wrap items-center gap-2.5">
              {/* Primary Session Controls: Start / Stop + Pause / Resume + Manual Capture */}
              {!isCameraActive ? (
                <button
                  type="button"
                  onClick={() => void startInspection()}
                  disabled={cameraState === 'starting'}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-[4px] bg-[#FACC15] px-4 text-xs font-semibold text-[#0E1116] hover:bg-[#EAB308] disabled:opacity-50 whitespace-nowrap"
                >
                  <Camera className="h-4 w-4 shrink-0" />
                  {cameraState === 'starting' ? 'Starting Camera...' : 'Start Inspection'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void stopInspection()}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-[4px] border border-[#DC2626] bg-[#DC2626]/20 px-4 text-xs font-semibold text-[#FCA5A5] hover:bg-[#DC2626]/30 whitespace-nowrap"
                >
                  <CameraOff className="h-4 w-4 shrink-0" />
                  Stop Inspection
                </button>
              )}

              <button
                type="button"
                disabled={!isCameraActive}
                onClick={() => setIsPaused((p) => !p)}
                className={`inline-flex h-11 items-center justify-center gap-2 rounded-[4px] border px-3.5 text-xs font-medium whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-40 ${
                  isCameraActive && isPaused
                    ? 'border-[#16A34A] bg-[#16A34A]/15 text-[#86EFAC] hover:bg-[#16A34A]/25'
                    : isCameraActive
                      ? 'border-[#EA580C]/70 bg-[#EA580C]/15 text-[#FDBA74] hover:bg-[#EA580C]/25'
                      : 'border-[#2A303C] bg-[#11141A] text-[#9CA3AF]'
                }`}
              >
                {isPaused ? (
                  <>
                    <Play className="h-4 w-4 shrink-0 fill-current" />
                    Resume Detection
                  </>
                ) : (
                  <>
                    <Pause className="h-4 w-4 shrink-0" />
                    Pause Detection
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => void handleManualCapture()}
                disabled={!isCameraActive || isProcessing}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-[4px] border border-[#3A4252] bg-[#1E232D] px-3.5 text-xs font-medium text-[#F3F4F6] hover:bg-[#262C38] disabled:cursor-not-allowed disabled:opacity-40 whitespace-nowrap"
              >
                <Save className="h-4 w-4 shrink-0" />
                Manual Capture
              </button>

              {/* Image Upload & Reference Site Samples */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleFileUpload}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-[4px] border border-[#2A303C] bg-[#11141A] px-3.5 text-xs font-medium text-[#D1D5DB] hover:border-[#3A4252] hover:text-white whitespace-nowrap"
              >
                <Upload className="h-4 w-4 shrink-0" />
                Upload Image
              </button>

              {samples.length > 0 && (
                <div ref={sampleContainerRef} className="relative">
                  <button
                    type="button"
                    onClick={() => setSampleMenuOpen((v) => !v)}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-[4px] border border-[#2A303C] bg-[#11141A] px-3.5 text-xs font-medium text-[#D1D5DB] hover:border-[#3A4252] hover:text-white whitespace-nowrap"
                  >
                    <FolderOpen className="h-4 w-4 shrink-0" />
                    Site Samples
                  </button>
                  {sampleMenuOpen && (
                    <div className="absolute bottom-full left-0 z-30 mb-1.5 w-72 max-w-[85vw] rounded-[4px] border border-[#2A303C] bg-[#161A22] p-1.5 shadow-xl">
                      <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]">
                        Load Reference Site Photo
                      </p>
                      {samples.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => void handleLoadSample(s)}
                          className="flex w-full flex-col rounded-[3px] px-2.5 py-2 text-left hover:bg-[#1E232D]"
                        >
                          <span className="text-xs font-medium text-[#F3F4F6]">{s.label}</span>
                          <span className="text-[11px] text-[#9CA3AF]">{s.description}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Continuous Scan Toggle & Interval Selector */}
              <button
                type="button"
                onClick={() => setContinuousScan((v) => !v)}
                className={`inline-flex h-11 items-center justify-center gap-2 rounded-[4px] border px-3.5 text-xs font-medium whitespace-nowrap ${
                  continuousScan
                    ? 'border-[#FACC15]/70 bg-[#FACC15]/15 text-[#FACC15]'
                    : 'border-[#2A303C] bg-[#11141A] text-[#9CA3AF] hover:text-[#F3F4F6]'
                }`}
              >
                <Repeat className="h-4 w-4 shrink-0" />
                Continuous Scan: {continuousScan ? 'ON' : 'OFF'}
              </button>

              <div className="flex h-11 items-center gap-2 rounded-[4px] border border-[#2A303C] bg-[#11141A] px-3">
                <label htmlFor="scan-interval-select" className="text-xs text-[#9CA3AF] whitespace-nowrap">
                  Interval:
                </label>
                <select
                  id="scan-interval-select"
                  value={scanIntervalSec}
                  onChange={(e) => setScanIntervalSec(Number(e.target.value))}
                  className="h-full bg-transparent font-mono text-xs font-medium text-[#F3F4F6] focus:outline-none"
                >
                  {SCAN_INTERVAL_OPTIONS.map((sec) => (
                    <option key={sec} value={sec} className="bg-[#161A22]">
                      {sec}s
                    </option>
                  ))}
                </select>
              </div>

              {/* Inspection Mode Selector */}
              <div className="flex h-11 items-center gap-2 rounded-[4px] border border-[#2A303C] bg-[#11141A] px-3">
                <label htmlFor="inspection-mode-select" className="text-xs text-[#9CA3AF] whitespace-nowrap">
                  Mode:
                </label>
                <select
                  id="inspection-mode-select"
                  value={mode}
                  disabled={lockMode}
                  onChange={(e) => setMode(e.target.value as InspectionMode)}
                  className="h-full bg-transparent text-xs font-medium text-[#F3F4F6] focus:outline-none disabled:opacity-60"
                >
                  <option value="combined" className="bg-[#161A22]">
                    Combined Inspection
                  </option>
                  <option value="cracks" className="bg-[#161A22]">
                    Structural Crack Detection
                  </option>
                  <option value="helmets" className="bg-[#161A22]">
                    Worker Helmet Detection
                  </option>
                </select>
              </div>

              {/* Still-image Run Inspection trigger */}
              {!isCameraActive && pendingBlob && (
                <button
                  type="button"
                  onClick={() => void handleRunStillInspection()}
                  disabled={isProcessing}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-[4px] bg-[#FACC15] px-4 text-xs font-semibold text-[#0E1116] hover:bg-[#EAB308] disabled:opacity-45 whitespace-nowrap"
                >
                  {isProcessing ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4 shrink-0 fill-current" />
                  )}
                  Run Inspection
                </button>
              )}
            </div>
          </section>
        </div>

        {/* RIGHT COLUMN: Live Updating AI Detection Results Panel */}
        <aside className="flex w-full shrink-0 flex-col overflow-hidden rounded-[4px] border border-[#2A303C] bg-[#161A22] xl:max-h-[calc(100vh-8rem)] xl:w-[370px]">
          <div className="flex items-center justify-between border-b border-[#2A303C] bg-[#13161D] px-4 py-2.5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#F3F4F6]">
              AI Detection Results
            </h2>
            <span className={`font-mono text-[11px] font-medium ${aiStatusColor}`}>
              {aiStatusLabel}
            </span>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto p-4 text-xs">
            {!displayedResults ? (
              <div className="space-y-3 text-[#9CA3AF]">
                <p className="leading-relaxed">
                  {isCameraActive
                    ? isPaused
                      ? 'AI detection is paused while the live camera feed remains active. Click Resume Detection to continue scanning.'
                      : 'Live camera active. Waiting for first Gemini Vision frame analysis response...'
                    : 'Click Start Inspection to begin continuous camera monitoring, or upload an image for single-frame analysis.'}
                </p>
                <div className="space-y-1.5 rounded-[4px] border border-[#2A303C] bg-[#11141A] p-3">
                  <p className="font-semibold text-[#D1D5DB]">Mode: {mode.toUpperCase()}</p>
                  <p>
                    {mode === 'cracks' &&
                      'Detects thin hairline, vertical, horizontal, diagonal, branching, and multiple cracks with yellow bounding boxes, crack type, model-reported confidence, and AI-estimated severity.'}
                    {mode === 'helmets' &&
                      'Detects workers, verifies safety helmet usage (green/red), and flags unclear heads as uncertain (orange).'}
                    {mode === 'combined' &&
                      'Runs independent crack detection and safety helmet modules concurrently with fault isolation.'}
                  </p>
                </div>
              </div>
            ) : (
              <>
                {/* Latest Timestamp & Overall Status */}
                <div className="rounded-[4px] border border-[#2A303C] bg-[#11141A] p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[11px] text-[#9CA3AF]">
                      {new Date(displayedResults.timestamp).toLocaleTimeString()}
                    </span>
                    <span
                      className={`font-mono text-[11px] font-semibold ${
                        displayedResults.status === 'Nominal'
                          ? 'text-[#16A34A]'
                          : displayedResults.status === 'Attention Required'
                            ? 'text-[#EA580C]'
                            : 'text-[#DC2626]'
                      }`}
                    >
                      {displayedResults.status.toUpperCase()}
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 border-t border-[#2A303C] pt-2 font-mono">
                    <div>
                      <span className="block text-[10px] text-[#6B7280]">Total Objects</span>
                      <span className="text-sm font-semibold text-[#F3F4F6]">
                        {(displayedResults.crack_results?.total_cracks ?? 0) +
                          (displayedResults.helmet_results?.total_workers ?? 0)}
                      </span>
                    </div>
                    <div>
                      <span className="block text-[10px] text-[#6B7280]">Inference Latency</span>
                      <span className="text-sm font-semibold text-[#F3F4F6]">
                        {displayedResults.processing_time_ms} ms
                      </span>
                    </div>
                  </div>
                </div>

                {/* Structural Crack Results */}
                {crackRes && (
                  <div className="space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="font-semibold uppercase tracking-wider text-[#FACC15]">
                        Structural Cracks
                      </h3>
                      {crackStatusBadge && (
                        <span
                          className={`rounded-[3px] border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase ${crackStatusBadge.cls}`}
                        >
                          {crackStatusBadge.label}
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-3 gap-2 font-mono">
                      <div className="rounded-[4px] border border-[#2A303C] bg-[#11141A] p-2">
                        <span className="block text-[10px] text-[#6B7280]">Cracks</span>
                        <span className="text-sm font-semibold text-[#FACC15]">
                          {crackRes.total_cracks}
                        </span>
                      </div>
                      <div className="rounded-[4px] border border-[#2A303C] bg-[#11141A] p-2">
                        <span className="block text-[10px] text-[#6B7280]">Est. Severity</span>
                        <span className="text-sm font-semibold uppercase text-[#F3F4F6]">
                          {crackRes.estimated_overall_severity}
                        </span>
                      </div>
                      <div className="rounded-[4px] border border-[#2A303C] bg-[#11141A] p-2">
                        <span className="block text-[10px] text-[#6B7280]">Model Conf.</span>
                        <span className="text-sm font-semibold text-[#F3F4F6]">
                          {crackRes.average_model_confidence !== null
                            ? `${(crackRes.average_model_confidence * 100).toFixed(0)}%`
                            : 'N/A'}
                        </span>
                      </div>
                    </div>

                    {crackRes.module_error ? (
                      <div className="flex items-start gap-2 rounded-[4px] border border-[#DC2626]/40 bg-[#DC2626]/10 p-2.5 text-[#FCA5A5]">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#DC2626]" />
                        <div>
                          <p className="font-semibold">Crack Detection Unavailable</p>
                          <p className="mt-0.5 text-[11px]">{crackRes.module_error}</p>
                        </div>
                      </div>
                    ) : crackRes.detections.length > 0 ? (
                      <div className="space-y-1.5">
                        {crackRes.detections.map((c) => (
                          <div
                            key={c.id}
                            className="rounded-[4px] border border-[#2A303C] bg-[#11141A] p-2.5"
                          >
                            <div className="flex items-center justify-between font-mono">
                              <span className="font-semibold text-[#FACC15]">
                                {c.id} · {c.severity.toUpperCase()}
                              </span>
                              <span className="text-[#D1D5DB]">
                                {(c.model_reported_confidence * 100).toFixed(0)}% model conf
                              </span>
                            </div>
                            <p className="mt-1 font-medium text-[#F3F4F6]">{c.classification}</p>
                            <p className="mt-0.5 text-[11px] text-[#9CA3AF]">
                              {c.location_description}
                            </p>
                            <p className="mt-1 font-mono text-[10px] text-[#6B7280]">
                              Box: [{c.pixel_box.x}, {c.pixel_box.y}, {c.pixel_box.width}×{c.pixel_box.height}px]
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : crackRes.image_quality === 'uncertain' ? (
                      <div className="flex items-start gap-2 rounded-[4px] border border-[#EA580C]/40 bg-[#EA580C]/10 p-2.5 text-[#FDBA74]">
                        <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#EA580C]" />
                        <div>
                          <p className="font-semibold">Uncertain Image Quality</p>
                          <p className="mt-0.5 text-[11px]">
                            {crackRes.uncertain_reason ||
                              'Surface visibility is insufficient to confirm absence of cracks. Capture a clearer image.'}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-2 rounded-[4px] border border-[#16A34A]/40 bg-[#16A34A]/10 p-2.5 text-[#86EFAC]">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#16A34A]" />
                        <div>
                          <p className="font-semibold">No Cracks Detected</p>
                          <p className="mt-0.5 text-[11px] text-[#D1D5DB]">{crackRes.notes}</p>
                        </div>
                      </div>
                    )}

                    <p className="text-[11px] leading-snug text-[#6B7280]">
                      {crackRes.severity_disclaimer}
                    </p>
                  </div>
                )}

                {/* Worker Safety Helmet Results */}
                {displayedResults.helmet_results && (
                  <div className="space-y-2 border-t border-[#2A303C] pt-3">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold uppercase tracking-wider text-[#F3F4F6]">
                        Safety Helmets
                      </h3>
                      <span className="font-mono font-semibold text-[#FACC15]">
                        Compliance:{' '}
                        {displayedResults.helmet_results.helmet_compliance_percent !== null
                          ? `${displayedResults.helmet_results.helmet_compliance_percent.toFixed(1)}%`
                          : 'N/A'}
                      </span>
                    </div>

                    {displayedResults.helmet_results.module_error ? (
                      <div className="flex items-start gap-2 rounded-[4px] border border-[#DC2626]/40 bg-[#DC2626]/10 p-2.5 text-[#FCA5A5]">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#DC2626]" />
                        <div>
                          <p className="font-semibold">Helmet Detection Unavailable</p>
                          <p className="mt-0.5 text-[11px]">
                            {displayedResults.helmet_results.module_error}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="grid grid-cols-2 gap-2 font-mono">
                          <div className="rounded-[4px] border border-[#2A303C] bg-[#11141A] p-2">
                            <span className="block text-[10px] text-[#6B7280]">Total Workers</span>
                            <span className="text-sm font-semibold text-[#F3F4F6]">
                              {displayedResults.helmet_results.total_workers}
                            </span>
                          </div>
                          <div className="rounded-[4px] border border-[#2A303C] bg-[#11141A] p-2">
                            <span className="block text-[10px] text-[#6B7280]">Wearing Helmets</span>
                            <span className="text-sm font-semibold text-[#16A34A]">
                              {displayedResults.helmet_results.workers_wearing_helmet}
                            </span>
                          </div>
                          <div className="rounded-[4px] border border-[#2A303C] bg-[#11141A] p-2">
                            <span className="block text-[10px] text-[#6B7280]">Without Helmets</span>
                            <span className="text-sm font-semibold text-[#DC2626]">
                              {displayedResults.helmet_results.workers_without_helmet}
                            </span>
                          </div>
                          <div className="rounded-[4px] border border-[#2A303C] bg-[#11141A] p-2">
                            <span className="block text-[10px] text-[#6B7280]">Uncertain</span>
                            <span className="text-sm font-semibold text-[#EA580C]">
                              {displayedResults.helmet_results.uncertain_detections}
                            </span>
                          </div>
                        </div>

                        {displayedResults.helmet_results.violations.length > 0 && (
                          <div className="rounded-[4px] border border-[#DC2626]/40 bg-[#DC2626]/10 p-2.5 text-[11px] text-[#FCA5A5]">
                            <p className="font-semibold text-[#DC2626]">Potential Safety Violations</p>
                            <ul className="mt-1 space-y-1">
                              {displayedResults.helmet_results.violations.map((v, i) => (
                                <li key={i}>• {v}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {displayedResults.helmet_results.detections.length > 0 && (
                          <div className="space-y-1.5">
                            {displayedResults.helmet_results.detections.map((w) => {
                              const color =
                                w.classification === 'helmet_detected'
                                  ? 'text-[#16A34A]'
                                  : w.classification === 'no_helmet'
                                    ? 'text-[#DC2626]'
                                    : 'text-[#EA580C]';
                              return (
                                <div
                                  key={w.id}
                                  className="rounded-[4px] border border-[#2A303C] bg-[#11141A] p-2"
                                >
                                  <div className="flex items-center justify-between font-mono">
                                    <span className={`font-semibold ${color}`}>
                                      {w.id} · {w.classification.replace('_', ' ').toUpperCase()}
                                    </span>
                                    <span className="text-[#D1D5DB]">
                                      {(w.model_reported_confidence * 100).toFixed(0)}% model conf
                                    </span>
                                  </div>
                                  <p className="mt-0.5 text-[11px] text-[#9CA3AF]">{w.reason}</p>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}

                {/* Report & Snapshot Persistence Actions */}
                <div className="space-y-2 border-t border-[#2A303C] pt-3">
                  {isCameraActive && lastLiveBlobRef.current && (
                    <button
                      type="button"
                      disabled={isSavingSnapshot}
                      onClick={() => void handleSaveCurrentLiveSnapshot()}
                      className="flex h-10 w-full items-center justify-center gap-1.5 rounded-[4px] border border-[#FACC15]/60 bg-[#FACC15]/10 px-3 text-xs font-semibold text-[#FACC15] hover:bg-[#FACC15]/20 disabled:opacity-50"
                    >
                      <Save className="h-3.5 w-3.5" />
                      {isSavingSnapshot ? 'Saving Snapshot & PDF...' : 'Save Snapshot & Report'}
                    </button>
                  )}

                  {savedRecord && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onViewReport(savedRecord)}
                        className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-[4px] border border-[#3A4252] bg-[#1E232D] px-3 text-xs font-medium text-[#F3F4F6] hover:bg-[#262C38] whitespace-nowrap"
                      >
                        <FileText className="h-3.5 w-3.5" />
                        View Report
                      </button>
                      <a
                        href={getReportDownloadUrl(savedRecord.id)}
                        download={`${savedRecord.id}_inspection_report.pdf`}
                        className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-[4px] bg-[#FACC15] px-3 text-xs font-semibold text-[#0E1116] hover:bg-[#EAB308] whitespace-nowrap"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Download PDF
                      </a>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
