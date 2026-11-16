import crypto from 'node:crypto';
import { detectStructuralCracks } from './crackDetector.ts';
import { getSettings, insertInspection } from './database.ts';
import { GEMINI_VISION_MODEL } from './geminiClient.ts';
import { detectWorkerHelmets } from './helmetDetector.ts';
import { normalizeInputImage, renderAnnotatedImage } from './imageAnnotator.ts';
import { generateInspectionPdf } from './reportGenerator.ts';
import { getStorageProvider } from './storage.ts';
import type {
  CrackInspectionResult,
  HelmetInspectionResult,
  InspectionMode,
  InspectionRecord,
  InspectionStatus,
  InspectionSummary,
  LiveFrameResult,
  SourceType,
} from './types.ts';

function buildSummary(
  mode: InspectionMode,
  cracks: CrackInspectionResult | null,
  helmets: HelmetInspectionResult | null,
): { status: InspectionStatus; summary: InspectionSummary } {
  const structural_findings: string[] = [];
  const worker_safety_findings: string[] = [];
  const potential_hazards: string[] = [];
  const recommended_actions: string[] = [];
  const manual_verification_warnings: string[] = [
    'All confidence values represent model-reported certainty, not calibrated statistical detection accuracy.',
  ];

  let hasHighCrack = false;
  let hasMediumOrLowCrack = false;
  let hasUncertainCrack = false;
  let hasHelmetViolation = false;
  let hasUncertainWorker = false;

  if (cracks) {
    if (cracks.module_error) {
      hasUncertainCrack = true;
      structural_findings.push(`Structural crack module encountered an error: ${cracks.module_error}`);
      manual_verification_warnings.push(
        `Crack detection module failed during combined inspection (${cracks.module_error}); structural verification required.`,
      );
    } else if (cracks.total_cracks === 0 && cracks.image_quality === 'uncertain') {
      hasUncertainCrack = true;
      const reason =
        cracks.uncertain_reason || 'Image quality is insufficient for reliable crack inspection.';
      structural_findings.push(`Uncertain crack inspection result: ${reason}`);
      manual_verification_warnings.push(
        `Crack detection marked UNCERTAIN (${reason}); capture a sharper, well-lit image or inspect manually.`,
      );
      recommended_actions.push(
        'Re-capture the concrete/structural surface with clearer focus and even lighting before confirming structural condition.',
      );
    } else if (cracks.total_cracks === 0) {
      structural_findings.push('No visible structural cracks were detected above the active confidence threshold.');
    } else {
      structural_findings.push(
        `Detected ${cracks.total_cracks} structural crack region(s) with AI-estimated overall severity "${cracks.estimated_overall_severity}".`,
      );
      if (cracks.estimated_overall_severity === 'High') {
        hasHighCrack = true;
        potential_hazards.push(
          'High-severity crack pattern estimated; potential structural integrity or spalling hazard requiring prompt engineering review.',
        );
        recommended_actions.push(
          'Schedule immediate on-site physical measurement (crack width gauge / ultrasonic testing) by a licensed structural engineer.',
        );
      } else {
        hasMediumOrLowCrack = true;
        potential_hazards.push(
          `${cracks.estimated_overall_severity}-severity surface cracking detected; potential moisture ingress or progressive deterioration if left unmonitored.`,
        );
        recommended_actions.push(
          'Document crack dimensions, establish periodic visual monitoring benchmarks, and seal/remediate per structural specifications.',
        );
      }
    }
    manual_verification_warnings.push(
      'Crack severity classifications (Low/Medium/High) are AI-generated visual estimates and NOT a certified structural safety assessment.',
    );
  }

  if (helmets) {
    if (helmets.module_error) {
      hasUncertainWorker = true;
      worker_safety_findings.push(`Helmet safety module encountered an error: ${helmets.module_error}`);
      manual_verification_warnings.push(
        `Worker helmet module failed during combined inspection (${helmets.module_error}); manual PPE check required.`,
      );
    } else if (helmets.total_workers === 0) {
      worker_safety_findings.push('No construction workers were detected within the inspected frame.');
    } else {
      const pct = helmets.helmet_compliance_percent !== null ? `${helmets.helmet_compliance_percent.toFixed(1)}%` : 'N/A';
      worker_safety_findings.push(
        `Detected ${helmets.total_workers} worker(s): ${helmets.workers_wearing_helmet} wearing safety helmets, ${helmets.workers_without_helmet} without helmets, and ${helmets.uncertain_detections} uncertain (${pct} compliance).`,
      );

      if (helmets.workers_without_helmet > 0) {
        hasHelmetViolation = true;
        potential_hazards.push(
          `${helmets.workers_without_helmet} worker(s) observed without visible safety helmets in an active construction zone (head injury risk).`,
        );
        recommended_actions.push(
          'Notify site safety supervisor immediately to enforce mandatory hard hat PPE compliance before work continues in this zone.',
        );
      }
      if (helmets.uncertain_detections > 0) {
        hasUncertainWorker = true;
        manual_verification_warnings.push(
          `${helmets.uncertain_detections} worker detection(s) classified as UNCERTAIN due to partial occlusion, distance, or framing; manual visual verification required.`,
        );
        recommended_actions.push(
          'Review original image or capture closer unobstructed angle to verify PPE compliance for uncertain detections.',
        );
      }
      if (helmets.workers_without_helmet === 0 && helmets.uncertain_detections === 0) {
        recommended_actions.push('Maintain current PPE supervision protocols; all detected workers appear helmet-compliant.');
      }
    }
  }

  if (mode === 'combined' && cracks && cracks.total_cracks > 0 && helmets && helmets.workers_without_helmet > 0) {
    potential_hazards.push(
      'Combined risk: active unprotected personnel operating adjacent to visible structural cracking.',
    );
  }

  let status: InspectionStatus = 'Nominal';
  if (hasHighCrack && hasHelmetViolation) {
    status = 'Critical Alert';
  } else if (hasHelmetViolation) {
    status = 'Safety Violation';
  } else if (hasHighCrack) {
    status = 'Critical Alert';
  } else if (hasMediumOrLowCrack || hasUncertainWorker || hasUncertainCrack) {
    status = 'Attention Required';
  }

  return {
    status,
    summary: {
      structural_findings,
      worker_safety_findings,
      potential_hazards,
      recommended_actions,
      manual_verification_warnings,
    },
  };
}

