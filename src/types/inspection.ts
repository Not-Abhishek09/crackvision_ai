export type NavSection =
  | 'dashboard'
  | 'live'
  | 'cracks'
  | 'helmets'
  | 'reports'
  | 'settings';

export type InspectionMode = 'cracks' | 'helmets' | 'combined';
export type SourceType = 'upload' | 'webcam' | 'drone_feed';
export type CrackSeverity = 'None' | 'Low' | 'Medium' | 'High';
export type HelmetClassification = 'helmet_detected' | 'no_helmet' | 'uncertain';
export type InspectionStatus = 'Nominal' | 'Attention Required' | 'Safety Violation' | 'Critical Alert';

export interface PixelBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CrackDetectionItem {
  id: string;
  object_category: 'structural_crack';
  classification: string;
  severity: 'Low' | 'Medium' | 'High';
  model_reported_confidence: number;
  box_2d: [number, number, number, number];
  pixel_box: PixelBoundingBox;
  location_description: string;
}

export interface CrackInspectionResult {
  total_cracks: number;
  estimated_overall_severity: CrackSeverity;
  average_model_confidence: number | null;
  image_quality?: 'clear' | 'uncertain';
  uncertain_reason?: string | null;
  module_error?: string | null;
  detections: CrackDetectionItem[];
  notes: string;
  severity_disclaimer: string;
}

export interface HelmetDetectionItem {
  id: string;
  object_category: 'construction_worker';
  classification: HelmetClassification;
  model_reported_confidence: number;
  box_2d: [number, number, number, number];
  pixel_box: PixelBoundingBox;
  reason: string;
}

export interface HelmetInspectionResult {
  total_workers: number;
  workers_wearing_helmet: number;
  workers_without_helmet: number;
  uncertain_detections: number;
  helmet_compliance_percent: number | null;
  image_quality?: 'clear' | 'uncertain';
  uncertain_reason?: string | null;
  module_error?: string | null;
  detections: HelmetDetectionItem[];
  violations: string[];
  notes: string;
}

export interface InspectionSummary {
  structural_findings: string[];
  worker_safety_findings: string[];
  potential_hazards: string[];
  recommended_actions: string[];
  manual_verification_warnings: string[];
}

export interface InspectionRecord {
  id: string;
  created_at: string;
  mode: InspectionMode;
  source_type: SourceType;
  site_name: string;
  zone_label: string;
  inspector_name: string;
  status: InspectionStatus;
  image_width: number;
  image_height: number;
  original_image_key: string;
  annotated_image_key: string;
  crack_annotated_key: string | null;
  helmet_annotated_key: string | null;
  pdf_report_key: string;
  inference_engine: string;
  processing_time_ms: number;
  crack_results: CrackInspectionResult | null;
  helmet_results: HelmetInspectionResult | null;
  summary: InspectionSummary;
  telemetry_json: Record<string, unknown> | null;
}

export interface LiveFrameResult {
  timestamp: string;
  mode: InspectionMode;
  status: InspectionStatus;
  image_width: number;
  image_height: number;
  inference_engine: string;
  processing_time_ms: number;
  crack_results: CrackInspectionResult | null;
  helmet_results: HelmetInspectionResult | null;
  summary: InspectionSummary;
}

export interface SiteSettings {
  site_name: string;
  zone_label: string;
  inspector_name: string;
  crack_confidence_threshold: number;
  helmet_confidence_threshold: number;
  auto_scan_interval_sec: number;
  python_backend_url: string;
}

export interface DashboardMetrics {
  total_inspections: number;
  total_cracks_detected: number;
  total_workers_detected: number;
  total_workers_with_helmet: number;
  total_helmet_violations: number;
  total_uncertain_detections: number;
  overall_helmet_compliance_percent: number | null;
  severity_breakdown: {
    high: number;
    medium: number;
    low: number;
    none: number;
  };
  recent_violations: Array<{
    inspection_id: string;
    created_at: string;
    site_name: string;
    zone_label: string;
    workers_without_helmet: number;
    uncertain_detections: number;
    compliance_percent: number | null;
    annotated_image_key: string;
  }>;
  recent_inspections: InspectionRecord[];
}

export interface HealthStatus {
  status: 'ok' | 'error';
  backend: string;
  database: { connected: boolean; path: string };
  storage: { backend: string; location: string };
  ai_model: {
    provider: string;
    model: string;
    key_configured: boolean;
    available: boolean;
    error: string | null;
  };
  python_backend: {
    configured: boolean;
    reachable: boolean;
    url: string;
  };
  timestamp: string;
}

export interface SampleImageItem {
  id: string;
  label: string;
  mode: InspectionMode;
  filename: string;
  description: string;
  url: string;
}

export type CameraConnectionState = 'inactive' | 'starting' | 'active' | 'denied' | 'error';
