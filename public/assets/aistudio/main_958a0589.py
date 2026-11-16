"""CrackVision AI: Real-Time Structural Crack Detection Prototype.

Supports real-time interactive webcam inspection, still-image analysis,
and automated batch folder processing.
"""

import argparse
from pathlib import Path
import sys
import time
from typing import List, Optional

from camera import CameraError, LiveInspectionSession
from crack_detector import (
    BaseCrackDetector,
    BaselineMorphologicalCrackDetector,
    DetectionResult,
)
from image_processor import (
    ImageProcessingError,
    ImageProcessor,
    SUPPORTED_EXTENSIONS,
)

SEPARATOR_LINE = "=" * 70
THIN_LINE = "-" * 70


def print_banner() -> None:
    """Displays the application title banner."""
    print("\n" + SEPARATOR_LINE)
    print("   CRACKVISION AI: STRUCTURAL CRACK DETECTION PROTOTYPE")
    print("   Real-Time Camera Inspection & Infrastructure Defect Screening")
    print(SEPARATOR_LINE)


def print_single_report(
    image_path: Path,
    dimensions: tuple,
    result: DetectionResult,
    output_path: Path,
    saved_intermediates: Optional[List[Path]] = None
) -> None:
    """Prints a clear, structured terminal inspection report for still images."""
    w, h, c = dimensions
    status_str = (
        f"POTENTIAL CRACK REGIONS DETECTED ({result.candidate_contour_count} candidates)"
        if result.candidate_contour_count > 0
        else "NO CANDIDATE CRACKS DETECTED"
    )

    print("\n" + SEPARATOR_LINE)
    print("                     STILL IMAGE INSPECTION REPORT")
    print(SEPARATOR_LINE)
    print(f"  Input File         : {image_path.name}")
    print(f"  Full Input Path    : {image_path.resolve()}")
    print(f"  Dimensions         : {w} x {h} px ({c} channels)")
    print(f"  Detection Method   : {result.method_name}")
    print(f"  Trained AI Model   : {'Yes' if result.is_deep_learning else 'No (Heuristic Computer Vision Baseline)'}")
    print(f"  Detection Status   : {status_str}")
    print(f"  Candidate Regions  : {result.candidate_contour_count}")
    print(f"  Candidate Area     : {result.total_crack_pixels:,} px ({result.crack_pixel_ratio_percent:.2f}% of image)")
    print(f"  AI Confidence      : {result.confidence_description}")
    print(f"  Processing Time    : {result.processing_time_seconds * 1000.0:.2f} ms ({result.processing_time_seconds:.4f} s)")
    print(f"  Annotated Output   : {output_path.resolve()}")

    if saved_intermediates:
        print("  Intermediate Files :")
        for p in saved_intermediates:
            print(f"    - {p.name} ({p.parent.name})")

    print(THIN_LINE)
    print("  [DISCLAIMER]")
    print("  This application is an educational & preliminary screening tool.")
    print("  Baseline computer-vision heuristics can produce false positives on")
    print("  rough textures and false negatives on hairline fissures.")
    print("  It is NOT a certified substitute for inspection by a qualified")
    print("  structural engineer.")
    print(SEPARATOR_LINE + "\n")


def process_single_image(
    image_path: Path,
    detector: BaseCrackDetector,
    output_dir: Path,
    save_intermediates: bool = False,
    quiet: bool = False
) -> Optional[DetectionResult]:
    """Processes a single still image, saves annotated output, and displays report."""
    try:
        image = ImageProcessor.load_image(image_path)
        dimensions = ImageProcessor.get_image_dimensions(image)

        result = detector.detect(image)

        output_dir.mkdir(parents=True, exist_ok=True)
        stem = image_path.stem
        output_filename = f"{stem}_detected.jpg"
        output_path = output_dir / output_filename
        ImageProcessor.save_image(result.annotated_image, output_path)

        saved_intermediates: List[Path] = []
        if save_intermediates:
            inter_dir = output_dir / "intermediates" / stem
            inter_dir.mkdir(parents=True, exist_ok=True)
            for stage_name, stage_img in result.intermediate_stages.items():
                stage_file = inter_dir / f"{stage_name}.png"
                ImageProcessor.save_image(stage_img, stage_file)
                saved_intermediates.append(stage_file)

        if not quiet:
            print_single_report(
                image_path=image_path,
                dimensions=dimensions,
                result=result,
                output_path=output_path,
                saved_intermediates=saved_intermediates if save_intermediates else None
            )

        return result

    except ImageProcessingError as ipe:
        print(f"\n[ERROR - Image Processing] {ipe}", file=sys.stderr)
        return None
    except Exception as ex:
        print(f"\n[ERROR - Unexpected Failure] Failed processing '{image_path}': {ex}", file=sys.stderr)
        return None


