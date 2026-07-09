// [05/05/2026 - Alexandre Carvalho] Gestor Financeiro CCS - API Fastify entrypoint
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import IORedis from 'ioredis';

import { createMemRedis } from './redis-mem.js';
import { jwtConfig } from './auth/jwt.js';
import authRoutes         from './routes/auth.js';
import fluxoCaixaRoutes   from './routes/fluxoCaixa.js';
import saldosBancoRoutes  from './routes/saldosBanco.js';
import conciliacaoRoutes  from './routes/conciliacao.js';
import fluxoPrevioRoutes  from './routes/fluxoPrevio.js';
import fluxoDocsRoutes    from './routes/fluxoDocs.js';
import adminRoutes        from './routes/admin.js';
import inadimplenciaRoutes from './routes/inadimplencia.js';
import creditoRoutes       from './routes/credito.js';

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL || 'info' },
  bodyLimit: 10 * 1024 * 1024
});

await app.register(cors, {
  origin: (origin, cb) => cb(null, true),  // mesmo dominio via Caddy
  credentials: true
});
await app.register(cookie);
await app.register(jwt, jwtConfig);
// [09/07/2026 - Alexandre Carvalho] DEV LOCAL sem REDIS_URL: shim em memoria + rate-limit in-memory (so na copia ~/dev)
await app.register(rateLimit, {
  global: false,
  max: 200, timeWindow: '1 minute',
  ...(process.env.REDIS_URL ? { redis: new IORedis(process.env.REDIS_URL) } : {})
});

// Redis client + decorator
const redis = process.env.REDIS_URL ? new IORedis(process.env.REDIS_URL) : createMemRedis();
app.decorate('redis', redis);

// Auth middleware
app.decorate('authenticate', async (req, reply) => {
  try { await req.jwtVerify(); }
  catch { return reply.code(401).send({ error: 'unauthorized' }); }
});

// Healthcheck
app.get('/health', async () => ({
  ok: true, version: '1.0.0',
  uptime_s: Math.floor(process.uptime()),
  ts: new Date().toISOString()
}));

// Rotas
await app.register(authRoutes);
await app.register(saldosBancoRoutes);
await app.register(conciliacaoRoutes);
await app.register(fluxoPrevioRoutes);
await app.register(fluxoDocsRoutes);
await app.register(fluxoCaixaRoutes);
await app.register(adminRoutes);
await app.register(inadimplenciaRoutes);
await app.register(creditoRoutes);

const port = parseInt(process.env.PORT || '3000', 10);
app.listen({ host: '0.0.0.0', port })
   .then(() => app.log.info(`gestor-financeiro API on :${port}`))
   .catch(err => { app.log.error(err); process.exit(1); });
