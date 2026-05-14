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
}