function buildFallbackCrackErrorResult(reason: unknown): CrackInspectionResult {
  const message = reason instanceof Error ? reason.message : 'Structural crack module failed.';
  return {
    total_cracks: 0,
    estimated_overall_severity: 'None',
    average_model_confidence: null,
    image_quality: 'uncertain',
    uncertain_reason: message,
    module_error: message,
    detections: [],
    notes: `Crack inspection module unavailable: ${message}`,
    severity_disclaimer:
      'AI-generated severity estimate and model-reported confidence only; requires verification by a qualified structural engineer before remediation decisions.',
  };
}

function buildFallbackHelmetErrorResult(reason: unknown): HelmetInspectionResult {
  const message = reason instanceof Error ? reason.message : 'Helmet safety module failed.';
  return {
    total_workers: 0,
    workers_wearing_helmet: 0,
    workers_without_helmet: 0,
    uncertain_detections: 0,
    helmet_compliance_percent: null,
    image_quality: 'uncertain',
    uncertain_reason: message,
    module_error: message,
    detections: [],
    violations: [],
    notes: `Helmet inspection module unavailable: ${message}`,
  };
}

async function runCombinedDetectorsResilient(params: {
  imageBuffer: Buffer;
  mimeType: 'image/jpeg';
  imageWidth: number;
  imageHeight: number;
  crackThreshold: number;
  helmetThreshold: number;
  allowDeepHairlinePass: boolean;
}): Promise<{ crackResults: CrackInspectionResult; helmetResults: HelmetInspectionResult }> {
  const [crackSettled, helmetSettled] = await Promise.allSettled([
    detectStructuralCracks({
      imageBuffer: params.imageBuffer,
      mimeType: params.mimeType,
      imageWidth: params.imageWidth,
      imageHeight: params.imageHeight,
      confidenceThreshold: params.crackThreshold,
      allowDeepHairlinePass: params.allowDeepHairlinePass,
    }),
    detectWorkerHelmets({
      imageBuffer: params.imageBuffer,
      mimeType: params.mimeType,
      imageWidth: params.imageWidth,
      imageHeight: params.imageHeight,
      confidenceThreshold: params.helmetThreshold,
    }),
  ]);

  if (crackSettled.status === 'rejected' && helmetSettled.status === 'rejected') {
    const err1 = crackSettled.reason;
    const err2 = helmetSettled.reason;
    if (err1 instanceof Error && err1.name === 'GeminiRateLimitError') throw err1;
    if (err2 instanceof Error && err2.name === 'GeminiRateLimitError') throw err2;
    throw err1 instanceof Error ? err1 : err2;
  }

  const crackResults =
    crackSettled.status === 'fulfilled'
      ? crackSettled.value
      : buildFallbackCrackErrorResult(crackSettled.reason);

  const helmetResults =
    helmetSettled.status === 'fulfilled'
      ? helmetSettled.value
      : buildFallbackHelmetErrorResult(helmetSettled.reason);

  return { crackResults, helmetResults };
}

