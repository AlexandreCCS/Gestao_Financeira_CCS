// [20/11/2026 - CRIADO POR ALEXANDRE CARVALHO] CONCILIACAO BANCARIA - CARTAO: "PERNA DO MEGA" NO EXTRATO DO ITAU DA LOJA, POR FILIAL.
// Decisoes do Alexandre (19-20/11): a baixa automatica do cartao continua no Itau da loja (data futura); a conciliacao e feita no extrato do
// Itau, onde cada deposito da Rede vem numa linha ("REDE   MAST CD0102574383" = bandeira + CD credito / DB debito + estabelecimento).
// Tarifa faltante e ajuste da Rede (aluguel): "Nao vamos mexer, primeiro vamos sinalizar" -> so aparecem como diferenca, nada e lancado.
// Unidade = DEPOSITO: linha do extrato Itau (FIN_CONCILIACAO) = deposito Rede (aba D, data+bandeira+modalidade) = parcelas pagas (aba P,
// mesma chave) -> cada parcela casada com a baixa automatica (CCS_TB_LOG_BAIXA_AUTO, credito ou debito) -> movimento da baixa no banco
// (LANCTO_FIN = acao 706, TPD CARCRED/CARDEB, natureza D, conta Itau). Conciliar = N movimentos x 1 linha do extrato pelo motor do Gestor
// (CCS_P_GFIN_BXC_CONC), so quando a soma fecha no centavo.
// Casamento parcela x baixa: o mesmo da conferencia do credito (cbcCredito.js): data da venda (+-1 dia) + no da parcela + valor (+-0,02);
// 2a passada sem o no da parcela; 3a passada: 1 parcela da Rede = 2 titulos do Mega (soma +-0,05, vendas a ate 7 dias).
const num = v => Number(v || 0);
const r2 = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const iso = s => (s ? String(s).slice(0, 10) : null);
const dias = (a, b) => Math.round((new Date(a + 'T12:00:00Z') - new Date(b + 'T12:00:00Z')) / 86400000);
const addDias = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const D = s => `TO_DATE('${s}','YYYY-MM-DD')`;
const TOL_VALOR = 0.02, TOL_VENDA = 1, TOL_SOMA = 0.05, JAN_SOMA = 7;
// bandeira da Rede ("Mastercard") x token do extrato Itau ("MAST"): 4 primeiras letras sem acento
const band4 = s => String(s || '').normalize('NFD').replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 4);
const modal = s => (/deb/i.test(String(s || '')) ? 'D' : 'C');   // C credito | D debito
const chave = (data, band, mod) => `${data}|${band4(band)}|${mod}`;
export const SITUACOES_DEP = {
  PRONTO: 'pronto para conciliar', DIFERENCA: 'diferença (sinalizada)', PENDENTE: 'pendente', CONCILIADO: 'já conciliado', SEM_EXTRATO: 'aguardando extrato do Itaú',
  SO_EXTRATO: 'só no extrato (sem depósito da Rede importado)',
};