def process_batch(
    folder_path: Path,
    detector: BaseCrackDetector,
    output_dir: Path,
    save_intermediates: bool = False
) -> None:
    """Processes all supported images in a folder and prints a batch summary."""
    if not folder_path.exists() or not folder_path.is_dir():
        print(f"[ERROR] Directory '{folder_path}' does not exist or is not a folder.", file=sys.stderr)
        return

    all_files = sorted([
        f for f in folder_path.iterdir()
        if f.is_file() and f.suffix.lower() in SUPPORTED_EXTENSIONS
    ])

    if not all_files:
        print(f"[WARNING] No supported image files (.jpg, .jpeg, .png) found in '{folder_path}'.")
        return

    print(f"\n[BATCH MODE] Processing {len(all_files)} images from: {folder_path.resolve()}")
    print(f"[BATCH MODE] Output directory: {output_dir.resolve()}\n")

    start_total = time.perf_counter()
    results_summary = []

    for idx, img_file in enumerate(all_files, start=1):
        print(f"[{idx}/{len(all_files)}] Processing: {img_file.name} ... ", end="", flush=True)
        res = process_single_image(
            img_file, detector, output_dir, save_intermediates=save_intermediates, quiet=True
        )
        if res is not None:
            status = "CRACKS FOUND" if res.candidate_contour_count > 0 else "NO CRACKS"
            print(f"Done ({res.processing_time_seconds * 1000.0:.1f}ms) -> {status} ({res.candidate_contour_count} candidates)")
            results_summary.append((img_file.name, True, res.candidate_contour_count, res.processing_time_seconds))
        else:
            print("FAILED")
            results_summary.append((img_file.name, False, 0, 0.0))

    total_time = time.perf_counter() - start_total

    print("\n" + SEPARATOR_LINE)
    print("                     BATCH SUMMARY REPORT")
    print(SEPARATOR_LINE)
    print(f"{'Filename':<30} | {'Status':<10} | {'Candidates':<10} | {'Time (ms)':<10}")
    print(THIN_LINE)
    success_count = 0
    cracks_found_count = 0

    for fname, ok, count, t_sec in results_summary:
        if ok:
            success_count += 1
            if count > 0:
                cracks_found_count += 1
            stat = "Success"
            print(f"{fname[:30]:<30} | {stat:<10} | {count:<10} | {t_sec * 1000.0:<10.1f}")
        else:
            print(f"{fname[:30]:<30} | {'ERROR':<10} | {'-':<10} | {'-':<10}")

    print(SEPARATOR_LINE)
    print(f"Total Images Processed : {len(all_files)}")
    print(f"Successful Analyses    : {success_count} / {len(all_files)}")
    print(f"Images with Candidates : {cracks_found_count}")
    print(f"Total Wall-Clock Time  : {total_time:.2f} s")
    print(f"Annotated Outputs Saved: {output_dir.resolve()}")
    print(SEPARATOR_LINE + "\n")


def start_live_camera(
    detector: BaseCrackDetector,
    output_dir: Path,
    camera_index: int = 0
) -> None:
    """Launches the interactive real-time webcam inspection window."""
    try:
        session = LiveInspectionSession(
            detector=detector,
            output_dir=output_dir,
            camera_index=camera_index
        )
        session.run()
    except CameraError as ce:
        print(f"\n[ERROR - Camera Initialization] {ce}\n", file=sys.stderr)
    except Exception as ex:
        print(f"\n[ERROR - Camera Runtime] Unexpected error during live session: {ex}\n", file=sys.stderr)


