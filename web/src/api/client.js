// [05/05/2026 - Alexandre Carvalho] Cliente API do Gestor Financeiro CCS
const KEY = 'gf.session';

export function getSession() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}
export function setSession(s) { localStorage.setItem(KEY, JSON.stringify(s)); }
export function clearSession() { localStorage.removeItem(KEY); }

async function req(path, opts = {}) {
  const s = getSession();
  const headers = { ...(opts.headers || {}) };
  const m = (opts.method || 'GET').toUpperCase();
  if (['POST','PUT','PATCH'].includes(m)) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    if (opts.body == null) opts = { ...opts, body: '{}' };
  } else if (opts.body) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }
  if (s?.accessToken) headers['Authorization'] = `Bearer ${s.accessToken}`;
  if (s?.user?.jti)   headers['X-JTI'] = s.user.jti;
  const res = await fetch(`/api${path}`, { ...opts, headers, credentials: 'include' });
  if (res.status === 401) {
    const r = await fetch('/api/auth/refresh', {
      method:'POST', credentials:'include',
      headers: { 'X-JTI': s?.user?.jti || '' }
    });
    if (r.ok) {
      const { accessToken } = await r.json();
      setSession({ ...s, accessToken });
      return req(path, opts);
    }
    clearSession();
    if (location.pathname !== '/login') location.href = '/login';
    throw new Error('unauthorized');
  }
  if (!res.ok) throw new Error((await res.json().catch(()=>({}))).error || res.statusText);
  return res.headers.get('content-type')?.includes('json') ? res.json() : res.text();
}