export async function montarDepositos(megaQuery, fil, opc = {}) {
  fil = num(fil);
  if (!fil) throw Object.assign(new Error('Informe a filial.'), { statusCode: 400 });
  const janela = num((await megaQuery(`SELECT NVL(MAX(PARAM_RE_VALOR), 5) J FROM MEGA.CCS_TB_GFIN_PARAM WHERE PARAM_ST_CHAVE = 'BXC_JANELA_DIAS'`))[0]?.J) || 5;
  const estabs = (await megaQuery(`SELECT ESTAB_ST_NUMERO E FROM MEGA.CCS_TB_GFIN_CBC_ESTAB WHERE FIL_IN_CODIGO = ${fil}`)).map(x => String(x.E).replace(/^0+/, ''));
  if (!estabs.length) return { filial: fil, aviso: 'Filial sem estabelecimento da Rede cadastrado (importe um arquivo da Rede desta filial).', depositos: [], resumo: {} };
  // ---------------------------------------------------------------- Rede: depositos (D), parcelas pagas (P), ajustes (A)
  const rl = await megaQuery(`SELECT L.ARQ_IN_CODIGO ARQ, L.LIN_IN_ORDEM ORD, L.LIN_CH_ABA ABA, TO_CHAR(L.LIN_DT_DATA,'YYYY-MM-DD') DT, TO_CHAR(L.LIN_DT_VENDA,'YYYY-MM-DD') VENDA,
      L.LIN_ST_BANDEIRA BAND, L.LIN_ST_MODALIDADE MODAL, L.LIN_IN_PARCELA PARC, L.LIN_IN_PARCELAS PARCS, L.LIN_RE_BRUTO BRUTO, L.LIN_RE_MDR MDR, L.LIN_RE_LIQUIDO LIQ,
      L.LIN_ST_NSU NSU, L.LIN_ST_STATUS ST, L.LIN_ST_DESCRICAO DESCR
      FROM MEGA.CCS_TB_GFIN_CBC_LINHA L WHERE L.FIL_IN_CODIGO = ${fil} AND L.LIN_CH_SITUACAO = 'I' AND L.LIN_CH_ABA IN ('D','P','A')
      ORDER BY L.LIN_DT_DATA, L.ARQ_IN_CODIGO, L.LIN_IN_ORDEM`);
  const rede = rl.map(x => ({ arq: num(x.ARQ), ordem: num(x.ORD), aba: x.ABA, data: iso(x.DT), venda: iso(x.VENDA), bandeira: x.BAND || '', mod: modal(x.MODAL),
    parcela: num(x.PARC) || 1, parcelas: num(x.PARCS) || 1, bruto: r2(x.BRUTO), mdr: r2(x.MDR), liquido: r2(x.LIQ), nsu: x.NSU || '', status: x.ST || '', descricao: x.DESCR || '' }));
  const deps = rede.filter(r => r.aba === 'D'), pags = rede.filter(r => r.aba === 'P'), ajustes = rede.filter(r => r.aba === 'A');
  if (!deps.length) return { filial: fil, aviso: 'Nenhum deposito importado nesta filial (importe o relatorio de recebimentos da Rede).', depositos: [], resumo: {} };
  const datas = deps.map(d => d.data).sort();
  const ini = opc.ini || datas[0], fim = opc.fim || datas[datas.length - 1];
  // ---------------------------------------------------------------- extrato do Itau: linhas "REDE ..." do estabelecimento da filial
  const ext = (await megaQuery(`SELECT C.CBA_IN_SEQUENCIA SEQ, C.AGN_IN_CODIGO AGN, C.FIL_IN_CODIGO FIL, TO_CHAR(C.CBA_DT_DATA,'YYYY-MM-DD') DT, C.CBA_CH_NATUREZA NAT, C.CBA_RE_VALOR V,
      C.CBA_ST_HISTORICO H, NVL(C.CBA_CH_STATUS,'N') ST, C.CON_IN_SEQUENCIAL CON
      FROM MEGA.FIN_CONCILIACAO C WHERE C.CBA_DT_DATA BETWEEN ${D(addDias(ini, -3))} AND ${D(addDias(fim, 3))} AND UPPER(C.CBA_ST_HISTORICO) LIKE 'REDE%'
        AND (${estabs.map(e => `C.CBA_ST_HISTORICO LIKE '%${e}%'`).join(' OR ')})`)).map(x => {
    const m = String(x.H || '').toUpperCase().match(/^REDE\s+([A-Z]+)\s*(CD|DB)\s*0*(\d+)/);
    return { cba: num(x.SEQ), conta: num(x.AGN), fil: num(x.FIL), data: iso(x.DT), natureza: x.NAT, valor: r2(x.V), historico: String(x.H || '').trim(), status: x.ST, con: x.CON ? num(x.CON) : null,
      band: m ? band4(m[1]) : '', mod: m ? (m[2] === 'DB' ? 'D' : 'C') : '', estab: m ? m[3] : '', usado: false };
  }).filter(e => e.band && estabs.includes(e.estab));
  // ---------------------------------------------------------------- Mega: baixas automaticas de cartao + movimento 706 no banco
  const pIni = addDias(pags.length ? pags.map(p => p.data).sort()[0] : ini, -20), pFim = addDias(fim, 20);
  const mega = (await megaQuery(`SELECT B.LOG_IN_CODIGO ID, B.MOV_ST_DOCUMENTO DOC, B.MOV_ST_PARCELA PARC, B.MOV_RE_VALOR VLR, B.FORMA_PAGAMENTO FORMA, B.ORG_IN_CODIGO ORG,
      TO_CHAR(M.MOV_DT_DATADOCTO,'YYYY-MM-DD') VENDA, TO_CHAR(B.DT_BAIXA,'YYYY-MM-DD') BX, B.CLI_IN_CODIGO CLI,
      F.MOV_SEQ_IN_CODIGO FSEQ, F.MOV_IN_NUMLANCTO FLAN, F.AGN_IN_CODIGO FAGN, F.MOV_RE_VALOR FVLR, TO_CHAR(F.MOV_DT_DATADOCTO,'YYYY-MM-DD') FDT, NVL(F.MOV_CH_CONCILIADO,'N') FCONC, F.TPD_ST_CODIGO FTPD,
      (SELECT NVL(SUM(T.MOV_RE_VALORMOE),0) FROM MEGA.FIN_MOVIMENTO T WHERE T.ORG_IN_CODIGO = B.ORG_IN_CODIGO AND T.FIL_IN_CODIGO = B.FIL_IN_CODIGO AND T.ACAO_IN_CODIGO = 956
          AND T.MOV_ST_DOCUMENTO = B.MOV_ST_DOCUMENTO AND T.MOV_ST_PARCELA = B.MOV_ST_PARCELA AND TRUNC(T.MOV_DT_DATADOCTO) = TRUNC(B.DT_BAIXA)) TARIFA
      FROM MEGA.CCS_TB_LOG_BAIXA_AUTO B
      JOIN MEGA.FIN_MOVIMENTO M ON M.MOV_IN_NUMLANCTO = B.MOV_IN_NUMLANCTO AND M.ORG_IN_CODIGO = B.ORG_IN_CODIGO
      LEFT JOIN MEGA.FIN_MOVIMENTO F ON F.ORG_IN_CODIGO = B.ORG_IN_CODIGO AND F.MOV_IN_NUMLANCTO = B.LANCTO_FIN AND F.ACAO_IN_CODIGO = 706
        AND F.TPD_ST_CODIGO IN ('CARCRED','CARDEB') AND NVL(F.MOV_CH_SITUACAO,'N') <> 'C'
      WHERE B.FIL_IN_CODIGO = ${fil} AND NVL(B.ESTORNADO,'N') <> 'S' AND (UPPER(B.FORMA_PAGAMENTO) LIKE 'CREDITO%' OR UPPER(B.FORMA_PAGAMENTO) LIKE 'DEBITO%')
        AND B.DT_BAIXA BETWEEN ${D(pIni)} AND ${D(pFim)}`)).map(x => ({
    id: num(x.ID), doc: x.DOC || '', parcela: num(String(x.PARC || '').replace(/\D/g, '')) || 1, valor: r2(x.VLR), mod: /^DEB/i.test(x.FORMA || '') ? 'D' : 'C', forma: x.FORMA || '',
    org: num(x.ORG), venda: iso(x.VENDA), baixa: iso(x.BX), cliente: num(x.CLI), tarifa: r2(x.TARIFA), usada: false,
    mov: x.FLAN ? { seq: num(x.FSEQ), lancto: num(x.FLAN), conta: num(x.FAGN), valor: r2(x.FVLR), data: iso(x.FDT), conciliado: x.FCONC === 'S', tpd: x.FTPD } : null }));
  // ---------------------------------------------------------------- casamento parcela da Rede x baixa do Mega (por modalidade)
  const melhor = (r, comParcela) => {
    let best = null, nota = Infinity;
    for (const m of mega) {
      if (m.usada || m.mod !== r.mod || !m.venda || !r.venda || Math.abs(m.valor - r.bruto) > TOL_VALOR + 1e-9 || Math.abs(dias(m.venda, r.venda)) > TOL_VENDA) continue;
      if (comParcela && m.parcela !== r.parcela) continue;
      const n = Math.abs(dias(m.venda, r.venda)) * 100 + Math.abs(dias(r.data, m.baixa || r.data)) + (m.valor === r.bruto ? 0 : 0.5);
      if (n < nota) { nota = n; best = m; }
    }
    return best;
  };
  for (const passada of [true, false]) for (const r of pags) {
    if (r.ms) continue;
    const m = melhor(r, passada);
    if (m) { m.usada = true; r.ms = [m]; r.semParcela = !passada; }
  }
  const perto = (a, b) => a && b && Math.abs(dias(a, b)) <= JAN_SOMA;
  for (const r of pags) {
    if (r.ms) continue;
    const ms = mega.filter(m => !m.usada && m.mod === r.mod && m.parcela === r.parcela && perto(m.venda, r.venda));
    achou: for (let i = 0; i < ms.length; i++) for (let j = i + 1; j < ms.length; j++)
      if (Math.abs(ms[i].valor + ms[j].valor - r.bruto) <= TOL_SOMA) { ms[i].usada = ms[j].usada = true; r.ms = [ms[i], ms[j]]; r.soma = true; break achou; }
  }
  // ---------------------------------------------------------------- monta cada deposito
  const porChave = new Map();
  for (const d of deps) {
    if (d.data < ini || d.data > fim) continue;
    const k = chave(d.data, d.bandeira, d.mod);
    if (!porChave.has(k)) porChave.set(k, { chave: k, data: d.data, bandeira: d.bandeira, mod: d.mod, rede: [], parcelas: [], ajustes: [] });
    porChave.get(k).rede.push(d);
  }
  for (const p of pags) { const g = porChave.get(chave(p.data, p.bandeira, p.mod)); if (g) g.parcelas.push(p); }
  const depositos = [];
  for (const g of porChave.values()) {
    const valorRede = r2(g.rede.reduce((s, d) => s + d.liquido, 0));
    const somaParc = r2(g.parcelas.reduce((s, p) => s + p.liquido, 0));
    // extrato: mesma data, bandeira, modalidade e valor; senao mesma chave e valor diferente (mostra a diferenca)
    let e = ext.find(x => !x.usado && x.data === g.data && x.band === band4(g.bandeira) && x.mod === g.mod && Math.abs(x.valor - valorRede) < 0.005)
      || ext.find(x => !x.usado && x.data === g.data && x.band === band4(g.bandeira) && x.mod === g.mod);
    if (e) e.usado = true;
    const movs = new Map();
    const parcelas = g.parcelas.map(p => {
      const ms = p.ms || [];
      for (const m of ms) if (m.mov) movs.set(m.mov.lancto, { ...m.mov, org: m.org });
      const valMov = r2(ms.reduce((s, m) => s + (m.mov ? m.mov.valor : 0), 0));
      const tarMega = r2(ms.reduce((s, m) => s + m.tarifa, 0));
      return { venda: p.venda, parcela: p.parcela, parcelas: p.parcelas, nsu: p.nsu, bruto: p.bruto, mdr: p.mdr, liquido: p.liquido,
        mega: ms.length ? { docs: ms.map(m => m.doc).join(' + '), parcela: ms[0].parcela, valor: r2(ms.reduce((s, m) => s + m.valor, 0)), baixa: ms[0].baixa, tarifa: tarMega,
          movimento: valMov, lanctos: ms.map(m => m.mov?.lancto).filter(Boolean), sem_movimento: ms.some(m => !m.mov), conciliado: ms.some(m => m.mov?.conciliado) } : null,
        obs: !ms.length ? 'sem baixa no Mega' : p.soma ? '1 parcela da Rede = 2 titulos do Mega' : p.semParcela ? 'casada sem o numero da parcela' : '',
        dif: ms.length ? r2(valMov - p.liquido) : null,
        tarifa_faltante: ms.length && tarMega === 0 && p.mdr > 0 && Math.abs(valMov - p.bruto) <= TOL_VALOR + 1e-9 ? p.mdr : 0 };
    });
    const lista = [...movs.values()];
    const somaMov = r2(lista.reduce((s, m) => s + m.valor, 0));
    const ajustesDia = ajustes.filter(a => a.data === g.data);
    const valorBanco = e ? e.valor : valorRede;
    const motivos = [];
    const semPar = parcelas.filter(p => !p.mega).length;
    if (semPar) motivos.push(`${semPar} parcela(s) sem baixa no Mega`);
    if (parcelas.some(p => p.mega?.sem_movimento)) motivos.push('baixa sem movimento no banco');
    if (parcelas.some(p => p.mega?.conciliado)) motivos.push('movimento do Mega ja conciliado em outro lote');
    if (e && lista.some(m => m.conta !== e.conta)) motivos.push('movimento do Mega em outra conta');
    if (Math.abs(somaParc - valorRede) >= 0.005) motivos.push(`parcelas da Rede (${somaParc.toFixed(2)}) diferente do deposito (${valorRede.toFixed(2)})` + (ajustesDia.length ? `: ajuste da Rede no dia (${ajustesDia.map(a => a.descricao.replace(/\s+/g, ' ').trim() + ' ' + a.liquido.toFixed(2)).join('; ')})` : ''));
    const tarifaFalt = r2(parcelas.reduce((s, p) => s + p.tarifa_faltante, 0));
    if (tarifaFalt > 0) motivos.push(`tarifa nao lancada no Mega: ${tarifaFalt.toFixed(2)}`);
    const datas = [...lista.map(m => m.data), ...(e ? [e.data] : [])].filter(Boolean).sort();
    if (datas.length && dias(datas[datas.length - 1], datas[0]) > janela) motivos.push(`datas com mais de ${janela} dias de distancia (${datas[0]} a ${datas[datas.length - 1]})`);
    const dif = r2(somaMov - valorBanco);
    let situacao;
    if (e && (e.status === 'S' || e.con)) situacao = 'CONCILIADO';
    else if (semPar || parcelas.some(p => p.mega?.sem_movimento || p.mega?.conciliado) || (e && lista.some(m => m.conta !== e.conta)) || !lista.length) situacao = 'PENDENTE';
    else if (Math.abs(dif) < 0.005 && !motivos.some(m => /datas/.test(m))) situacao = e ? 'PRONTO' : 'SEM_EXTRATO';
    else situacao = e ? 'DIFERENCA' : 'SEM_EXTRATO';
    if (situacao === 'DIFERENCA' && !motivos.length) motivos.push(`diferenca de ${dif.toFixed(2)} sem causa identificada`);
    if (situacao === 'CONCILIADO') motivos.length = 0;
    depositos.push({ chave: g.chave, data: g.data, bandeira: g.bandeira, modalidade: g.mod === 'D' ? 'debito' : 'credito', situacao,
      rede: { valor: valorRede, parcelas: parcelas.length, soma_parcelas: somaParc, status: g.rede.map(d => d.status).join(', ') },
      extrato: e ? { cba: e.cba, conta: e.conta, data: e.data, valor: e.valor, historico: e.historico, status: e.status } : null,
      mega: { movimentos: lista.length, soma: somaMov, org: lista[0]?.org || null, conta: lista[0]?.conta || null },
      dif, tarifa_faltante: tarifaFalt, ajuste_rede: r2(somaParc - valorRede), motivos, parcelas,
      movs: lista.map(m => ({ seq: m.seq, lancto: m.lancto, valor: m.valor, data: m.data, conciliado: m.conciliado })) });
  }
  // linhas REDE do extrato sem deposito importado (periodo do relatorio da Rede nao cobre)
  for (const e of ext) if (!e.usado && e.data >= ini && e.data <= fim)
    depositos.push({ chave: `${e.data}|${e.band}|${e.mod}|${e.cba}`, data: e.data, bandeira: e.band, modalidade: e.mod === 'D' ? 'debito' : 'credito',
      situacao: e.status === 'S' || e.con ? 'CONCILIADO' : 'SO_EXTRATO', rede: null, extrato: { cba: e.cba, conta: e.conta, data: e.data, valor: e.valor, historico: e.historico, status: e.status },
      mega: null, dif: null, tarifa_faltante: 0, ajuste_rede: 0, motivos: e.status === 'S' || e.con ? [] : ['deposito da Rede nao encontrado no relatorio importado'], parcelas: [], movs: [] });
  depositos.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : a.chave < b.chave ? -1 : 1));
  const resumo = {};
  for (const k of Object.keys(SITUACOES_DEP)) {
    const xs = depositos.filter(d => d.situacao === k);
    resumo[k] = { rotulo: SITUACOES_DEP[k], depositos: xs.length, valor: r2(xs.reduce((s, d) => s + (d.extrato ? d.extrato.valor : d.rede?.valor || 0), 0)) };
  }
  const extMax = ext.map(e => e.data).sort().pop() || null;
  return { filial: fil, periodo: { ini, fim }, extrato_ate: extMax, janela_dias: janela,
    totais: { tarifa_faltante: r2(depositos.reduce((s, d) => s + d.tarifa_faltante, 0)), ajuste_rede: r2(depositos.reduce((s, d) => s + (d.ajuste_rede || 0), 0)) },
    resumo, depositos };
}
