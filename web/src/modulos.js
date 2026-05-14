// [14/05/2026 - CRIADO POR ALEXANDRE CARVALHO] Mapa do codigo do modulo -> rota
// + rotulo de exibicao. O catalogo no banco (CCS_TB_GFIN_MODULO) e ASCII puro
// (deploy SOAP corrompe acento); o rotulo bonito da UI fica aqui.
export const MODULOS = {
  SALDOS:      { rota: '/saldos-banco', label: 'Saldos Bancários' },
  CONCILIACAO: { rota: '/conciliacao',  label: 'Conciliação Bancária' },
  FLUXO:       { rota: '/fluxo-caixa',  label: 'Fluxo de Caixa' },
};

// Modulos visiveis do usuario, ordenados, com rota+label resolvidos.
export function modulosDoUsuario(user) {
  if (!user) return [];
  return (user.modulos || [])
    .slice()
    .sort((a, b) => (a.ordem || 0) - (b.ordem || 0))
    .filter(m => MODULOS[m.codigo])
    .map(m => ({ codigo: m.codigo, ...MODULOS[m.codigo] }));
}

// Usuario pode ver o modulo? Admin ('A') ve tudo.
export function podeVerModulo(user, codigo) {
  if (!user) return false;
  if (user.perm === 'A') return true;
  return (user.modulos || []).some(m => m.codigo === codigo);
}
