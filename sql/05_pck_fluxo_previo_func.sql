-- ============================================================================
-- [05/05/2026 - Alexandre Carvalho] Function pipelined CCS_F_GFIN_FLUXO_PREVIO
-- Returns matrix dia x categoria com datas roladas para proximo dia util.
-- ============================================================================

CREATE OR REPLACE TYPE MEGA.CCS_TY_GFIN_FLX_LIN AS OBJECT (
  DT_DIA       DATE,
  CATEGORIA    VARCHAR2(20),
  FIL_IN_CODIGO NUMBER,
  AGN_IN_CODIGO NUMBER,
  DESCRICAO    VARCHAR2(300),
  ENTRADA      NUMBER,
  SAIDA        NUMBER,
  QT_LANCTOS   NUMBER
);
/

CREATE OR REPLACE TYPE MEGA.CCS_TY_GFIN_FLX_TBL AS TABLE OF MEGA.CCS_TY_GFIN_FLX_LIN;
/

CREATE OR REPLACE FUNCTION MEGA.CCS_F_GFIN_FLUXO_PREVIO(
    P_DATA_INI            IN DATE,
    P_DATA_FIM            IN DATE,
    P_FILIAIS             IN VARCHAR2 DEFAULT '0',  -- '0'=todas | '400' | '400,401'
    P_INCLUIR_SIMULACOES  IN VARCHAR2 DEFAULT 'S',
    P_AGENTE_FERIADO      IN NUMBER   DEFAULT 200,  -- AGN p/ F_PROXDIAUTIL
    P_INCLUIR_PREVISAO    IN VARCHAR2 DEFAULT 'N'   -- [06/05/2026] 'S' inclui TPD PDV/PREVPDC; 'N' exclui
  ) RETURN MEGA.CCS_TY_GFIN_FLX_TBL PIPELINED IS

    V_FIL_TODAS CHAR(1) := CASE
                             WHEN P_FILIAIS IS NULL OR TRIM(P_FILIAIS) IN ('','0')
                             THEN 'S' ELSE 'N'
                           END;
    V_INCLUIR_PREV CHAR(1) := CASE WHEN UPPER(NVL(P_INCLUIR_PREVISAO,'N'))='S' THEN 'S' ELSE 'N' END;

    -- Helper: testa se filial bate com filtro CSV
    FUNCTION FIL_OK(P_FIL NUMBER) RETURN BOOLEAN IS
    BEGIN
      IF V_FIL_TODAS = 'S' THEN RETURN TRUE; END IF;
      RETURN INSTR(',' || P_FILIAIS || ',', ',' || TO_CHAR(P_FIL) || ',') > 0;
    END;

  BEGIN
    -- ============================================================================
    -- 1) SALDO INICIAL — [06/05/2026 - Alexandre Carvalho] Usa a MESMA logica de
    --    CCS_F_GFIN_SALDOS_BANCO em P_DATA_INI para o saldo bater EXATAMENTE
    --    com a tela de Saldos Bancarios na mesma data.
    --    Saldo Bancario Estimado = Saldo Conta - Movimentos pendentes nao conciliados.
    --    Filtra contas configuradas em CCS_TB_GFIN_FLX_CONTA; se vazia, usa todas.
    -- ============================================================================
    FOR R IN (
      SELECT B.AGN_IN_CODIGO, B.FIL_IN_CODIGO, B.AGN_ST_NOME, B.SALDO
        FROM TABLE(MEGA.CCS_F_GFIN_SALDOS_BANCO(P_DATA_INI, 0, 0)) B
       WHERE EXISTS (
              SELECT 1 FROM MEGA.CCS_TB_GFIN_FLX_CONTA C
               WHERE C.AGN_IN_CODIGO = B.AGN_IN_CODIGO AND C.FLX_CH_ATIVO = 'S'
              UNION ALL
              -- Se a tabela inteira esta vazia, considera todas:
              SELECT 1 FROM DUAL WHERE NOT EXISTS (
                SELECT 1 FROM MEGA.CCS_TB_GFIN_FLX_CONTA WHERE FLX_CH_ATIVO='S'
              )
             )
    ) LOOP
      IF FIL_OK(R.FIL_IN_CODIGO) AND NVL(R.SALDO, 0) <> 0 THEN
        PIPE ROW(MEGA.CCS_TY_GFIN_FLX_LIN(
          P_DATA_INI, 'SALDO_INICIAL',
          R.FIL_IN_CODIGO, R.AGN_IN_CODIGO,
          R.AGN_ST_NOME,
          CASE WHEN R.SALDO > 0 THEN R.SALDO ELSE 0 END,
          CASE WHEN R.SALDO < 0 THEN -R.SALDO ELSE 0 END,
          1
        ));
      END IF;
    END LOOP;

    -- ============================================================================
    -- 2) CONTAS A RECEBER - agregadas por (data_rolada, filial)
    -- [06/05/2026] Categoria agora baseada no TPD:
    --   PDV (pedido de venda) = PREVISTO; demais TPDs = REALIZADO.
    -- Quando V_INCLUIR_PREV='N', exclui TPD PDV totalmente.
    -- ============================================================================
    FOR R IN (
      SELECT MEGA.F_PROXDIAUTIL(MOV_DT_VENCTO, 1, P_AGENTE_FERIADO) AS DT_DIA,
             FIL_IN_CODIGO,
             CASE WHEN TPD_ST_CODIGO = 'PDV' THEN 'CR_PREVISTO'
                  ELSE 'CR_REALIZADO' END AS CATEGORIA,
             SUM(NVL(MOV_RE_VALOR, 0)) AS VL_TOTAL,
             COUNT(*) AS QT
        FROM MEGA.FIN_VW_CONTASRECEBER
       WHERE MOV_DT_VENCTO BETWEEN P_DATA_INI AND P_DATA_FIM
         AND NVL(MOV_CH_SITUACAO,'A') <> 'C'
         AND (V_INCLUIR_PREV = 'S' OR TPD_ST_CODIGO <> 'PDV')
         AND (V_FIL_TODAS = 'S'
              OR INSTR(',' || P_FILIAIS || ',', ',' || TO_CHAR(FIL_IN_CODIGO) || ',') > 0)
       GROUP BY MEGA.F_PROXDIAUTIL(MOV_DT_VENCTO, 1, P_AGENTE_FERIADO), FIL_IN_CODIGO,
                CASE WHEN TPD_ST_CODIGO = 'PDV' THEN 'CR_PREVISTO' ELSE 'CR_REALIZADO' END
    ) LOOP
      PIPE ROW(MEGA.CCS_TY_GFIN_FLX_LIN(
        R.DT_DIA, R.CATEGORIA,
        R.FIL_IN_CODIGO, NULL,
        CASE R.CATEGORIA WHEN 'CR_REALIZADO' THEN 'Recebimentos realizados'
                          ELSE 'Recebimentos previstos' END,
        R.VL_TOTAL, 0, R.QT
      ));
    END LOOP;

    -- ============================================================================
    -- 3) CONTAS A PAGAR
    -- [06/05/2026] PREVPDC = PREVISTO; demais TPDs = REALIZADO.
    -- ============================================================================
    FOR R IN (
      SELECT MEGA.F_PROXDIAUTIL(MOV_DT_VENCTO, 1, P_AGENTE_FERIADO) AS DT_DIA,
             FIL_IN_CODIGO,
             CASE WHEN TPD_ST_CODIGO = 'PREVPDC' THEN 'CP_PREVISTO'
                  ELSE 'CP_REALIZADO' END AS CATEGORIA,
             SUM(NVL(MOV_RE_VALOR, 0)) AS VL_TOTAL,
             COUNT(*) AS QT
        FROM MEGA.FIN_VW_CONTASPAGAR
       WHERE MOV_DT_VENCTO BETWEEN P_DATA_INI AND P_DATA_FIM
         AND NVL(MOV_CH_SITUACAO,'A') <> 'C'
         AND (V_INCLUIR_PREV = 'S' OR TPD_ST_CODIGO <> 'PREVPDC')
         AND (V_FIL_TODAS = 'S'
              OR INSTR(',' || P_FILIAIS || ',', ',' || TO_CHAR(FIL_IN_CODIGO) || ',') > 0)
       GROUP BY MEGA.F_PROXDIAUTIL(MOV_DT_VENCTO, 1, P_AGENTE_FERIADO), FIL_IN_CODIGO,
                CASE WHEN TPD_ST_CODIGO = 'PREVPDC' THEN 'CP_PREVISTO' ELSE 'CP_REALIZADO' END
    ) LOOP
      PIPE ROW(MEGA.CCS_TY_GFIN_FLX_LIN(
        R.DT_DIA, R.CATEGORIA,
        R.FIL_IN_CODIGO, NULL,
        CASE R.CATEGORIA WHEN 'CP_REALIZADO' THEN 'Pagamentos realizados'
                          ELSE 'Pagamentos previstos' END,
        0, R.VL_TOTAL, R.QT
      ));
    END LOOP;

    -- ============================================================================
    -- 4) ADIANTAMENTOS (credito/debito separados pela natureza)
    -- ============================================================================
    FOR R IN (
      SELECT MEGA.F_PROXDIAUTIL(MOV_DT_VENCTO, 1, P_AGENTE_FERIADO) AS DT_DIA,
             FIL_IN_CODIGO,
             SUM(NVL(MOV_RE_VALORCRE, 0)) AS VL_CRE,
             SUM(NVL(MOV_RE_VALORDEB, 0)) AS VL_DEB,
             COUNT(*) AS QT
        FROM MEGA.FIN_VW_ADIANTAMENTO
       WHERE MOV_DT_VENCTO BETWEEN P_DATA_INI AND P_DATA_FIM
         AND NVL(MOV_CH_SITUACAO,'A') <> 'C'
         AND (V_FIL_TODAS = 'S'
              OR INSTR(',' || P_FILIAIS || ',', ',' || TO_CHAR(FIL_IN_CODIGO) || ',') > 0)
       GROUP BY MEGA.F_PROXDIAUTIL(MOV_DT_VENCTO, 1, P_AGENTE_FERIADO), FIL_IN_CODIGO
    ) LOOP
      IF NVL(R.VL_CRE, 0) > 0 THEN
        PIPE ROW(MEGA.CCS_TY_GFIN_FLX_LIN(
          R.DT_DIA, 'ADIANT_C', R.FIL_IN_CODIGO, NULL,
          'Adiantamentos (entrada)', R.VL_CRE, 0, R.QT
        ));
      END IF;
      IF NVL(R.VL_DEB, 0) > 0 THEN
        PIPE ROW(MEGA.CCS_TY_GFIN_FLX_LIN(
          R.DT_DIA, 'ADIANT_D', R.FIL_IN_CODIGO, NULL,
          'Adiantamentos (saida)', 0, R.VL_DEB, R.QT
        ));
      END IF;
    END LOOP;

    -- ============================================================================
    -- 5) SIMULACOES (lancamentos hipoteticos do usuario)
    -- ============================================================================
    IF P_INCLUIR_SIMULACOES = 'S' THEN
      FOR R IN (
        SELECT MEGA.F_PROXDIAUTIL(SIM_DT_DATA, 1, P_AGENTE_FERIADO) AS DT_DIA,
               FIL_IN_CODIGO,
               SIM_CH_TIPO,
               SUM(SIM_RE_VALOR) AS VL,
               COUNT(*) AS QT
          FROM MEGA.CCS_TB_GFIN_FLX_SIM
         WHERE SIM_DT_DATA BETWEEN P_DATA_INI AND P_DATA_FIM
           AND (V_FIL_TODAS = 'S'
                OR INSTR(',' || P_FILIAIS || ',', ',' || TO_CHAR(FIL_IN_CODIGO) || ',') > 0)
         GROUP BY MEGA.F_PROXDIAUTIL(SIM_DT_DATA, 1, P_AGENTE_FERIADO),
                  FIL_IN_CODIGO, SIM_CH_TIPO
      ) LOOP
        PIPE ROW(MEGA.CCS_TY_GFIN_FLX_LIN(
          R.DT_DIA, 'SIMULACAO', R.FIL_IN_CODIGO, NULL,
          CASE R.SIM_CH_TIPO WHEN 'C' THEN 'Simulacao (entrada)'
                              ELSE 'Simulacao (saida)' END,
          CASE WHEN R.SIM_CH_TIPO = 'C' THEN R.VL ELSE 0 END,
          CASE WHEN R.SIM_CH_TIPO = 'D' THEN R.VL ELSE 0 END,
          R.QT
        ));
      END LOOP;
    END IF;

    RETURN;
  END;
/
