import type {
  DashboardMetrics,
  HealthStatus,
  InspectionMode,
  InspectionRecord,
  LiveFrameResult,
  SampleImageItem,
  SiteSettings,
  SourceType,
} from '../types/inspection';

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, '') || '';

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string; detail?: string };
      message = data.error || data.detail || message;
    } catch {
      const text = await res.text();
      if (text) message = text;
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export function getStorageUrl(key: string): string {
  return `${API_BASE}/api/storage/${key}`;
}

export function getReportDownloadUrl(inspectionId: string, inline = false): string {
  return `${API_BASE}/api/reports/${encodeURIComponent(inspectionId)}${inline ? '?inline=1' : ''}`;
}

export async function fetchHealth(): Promise<HealthStatus> {
  const res = await fetch(`${API_BASE}/api/health`);
  return parseJsonOrThrow<HealthStatus>(res);
}

export async function fetchDashboard(): Promise<DashboardMetrics> {
  const res = await fetch(`${API_BASE}/api/dashboard`);
  return parseJsonOrThrow<DashboardMetrics>(res);
}

export async function fetchInspections(filters?: {
  search?: string;
  mode?: string;
  status?: string;
}): Promise<{ items: InspectionRecord[]; total: number }> {
  const params = new URLSearchParams();
  if (filters?.search) params.set('search', filters.search);
  if (filters?.mode && filters.mode !== 'all') params.set('mode', filters.mode);
  if (filters?.status && filters.status !== 'all') params.set('status', filters.status);
  const qs = params.toString();
  const res = await fetch(`${API_BASE}/api/inspections${qs ? `?${qs}` : ''}`);
  return parseJsonOrThrow<{ items: InspectionRecord[]; total: number }>(res);
}

export async function fetchInspectionById(id: string): Promise<InspectionRecord> {
  const res = await fetch(`${API_BASE}/api/inspections/${encodeURIComponent(id)}`);
  return parseJsonOrThrow<InspectionRecord>(res);
}

export async function deleteInspection(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/inspections/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  await parseJsonOrThrow<{ deleted: boolean }>(res);
}

export async function fetchSettings(): Promise<SiteSettings> {
  const res = await fetch(`${API_BASE}/api/settings`);
  return parseJsonOrThrow<SiteSettings>(res);
}

export async function saveSettings(updates: Partial<SiteSettings>): Promise<SiteSettings> {
  const res = await fetch(`${API_BASE}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  return parseJsonOrThrow<SiteSettings>(res);
}

export async function fetchSamples(): Promise<SampleImageItem[]> {
  const res = await fetch(`${API_BASE}/api/samples`);
  const data = await parseJsonOrThrow<{ items: SampleImageItem[] }>(res);
  return data.items;
}

export async function runImageInspection(params: {
  mode: InspectionMode;
  blob: Blob;
  filename?: string;
  sourceType: SourceType;
  zoneLabel?: string;
}): Promise<InspectionRecord> {
  const form = new FormData();
  form.append('file', params.blob, params.filename || 'inspection_frame.jpg');
  form.append('sourceType', params.sourceType);
  if (params.zoneLabel) {
    form.append('zoneLabel', params.zoneLabel);
  }

  const endpoint =
    params.mode === 'cracks'
      ? '/api/inspect/cracks'
      : params.mode === 'helmets'
        ? '/api/inspect/helmets'
        : '/api/inspect/combined';

  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    body: form,
  });

  return parseJsonOrThrow<InspectionRecord>(res);
}

export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimitError';
  }
}

export async function analyzeLiveCameraFrame(params: {
  mode: InspectionMode;
  blob: Blob;
  signal?: AbortSignal;
}): Promise<LiveFrameResult> {
  const form = new FormData();
  form.append('file', params.blob, 'live_frame.jpg');
  form.append('mode', params.mode);

  const res = await fetch(`${API_BASE}/api/inspect/live-frame`, {
    method: 'POST',
    body: form,
    signal: params.signal,
  });

  if (res.status === 429) {
    let msg = 'AI rate limit reached. Increase scan interval or pause briefly.';
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) msg = data.error;
    } catch {
      // use default message
    }
    throw new RateLimitError(msg);
  }

  return parseJsonOrThrow<LiveFrameResult>(res);
}

export async function saveLiveInspection(params: {
  mode: InspectionMode;
  blob: Blob;
  liveResult: LiveFrameResult;
}): Promise<InspectionRecord> {
  const form = new FormData();
  form.append('file', params.blob, `live_snapshot_${Date.now()}.jpg`);
  form.append('mode', params.mode);
  if (params.liveResult.crack_results) {
    form.append('crack_results', JSON.stringify(params.liveResult.crack_results));
  }
  if (params.liveResult.helmet_results) {
    form.append('helmet_results', JSON.stringify(params.liveResult.helmet_results));
  }
  form.append('processing_time_ms', String(params.liveResult.processing_time_ms));

  const res = await fetch(`${API_BASE}/api/inspect/save-live`, {
    method: 'POST',
    body: form,
  });

  return parseJsonOrThrow<InspectionRecord>(res);
}
