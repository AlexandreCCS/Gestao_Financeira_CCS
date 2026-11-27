// [19/11/2026 - CRIADO POR ALEXANDRE CARVALHO] CONCILIACAO BANCARIA - CARTAO: CONFERENCIA DO CREDITO (Rede x Mega), POR FILIAL. SO LEITURA.
// Decisoes do Alexandre (19/11): a baixa automatica do credito continua na venda com data futura, no Itau da loja; comecar pela 404 (Gravata).
// Unidade = PARCELA. Rede: linhas importadas do relatorio de recebimentos (CCS_TB_GFIN_CBC_LINHA, abas P pagas e F futuras, modalidade credito).
// Mega: parcelas de cartao credito baixadas pela baixa automatica (CCS_TB_LOG_BAIXA_AUTO, forma CREDITO nX, nao estornadas) + titulo
// (FIN_MOVIMENTO: data do documento = data da venda, vencimento) + tarifa 956 da parcela + bandeira do historico da baixa.
// Casamento (o caixa nao grava NSU: TEF desligado): data da venda (+-1 dia) + no da parcela + valor (+-R$ 0,02); 2a passada sem o no da parcela.
// 3a passada (soma de dois): 1 transacao da Rede = 2 titulos do Mega (uma maquininha, dois pedidos no caixa) ou 2 transacoes da Rede = 1 titulo
//   (dois cartoes, um pedido). Mesmo no da parcela, vendas a ate 7 dias, soma com tolerancia de R$ 0,05.
// Situacoes: AGRUPADA | CONCILIADA | DIF_CENTAVO | DIF_DATA (pagamento a mais de 5 dias da baixa do Mega) | DIF_PARCELA | SO_REDE | SO_MEGA | FUTURA | FUTURA_SO_REDE.
// Medido em 19/11 (404, novembro): 16 de 23 casam pela parcela; 2 "so na Rede" eram vendas lancadas por fora do caixa com o valor cheio.
const num = v => Number(v || 0);
const r2 = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const iso = s => (s ? String(s).slice(0, 10) : null);
const dias = (a, b) => Math.round((new Date(a + 'T12:00:00Z') - new Date(b + 'T12:00:00Z')) / 86400000);
const addDias = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const D = s => `TO_DATE('${s}','YYYY-MM-DD')`;
const TOL_VALOR = 0.02, TOL_VENDA = 1, TOL_DATA = 5;
export const SITUACOES = {
  CONCILIADA: 'conciliada', AGRUPADA: 'conciliada por soma', DIF_CENTAVO: 'diferença de centavo', DIF_DATA: 'diferença de data', DIF_PARCELA: 'parcela diferente',
  SO_REDE: 'só na Rede', SO_MEGA: 'só no Mega', FUTURA: 'futura (prevista)', FUTURA_SO_REDE: 'futura sem parcela no Mega',
};

