import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express, { type Request, type Response } from 'express';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import {
  deleteInspectionById,
  getDashboardMetrics,
  getDb,
  getDbPath,
  getInspectionById,
  getSettings,
  listInspections,
  updateSettings,
} from './server/database.ts';
import { GEMINI_VISION_MODEL, GeminiRateLimitError, verifyGeminiModelAvailability } from './server/geminiClient.ts';
import { analyzeLiveFrame, runInspection, saveLiveInspectionSnapshot } from './server/inspectionService.ts';
import { generateInspectionPdf } from './server/reportGenerator.ts';
import { getStorageProvider } from './server/storage.ts';
import type { CrackInspectionResult, HelmetInspectionResult, InspectionMode, SourceType } from './server/types.ts';

const PORT = Number(process.env.PORT || 3000);
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

const SAMPLE_CATALOG = [
  {
    id: 'crack_wall',
    label: 'Concrete Pillar Crack',
    mode: 'cracks' as InspectionMode,
    filename: 'sample_crack_wall_1794858427468.jpg',
    description: 'Weathered concrete bridge pillar with diagonal shear fracture and hairline crack.',
  },
  {
    id: 'workers_ppe',
    label: 'Workers PPE & Scaffolding',
    mode: 'helmets' as InspectionMode,
    filename: 'sample_workers_ppe_1794858428946.jpg',
    description: 'Three site workers near scaffolding (two wearing hard hats, one without helmet).',
  },
  {
    id: 'combined_site',
    label: 'Combined Site & Cracked Wall',
    mode: 'combined' as InspectionMode,
    filename: 'sample_combined_site_1794858429369.jpg',
    description: 'Cracked retaining concrete wall in foreground with two workers in mid-ground.',
  },
];

