"""Camera Module for Construction Vision CLI (preserved from CrackVision AI)."""

from datetime import datetime
from pathlib import Path
import sys
import time
from typing import Optional, Tuple
import cv2
import numpy as np

from crack_detection import BaseCrackDetector, DetectionResult
from image_processor import ImageProcessor

WINDOW_TITLE = "Construction Vision | Live CLI Inspection"


class CameraError(Exception):
    pass


class LiveInspectionSession:
    def __init__(self, detector: BaseCrackDetector, output_dir: Path, camera_index: int = 0, target_fps: int = 30):
        self.detector = detector
        self.output_dir = output_dir
        self.camera_index = camera_index
        self.target_fps = target_fps
        self.is_paused = False
        self.show_raw_feed = False
        self.clear_detection = False
        self.snapshot_notification: Optional[Tuple[str, float]] = None
        self.fps_rolling = 0.0
        self.last_result: Optional[DetectionResult] = None
        self.last_raw_frame: Optional[np.ndarray] = None

    def _open_camera(self) -> cv2.VideoCapture:
        cap = cv2.VideoCapture(self.camera_index, cv2.CAP_DSHOW) if sys.platform.startswith("win") else cv2.VideoCapture(self.camera_index)
        if not cap.isOpened():
            raise CameraError(f"Could not open webcam at index {self.camera_index}.")
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
        return cap

    def _save_snapshot(self, raw_frame: np.ndarray, annotated_frame: np.ndarray) -> Tuple[Path, Path]:
        self.output_dir.mkdir(parents=True, exist_ok=True)
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        raw_path = self.output_dir / f"snapshot_{ts}_raw.jpg"
        ann_path = self.output_dir / f"snapshot_{ts}_detected.jpg"
        ImageProcessor.save_image(raw_frame, raw_path)
        ImageProcessor.save_image(annotated_frame, ann_path)
        self.snapshot_notification = (f"SAVED: {ann_path.name}", time.time() + 2.5)
        return raw_path, ann_path

    def run(self) -> None:
        cap = self._open_camera()
        prev_time = time.perf_counter()
        try:
            cv2.namedWindow(WINDOW_TITLE, cv2.WINDOW_AUTOSIZE)
            while True:
                now = time.perf_counter()
                if not self.is_paused or self.last_raw_frame is None:
                    ret, frame = cap.read()
                    if not ret or frame is None:
                        break
                    self.last_raw_frame = frame.copy()
                    self.last_result = None if self.clear_detection else self.detector.detect(self.last_raw_frame)
                display = (
                    self.last_raw_frame.copy()
                    if (self.show_raw_feed or self.clear_detection or self.last_result is None)
                    else self.last_result.annotated_image.copy()
                )
                dt = now - prev_time
                prev_time = now
                if dt > 0:
                    self.fps_rolling = 0.15 * (1.0 / dt) + 0.85 * self.fps_rolling
                cv2.imshow(WINDOW_TITLE, display)
                key = cv2.waitKey(1) & 0xFF
                if key in (ord("q"), ord("Q"), 27):
                    break
                elif key in (ord("s"), ord("S")) and self.last_raw_frame is not None:
                    clean = self.last_result.annotated_image if self.last_result else self.last_raw_frame.copy()
                    self._save_snapshot(self.last_raw_frame, clean)
                elif key in (ord("p"), ord("P")):
                    self.is_paused = not self.is_paused
                elif key in (ord("r"), ord("R")):
                    self.clear_detection = not self.clear_detection
                elif key in (ord("i"), ord("I")):
                    self.show_raw_feed = not self.show_raw_feed
        finally:
            cap.release()
            cv2.destroyAllWindows()
