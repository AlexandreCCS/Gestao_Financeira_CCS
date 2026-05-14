-- ============================================================================
-- [06/05/2026 - ALEXANDRE CARVALHO] DRILLDOWN DE DOCUMENTOS DO FLUXO DE CAIXA.
-- RETORNA A LISTA DETALHADA DE DOCUMENTOS QUE COMPOEM O VALOR AGREGADO DE
-- RECEBIMENTO (CR) OU PAGAMENTO (CP) DE UM DIA NA TABELA DO FLUXO.
--
-- A DATA RECEBIDA E A DATA "ROLADA" PARA PROXIMO DIA UTIL (mesma logica de
-- CCS_F_GFIN_FLUXO_PREVIO via F_PROXDIAUTIL). FILTRA POR FILIAIS CSV.
-- ============================================================================
CREATE OR REPLACE PACKAGE MEGA.CCS_PCK_GFIN_DOCS AS
  PROCEDURE SP_DOCS_DIA(
    P_DATA            IN DATE,
    P_TIPO            IN VARCHAR2,                        -- 'CR' ou 'CP'
    P_FILIAIS         IN VARCHAR2 DEFAULT '0',
    P_AGENTE_FERIADO  IN NUMBER   DEFAULT 200,
    PRESULT           OUT SYS_REFCURSOR
  );
END CCS_PCK_GFIN_DOCS;
/

