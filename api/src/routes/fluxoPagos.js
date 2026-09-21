// [21/09/2026 - Alexandre Carvalho] CONTAS A PAGAR DO PERIODO - "o que eu tinha para pagar, o que esta pago, o que nao esta,
// e se esta pago saiu de qual conta" - VISAO DIRETIVA DE COBRANCA AO FINANCEIRO (ontem / semana / mes / trimestre).
// Pedido do Alexandre, presencial com a Renata (Quality). Cobre tambem o item do doc "BI Financeiro - Melhorias":
// "Consulta dos pagamentos realizados no periodo X conta que pagou (caixa), podendo abrir o titulo".
//
// BASE = O TITULO A PAGAR QUE VENCIA NO PERIODO (FIN_VW_CONTASPAGAR), NAO A SAIDA DE DINHEIRO:
//   - DIA DEVIDO = vencimento PRORROGADO rolado para o proximo dia util (mesma regra da matriz do Fluxo).
//   - STATUS: pago (SALDO_EM_ABERTO = 0) | parcial (0 < saldo < valor) | aberto (saldo = valor).
//   - A CONTA QUE PAGOU: FIN_REFERENCIAFIN REF_ST_TIPO='BXCPA' com o TITULO no papel REF e a BAIXA (movimento da conta
//     financeira) no papel ORI; o AGN_IN_CODIGO da baixa e o banco/caixa e o MOV_DT_VENCTO dela e a DATA DO PAGAMENTO
//     (DATADOCTO/ENTRADA/PRORROGADO da baixa sao iguais - medido em 3.168 baixas). 1 baixa = 1 titulo (medido).
//   - MODALIDADE = TPD da baixa: PGTOM pagamento bancario | CHP cheque | DINCP dinheiro.
//   - Titulo pago SEM baixa em conta = baixado por compensacao/adiantamento/outros (nao saiu dinheiro de banco).
// ATENCAO DE NEGOCIO: a baixa e lancada no Mega com atraso (mediana 1 dia, ate 16). "Em aberto" pode ser "pago e ainda
// nao lancado" - a rota devolve o ultimo dia com baixa lancada para a tela avisar.
// Registrada a partir de fluxoDocs.js (sem tocar no server.js).
import { megaQuery } from '../soap/mega.js';

const MODALIDADES = { PGTOM: 'Pagamento bancário', CHP: 'Cheque', DINCP: 'Dinheiro' };
const SEP = String.fromCharCode(167);   // § = CHR(167), separador dos campos empacotados nas subqueries escalares

