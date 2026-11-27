-- ============================================================================
-- [05/05/2026 - Alexandre Carvalho] Gestor Financeiro CCS - Saldos Bancarios
-- [14/05/2026 - ALTERADO POR ALEXANDRE CARVALHO] Sincronizado com producao:
--   CCS_F_GFIN_SALDOS_BANCO V3 -> V6 (exige FIN_CONCILIACAO + exclui contas
--     inativas AGN_CH_STATUS<>'A'; delega o saldo ao helper escalar abaixo).
--   CCS_F_GFIN_SALDO_BANCO_DT V4 - helper escalar criado em 07/05/2026 que
--     espelha a tela Conciliacao Bancaria do MEGA (banco = SALDO_IMPL + SUM
--     FIN_CONCILIACAO de todas as ORGs; caixa interno sem extrato = 0).
--
-- Ordem de criacao: tipos -> CCS_F_GFIN_SALDO_BANCO_DT -> CCS_F_GFIN_SALDOS_BANCO
-- (a pipelined V6 chama o helper escalar).
-- ============================================================================

CREATE OR REPLACE TYPE MEGA.CCS_TY_GFIN_SALDOBCO_LIN AS OBJECT (
  AGN_IN_CODIGO  NUMBER,
  AGN_ST_NOME    VARCHAR2(120),
  FIL_IN_CODIGO  NUMBER,
  FIL_ST_NOME    VARCHAR2(120),
  ENTRADAS       NUMBER,
  SAIDAS         NUMBER,
  SALDO          NUMBER
);
/

CREATE OR REPLACE TYPE MEGA.CCS_TY_GFIN_SALDOBCO_TBL AS TABLE OF MEGA.CCS_TY_GFIN_SALDOBCO_LIN;
/

CREATE OR REPLACE FUNCTION MEGA.CCS_F_GFIN_SALDO_BANCO_DT(
    P_AGN  IN NUMBER,
    P_DATA IN DATE
  ) RETURN NUMBER IS
    -- ========================================================================
    -- [08/05/2026 - ALTERADO POR ALEXANDRE CARVALHO]
    -- V4: ESPELHA EXATAMENTE A TELA DE CONCILIACAO BANCARIA DO MEGA.
    -- - BANCOS COM FIN_CONCILIACAO: SALDO_IMPL + SUM(FIN_CONCILIACAO TODAS ORGs) - V3
    -- - CAIXAS INTERNOS (SEM FIN_CONCILIACAO): RETORNA 0 (MEGA TBM MOSTRA 0)
    --
    -- DECISAO QUALITY 08/05/2026: GF DEVE BATER COM TELA MEGA NA VIRGULA.
    -- ANTES (V3): CAIXA RETORNAVA F_SALDOAGENTE - PENDENTES = SALDO CONTABIL.
    -- AGORA (V4): CAIXA RETORNA 0 - CONSISTENTE COM TELA CONCILIACAO MEGA.
    -- IMPLICACAO: CAIXAS SOMEM DA TELA SALDOS BANCARIOS DO GF (FILTRO <>0 NA
    -- PIPELINED CCS_F_GFIN_SALDOS_BANCO).
    -- ========================================================================
    V_DT_IMPL    DATE;
    V_TEM_CONC   NUMBER := 0;
    V_SALDO_IMPL NUMBER := 0;
    V_SALDO_CONC NUMBER := 0;
  BEGIN
    -- VERIFICA SE A CONTA TEM CONCILIACAO BANCARIA
    BEGIN
      SELECT COUNT(*) INTO V_TEM_CONC FROM (
        SELECT 1 FROM MEGA.FIN_CONCILIACAO
         WHERE AGN_IN_CODIGO     = P_AGN
           AND AGN_TAU_ST_CODIGO = 'N'
           AND ROWNUM = 1);
    EXCEPTION WHEN OTHERS THEN V_TEM_CONC := 0; END;

    -- CAIXA INTERNO SEM EXTRATO -> RETORNA 0 (MESMO QUE O MEGA MOSTRA NA TELA)
    IF V_TEM_CONC = 0 THEN
      RETURN 0;
    END IF;

    -- BANCO COM EXTRATO - LOGICA V3 (TODAS ORGs)
    BEGIN
      SELECT CTA_DT_CONCFINANC
        INTO V_DT_IMPL
        FROM MEGA.GLO_CONTASFIN
       WHERE AGN_IN_CODIGO     = P_AGN
         AND AGN_TAU_ST_CODIGO = 'N'
         AND ROWNUM = 1;
    EXCEPTION WHEN OTHERS THEN V_DT_IMPL := DATE '2000-01-01'; END;

    BEGIN
      SELECT NVL(SUM(SAG_RE_VALORDEB) - SUM(SAG_RE_VALORCRE), 0)
        INTO V_SALDO_IMPL
        FROM MEGA.FIN_SALDOAGENTE
       WHERE AGN_PAD_IN_CODIGO = 1
         AND AGN_IN_CODIGO     = P_AGN
         AND CRI_IN_CODIGO     = 1
         AND SAG_DT_DIA        < V_DT_IMPL
         AND SAG_CH_TIPO       = 'D';
    EXCEPTION WHEN OTHERS THEN V_SALDO_IMPL := 0; END;

    BEGIN
      SELECT NVL(SUM(DECODE(CBA_CH_NATUREZA, 'D', CBA_RE_VALOR * -1, CBA_RE_VALOR)), 0)
        INTO V_SALDO_CONC
        FROM MEGA.FIN_CONCILIACAO
       WHERE AGN_IN_CODIGO     = P_AGN
         AND AGN_TAU_ST_CODIGO = 'N'
         AND CBA_DT_DATA       BETWEEN V_DT_IMPL AND P_DATA;
    EXCEPTION WHEN OTHERS THEN V_SALDO_CONC := 0; END;

    RETURN NVL(V_SALDO_IMPL, 0) + NVL(V_SALDO_CONC, 0);
  END;
