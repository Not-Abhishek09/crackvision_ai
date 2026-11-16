import sharp from 'sharp';
import type { CrackDetectionItem, HelmetDetectionItem } from './types.ts';

export interface NormalizedImage {
  buffer: Buffer;
  width: number;
  height: number;
  mimeType: 'image/jpeg';
}

/**
 * Normalizes EXIF orientation and encodes to JPEG so coordinates returned by
 * AI vision models align identically with saved originals, annotated outputs, and browser canvas.
 */
export async function normalizeInputImage(inputBuffer: Buffer): Promise<NormalizedImage> {
  const rotated = sharp(inputBuffer).rotate();
  const { data, info } = await rotated
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  if (!info.width || !info.height) {
    throw new Error('Unable to read image dimensions.');
  }

  return {
    buffer: data,
    width: info.width,
    height: info.height,
    mimeType: 'image/jpeg',
  };
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function renderAnnotatedImage(params: {
  baseImageBuffer: Buffer;
  width: number;
  height: number;
  cracks?: CrackDetectionItem[];
  helmets?: HelmetDetectionItem[];
}): Promise<Buffer> {
  const cracks = params.cracks ?? [];
  const helmets = params.helmets ?? [];

  if (cracks.length === 0 && helmets.length === 0) {
    return Buffer.from(params.baseImageBuffer);
  }

  const strokeWidth = Math.max(2, Math.round(Math.min(params.width, params.height) * 0.004));
  const fontSize = Math.max(12, Math.round(Math.min(params.width, params.height) * 0.022));
  const padX = Math.round(fontSize * 0.45);
  const labelH = Math.round(fontSize * 1.45);

  const elements: string[] = [];

  for (const crack of cracks) {
    const { x, y, width, height } = crack.pixel_box;
    const color = '#FACC15'; // Construction Yellow for structural cracks
    const label = `${crack.id} CRACK (${crack.severity.toUpperCase()}) ${(crack.model_reported_confidence * 100).toFixed(0)}%`;
    const labelW = Math.min(params.width, Math.round(label.length * fontSize * 0.58 + padX * 2));
    const labelX = Math.max(0, Math.min(x, params.width - labelW));
    const labelY = y >= labelH + 4 ? y - labelH - 2 : Math.min(params.height - labelH - 2, y + 4);

    elements.push(
      `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${color}" fill-opacity="0.12" stroke="${color}" stroke-width="${strokeWidth}" />`,
      `<rect x="${labelX}" y="${labelY}" width="${labelW}" height="${labelH}" fill="#111317" fill-opacity="0.90" stroke="${color}" stroke-width="1" />`,
      `<text x="${labelX + padX}" y="${labelY + fontSize}" fill="${color}" font-family="monospace" font-size="${fontSize}" font-weight="600">${escapeXml(label)}</text>`,
    );
  }

  for (const worker of helmets) {
    const { x, y, width, height } = worker.pixel_box;
    const color =
      worker.classification === 'helmet_detected'
        ? '#16A34A' // Green
        : worker.classification === 'no_helmet'
          ? '#DC2626' // Red
          : '#EA580C'; // Orange

    const statusTag =
      worker.classification === 'helmet_detected'
        ? 'HELMET OK'
        : worker.classification === 'no_helmet'
          ? 'NO HELMET'
          : 'UNCERTAIN';

    const label = `${worker.id} ${statusTag} ${(worker.model_reported_confidence * 100).toFixed(0)}%`;
    const labelW = Math.min(params.width, Math.round(label.length * fontSize * 0.58 + padX * 2));
    const labelX = Math.max(0, Math.min(x, params.width - labelW));
    const labelY = y >= labelH + 4 ? y - labelH - 2 : Math.min(params.height - labelH - 2, y + 4);

    elements.push(
      `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${color}" fill-opacity="0.10" stroke="${color}" stroke-width="${strokeWidth}" />`,
      `<rect x="${labelX}" y="${labelY}" width="${labelW}" height="${labelH}" fill="#111317" fill-opacity="0.90" stroke="${color}" stroke-width="1" />`,
      `<text x="${labelX + padX}" y="${labelY + fontSize}" fill="${color}" font-family="monospace" font-size="${fontSize}" font-weight="600">${escapeXml(label)}</text>`,
    );
  }

  const svgOverlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${params.width}" height="${params.height}">${elements.join('')}</svg>`;

  return sharp(params.baseImageBuffer)
    .composite([{ input: Buffer.from(svgOverlay), top: 0, left: 0 }])
    .jpeg({ quality: 92 })
    .toBuffer();
}
