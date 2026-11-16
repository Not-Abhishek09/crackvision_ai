import { type GenerateContentParameters, type GenerateContentResponse, GoogleGenAI } from '@google/genai';
import type { PixelBoundingBox } from './types.ts';

export const GEMINI_VISION_MODEL = 'gemini-4-hydrogen';
export const GEMINI_FALLBACK_VISION_MODEL = 'gemini-3.1-flash-lite';

let cachedClient: GoogleGenAI | null = null;

export class GeminiRateLimitError extends Error {
  readonly status = 429;
  constructor(message = 'Gemini Vision API rate limit reached. Increase detection interval (e.g. 5s or 10s) or pause briefly.') {
    super(message);
    this.name = 'GeminiRateLimitError';
  }
}

function isRateLimitMessage(msg: string): boolean {
  return (
    msg.includes('429') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.toLowerCase().includes('rate limit') ||
    msg.toLowerCase().includes('quota')
  );
}

export async function withGeminiRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  let attempt = 0;
  let lastError: unknown;
  while (attempt <= maxRetries) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[Gemini Retry attempt=${attempt}]`, msg.slice(0, 320));
      const isRateLimit = isRateLimitMessage(msg);
      const isDailyQuota = msg.includes('RequestsPerDay') || msg.includes('generate_content_free_tier_requests');
      const isTransient = (isRateLimit && !isDailyQuota) || msg.includes('503') || msg.includes('UNAVAILABLE');

      if (!isTransient || attempt === maxRetries) {
        if (isRateLimit) {
          throw new GeminiRateLimitError(
            `Gemini Vision API rate limit/quota reached: ${msg.slice(0, 420)}`,
          );
        }
        throw err;
      }

      const backoffMs = 900 * Math.pow(2, attempt) + Math.floor(Math.random() * 250);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      attempt += 1;
    }
  }
  throw lastError;
}

export async function generateContentWithFallback(
  params: Omit<GenerateContentParameters, 'model'>,
): Promise<{ response: GenerateContentResponse; modelUsed: string }> {
  const ai = getGeminiClient();
  try {
    const response = await withGeminiRetry(
      () =>
        ai.models.generateContent({
          model: GEMINI_VISION_MODEL,
          ...params,
        }),
      1,
    );
    return { response, modelUsed: GEMINI_VISION_MODEL };
  } catch (err: unknown) {
    if (err instanceof GeminiRateLimitError) {
      console.warn(
        `[Gemini Fallback] ${GEMINI_VISION_MODEL} quota/rate-limit reached; falling back to ${GEMINI_FALLBACK_VISION_MODEL}.`,
      );
      const fallbackResponse = await withGeminiRetry(
        () =>
          ai.models.generateContent({
            model: GEMINI_FALLBACK_VISION_MODEL,
            ...params,
          }),
        2,
      );
      return { response: fallbackResponse, modelUsed: GEMINI_FALLBACK_VISION_MODEL };
    }
    throw err;
  }
}

export function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'GEMINI_API_KEY is not configured on the server. Set a valid Gemini API key in Settings > Secrets.',
    );
  }
  if (!cachedClient) {
    cachedClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return cachedClient;
}

export async function verifyGeminiModelAvailability(): Promise<{
  available: boolean;
  model: string;
  keyConfigured: boolean;
  error?: string;
}> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return {
      available: false,
      model: GEMINI_VISION_MODEL,
      keyConfigured: false,
      error: 'GEMINI_API_KEY is not configured on the server.',
    };
  }

  try {
    const ai = getGeminiClient();
    const modelInfo = await ai.models.get({ model: GEMINI_VISION_MODEL });
    return {
      available: Boolean(modelInfo?.name),
      model: GEMINI_VISION_MODEL,
      keyConfigured: true,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unable to reach Gemini API';
    return {
      available: false,
      model: GEMINI_VISION_MODEL,
      keyConfigured: true,
      error: message,
    };
  }
}

/**
 * Clamps normalized [ymin, xmin, ymax, xmax] coordinates to 0..1000
 * and scales them accurately onto the original image pixel dimensions.
 */
export function normalizeAndScaleBox(
  rawBox: number[],
  imageWidth: number,
  imageHeight: number,
): { box_2d: [number, number, number, number]; pixel_box: PixelBoundingBox } {
  const nums = [
    rawBox[0] ?? 0,
    rawBox[1] ?? 0,
    rawBox[2] ?? 10,
    rawBox[3] ?? 10,
  ].map((v) => (Number.isFinite(v) ? v : 0));

  // Guard against models emitting normalized [0..1] floats instead of [0..1000]
  const looksUnitNormalized =
    nums.every((v) => v >= 0 && v <= 1) &&
    nums.some((v) => v > 0 && v < 1 && !Number.isInteger(v));
  const scaled = looksUnitNormalized ? nums.map((v) => v * 1000) : nums;

  const ymin = clampNumber(scaled[0], 0, 1000);
  const xmin = clampNumber(scaled[1], 0, 1000);
  const ymax = clampNumber(scaled[2], 0, 1000);
  const xmax = clampNumber(scaled[3], 0, 1000);

  const safeYmin = Math.min(ymin, ymax);
  const safeYmax = Math.max(ymin, ymax);
  const safeXmin = Math.min(xmin, xmax);
  const safeXmax = Math.max(xmin, xmax);

  const rawX = Math.round((safeXmin / 1000) * imageWidth);
  const rawY = Math.round((safeYmin / 1000) * imageHeight);
  const rawRight = Math.round((safeXmax / 1000) * imageWidth);
  const rawBottom = Math.round((safeYmax / 1000) * imageHeight);

  const minBoxPx = 4;
  const x = Math.max(0, Math.min(imageWidth - 2, rawX));
  const y = Math.max(0, Math.min(imageHeight - 2, rawY));
  const width = Math.max(minBoxPx, Math.min(imageWidth - x, rawRight - x));
  const height = Math.max(minBoxPx, Math.min(imageHeight - y, rawBottom - y));

  return {
    box_2d: [
      Math.round(safeYmin),
      Math.round(safeXmin),
      Math.round(safeYmax),
      Math.round(safeXmax),
    ],
    pixel_box: { x, y, width, height },
  };
}

function clampNumber(val: number, min: number, max: number): number {
  if (!Number.isFinite(val)) return min;
  return Math.max(min, Math.min(max, val));
}