/

CREATE OR REPLACE FUNCTION MEGA.CCS_F_GFIN_SALDOS_BANCO(
    P_DATA IN DATE,
    P_FIL  IN NUMBER DEFAULT 0,
    P_AGN  IN NUMBER DEFAULT 0
  ) RETURN MEGA.CCS_TY_GFIN_SALDOBCO_TBL PIPELINED IS
    -- ============================================================================
    -- [08/05/2026 - ALTERADO POR ALEXANDRE CARVALHO]
    -- V6: ALEM DE EXIGIR FIN_CONCILIACAO (V5), EXCLUI CONTAS INATIVAS
    -- (GLO_AGENTES_ID.AGN_CH_STATUS <> 'A'). Removia 8 contas inativas com saldos
    -- negativos absurdos (-R$ 21,7M) que distorciam o total.
    -- DECISAO QUALITY 08/05/2026.
    -- ============================================================================
    V_ORG_DONA  NUMBER;
    V_TEM_CONC  NUMBER;
    V_SALDO     NUMBER;
    V_FIL_NOME  VARCHAR2(120);
  BEGIN
    FOR R IN (
      SELECT M.AGN_IN_CODIGO,
             MAX(A.AGN_ST_NOME)                  AS AGN_ST_NOME,
             NVL(SUM(M.MOV_RE_VALORDEB),0)       AS ENTRADAS,
             NVL(SUM(M.MOV_RE_VALORCRE),0)       AS SAIDAS
        FROM MEGA.FIN_MOVIMENTO  M,
             MEGA.GLO_AGENTES_ID I,
             MEGA.GLO_AGENTES    A
       WHERE I.AGN_TAU_ST_CODIGO = 'N'
         AND NVL(I.AGN_CH_STATUS, 'A') = 'A'                -- [V6] so contas ativas
         AND M.AGN_TAB_IN_CODIGO = I.AGN_TAB_IN_CODIGO
         AND M.AGN_PAD_IN_CODIGO = I.AGN_PAD_IN_CODIGO
         AND M.AGN_IN_CODIGO     = I.AGN_IN_CODIGO
         AND M.AGN_TAU_ST_CODIGO = I.AGN_TAU_ST_CODIGO
         AND I.AGN_TAB_IN_CODIGO = A.AGN_TAB_IN_CODIGO
         AND I.AGN_PAD_IN_CODIGO = A.AGN_PAD_IN_CODIGO
         AND I.AGN_IN_CODIGO     = A.AGN_IN_CODIGO
         AND M.MOV_DT_VENCTO    <= P_DATA
         AND NVL(M.MOV_CH_SITUACAO,'A') <> 'C'
         AND (P_AGN = 0 OR M.AGN_IN_CODIGO = P_AGN)
       GROUP BY M.AGN_IN_CODIGO
    ) LOOP
      -- [V5] exige extrato bancario (caixa interno = 0 = some)
      V_TEM_CONC := 0;
      BEGIN
        SELECT COUNT(*) INTO V_TEM_CONC FROM (
          SELECT 1 FROM MEGA.FIN_CONCILIACAO
           WHERE AGN_IN_CODIGO     = R.AGN_IN_CODIGO
             AND AGN_TAU_ST_CODIGO = 'N'
             AND ROWNUM = 1);
      EXCEPTION WHEN OTHERS THEN V_TEM_CONC := 0; END;
      IF V_TEM_CONC = 0 THEN
        GOTO PROXIMO;
      END IF;

      V_ORG_DONA := NULL;
      BEGIN
        SELECT MIN(ORG_IN_CODIGO) INTO V_ORG_DONA
          FROM MEGA.FIN_CONCILIACAO
         WHERE AGN_IN_CODIGO     = R.AGN_IN_CODIGO
           AND AGN_TAU_ST_CODIGO = 'N';
      EXCEPTION WHEN OTHERS THEN V_ORG_DONA := NULL; END;

      IF P_FIL > 0 AND NVL(V_ORG_DONA, 0) <> P_FIL THEN
        GOTO PROXIMO;
      END IF;

      V_SALDO := MEGA.CCS_F_GFIN_SALDO_BANCO_DT(R.AGN_IN_CODIGO, P_DATA);

      V_FIL_NOME := NULL;
      IF V_ORG_DONA IS NOT NULL THEN
        BEGIN
          SELECT NVL(O.ORG_ST_FANTASIA, O.ORG_ST_NOME)
            INTO V_FIL_NOME
            FROM MEGA.GLO_VW_ORGANIZACAO O
           WHERE O.ORG_IN_CODIGO = V_ORG_DONA
             AND ROWNUM = 1;
        EXCEPTION WHEN OTHERS THEN V_FIL_NOME := NULL; END;
      END IF;

      PIPE ROW(MEGA.CCS_TY_GFIN_SALDOBCO_LIN(
        R.AGN_IN_CODIGO,
        R.AGN_ST_NOME,
        NVL(V_ORG_DONA, 0),
        NVL(V_FIL_NOME, '(SEM ORG)'),
        R.ENTRADAS,
        R.SAIDAS,
        V_SALDO
      ));

      <<PROXIMO>>
      NULL;
    END LOOP;
    RETURN;
  END;
/
