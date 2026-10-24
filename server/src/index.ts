import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import http from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { closeDb, isDbHealthy } from './db.js';
import { HttpError } from './errors.js';
import { attachHub } from './hub.js';
import { startMaintenance, stopMaintenance } from './maintenance.js';
import { apiRouter } from './routes.js';
import * as store from './store.js';
import { startTriggerWorkers, stopTriggerWorkers } from './trigger.js';

const here = dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable('x-powered-by');

app.use((_req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('Permissions-Policy', 'camera=(), geolocation=(), microphone=(self)');
  if (process.env.NODE_ENV === 'production') {
    res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.set(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self' data:",
        "connect-src 'self' ws: wss:",
        "media-src 'self' blob:",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; '),
    );
  }
  next();
});

/* Behind one reverse proxy, trust its X-Forwarded-For so rate limits see the client. */
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
const requestMetrics = { startedAt: new Date().toISOString(), total: 0, errors: 0 };

app.use((req, res, next) => {
  if (!req.path.startsWith('/api')) {
    next();
    return;
  }
  res.set('Cache-Control', 'no-store');
  const incoming = req.get('x-request-id');
  const requestId = incoming && /^[A-Za-z0-9_-]{8,128}$/.test(incoming) ? incoming : randomUUID();
  res.locals.requestId = requestId;
  res.setHeader('x-request-id', requestId);
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    requestMetrics.total += 1;
    if (res.statusCode >= 500) requestMetrics.errors += 1;
    const route = req.route?.path;
    const label = route
      ? `${req.baseUrl}${Array.isArray(route) ? route.join('|') : route}`
      : 'unmatched';
    const durationMs = Math.round((Number(process.hrtime.bigint() - started) / 1e6) * 10) / 10;
    console.log(
      JSON.stringify({
        level: 'info',
        msg: 'http.request',
        requestId,
        method: req.method,
        route: label,
        status: res.statusCode,
        durationMs,
      }),
    );
  });
  next();
});

app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  if (!isDbHealthy()) {
    res.status(503).json({ ok: false, db: 'error' });
    return;
  }
  res.json({ ok: true, db: 'ok', uptime: Math.round(process.uptime()) });
});

/* Liveness for orchestrators: proves the process answers without touching SQLite. */
app.get('/api/live', (_req, res) => {
  res.json({ ok: true, uptime: Math.round(process.uptime()) });
});

const metricsToken = process.env.METRICS_TOKEN?.trim() ?? '';

app.get('/api/metrics', (req, res) => {
  if (metricsToken && req.get('authorization') !== `Bearer ${metricsToken}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const healthy = isDbHealthy();
  let trigger: store.TriggerQueueStats | null = null;
  if (healthy) {
    try {
      trigger = store.triggerQueueStats();
    } catch {
      trigger = null;
    }
  }
  res.set('Cache-Control', 'no-store');
  res.status(healthy ? 200 : 503).json({
    ok: healthy,
    uptime: Math.round(process.uptime()),
    startedAt: requestMetrics.startedAt,
    requests: { total: requestMetrics.total, errors: requestMetrics.errors },
    memoryRssMb: Math.round((process.memoryUsage().rss / (1024 * 1024)) * 10) / 10,
    trigger,
  });
});

app.use('/api', apiRouter);

const webDist = resolve(here, '../../web/dist');
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
      next();
      return;
    }
    res.sendFile(join(webDist, 'index.html'));
  });
}

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof ZodError) {
    const message = error.issues
      .map((issue) => (issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message))
      .join('; ');
    res.status(400).json({ error: message || 'Invalid request' });
    return;
  }
  if (error instanceof HttpError) {
    if (error.retryAfterSeconds) res.set('Retry-After', String(error.retryAfterSeconds));
    res.status(error.status).json({ error: error.message });
    return;
  }
  const bodyErrorType = (error as { type?: unknown }).type;
  if (error instanceof SyntaxError && bodyErrorType === 'entity.parse.failed') {
    res.status(400).json({ error: 'Invalid JSON body' });
    return;
  }
  if (bodyErrorType === 'entity.too.large') {
    res.status(413).json({ error: 'Request body is too large' });
    return;
  }
  console.error(error);
  res.status(500).json({ error: 'Something went wrong', requestId: res.locals.requestId });
});

const server = http.createServer(app);
const closeHub = attachHub(server);
startTriggerWorkers();
startMaintenance();

let shuttingDown = false;

async function shutdown(reason: string, exitCode = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Shutting down (${reason})`);
  const forceExit = setTimeout(() => process.exit(exitCode), 10_000);
  stopTriggerWorkers();
  stopMaintenance();
  const closed = new Promise<void>((resolve) => server.close(() => resolve()));
  closeHub();
  server.closeIdleConnections();
  await closed;
  closeDb();
  clearTimeout(forceExit);
  process.exit(exitCode);
}

server.on('error', (error) => {
  console.error('HTTP server error', error);
  void shutdown('http server error', 1);
});

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('uncaughtException', (error) => {
  console.error('Uncaught exception', error);
  void shutdown('uncaught exception', 1);
});
process.once('unhandledRejection', (reason) => {
  console.error('Unhandled rejection', reason);
  void shutdown('unhandled rejection', 1);
});

const port = Number(process.env.PORT ?? 4000);
server.listen(port, () => {
  console.log(`RoomForge server listening on http://localhost:${port}`);
});
