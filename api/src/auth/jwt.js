// [05/05/2026 - Alexandre Carvalho] Helpers JWT + sessao Redis
import crypto from 'node:crypto';

const ACCESS_TTL  = (process.env.JWT_EXPIRES_ACCESS  || '15m');
const REFRESH_TTL = (process.env.JWT_EXPIRES_REFRESH || '30d');

export const jwtConfig = {
  secret:  process.env.JWT_SECRET,
  sign:    { expiresIn: ACCESS_TTL },
  cookie:  { cookieName: 'gf_at', signed: false }
};

export function newRefreshToken() {
  return crypto.randomBytes(48).toString('base64url');
}

export const REFRESH_TTL_SEC = (() => {
  const m = (REFRESH_TTL || '30d').match(/^(\d+)([smhd])$/);
  if (!m) return 60*60*24*30;
  const n = +m[1];
  return n * ({ s:1, m:60, h:3600, d:86400 }[m[2]]);
})();

export async function setSession(redis, jti, payload) {
  await redis.set(`gf:session:${jti}`, JSON.stringify(payload), 'EX', REFRESH_TTL_SEC);
}

export async function getSession(redis, jti) {
  const s = await redis.get(`gf:session:${jti}`);
  return s ? JSON.parse(s) : null;
}

export async function delSession(redis, jti) {
  await redis.del(`gf:session:${jti}`);
}
