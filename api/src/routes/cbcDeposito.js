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
// [27/11/2026] Pedido do Alexandre: "os titulos que voce encontrar baixados ja vamos apenas conciliar, os titulos que nao tiverem baixados tem
// que buscar a correlacao e fazer a baixa (igual acontece hoje com a conciliacao normal) ... essa baixa deve ter a acao de desconto referente a
// taxa". Por parcela da Rede: (1) baixa automatica (como antes); (2) baixa A MAO: movimento CARDEB/CARCRED na conta da loja, nao conciliado,
// com o LIQUIDO da parcela; (3) titulo a receber EM ABERTO da filial com saldo = BRUTO da parcela (emitido ate o dia da venda): 1 candidato =
// BAIXAR pelo liquido com a taxa (MDR) na acao 956 (CCS_P_GFIN_BXC, sql/45); varios = DECIDIR (o usuario escolhe). Diferenca de data deixou
// de bloquear (a parcela baixada a mao pode ter outra data): vira aviso.
export const SITUACOES_DEP = {
  PRONTO: 'pronto para conciliar', DECIDIR: 'escolher o título', DIFERENCA: 'diferença (sinalizada)', PENDENTE: 'pendente', CONCILIADO: 'já conciliado', SEM_EXTRATO: 'aguardando extrato do Itaú',
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
  const ext = (await megaQuery(`SELECT C.CBA_IN_SEQUENCIA SEQ, C.AGN_IN_CODIGO AGN, C.FIL_IN_CODIGO FIL, C.ORG_IN_CODIGO ORG, TO_CHAR(C.CBA_DT_DATA,'YYYY-MM-DD') DT, C.CBA_CH_NATUREZA NAT, C.CBA_RE_VALOR V,
      C.CBA_ST_HISTORICO H, NVL(C.CBA_CH_STATUS,'N') ST, C.CON_IN_SEQUENCIAL CON
      FROM MEGA.FIN_CONCILIACAO C WHERE C.CBA_DT_DATA BETWEEN ${D(addDias(ini, -3))} AND ${D(addDias(fim, 3))} AND UPPER(C.CBA_ST_HISTORICO) LIKE 'REDE%'
        AND (${estabs.map(e => `C.CBA_ST_HISTORICO LIKE '%${e}%'`).join(' OR ')})`)).map(x => {
    const m = String(x.H || '').toUpperCase().match(/^REDE\s+([A-Z]+)\s*(CD|DB)\s*0*(\d+)/);
    return { cba: num(x.SEQ), conta: num(x.AGN), fil: num(x.FIL), org: num(x.ORG), data: iso(x.DT), natureza: x.NAT, valor: r2(x.V), historico: String(x.H || '').trim(), status: x.ST, con: x.CON ? num(x.CON) : null,
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
  // ---------------------------------------------------------------- [27/11/2026] parcela sem baixa automatica: baixa a mao ou titulo em aberto
  // conta e org da loja tambem pelo cadastro (Configurar > Loja; org = PAI da filial): deposito sem extrato importado ainda acha os titulos
  const loja = (await megaQuery(`SELECT K.AGN_IN_CODIGO CTA, (SELECT MAX(A.PAI_AGN_IN_CODIGO) FROM MEGA.GLO_AGENTES A WHERE A.AGN_TAB_IN_CODIGO = 53 AND A.AGN_IN_CODIGO = K.FIL_IN_CODIGO) ORG
      FROM MEGA.CCS_TB_GFIN_BXC_CONTA K WHERE K.FIL_IN_CODIGO = ${fil} AND K.CTA_CH_ATIVA = 'S' AND NVL(K.CTA_CH_LOJA,'N') = 'S'`)).map(x => ({ conta: num(x.CTA), org: num(x.ORG) }));
  const contas = [...new Set([...ext.map(e => e.conta), ...loja.map(l => l.conta)])];
  const usadosAuto = new Set(mega.filter(m => m.usada && m.mov).map(m => m.mov.lancto));
  const semAuto = pags.filter(r => !r.ms);
  if (semAuto.length && contas.length) {
    const manuais = (await megaQuery(`SELECT M.ORG_IN_CODIGO ORG, M.MOV_SEQ_IN_CODIGO SEQ, M.MOV_IN_NUMLANCTO LAN, M.AGN_IN_CODIGO AGN, M.MOV_RE_VALOR V, TO_CHAR(M.MOV_DT_DATADOCTO,'YYYY-MM-DD') DT, M.TPD_ST_CODIGO TPD,
        (SELECT MAX(B.MOV_ST_DOCUMENTO || '-' || B.MOV_ST_PARCELA) FROM MEGA.FIN_MOVIMENTO B WHERE B.ORG_IN_CODIGO = M.ORG_IN_CODIGO AND B.ACAOM_IN_SEQUENCIA = M.ACAOM_IN_SEQUENCIA AND B.TREF_ST_CODIGO = 'BXCRE') TIT,
        (SELECT MAX(B.AGN_IN_CODIGO) FROM MEGA.FIN_MOVIMENTO B WHERE B.ORG_IN_CODIGO = M.ORG_IN_CODIGO AND B.ACAOM_IN_SEQUENCIA = M.ACAOM_IN_SEQUENCIA AND B.TREF_ST_CODIGO = 'BXCRE') CLI
        FROM MEGA.FIN_MOVIMENTO M WHERE M.AGN_IN_CODIGO IN (${contas.join(',')}) AND M.CONT_TAC_ST_CODIGO = 'MVFIN' AND M.MOV_CH_NATUREZA = 'D' AND M.TPD_ST_CODIGO IN ('CARDEB','CARCRED')
          AND NVL(M.MOV_CH_CONCILIADO,'N') <> 'S' AND M.CON_IN_SEQUENCIAL IS NULL AND NVL(M.MOV_CH_SITUACAO,'N') <> 'C' AND M.MOV_DT_DATADOCTO >= ${D(pIni)}`))
      .map(x => ({ org: num(x.ORG), seq: num(x.SEQ), lancto: num(x.LAN), conta: num(x.AGN), valor: r2(x.V), data: iso(x.DT), mod: x.TPD === 'CARDEB' ? 'D' : 'C', titulo: x.TIT || '', cliente: num(x.CLI), conciliado: false }))
      .filter(m => !usadosAuto.has(m.lancto));
    for (const r of semAuto) {
      let best = null;
      for (const m of manuais) if (!m.usado && m.mod === r.mod && Math.abs(m.valor - r.liquido) <= TOL_VALOR + 1e-9 && (!r.venda || m.data >= addDias(r.venda, -1)))
        if (!best || Math.abs(dias(m.data, r.data)) < Math.abs(dias(best.data, r.data))) best = m;
      if (best) { best.usado = true; r.manual = best; }
    }
    const faltam = semAuto.filter(r => !r.manual);
    if (faltam.length) {
      const orgs = [...new Set([...ext.map(e => e.org), ...loja.map(l => l.org)].filter(Boolean))];
      // saldo do titulo = BRUTO (taxa ainda nao lancada: baixa liquido + 956) ou = LIQUIDO (a taxa 956 ja foi lancada a mao: baixa so o liquido)
      const bMin = Math.min(...faltam.map(r => r.liquido)) - TOL_VALOR, bMax = Math.max(...faltam.map(r => r.bruto)) + TOL_VALOR;
      const sqlAbertos = filtro => `SELECT M.ORG_IN_CODIGO ORG, M.MOV_SEQ_IN_CODIGO SEQ, M.MOV_IN_NUMLANCTO LAN, M.MOV_ST_DOCUMENTO DOC, M.MOV_ST_PARCELA PARC, M.MOV_RE_SALDOCPACRE SALDO, M.AGN_IN_CODIGO AGN,
          TO_CHAR(M.MOV_DT_DATADOCTO,'YYYY-MM-DD') EMI, TO_CHAR(M.MOV_DT_VENCTO,'YYYY-MM-DD') VENC, M.TPD_ST_CODIGO TPD,
          (SELECT SUBSTR(MAX(A.AGN_ST_NOME),1,50) FROM MEGA.GLO_AGENTES A WHERE A.AGN_TAB_IN_CODIGO = M.AGN_TAB_IN_CODIGO AND A.AGN_PAD_IN_CODIGO = M.AGN_PAD_IN_CODIGO AND A.AGN_IN_CODIGO = M.AGN_IN_CODIGO) NOME
          FROM MEGA.FIN_MOVIMENTO M WHERE M.FIL_IN_CODIGO = ${fil} AND M.ORG_IN_CODIGO IN (${orgs.join(',')}) AND EXISTS (SELECT 1 FROM MEGA.FIN_CONTASRECEBER CR WHERE CR.ORG_IN_CODIGO = M.ORG_IN_CODIGO AND CR.MOV_TAB_IN_CODIGO = M.MOV_TAB_IN_CODIGO AND CR.MOV_SEQ_IN_CODIGO = M.MOV_SEQ_IN_CODIGO AND CR.MOV_IN_NUMLANCTO = M.MOV_IN_NUMLANCTO) AND NVL(M.MOV_BO_SALDOZERADO,'N') = 'N'
            AND NVL(M.MOV_CH_SITUACAO,'N') <> 'C' AND NVL(M.MOV_BO_PREVISAO,'N') = 'N' AND M.MOV_RE_SALDOCPACRE > 0 AND ${filtro}`;
      const mapTit = x => ({ org: num(x.ORG), seq: num(x.SEQ), lancto: num(x.LAN), doc: x.DOC || '', parcela: x.PARC || '', saldo: r2(x.SALDO), cliente: num(x.AGN), nome: x.NOME || '', emissao: iso(x.EMI), vencto: iso(x.VENC), tpd: x.TPD || '' });
      const abertos = (await megaQuery(sqlAbertos(`M.MOV_RE_SALDOCPACRE BETWEEN ${bMin.toFixed(2)} AND ${bMax.toFixed(2)} AND M.MOV_DT_DATADOCTO BETWEEN ${D(addDias(pIni, -150))} AND ${D(pFim)}`))).map(mapTit);
      const cands = r => abertos.filter(t => !t.usado && (Math.abs(t.saldo - r.bruto) <= TOL_VALOR + 1e-9 || Math.abs(t.saldo - r.liquido) <= TOL_VALOR + 1e-9) && (!r.venda || !t.emissao || t.emissao <= addDias(r.venda, 1)));
      const esc = opc.escolhas || {};
      // escolhas do usuario primeiro, depois as de candidato unico, por fim as ambiguas
      // [27/11/2026] escolha da busca "Buscar no contas a receber": qualquer titulo em aberto da filial com saldo >= liquido. Saldo maior que o
      // bruto = BAIXA PARCIAL (titulo pago parte no cartao, parte em dinheiro): baixa o liquido + taxa 956 e o resto fica em aberto.
      for (const r of faltam) {
        const e = esc[r.nsu]; if (!e) continue;
        const [sq, ln] = String(e).split(':').map(Number);
        if (!sq || !ln) continue;
        let t = abertos.find(x => !x.usado && x.seq === sq && x.lancto === ln);
        if (!t) t = (await megaQuery(sqlAbertos(`M.MOV_SEQ_IN_CODIGO = ${sq} AND M.MOV_IN_NUMLANCTO = ${ln}`))).map(mapTit)[0];
        if (t && !t.usado && t.saldo >= r.liquido - TOL_VALOR) { t.usado = true; r.titulo = t; r.escolhido = true; }
        else r.escolhaInvalida = true;
      }
      for (const r of faltam) { if (r.titulo) continue; const c = cands(r); if (c.length === 1) { c[0].usado = true; r.titulo = c[0]; } }
      for (const r of faltam) { if (r.titulo) continue; const c = cands(r); if (c.length > 1) r.candidatos = c.slice(0, 15); }
    }
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
    const movs = new Map(), baixas = [];
    const parcelas = g.parcelas.map(p => {
      const ms = p.ms || [];
      for (const m of ms) if (m.mov) movs.set(m.mov.lancto, { ...m.mov, org: m.org });
      // [27/11/2026] baixada a mao (movimento existente) | titulo a baixar | escolher o titulo
      if (!ms.length && p.manual) {
        movs.set(p.manual.lancto, { seq: p.manual.seq, lancto: p.manual.lancto, conta: p.manual.conta, valor: p.manual.valor, data: p.manual.data, conciliado: false, tpd: p.manual.mod === 'D' ? 'CARDEB' : 'CARCRED', org: p.manual.org });
        return { venda: p.venda, parcela: p.parcela, parcelas: p.parcelas, nsu: p.nsu, bruto: p.bruto, mdr: p.mdr, liquido: p.liquido, acao: 'MANUAL',
          mega: { docs: p.manual.titulo, parcela: p.parcela, valor: p.manual.valor, baixa: p.manual.data, tarifa: 0, movimento: p.manual.valor, lanctos: [p.manual.lancto], sem_movimento: false, conciliado: false },
          obs: `baixada a mao em ${p.manual.data} (titulo ${p.manual.titulo || '?'}): so concilia`, dif: r2(p.manual.valor - p.liquido), tarifa_faltante: 0 };
      }
      if (!ms.length && p.titulo) {
        const taxaJa = Math.abs(p.titulo.saldo - p.liquido) <= TOL_VALOR + 1e-9 && Math.abs(p.titulo.saldo - p.bruto) > TOL_VALOR + 1e-9;   // 956 ja lancada a mao
        // saldo entre o liquido e o bruto (taxa parcial?): nao da para saber o que falta, so baixa o liquido sem 956
        const desc = taxaJa || p.titulo.saldo < p.bruto - TOL_VALOR ? 0 : r2(p.bruto - p.liquido);
        const resta = r2(p.titulo.saldo - p.liquido - desc);
        baixas.push({ seq: p.titulo.seq, lancto: p.titulo.lancto, org: p.titulo.org, valor: p.liquido, desconto: desc, doc: p.titulo.doc, parcela: p.titulo.parcela, cliente: p.titulo.cliente, nsu: p.nsu });
        return { venda: p.venda, parcela: p.parcela, parcelas: p.parcelas, nsu: p.nsu, bruto: p.bruto, mdr: p.mdr, liquido: p.liquido, acao: 'BAIXAR',
          titulo: { seq: p.titulo.seq, lancto: p.titulo.lancto, doc: p.titulo.doc, parcela: p.titulo.parcela, saldo: p.titulo.saldo, cliente: p.titulo.cliente, nome: p.titulo.nome, emissao: p.titulo.emissao, escolhido: !!p.escolhido },
          mega: null, taxa_ja_lancada: taxaJa, resta: resta > TOL_VALOR ? resta : 0,
          obs: `baixar ${p.titulo.doc}-${p.titulo.parcela} (${p.titulo.nome}): ${p.liquido.toFixed(2)} no banco` + (taxaJa ? ' (taxa 956 ja lancada no titulo)' : desc ? ` + taxa ${desc.toFixed(2)} na acao 956` : '')
            + (resta > TOL_VALOR ? ` · BAIXA PARCIAL: ficam ${resta.toFixed(2)} em aberto (ex.: parte em dinheiro)` : ''), dif: 0, tarifa_faltante: 0 };
      }
      if (!ms.length && p.candidatos) {
        return { venda: p.venda, parcela: p.parcela, parcelas: p.parcelas, nsu: p.nsu, bruto: p.bruto, mdr: p.mdr, liquido: p.liquido, acao: 'DECIDIR',
          candidatos: p.candidatos.map(t => ({ id: `${t.seq}:${t.lancto}`, doc: t.doc, parcela: t.parcela, saldo: t.saldo, cliente: t.cliente, nome: t.nome, emissao: t.emissao, vencto: t.vencto })),
          mega: null, obs: `${p.candidatos.length} titulos em aberto com o mesmo valor: escolha`, dif: null, tarifa_faltante: 0 };
      }
      const valMov = r2(ms.reduce((s, m) => s + (m.mov ? m.mov.valor : 0), 0));
      const tarMega = r2(ms.reduce((s, m) => s + m.tarifa, 0));
      return { venda: p.venda, parcela: p.parcela, parcelas: p.parcelas, nsu: p.nsu, bruto: p.bruto, mdr: p.mdr, liquido: p.liquido, acao: ms.length ? 'AUTO' : null,
        mega: ms.length ? { docs: ms.map(m => m.doc).join(' + '), parcela: ms[0].parcela, valor: r2(ms.reduce((s, m) => s + m.valor, 0)), baixa: ms[0].baixa, tarifa: tarMega,
          movimento: valMov, lanctos: ms.map(m => m.mov?.lancto).filter(Boolean), sem_movimento: ms.some(m => !m.mov), conciliado: ms.some(m => m.mov?.conciliado) } : null,
        obs: !ms.length ? (p.escolhaInvalida ? 'o titulo escolhido nao serve (ja usado, de outra filial ou com saldo menor que o liquido): busque outro' : 'sem baixa no Mega e nenhum titulo em aberto com este valor: use Buscar no contas a receber') : p.soma ? '1 parcela da Rede = 2 titulos do Mega' : p.semParcela ? 'casada sem o numero da parcela' : '',
        dif: ms.length ? r2(valMov - p.liquido) : null,
        tarifa_faltante: ms.length && tarMega === 0 && p.mdr > 0 && Math.abs(valMov - p.bruto) <= TOL_VALOR + 1e-9 ? p.mdr : 0 };
    });
    const lista = [...movs.values()];
    const somaMov = r2(lista.reduce((s, m) => s + m.valor, 0));
    const somaBaixar = r2(baixas.reduce((s, b) => s + b.valor, 0));
    const ajustesDia = ajustes.filter(a => a.data === g.data);
    const valorBanco = e ? e.valor : valorRede;
    const motivos = [];
    const semPar = parcelas.filter(p => !p.mega && !p.acao).length;
    const decidir = parcelas.filter(p => p.acao === 'DECIDIR').length;
    if (semPar) motivos.push(`${semPar} parcela(s) sem baixa no Mega e sem titulo em aberto do mesmo valor`);
    if (decidir) motivos.push(`${decidir} parcela(s) com mais de um titulo possivel: escolha`);
    if (baixas.length) motivos.push(`${baixas.length} titulo(s) a baixar (${somaBaixar.toFixed(2)}` + (baixas.some(b => b.desconto > 0) ? ` + taxa ${r2(baixas.reduce((t, b) => t + b.desconto, 0)).toFixed(2)} na acao 956)` : ')'));
    if (parcelas.some(p => p.mega?.sem_movimento)) motivos.push('baixa sem movimento no banco');
    if (parcelas.some(p => p.mega?.conciliado)) motivos.push('movimento do Mega ja conciliado em outro lote');
    if (e && lista.some(m => m.conta !== e.conta)) motivos.push('movimento do Mega em outra conta');
    if (e && baixas.some(b => b.org !== e.org)) motivos.push('titulo de outra organizacao');
    if (Math.abs(somaParc - valorRede) >= 0.005) motivos.push(`parcelas da Rede (${somaParc.toFixed(2)}) diferente do deposito (${valorRede.toFixed(2)})` + (ajustesDia.length ? `: ajuste da Rede no dia (${ajustesDia.map(a => a.descricao.replace(/\s+/g, ' ').trim() + ' ' + a.liquido.toFixed(2)).join('; ')})` : ''));
    const tarifaFalt = r2(parcelas.reduce((s, p) => s + p.tarifa_faltante, 0));
    if (tarifaFalt > 0) motivos.push(`tarifa nao lancada no Mega: ${tarifaFalt.toFixed(2)}`);
    const datas = [...lista.map(m => m.data), ...(e ? [e.data] : [])].filter(Boolean).sort();
    const espalho = datas.length ? dias(datas[datas.length - 1], datas[0]) : 0;
    // [27/11/2026] diferenca de data so avisa (parcela baixada a mao com outra data concilia do mesmo jeito; janela da conciliacao ate 60 dias)
    if (espalho > janela) motivos.push(`aviso: datas com ${espalho} dias de distancia (${datas[0]} a ${datas[datas.length - 1]})`);
    const dif = r2(somaMov + somaBaixar - valorBanco);
    let situacao;
    if (e && (e.status === 'S' || e.con)) situacao = 'CONCILIADO';
    else if (semPar || parcelas.some(p => p.mega?.sem_movimento || p.mega?.conciliado) || (e && lista.some(m => m.conta !== e.conta)) || (e && baixas.some(b => b.org !== e.org)) || (!lista.length && !baixas.length && !decidir)) situacao = 'PENDENTE';
    else if (decidir) situacao = 'DECIDIR';
    else if (Math.abs(dif) < 0.005 && espalho <= 60) situacao = e ? 'PRONTO' : 'SEM_EXTRATO';
    else situacao = e ? 'DIFERENCA' : 'SEM_EXTRATO';
    if (situacao === 'DIFERENCA' && !motivos.length) motivos.push(`diferenca de ${dif.toFixed(2)} sem causa identificada`);
    if (situacao === 'CONCILIADO') motivos.length = 0;
    depositos.push({ chave: g.chave, data: g.data, bandeira: g.bandeira, modalidade: g.mod === 'D' ? 'debito' : 'credito', situacao,
      rede: { valor: valorRede, parcelas: parcelas.length, soma_parcelas: somaParc, status: g.rede.map(d => d.status).join(', ') },
      extrato: e ? { cba: e.cba, conta: e.conta, org: e.org, data: e.data, valor: e.valor, historico: e.historico, status: e.status } : null,
      mega: { movimentos: lista.length, soma: somaMov, a_baixar: somaBaixar, org: lista[0]?.org || e?.org || null, conta: lista[0]?.conta || e?.conta || null },
      baixas, janela_conc: Math.max(janela, espalho + 1),
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
  return { filial: fil, periodo: { ini, fim }, extrato_ate: extMax, janela_dias: janela, conta_loja: loja.length === 1 ? loja[0] : null,
    totais: { tarifa_faltante: r2(depositos.reduce((s, d) => s + d.tarifa_faltante, 0)), ajuste_rede: r2(depositos.reduce((s, d) => s + (d.ajuste_rede || 0), 0)) },
    resumo, depositos };
}