CREATE OR REPLACE PACKAGE BODY MEGA.CCS_PCK_GFIN_DOCS AS

  PROCEDURE SP_DOCS_DIA(
    P_DATA            IN DATE,
    P_TIPO            IN VARCHAR2,
    P_FILIAIS         IN VARCHAR2 DEFAULT '0',
    P_AGENTE_FERIADO  IN NUMBER   DEFAULT 200,
    PRESULT           OUT SYS_REFCURSOR
  ) AS
    V_FIL_TODAS CHAR(1) := CASE
                             WHEN P_FILIAIS IS NULL OR TRIM(P_FILIAIS) IN ('','0')
                             THEN 'S' ELSE 'N'
                           END;
    V_TIPO VARCHAR2(10) := UPPER(NVL(P_TIPO,'CR'));
  BEGIN
    IF V_TIPO = 'CR' THEN
      -- ============================================================
      -- RECEBIMENTOS - FIN_VW_CONTASRECEBER
      -- ============================================================
      OPEN PRESULT FOR
        SELECT M.MOV_ST_DOCUMENTO                                    AS DOCUMENTO,
               M.MOV_ST_PARCELA                                      AS PARCELA,
               TO_CHAR(M.MOV_DT_VENCTO, 'YYYY-MM-DD')                AS VENCIMENTO,
               TO_CHAR(M.MOV_DT_PRORROGADO, 'YYYY-MM-DD')            AS VENC_PROR,
               TO_CHAR(M.MOV_DT_DATADOCTO, 'YYYY-MM-DD')             AS EMISSAO,
               TO_CHAR(M.MOV_DT_ENTRADA, 'YYYY-MM-DD')               AS ENTRADA,
               M.FIL_IN_CODIGO                                       AS FILIAL,
               M.AGN_IN_CODIGO                                       AS COD_AGENTE,
               SUBSTR(AGN.AGN_ST_NOME, 1, 60)                        AS NOME_AGENTE,
               SUBSTR(NVL(AGN.AGN_ST_CGC, ''), 1, 20)                AS CGC,
               M.MOV_RE_VALOR                                        AS VALOR,
               M.TPD_ST_CODIGO                                       AS TIPO_DOC,
               M.FRE_TPD_ST_CODIGO                                   AS TIPO_FATURA,
               CASE WHEN NVL(M.MOV_CH_STATUSBXREF,'N')='S'
                    THEN 'REALIZADO' ELSE 'PREVISTO' END             AS STATUS,
               SUBSTR(NVL(M.MOV_ST_COMPLHIST,''), 1, 200)            AS HISTORICO,
               M.ACAO_IN_CODIGO                                      AS ACAO
          FROM MEGA.FIN_VW_CONTASRECEBER M,
               MEGA.GLO_AGENTES          AGN
         WHERE M.AGN_TAB_IN_CODIGO = AGN.AGN_TAB_IN_CODIGO(+)
           AND M.AGN_PAD_IN_CODIGO = AGN.AGN_PAD_IN_CODIGO(+)
           AND M.AGN_IN_CODIGO     = AGN.AGN_IN_CODIGO(+)
           AND MEGA.F_PROXDIAUTIL(M.MOV_DT_VENCTO, 1, P_AGENTE_FERIADO) = P_DATA
           AND NVL(M.MOV_CH_SITUACAO,'A') <> 'C'
           AND (V_FIL_TODAS = 'S'
                OR INSTR(',' || P_FILIAIS || ',', ',' || TO_CHAR(M.FIL_IN_CODIGO) || ',') > 0)
         ORDER BY M.FIL_IN_CODIGO, M.MOV_ST_DOCUMENTO, M.MOV_ST_PARCELA;
    ELSE
      -- ============================================================
      -- PAGAMENTOS - FIN_VW_CONTASPAGAR
      -- ============================================================
      OPEN PRESULT FOR
        SELECT M.MOV_ST_DOCUMENTO                                    AS DOCUMENTO,
               M.MOV_ST_PARCELA                                      AS PARCELA,
               TO_CHAR(M.MOV_DT_VENCTO, 'YYYY-MM-DD')                AS VENCIMENTO,
               TO_CHAR(M.MOV_DT_PRORROGADO, 'YYYY-MM-DD')            AS VENC_PROR,
               TO_CHAR(M.MOV_DT_DATADOCTO, 'YYYY-MM-DD')             AS EMISSAO,
               TO_CHAR(M.MOV_DT_ENTRADA, 'YYYY-MM-DD')               AS ENTRADA,
               M.FIL_IN_CODIGO                                       AS FILIAL,
               M.AGN_IN_CODIGO                                       AS COD_AGENTE,
               SUBSTR(AGN.AGN_ST_NOME, 1, 60)                        AS NOME_AGENTE,
               SUBSTR(NVL(AGN.AGN_ST_CGC, ''), 1, 20)                AS CGC,
               M.MOV_RE_VALOR                                        AS VALOR,
               M.TPD_ST_CODIGO                                       AS TIPO_DOC,
               M.FPA_TPD_ST_CODIGO                                   AS TIPO_FATURA,
               CASE WHEN NVL(M.MOV_CH_STATUSBXREF,'N')='S'
                    THEN 'REALIZADO' ELSE 'PREVISTO' END             AS STATUS,
               SUBSTR(NVL(M.MOV_ST_COMPLHIST,''), 1, 200)            AS HISTORICO,
               M.ACAO_IN_CODIGO                                      AS ACAO
          FROM MEGA.FIN_VW_CONTASPAGAR M,
               MEGA.GLO_AGENTES        AGN
         WHERE M.AGN_TAB_IN_CODIGO = AGN.AGN_TAB_IN_CODIGO(+)
           AND M.AGN_PAD_IN_CODIGO = AGN.AGN_PAD_IN_CODIGO(+)
           AND M.AGN_IN_CODIGO     = AGN.AGN_IN_CODIGO(+)
           AND MEGA.F_PROXDIAUTIL(M.MOV_DT_VENCTO, 1, P_AGENTE_FERIADO) = P_DATA
           AND NVL(M.MOV_CH_SITUACAO,'A') <> 'C'
           AND (V_FIL_TODAS = 'S'
                OR INSTR(',' || P_FILIAIS || ',', ',' || TO_CHAR(M.FIL_IN_CODIGO) || ',') > 0)
         ORDER BY M.FIL_IN_CODIGO, M.MOV_ST_DOCUMENTO, M.MOV_ST_PARCELA;
    END IF;
  END SP_DOCS_DIA;

END CCS_PCK_GFIN_DOCS;
/
