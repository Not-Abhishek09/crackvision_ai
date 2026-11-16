"""Automated PDF Report Generator (ReportLab) for Construction Vision Python Backend."""

from pathlib import Path
from typing import Any, Dict, Optional
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.platypus import Image as RLImage, Paragraph, SimpleDocTemplate, Spacer


def generate_pdf_report(
    record: Dict[str, Any],
    output_pdf_path: Path,
    original_image_path: Path,
    crack_annotated_path: Optional[Path] = None,
    helmet_annotated_path: Optional[Path] = None,
) -> Path:
    output_pdf_path.parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(str(output_pdf_path), pagesize=A4, leftMargin=36, rightMargin=36, topMargin=36, bottomMargin=36)
    styles = getSampleStyleSheet()
    h1 = ParagraphStyle("CVH1", parent=styles["Heading1"], fontSize=15, textColor=colors.HexColor("#111827"))
    h2 = ParagraphStyle("CVH2", parent=styles["Heading2"], fontSize=11, textColor=colors.HexColor("#B45309"))
    body = ParagraphStyle("CVBody", parent=styles["Normal"], fontSize=9, leading=13)

    story = [
        Paragraph("CONSTRUCTION VISION — INSPECTION REPORT", h1),
        Spacer(1, 8),
        Paragraph("1. GENERAL INFORMATION", h2),
        Paragraph(f"<b>Inspection ID:</b> {record['id']}", body),
        Paragraph(f"<b>Date & Time:</b> {record['created_at']}", body),
        Paragraph(f"<b>Inspection Type:</b> {record['mode'].upper()}", body),
        Paragraph(f"<b>Site / Zone:</b> {record['site_name']} — {record['zone_label']}", body),
        Paragraph(f"<b>Inspector:</b> {record['inspector_name']}", body),
        Paragraph(f"<b>Status:</b> {record['status']}", body),
        Spacer(1, 6),
        Paragraph("<b>Original Inspection Image:</b>", body),
        RLImage(str(original_image_path), width=420, height=230, kind="proportional"),
        Spacer(1, 10),
    ]

    crack = record.get("crack_results")
    if crack:
        story.append(Paragraph("2. STRUCTURAL INSPECTION", h2))
        story.append(Paragraph(f"<b>Total Cracks Detected:</b> {crack['total_cracks']}", body))
        story.append(Paragraph(f"<b>Estimated Overall Severity:</b> {crack['estimated_overall_severity']} (AI estimate)", body))
        for det in crack.get("detections", []):
            conf_str = f"{det['model_reported_confidence'] * 100:.1f}%" if det.get("model_reported_confidence") is not None else "Heuristic CV"
            story.append(
                Paragraph(
                    f"• {det['id']} | {det['classification']} | Severity: {det['severity']} | Conf: {conf_str} | {det['location_description']}",
                    body,
                )
            )
        if crack_annotated_path and crack_annotated_path.exists():
            story.append(Spacer(1, 6))
            story.append(RLImage(str(crack_annotated_path), width=420, height=230, kind="proportional"))
        story.append(Spacer(1, 10))

    helmet = record.get("helmet_results")
    if helmet:
        story.append(Paragraph("3. WORKER SAFETY INSPECTION", h2))
        comp = f"{helmet['helmet_compliance_percent']:.1f}%" if helmet.get("helmet_compliance_percent") is not None else "N/A"
        story.append(Paragraph(f"<b>Total Workers Detected:</b> {helmet['total_workers']}", body))
        story.append(Paragraph(f"<b>Workers Wearing Helmets:</b> {helmet['workers_wearing_helmet']}", body))
        story.append(Paragraph(f"<b>Workers Without Helmets:</b> {helmet['workers_without_helmet']}", body))
        story.append(Paragraph(f"<b>Uncertain Detections:</b> {helmet['uncertain_detections']}", body))
        story.append(Paragraph(f"<b>Helmet Compliance:</b> {comp}", body))
        for v in helmet.get("violations", []):
            story.append(Paragraph(f"• VIOLATION: {v}", body))
        if helmet_annotated_path and helmet_annotated_path.exists():
            story.append(Spacer(1, 6))
            story.append(RLImage(str(helmet_annotated_path), width=420, height=230, kind="proportional"))
        story.append(Spacer(1, 10))

    summary = record["summary"]
    story.append(Paragraph("4. FINAL SUMMARY", h2))
    for key, label in [
        ("structural_findings", "Structural Findings"),
        ("worker_safety_findings", "Worker Safety Findings"),
        ("potential_hazards", "Potential Hazards"),
        ("recommended_actions", "Recommended Corrective Actions"),
        ("manual_verification_warnings", "Manual Verification Warnings"),
    ]:
        items = summary.get(key, [])
        if items:
            story.append(Paragraph(f"<b>{label}:</b>", body))
            for item in items:
                story.append(Paragraph(f"• {item}", body))

    doc.build(story)
    return output_pdf_path
