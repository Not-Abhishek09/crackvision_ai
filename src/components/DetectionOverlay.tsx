import type { CrackDetectionItem, HelmetDetectionItem } from '../types/inspection';

export interface ContainedRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface DetectionOverlayProps {
  cracks: CrackDetectionItem[];
  helmets: HelmetDetectionItem[];
  bounds?: ContainedRect | null;
}

/**
 * Renders normalized [ymin, xmin, ymax, xmax] (0..1000) bounding boxes inside the
 * exact contained media rectangle so overlays align pixel-for-pixel with object-fit: contain
 * and remain strictly inside preview boundaries.
 */
export function DetectionOverlay({ cracks, helmets, bounds }: DetectionOverlayProps) {
  if (cracks.length === 0 && helmets.length === 0) return null;

  const containerStyle = bounds
    ? {
        left: `${bounds.left}px`,
        top: `${bounds.top}px`,
        width: `${bounds.width}px`,
        height: `${bounds.height}px`,
      }
    : undefined;

  return (
    <div
      style={containerStyle}
      className={`pointer-events-none absolute overflow-hidden ${bounds ? '' : 'inset-0'}`}
    >
      {cracks.map((crack) => {
        const [ymin, xmin, ymax, xmax] = crack.box_2d;
        const top = `${ymin / 10}%`;
        const left = `${xmin / 10}%`;
        const width = `${Math.max(0.8, (xmax - xmin) / 10)}%`;
        const height = `${Math.max(0.8, (ymax - ymin) / 10)}%`;
        const placeLabelBelow = ymin < 85;
        const alignRight = xmin > 620;

        return (
          <div
            key={crack.id}
            style={{ top, left, width, height }}
            className="absolute border-2 border-[#FACC15] bg-[#FACC15]/10"
          >
            <div
              className={`absolute px-1.5 py-0.5 font-mono text-[10px] font-semibold whitespace-nowrap bg-[#0E1116]/90 text-[#FACC15] border border-[#FACC15] ${
                placeLabelBelow ? 'top-full mt-0.5' : 'bottom-full mb-0.5'
              } ${alignRight ? 'right-0' : 'left-0'}`}
            >
              {crack.id} · {crack.severity.toUpperCase()} · {(crack.model_reported_confidence * 100).toFixed(0)}%
            </div>
          </div>
        );
      })}

      {helmets.map((worker) => {
        const [ymin, xmin, ymax, xmax] = worker.box_2d;
        const top = `${ymin / 10}%`;
        const left = `${xmin / 10}%`;
        const width = `${Math.max(0.8, (xmax - xmin) / 10)}%`;
        const height = `${Math.max(0.8, (ymax - ymin) / 10)}%`;
        const placeLabelBelow = ymin < 85;
        const alignRight = xmin > 620;

        const colorHex =
          worker.classification === 'helmet_detected'
            ? '#16A34A'
            : worker.classification === 'no_helmet'
              ? '#DC2626'
              : '#EA580C';

        const statusLabel =
          worker.classification === 'helmet_detected'
            ? 'HELMET OK'
            : worker.classification === 'no_helmet'
              ? 'NO HELMET'
              : 'UNCERTAIN';

        return (
          <div
            key={worker.id}
            style={{
              top,
              left,
              width,
              height,
              borderColor: colorHex,
              backgroundColor: `${colorHex}1A`,
            }}
            className="absolute border-2"
          >
            <div
              style={{ color: colorHex, borderColor: colorHex }}
              className={`absolute px-1.5 py-0.5 font-mono text-[10px] font-semibold whitespace-nowrap bg-[#0E1116]/95 border ${
                placeLabelBelow ? 'top-full mt-0.5' : 'bottom-full mb-0.5'
              } ${alignRight ? 'right-0' : 'left-0'}`}
            >
              {worker.id} · {statusLabel} · {(worker.model_reported_confidence * 100).toFixed(0)}%
            </div>
          </div>
        );
      })}
    </div>
  );
}
