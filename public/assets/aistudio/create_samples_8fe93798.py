"""Generates realistic synthetic concrete test images for CrackVision AI.

Creates 5 test scenarios in sample_images/:
1. concrete_cracked_wall.jpg - Concrete surface with pronounced diagonal fracture
2. concrete_intact_smooth.jpg - Smooth, intact concrete slab (no cracks)
3. concrete_intact_rough.jpg - Rough concrete with surface aggregate & bugholes (no cracks)
4. concrete_network_cracks.jpg - Road / bridge deck with branching crack network
5. concrete_hairline_crack.jpg - Fine hairline surface fissure
"""

from pathlib import Path
import cv2
import numpy as np


def generate_concrete_texture(width: int, height: int, base_brightness: int = 175) -> np.ndarray:
    """Generates realistic concrete texture using multi-scale noise and aggregate particles."""
    np.random.seed(42)

    # Base shade
    base = np.full((height, width), base_brightness, dtype=np.float32)

    # Multi-scale Gaussian noise for concrete mottled variations
    noise_coarse = cv2.resize(
        np.random.normal(0, 15, (height // 8, width // 8)).astype(np.float32), (width, height)
    )
    noise_medium = cv2.resize(
        np.random.normal(0, 8, (height // 2, width // 2)).astype(np.float32), (width, height)
    )
    noise_fine = np.random.normal(0, 6, (height, width)).astype(np.float32)

    texture = base + noise_coarse + noise_medium + noise_fine

    # Add scattered aggregate specks (tiny dark and light pebbles)
    num_particles = int(width * height * 0.003)
    xs = np.random.randint(0, width, num_particles)
    ys = np.random.randint(0, height, num_particles)
    deltas = np.random.choice([-25, -18, 15, 20], size=num_particles)
    texture[ys, xs] += deltas

    texture = np.clip(texture, 30, 245).astype(np.uint8)

    # Convert to 3-channel BGR with slight realistic concrete tint (subtle cool gray)
    bgr = cv2.cvtColor(texture, cv2.COLOR_GRAY2BGR)
    bgr[:, :, 0] = np.clip(bgr[:, :, 0].astype(int) + 2, 0, 255)
    bgr[:, :, 2] = np.clip(bgr[:, :, 2].astype(int) - 2, 0, 255)
    return bgr


def draw_realistic_crack(
    image: np.ndarray,
    start_point: tuple,
    end_point: tuple,
    max_width: int = 3,
    roughness: float = 3.5,
    branches: int = 1
) -> np.ndarray:
    """Draws a jagged, realistic crack path using random-walk displacement."""
    x0, y0 = start_point
    x1, y1 = end_point

    dist = int(np.hypot(x1 - x0, y1 - y0))
    steps = max(dist // 2, 10)

    t_vals = np.linspace(0, 1, steps)
    curr_x = x0 + t_vals * (x1 - x0)
    curr_y = y0 + t_vals * (y1 - y0)

    # Add perpendicular displacement for jagged fracture appearance
    dx = x1 - x0
    dy = y1 - y0
    norm = np.hypot(dx, dy)
    perp_x = -dy / (norm + 1e-6)
    perp_y = dx / (norm + 1e-6)

    offsets = np.cumsum(np.random.normal(0, roughness, steps))
    # Smooth offsets slightly
    offsets = np.convolve(offsets, np.ones(5) / 5, mode='same')

    final_x = (curr_x + offsets * perp_x).astype(int)
    final_y = (curr_y + offsets * perp_y).astype(int)

    h, w = image.shape[:2]
    final_x = np.clip(final_x, 0, w - 1)
    final_y = np.clip(final_y, 0, h - 1)

    points = np.stack([final_x, final_y], axis=1)

    # Draw main fissure with dark crevice and soft edge penumbra
    for i in range(len(points) - 1):
        pt1 = tuple(points[i])
        pt2 = tuple(points[i + 1])
        # Width variation
        w_curr = max(1, int(max_width * (0.6 + 0.4 * np.sin(i * 0.1))))
        # Dark core
        cv2.line(image, pt1, pt2, (45, 45, 45), w_curr)
        # Deep center
        if w_curr > 1:
            cv2.line(image, pt1, pt2, (20, 20, 20), 1)

    # Draw optional branch
    if branches > 0 and steps > 20:
        branch_idx = steps // 2
        bx0, by0 = points[branch_idx]
        bx1 = bx0 + int((x1 - x0) * 0.4 + np.random.randint(-40, 40))
        by1 = by0 + int((y1 - y0) * 0.4 + np.random.randint(30, 80))
        draw_realistic_crack(image, (bx0, by0), (bx1, by1), max_width=max(1, max_width - 1), roughness=2.5, branches=0)

    return image


def create_all_samples(target_dir: Path) -> None:
    """Creates sample images representing diverse concrete conditions."""
    target_dir.mkdir(parents=True, exist_ok=True)

    print(f"Generating synthetic test dataset in: {target_dir.resolve()}")

    # 1. Cracked Wall (Pronounced diagonal crack with branch)
    img1 = generate_concrete_texture(640, 480, base_brightness=170)
    img1 = draw_realistic_crack(img1, (60, 50), (580, 420), max_width=4, roughness=4.0, branches=2)
    cv2.imwrite(str(target_dir / "concrete_cracked_wall.jpg"), img1)
    print("  + Created: concrete_cracked_wall.jpg")

    # 2. Intact Smooth Slab (No cracks)
    img2 = generate_concrete_texture(640, 480, base_brightness=185)
    cv2.imwrite(str(target_dir / "concrete_intact_smooth.jpg"), img2)
    print("  + Created: concrete_intact_smooth.jpg")

    # 3. Intact Rough Concrete with Bugholes / Air Pockets (Tests false positive rejection)
    img3 = generate_concrete_texture(640, 480, base_brightness=160)
    # Add circular air voids
    np.random.seed(99)
    for _ in range(35):
        vx = np.random.randint(20, 620)
        vy = np.random.randint(20, 460)
        radius = np.random.randint(2, 5)
        cv2.circle(img3, (vx, vy), radius, (55, 55, 55), -1)
    cv2.imwrite(str(target_dir / "concrete_intact_rough.jpg"), img3)
    print("  + Created: concrete_intact_rough.jpg")

    # 4. Bridge / Deck Branching Network Cracks
    img4 = generate_concrete_texture(640, 480, base_brightness=150)
    img4 = draw_realistic_crack(img4, (100, 300), (550, 200), max_width=3, roughness=3.0, branches=2)
    img4 = draw_realistic_crack(img4, (320, 100), (450, 400), max_width=3, roughness=3.5, branches=1)
    cv2.imwrite(str(target_dir / "concrete_network_cracks.jpg"), img4)
    print("  + Created: concrete_network_cracks.jpg")

    # 5. Hairline Surface Fissure
    img5 = generate_concrete_texture(640, 480, base_brightness=175)
    img5 = draw_realistic_crack(img5, (150, 80), (480, 380), max_width=2, roughness=2.2, branches=0)
    cv2.imwrite(str(target_dir / "concrete_hairline_crack.jpg"), img5)
    print("  + Created: concrete_hairline_crack.jpg")

    print("All sample images generated successfully.\n")


if __name__ == "__main__":
    sample_path = Path(__file__).resolve().parent / "sample_images"
    create_all_samples(sample_path)
