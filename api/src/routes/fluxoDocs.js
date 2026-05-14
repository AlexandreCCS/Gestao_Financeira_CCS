// [06/05/2026 - Alexandre Carvalho] Drilldown de documentos do Fluxo de Caixa
// Lista detalhada de Recebimentos (CR) ou Pagamentos (CP) de um dia rolado
// para o proximo dia util (mesma logica da CCS_F_GFIN_FLUXO_PREVIO).
import { megaQuery } from '../soap/mega.js';

const sqlEsc = s => String(s ?? '').replace(/'/g, "''");

export default async function fluxoDocsRoutes(app) {

  // ==========================================================================
  // GET /fluxo-previo/docs?data=YYYY-MM-DD&tipo=CR|CP&filiais=400,401&prev=S|N
  //   data    - data EXIBIDA na grid (apos rolagem por dia util)
  //   tipo    - 'CR' (recebimento) ou 'CP' (pagamento)
  //   filiais - csv de filiais (ou '0' = todas)
  //   prev    - 'S' inclui previsoes (PDV/PREVPDC) | 'N' default exclui
  //
  // Status = REALIZADO p/ TPD efetivo (NFCR, NFCP, ENERGIA, DESDIVS, etc),
  //          PREVISTO  p/ TPDs PDV (recebto previsto) ou PREVPDC (pagto previsto).
  // Quando prev='N', exclui linhas com TPD em ('PDV','PREVPDC').
  // ==========================================================================
  app.get('/fluxo-previo/docs', { preHandler: [app.authenticate] }, async (req) => {
    const data    = String(req.query.data || '').slice(0, 10);
    const tipo    = String(req.query.tipo || 'CR').toUpperCase();
    const filiais = String(req.query.filiais || '0').replace(/[^0-9,]/g, '') || '0';
    const prev    = (String(req.query.prev || 'N').toUpperCase() === 'S') ? 'S' : 'N';

    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
      const e = new Error('data e obrigatoria no formato YYYY-MM-DD');
      e.statusCode = 400; throw e;
    }
    if (tipo !== 'CR' && tipo !== 'CP') {
      const e = new Error('tipo deve ser CR ou CP');
      e.statusCode = 400; throw e;
    }

    const filtroFil = (filiais === '0' || filiais === '')
      ? '1=1'
      : `INSTR(',${filiais},', ',' || TO_CHAR(M.FIL_IN_CODIGO) || ',') > 0`;
    const filtroPrev = prev === 'S' ? '1=1' : `M.TPD_ST_CODIGO NOT IN ('PDV','PREVPDC')`;

    // FIN_VW_CONTASRECEBER e FIN_VW_CONTASPAGAR tem essencialmente as mesmas
    // colunas - so o nome do TPD da fatura difere (FRE_TPD vs FPA_TPD).
    const view = tipo === 'CR' ? 'FIN_VW_CONTASRECEBER' : 'FIN_VW_CONTASPAGAR';
    const colTpdFatura = tipo === 'CR' ? 'FRE_TPD_ST_CODIGO' : 'FPA_TPD_ST_CODIGO';

    const sql = `
      SELECT M.MOV_ST_DOCUMENTO                                AS DOCUMENTO,
             M.MOV_ST_PARCELA                                  AS PARCELA,
             TO_CHAR(M.MOV_DT_VENCTO,    'YYYY-MM-DD')         AS VENCIMENTO,
             TO_CHAR(M.MOV_DT_PRORROGADO,'YYYY-MM-DD')         AS VENC_PROR,
             TO_CHAR(M.MOV_DT_DATADOCTO, 'YYYY-MM-DD')         AS EMISSAO,
             TO_CHAR(M.MOV_DT_ENTRADA,   'YYYY-MM-DD')         AS ENTRADA,
             M.FIL_IN_CODIGO                                   AS FILIAL,
             M.AGN_IN_CODIGO                                   AS COD_AGENTE,
             SUBSTR(AGN.AGN_ST_NOME, 1, 60)                    AS NOME_AGENTE,
             SUBSTR(NVL(AGN.AGN_ST_CGC,''), 1, 20)             AS CGC,
             M.MOV_RE_VALOR                                    AS VALOR,
             M.TPD_ST_CODIGO                                   AS TIPO_DOC,
             M.${colTpdFatura}                                 AS TIPO_FATURA,
             CASE WHEN M.TPD_ST_CODIGO IN ('PDV','PREVPDC')
                  THEN 'PREVISTO' ELSE 'REALIZADO' END         AS STATUS,
             SUBSTR(NVL(M.MOV_ST_COMPLHIST,''), 1, 200)        AS HISTORICO,
             M.ACAO_IN_CODIGO                                  AS ACAO
        FROM MEGA.${view} M,
             MEGA.GLO_AGENTES AGN
       WHERE M.AGN_TAB_IN_CODIGO = AGN.AGN_TAB_IN_CODIGO(+)
         AND M.AGN_PAD_IN_CODIGO = AGN.AGN_PAD_IN_CODIGO(+)
         AND M.AGN_IN_CODIGO     = AGN.AGN_IN_CODIGO(+)
         AND MEGA.F_PROXDIAUTIL(M.MOV_DT_VENCTO, 1, 200) = TO_DATE('${data}','YYYY-MM-DD')
         AND NVL(M.MOV_CH_SITUACAO,'A') <> 'C'
         AND ${filtroFil}
         AND ${filtroPrev}
       ORDER BY M.FIL_IN_CODIGO, M.MOV_ST_DOCUMENTO, M.MOV_ST_PARCELA`;

    const rows = await megaQuery(sql);
    const docs = rows.map(r => ({
      documento:    r.DOCUMENTO || '',
      parcela:      r.PARCELA || '',
      vencimento:   r.VENCIMENTO || '',
      venc_pror:    r.VENC_PROR || '',
      emissao:      r.EMISSAO || '',
      entrada:      r.ENTRADA || '',
      filial:       Number(r.FILIAL || 0),
      cod_agente:   Number(r.COD_AGENTE || 0),
      nome_agente:  r.NOME_AGENTE || '',
      cgc:          r.CGC || '',
      valor:        Number(r.VALOR || 0),
      tipo_doc:     r.TIPO_DOC || '',
      tipo_fatura:  r.TIPO_FATURA || '',
      status:       r.STATUS || '',
      historico:    r.HISTORICO || '',
      acao:         Number(r.ACAO || 0)
    }));

    const totais = {
      total:     docs.reduce((s, d) => s + d.valor, 0),
      qtd:       docs.length,
      realizado: docs.filter(d => d.status === 'REALIZADO').reduce((s, d) => s + d.valor, 0),
      previsto:  docs.filter(d => d.status === 'PREVISTO' ).reduce((s, d) => s + d.valor, 0),
      qtd_realizado: docs.filter(d => d.status === 'REALIZADO').length,
      qtd_previsto:  docs.filter(d => d.status === 'PREVISTO' ).length
    };

    return {
      filtro: { data, tipo, filiais, prev },
      totais,
      docs
    };
  });
}
