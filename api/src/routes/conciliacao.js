// [05/05/2026 - Alexandre Carvalho] KPIs de Conciliacao Bancaria
import { megaQuery } from '../soap/mega.js';

export default async function conciliacaoRoutes(app) {

  // GET /conciliacao?data_ini=YYYY-MM-DD&data_fim=YYYY-MM-DD&fil=0
  app.get('/conciliacao', { preHandler: [app.authenticate] }, async (req) => {
    const dataIni = String(req.query.data_ini || '').slice(0, 10);
    const dataFim = String(req.query.data_fim || '').slice(0, 10);
    const fil     = parseInt(req.query.fil || '0', 10) || 0;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataIni) || !/^\d{4}-\d{2}-\d{2}$/.test(dataFim)) {
      const e = new Error('data_ini e data_fim sao obrigatorios');
      e.statusCode = 400; throw e;
    }

    const sql = `
      SELECT AGN_IN_CODIGO, AGN_ST_NOME, FIL_IN_CODIGO, FIL_ST_NOME,
             QT_MOV, QT_CONC, QT_PEND, PCT_CONC, VL_PEND, VL_CONC,
             AGING_0_30, AGING_31_60, AGING_61_90, AGING_90P,
             TO_CHAR(DT_ULT_PEND,'YYYY-MM-DD') DT_ULT_PEND,
             TO_CHAR(DT_ULT_CONC,'YYYY-MM-DD') DT_ULT_CONC
        FROM TABLE(MEGA.CCS_F_GFIN_CONCILIACAO(
                     TO_DATE('${dataIni}','YYYY-MM-DD'),
                     TO_DATE('${dataFim}','YYYY-MM-DD'),
                     ${fil}))`;
    const rows = await megaQuery(sql);

    const linhas = rows.map(r => ({
      agn_id:    Number(r.AGN_IN_CODIGO),
      agn_nome:  r.AGN_ST_NOME,
      fil_id:    Number(r.FIL_IN_CODIGO),
      fil_nome:  r.FIL_ST_NOME,
      qt_mov:    Number(r.QT_MOV     || 0),
      qt_conc:   Number(r.QT_CONC    || 0),
      qt_pend:   Number(r.QT_PEND    || 0),
      pct_conc:  Number(r.PCT_CONC   || 0),
      vl_pend:   Number(r.VL_PEND    || 0),
      vl_conc:   Number(r.VL_CONC    || 0),
      aging:     {
        d0_30:   Number(r.AGING_0_30  || 0),
        d31_60:  Number(r.AGING_31_60 || 0),
        d61_90:  Number(r.AGING_61_90 || 0),
        d90p:    Number(r.AGING_90P   || 0)
      },
      dt_ult_pend: r.DT_ULT_PEND || null,
      dt_ult_conc: r.DT_ULT_CONC || null
    }));

    // KPIs consolidados
    const totMov  = linhas.reduce((s, l) => s + l.qt_mov,  0);
    const totConc = linhas.reduce((s, l) => s + l.qt_conc, 0);
    const totPend = linhas.reduce((s, l) => s + l.qt_pend, 0);
    const valPend = linhas.reduce((s, l) => s + Math.abs(l.vl_pend), 0);
    const contas100 = linhas.filter(l => l.qt_pend === 0 && l.qt_mov > 0).length;
    const contasComPend = linhas.filter(l => l.qt_pend > 0).length;
    const contasCriticas = linhas.filter(l => l.aging.d90p > 0).length;
    const total90p = linhas.reduce((s, l) => s + l.aging.d90p, 0);

    return {
      filtro: { data_ini: dataIni, data_fim: dataFim, fil },
      kpi: {
        total_mov: totMov,
        total_conc: totConc,
        total_pend: totPend,
        pct_conc:  totMov > 0 ? Math.round((totConc * 10000) / totMov) / 100 : 0,
        valor_pend_abs: valPend,
        contas_100_conciliadas: contas100,
        contas_com_pendencia:  contasComPend,
        contas_criticas:       contasCriticas,
        total_pendentes_90p:   total90p
      },
      linhas
    };
  });

  // [01/07/2026 - Alexandre Carvalho] Drill-down: lancamentos PENDENTES de conciliar de UMA conta.
  // Espelha EXATAMENTE o WHERE de CCS_F_GFIN_CONCILIACAO (FIN_MOVIMENTO, MOV_CH_CONCILIADO='N',
  // MOV_DT_VENCTO no periodo, MOV_CH_SITUACAO<>'C', conta ativa) para o count/soma baterem com a
  // linha do painel (qt_pend / vl_pend). Filtra por conta (agn) + filial (a linha e por conta x filial).
  // GET /conciliacao/pendentes?agn=X&fil=Y&data_ini=YYYY-MM-DD&data_fim=YYYY-MM-DD
  app.get('/conciliacao/pendentes', { preHandler: [app.authenticate] }, async (req) => {
    const agn     = parseInt(req.query.agn || '0', 10) || 0;
    const fil     = parseInt(req.query.fil || '0', 10) || 0;   // 0 = todas as filiais da conta
    const dataIni = String(req.query.data_ini || '').slice(0, 10);
    const dataFim = String(req.query.data_fim || '').slice(0, 10);
    const limit   = Math.min(parseInt(req.query.limit || '10000', 10), 20000);
    if (!agn || !/^\d{4}-\d{2}-\d{2}$/.test(dataIni) || !/^\d{4}-\d{2}-\d{2}$/.test(dataFim)) {
      const e = new Error('agn, data_ini e data_fim sao obrigatorios');
      e.statusCode = 400; throw e;
    }

    const filtroFil = fil > 0 ? `AND M.FIL_IN_CODIGO = ${fil}` : '';

    // [01/07/2026 - Alexandre Carvalho] AGENTE contraparte (cliente/fornecedor/outros):
    // o movimento pendente e uma BAIXA (banco = M.AGN). O agente do titulo/destino vem via
    // FIN_REFERENCIAFIN -> movimento referenciado (T = REF). A baixa aparece ora como ORIGEM
    // (ORI, casos 705/706 baixa CP/CR), ora como o proprio MOV (transferencias 712) -> por isso
    // o COALESCE dos dois padroes. Prioriza a referencia do titulo (BXCRE/BXCPA/TRANSF) sobre
    // acessorios (DESC/JUR/MUL). Ignora o proprio banco (T.AGN <> M.AGN). Retorna "codigo§nome".
    const refTit = `T.ORG_TAB_IN_CODIGO=R.REF_ORG_TAB_IN_CODIGO AND T.ORG_PAD_IN_CODIGO=R.REF_ORG_PAD_IN_CODIGO AND T.ORG_IN_CODIGO=R.REF_ORG_IN_CODIGO AND T.ORG_TAU_ST_CODIGO=R.REF_ORG_TAU_ST_CODIGO AND T.MOV_TAB_IN_CODIGO=R.REF_MOV_TAB_IN_CODIGO AND T.MOV_SEQ_IN_CODIGO=R.REF_MOV_SEQ_IN_CODIGO AND T.MOV_IN_NUMLANCTO=R.REF_MOV_IN_NUMLANCTO`;
    const agName = `T.AGN_TAB_IN_CODIGO=IX.AGN_TAB_IN_CODIGO AND T.AGN_PAD_IN_CODIGO=IX.AGN_PAD_IN_CODIGO AND T.AGN_IN_CODIGO=IX.AGN_IN_CODIGO AND T.AGN_TAU_ST_CODIGO=IX.AGN_TAU_ST_CODIGO AND IX.AGN_TAB_IN_CODIGO=AG.AGN_TAB_IN_CODIGO AND IX.AGN_PAD_IN_CODIGO=AG.AGN_PAD_IN_CODIGO AND IX.AGN_IN_CODIGO=AG.AGN_IN_CODIGO`;
    const oriKeys = `R.ORI_ORG_TAB_IN_CODIGO=M.ORG_TAB_IN_CODIGO AND R.ORI_ORG_PAD_IN_CODIGO=M.ORG_PAD_IN_CODIGO AND R.ORI_ORG_IN_CODIGO=M.ORG_IN_CODIGO AND R.ORI_ORG_TAU_ST_CODIGO=M.ORG_TAU_ST_CODIGO AND R.ORI_MOV_TAB_IN_CODIGO=M.MOV_TAB_IN_CODIGO AND R.ORI_MOV_SEQ_IN_CODIGO=M.MOV_SEQ_IN_CODIGO AND R.ORI_MOV_IN_NUMLANCTO=M.MOV_IN_NUMLANCTO`;
    const movKeys = `R.ORG_TAB_IN_CODIGO=M.ORG_TAB_IN_CODIGO AND R.ORG_PAD_IN_CODIGO=M.ORG_PAD_IN_CODIGO AND R.ORG_IN_CODIGO=M.ORG_IN_CODIGO AND R.ORG_TAU_ST_CODIGO=M.ORG_TAU_ST_CODIGO AND R.MOV_TAB_IN_CODIGO=M.MOV_TAB_IN_CODIGO AND R.MOV_SEQ_IN_CODIGO=M.MOV_SEQ_IN_CODIGO AND R.MOV_IN_NUMLANCTO=M.MOV_IN_NUMLANCTO`;
    const subCp = keys => `(SELECT MAX(T.AGN_IN_CODIGO||CHR(167)||AG.AGN_ST_NOME) KEEP (DENSE_RANK FIRST ORDER BY CASE R.REF_ST_TIPO WHEN 'BXCRE' THEN 1 WHEN 'BXCPA' THEN 1 WHEN 'TRANSF' THEN 1 WHEN 'TRANSFDEST' THEN 1 ELSE 5 END, T.MOV_IN_NUMLANCTO)
        FROM MEGA.FIN_REFERENCIAFIN R, MEGA.FIN_MOVIMENTO T, MEGA.GLO_AGENTES_ID IX, MEGA.GLO_AGENTES AG
       WHERE ${keys} AND ${refTit} AND ${agName} AND T.AGN_IN_CODIGO <> M.AGN_IN_CODIGO)`;

    const sql = `
      SELECT * FROM (
        SELECT M.FIL_IN_CODIGO,
               NVL(O.ORG_ST_FANTASIA, O.ORG_ST_NOME)      AS FIL_ST_NOME,
               M.MOV_SEQ_IN_CODIGO,
               M.ACAO_IN_CODIGO,
               TO_CHAR(M.MOV_DT_VENCTO,'YYYY-MM-DD')       AS DT_VENCTO,
               TO_CHAR(M.MOV_DT_DATADOCTO,'YYYY-MM-DD')    AS DT_DOCTO,
               M.TPD_ST_CODIGO,
               M.MOV_ST_DOCUMENTO,
               SUBSTR(M.MOV_ST_COMPLHIST, 1, 240)          AS HISTORICO,
               NVL(M.MOV_RE_VALORDEB,0)                    AS VALOR_DEB,
               NVL(M.MOV_RE_VALORCRE,0)                    AS VALOR_CRE,
               M.AGN_IN_CODIGO                             AS AGN_BANCO_ID,
               COALESCE(${subCp(oriKeys)}, ${subCp(movKeys)}) AS CONTRAPARTE
          FROM MEGA.FIN_MOVIMENTO       M,
               MEGA.GLO_AGENTES_ID      I,
               MEGA.GLO_VW_ORGANIZACAO  O
         WHERE I.AGN_TAU_ST_CODIGO = 'N'
           AND NVL(I.AGN_CH_STATUS,'A') = 'A'
           AND M.AGN_TAB_IN_CODIGO = I.AGN_TAB_IN_CODIGO
           AND M.AGN_PAD_IN_CODIGO = I.AGN_PAD_IN_CODIGO
           AND M.AGN_IN_CODIGO     = I.AGN_IN_CODIGO
           AND M.AGN_TAU_ST_CODIGO = I.AGN_TAU_ST_CODIGO
           AND O.ORG_IN_CODIGO (+) = M.FIL_IN_CODIGO
           AND M.AGN_IN_CODIGO     = ${agn}
           AND M.MOV_DT_VENCTO BETWEEN TO_DATE('${dataIni}','YYYY-MM-DD')
                                    AND TO_DATE('${dataFim}','YYYY-MM-DD')
           AND NVL(M.MOV_CH_SITUACAO,'A') <> 'C'
           AND NVL(M.MOV_CH_CONCILIADO,'N') = 'N'
           ${filtroFil}
         ORDER BY M.MOV_DT_VENCTO ASC, M.FIL_IN_CODIGO, M.MOV_SEQ_IN_CODIGO
      ) WHERE ROWNUM <= ${limit}`;
    const rows = await megaQuery(sql);

    // Nome do agente banco (a conta) - constante por modal, busca isolada p/ nao multiplicar linhas
    const banco = await megaQuery(`
      SELECT MAX(A.AGN_ST_NOME) AS NOME
        FROM MEGA.GLO_AGENTES_ID I, MEGA.GLO_AGENTES A
       WHERE I.AGN_IN_CODIGO = ${agn} AND I.AGN_TAU_ST_CODIGO = 'N'
         AND I.AGN_TAB_IN_CODIGO = A.AGN_TAB_IN_CODIGO
         AND I.AGN_PAD_IN_CODIGO = A.AGN_PAD_IN_CODIGO
         AND I.AGN_IN_CODIGO     = A.AGN_IN_CODIGO`);
    const bancoNome = banco[0]?.NOME || '';

    // acao -> natureza da contraparte (rotulo)
    const ACAO_CLIENTE = new Set([706, 704, 708, 715, 711]);   // baixa/adiant/dev/receb de CLIENTE
    const ACAO_FORNEC  = new Set([705, 702, 707, 710]);        // baixa/adiant/dev/pagto de FORNECEDOR
    const tipoContraparte = acao =>
      acao === 712 ? 'CONTA' : ACAO_CLIENTE.has(acao) ? 'CLIENTE'
      : ACAO_FORNEC.has(acao) ? 'FORNECEDOR' : 'OUTROS';

    const lancamentos = rows.map(r => {
      const deb = Number(r.VALOR_DEB || 0);
      const cre = Number(r.VALOR_CRE || 0);
      const acao = Number(r.ACAO_IN_CODIGO || 0);
      const cp = (r.CONTRAPARTE || '').split(String.fromCharCode(167));  // "codigo§nome"
      const cpId = cp[0] ? Number(cp[0]) : null;
      return {
        fil_id:    Number(r.FIL_IN_CODIGO),
        fil_nome:  r.FIL_ST_NOME || ('FIL ' + r.FIL_IN_CODIGO),
        seq:       Number(r.MOV_SEQ_IN_CODIGO || 0),
        acao,
        vencto:    r.DT_VENCTO,
        docto:     r.DT_DOCTO,
        tpd:       r.TPD_ST_CODIGO || '',
        documento: r.MOV_ST_DOCUMENTO || '',
        historico: r.HISTORICO || '',
        deb, cre,
        valor:     deb - cre,          // mesma conta do vl_pend do painel
        // agente banco (a propria conta) e agente contraparte (cliente/fornecedor/outros)
        agn_banco_id:   Number(r.AGN_BANCO_ID || 0),
        agn_banco_nome: bancoNome,
        cp_id:          cpId,
        cp_nome:        cp[1] || '',
        cp_tipo:        cpId ? tipoContraparte(acao) : ''
      };
    });

    const totDeb   = lancamentos.reduce((s, l) => s + l.deb, 0);
    const totCre   = lancamentos.reduce((s, l) => s + l.cre, 0);

    return {
      filtro: { agn, fil, data_ini: dataIni, data_fim: dataFim, limit },
      total: {
        count:  lancamentos.length,
        deb:    totDeb,
        cre:    totCre,
        valor:  totDeb - totCre,
        truncado: lancamentos.length >= limit
      },
      lancamentos
    };
  });
}