export const api = {
  // auth
  login:  (login, senha) => fetch('/api/auth/login', {
    method:'POST', credentials:'include',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify({ login, senha })
  }).then(r => r.ok ? r.json() : r.json().then(j => Promise.reject(j))),
  logout: () => req('/auth/logout', { method:'POST' }),
  me:     () => req('/auth/me'),

  // fluxo de caixa
  fluxoCaixa: (data_ini, data_fim, periodo, fil = 0) =>
    req(`/fluxo-caixa?data_ini=${data_ini}&data_fim=${data_fim}&periodo=${periodo}&fil=${fil}`),
  filiais: () => req('/fluxo-caixa/filiais'),

  // saldos bancarios
  saldosBanco: (data, fil = 0, agn = 0) =>
    req(`/saldos-banco?data=${data}&fil=${fil}&agn=${agn}`),
  saldosBancoFiliais: () => req('/saldos-banco/filiais'),
  saldosBancoContas:  () => req('/saldos-banco/contas'),
  saldosBancoLancamentos: (agn, fil, data_ini, data_fim) =>
    // [07/05/2026 - Alexandre Carvalho] V2: fil=0 traz todas as filiais (extrato bancario completo da conta)
    req(`/saldos-banco/lancamentos?agn=${agn}&fil=${fil || 0}&data_ini=${data_ini}&data_fim=${data_fim}`),

  // conciliacao
  conciliacao: (data_ini, data_fim, fil = 0) =>
    req(`/conciliacao?data_ini=${data_ini}&data_fim=${data_fim}&fil=${fil}`),
  // [01/07/2026 - Alexandre Carvalho] drill-down: lancamentos pendentes de conciliar de uma conta
  conciliacaoPendentes: (agn, fil, data_ini, data_fim) =>
    req(`/conciliacao/pendentes?agn=${agn}&fil=${fil || 0}&data_ini=${data_ini}&data_fim=${data_fim}`),

  // fluxo previo
  fluxoPrevio: (data_ini, data_fim, filiais = '0', sim = 'S', prev = 'N') =>
    req(`/fluxo-previo?data_ini=${data_ini}&data_fim=${data_fim}&filiais=${filiais}&sim=${sim}&prev=${prev}`),
  fluxoContasConfig:    () => req('/fluxo-previo/contas-config'),
  fluxoContasConfigSet: (ids) => req('/fluxo-previo/contas-config', { method:'POST', body: JSON.stringify({ ids }) }),
  fluxoSimulacoes:      () => req('/fluxo-previo/simulacoes'),
  fluxoSimulacaoCriar:  (b) => req('/fluxo-previo/simulacoes', { method:'POST', body: JSON.stringify(b) }),
  fluxoSimulacaoApagar: (id) => req(`/fluxo-previo/simulacoes/${id}`, { method:'DELETE' }),

  // drilldown de documentos do fluxo (Recebimento ou Pagamento)
  fluxoDocs: (data, tipo, filiais = '0', prev = 'N') =>
    req(`/fluxo-previo/docs?data=${data}&tipo=${tipo}&filiais=${filiais}&prev=${prev}`),

  // [14/05/2026 - Alexandre Carvalho] administracao de usuarios (admin only)
  adminModulos:  () => req('/admin/modulos'),
  adminUsuarios: () => req('/admin/usuarios'),
  adminSalvarUsuario: (gru, perm, modulos) =>
    req(`/admin/usuarios/${gru}`, { method: 'PUT', body: JSON.stringify({ perm, modulos }) }),

  // [14/05/2026 - Alexandre Carvalho] inadimplencia
  inadBloqueios:      (data) => req(`/inadimplencia/bloqueios?data=${data}`),
  inadDesbloqueios:   (data) => req(`/inadimplencia/desbloqueios?data=${data}`),
  inadClientesAtraso: (receita = 'geral') => req(`/inadimplencia/clientes-atraso?receita=${receita}`),

  // [14/05/2026 - Alexandre Carvalho] inteligencia de credito
  creditoCarteira:   ()    => req('/credito/carteira'),
  creditoCliente:    (agn) => req(`/credito/cliente/${agn}`),
  creditoParametros: ()    => req('/credito/parametros'),
  creditoSalvarParametros: (parametros) =>
    req('/credito/parametros', { method: 'PUT', body: JSON.stringify({ parametros }) }),
  creditoExemplo:    ()    => req('/credito/exemplo'),
  creditoPainel:     ()    => req('/credito/painel'),

  // [10/07/2026 - Alexandre Carvalho] liberacao de data de baixa
  liberacaoBaixaTitulos: () => req('/liberacao-baixa/titulos'),
  liberacaoBaixaLiberar: (dados) =>
    req('/liberacao-baixa/liberar', { method: 'POST', body: JSON.stringify(dados) }),
  liberacaoBaixaRevogar: (id) =>
    req('/liberacao-baixa/revogar', { method: 'POST', body: JSON.stringify({ id }) }),
  liberacaoBaixaLiberacoes: (agn, documento) =>
    req(`/liberacao-baixa/liberacoes${agn ? `?agn=${agn}&documento=${encodeURIComponent(documento)}` : ''}`),
  // [23/07/2026 - Alexandre Carvalho] parametros do modulo (dias uteis p/ baixa)
  liberacaoBaixaParametros: () => req('/liberacao-baixa/parametros'),
  liberacaoBaixaSalvarParametros: (dados) =>
    req('/liberacao-baixa/parametros', { method: 'PUT', body: JSON.stringify(dados) }),
  liberacaoBaixaParametrosHistorico: () => req('/liberacao-baixa/parametros/historico'),
  // [23/07/2026 - Alexandre Carvalho] Liberacao de Exc./Alt. — titulos baixados (industria)
  liberacaoBaixaBaixados: (ini, fim) =>
    req(`/liberacao-baixa/baixados?ini=${ini || ''}&fim=${fim || ''}`),
  liberacaoExcLiberar: (dados) =>
    req('/liberacao-exc/liberar', { method: 'POST', body: JSON.stringify(dados) }),
  liberacaoExcRevogar: (id) =>
    req('/liberacao-exc/revogar', { method: 'POST', body: JSON.stringify({ id }) }),
  liberacaoExcLiberacoes: (agn, documento) =>
    req(`/liberacao-exc/liberacoes${agn ? `?agn=${agn}&documento=${encodeURIComponent(documento)}` : ''}`),

  // [06/08/2026 - Alexandre Carvalho] liberacao de agentes (flag de bloqueio por atraso)
  liberacaoAgnLiberados: () => req('/liberacao-agentes/liberados'),
  liberacaoAgnBusca: (q) => req(`/liberacao-agentes/busca?q=${encodeURIComponent(q)}`),
  liberacaoAgnLiberar: (dados) =>
    req('/liberacao-agentes/liberar', { method: 'POST', body: JSON.stringify(dados) }),
  liberacaoAgnRevogar: (dados) =>
    req('/liberacao-agentes/revogar', { method: 'POST', body: JSON.stringify(dados) }),
  liberacaoAgnHistorico: (dias) => req(`/liberacao-agentes/historico?dias=${dias || 30}`)
};