export async function runInspection(params: {
  mode: InspectionMode;
  rawImageBuffer: Buffer;
  sourceType?: SourceType;
  zoneLabelOverride?: string;
  telemetry?: Record<string, unknown> | null;
}): Promise<InspectionRecord> {
  const startedAt = Date.now();
  const settings = getSettings();
  const storage = getStorageProvider();

  // Optional delegation to external Python FastAPI + YOLO backend if configured
  if (settings.python_backend_url && settings.python_backend_url.startsWith('http')) {
    try {
      const delegated = await tryExternalPythonBackend(settings.python_backend_url, params);
      if (delegated) {
        return delegated;
      }
    } catch (err) {
      throw new Error(
        `External Python backend (${settings.python_backend_url}) failed: ${err instanceof Error ? err.message : 'Connection error'}`,
      );
    }
  }

  const normalized = await normalizeInputImage(params.rawImageBuffer);
  const id = `INSP-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const createdAt = new Date().toISOString();

  // Execute modular AI detectors independently
  let crackResults: CrackInspectionResult | null = null;
  let helmetResults: HelmetInspectionResult | null = null;

  if (params.mode === 'cracks') {
    crackResults = await detectStructuralCracks({
      imageBuffer: normalized.buffer,
      mimeType: normalized.mimeType,
      imageWidth: normalized.width,
      imageHeight: normalized.height,
      confidenceThreshold: settings.crack_confidence_threshold,
      allowDeepHairlinePass: true,
    });
  } else if (params.mode === 'helmets') {
    helmetResults = await detectWorkerHelmets({
      imageBuffer: normalized.buffer,
      mimeType: normalized.mimeType,
      imageWidth: normalized.width,
      imageHeight: normalized.height,
      confidenceThreshold: settings.helmet_confidence_threshold,
    });
  } else {
    const combined = await runCombinedDetectorsResilient({
      imageBuffer: normalized.buffer,
      mimeType: normalized.mimeType,
      imageWidth: normalized.width,
      imageHeight: normalized.height,
      crackThreshold: settings.crack_confidence_threshold,
      helmetThreshold: settings.helmet_confidence_threshold,
      allowDeepHairlinePass: true,
    });
    crackResults = combined.crackResults;
    helmetResults = combined.helmetResults;
  }

  // Render server-side annotated images with scaled bounding boxes
  const unifiedAnnotatedBuffer = await renderAnnotatedImage({
    baseImageBuffer: normalized.buffer,
    width: normalized.width,
    height: normalized.height,
    cracks: crackResults?.detections ?? [],
    helmets: helmetResults?.detections ?? [],
  });

  let crackAnnotatedBuffer: Buffer | null = null;
  let helmetAnnotatedBuffer: Buffer | null = null;

  if (params.mode === 'combined') {
    crackAnnotatedBuffer = await renderAnnotatedImage({
      baseImageBuffer: normalized.buffer,
      width: normalized.width,
      height: normalized.height,
      cracks: crackResults?.detections ?? [],
      helmets: [],
    });
    helmetAnnotatedBuffer = await renderAnnotatedImage({
      baseImageBuffer: normalized.buffer,
      width: normalized.width,
      height: normalized.height,
      cracks: [],
      helmets: helmetResults?.detections ?? [],
    });
  } else if (params.mode === 'cracks') {
    crackAnnotatedBuffer = unifiedAnnotatedBuffer;
  } else {
    helmetAnnotatedBuffer = unifiedAnnotatedBuffer;
  }

  // Persist image files durably
  const origKey = await storage.saveFile(`inspections/${id}/original.jpg`, normalized.buffer, 'image/jpeg');
  const annKey = await storage.saveFile(`inspections/${id}/annotated.jpg`, unifiedAnnotatedBuffer, 'image/jpeg');
  const crackAnnKey =
    params.mode === 'combined' && crackAnnotatedBuffer
      ? await storage.saveFile(`inspections/${id}/annotated_cracks.jpg`, crackAnnotatedBuffer, 'image/jpeg')
      : params.mode === 'cracks'
        ? annKey
        : null;
  const helmetAnnKey =
    params.mode === 'combined' && helmetAnnotatedBuffer
      ? await storage.saveFile(`inspections/${id}/annotated_helmets.jpg`, helmetAnnotatedBuffer, 'image/jpeg')
      : params.mode === 'helmets'
        ? annKey
        : null;

  const { status, summary } = buildSummary(params.mode, crackResults, helmetResults);
  const processingTimeMs = Date.now() - startedAt;

  const recordDraft: InspectionRecord = {
    id,
    created_at: createdAt,
    mode: params.mode,
    source_type: params.sourceType ?? 'upload',
    site_name: settings.site_name,
    zone_label: params.zoneLabelOverride?.trim() || settings.zone_label,
    inspector_name: settings.inspector_name,
    status,
    image_width: normalized.width,
    image_height: normalized.height,
    original_image_key: origKey,
    annotated_image_key: annKey,
    crack_annotated_key: crackAnnKey,
    helmet_annotated_key: helmetAnnKey,
    pdf_report_key: `inspections/${id}/report.pdf`,
    inference_engine: `Gemini Vision (${crackResults?.model_used || helmetResults?.model_used || GEMINI_VISION_MODEL})`,
    processing_time_ms: processingTimeMs,
    crack_results: crackResults,
    helmet_results: helmetResults,
    summary,
    telemetry_json: params.telemetry ?? null,
  };

  // Generate and store automated PDF inspection report
  const pdfBuffer = await generateInspectionPdf({
    record: recordDraft,
    originalImageBuffer: normalized.buffer,
    crackAnnotatedBuffer,
    helmetAnnotatedBuffer,
  });
  await storage.saveFile(recordDraft.pdf_report_key, pdfBuffer, 'application/pdf');

  return insertInspection(recordDraft);
}

async function tryExternalPythonBackend(
  baseUrl: string,
  params: {
    mode: InspectionMode;
    rawImageBuffer: Buffer;
    sourceType?: SourceType;
    zoneLabelOverride?: string;
  },
): Promise<InspectionRecord | null> {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const form = new FormData();
  const blob = new Blob([new Uint8Array(params.rawImageBuffer)], { type: 'image/jpeg' });
  form.append('file', blob, 'frame.jpg');
  if (params.sourceType) form.append('source_type', params.sourceType);
  if (params.zoneLabelOverride) form.append('zone_label', params.zoneLabelOverride);

  const response = await fetch(`${cleanBase}/api/inspect/${params.mode}`, {
    method: 'POST',
    body: form,
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errText}`);
  }
  const record = await response.json() as InspectionRecord;
  return record;
}

