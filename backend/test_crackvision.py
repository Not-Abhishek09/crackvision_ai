"""Automated unit tests for Construction Vision Python crack & database modules."""

from pathlib import Path
import tempfile
import unittest
import cv2
import numpy as np

from crack_detection import BaselineMorphologicalCrackDetector, DetectionResult
from database import get_inspection_by_id, init_db, insert_inspection
from image_processor import ImageProcessingError, ImageProcessor


class TestConstructionVisionBackend(unittest.TestCase):
    def test_validate_nonexistent_file_raises_error(self):
        with self.assertRaises(ImageProcessingError):
            ImageProcessor.validate_image_path(Path("nonexistent_999.jpg"))

    def test_crack_detection_preserves_original(self):
        detector = BaselineMorphologicalCrackDetector(sensitivity="medium")
        original = np.full((120, 120, 3), 180, dtype=np.uint8)
        cv2.line(original, (15, 15), (105, 105), (25, 25, 25), 3)
        clone = original.copy()

        result = detector.detect(original)
        self.assertIsInstance(result, DetectionResult)
        self.assertTrue(np.array_equal(original, clone))
        self.assertGreater(result.candidate_contour_count, 0)

    def test_sqlite_persistence(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_file = Path(tmp) / "test.db"
            init_db(db_file)
            record = {
                "id": "INSP-TEST-001",
                "created_at": "2026-11-16T12:00:00Z",
                "mode": "combined",
                "source_type": "upload",
                "site_name": "Test Site",
                "zone_label": "Zone 1",
                "inspector_name": "Engineer",
                "status": "Attention Required",
                "image_width": 640,
                "image_height": 480,
                "original_image_key": "orig.jpg",
                "annotated_image_key": "ann.jpg",
                "pdf_report_key": "rep.pdf",
                "inference_engine": "Test",
                "processing_time_ms": 120,
                "crack_results": {"total_cracks": 1, "estimated_overall_severity": "Medium"},
                "helmet_results": {"total_workers": 2, "workers_wearing_helmet": 2, "workers_without_helmet": 0, "uncertain_detections": 0, "helmet_compliance_percent": 100.0},
                "summary": {"structural_findings": [], "worker_safety_findings": [], "potential_hazards": [], "recommended_actions": [], "manual_verification_warnings": []},
            }
            insert_inspection(record, db_file)
            loaded = get_inspection_by_id("INSP-TEST-001", db_file)
            self.assertIsNotNone(loaded)
            self.assertEqual(loaded["helmet_results"]["helmet_compliance_percent"], 100.0)


if __name__ == "__main__":
    unittest.main()
