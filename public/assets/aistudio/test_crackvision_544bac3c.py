"""Automated tests for CrackVision AI.

Tests image validation, loading, preprocessing, detection pipeline,
and result output consistency.
"""

from pathlib import Path
import unittest
import numpy as np
import cv2

from image_processor import ImageProcessor, ImageProcessingError
from crack_detector import (
    BaselineMorphologicalCrackDetector,
    DetectionResult,
)


class TestImageProcessor(unittest.TestCase):
    """Tests for the ImageProcessor module."""

    def setUp(self):
        self.sample_dir = Path(__file__).resolve().parent / "sample_images"
        self.test_img_path = self.sample_dir / "concrete_cracked_wall.jpg"

    def test_validate_nonexistent_file_raises_error(self):
        fake_path = Path("this_file_does_not_exist_98765.jpg")
        with self.assertRaises(ImageProcessingError):
            ImageProcessor.validate_image_path(fake_path)

    def test_validate_unsupported_extension_raises_error(self):
        text_path = Path(__file__).resolve().parent / "requirements.txt"
        with self.assertRaises(ImageProcessingError):
            ImageProcessor.validate_image_path(text_path)

    def test_load_valid_image(self):
        if not self.test_img_path.exists():
            self.skipTest("Sample image not yet generated.")
        img = ImageProcessor.load_image(self.test_img_path)
        self.assertIsInstance(img, np.ndarray)
        self.assertEqual(len(img.shape), 3)  # BGR 3 channels
        self.assertEqual(img.shape[2], 3)

    def test_to_grayscale(self):
        fake_color = np.zeros((100, 100, 3), dtype=np.uint8)
        gray = ImageProcessor.to_grayscale(fake_color)
        self.assertEqual(len(gray.shape), 2)
        self.assertEqual(gray.shape, (100, 100))

    def test_preprocess_clahe_and_bilateral(self):
        fake_gray = np.random.randint(50, 200, (100, 100), dtype=np.uint8)
        preprocessed = ImageProcessor.preprocess_for_crack_detection(fake_gray)
        self.assertEqual(preprocessed.shape, (100, 100))
        self.assertEqual(preprocessed.dtype, np.uint8)


class TestCrackDetector(unittest.TestCase):
    """Tests for the BaselineMorphologicalCrackDetector module."""

    def setUp(self):
        self.detector = BaselineMorphologicalCrackDetector(sensitivity="medium")
        self.sample_dir = Path(__file__).resolve().parent / "sample_images"

    def test_detection_result_structure(self):
        fake_image = np.full((120, 120, 3), 180, dtype=np.uint8)
        # Draw a synthetic dark line to simulate a crack
        cv2.line(fake_image, (20, 20), (100, 100), (20, 20, 20), 3)

        result = self.detector.detect(fake_image)

        self.assertIsInstance(result, DetectionResult)
        self.assertFalse(result.is_deep_learning)
        self.assertIsNone(result.confidence_score)
        self.assertIn("Baseline Computer Vision", result.method_name)
        self.assertIsInstance(result.annotated_image, np.ndarray)
        self.assertEqual(result.annotated_image.shape, fake_image.shape)
        self.assertGreaterEqual(result.candidate_contour_count, 0)
        self.assertGreater(result.processing_time_seconds, 0)

    def test_detection_on_solid_image_returns_zero_candidates(self):
        # A completely flat, uniform concrete slab should yield zero crack candidates
        flat_image = np.full((100, 100, 3), 160, dtype=np.uint8)
        detector_strict = BaselineMorphologicalCrackDetector(sensitivity="low")
        result = detector_strict.detect(flat_image)
        self.assertEqual(result.candidate_contour_count, 0)
        self.assertEqual(result.total_crack_pixels, 0)

    def test_original_image_remains_unmodified(self):
        original = np.full((100, 100, 3), 150, dtype=np.uint8)
        cv2.line(original, (10, 10), (90, 90), (30, 30, 30), 2)
        clone = original.copy()

        _ = self.detector.detect(original)

        # Ensure in-place modification did NOT occur
        self.assertTrue(np.array_equal(original, clone), "Original image was modified in-place!")


class TestCameraModule(unittest.TestCase):
    """Tests for the camera module and LiveInspectionSession utilities."""

    def setUp(self):
        from camera import LiveInspectionSession, CameraError
        self.detector = BaselineMorphologicalCrackDetector(sensitivity="medium")
        self.output_dir = Path(__file__).resolve().parent / "outputs" / "test_run"
        self.session = LiveInspectionSession(
            detector=self.detector,
            output_dir=self.output_dir,
            camera_index=0
        )

    def tearDown(self):
        # Clean up any test snapshot files created during test
        if self.output_dir.exists():
            for f in self.output_dir.glob("snapshot_*.*"):
                try:
                    f.unlink()
                except OSError:
                    pass

    def test_snapshot_saving(self):
        fake_raw = np.full((120, 160, 3), 150, dtype=np.uint8)
        fake_annotated = fake_raw.copy()
        cv2.putText(fake_annotated, "TEST", (20, 60), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)

        raw_path, ann_path = self.session._save_snapshot(fake_raw, fake_annotated)

        self.assertTrue(raw_path.exists())
        self.assertTrue(ann_path.exists())
        self.assertIn("raw", raw_path.name)
        self.assertIn("detected", ann_path.name)

    def test_hud_overlay_dimensions(self):
        fake_frame = np.full((240, 320, 3), 120, dtype=np.uint8)
        result = self.detector.detect(fake_frame)
        hud_frame = self.session._draw_hud(fake_frame, fps=28.5, result=result)

        self.assertEqual(hud_frame.shape, fake_frame.shape)
        self.assertEqual(hud_frame.dtype, np.uint8)

    def test_invalid_camera_index_raises_error(self):
        from camera import LiveInspectionSession, CameraError
        # Test that an invalid webcam index (e.g. 9999) raises CameraError
        bad_session = LiveInspectionSession(
            detector=self.detector,
            output_dir=self.output_dir,
            camera_index=9999
        )
        with self.assertRaises(CameraError):
            bad_session._open_camera()


if __name__ == "__main__":
    unittest.main()

