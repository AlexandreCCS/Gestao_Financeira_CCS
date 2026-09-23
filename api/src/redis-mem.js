// [01/07/2026 - Alexandre Carvalho] Shim Redis em memoria p/ rodar LOCAL sem Docker/Redis.
// So na copia dev (~/dev). Em producao (REDIS_URL setado) o server usa ioredis normal.
export function createMemRedis() {
  const store = new Map(); // key -> { v, exp(ms) | 0 }
  const now = () => Date.now();
  const get1 = (k) => {
    const e = store.get(k);
    if (!e) return null;
    if (e.exp && e.exp <= now()) { store.delete(k); return null; }
    return e;
  };
  return {
    async get(k) { const e = get1(k); return e ? e.v : null; },
    async set(k, v, ...args) {
      let exp = 0;
      for (let i = 0; i < args.length; i++) {
        const a = String(args[i]).toUpperCase();
        if (a === 'EX') exp = now() + Number(args[++i]) * 1000;
        else if (a === 'PX') exp = now() + Number(args[++i]);
        else if (a === 'NX') { if (get1(k)) return null; }
      }
      store.set(k, { v: String(v), exp });
      return 'OK';
    },
    async del(...ks) { let n = 0; for (const k of ks.flat()) if (store.delete(k)) n++; return n; },
    async expire(k, s) { const e = get1(k); if (!e) return 0; e.exp = now() + Number(s) * 1000; return 1; },
    async ttl(k) { const e = get1(k); if (!e) return -2; if (!e.exp) return -1; return Math.ceil((e.exp - now()) / 1000); },
    async exists(...ks) { let n = 0; for (const k of ks.flat()) if (get1(k)) n++; return n; },
    async incr(k) { const e = get1(k); const v = (e ? Number(e.v) : 0) + 1; store.set(k, { v: String(v), exp: e?.exp || 0 }); return v; },
    async quit() { return 'OK'; },
    async ping() { return 'PONG'; },
    on() { return this; },
  };
}