export default async function fluxoPagosRoutes(app) {

  // ==========================================================================
  // GET /fluxo-previo/pagar-periodo?data_ini&data_fim&filiais[&cmp_ini&cmp_fim]
  // 1 linha por TITULO devido no periodo. A tela agrega tudo no navegador: o sintetico e o analitico sao sempre
  // o mesmo numero e o clique abre na hora. cmp_* = periodo anterior equivalente (so agregados).
  // ==========================================================================
  app.get('/fluxo-previo/pagar-periodo', { preHandler: [app.authenticate] }, async (req) => {
    const d = k => String(req.query[k] || '').slice(0, 10);
    const dataIni = d('data_ini'), dataFim = d('data_fim'), cmpIni = d('cmp_ini'), cmpFim = d('cmp_fim');
    const filiais = String(req.query.filiais || '0').replace(/[^0-9,]/g, '') || '0';
    const okD = s => /^\d{4}-\d{2}-\d{2}$/.test(s);
    if (!okD(dataIni) || !okD(dataFim)) { const e = new Error('data_ini e data_fim sao obrigatorios'); e.statusCode = 400; throw e; }
    const dt = s => `TO_DATE('${s}','YYYY-MM-DD')`;
    const base   = `NVL(M.MOV_DT_PRORROGADO, M.MOV_DT_VENCTO)`;
    const devido = `MEGA.F_PROXDIAUTIL(${base}, 1, 200)`;
    const filtro = (ini, fim) => `NVL(M.MOV_CH_SITUACAO,'A') <> 'C' AND M.TPD_ST_CODIGO <> 'PREVPDC'
             AND ${base} BETWEEN ${dt(ini)} - 15 AND ${dt(fim)}
             AND ${devido} BETWEEN ${dt(ini)} AND ${dt(fim)}
             AND ${filiais === '0' ? '1=1' : `INSTR(',${filiais},', ',' || TO_CHAR(M.FIL_IN_CODIGO) || ',') > 0`}`;
    // baixas do titulo M na conta financeira (titulo = REF, baixa = ORI)
    const baixas = `FROM MEGA.FIN_REFERENCIAFIN R, MEGA.FIN_MOVIMENTO B, MEGA.GLO_AGENTES AG
               WHERE R.REF_ORG_TAB_IN_CODIGO = M.ORG_TAB_IN_CODIGO AND R.REF_ORG_PAD_IN_CODIGO = M.ORG_PAD_IN_CODIGO
                 AND R.REF_ORG_IN_CODIGO     = M.ORG_IN_CODIGO     AND R.REF_ORG_TAU_ST_CODIGO = M.ORG_TAU_ST_CODIGO
                 AND R.REF_MOV_TAB_IN_CODIGO = M.MOV_TAB_IN_CODIGO AND R.REF_MOV_SEQ_IN_CODIGO = M.MOV_SEQ_IN_CODIGO
                 AND R.REF_MOV_IN_NUMLANCTO  = M.MOV_IN_NUMLANCTO  AND R.REF_ST_TIPO = 'BXCPA'
                 AND B.ORG_TAB_IN_CODIGO = R.ORI_ORG_TAB_IN_CODIGO AND B.ORG_PAD_IN_CODIGO = R.ORI_ORG_PAD_IN_CODIGO
                 AND B.ORG_IN_CODIGO     = R.ORI_ORG_IN_CODIGO     AND B.ORG_TAU_ST_CODIGO = R.ORI_ORG_TAU_ST_CODIGO
                 AND B.MOV_TAB_IN_CODIGO = R.ORI_MOV_TAB_IN_CODIGO AND B.MOV_SEQ_IN_CODIGO = R.ORI_MOV_SEQ_IN_CODIGO
                 AND B.MOV_IN_NUMLANCTO  = R.ORI_MOV_IN_NUMLANCTO  AND NVL(B.MOV_CH_SITUACAO,'A') <> 'C'
                 AND AG.AGN_TAB_IN_CODIGO = B.AGN_TAB_IN_CODIGO AND AG.AGN_PAD_IN_CODIGO = B.AGN_PAD_IN_CODIGO
                 AND AG.AGN_IN_CODIGO     = B.AGN_IN_CODIGO`;

    const sql = `
      SELECT M.ORG_IN_CODIGO || '.' || M.MOV_SEQ_IN_CODIGO || '.' || M.MOV_IN_NUMLANCTO  AS ID,
             M.FIL_IN_CODIGO                                                             AS FIL,
             (SELECT SUBSTR(NVL(O.ORG_ST_FANTASIA, O.ORG_ST_NOME),1,40) FROM MEGA.GLO_VW_ORGANIZACAO O
               WHERE O.ORG_IN_CODIGO = M.FIL_IN_CODIGO AND ROWNUM = 1)                    AS FIL_NOME,
             M.AGN_IN_CODIGO                                                             AS FORN,
             SUBSTR(AGN.AGN_ST_NOME, 1, 60)                                              AS FORN_NOME,
             SUBSTR(NVL(AGN.AGN_ST_CGC,''), 1, 20)                                       AS CGC,
             CASE WHEN EXISTS (SELECT 1 FROM MEGA.GLO_AGENTES_ID GI WHERE GI.AGN_IN_CODIGO = M.AGN_IN_CODIGO AND GI.AGN_TAU_ST_CODIGO = 'G')
                    OR EXISTS (SELECT 1 FROM MEGA.CCS_TB_GFIN_LIB_GRUPO_AGN GX WHERE GX.AGN_IN_CODIGO = M.AGN_IN_CODIGO)
                  THEN 'S' ELSE 'N' END                                                  AS GRUPO,
             M.MOV_ST_DOCUMENTO                                                          AS DOCUMENTO,
             M.MOV_ST_PARCELA                                                            AS PARCELA,
             M.TPD_ST_CODIGO                                                             AS TPD,
             TO_CHAR(M.MOV_DT_DATADOCTO, 'YYYY-MM-DD')                                   AS EMISSAO,
             TO_CHAR(M.MOV_DT_VENCTO,    'YYYY-MM-DD')                                   AS VENCIMENTO,
             TO_CHAR(${base},   'YYYY-MM-DD')                                            AS VENC_PROR,
             TO_CHAR(${devido}, 'YYYY-MM-DD')                                            AS DT_DEVIDA,
             NVL(M.MOV_RE_VALOR, 0)                                                      AS VALOR,
             NVL(M.SALDO_EM_ABERTO, 0)                                                   AS SALDO,
             SUBSTR(NVL(M.MOV_ST_COMPLHIST,''), 1, 200)                                  AS HISTORICO,
             (SELECT MAX(SUBSTR(C.CLA_ST_DESCRICAO,1,60))
                     KEEP (DENSE_RANK FIRST ORDER BY NVL(L.LCL_RE_VALORDEB,0) + NVL(L.LCL_RE_VALORCRE,0) DESC)
                FROM MEGA.FIN_LANCCLASSE L, MEGA.FIN_CLASSE C
               WHERE L.ORG_TAB_IN_CODIGO = M.ORG_TAB_IN_CODIGO AND L.ORG_PAD_IN_CODIGO = M.ORG_PAD_IN_CODIGO
                 AND L.ORG_IN_CODIGO     = M.ORG_IN_CODIGO     AND L.ORG_TAU_ST_CODIGO = M.ORG_TAU_ST_CODIGO
                 AND L.MOV_TAB_IN_CODIGO = M.MOV_TAB_IN_CODIGO AND L.MOV_SEQ_IN_CODIGO = M.MOV_SEQ_IN_CODIGO
                 AND L.MOV_IN_NUMLANCTO  = M.MOV_IN_NUMLANCTO
                 AND C.CLA_TAB_IN_CODIGO = L.CLA_TAB_IN_CODIGO AND C.CLA_PAD_IN_CODIGO = L.CLA_PAD_IN_CODIGO
                 AND C.CLA_IDE_ST_CODIGO = L.CLA_IDE_ST_CODIGO AND C.CLA_IN_REDUZIDO   = L.CLA_IN_REDUZIDO) AS CLASSE,
             (SELECT MAX(B.AGN_IN_CODIGO || CHR(167) || SUBSTR(AG.AGN_ST_NOME,1,60) || CHR(167) || TO_CHAR(B.MOV_DT_VENCTO,'YYYY-MM-DD')
                         || CHR(167) || B.TPD_ST_CODIGO || CHR(167) || B.MOV_ST_DOCUMENTO || CHR(167) || TO_CHAR(B.MOV_DT_DATAINC,'YYYY-MM-DD HH24:MI'))
                     KEEP (DENSE_RANK LAST ORDER BY B.MOV_DT_VENCTO, B.MOV_IN_NUMLANCTO)
                ${baixas})                                                               AS ULT_BAIXA,
             (SELECT COUNT(*) || CHR(167) || NVL(SUM(NVL(B.MOV_RE_VALORCRE,0)),0) ${baixas}) AS TOT_BAIXA
        FROM MEGA.FIN_VW_CONTASPAGAR M, MEGA.GLO_AGENTES AGN
       WHERE M.AGN_TAB_IN_CODIGO = AGN.AGN_TAB_IN_CODIGO(+)
         AND M.AGN_PAD_IN_CODIGO = AGN.AGN_PAD_IN_CODIGO(+)
         AND M.AGN_IN_CODIGO     = AGN.AGN_IN_CODIGO(+)
         AND ${filtro(dataIni, dataFim)}
       ORDER BY ${devido}, M.MOV_RE_VALOR DESC`;

    const agregado = (ini, fim) => `
      SELECT COUNT(*) QT, ROUND(NVL(SUM(M.MOV_RE_VALOR),0),2) VL, ROUND(NVL(SUM(M.SALDO_EM_ABERTO),0),2) ABERTO,
             SUM(CASE WHEN NVL(M.SALDO_EM_ABERTO,0) > 0 THEN 1 ELSE 0 END) QT_ABERTO
        FROM MEGA.FIN_VW_CONTASPAGAR M WHERE ${filtro(ini, fim)}`;

    const [rows, cmp, saude] = await Promise.all([
      megaQuery(sql),
      (okD(cmpIni) && okD(cmpFim)) ? megaQuery(agregado(cmpIni, cmpFim)) : Promise.resolve([]),
      megaQuery(`SELECT TO_CHAR(MAX(CASE WHEN B.MOV_DT_VENCTO <= TRUNC(SYSDATE) THEN B.MOV_DT_VENCTO END),'YYYY-MM-DD') ULT_DIA,
                        TO_CHAR(MAX(B.MOV_DT_DATAINC),'YYYY-MM-DD HH24:MI') ULT_LANC
                   FROM MEGA.FIN_MOVIMENTO B
                  WHERE B.AGN_TAU_ST_CODIGO = 'N' AND B.MOV_CH_NATUREZA = 'C' AND NVL(B.MOV_CH_SITUACAO,'A') <> 'C'
                    AND B.ACAO_IN_CODIGO = 705 AND B.MOV_DT_VENCTO >= TRUNC(SYSDATE) - 60`)
    ]);

    const num = v => Number(v || 0);
    const hojeBr = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Recife' });
    const dias = (a, b) => Math.round((Date.parse(a + 'T12:00:00Z') - Date.parse(b + 'T12:00:00Z')) / 86400000);
    const titulos = rows.map(r => {
      const valor = num(r.VALOR), saldo = num(r.SALDO), pago = +(valor - saldo).toFixed(2);
      const status = saldo <= 0.005 ? 'pago' : (saldo + 0.005 < valor ? 'parcial' : 'aberto');
      const u = r.ULT_BAIXA ? String(r.ULT_BAIXA).split(SEP) : null;
      const t = r.TOT_BAIXA ? String(r.TOT_BAIXA).split(SEP) : ['0', '0'];
      const dtPagto = u ? u[2] : '';
      const diasPagto = dtPagto && r.VENC_PROR ? dias(dtPagto, r.VENC_PROR) : null;   // > 0 pago com atraso | < 0 antecipado
      return {
        id: r.ID, fil_id: num(r.FIL), fil_nome: r.FIL_NOME || '',
        forn_id: num(r.FORN), forn_nome: r.FORN_NOME || `Agente ${r.FORN}`, cgc: r.CGC || '', grupo: r.GRUPO === 'S',
        documento: r.DOCUMENTO || '', parcela: r.PARCELA || '', tpd: r.TPD || '',
        emissao: r.EMISSAO || '', vencimento: r.VENCIMENTO || '', venc_pror: r.VENC_PROR || '', dt_devida: r.DT_DEVIDA || '',
        valor, saldo, pago, status, classe: (r.CLASSE || '').trim() || '(sem classe)', historico: r.HISTORICO || '',
        // baixa em conta financeira (a mais recente) + totais
        conta_id: u ? num(u[0]) : null, conta_nome: u ? (u[1] || `Conta ${u[0]}`) : '',
        dt_pagto: dtPagto, modalidade: u ? (MODALIDADES[u[3]] || u[3] || '(sem tipo)') : '', doc_baixa: u ? (u[4] || '') : '',
        dt_lancamento: u ? (u[5] || '') : '',
        qt_baixas: num(t[0]), vl_baixas_conta: num(t[1]),
        // pago/parcial sem nenhuma baixa em conta = compensacao, adiantamento, devolucao... (nao saiu de banco)
        sem_conta: status !== 'aberto' && !u,
        dias_pagto: diasPagto,
        pontualidade: status === 'aberto' ? null : (diasPagto == null ? 'sem_conta' : diasPagto > 0 ? 'atraso' : diasPagto < 0 ? 'antecipado' : 'no_dia'),
        dias_vencido: status === 'pago' ? 0 : Math.max(0, dias(hojeBr, r.VENC_PROR || hojeBr))
      };
    });

    return {
      filtro: { data_ini: dataIni, data_fim: dataFim, filiais, cmp_ini: cmpIni || null, cmp_fim: cmpFim || null, hoje: hojeBr },
      titulos,
      comparativo: cmp.length ? { qt: num(cmp[0].QT), valor: num(cmp[0].VL), aberto: num(cmp[0].ABERTO), qt_aberto: num(cmp[0].QT_ABERTO) } : null,
      saude: { ult_dia_com_baixa: saude[0]?.ULT_DIA || null, ult_lancamento: saude[0]?.ULT_LANC || null }
    };
  });

  // GET /fluxo-previo/pagar-periodo/base - hoje e o DIA UTIL ANTERIOR ("ontem" de quem gere caixa: na segunda-feira
  // e a sexta; depois de feriado, o ultimo dia util). Calendario de feriados do agente 200, o mesmo do Fluxo.
  app.get('/fluxo-previo/pagar-periodo/base', { preHandler: [app.authenticate] }, async () => {
    const r = await megaQuery(`
      SELECT TO_CHAR(TRUNC(SYSDATE),'YYYY-MM-DD') HOJE,
             TO_CHAR((SELECT MAX(D) FROM (SELECT TRUNC(SYSDATE) - LEVEL D FROM DUAL CONNECT BY LEVEL <= 12)
                       WHERE MEGA.F_PROXDIAUTIL(D, 1, 200) = D), 'YYYY-MM-DD') ONTEM_UTIL
        FROM DUAL`);
    return { hoje: r[0]?.HOJE, ontem_util: r[0]?.ONTEM_UTIL };
  });
}