export async function createApp() {
  // Initialize SQLite and Storage on boot
  getDb();
  const storage = getStorageProvider();

  const app = express();
  app.use(
    cors({
      origin: CORS_ORIGIN === '*' ? true : CORS_ORIGIN.split(',').map((s) => s.trim()),
      credentials: false,
    }),
  );
  app.use(express.json({ limit: '25mb' }));

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 },
  });

  // Health & AI Model Availability Check
  app.get('/api/health', async (_req: Request, res: Response) => {
    try {
      const geminiStatus = await verifyGeminiModelAvailability();
      const settings = getSettings();
      let pythonStatus: { configured: boolean; reachable: boolean; url: string } = {
        configured: Boolean(settings.python_backend_url),
        reachable: false,
        url: settings.python_backend_url,
      };

      if (settings.python_backend_url && settings.python_backend_url.startsWith('http')) {
        try {
          const pyRes = await fetch(`${settings.python_backend_url.replace(/\/+$/, '')}/api/health`, {
            signal: AbortSignal.timeout(2500),
          });
          pythonStatus.reachable = pyRes.ok;
        } catch {
          pythonStatus.reachable = false;
        }
      }

      res.json({
        status: 'ok',
        backend: 'express-node',
        database: {
          connected: true,
          path: getDbPath(),
        },
        storage: {
          backend: storage.backendName,
          location: storage.locationLabel,
        },
        ai_model: {
          provider: 'gemini-vision',
          model: GEMINI_VISION_MODEL,
          key_configured: geminiStatus.keyConfigured,
          available: geminiStatus.available,
          error: geminiStatus.error ?? null,
        },
        python_backend: pythonStatus,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      res.status(500).json({
        status: 'error',
        error: err instanceof Error ? err.message : 'Health check failed',
      });
    }
  });

  // Inspection execution handler (supports multipart file upload OR base64 JSON payload)
  const handleInspect = (mode: InspectionMode) => async (req: Request, res: Response) => {
    try {
      let imageBuffer: Buffer | null = null;

      if (req.file && req.file.buffer) {
        imageBuffer = req.file.buffer;
      } else if (typeof req.body?.imageBase64 === 'string' && req.body.imageBase64.length > 0) {
        const cleaned = req.body.imageBase64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '');
        imageBuffer = Buffer.from(cleaned, 'base64');
      }

      if (!imageBuffer || imageBuffer.length === 0) {
        res.status(400).json({ error: 'No image file or base64 image payload provided.' });
        return;
      }

      const rawSource = (req.body?.sourceType || req.body?.source_type || 'upload') as string;
      const sourceType: SourceType =
        rawSource === 'webcam' || rawSource === 'drone_feed' ? rawSource : 'upload';

      const zoneLabelOverride =
        typeof req.body?.zoneLabel === 'string'
          ? req.body.zoneLabel
          : typeof req.body?.zone_label === 'string'
            ? req.body.zone_label
            : undefined;

      let telemetry: Record<string, unknown> | null = null;
      if (req.body?.telemetry) {
        if (typeof req.body.telemetry === 'string') {
          try {
            telemetry = JSON.parse(req.body.telemetry) as Record<string, unknown>;
          } catch {
            telemetry = null;
          }
        } else if (typeof req.body.telemetry === 'object') {
          telemetry = req.body.telemetry as Record<string, unknown>;
        }
      }

      const record = await runInspection({
        mode,
        rawImageBuffer: imageBuffer,
        sourceType,
        zoneLabelOverride,
        telemetry,
      });

      res.status(201).json(record);
    } catch (err) {
      if (err instanceof GeminiRateLimitError) {
        res.status(429).json({ error: err.message });
        return;
      }
      const message = err instanceof Error ? err.message : 'Inspection inference failed.';
      const statusCode = message.includes('GEMINI_API_KEY') ? 503 : 500;
      res.status(statusCode).json({ error: message });
    }
  };

  app.post('/api/inspect/cracks', upload.single('file'), handleInspect('cracks'));
  app.post('/api/inspect/helmets', upload.single('file'), handleInspect('helmets'));
  app.post('/api/inspect/combined', upload.single('file'), handleInspect('combined'));

  // Lightweight live-camera frame inference (no DB row or PDF created per frame)
  app.post('/api/inspect/live-frame', upload.single('file'), async (req: Request, res: Response) => {
    try {
      let imageBuffer: Buffer | null = null;
      if (req.file?.buffer) {
        imageBuffer = req.file.buffer;
      } else if (typeof req.body?.imageBase64 === 'string' && req.body.imageBase64.length > 0) {
        const cleaned = req.body.imageBase64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '');
        imageBuffer = Buffer.from(cleaned, 'base64');
      }

      if (!imageBuffer || imageBuffer.length === 0) {
        res.status(400).json({ error: 'No camera frame image provided.' });
        return;
      }

      const rawMode = String(req.body?.mode || 'combined');
      const mode: InspectionMode =
        rawMode === 'cracks' || rawMode === 'helmets' ? rawMode : 'combined';

      const liveResult = await analyzeLiveFrame({
        mode,
        rawImageBuffer: imageBuffer,
      });
      res.json(liveResult);
    } catch (err) {
      if (err instanceof GeminiRateLimitError) {
        res.status(429).json({ error: err.message });
        return;
      }
      const message = err instanceof Error ? err.message : 'Live frame analysis failed.';
      const statusCode = message.includes('GEMINI_API_KEY') ? 503 : 500;
      res.status(statusCode).json({ error: message });
    }
  });

  // Persist snapshot & generate PDF report when ending or saving a live inspection session
  app.post('/api/inspect/save-live', upload.single('file'), async (req: Request, res: Response) => {
    try {
      if (!req.file?.buffer) {
        res.status(400).json({ error: 'No captured snapshot image provided.' });
        return;
      }

      const rawMode = String(req.body?.mode || 'combined');
      const mode: InspectionMode =
        rawMode === 'cracks' || rawMode === 'helmets' ? rawMode : 'combined';

      const crackResults = req.body?.crack_results
        ? (JSON.parse(String(req.body.crack_results)) as CrackInspectionResult)
        : null;
      const helmetResults = req.body?.helmet_results
        ? (JSON.parse(String(req.body.helmet_results)) as HelmetInspectionResult)
        : null;
      const processingTimeMs = req.body?.processing_time_ms ? Number(req.body.processing_time_ms) : 0;

      const record = await saveLiveInspectionSnapshot({
        mode,
        rawImageBuffer: req.file.buffer,
        crackResults,
        helmetResults,
        processingTimeMs,
        sourceType: 'webcam',
      });
      res.status(201).json(record);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save live inspection snapshot.';
      res.status(500).json({ error: message });
    }
  });

  // Dashboard metrics (strictly computed from SQLite)
  app.get('/api/dashboard', (_req: Request, res: Response) => {
    try {
      res.json(getDashboardMetrics());
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to compute dashboard metrics.' });
    }
  });

  // Inspection records list & lookup
  app.get('/api/inspections', (req: Request, res: Response) => {
    try {
      const records = listInspections({
        search: typeof req.query.search === 'string' ? req.query.search : undefined,
        mode: typeof req.query.mode === 'string' ? req.query.mode : undefined,
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
        limit: typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined,
      });
      res.json({ items: records, total: records.length });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to fetch inspections.' });
    }
  });

  app.get('/api/inspections/:id', (req: Request, res: Response) => {
    const id = String(req.params.id);
    const record = getInspectionById(id);
    if (!record) {
      res.status(404).json({ error: `Inspection '${id}' not found.` });
      return;
    }
    res.json(record);
  });

  app.delete('/api/inspections/:id', async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const deleted = deleteInspectionById(id);
    if (!deleted) {
      res.status(404).json({ error: `Inspection '${id}' not found.` });
      return;
    }
    const keys = [
      deleted.original_image_key,
      deleted.annotated_image_key,
      deleted.crack_annotated_key,
      deleted.helmet_annotated_key,
      deleted.pdf_report_key,
    ].filter((k): k is string => Boolean(k));

    await Promise.allSettled(keys.map((k) => storage.deleteFile(k)));
    res.json({ deleted: true, id });
  });

  // Download or stream PDF inspection report
  app.get('/api/reports/:id', async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const record = getInspectionById(id);
      if (!record) {
        res.status(404).json({ error: `Inspection '${id}' not found.` });
        return;
      }

      let pdfBuffer: Buffer;
      if (await storage.exists(record.pdf_report_key)) {
        pdfBuffer = await storage.readFile(record.pdf_report_key);
      } else {
        const origBuf = await storage.readFile(record.original_image_key);
        const crackBuf = record.crack_annotated_key ? await storage.readFile(record.crack_annotated_key) : null;
        const helmetBuf = record.helmet_annotated_key ? await storage.readFile(record.helmet_annotated_key) : null;
        pdfBuffer = await generateInspectionPdf({
          record,
          originalImageBuffer: origBuf,
          crackAnnotatedBuffer: crackBuf,
          helmetAnnotatedBuffer: helmetBuf,
        });
        await storage.saveFile(record.pdf_report_key, pdfBuffer, 'application/pdf');
      }

      const disposition = req.query.inline === '1' ? 'inline' : 'attachment';
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `${disposition}; filename="${record.id}_inspection_report.pdf"`);
      res.send(pdfBuffer);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to generate PDF report.' });
    }
  });

  // Serve persisted images / artifacts cleanly from StorageProvider
  app.get('/api/storage/*', async (req: Request, res: Response) => {
    try {
      const key = String(req.params[0] || '');
      if (!key) {
        res.status(400).json({ error: 'Missing storage key.' });
        return;
      }
      const buf = await storage.readFile(key);
      if (key.endsWith('.pdf')) {
        res.setHeader('Content-Type', 'application/pdf');
      } else if (key.endsWith('.png')) {
        res.setHeader('Content-Type', 'image/png');
      } else {
        res.setHeader('Content-Type', 'image/jpeg');
      }
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(buf);
    } catch {
      res.status(404).json({ error: 'Stored artifact not found.' });
    }
  });

  // Settings endpoints
  app.get('/api/settings', (_req: Request, res: Response) => {
    res.json(getSettings());
  });

  app.put('/api/settings', (req: Request, res: Response) => {
    try {
      const updated = updateSettings(req.body || {});
      res.json(updated);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to update settings.' });
    }
  });

  // Sample test dataset metadata (for one-click testing in workspace)
  app.get('/api/samples', (_req: Request, res: Response) => {
    const items = SAMPLE_CATALOG.map((item) => ({
      ...item,
      url: `/src/assets/images/${item.filename}`,
    }));
    res.json({ items });
  });

  // Frontend serving (Vite dev middleware or production dist)
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Production build not found. Run npm run build first.');
      }
    });
  }

  return app;
}

// Start server when executed directly
const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith('server.ts') || process.argv[1].endsWith('server.js'));

if (isMain) {
  createApp()
    .then((app) => {
      app.listen(PORT, '0.0.0.0', () => {
        console.log(`[Construction Vision] Server listening on http://0.0.0.0:${PORT}`);
      });
    })
    .catch((err) => {
      console.error('[Construction Vision] Fatal startup error:', err);
      process.exit(1);
    });
}