export async function conferirCredito(megaQuery, fil) {
  fil = num(fil);
  if (!fil) throw Object.assign(new Error('Informe a filial.'), { statusCode: 400 });
  // ---------------------------------------------------------------- Rede (importado)
  const rede = (await megaQuery(`SELECT L.ARQ_IN_CODIGO ARQ, L.LIN_IN_ORDEM ORD, L.LIN_CH_ABA ABA, TO_CHAR(L.LIN_DT_DATA,'YYYY-MM-DD') PAGTO, TO_CHAR(L.LIN_DT_VENDA,'YYYY-MM-DD') VENDA,
      L.LIN_IN_PARCELA PARC, L.LIN_IN_PARCELAS PARCS, L.LIN_ST_BANDEIRA BAND, L.LIN_RE_BRUTO BRUTO, L.LIN_RE_MDR MDR, L.LIN_RE_LIQUIDO LIQ, L.LIN_ST_NSU NSU, L.LIN_ST_AUTORIZACAO AUT
      FROM MEGA.CCS_TB_GFIN_CBC_LINHA L WHERE L.FIL_IN_CODIGO = ${fil} AND L.LIN_CH_SITUACAO = 'I' AND L.LIN_CH_ABA IN ('P','F') AND LOWER(L.LIN_ST_MODALIDADE) = 'credito'
      ORDER BY L.LIN_DT_DATA, L.LIN_DT_VENDA, L.ARQ_IN_CODIGO, L.LIN_IN_ORDEM`)).map(x => ({
    arq: num(x.ARQ), ordem: num(x.ORD), aba: x.ABA, pagto: iso(x.PAGTO), venda: iso(x.VENDA), parcela: num(x.PARC) || 1, parcelas: num(x.PARCS) || 1,
    bandeira: x.BAND || '', bruto: r2(x.BRUTO), mdr: r2(x.MDR), liquido: r2(x.LIQ), nsu: x.NSU || '', autorizacao: x.AUT || '' }));
  if (!rede.length) return { filial: fil, periodo: null, resumo: {}, linhas: [], aviso: 'Nenhuma parcela de credito importada nesta filial (importe o relatorio de recebimentos da Rede).' };
  const pagas = rede.filter(r => r.aba === 'P').map(r => r.pagto).sort();
  const vendas = rede.map(r => r.venda).filter(Boolean).sort();
  const periodo = { ini: pagas[0] || null, fim: pagas[pagas.length - 1] || null };
  const vIni = addDias(vendas[0], -2), vFim = addDias(vendas[vendas.length - 1], 2);
  const bIni = periodo.ini || rede[0].pagto, bFim = addDias(rede.map(r => r.pagto).sort().pop(), 5);
  // ---------------------------------------------------------------- Mega (parcelas de cartao credito baixadas pela baixa automatica)
  const mega = (await megaQuery(`SELECT B.LOG_IN_CODIGO ID, B.MOV_ST_DOCUMENTO DOC, B.MOV_ST_PARCELA PARC, B.MOV_RE_VALOR VLR, B.FORMA_PAGAMENTO FORMA,
      TO_CHAR(M.MOV_DT_DATADOCTO,'YYYY-MM-DD') VENDA, TO_CHAR(M.MOV_DT_VENCTO,'YYYY-MM-DD') VENC, TO_CHAR(B.DT_BAIXA,'YYYY-MM-DD') BX, B.CLI_IN_CODIGO CLI,
      (SELECT NVL(SUM(T.MOV_RE_VALORMOE),0) FROM MEGA.FIN_MOVIMENTO T WHERE T.ORG_IN_CODIGO = B.ORG_IN_CODIGO AND T.FIL_IN_CODIGO = B.FIL_IN_CODIGO AND T.ACAO_IN_CODIGO = 956
          AND T.MOV_ST_DOCUMENTO = B.MOV_ST_DOCUMENTO AND T.MOV_ST_PARCELA = B.MOV_ST_PARCELA AND TRUNC(T.MOV_DT_DATADOCTO) = TRUNC(B.DT_BAIXA)) TARIFA,
      (SELECT MAX(CASE WHEN INSTR(X.MOV_ST_COMPLHIST, 'BANDEIRA:') > 0 THEN SUBSTR(X.MOV_ST_COMPLHIST, INSTR(X.MOV_ST_COMPLHIST, 'BANDEIRA:') + 9, 20) END) FROM MEGA.FIN_MOVIMENTO X WHERE X.MOV_IN_NUMLANCTO = B.LANCTO_BX AND X.ORG_IN_CODIGO = B.ORG_IN_CODIGO) BAND
      FROM MEGA.CCS_TB_LOG_BAIXA_AUTO B, MEGA.FIN_MOVIMENTO M
      WHERE B.FIL_IN_CODIGO = ${fil} AND NVL(B.ESTORNADO,'N') <> 'S' AND UPPER(B.FORMA_PAGAMENTO) LIKE 'CREDITO%'
        AND M.MOV_IN_NUMLANCTO = B.MOV_IN_NUMLANCTO AND M.ORG_IN_CODIGO = B.ORG_IN_CODIGO
        AND (M.MOV_DT_DATADOCTO BETWEEN ${D(vIni)} AND ${D(vFim)} OR B.DT_BAIXA BETWEEN ${D(addDias(bIni, -10))} AND ${D(bFim)})`)).map(x => ({
    id: num(x.ID), doc: x.DOC || '', parcela: num(String(x.PARC || '').replace(/\D/g, '')) || 1, valor: r2(x.VLR), forma: x.FORMA || '', venda: iso(x.VENDA),
    vencto: iso(x.VENC), baixa: iso(x.BX), cliente: num(x.CLI), tarifa: r2(x.TARIFA), bandeira: String(x.BAND || '').replace(/[^A-Za-z ]/g, '').trim(), usada: false }));
  // ---------------------------------------------------------------- casamento
  const melhor = (r, comParcela) => {
    let best = null, nota = Infinity;
    for (const m of mega) {
      if (m.usada || !m.venda || Math.abs(m.valor - r.bruto) > TOL_VALOR + 1e-9 || Math.abs(dias(m.venda, r.venda)) > TOL_VENDA) continue;
      if (comParcela && m.parcela !== r.parcela) continue;
      const n = Math.abs(dias(m.venda, r.venda)) * 100 + Math.abs(dias(r.pagto, m.baixa || r.pagto)) + (m.valor === r.bruto ? 0 : 0.5);
      if (n < nota) { nota = n; best = m; }
    }
    return best;
  };
  const linhas = [];
  for (const passada of [true, false]) {
    for (const r of rede) {
      if (r.m !== undefined) continue;
      const m = melhor(r, passada);
      if (m) { m.usada = true; r.m = m; r.semParcela = !passada; }
    }
  }
  // 3a passada: soma de dois
  const TOL_SOMA = 0.05, JAN = 7;
  const perto = (a, b) => a && b && Math.abs(dias(a, b)) <= JAN;
  for (const r of rede) {
    if (r.m) continue;
    const ms = mega.filter(m => !m.usada && m.parcela === r.parcela && perto(m.venda, r.venda));
    achou: for (let i = 0; i < ms.length; i++) for (let j = i + 1; j < ms.length; j++)
      if (Math.abs(ms[i].valor + ms[j].valor - r.bruto) <= TOL_SOMA) { ms[i].usada = ms[j].usada = true; r.grupo = { mega: [ms[i], ms[j]] }; break achou; }
  }
  for (const m of mega) {
    if (m.usada) continue;
    const rs = rede.filter(r => !r.m && !r.grupo && r.parcela === m.parcela && perto(r.venda, m.venda));
    achou2: for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++)
      if (Math.abs(rs[i].bruto + rs[j].bruto - m.valor) <= TOL_SOMA) { m.usada = true; rs[i].grupo = rs[j].grupo = { mega: [m], par: true }; break achou2; }
  }
  const mOut = m => ({ doc: m.doc, parcela: m.parcela, valor: m.valor, forma: m.forma, venda: m.venda, vencto: m.vencto, baixa: m.baixa, tarifa: m.tarifa, bandeira: m.bandeira, cliente: m.cliente });
  for (const r of rede) {
    const m = r.m || null;
    let sit;
    if (r.grupo) {
      const ms = r.grupo.mega, soma = r2(ms.reduce((s, x) => s + x.valor, 0));
      linhas.push({ situacao: 'AGRUPADA', rede: { aba: r.aba, pagto: r.pagto, venda: r.venda, parcela: r.parcela, parcelas: r.parcelas, bandeira: r.bandeira, bruto: r.bruto, mdr: r.mdr, liquido: r.liquido, nsu: r.nsu, autorizacao: r.autorizacao },
        mega: { ...mOut(ms[0]), doc: ms.map(x => x.doc).join(' + '), valor: soma, tarifa: r2(ms.reduce((s, x) => s + x.tarifa, 0)) },
        dif: { valor: r.grupo.par ? null : r2(r.bruto - soma), dias: ms[0].baixa ? dias(r.pagto, ms[0].baixa) : null, taxa: null },
        dica: r.grupo.par ? `2 transacoes da Rede (dois cartoes) = 1 titulo do Mega (doc ${ms[0].doc}, R$ ${soma.toFixed(2)})` : `1 transacao da Rede = ${ms.length} titulos do Mega (uma maquininha, dois pedidos no caixa)` });
      continue;
    }
    if (!m) sit = r.aba === 'F' ? 'FUTURA_SO_REDE' : 'SO_REDE';
    else if (r.aba === 'F') sit = 'FUTURA';
    else if (r.semParcela) sit = 'DIF_PARCELA';
    else if (Math.abs(dias(r.pagto, m.baixa)) > TOL_DATA) sit = 'DIF_DATA';
    else if (m.valor !== r.bruto) sit = 'DIF_CENTAVO';
    else sit = 'CONCILIADA';
    linhas.push({ situacao: sit, rede: { aba: r.aba, pagto: r.pagto, venda: r.venda, parcela: r.parcela, parcelas: r.parcelas, bandeira: r.bandeira, bruto: r.bruto, mdr: r.mdr, liquido: r.liquido, nsu: r.nsu, autorizacao: r.autorizacao },
      mega: m ? { doc: m.doc, parcela: m.parcela, valor: m.valor, forma: m.forma, venda: m.venda, vencto: m.vencto, baixa: m.baixa, tarifa: m.tarifa, bandeira: m.bandeira, cliente: m.cliente } : null,
      dif: m ? { valor: r2(r.bruto - m.valor), dias: m.baixa ? dias(r.pagto, m.baixa) : null, taxa: r2(r.mdr - m.tarifa) } : null });
  }
  // so no Mega: baixa de credito com data dentro do periodo pago pela Rede (folga de 5 dias no fim: a Rede paga 1 a 4 dias depois)
  if (periodo.ini) {
    const fimSoMega = addDias(periodo.fim, -TOL_DATA);
    for (const m of mega) if (!m.usada && m.baixa && m.baixa >= periodo.ini && m.baixa <= fimSoMega)
      linhas.push({ situacao: 'SO_MEGA', rede: null, mega: { doc: m.doc, parcela: m.parcela, valor: m.valor, forma: m.forma, venda: m.venda, vencto: m.vencto, baixa: m.baixa, tarifa: m.tarifa, bandeira: m.bandeira, cliente: m.cliente }, dif: null });
  }
  // dica para "so na Rede": venda lancada por fora do caixa (adiantamento / lancamento manual com o valor cheio ou da parcela)
  for (const l of linhas.filter(x => x.situacao === 'SO_REDE' || x.situacao === 'FUTURA_SO_REDE')) {
    const r = l.rede, cheio = r2(r.bruto * r.parcelas);
    const f = await megaQuery(`SELECT * FROM (SELECT M.MOV_ST_DOCUMENTO DOC, M.TPD_ST_CODIGO TPD, M.ACAO_IN_CODIGO ACAO, M.MOV_RE_VALORMOE VLR, TO_CHAR(M.MOV_DT_DATADOCTO,'YYYY-MM-DD') DT, SUBSTR(M.MOV_ST_COMPLHIST,1,60) H
        FROM MEGA.FIN_MOVIMENTO M WHERE M.FIL_IN_CODIGO = ${fil} AND M.MOV_CH_NATUREZA = 'D' AND M.MOV_DT_DATADOCTO BETWEEN ${D(addDias(r.venda, -2))} AND ${D(addDias(r.venda, 2))}
          AND (ABS(M.MOV_RE_VALORMOE - ${cheio}) <= ${r2(0.03 * r.parcelas)} OR ABS(M.MOV_RE_VALORMOE - ${r.bruto}) <= ${TOL_VALOR})
          AND M.ACAO_IN_CODIGO NOT IN (246) ORDER BY ABS(M.MOV_RE_VALORMOE - ${cheio})) WHERE ROWNUM <= 1`).catch(() => []);
    if (f[0]) l.dica = `possivel lancamento por fora do caixa: doc ${f[0].DOC} (${f[0].TPD}, acao ${f[0].ACAO}) R$ ${r2(f[0].VLR).toFixed(2)} em ${f[0].DT}${f[0].H ? ' "' + String(f[0].H).trim() + '"' : ''}`;
  }
  // ---------------------------------------------------------------- resumo
  const resumo = {};
  for (const k of Object.keys(SITUACOES)) {
    const xs = linhas.filter(l => l.situacao === k);
    resumo[k] = { rotulo: SITUACOES[k], parcelas: xs.length, valor: r2(xs.reduce((s, l) => s + (l.rede ? l.rede.bruto : l.mega.valor), 0)) };
  }
  const pagasL = linhas.filter(l => l.rede?.aba === 'P');
  const casadas = pagasL.filter(l => l.mega);
  return {
    filial: fil, periodo,
    totais: {
      rede_pagas: { parcelas: pagasL.length, bruto: r2(pagasL.reduce((s, l) => s + l.rede.bruto, 0)), taxa: r2(pagasL.reduce((s, l) => s + l.rede.mdr, 0)), liquido: r2(pagasL.reduce((s, l) => s + l.rede.liquido, 0)) },
      rede_futuras: { parcelas: linhas.filter(l => l.rede?.aba === 'F').length, bruto: r2(linhas.filter(l => l.rede?.aba === 'F').reduce((s, l) => s + l.rede.bruto, 0)) },
      taxa_casadas: { rede: r2(casadas.reduce((s, l) => s + l.rede.mdr, 0)), mega_956: r2(casadas.reduce((s, l) => s + l.mega.tarifa, 0)) },
    },
    resumo, linhas,
  };
}
