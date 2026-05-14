// [05/05/2026 - Alexandre Carvalho] Rotas de autenticacao via Mega
import crypto from 'node:crypto';
import { loginMega } from '../soap/mega.js';
import { newRefreshToken, REFRESH_TTL_SEC, setSession, getSession, delSession } from '../auth/jwt.js';

export default async function authRoutes(app) {

  app.post('/auth/login', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object', required: ['login','senha'],
        properties: { login: { type:'string', minLength:2 }, senha: { type:'string', minLength:1 } }
      }
    }
  }, async (req, reply) => {
    const { login, senha } = req.body;
    const u = await loginMega(login, senha);
    if (u.PERM_GFIN === 'N' || !u.PERM_GFIN) {
      return reply.code(403).send({ error: 'sem_acesso',
        message: 'Voce nao tem acesso ao Gestor Financeiro CCS. Solicite ao admin liberar GRU_CH_GFIN_CCS.'
      });
    }
    const jti = crypto.randomUUID();
    const payload = {
      sub:   String(u.GRU_IN_CODIGO),
      login: u.GRU_ST_NOME,
      nome:  u.GRU_ST_NOMECOMPLETO,
      email: u.GRU_ST_EMAIL,
      perm:  u.PERM_GFIN,   // 'A' admin / 'U' usuario
      jti
    };
    const accessToken = await reply.jwtSign(payload);
    const refresh     = newRefreshToken();
    await setSession(app.redis, jti, { ...payload, refresh });
    reply.setCookie('gf_rt', refresh, {
      httpOnly: true, sameSite: 'strict', secure: true, path: '/', maxAge: REFRESH_TTL_SEC
    });
    return { user: payload, accessToken };
  });

  app.post('/auth/refresh', async (req, reply) => {
    const rt = req.cookies?.gf_rt;
    if (!rt) return reply.code(401).send({ error: 'no_refresh' });
    const jti = req.headers['x-jti'];
    if (!jti) return reply.code(401).send({ error: 'missing_jti' });
    const sess = await getSession(app.redis, jti);
    if (!sess || sess.refresh !== rt) return reply.code(401).send({ error: 'invalid_refresh' });
    const newRt = newRefreshToken();
    sess.refresh = newRt;
    await setSession(app.redis, jti, sess);
    const accessToken = await reply.jwtSign({
      sub: sess.sub, login: sess.login, nome: sess.nome,
      email: sess.email, perm: sess.perm, jti
    });
    reply.setCookie('gf_rt', newRt, {
      httpOnly: true, sameSite: 'strict', secure: true, path: '/', maxAge: REFRESH_TTL_SEC
    });
    return { accessToken };
  });

  app.post('/auth/logout', { preHandler: [app.authenticate] }, async (req, reply) => {
    await delSession(app.redis, req.user.jti);
    reply.clearCookie('gf_rt', { path: '/' });
    return { ok: true };
  });

  app.get('/auth/me', { preHandler: [app.authenticate] }, async (req) => {
    return { user: req.user };
  });
}
