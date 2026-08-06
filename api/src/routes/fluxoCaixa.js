// [05/05/2026 - Alexandre Carvalho] Fluxo de Caixa Consolidado por Periodo
// Chama a proc MEGA.CCS_P_GFIN_FLUXO_CAIXA que agrega entradas (FIN_CONTASRECEBER baixadas)
// e saidas (FIN_CONTASPAGAR baixadas) por bucket de periodo (D=diario, S=semanal, M=mensal).
import { megaQuery } from '../soap/mega.js';

export default async function fluxoCaixaRoutes(app) {

  // GET /fluxo-caixa?data_ini=YYYY-MM-DD&data_fim=YYYY-MM-DD&periodo=D|S|M&fil=0
  app.get('/fluxo-caixa', { preHandler: [app.authenticate] }, async (req) => {
    const di  = String(req.query.data_ini || '').slice(0, 10);
    const df  = String(req.query.data_fim || '').slice(0, 10);
    const per = ['D','S','M'].includes(String(req.query.periodo)) ? req.query.periodo : 'M';
    const fil = parseInt(req.query.fil || '0', 10) || 0;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(di) || !/^\d{4}-\d{2}-\d{2}$/.test(df)) {
      const e = new Error('data_ini e data_fim sao obrigatorios no formato YYYY-MM-DD');
      e.statusCode = 400; throw e;
    }

    // A proc retorna: PERIODO (label), DT_INI, DT_FIM, ENTRADAS, SAIDAS, SALDO
    const sql = `
      SELECT PERIODO, TO_CHAR(DT_INI,'YYYY-MM-DD') DT_INI, TO_CHAR(DT_FIM,'YYYY-MM-DD') DT_FIM,
             NVL(ENTRADAS,0) ENTRADAS, NVL(SAIDAS,0) SAIDAS, NVL(SALDO,0) SALDO
        FROM TABLE(MEGA.CCS_F_GFIN_FLUXO_CAIXA(
                     TO_DATE('${di}','YYYY-MM-DD'),
                     TO_DATE('${df}','YYYY-MM-DD'),
                     '${per}', ${fil}))
       ORDER BY DT_INI`;
    const linhas = await megaQuery(sql);

    // Totalizadores
    const totEntradas = linhas.reduce((s, r) => s + Number(r.ENTRADAS || 0), 0);
    const totSaidas   = linhas.reduce((s, r) => s + Number(r.SAIDAS   || 0), 0);
    return {
      filtro: { data_ini: di, data_fim: df, periodo: per, fil },
      total: { entradas: totEntradas, saidas: totSaidas, liquido: totEntradas - totSaidas },
      linhas: linhas.map(r => ({
        periodo: r.PERIODO,
        dt_ini: r.DT_INI, dt_fim: r.DT_FIM,
        entradas: Number(r.ENTRADAS || 0),
        saidas:   Number(r.SAIDAS   || 0),
        saldo:    Number(r.SALDO    || 0)
      }))
    };
  });

  // GET /fluxo-caixa/filiais - lista filiais com movimento financeiro recente
  app.get('/fluxo-caixa/filiais', { preHandler: [app.authenticate] }, async () => {
    const rows = await megaQuery(`
      SELECT DISTINCT M.FIL_IN_CODIGO,
             NVL(O.ORG_ST_FANTASIA, O.ORG_ST_NOME) AS FIL_ST_NOME
        FROM MEGA.FIN_MOVIMENTO       M,
             MEGA.GLO_VW_ORGANIZACAO  O
       WHERE M.FIL_IN_CODIGO = O.ORG_IN_CODIGO (+)
         AND M.MOV_DT_VENCTO >= TRUNC(SYSDATE) - 365
       ORDER BY 1`);
    return rows.map(r => ({
      id: Number(r.FIL_IN_CODIGO),
      nome: r.FIL_ST_NOME || ('FIL ' + r.FIL_IN_CODIGO)
    }));
  });
}
