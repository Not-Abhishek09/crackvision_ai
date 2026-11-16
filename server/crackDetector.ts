import { ThinkingLevel, Type } from '@google/genai';
import sharp from 'sharp';
import {
  GEMINI_VISION_MODEL,
  generateContentWithFallback,
  normalizeAndScaleBox,
} from './geminiClient.ts';
import type {
  CrackDetectionItem,
  CrackInspectionResult,
  CrackSeverity,
} from './types.ts';

interface GeminiCrackDetectionRaw {
  object_category?: string;
  classification?: string;
  severity?: string;
  model_reported_confidence?: number;
  box_2d?: number[];
  location_description?: string;
}

interface GeminiCrackPayload {
  image_quality?: string;
  uncertain_reason?: string;
  detections?: GeminiCrackDetectionRaw[];
  notes?: string;
}

const SEVERITY_RANK: Record<CrackSeverity, number> = {
  None: 0,
  Low: 1,
  Medium: 2,
  High: 3,
};

const CRACK_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    image_quality: { type: Type.STRING },
    uncertain_reason: { type: Type.STRING },
    detections: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          object_category: { type: Type.STRING },
          classification: { type: Type.STRING },
          severity: { type: Type.STRING },
          model_reported_confidence: { type: Type.NUMBER },
          box_2d: {
            type: Type.ARRAY,
            items: { type: Type.NUMBER },
          },
          location_description: { type: Type.STRING },
        },
        required: [
          'object_category',
          'classification',
          'severity',
          'model_reported_confidence',
          'box_2d',
          'location_description',
        ],
      },
    },
    notes: { type: Type.STRING },
  },
  required: ['image_quality', 'detections', 'notes'],
};

function buildPrimaryCrackPrompt(): string {
  return [
    'Perform a careful, high-precision structural inspection of this construction/infrastructure image to detect ALL visible cracks on concrete, masonry, stone, plaster, brick, or asphalt surfaces.',
    '',
    'SCAN SYSTEMATICALLY ACROSS THE ENTIRE IMAGE FOR ALL CRACK TYPES:',
    '- Thin hairline cracks (narrow, low-contrast, irregular dark lines across concrete or masonry)',
    '- Vertical cracks, horizontal cracks, diagonal/shear cracks',
    '- Branching, forked, or network/alligator cracks',
    '- Surface shrinkage cracks and wider structural or spalling fractures',
    '- Multiple distinct cracks on the same surface: output a separate detection entry and tight bounding box for each separated crack rather than collapsing distant cracks into one box.',
    '',
    'DISTINGUISH REAL CRACKS FROM NON-CRACK ARTIFACTS (DO NOT FLAG THESE):',
    '- Straight manufactured concrete form seams, expansion joints, or architectural control joints',
    '- Normal surface aggregate grain, concrete pores, or rough trowel texture',
    '- Lighting shadows, glare lines, or wire/scaffold shadows',
    '- Superficial scuffs, dirt streaks, water/rust stains, chalk/paint markings, rebar, or decorative tile/grout patterns',
    '',
    'IMAGE QUALITY & UNCERTAINTY RULE:',
    '- Set image_quality to "clear" if surface detail is clear enough to judge crack presence reliably.',
    '- Set image_quality to "uncertain" ONLY if severe motion blur, extreme darkness, blown-out glare, heavy occlusion, or extreme distance prevents reliable visual inspection, and explain why in uncertain_reason. Do NOT invent cracks on unreadable images.',
    '- If the surface is clear and contains NO real cracks, return image_quality: "clear" and detections: [].',
    '',
    'REQUIRED FIELDS FOR EVERY DETECTED CRACK:',
    '- object_category: must be "structural_crack".',
    '- classification: specific visual crack type (e.g. "Hairline Crack", "Vertical Structural Crack", "Horizontal Crack", "Diagonal Shear Crack", "Branching Crack", "Surface Shrinkage Crack", "Spalling Fracture").',
    '- severity: "Low" (thin hairline or superficial fissure), "Medium" (moderate continuous crack with visible gap), or "High" (wide, deep, branching, stepped, or spalling structural fracture).',
    '- model_reported_confidence: uncalibrated model certainty between 0.0 and 1.0.',
    '- box_2d: tight normalized bounding box [ymin, xmin, ymax, xmax] scaled 0 to 1000 enclosing the entire visible crack path including thin hairline tips.',
    '- location_description: concise description of visual path, orientation, and location on the structure.',
  ].join('\n');
}

