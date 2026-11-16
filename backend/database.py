"""SQLite Persistent Database Module for Construction Vision Python Backend."""

import json
import os
from pathlib import Path
import sqlite3
from typing import Any, Dict, List, Optional


DEFAULT_DB_PATH = Path(os.environ.get("DB_PATH", "data/construction_vision.db"))


def get_connection(db_path: Path = DEFAULT_DB_PATH) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db(db_path: Path = DEFAULT_DB_PATH) -> None:
    conn = get_connection(db_path)
    try:
        conn.executescript(
            """
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
            """
        )
        conn.commit()
    finally:
        conn.close()


def insert_inspection(record: Dict[str, Any], db_path: Path = DEFAULT_DB_PATH) -> Dict[str, Any]:
    conn = get_connection(db_path)
    try:
        crack = record.get("crack_results") or {}
        helmet = record.get("helmet_results") or {}
        conn.execute(
            """
            INSERT INTO inspections (
                id, created_at, mode, source_type, site_name, zone_label, inspector_name,
                status, image_width, image_height, original_image_key, annotated_image_key,
                crack_annotated_key, helmet_annotated_key, pdf_report_key, inference_engine,
                processing_time_ms, crack_count, crack_severity, worker_count,
                helmets_detected, no_helmets_detected, uncertain_count, compliance_percent,
                crack_results_json, helmet_results_json, summary_json, telemetry_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                record["id"],
                record["created_at"],
                record["mode"],
                record["source_type"],
                record["site_name"],
                record["zone_label"],
                record["inspector_name"],
                record["status"],
                record["image_width"],
                record["image_height"],
                record["original_image_key"],
                record["annotated_image_key"],
                record.get("crack_annotated_key"),
                record.get("helmet_annotated_key"),
                record["pdf_report_key"],
                record["inference_engine"],
                record["processing_time_ms"],
                crack.get("total_cracks", 0),
                crack.get("estimated_overall_severity", "None"),
                helmet.get("total_workers", 0),
                helmet.get("workers_wearing_helmet", 0),
                helmet.get("workers_without_helmet", 0),
                helmet.get("uncertain_detections", 0),
                helmet.get("helmet_compliance_percent"),
                json.dumps(record["crack_results"]) if record.get("crack_results") else None,
                json.dumps(record["helmet_results"]) if record.get("helmet_results") else None,
                json.dumps(record["summary"]),
                json.dumps(record["telemetry_json"]) if record.get("telemetry_json") else None,
            ),
        )
        conn.commit()
        return record
    finally:
        conn.close()


def _hydrate_row(row: sqlite3.Row) -> Dict[str, Any]:
    return {
        "id": row["id"],
        "created_at": row["created_at"],
        "mode": row["mode"],
        "source_type": row["source_type"],
        "site_name": row["site_name"],
        "zone_label": row["zone_label"],
        "inspector_name": row["inspector_name"],
        "status": row["status"],
        "image_width": row["image_width"],
        "image_height": row["image_height"],
        "original_image_key": row["original_image_key"],
        "annotated_image_key": row["annotated_image_key"],
        "crack_annotated_key": row["crack_annotated_key"],
        "helmet_annotated_key": row["helmet_annotated_key"],
        "pdf_report_key": row["pdf_report_key"],
        "inference_engine": row["inference_engine"],
        "processing_time_ms": row["processing_time_ms"],
        "crack_results": json.loads(row["crack_results_json"]) if row["crack_results_json"] else None,
        "helmet_results": json.loads(row["helmet_results_json"]) if row["helmet_results_json"] else None,
        "summary": json.loads(row["summary_json"]),
        "telemetry_json": json.loads(row["telemetry_json"]) if row["telemetry_json"] else None,
    }


def list_inspections(limit: int = 200, db_path: Path = DEFAULT_DB_PATH) -> List[Dict[str, Any]]:
    conn = get_connection(db_path)
    try:
        rows = conn.execute(
            "SELECT * FROM inspections ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()
        return [_hydrate_row(r) for r in rows]
    finally:
        conn.close()


def get_inspection_by_id(inspection_id: str, db_path: Path = DEFAULT_DB_PATH) -> Optional[Dict[str, Any]]:
    conn = get_connection(db_path)
    try:
        row = conn.execute("SELECT * FROM inspections WHERE id = ?", (inspection_id,)).fetchone()
        return _hydrate_row(row) if row else None
    finally:
        conn.close()
