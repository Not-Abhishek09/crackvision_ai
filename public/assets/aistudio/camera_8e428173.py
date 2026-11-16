"""Camera Module for CrackVision AI.

Handles real-time webcam video capture, interactive display window,
keyboard event handling, HUD overlays, and snapshot saving.
"""

from datetime import datetime
import os
from pathlib import Path
import sys
import time
from typing import Optional, Tuple
import cv2
import numpy as np

from crack_detector import BaseCrackDetector, DetectionResult
from image_processor import ImageProcessor


WINDOW_TITLE = "CrackVision AI | Live Inspection"


class CameraError(Exception):
    """Custom exception for camera access and stream failures."""
    pass


class LiveInspectionSession:
    """Manages the real-time webcam crack inspection loop."""

    def __init__(
        self,
        detector: BaseCrackDetector,
        output_dir: Path,
        camera_index: int = 0,
        target_fps: int = 30
    ):
        """Initializes the live camera session.

        Args:
            detector: Concrete instance of BaseCrackDetector.
            output_dir: Directory where snapshots and reports are stored.
            camera_index: Webcam device index (default 0).
            target_fps: Target frame rate limit to prevent CPU saturation.
        """
        self.detector = detector
        self.output_dir = output_dir
        self.camera_index = camera_index
        self.target_fps = target_fps

        # State management flags
        self.is_paused = False
        self.show_raw_feed = False
        self.clear_detection = False
        self.snapshot_notification: Optional[Tuple[str, float]] = None  # (message, timestamp)

        # Performance tracking
        self.fps_rolling = 0.0
        self.frame_count = 0
        self.last_result: Optional[DetectionResult] = None
        self.last_raw_frame: Optional[np.ndarray] = None
        self.last_display_frame: Optional[np.ndarray] = None

    def _open_camera(self) -> cv2.VideoCapture:
        """Attempts to open the webcam using DirectShow (Windows) or standard backend."""
        print(f"[CAMERA] Initializing webcam at index {self.camera_index}...")

        # Try DirectShow on Windows for faster initialization and lower latency
        if sys.platform.startswith("win"):
            cap = cv2.VideoCapture(self.camera_index, cv2.CAP_DSHOW)
            if not cap.isOpened():
                print("[CAMERA] DirectShow backend failed; falling back to default backend...")
                cap = cv2.VideoCapture(self.camera_index)
        else:
            cap = cv2.VideoCapture(self.camera_index)

        if not cap.isOpened():
            raise CameraError(
                f"Could not open webcam at index {self.camera_index}.\n"
                f"Troubleshooting tips:\n"
                f"  1. Ensure no other application (Zoom, Teams, Camera App) is using the webcam.\n"
                f"  2. If using an external USB webcam, try index 1: 'python main.py -c 1'.\n"
                f"  3. Check Windows Camera Privacy Settings to allow desktop apps camera access."
            )

        # Configure standard resolution
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

        actual_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        actual_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        print(f"[CAMERA] Webcam active: {actual_w}x{actual_h} px | Backend: DirectShow/OpenCV")
        return cap

    def _save_snapshot(self, raw_frame: np.ndarray, annotated_frame: np.ndarray) -> Tuple[Path, Path]:
        """Saves both unannotated original frame and annotated detection to outputs."""
        self.output_dir.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

        raw_filename = f"snapshot_{timestamp}_raw.jpg"
        annotated_filename = f"snapshot_{timestamp}_detected.jpg"

        raw_path = self.output_dir / raw_filename
        annotated_path = self.output_dir / annotated_filename

        ImageProcessor.save_image(raw_frame, raw_path)
        ImageProcessor.save_image(annotated_frame, annotated_path)

        # Trigger on-screen banner for 2.5 seconds
        self.snapshot_notification = (f"SAVED: {annotated_filename}", time.time() + 2.5)

        print(f"\n[SNAPSHOT] Saved camera capture:")
        print(f"  - Original Frame  : {raw_path.resolve()}")
        print(f"  - Annotated Frame : {annotated_path.resolve()}\n")

        return raw_path, annotated_path

    def _draw_hud(
        self,
        frame: np.ndarray,
        fps: float,
        result: Optional[DetectionResult]
    ) -> np.ndarray:
        """Draws a clean, non-intrusive status HUD and control prompt overlay."""
        display = frame.copy()
        h, w = display.shape[:2]

        # Top status bar
        top_bar_h = 36
        top_bar = display[:top_bar_h, :].copy()
        cv2.rectangle(top_bar, (0, 0), (w, top_bar_h), (20, 20, 20), -1)
        display[:top_bar_h, :] = cv2.addWeighted(top_bar, 0.75, display[:top_bar_h, :], 0.25, 0)

        # Status badge (LIVE / PAUSED / RAW VIEW)
        if self.is_paused:
            badge_text = "[PAUSED]"
            badge_color = (0, 165, 255)  # Amber
        elif self.show_raw_feed:
            badge_text = "[RAW FEED]"
            badge_color = (255, 200, 0)  # Cyan
        elif self.clear_detection:
            badge_text = "[CLEAR]"
            badge_color = (200, 200, 200)
        else:
            badge_text = "[LIVE]"
            badge_color = (50, 220, 50)  # Green

        cv2.putText(
            display, badge_text, (10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.55, badge_color, 2, cv2.LINE_AA
        )

        # Detection method & performance
        method_str = "Baseline CV (Morphological)"
        cand_str = f"Candidates: {result.candidate_contour_count if result else 0}"
        perf_str = f"{fps:.1f} FPS"

        info_text = f"Method: {method_str}  |  {cand_str}  |  {perf_str}"
        cv2.putText(
            display, info_text, (95, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (230, 230, 230), 1, cv2.LINE_AA
        )

        # Bottom control bar
        bottom_bar_h = 28
        bot_y = h - bottom_bar_h
        bot_bar = display[bot_y:, :].copy()
        cv2.rectangle(bot_bar, (0, 0), (w, bottom_bar_h), (15, 15, 15), -1)
        display[bot_y:, :] = cv2.addWeighted(bot_bar, 0.85, display[bot_y:, :], 0.15, 0)

        controls_text = "[Q] Quit  |  [S] Snapshot  |  [P] Pause/Resume  |  [R] Reset  |  [I] View Toggle"
        cv2.putText(
            display, controls_text, (10, h - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (200, 200, 200), 1, cv2.LINE_AA
        )

        # Snapshot notification banner (if active)
        if self.snapshot_notification:
            msg, expiry = self.snapshot_notification
            if time.time() < expiry:
                banner_w = 420
                banner_h = 32
                bx = (w - banner_w) // 2
                by = h - 68
                sub = display[by:by + banner_h, bx:bx + banner_w].copy()
                cv2.rectangle(sub, (0, 0), (banner_w, banner_h), (0, 140, 0), -1)
                display[by:by + banner_h, bx:bx + banner_w] = cv2.addWeighted(
                    sub, 0.85, display[by:by + banner_h, bx:bx + banner_w], 0.15, 0
                )
                cv2.putText(
                    display, msg, (bx + 15, by + 22), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA
                )
            else:
                self.snapshot_notification = None

        return display

    def run(self) -> None:
        """Starts the interactive video capture and processing loop."""
        cap = self._open_camera()

        print(f"\n=======================================================")
        print(f"   CRACKVISION AI: LIVE INSPECTION ACTIVE")
        print(f"=======================================================")
        print(f"  Camera Index : {self.camera_index}")
        print(f"  Method       : {self.detector.get_method_name()}")
        print(f"  Controls     :")
        print(f"    [Q] Quit application safely")
        print(f"    [S] Save snapshot (raw frame + annotated result)")
        print(f"    [P] Pause or resume detection stream")
        print(f"    [R] Reset / clear detection overlay")
        print(f"    [I] Toggle between raw camera and detection view")
        print(f"=======================================================\n")

        fps_alpha = 0.15  # Exponential moving average factor for FPS
        prev_time = time.perf_counter()

        try:
            cv2.namedWindow(WINDOW_TITLE, cv2.WINDOW_AUTOSIZE)

            while True:
                loop_start = time.perf_counter()

                # Read frame unless paused
                if not self.is_paused or self.last_raw_frame is None:
                    ret, frame = cap.read()
                    if not ret or frame is None:
                        print("[ERROR] Camera feed lost or failed to return frame.", file=sys.stderr)
                        break
                    self.last_raw_frame = frame.copy()

                    # Run detection if not cleared or in raw view
                    if not self.clear_detection:
                        self.last_result = self.detector.detect(self.last_raw_frame)
                    else:
                        self.last_result = None
                else:
                    # When paused, reuse existing raw frame and cached detection
                    frame = self.last_raw_frame

                # Select base image for display
                if self.show_raw_feed or self.clear_detection or self.last_result is None:
                    base_display = self.last_raw_frame.copy()
                else:
                    base_display = self.last_result.annotated_image.copy()

                # Calculate real-time FPS
                dt = loop_start - prev_time
                prev_time = loop_start
                if dt > 0:
                    current_fps = 1.0 / dt
                    self.fps_rolling = (fps_alpha * current_fps) + ((1.0 - fps_alpha) * self.fps_rolling)

                # Draw non-intrusive HUD
                annotated_hud = self._draw_hud(base_display, self.fps_rolling, self.last_result)
                self.last_display_frame = annotated_hud

                # Show window
                cv2.imshow(WINDOW_TITLE, annotated_hud)

                # Key event handling (wait 1ms for responsive interactive loop)
                key = cv2.waitKey(1) & 0xFF

                if key in (ord('q'), ord('Q'), 27):  # 'Q' or ESC to Quit
                    print("[INFO] User requested shutdown via [Q].")
                    break

                elif key in (ord('s'), ord('S')):  # 'S' to Save snapshot
                    if self.last_raw_frame is not None:
                        # Produce clean annotated image for snapshot (without HUD overlay)
                        clean_annotated = (
                            self.last_result.annotated_image
                            if self.last_result is not None
                            else self.last_raw_frame.copy()
                        )
                        self._save_snapshot(self.last_raw_frame, clean_annotated)

                elif key in (ord('p'), ord('P')):  # 'P' to Pause / Resume
                    self.is_paused = not self.is_paused
                    state = "PAUSED" if self.is_paused else "RESUMED"
                    print(f"[STATUS] Live inspection {state}.")

                elif key in (ord('r'), ord('R')):  # 'R' to Reset / Clear
                    self.clear_detection = not self.clear_detection
                    self.is_paused = False
                    status = "CLEARED" if self.clear_detection else "RESTORED"
                    print(f"[STATUS] Detection display {status}.")

                elif key in (ord('i'), ord('I')):  # 'I' to Toggle View
                    self.show_raw_feed = not self.show_raw_feed
                    view_name = "RAW CAMERA FEED" if self.show_raw_feed else "PROCESSED DETECTION VIEW"
                    print(f"[STATUS] Display switched to: {view_name}")

        except KeyboardInterrupt:
            print("\n[INFO] KeyboardInterrupt received. Shutting down gracefully...")

        finally:
            # Safe cleanup guaranteed
            print("[CAMERA] Releasing camera hardware...")
            cap.release()
            print("[CAMERA] Closing OpenCV display windows...")
            cv2.destroyAllWindows()
            print("[INFO] CrackVision AI live session terminated safely.\n")
