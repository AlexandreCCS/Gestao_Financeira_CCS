// [14/05/2026 - CRIADO POR ALEXANDRE CARVALHO] Mapa do codigo do modulo -> rota
// + rotulo de exibicao. O catalogo no banco (CCS_TB_GFIN_MODULO) e ASCII puro
// (deploy SOAP corrompe acento); o rotulo bonito da UI fica aqui.
//
// [14/05/2026 - Alexandre Carvalho] Um modulo pode ter `submenus`: nesse caso o
// menu vira um dropdown e `rota` e a tela default ao clicar no item pai.
// A permissao continua sendo por modulo: quem enxerga "Inadimplencia" enxerga
// todos os submenus dela.
export const MODULOS = {
  SALDOS:      { rota: '/saldos-banco', label: 'Saldos Bancários' },
  CONCILIACAO: { rota: '/conciliacao',  label: 'Conciliação Bancária' },
  FLUXO:       { rota: '/fluxo-caixa',  label: 'Fluxo de Caixa' },
  INADIMPLENCIA: {
    label: 'Inadimplência',
    rota:  '/inadimplencia/bloqueios',
    submenus: [
      { rota: '/inadimplencia/bloqueios',       label: 'Bloqueios' },
      { rota: '/inadimplencia/clientes-atraso', label: 'Clientes em Atraso' },
    ],
  },
  // [10/07/2026 - Alexandre Carvalho] Liberacao de Data de Baixa (titulos CR em aberto)
  // [23/07/2026 - Alexandre Carvalho] Virou menu "Liberação" com 2 telas
  // (mesma permissão de módulo cobre as duas, padrão Inadimplência).
  LIBERACAO_BAIXA: {
    label: 'Liberação',
    rota:  '/liberacao-baixa',
    submenus: [
      { rota: '/liberacao-baixa',   label: 'Liberação de Data de Baixa' },
      { rota: '/liberacao-exc-alt', label: 'Liberação de Exc./Alt.' },
    ],
  },
  CREDITO: {
    label: 'Inteligência de Crédito',
    rota:  '/credito/painel',
    submenus: [
      { rota: '/credito/painel',   label: 'Painel Executivo' },
      { rota: '/credito/carteira', label: 'Carteira de Crédito' },
    ],
  },
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
