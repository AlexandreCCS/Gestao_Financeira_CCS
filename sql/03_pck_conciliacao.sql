-- ============================================================================
-- [05/05/2026 - Alexandre Carvalho] KPIs de Conciliacao Bancaria por Conta x Filial
--
-- Indicadores por (AGN, FIL):
--   QT_MOV       - movimentos no periodo
--   QT_CONC      - conciliados
--   QT_PEND      - pendentes
--   PCT_CONC     - taxa de conciliacao (%)
--   VL_PEND      - valor liquido pendente (DEB - CRE dos pendentes)
--   VL_CONC      - valor liquido conciliado
--   AGING_0_30   - pendentes com vencimento nos ultimos 30 dias
--   AGING_31_60  - pendentes 31-60 dias atras
--   AGING_61_90  - pendentes 61-90 dias atras
--   AGING_90P    - pendentes mais de 90 dias (criticos)
--   DT_ULT_PEND  - data do pendente mais antigo
--   DT_ULT_CONC  - data da ultima conciliacao
-- ============================================================================

CREATE OR REPLACE TYPE MEGA.CCS_TY_GFIN_CONC_LIN AS OBJECT (
  AGN_IN_CODIGO  NUMBER,
  AGN_ST_NOME    VARCHAR2(120),
  FIL_IN_CODIGO  NUMBER,
  FIL_ST_NOME    VARCHAR2(120),
  QT_MOV         NUMBER,
  QT_CONC        NUMBER,
  QT_PEND        NUMBER,
  PCT_CONC       NUMBER,
  VL_PEND        NUMBER,
  VL_CONC        NUMBER,
  AGING_0_30     NUMBER,
  AGING_31_60    NUMBER,
  AGING_61_90    NUMBER,
  AGING_90P      NUMBER,
  DT_ULT_PEND    DATE,
  DT_ULT_CONC    DATE
);
/

CREATE OR REPLACE TYPE MEGA.CCS_TY_GFIN_CONC_TBL AS TABLE OF MEGA.CCS_TY_GFIN_CONC_LIN;
/

CREATE OR REPLACE FUNCTION MEGA.CCS_F_GFIN_CONCILIACAO(
    P_DATA_INI IN DATE,
    P_DATA_FIM IN DATE,
    P_FIL      IN NUMBER DEFAULT 0
  ) RETURN MEGA.CCS_TY_GFIN_CONC_TBL PIPELINED IS
  BEGIN
    FOR R IN (
      SELECT M.AGN_IN_CODIGO,
             MAX(A.AGN_ST_NOME)                                      AS AGN_ST_NOME,
             M.FIL_IN_CODIGO,
             MAX(NVL(O.ORG_ST_FANTASIA, O.ORG_ST_NOME))              AS FIL_ST_NOME,
             COUNT(*)                                                 AS QT_MOV,
             COUNT(CASE WHEN M.MOV_CH_CONCILIADO='S' THEN 1 END)      AS QT_CONC,
             COUNT(CASE WHEN NVL(M.MOV_CH_CONCILIADO,'N')='N' THEN 1 END) AS QT_PEND,
             -- valor pendente liquido (DEB - CRE)
             SUM(CASE WHEN NVL(M.MOV_CH_CONCILIADO,'N')='N'
                      THEN NVL(M.MOV_RE_VALORDEB,0) - NVL(M.MOV_RE_VALORCRE,0) ELSE 0 END) AS VL_PEND,
             SUM(CASE WHEN M.MOV_CH_CONCILIADO='S'
                      THEN NVL(M.MOV_RE_VALORDEB,0) - NVL(M.MOV_RE_VALORCRE,0) ELSE 0 END) AS VL_CONC,
             -- aging dos pendentes (idade contada vs P_DATA_FIM)
             COUNT(CASE WHEN NVL(M.MOV_CH_CONCILIADO,'N')='N'
                         AND M.MOV_DT_VENCTO >= P_DATA_FIM - 30 THEN 1 END) AS AGING_0_30,
             COUNT(CASE WHEN NVL(M.MOV_CH_CONCILIADO,'N')='N'
                         AND M.MOV_DT_VENCTO BETWEEN P_DATA_FIM - 60 AND P_DATA_FIM - 31 THEN 1 END) AS AGING_31_60,
             COUNT(CASE WHEN NVL(M.MOV_CH_CONCILIADO,'N')='N'
                         AND M.MOV_DT_VENCTO BETWEEN P_DATA_FIM - 90 AND P_DATA_FIM - 61 THEN 1 END) AS AGING_61_90,
             COUNT(CASE WHEN NVL(M.MOV_CH_CONCILIADO,'N')='N'
                         AND M.MOV_DT_VENCTO < P_DATA_FIM - 90 THEN 1 END) AS AGING_90P,
             MIN(CASE WHEN NVL(M.MOV_CH_CONCILIADO,'N')='N' THEN M.MOV_DT_VENCTO END) AS DT_PEND_MAIS_ANTIGO,
             MAX(CASE WHEN M.MOV_CH_CONCILIADO='S' THEN M.MOV_DT_VENCTO END)         AS DT_ULT_CONC
        FROM MEGA.FIN_MOVIMENTO       M,
             MEGA.GLO_AGENTES_ID      I,
             MEGA.GLO_AGENTES         A,
             MEGA.GLO_VW_ORGANIZACAO  O
       WHERE I.AGN_TAU_ST_CODIGO = 'N'
         AND M.AGN_TAB_IN_CODIGO = I.AGN_TAB_IN_CODIGO
         AND M.AGN_PAD_IN_CODIGO = I.AGN_PAD_IN_CODIGO
         AND M.AGN_IN_CODIGO     = I.AGN_IN_CODIGO
         AND M.AGN_TAU_ST_CODIGO = I.AGN_TAU_ST_CODIGO
         AND I.AGN_TAB_IN_CODIGO = A.AGN_TAB_IN_CODIGO
         AND I.AGN_PAD_IN_CODIGO = A.AGN_PAD_IN_CODIGO
         AND I.AGN_IN_CODIGO     = A.AGN_IN_CODIGO
         AND O.ORG_IN_CODIGO (+) = M.FIL_IN_CODIGO
         AND M.MOV_DT_VENCTO BETWEEN P_DATA_INI AND P_DATA_FIM
         AND NVL(M.MOV_CH_SITUACAO,'A') <> 'C'
         AND (P_FIL = 0 OR M.FIL_IN_CODIGO = P_FIL)
       GROUP BY M.AGN_IN_CODIGO, M.FIL_IN_CODIGO
    ) LOOP
      PIPE ROW(MEGA.CCS_TY_GFIN_CONC_LIN(
        R.AGN_IN_CODIGO, R.AGN_ST_NOME,
        R.FIL_IN_CODIGO, R.FIL_ST_NOME,
        R.QT_MOV, R.QT_CONC, R.QT_PEND,
        CASE WHEN R.QT_MOV > 0 THEN ROUND(R.QT_CONC * 100 / R.QT_MOV, 2) ELSE 0 END,
        R.VL_PEND, R.VL_CONC,
        R.AGING_0_30, R.AGING_31_60, R.AGING_61_90, R.AGING_90P,
        R.DT_PEND_MAIS_ANTIGO, R.DT_ULT_CONC
      ));
    END LOOP;
    RETURN;
  END;
/