/**
 * Lightweight live-frame analysis for continuous camera monitoring.
 * Runs AI inference without creating duplicate database rows or PDFs on every frame.
 */
export async function analyzeLiveFrame(params: {
  mode: InspectionMode;
  rawImageBuffer: Buffer;
}): Promise<LiveFrameResult> {
  const startedAt = Date.now();
  const settings = getSettings();
  const normalized = await normalizeInputImage(params.rawImageBuffer);

  let crackResults: CrackInspectionResult | null = null;
  let helmetResults: HelmetInspectionResult | null = null;

  if (params.mode === 'cracks') {
    crackResults = await detectStructuralCracks({
      imageBuffer: normalized.buffer,
      mimeType: normalized.mimeType,
      imageWidth: normalized.width,
      imageHeight: normalized.height,
      confidenceThreshold: settings.crack_confidence_threshold,
      allowDeepHairlinePass: false,
      thinkingMode: 'medium',
    });
  } else if (params.mode === 'helmets') {
    helmetResults = await detectWorkerHelmets({
      imageBuffer: normalized.buffer,
      mimeType: normalized.mimeType,
      imageWidth: normalized.width,
      imageHeight: normalized.height,
      confidenceThreshold: settings.helmet_confidence_threshold,
    });
  } else {
    const combined = await runCombinedDetectorsResilient({
      imageBuffer: normalized.buffer,
      mimeType: normalized.mimeType,
      imageWidth: normalized.width,
      imageHeight: normalized.height,
      crackThreshold: settings.crack_confidence_threshold,
      helmetThreshold: settings.helmet_confidence_threshold,
      allowDeepHairlinePass: false,
    });
    crackResults = combined.crackResults;
    helmetResults = combined.helmetResults;
  }

  const { status, summary } = buildSummary(params.mode, crackResults, helmetResults);

  return {
    timestamp: new Date().toISOString(),
    mode: params.mode,
    status,
    image_width: normalized.width,
    image_height: normalized.height,
    inference_engine: `Gemini Vision (${crackResults?.model_used || helmetResults?.model_used || GEMINI_VISION_MODEL})`,
    processing_time_ms: Date.now() - startedAt,
    crack_results: crackResults,
    helmet_results: helmetResults,
    summary,
  };
}

