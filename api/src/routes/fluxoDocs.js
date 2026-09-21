// [06/05/2026 - Alexandre Carvalho] Drilldown de documentos do Fluxo de Caixa
// Lista detalhada de Recebimentos (CR) ou Pagamentos (CP) de um dia rolado
// para o proximo dia util (mesma logica da CCS_F_GFIN_FLUXO_PREVIO).
import { megaQuery } from '../soap/mega.js';
import { paramsV3 } from './fluxoPrevio.js';

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
    // [21/09/2026 - Alexandre Carvalho] V3: mesmos parametros (e mesma validacao) da matriz
    const { grupo, classes, d1 } = paramsV3(req.query);

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

    // [09/07/2026 - Alexandre Carvalho] Caixa/conta da baixa do titulo via FIN_REFERENCIAFIN:
    // o titulo e o REF (BXCPA/BXCRE) e a baixa e o ORI; o agente da baixa e o banco/caixa.
    // Subquery escalar (nao multiplica linha); titulo sem baixa retorna NULL ("em aberto").
    // Mesma mecanica (invertida) do drill-down da Conciliacao — ver Conciliacao_Bancaria_Contraparte_FIN_REFERENCIAFIN.md.
    const refTipo = tipo === 'CR' ? 'BXCRE' : 'BXCPA';
    const subCaixa = `
             (SELECT MAX(B.AGN_IN_CODIGO || CHR(167) || AG.AGN_ST_NOME)
                     KEEP (DENSE_RANK FIRST ORDER BY B.MOV_IN_NUMLANCTO DESC)
                FROM MEGA.FIN_REFERENCIAFIN R, MEGA.FIN_MOVIMENTO B, MEGA.GLO_AGENTES AG
               WHERE R.REF_ORG_TAB_IN_CODIGO = M.ORG_TAB_IN_CODIGO
                 AND R.REF_ORG_PAD_IN_CODIGO = M.ORG_PAD_IN_CODIGO
                 AND R.REF_ORG_IN_CODIGO     = M.ORG_IN_CODIGO
                 AND R.REF_ORG_TAU_ST_CODIGO = M.ORG_TAU_ST_CODIGO
                 AND R.REF_MOV_TAB_IN_CODIGO = M.MOV_TAB_IN_CODIGO
                 AND R.REF_MOV_SEQ_IN_CODIGO = M.MOV_SEQ_IN_CODIGO
                 AND R.REF_MOV_IN_NUMLANCTO  = M.MOV_IN_NUMLANCTO
                 AND R.REF_ST_TIPO           = '${refTipo}'
                 AND B.ORG_TAB_IN_CODIGO = R.ORI_ORG_TAB_IN_CODIGO
                 AND B.ORG_PAD_IN_CODIGO = R.ORI_ORG_PAD_IN_CODIGO
                 AND B.ORG_IN_CODIGO     = R.ORI_ORG_IN_CODIGO
                 AND B.ORG_TAU_ST_CODIGO = R.ORI_ORG_TAU_ST_CODIGO
                 AND B.MOV_TAB_IN_CODIGO = R.ORI_MOV_TAB_IN_CODIGO
                 AND B.MOV_SEQ_IN_CODIGO = R.ORI_MOV_SEQ_IN_CODIGO
                 AND B.MOV_IN_NUMLANCTO  = R.ORI_MOV_IN_NUMLANCTO
                 AND AG.AGN_TAB_IN_CODIGO = B.AGN_TAB_IN_CODIGO
                 AND AG.AGN_PAD_IN_CODIGO = B.AGN_PAD_IN_CODIGO
                 AND AG.AGN_IN_CODIGO     = B.AGN_IN_CODIGO)`;

    // [21/09/2026 - Alexandre Carvalho] Espelha a V2 da CCS_F_GFIN_FLUXO_PREVIO (pedido Renata/Quality):
    //   (a) data base = vencimento PRORROGADO; (b) o dia da celula e o dia ROLADO para o proximo dia util;
    //   (c) de hoje em diante so entra titulo com SALDO EM ABERTO e o valor que conta e o saldo
    //       (titulo quitado ja esta no saldo bancario). Dia passado segue pelo valor do titulo.
    //   A celula da matriz e o total deste modal TEM que bater - qualquer mudanca aqui vale la tambem.
    const dtCel   = `TO_DATE('${data}','YYYY-MM-DD')`;
    const dtBase  = `NVL(M.MOV_DT_PRORROGADO, M.MOV_DT_VENCTO)`;
    const futuro  = `${dtCel} >= TRUNC(SYSDATE)`;
    // [21/09/2026 - Alexandre Carvalho] Forma de recebimento (tipo de cobranca): so a view do CR expoe
    // HCOB_*; a FIN_VW_CONTASPAGAR nao tem coluna de modalidade, entao no CP vai vazio.
    const colForma = tipo === 'CR' ? `SUBSTR(M.HCOB_ST_DESCRICAO, 1, 60)` : `CAST(NULL AS VARCHAR2(60))`;

    // [21/09/2026 - Alexandre Carvalho] V3 - ESPELHO da CCS_F_GFIN_FLUXO_PREVIO (sql/05):
    //   (F) D+1: no CR com d1='S' o dia da celula e a DATA DO CREDITO pelo prazo da forma (sql/17);
    //   (D) grupo='N' tira empresas do grupo (CR e CP); (E) classes tira do CR clientes nessas classes.
    const aplicaPrazo = tipo === 'CR' && d1 === 'S';
    const subPrazo = col => `NVL((SELECT PZ.${col} FROM MEGA.CCS_TB_GFIN_FLX_PRAZO PZ
                                  WHERE PZ.FORMA_ST_DESCRICAO = NVL(UPPER(TRIM(M.HCOB_ST_DESCRICAO)),'(SEM FORMA)')), 0)`;
    const dtPagto = `MEGA.F_PROXDIAUTIL(${dtBase}, 1, 200)`;     // dia util em que o titulo e pago
    const dtDia   = aplicaPrazo
      ? `MEGA.CCS_F_GFIN_FLX_DT_CREDITO(${dtBase}, ${subPrazo('PRZ_IN_DIAS_CORRIDOS')}, ${subPrazo('PRZ_IN_DIAS_UTEIS')}, 200)`
      : dtPagto;
    const folga   = aplicaPrazo
      ? `(SELECT 15 + NVL(MAX(PRZ_IN_DIAS_CORRIDOS),0) + NVL(MAX(PRZ_IN_DIAS_UTEIS),0) * 5 FROM MEGA.CCS_TB_GFIN_FLX_PRAZO)`
      : `15`;
    const filtroGrupo = grupo === 'N'
      ? `NOT EXISTS (SELECT 1 FROM MEGA.GLO_AGENTES_ID GI WHERE GI.AGN_IN_CODIGO = M.AGN_IN_CODIGO AND GI.AGN_TAU_ST_CODIGO = 'G')
         AND NOT EXISTS (SELECT 1 FROM MEGA.CCS_TB_GFIN_LIB_GRUPO_AGN GX WHERE GX.AGN_IN_CODIGO = M.AGN_IN_CODIGO)`
      : '1=1';
    const filtroClasses = (tipo === 'CR' && classes)
      ? `NOT EXISTS (SELECT 1 FROM MEGA.CCS_TB_GFIN_SCORE SC WHERE SC.AGN_IN_CODIGO = M.AGN_IN_CODIGO
                        AND SC.CLASSE IN (${classes.split(',').map(c => `'${c}'`).join(',')}))`
      : '1=1';

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
             CASE WHEN ${futuro} THEN NVL(M.SALDO_EM_ABERTO,0)
                  ELSE NVL(M.MOV_RE_VALOR,0) END               AS VALOR,
             NVL(M.MOV_RE_VALOR,0)                             AS VALOR_TITULO,
             NVL(M.SALDO_EM_ABERTO,0)                          AS SALDO_ABERTO,
             TO_CHAR(${dtBase}, 'YYYY-MM-DD')                  AS DATA_BASE,
             ${colForma}                                       AS FORMA,
             TO_CHAR(${dtPagto}, 'YYYY-MM-DD')                 AS DT_PAGTO,
             ${aplicaPrazo ? subPrazo('PRZ_IN_DIAS_CORRIDOS') : '0'} AS PRZ_COR,
             ${aplicaPrazo ? subPrazo('PRZ_IN_DIAS_UTEIS')    : '0'} AS PRZ_UTE,
             (SELECT MAX(SC.CLASSE) FROM MEGA.CCS_TB_GFIN_SCORE SC WHERE SC.AGN_IN_CODIGO = M.AGN_IN_CODIGO) AS CLASSE,
             M.TPD_ST_CODIGO                                   AS TIPO_DOC,
             M.${colTpdFatura}                                 AS TIPO_FATURA,
             CASE WHEN M.TPD_ST_CODIGO IN ('PDV','PREVPDC')
                  THEN 'PREVISTO' ELSE 'REALIZADO' END         AS STATUS,
             SUBSTR(NVL(M.MOV_ST_COMPLHIST,''), 1, 200)        AS HISTORICO,
             M.ACAO_IN_CODIGO                                  AS ACAO,
             ${subCaixa}                                       AS CAIXA
        FROM MEGA.${view} M,
             MEGA.GLO_AGENTES AGN
       WHERE M.AGN_TAB_IN_CODIGO = AGN.AGN_TAB_IN_CODIGO(+)
         AND M.AGN_PAD_IN_CODIGO = AGN.AGN_PAD_IN_CODIGO(+)
         AND M.AGN_IN_CODIGO     = AGN.AGN_IN_CODIGO(+)
         AND ${dtBase} BETWEEN ${dtCel} - ${folga} AND ${dtCel}
         AND ${dtDia} = ${dtCel}
         AND ${filtroGrupo}
         AND ${filtroClasses}
         AND (NOT (${futuro}) OR NVL(M.SALDO_EM_ABERTO,0) > 0)
         AND NVL(M.MOV_CH_SITUACAO,'A') <> 'C'
         AND ${filtroFil}
         AND ${filtroPrev}
       ORDER BY M.FIL_IN_CODIGO, M.MOV_ST_DOCUMENTO, M.MOV_ST_PARCELA`;

    const rows = await megaQuery(sql);
    const SEP = String.fromCharCode(167); // § do CHR(167)
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
      // [21/09/2026 - Alexandre Carvalho] V2: valor = o que CONTA no fluxo (saldo em aberto de hoje em
      // diante). valor_titulo = valor cheio. parcial = titulo com baixa parcial. rolado = a data base
      // (prorrogado) caiu em sabado/domingo/feriado e foi somada neste dia util. prorrogado = o
      // vencimento original e diferente da data base.
      valor_titulo: Number(r.VALOR_TITULO || 0),
      saldo_aberto: Number(r.SALDO_ABERTO || 0),
      data_base:    r.DATA_BASE || '',
      forma:        tipo === 'CR' ? ((r.FORMA || '').trim() || '(sem forma)') : '',
      parcial:     Number(r.VALOR || 0) + 0.005 < Number(r.VALOR_TITULO || 0),
      // rolado = a data base caiu em dia NAO util (o pagamento foi para o proximo dia util).
      // d1 = o dia da celula e o do CREDITO, deslocado pelo prazo da forma (prazo_cor corridos + prazo_ute uteis).
      rolado:       !!r.DATA_BASE && !!r.DT_PAGTO && r.DATA_BASE !== r.DT_PAGTO,
      dt_pagto:     r.DT_PAGTO || '',
      prazo_cor:    Number(r.PRZ_COR || 0),
      prazo_ute:    Number(r.PRZ_UTE || 0),
      d1:           Number(r.PRZ_COR || 0) + Number(r.PRZ_UTE || 0) > 0,
      classe:       tipo === 'CR' ? (r.CLASSE || '') : '',
      prorrogado:   !!r.DATA_BASE && !!r.VENCIMENTO && r.DATA_BASE !== r.VENCIMENTO,
      tipo_doc:     r.TIPO_DOC || '',
      tipo_fatura:  r.TIPO_FATURA || '',
      status:       r.STATUS || '',
      historico:    r.HISTORICO || '',
      acao:         Number(r.ACAO || 0),
      caixa_id:     r.CAIXA ? Number(String(r.CAIXA).split(SEP)[0] || 0) : null,
      caixa_nome:   r.CAIXA ? (String(r.CAIXA).split(SEP)[1] || '') : ''
    }));

    const totais = {
      total:     docs.reduce((s, d) => s + d.valor, 0),
      qtd:       docs.length,
      realizado: docs.filter(d => d.status === 'REALIZADO').reduce((s, d) => s + d.valor, 0),
      previsto:  docs.filter(d => d.status === 'PREVISTO' ).reduce((s, d) => s + d.valor, 0),
      qtd_realizado: docs.filter(d => d.status === 'REALIZADO').length,
      qtd_previsto:  docs.filter(d => d.status === 'PREVISTO' ).length,
      // [21/09/2026 - Alexandre Carvalho] V2: contadores para o aviso da tela
      qtd_rolados:     docs.filter(d => d.rolado).length,
      qtd_prorrogados: docs.filter(d => d.prorrogado).length,
      qtd_parciais:    docs.filter(d => d.parcial).length,
      qtd_d1:          docs.filter(d => d.d1).length
    };

    // [21/09/2026 - Alexandre Carvalho] so_aberto = dia de hoje em diante (regra do saldo em aberto ativa).
    // Data no fuso de Recife para nao virar o dia 3h antes quando o container roda em UTC.
    const hojeBr = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Recife' });

    return {
      filtro: { data, tipo, filiais, prev, grupo, classes, d1, so_aberto: data >= hojeBr },
      totais,
      docs
    };
  });
}
