// [05/05/2026 - Alexandre Carvalho] Cliente API do Gestor Financeiro CCS
const KEY = 'gf.session';

export function getSession() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}
export function setSession(s) { localStorage.setItem(KEY, JSON.stringify(s)); }
export function clearSession() { localStorage.removeItem(KEY); }

// [21/09/2026 - Alexandre Carvalho] O /auth/refresh RECALCULA os modulos do usuario e manda dentro do token novo
// (auth.js, 14/05: "mudancas de permissao propagarem sem exigir novo login"), mas o front guardava so o accessToken e o
// menu continuava lendo user.modulos do LOGIN. Resultado: menu novo (ex.: Baixas/Conciliacao) so aparecia saindo e
// entrando de novo. Agora a sessao local acompanha o que vem no token.
function lerToken(jwt) {
  try {
    const b = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(b + '='.repeat((4 - b.length % 4) % 4)), c => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch { return null; }
}
function sessaoComToken(s, accessToken) {
  const p = lerToken(accessToken);
  const user = (p && Array.isArray(p.modulos)) ? { ...s.user, perm: p.perm ?? s.user?.perm, modulos: p.modulos } : s.user;
  return { ...s, accessToken, user };
}
// Renova o token AGORA e devolve true se a lista de modulos (ou a permissao) mudou. Usado pelo Shell ao abrir o portal.
export async function sincronizarSessao() {
  const s = getSession();
  if (!s?.accessToken || !s?.user?.jti) return false;
  try {
    const r = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include', headers: { 'X-JTI': s.user.jti } });
    if (!r.ok) return false;                          // sem refresh valido: o fluxo normal do req() cuida
    const { accessToken } = await r.json();
    const nova = sessaoComToken(getSession() || s, accessToken);
    const assin = u => JSON.stringify([u?.perm, (u?.modulos || []).map(m => m.codigo).sort()]);
    const mudou = assin(nova.user) !== assin(s.user);
    setSession(nova);
    return mudou;
  } catch { return false; }
}

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
      setSession(sessaoComToken(s, accessToken));     // [21/09/2026] leva junto os modulos recalculados pelo servidor
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
  // [21/09/2026 - Alexandre Carvalho] v3 = { grupo:'S'|'N', classes:'C,D,E', d1:'S'|'N' } (pedido Renata/Quality)
  fluxoPrevio: (data_ini, data_fim, filiais = '0', sim = 'S', prev = 'N', v3 = {}) =>
    req(`/fluxo-previo?data_ini=${data_ini}&data_fim=${data_fim}&filiais=${filiais}&sim=${sim}&prev=${prev}`
      + `&grupo=${v3.grupo || 'S'}&classes=${v3.classes || ''}&d1=${v3.d1 || 'N'}`),
  // [21/09/2026 - Alexandre Carvalho] resumo sintetico (por tipo de cobranca e por agente) do dia ou do periodo
  fluxoResumo: (data_ini, data_fim, tipo, filiais = '0', prev = 'N', v3 = {}) =>
    req(`/fluxo-previo/resumo?data_ini=${data_ini}&data_fim=${data_fim}&tipo=${tipo}&filiais=${filiais}&prev=${prev}`
      + `&grupo=${v3.grupo || 'S'}&classes=${v3.classes || ''}&d1=${v3.d1 || 'N'}`),
  // [21/09/2026 - Alexandre Carvalho] contas a pagar do periodo: pago x em aberto x conta que pagou
  fluxoPagarBase:    () => req('/fluxo-previo/pagar-periodo/base'),
  fluxoPagarPeriodo: (data_ini, data_fim, filiais = '0', cmp = null) =>
    req(`/fluxo-previo/pagar-periodo?data_ini=${data_ini}&data_fim=${data_fim}&filiais=${filiais}`
      + (cmp ? `&cmp_ini=${cmp.ini}&cmp_fim=${cmp.fim}` : '')),
  // [21/09/2026 - Alexandre Carvalho] extrato do banco (CNAB 240 lido no navegador) x Mega: o que falta baixar e conciliar
  fluxoExtratoAnalisar: (contas) => req('/fluxo-previo/extrato/analisar', { method: 'POST', body: JSON.stringify({ contas }) }),
  fluxoPrazos:    () => req('/fluxo-previo/prazos'),
  fluxoPrazosSet: (itens) => req('/fluxo-previo/prazos', { method:'PUT', body: JSON.stringify({ itens }) }),
  fluxoContasConfig:    () => req('/fluxo-previo/contas-config'),
  fluxoContasConfigSet: (ids) => req('/fluxo-previo/contas-config', { method:'POST', body: JSON.stringify({ ids }) }),
  fluxoSimulacoes:      () => req('/fluxo-previo/simulacoes'),
  fluxoSimulacaoCriar:  (b) => req('/fluxo-previo/simulacoes', { method:'POST', body: JSON.stringify(b) }),
  fluxoSimulacaoApagar: (id) => req(`/fluxo-previo/simulacoes/${id}`, { method:'DELETE' }),

  // drilldown de documentos do fluxo (Recebimento ou Pagamento)
  fluxoDocs: (data, tipo, filiais = '0', prev = 'N', v3 = {}) =>
    req(`/fluxo-previo/docs?data=${data}&tipo=${tipo}&filiais=${filiais}&prev=${prev}`
      + `&grupo=${v3.grupo || 'S'}&classes=${v3.classes || ''}&d1=${v3.d1 || 'N'}`),

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
