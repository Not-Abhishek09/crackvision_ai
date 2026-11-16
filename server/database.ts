import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type {
  CrackInspectionResult,
  DashboardMetrics,
  HelmetInspectionResult,
  InspectionMode,
  InspectionRecord,
  InspectionStatus,
  InspectionSummary,
  SiteSettings,
  SourceType,
} from './types.ts';

interface RawInspectionRow {
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
  crack_count: number;
  crack_severity: string;
  worker_count: number;
  helmets_detected: number;
  no_helmets_detected: number;
  uncertain_count: number;
  compliance_percent: number | null;
  crack_results_json: string | null;
  helmet_results_json: string | null;
  summary_json: string;
  telemetry_json: string | null;
}

let dbInstance: Database.Database | null = null;

export function getDbPath(): string {
  if (process.env.DB_PATH) {
    return path.resolve(process.env.DB_PATH);
  }
  if (process.env.VERCEL) {
    return path.join('/tmp', 'construction_vision.db');
  }
  return path.resolve(path.join(process.cwd(), 'data', 'construction_vision.db'));
}

export function getDb(): Database.Database {
  if (dbInstance) return dbInstance;

  const dbPath = getDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS inspections (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      mode TEXT NOT NULL,
      source_type TEXT NOT NULL,
      site_name TEXT NOT NULL,
      zone_label TEXT NOT NULL,
      inspector_name TEXT NOT NULL,
      status TEXT NOT NULL,
      image_width INTEGER NOT NULL,
      image_height INTEGER NOT NULL,
      original_image_key TEXT NOT NULL,
      annotated_image_key TEXT NOT NULL,
      crack_annotated_key TEXT,
      helmet_annotated_key TEXT,
      pdf_report_key TEXT NOT NULL,
      inference_engine TEXT NOT NULL,
      processing_time_ms INTEGER NOT NULL,
      crack_count INTEGER NOT NULL DEFAULT 0,
      crack_severity TEXT NOT NULL DEFAULT 'None',
      worker_count INTEGER NOT NULL DEFAULT 0,
      helmets_detected INTEGER NOT NULL DEFAULT 0,
      no_helmets_detected INTEGER NOT NULL DEFAULT 0,
      uncertain_count INTEGER NOT NULL DEFAULT 0,
      compliance_percent REAL,
      crack_results_json TEXT,
      helmet_results_json TEXT,
      summary_json TEXT NOT NULL,
      telemetry_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_inspections_created_at ON inspections(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_inspections_mode ON inspections(mode);

    CREATE TABLE IF NOT EXISTS site_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      site_name TEXT NOT NULL,
      zone_label TEXT NOT NULL,
      inspector_name TEXT NOT NULL,
      crack_confidence_threshold REAL NOT NULL,
      helmet_confidence_threshold REAL NOT NULL,
      auto_scan_interval_sec INTEGER NOT NULL,
      python_backend_url TEXT NOT NULL DEFAULT ''
    );
  `);

  const existingSettings = db.prepare('SELECT id FROM site_settings WHERE id = 1').get();
  if (!existingSettings) {
    db.prepare(`
      INSERT INTO site_settings (
        id, site_name, zone_label, inspector_name,
        crack_confidence_threshold, helmet_confidence_threshold,
        auto_scan_interval_sec, python_backend_url
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'North Sector Structural Site',
      'Zone A - Primary Deck',
      'Site Safety Engineer',
      0.35,
      0.40,
      3,
      process.env.PYTHON_BACKEND_URL || '',
    );
  }

  dbInstance = db;
  return db;
}

function hydrateRow(row: RawInspectionRow): InspectionRecord {
  return {
    id: row.id,
    created_at: row.created_at,
    mode: row.mode,
    source_type: row.source_type,
    site_name: row.site_name,
    zone_label: row.zone_label,
    inspector_name: row.inspector_name,
    status: row.status,
    image_width: row.image_width,
    image_height: row.image_height,
    original_image_key: row.original_image_key,
    annotated_image_key: row.annotated_image_key,
    crack_annotated_key: row.crack_annotated_key,
    helmet_annotated_key: row.helmet_annotated_key,
    pdf_report_key: row.pdf_report_key,
    inference_engine: row.inference_engine,
    processing_time_ms: row.processing_time_ms,
    crack_results: row.crack_results_json ? (JSON.parse(row.crack_results_json) as CrackInspectionResult) : null,
    helmet_results: row.helmet_results_json ? (JSON.parse(row.helmet_results_json) as HelmetInspectionResult) : null,
    summary: JSON.parse(row.summary_json) as InspectionSummary,
    telemetry_json: row.telemetry_json ? (JSON.parse(row.telemetry_json) as Record<string, unknown>) : null,
  };
}