def interactive_menu(detector: BaseCrackDetector, default_output: Path) -> None:
    """Provides an interactive terminal prompt for beginner-friendly exploration."""
    print_banner()
    while True:
        print("\nChoose an option:")
        print("  [1] Start Live Camera Inspection (Webcam)")
        print("  [2] Analyze a single image file")
        print("  [3] Analyze an entire folder (batch processing)")
        print("  [4] Analyze provided sample concrete images")
        print("  [5] Exit")

        choice = input("\nEnter choice [1-5]: ").strip()

        if choice == "1":
            cam_idx_input = input("Enter camera index (press Enter for default 0): ").strip()
            cam_idx = int(cam_idx_input) if cam_idx_input.isdigit() else 0
            start_live_camera(detector, default_output, camera_index=cam_idx)

        elif choice == "2":
            raw_path = input("Enter path to image file: ").strip().strip('"').strip("'")
            if not raw_path:
                print("[WARNING] No path provided.")
                continue
            path = Path(raw_path)
            process_single_image(path, detector, default_output, save_intermediates=True)

        elif choice == "3":
            raw_folder = input("Enter path to image folder: ").strip().strip('"').strip("'")
            if not raw_folder:
                print("[WARNING] No folder provided.")
                continue
            folder = Path(raw_folder)
            process_batch(folder, detector, default_output)

        elif choice == "4":
            sample_dir = Path(__file__).resolve().parent / "sample_images"
            if not sample_dir.exists():
                print(f"[WARNING] Sample directory not found at: {sample_dir}")
            else:
                process_batch(sample_dir, detector, default_output)

        elif choice in {"5", "q", "exit", "quit"}:
            print("Exiting CrackVision AI. Goodbye!")
            break
        else:
            print("Invalid selection. Please choose 1, 2, 3, 4, or 5.")


def build_parser() -> argparse.ArgumentParser:
    """Builds CLI argument parser."""
    parser = argparse.ArgumentParser(
        description="CrackVision AI — Real-Time Structural Crack Detection Prototype",
        epilog="Examples:\n"
               "  python main.py                    # Launch live camera inspection (default)\n"
               "  python main.py -c 1               # Launch live camera with external webcam (index 1)\n"
               "  python main.py -i sample_images/concrete_cracked_wall.jpg   # Still image mode\n"
               "  python main.py -f sample_images   # Batch directory mode\n"
               "  python main.py --menu             # Interactive selection menu",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    group = parser.add_mutually_exclusive_group()
    group.add_argument(
        "-c", "--camera",
        nargs="?",
        const=0,
        type=int,
        help="Start live webcam inspection. Optional camera index (default: 0)"
    )
    group.add_argument(
        "-i", "--image",
        type=Path,
        help="Path to a single image file for still-image inspection"
    )
    group.add_argument(
        "-f", "--folder",
        type=Path,
        help="Path to a directory containing images for batch processing"
    )
    group.add_argument(
        "-m", "--menu",
        action="store_true",
        help="Launch the interactive text menu"
    )
    parser.add_argument(
        "-s", "--sensitivity",
        choices=["low", "medium", "high"],
        default="medium",
        help="Detection sensitivity preset: 'low' (strict), 'medium' (balanced, default), 'high' (sensitive to faint fissures)"
    )
    parser.add_argument(
        "-o", "--output-dir",
        type=Path,
        default=Path("outputs"),
        help="Destination directory for annotated results and snapshots (default: outputs/)"
    )
    parser.add_argument(
        "--save-intermediates",
        action="store_true",
        help="Save intermediate computer-vision masks for debugging (still image mode only)"
    )
    return parser


def main() -> None:
    """Application entry point."""
    parser = build_parser()
    args = parser.parse_args()

    # Initialize modular detector with chosen sensitivity preset
    # Can be replaced with deep-learning detector in future without changing pipeline
    detector = BaselineMorphologicalCrackDetector(
        sensitivity=args.sensitivity,
        blackhat_kernel_size=15,
        overlay_color=(0, 0, 255),  # BGR Red
        overlay_alpha=0.50
    )

    output_dir = args.output_dir

    if args.menu:
        interactive_menu(detector, output_dir)
    elif args.image:
        print_banner()
        process_single_image(
            args.image, detector, output_dir, save_intermediates=args.save_intermediates
        )
    elif args.folder:
        print_banner()
        process_batch(
            args.folder, detector, output_dir, save_intermediates=args.save_intermediates
        )
    elif args.camera is not None:
        print_banner()
        start_live_camera(detector, output_dir, camera_index=args.camera)
    else:
        # Default behavior when launched with no arguments: Start Live Camera
        print_banner()
        start_live_camera(detector, output_dir, camera_index=0)


if __name__ == "__main__":
    main()
