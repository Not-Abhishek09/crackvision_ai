import { ThinkingLevel, Type } from '@google/genai';
import {
  generateContentWithFallback,
  normalizeAndScaleBox,
} from './geminiClient.ts';
import type {
  HelmetClassification,
  HelmetDetectionItem,
  HelmetInspectionResult,
} from './types.ts';

interface GeminiHelmetPayload {
  detections?: Array<{
    object_category?: string;
    classification?: string;
    model_reported_confidence?: number;
    box_2d?: number[];
    reason?: string;
  }>;
  notes?: string;
}

export async function detectWorkerHelmets(params: {
  imageBuffer: Buffer;
  mimeType: string;
  imageWidth: number;
  imageHeight: number;
  confidenceThreshold: number;
}): Promise<HelmetInspectionResult> {
  const base64Image = params.imageBuffer.toString('base64');

  const prompt = [
    'Analyze this construction site image for all visible human workers and their safety helmet (hard hat) compliance.',
    'Return ONLY genuinely visible people/workers in the image. If no workers are present, return an empty detections array.',
    'CRITICAL CLASSIFICATION RULES:',
    '1. "helmet_detected": Worker is clearly visible AND clearly wearing a construction hard hat / safety helmet on their head.',
    '2. "no_helmet": Worker head is clearly and unambiguously visible, un-obscured, in focus, and has NO safety helmet/hard hat.',
    '3. "uncertain": Worker head is partially obscured, cut off by the image frame edge, shadowed, facing away, blurred, or too small/distant to verify helmet presence reliably.',
    'NEVER classify a worker as "no_helmet" simply because their head is obscured, distant, or outside the frame — classify those strictly as "uncertain".',
    'For every detected worker:',
    '- object_category must be "construction_worker".',
    '- box_2d must tightly bound the worker body/head using normalized coordinates [ymin, xmin, ymax, xmax] scaled 0 to 1000.',
    '- model_reported_confidence must be your certainty between 0.0 and 1.0.',
    '- classification must be exactly one of: "helmet_detected", "no_helmet", "uncertain".',
    '- reason must briefly explain the visual evidence.',
  ].join('\n');

  const { response, modelUsed } = await generateContentWithFallback({
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: params.mimeType,
            data: base64Image,
          },
        },
        { text: prompt },
      ],
    },
    config: {
      systemInstruction:
        'You are an objective construction site PPE safety vision analyzer. Detect workers accurately with normalized [ymin, xmin, ymax, xmax] boxes (0..1000). Never fabricate workers or invent helmet violations when head visibility is unclear.',
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          detections: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                object_category: { type: Type.STRING },
                classification: { type: Type.STRING },
                model_reported_confidence: { type: Type.NUMBER },
                box_2d: {
                  type: Type.ARRAY,
                  items: { type: Type.NUMBER },
                },
                reason: { type: Type.STRING },
              },
              required: [
                'object_category',
                'classification',
                'model_reported_confidence',
                'box_2d',
                'reason',
              ],
            },
          },
          notes: { type: Type.STRING },
        },
        required: ['detections', 'notes'],
      },
    },
  });

  const rawText = (response.text ?? '{}').trim();
  let parsed: GeminiHelmetPayload;
  try {
    parsed = JSON.parse(rawText) as GeminiHelmetPayload;
  } catch {
    throw new Error('Helmet detector received malformed structured output from Gemini Vision.');
  }

  const rawDetections = Array.isArray(parsed.detections) ? parsed.detections : [];
  const detections: HelmetDetectionItem[] = [];

  for (let i = 0; i < rawDetections.length; i++) {
    const item = rawDetections[i];
    if (!item || !Array.isArray(item.box_2d) || item.box_2d.length < 4) continue;

    const conf = clampConfidence(item.model_reported_confidence ?? 0.5);
    if (conf < params.confidenceThreshold) continue;

    const { box_2d, pixel_box } = normalizeAndScaleBox(
      item.box_2d,
      params.imageWidth,
      params.imageHeight,
    );

    const classification = normalizeHelmetClassification(item.classification, conf);

    detections.push({
      id: `WRK-${String(detections.length + 1).padStart(2, '0')}`,
      object_category: 'construction_worker',
      classification,
      model_reported_confidence: conf,
      box_2d,
      pixel_box,
      reason: (item.reason || 'Visual worker detection').trim(),
    });
  }

  const totalWorkers = detections.length;
  const wearingHelmet = detections.filter((d) => d.classification === 'helmet_detected').length;
  const withoutHelmet = detections.filter((d) => d.classification === 'no_helmet').length;
  const uncertainCount = detections.filter((d) => d.classification === 'uncertain').length;

  // Formula: Helmet Compliance = (Workers Wearing Helmets / Total Workers Detected) * 100
  const compliancePercent =
    totalWorkers > 0 ? Number(((wearingHelmet / totalWorkers) * 100).toFixed(1)) : null;

  const violations = detections
    .filter((d) => d.classification === 'no_helmet')
    .map(
      (d) =>
        `${d.id}: No safety helmet detected (model-reported confidence ${(d.model_reported_confidence * 100).toFixed(0)}%) — ${d.reason}`,
    );

  return {
    total_workers: totalWorkers,
    workers_wearing_helmet: wearingHelmet,
    workers_without_helmet: withoutHelmet,
    uncertain_detections: uncertainCount,
    helmet_compliance_percent: compliancePercent,
    model_used: modelUsed,
    detections,
    violations,
    notes:
      (parsed.notes || '').trim() ||
      (totalWorkers > 0
        ? `Detected ${totalWorkers} worker(s): ${wearingHelmet} compliant, ${withoutHelmet} without helmet, ${uncertainCount} uncertain.`
        : 'No construction workers detected in frame.'),
  };
}

function normalizeHelmetClassification(
  raw: string | undefined,
  confidence: number,
): HelmetClassification {
  const s = (raw || '').toLowerCase().trim();
  if (s === 'helmet_detected' || s === 'compliant' || s === 'with_helmet') {
    return confidence < 0.5 ? 'uncertain' : 'helmet_detected';
  }
  if (s === 'no_helmet' || s === 'violation' || s === 'non_compliant') {
    // Require reasonable certainty before flagging a safety violation
    return confidence < 0.55 ? 'uncertain' : 'no_helmet';
  }
  return 'uncertain';
}

function clampConfidence(val: number): number {
  if (!Number.isFinite(val)) return 0.5;
  if (val > 1 && val <= 100) return Number((val / 100).toFixed(3));
  return Number(Math.max(0, Math.min(1, val)).toFixed(3));
}
