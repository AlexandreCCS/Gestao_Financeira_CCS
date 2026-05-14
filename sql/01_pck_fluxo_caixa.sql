-- ============================================================================
-- [05/05/2026 - Alexandre Carvalho] Gestor Financeiro CCS - V1
-- Function pipelined CCS_F_GFIN_FLUXO_CAIXA: agrega entradas/saidas por periodo.
--
-- Origem dos dados:
--   FIN_MOVIMENTO - tabela canonica de movimentacoes financeiras no MEGA
--     MOV_RE_VALORCRE = entradas (creditos)
--     MOV_RE_VALORDEB = saidas (debitos)
--     MOV_DT_VENCTO   = data efetiva do movimento (poderia ser MOV_DT_ENTRADA)
--     FIL_IN_CODIGO   = filial
--   Filtro NVL(MOV_CH_SITUACAO,'A') NOT IN ('C') exclui movimentos cancelados.
--
-- Agrupamento (parametro P_PERIODO):
--   'D' - diario, 'S' - semanal (segunda a domingo), 'M' - mensal
-- ============================================================================

CREATE OR REPLACE TYPE MEGA.CCS_TY_GFIN_FLUXO_LINHA AS OBJECT (
  PERIODO   VARCHAR2(40),
  DT_INI    DATE,
  DT_FIM    DATE,
  ENTRADAS  NUMBER,
  SAIDAS    NUMBER,
  SALDO     NUMBER
);
/

CREATE OR REPLACE TYPE MEGA.CCS_TY_GFIN_FLUXO_TBL AS TABLE OF MEGA.CCS_TY_GFIN_FLUXO_LINHA;
/

CREATE OR REPLACE FUNCTION MEGA.CCS_F_GFIN_FLUXO_CAIXA(
    P_DATA_INI IN DATE,
    P_DATA_FIM IN DATE,
    P_PERIODO  IN VARCHAR2 DEFAULT 'M',
    P_FIL      IN NUMBER   DEFAULT 0
  ) RETURN MEGA.CCS_TY_GFIN_FLUXO_TBL PIPELINED IS

    V_DT_INI    DATE;
    V_DT_FIM    DATE;
    V_ENTRADAS  NUMBER;
    V_SAIDAS    NUMBER;
    V_LABEL     VARCHAR2(40);

  BEGIN
    FOR B IN (
      SELECT DT_INI, DT_FIM, LABEL FROM (
        SELECT
          CASE P_PERIODO
            WHEN 'D' THEN P_DATA_INI + LEVEL - 1
            WHEN 'S' THEN TRUNC(P_DATA_INI,'IW') + (LEVEL-1)*7
            WHEN 'M' THEN ADD_MONTHS(TRUNC(P_DATA_INI,'MM'), LEVEL-1)
          END AS DT_INI,
          CASE P_PERIODO
            WHEN 'D' THEN P_DATA_INI + LEVEL - 1
            WHEN 'S' THEN TRUNC(P_DATA_INI,'IW') + (LEVEL-1)*7 + 6
            WHEN 'M' THEN LAST_DAY(ADD_MONTHS(TRUNC(P_DATA_INI,'MM'), LEVEL-1))
          END AS DT_FIM,
          CASE P_PERIODO
            WHEN 'D' THEN TO_CHAR(P_DATA_INI + LEVEL - 1, 'DD/MM/YYYY')
            WHEN 'S' THEN 'Sem ' || TO_CHAR(TRUNC(P_DATA_INI,'IW') + (LEVEL-1)*7, 'DD/MM') ||
                          ' a '   || TO_CHAR(TRUNC(P_DATA_INI,'IW') + (LEVEL-1)*7 + 6, 'DD/MM')
            WHEN 'M' THEN TO_CHAR(ADD_MONTHS(TRUNC(P_DATA_INI,'MM'), LEVEL-1), 'MM/YYYY')
          END AS LABEL
        FROM DUAL
        CONNECT BY (
          CASE P_PERIODO
            WHEN 'D' THEN P_DATA_INI + LEVEL - 1
            WHEN 'S' THEN TRUNC(P_DATA_INI,'IW') + (LEVEL-1)*7
            WHEN 'M' THEN ADD_MONTHS(TRUNC(P_DATA_INI,'MM'), LEVEL-1)
          END
        ) <= P_DATA_FIM
      )
    ) LOOP
      V_DT_INI := B.DT_INI;
      V_DT_FIM := B.DT_FIM;
      V_LABEL  := B.LABEL;

      SELECT NVL(SUM(NVL(M.MOV_RE_VALORCRE, 0)), 0),
             NVL(SUM(NVL(M.MOV_RE_VALORDEB, 0)), 0)
        INTO V_ENTRADAS, V_SAIDAS
        FROM MEGA.FIN_MOVIMENTO M
       WHERE M.MOV_DT_VENCTO BETWEEN V_DT_INI AND V_DT_FIM
         AND NVL(M.MOV_CH_SITUACAO, 'A') <> 'C'
         AND (P_FIL = 0 OR M.FIL_IN_CODIGO = P_FIL);

      PIPE ROW(MEGA.CCS_TY_GFIN_FLUXO_LINHA(
        V_LABEL, V_DT_INI, V_DT_FIM, V_ENTRADAS, V_SAIDAS, V_ENTRADAS - V_SAIDAS
      ));
    END LOOP;

    RETURN;
  END;
/