/**
 * Persists a completed live-inspection snapshot and generates its PDF report
 * when the user manually saves or ends a live monitoring session.
 */
export async function saveLiveInspectionSnapshot(params: {
  mode: InspectionMode;
  rawImageBuffer: Buffer;
  crackResults: CrackInspectionResult | null;
  helmetResults: HelmetInspectionResult | null;
  processingTimeMs?: number;
  sourceType?: SourceType;
  zoneLabelOverride?: string;
}): Promise<InspectionRecord> {
  const settings = getSettings();
  const storage = getStorageProvider();
  const normalized = await normalizeInputImage(params.rawImageBuffer);

  const id = `INSP-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const createdAt = new Date().toISOString();

  const crackResults = params.crackResults;
  const helmetResults = params.helmetResults;

  const unifiedAnnotatedBuffer = await renderAnnotatedImage({
    baseImageBuffer: normalized.buffer,
    width: normalized.width,
    height: normalized.height,
    cracks: crackResults?.detections ?? [],
    helmets: helmetResults?.detections ?? [],
  });

  let crackAnnotatedBuffer: Buffer | null = null;
  let helmetAnnotatedBuffer: Buffer | null = null;

  if (params.mode === 'combined') {
    crackAnnotatedBuffer = await renderAnnotatedImage({
      baseImageBuffer: normalized.buffer,
      width: normalized.width,
      height: normalized.height,
      cracks: crackResults?.detections ?? [],
      helmets: [],
    });
    helmetAnnotatedBuffer = await renderAnnotatedImage({
      baseImageBuffer: normalized.buffer,
      width: normalized.width,
      height: normalized.height,
      cracks: [],
      helmets: helmetResults?.detections ?? [],
    });
  } else if (params.mode === 'cracks') {
    crackAnnotatedBuffer = unifiedAnnotatedBuffer;
  } else {
    helmetAnnotatedBuffer = unifiedAnnotatedBuffer;
  }

  const origKey = await storage.saveFile(`inspections/${id}/original.jpg`, normalized.buffer, 'image/jpeg');
  const annKey = await storage.saveFile(`inspections/${id}/annotated.jpg`, unifiedAnnotatedBuffer, 'image/jpeg');
  const crackAnnKey =
    params.mode === 'combined' && crackAnnotatedBuffer
      ? await storage.saveFile(`inspections/${id}/annotated_cracks.jpg`, crackAnnotatedBuffer, 'image/jpeg')
      : params.mode === 'cracks'
        ? annKey
        : null;
  const helmetAnnKey =
    params.mode === 'combined' && helmetAnnotatedBuffer
      ? await storage.saveFile(`inspections/${id}/annotated_helmets.jpg`, helmetAnnotatedBuffer, 'image/jpeg')
      : params.mode === 'helmets'
        ? annKey
        : null;

  const { status, summary } = buildSummary(params.mode, crackResults, helmetResults);

  const recordDraft: InspectionRecord = {
    id,
    created_at: createdAt,
    mode: params.mode,
    source_type: params.sourceType ?? 'webcam',
    site_name: settings.site_name,
    zone_label: params.zoneLabelOverride?.trim() || settings.zone_label,
    inspector_name: settings.inspector_name,
    status,
    image_width: normalized.width,
    image_height: normalized.height,
    original_image_key: origKey,
    annotated_image_key: annKey,
    crack_annotated_key: crackAnnKey,
    helmet_annotated_key: helmetAnnKey,
    pdf_report_key: `inspections/${id}/report.pdf`,
    inference_engine: `Gemini Vision (${crackResults?.model_used || helmetResults?.model_used || GEMINI_VISION_MODEL})`,
    processing_time_ms: params.processingTimeMs ?? 0,
    crack_results: crackResults,
    helmet_results: helmetResults,
    summary,
    telemetry_json: null,
  };

  const pdfBuffer = await generateInspectionPdf({
    record: recordDraft,
    originalImageBuffer: normalized.buffer,
    crackAnnotatedBuffer,
    helmetAnnotatedBuffer,
  });
  await storage.saveFile(recordDraft.pdf_report_key, pdfBuffer, 'application/pdf');

  return insertInspection(recordDraft);
}