export function getSettings(): SiteSettings {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT site_name, zone_label, inspector_name, crack_confidence_threshold,
              helmet_confidence_threshold, auto_scan_interval_sec, python_backend_url
       FROM site_settings WHERE id = 1`,
    )
    .get() as SiteSettings;
  return row;
}

export function updateSettings(updates: Partial<SiteSettings>): SiteSettings {
  const db = getDb();
  const current = getSettings();
  const next: SiteSettings = {
    site_name: (updates.site_name ?? current.site_name).trim() || current.site_name,
    zone_label: (updates.zone_label ?? current.zone_label).trim() || current.zone_label,
    inspector_name: (updates.inspector_name ?? current.inspector_name).trim() || current.inspector_name,
    crack_confidence_threshold: clampFloat(
      updates.crack_confidence_threshold ?? current.crack_confidence_threshold,
      0.1,
      0.95,
    ),
    helmet_confidence_threshold: clampFloat(
      updates.helmet_confidence_threshold ?? current.helmet_confidence_threshold,
      0.1,
      0.95,
    ),
    auto_scan_interval_sec: Math.max(1, Math.min(60, Math.round(updates.auto_scan_interval_sec ?? current.auto_scan_interval_sec))),
    python_backend_url: (updates.python_backend_url ?? current.python_backend_url).trim(),
  };

  db.prepare(`
    UPDATE site_settings
    SET site_name = ?, zone_label = ?, inspector_name = ?,
        crack_confidence_threshold = ?, helmet_confidence_threshold = ?,
        auto_scan_interval_sec = ?, python_backend_url = ?
    WHERE id = 1
  `).run(
    next.site_name,
    next.zone_label,
    next.inspector_name,
    next.crack_confidence_threshold,
    next.helmet_confidence_threshold,
    next.auto_scan_interval_sec,
    next.python_backend_url,
  );

  return next;
}

export function insertInspection(record: InspectionRecord): InspectionRecord {
  const db = getDb();
  db.prepare(`
    INSERT INTO inspections (
      id, created_at, mode, source_type, site_name, zone_label, inspector_name,
      status, image_width, image_height, original_image_key, annotated_image_key,
      crack_annotated_key, helmet_annotated_key, pdf_report_key, inference_engine,
      processing_time_ms, crack_count, crack_severity, worker_count,
      helmets_detected, no_helmets_detected, uncertain_count, compliance_percent,
      crack_results_json, helmet_results_json, summary_json, telemetry_json
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?
    )
  `).run(
    record.id,
    record.created_at,
    record.mode,
    record.source_type,
    record.site_name,
    record.zone_label,
    record.inspector_name,
    record.status,
    record.image_width,
    record.image_height,
    record.original_image_key,
    record.annotated_image_key,
    record.crack_annotated_key,
    record.helmet_annotated_key,
    record.pdf_report_key,
    record.inference_engine,
    record.processing_time_ms,
    record.crack_results ? record.crack_results.total_cracks : 0,
    record.crack_results ? record.crack_results.estimated_overall_severity : 'None',
    record.helmet_results ? record.helmet_results.total_workers : 0,
    record.helmet_results ? record.helmet_results.workers_wearing_helmet : 0,
    record.helmet_results ? record.helmet_results.workers_without_helmet : 0,
    record.helmet_results ? record.helmet_results.uncertain_detections : 0,
    record.helmet_results ? record.helmet_results.helmet_compliance_percent : null,
    record.crack_results ? JSON.stringify(record.crack_results) : null,
    record.helmet_results ? JSON.stringify(record.helmet_results) : null,
    JSON.stringify(record.summary),
    record.telemetry_json ? JSON.stringify(record.telemetry_json) : null,
  );
  return record;
}

export function listInspections(filters?: {
  search?: string;
  mode?: string;
  status?: string;
  limit?: number;
}): InspectionRecord[] {
  const db = getDb();
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  if (filters?.mode && filters.mode !== 'all') {
    clauses.push('mode = ?');
    params.push(filters.mode);
  }
  if (filters?.status && filters.status !== 'all') {
    clauses.push('status = ?');
    params.push(filters.status);
  }
  if (filters?.search && filters.search.trim()) {
    const term = `%${filters.search.trim()}%`;
    clauses.push('(id LIKE ? OR site_name LIKE ? OR zone_label LIKE ? OR inspector_name LIKE ?)');
    params.push(term, term, term, term);
  }

  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const limitSql = filters?.limit ? `LIMIT ${Math.max(1, Math.min(500, filters.limit))}` : 'LIMIT 200';

  const rows = db
    .prepare(`SELECT * FROM inspections ${whereSql} ORDER BY created_at DESC ${limitSql}`)
    .all(...params) as RawInspectionRow[];

  return rows.map(hydrateRow);
}

export function getInspectionById(id: string): InspectionRecord | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM inspections WHERE id = ?').get(id) as RawInspectionRow | undefined;
  return row ? hydrateRow(row) : null;
}

export function deleteInspectionById(id: string): InspectionRecord | null {
  const existing = getInspectionById(id);
  if (!existing) return null;
  const db = getDb();
  db.prepare('DELETE FROM inspections WHERE id = ?').run(id);
  return existing;
}

export function getDashboardMetrics(): DashboardMetrics {
  const db = getDb();

  const agg = db
    .prepare(`
      SELECT
        COUNT(*) as total_inspections,
        COALESCE(SUM(crack_count), 0) as total_cracks_detected,
        COALESCE(SUM(worker_count), 0) as total_workers_detected,
        COALESCE(SUM(helmets_detected), 0) as total_workers_with_helmet,
        COALESCE(SUM(no_helmets_detected), 0) as total_helmet_violations,
        COALESCE(SUM(uncertain_count), 0) as total_uncertain_detections,
        SUM(CASE WHEN crack_severity = 'High' THEN 1 ELSE 0 END) as sev_high,
        SUM(CASE WHEN crack_severity = 'Medium' THEN 1 ELSE 0 END) as sev_medium,
        SUM(CASE WHEN crack_severity = 'Low' THEN 1 ELSE 0 END) as sev_low,
        SUM(CASE WHEN crack_severity = 'None' THEN 1 ELSE 0 END) as sev_none
      FROM inspections
    `)
    .get() as {
    total_inspections: number;
    total_cracks_detected: number;
    total_workers_detected: number;
    total_workers_with_helmet: number;
    total_helmet_violations: number;
    total_uncertain_detections: number;
    sev_high: number | null;
    sev_medium: number | null;
    sev_low: number | null;
    sev_none: number | null;
  };

  const overallCompliance =
    agg.total_workers_detected > 0
      ? Number(((agg.total_workers_with_helmet / agg.total_workers_detected) * 100).toFixed(1))
      : null;

  const violationRows = db
    .prepare(`
      SELECT id, created_at, site_name, zone_label, no_helmets_detected, uncertain_count, compliance_percent, annotated_image_key
      FROM inspections
      WHERE no_helmets_detected > 0 OR uncertain_count > 0
      ORDER BY created_at DESC
      LIMIT 6
    `)
    .all() as Array<{
    id: string;
    created_at: string;
    site_name: string;
    zone_label: string;
    no_helmets_detected: number;
    uncertain_count: number;
    compliance_percent: number | null;
    annotated_image_key: string;
  }>;

  const recentInspections = listInspections({ limit: 8 });

  return {
    total_inspections: agg.total_inspections,
    total_cracks_detected: agg.total_cracks_detected,
    total_workers_detected: agg.total_workers_detected,
    total_workers_with_helmet: agg.total_workers_with_helmet,
    total_helmet_violations: agg.total_helmet_violations,
    total_uncertain_detections: agg.total_uncertain_detections,
    overall_helmet_compliance_percent: overallCompliance,
    severity_breakdown: {
      high: agg.sev_high || 0,
      medium: agg.sev_medium || 0,
      low: agg.sev_low || 0,
      none: agg.sev_none || 0,
    },
    recent_violations: violationRows.map((r) => ({
      inspection_id: r.id,
      created_at: r.created_at,
      site_name: r.site_name,
      zone_label: r.zone_label,
      workers_without_helmet: r.no_helmets_detected,
      uncertain_detections: r.uncertain_count,
      compliance_percent: r.compliance_percent,
      annotated_image_key: r.annotated_image_key,
    })),
    recent_inspections: recentInspections,
  };
}

function clampFloat(val: number, min: number, max: number): number {
  if (Number.isNaN(val)) return min;
  return Math.max(min, Math.min(max, Number(val.toFixed(2))));
}