function buildContrastVerificationPrompt(): string {
  return [
    'Secondary hairline-crack verification pass.',
    'Image 1 is the original inspection photograph. Image 2 is a grayscale contrast-normalized and edge-sharpened diagnostic copy of the exact same frame with identical pixel dimensions and framing.',
    'Inspect Image 2 together with Image 1 specifically to check for faint, thin hairline, vertical, horizontal, diagonal, or branching cracks that may blend into low-contrast concrete in Image 1.',
    'Verify every candidate against Image 1 so you DO NOT mistake concrete control/expansion joints, form seams, surface pores, shadows, water stains, scuffs, or construction markings for cracks.',
    'Report box_2d coordinates in the shared [ymin, xmin, ymax, xmax] 0..1000 frame.',
    'If the surface is clear and truly crack-free, return image_quality: "clear" and detections: [].',
  ].join('\n');
}

async function createContrastAnalysisCopy(imageBuffer: Buffer): Promise<Buffer> {
  return sharp(imageBuffer)
    .greyscale()
    .normalise()
    .sharpen({ sigma: 1.05, m1: 0.7, m2: 1.8 })
    .jpeg({ quality: 92 })
    .toBuffer();
}

export async function detectStructuralCracks(params: {
  imageBuffer: Buffer;
  mimeType: string;
  imageWidth: number;
  imageHeight: number;
  confidenceThreshold: number;
  allowDeepHairlinePass?: boolean;
  thinkingMode?: 'low' | 'medium';
}): Promise<CrackInspectionResult> {
  const base64Original = params.imageBuffer.toString('base64');
  const thinkingLevel =
    params.thinkingMode === 'low' ? ThinkingLevel.LOW : ThinkingLevel.MEDIUM;
  let lastModelUsed = GEMINI_VISION_MODEL;

  const runPass = async (parts: Array<{ inlineData: { mimeType: string; data: string } } | { text: string }>): Promise<GeminiCrackPayload> => {
    const { response, modelUsed } = await generateContentWithFallback({
      contents: { parts },
      config: {
        systemInstruction:
          'You are a careful civil infrastructure visual inspection engine. Detect real structural cracks (including thin hairline, vertical, horizontal, diagonal, branching, and multiple cracks) with tight normalized [ymin, xmin, ymax, xmax] bounding boxes on a 0..1000 scale. Reject form joints, shadows, stains, and texture noise. Never fabricate detections; report uncertain image_quality if the frame is unreadable.',
        thinkingConfig: { thinkingLevel },
        responseMimeType: 'application/json',
        responseSchema: CRACK_RESPONSE_SCHEMA,
      },
    });
    lastModelUsed = modelUsed;

    const rawText = (response.text ?? '{}').trim();
    try {
      return JSON.parse(rawText) as GeminiCrackPayload;
    } catch {
      throw new Error('Crack detector received malformed structured output from Gemini Vision.');
    }
  };

  let parsed = await runPass([
    { inlineData: { mimeType: params.mimeType, data: base64Original } },
    { text: buildPrimaryCrackPrompt() },
  ]);

  let imageQuality = normalizeImageQuality(parsed.image_quality);
  let rawDetections = Array.isArray(parsed.detections) ? parsed.detections : [];
  let usedContrastPass = false;

  // If Pass 1 found 0 cracks on a clear image, run a contrast-enhanced secondary check
  // so low-contrast or thin hairline cracks aren't missed.
  const shouldRunDeepPass =
    params.allowDeepHairlinePass !== false &&
    rawDetections.length === 0 &&
    imageQuality === 'clear';

  if (shouldRunDeepPass) {
    try {
      const enhancedBuffer = await createContrastAnalysisCopy(params.imageBuffer);
      const enhancedBase64 = enhancedBuffer.toString('base64');
      const pass2 = await runPass([
        { inlineData: { mimeType: params.mimeType, data: base64Original } },
        { inlineData: { mimeType: 'image/jpeg', data: enhancedBase64 } },
        { text: buildContrastVerificationPrompt() },
      ]);

      const pass2Quality = normalizeImageQuality(pass2.image_quality);
      const pass2Detections = Array.isArray(pass2.detections) ? pass2.detections : [];

      if (pass2Detections.length > 0) {
        parsed = pass2;
        rawDetections = pass2Detections;
        imageQuality = pass2Quality;
        usedContrastPass = true;
      } else if (pass2Quality === 'uncertain') {
        imageQuality = 'uncertain';
        parsed = pass2;
      }
    } catch {
      // Preserve Pass 1 results cleanly if secondary diagnostic pass hits a transient issue
    }
  }

  const detections: CrackDetectionItem[] = [];
  let filteredOutCount = 0;

  for (let i = 0; i < rawDetections.length; i++) {
    const item = rawDetections[i];
    if (!item || !Array.isArray(item.box_2d) || item.box_2d.length < 4) continue;

    const conf = clampConfidence(item.model_reported_confidence ?? 0.5);
    if (conf < params.confidenceThreshold) {
      filteredOutCount += 1;
      continue;
    }

    const { box_2d, pixel_box } = normalizeAndScaleBox(
      item.box_2d,
      params.imageWidth,
      params.imageHeight,
    );

    const severity = normalizeSeverity(item.severity);

    detections.push({
      id: `CRK-${String(detections.length + 1).padStart(2, '0')}`,
      object_category: 'structural_crack',
      classification: (item.classification || 'Surface Crack').trim(),
      severity,
      model_reported_confidence: conf,
      box_2d,
      pixel_box,
      location_description: (item.location_description || 'Concrete/structural surface region').trim(),
    });
  }

  let overallSeverity: CrackSeverity = 'None';
  for (const det of detections) {
    if (SEVERITY_RANK[det.severity] > SEVERITY_RANK[overallSeverity]) {
      overallSeverity = det.severity;
    }
  }

  const avgConf =
    detections.length > 0
      ? Number(
          (
            detections.reduce((sum, d) => sum + d.model_reported_confidence, 0) /
            detections.length
          ).toFixed(3),
        )
      : null;

  const uncertainReason =
    imageQuality === 'uncertain'
      ? (parsed.uncertain_reason || '').trim() ||
        'Image sharpness, lighting, or framing is insufficient for reliable crack verification.'
      : null;

  let notes = (parsed.notes || '').trim();
  if (!notes) {
    if (imageQuality === 'uncertain' && detections.length === 0) {
      notes = `Uncertain result: ${uncertainReason}`;
    } else if (detections.length > 0) {
      notes = `Detected ${detections.length} crack region(s) above ${(params.confidenceThreshold * 100).toFixed(0)}% model confidence threshold.`;
    } else if (filteredOutCount > 0) {
      notes = `No structural cracks met the ${(params.confidenceThreshold * 100).toFixed(0)}% confidence threshold (${filteredOutCount} low-confidence candidate(s) filtered).`;
    } else {
      notes = 'No visible structural cracks detected on the inspected surface.';
    }
  } else if (usedContrastPass && detections.length > 0) {
    notes = `${notes} (Verified via contrast-normalized hairline diagnostic pass.)`;
  }

  return {
    total_cracks: detections.length,
    estimated_overall_severity: overallSeverity,
    average_model_confidence: avgConf,
    image_quality: imageQuality,
    uncertain_reason: uncertainReason,
    module_error: null,
    model_used: lastModelUsed,
    detections,
    notes,
    severity_disclaimer:
      'AI-generated severity estimate and model-reported confidence only; requires verification by a qualified structural engineer before remediation decisions.',
  };
}

function normalizeImageQuality(val?: string): 'clear' | 'uncertain' {
  const s = (val || '').toLowerCase().trim();
  if (s.includes('uncertain') || s.includes('blur') || s.includes('unreadable') || s.includes('poor')) {
    return 'uncertain';
  }
  return 'clear';
}

function normalizeSeverity(val?: string): 'Low' | 'Medium' | 'High' {
  const s = (val || '').toLowerCase();
  if (s.includes('high') || s.includes('severe') || s.includes('critical')) return 'High';
  if (s.includes('med') || s.includes('moderate')) return 'Medium';
  return 'Low';
}

function clampConfidence(val: number): number {
  if (!Number.isFinite(val)) return 0.5;
  if (val > 1 && val <= 100) return Number((val / 100).toFixed(3));
  return Number(Math.max(0, Math.min(1, val)).toFixed(3));
}
