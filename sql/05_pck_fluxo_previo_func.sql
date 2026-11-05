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
    P_INCLUIR_PREVISAO    IN VARCHAR2 DEFAULT 'N',  -- [06/05/2026] 'S' inclui TPD PDV/PREVPDC; 'N' exclui
    -- [21/09/2026 - Alexandre Carvalho] V3 (PEDIDO RENATA/QUALITY). OS PADROES MANTEM O COMPORTAMENTO DA V2:
    P_INCLUIR_GRUPO       IN VARCHAR2 DEFAULT 'S',  -- 'N' TIRA EMPRESAS DO GRUPO DO CR E DO CP
    P_CLASSES_FORA        IN VARCHAR2 DEFAULT NULL, -- EX. 'D,E': TIRA DO CR CLIENTES COM ESSA CLASSE DE CREDITO
    P_PRAZO_CREDITO       IN VARCHAR2 DEFAULT 'N'   -- 'S' = CR PELA DATA DO CREDITO EM CONTA ("D+1" POR FORMA)
  ) RETURN MEGA.CCS_TY_GFIN_FLX_TBL PIPELINED IS

    V_FIL_TODAS CHAR(1) := CASE
                             WHEN P_FILIAIS IS NULL OR TRIM(P_FILIAIS) IN ('','0')
                             THEN 'S' ELSE 'N'
                           END;
    V_INCLUIR_PREV CHAR(1) := CASE WHEN UPPER(NVL(P_INCLUIR_PREVISAO,'N'))='S' THEN 'S' ELSE 'N' END;

    -- [21/09/2026 - Alexandre Carvalho] V2 (PEDIDO RENATA/QUALITY, DOC "BI FINANCEIRO - MELHORIAS"):
    --   (A) DATA BASE DE CR/CP = MOV_DT_PRORROGADO (NVL VENCIMENTO): TITULO PRORROGADO CAI NO DIA NOVO.
    --   (B) JANELA PELO DIA ROLADO: O BETWEEN PASSA A VALER SOBRE A DATA JA ROLADA PARA O PROXIMO DIA
    --       UTIL. ANTES FILTRAVA A DATA CRUA E O SABADO/DOMINGO/FERIADO ANTERIOR A P_DATA_INI FICAVA
    --       FORA DA CELULA (O DRILLDOWN MOSTRAVA, A MATRIZ NAO). V_FOLGA = DIAS OLHADOS PARA TRAS.
    --   (C) DE HOJE EM DIANTE SO O SALDO EM ABERTO: DIA ROLADO >= V_HOJE USA SALDO_EM_ABERTO E IGNORA
    --       TITULO QUITADO (JA ESTA NO SALDO BANCARIO - CONTAVA EM DOBRO). DIAS PASSADOS SEGUEM PELO
    --       VALOR DO TITULO (COMPORTAMENTO ANTERIOR).
    V_HOJE  DATE   := TRUNC(SYSDATE);
    V_FOLGA NUMBER := 15;

    -- [21/09/2026 - Alexandre Carvalho] V3 (PEDIDO RENATA/QUALITY, MESMO DOC, BLOCO FLUXO DE CAIXA):
    --   (D) EMPRESAS DO GRUPO: P_INCLUIR_GRUPO='N' TIRA DO CR E DO CP OS AGENTES DO GRUPO. MESMA REGRA
    --       DA LIBERACAO DE DATA DE BAIXA: GLO_AGENTES_ID.AGN_TAU_ST_CODIGO='G' OU CCS_TB_GFIN_LIB_GRUPO_AGN.
    --   (E) HISTORICO DE ATRASO: P_CLASSES_FORA (EX. 'C,D,E') TIRA DO CR OS CLIENTES CUJA CLASSE NA
    --       INTELIGENCIA DE CREDITO (CCS_TB_GFIN_SCORE.CLASSE, RECALCULADA TODA NOITE) ESTA NA LISTA.
    --   (F) D+1: P_PRAZO_CREDITO='S' PASSA O CR PARA A DATA DO CREDITO EM CONTA, PELO PRAZO DA FORMA
    --       DE RECEBIMENTO (CCS_TB_GFIN_FLX_PRAZO + CCS_F_GFIN_FLX_DT_CREDITO - sql/17). SO O CR.
    --       A FOLGA PARA TRAS CRESCE COM O MAIOR PRAZO CADASTRADO (CARTAO 30+1 OLHA ~50 DIAS).
    V_GRUPO    CHAR(1)       := CASE WHEN UPPER(NVL(P_INCLUIR_GRUPO,'S'))='N' THEN 'N' ELSE 'S' END;
    V_PRAZO    CHAR(1)       := CASE WHEN UPPER(NVL(P_PRAZO_CREDITO,'N'))='S' THEN 'S' ELSE 'N' END;
    V_CLASSES  VARCHAR2(40)  := REPLACE(UPPER(TRIM(P_CLASSES_FORA)), ' ', '');
    V_FOLGA_CR NUMBER        := 15;

    -- Helper: testa se filial bate com filtro CSV
    FUNCTION FIL_OK(P_FIL NUMBER) RETURN BOOLEAN IS
    BEGIN
      IF V_FIL_TODAS = 'S' THEN RETURN TRUE; END IF;
      RETURN INSTR(',' || P_FILIAIS || ',', ',' || TO_CHAR(P_FIL) || ',') > 0;
    END;

  BEGIN
    -- [21/09/2026 - Alexandre Carvalho] V3 (F): COM D+1 LIGADO A JANELA PARA TRAS ACOMPANHA O MAIOR PRAZO
    IF V_PRAZO = 'S' THEN
      SELECT 15 + NVL(MAX(PRZ_IN_DIAS_CORRIDOS), 0) + NVL(MAX(PRZ_IN_DIAS_UTEIS), 0) * 5
        INTO V_FOLGA_CR
        FROM MEGA.CCS_TB_GFIN_FLX_PRAZO;
    END IF;

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
    -- [21/09/2026 - Alexandre Carvalho] V2: DATA BASE PRORROGADA + JANELA PELO DIA ROLADO +
    -- SALDO EM ABERTO DE HOJE EM DIANTE (VER CABECALHO).
    FOR R IN (
      SELECT DT_DIA, FIL_IN_CODIGO, CATEGORIA,
             SUM(CASE WHEN DT_DIA >= V_HOJE THEN VL_ABERTO ELSE VL_TITULO END) AS VL_TOTAL,
             COUNT(*) AS QT
        -- [21/09/2026 - Alexandre Carvalho] V3: (F) DATA DO CREDITO PELO PRAZO DA FORMA QUANDO V_PRAZO='S';
        -- (D) EMPRESAS DO GRUPO; (E) CLASSES DE CREDITO DESCONSIDERADAS. VER CABECALHO.
        FROM (SELECT CASE WHEN V_PRAZO = 'S'
                          THEN MEGA.CCS_F_GFIN_FLX_DT_CREDITO(NVL(M.MOV_DT_PRORROGADO, M.MOV_DT_VENCTO),
                                                              NVL(PZ.PRZ_IN_DIAS_CORRIDOS, 0),
                                                              NVL(PZ.PRZ_IN_DIAS_UTEIS, 0), P_AGENTE_FERIADO)
                          ELSE MEGA.F_PROXDIAUTIL(NVL(M.MOV_DT_PRORROGADO, M.MOV_DT_VENCTO), 1, P_AGENTE_FERIADO)
                     END AS DT_DIA,
                     M.FIL_IN_CODIGO,
                     CASE WHEN M.TPD_ST_CODIGO = 'PDV' THEN 'CR_PREVISTO'
                          ELSE 'CR_REALIZADO' END AS CATEGORIA,
                     NVL(M.MOV_RE_VALOR, 0)    AS VL_TITULO,
                     NVL(M.SALDO_EM_ABERTO, 0) AS VL_ABERTO
                FROM MEGA.FIN_VW_CONTASRECEBER M
                LEFT JOIN MEGA.CCS_TB_GFIN_FLX_PRAZO PZ
                       ON PZ.FORMA_ST_DESCRICAO = NVL(UPPER(TRIM(M.HCOB_ST_DESCRICAO)), '(SEM FORMA)')
               WHERE NVL(M.MOV_DT_PRORROGADO, M.MOV_DT_VENCTO) BETWEEN P_DATA_INI - V_FOLGA_CR AND P_DATA_FIM
                 AND NVL(M.MOV_CH_SITUACAO,'A') <> 'C'
                 AND (V_INCLUIR_PREV = 'S' OR M.TPD_ST_CODIGO <> 'PDV')
                 AND (V_FIL_TODAS = 'S'
                      OR INSTR(',' || P_FILIAIS || ',', ',' || TO_CHAR(M.FIL_IN_CODIGO) || ',') > 0)
                 AND (V_GRUPO = 'S'
                      OR (NOT EXISTS (SELECT 1 FROM MEGA.GLO_AGENTES_ID GI
                                       WHERE GI.AGN_IN_CODIGO = M.AGN_IN_CODIGO AND GI.AGN_TAU_ST_CODIGO = 'G')
                          AND NOT EXISTS (SELECT 1 FROM MEGA.CCS_TB_GFIN_LIB_GRUPO_AGN GX
                                           WHERE GX.AGN_IN_CODIGO = M.AGN_IN_CODIGO)))
                 AND (V_CLASSES IS NULL
                      OR NOT EXISTS (SELECT 1 FROM MEGA.CCS_TB_GFIN_SCORE SC
                                      WHERE SC.AGN_IN_CODIGO = M.AGN_IN_CODIGO
                                        AND INSTR(',' || V_CLASSES || ',', ',' || SC.CLASSE || ',') > 0)))
       WHERE DT_DIA BETWEEN P_DATA_INI AND P_DATA_FIM
         AND (DT_DIA < V_HOJE OR VL_ABERTO > 0)
       GROUP BY DT_DIA, FIL_IN_CODIGO, CATEGORIA
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
    -- [21/09/2026 - Alexandre Carvalho] V2: MESMA REGRA DO CR (PRORROGADO + DIA ROLADO + SALDO EM ABERTO).
    FOR R IN (
      SELECT DT_DIA, FIL_IN_CODIGO, CATEGORIA,
             SUM(CASE WHEN DT_DIA >= V_HOJE THEN VL_ABERTO ELSE VL_TITULO END) AS VL_TOTAL,
             COUNT(*) AS QT
        FROM (SELECT MEGA.F_PROXDIAUTIL(NVL(MOV_DT_PRORROGADO, MOV_DT_VENCTO), 1, P_AGENTE_FERIADO) AS DT_DIA,
                     FIL_IN_CODIGO,
                     CASE WHEN TPD_ST_CODIGO = 'PREVPDC' THEN 'CP_PREVISTO'
                          ELSE 'CP_REALIZADO' END AS CATEGORIA,
                     NVL(MOV_RE_VALOR, 0)    AS VL_TITULO,
                     NVL(SALDO_EM_ABERTO, 0) AS VL_ABERTO
                FROM MEGA.FIN_VW_CONTASPAGAR CP
               WHERE NVL(MOV_DT_PRORROGADO, MOV_DT_VENCTO) BETWEEN P_DATA_INI - V_FOLGA AND P_DATA_FIM
                 AND NVL(MOV_CH_SITUACAO,'A') <> 'C'
                 AND (V_INCLUIR_PREV = 'S' OR TPD_ST_CODIGO <> 'PREVPDC')
                 AND (V_FIL_TODAS = 'S'
                      OR INSTR(',' || P_FILIAIS || ',', ',' || TO_CHAR(FIL_IN_CODIGO) || ',') > 0)
                 -- [21/09/2026 - Alexandre Carvalho] V3 (D): EMPRESAS DO GRUPO TAMBEM SAEM DO CP
                 AND (V_GRUPO = 'S'
                      OR (NOT EXISTS (SELECT 1 FROM MEGA.GLO_AGENTES_ID GI
                                       WHERE GI.AGN_IN_CODIGO = CP.AGN_IN_CODIGO AND GI.AGN_TAU_ST_CODIGO = 'G')
                          AND NOT EXISTS (SELECT 1 FROM MEGA.CCS_TB_GFIN_LIB_GRUPO_AGN GX
                                           WHERE GX.AGN_IN_CODIGO = CP.AGN_IN_CODIGO))))
       WHERE DT_DIA BETWEEN P_DATA_INI AND P_DATA_FIM
         AND (DT_DIA < V_HOJE OR VL_ABERTO > 0)
       GROUP BY DT_DIA, FIL_IN_CODIGO, CATEGORIA
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
    -- [21/09/2026 - Alexandre Carvalho] V2: SO A JANELA PELO DIA ROLADO (B); VALORES INALTERADOS.
    FOR R IN (
      SELECT DT_DIA, FIL_IN_CODIGO,
             SUM(VL_CRE) AS VL_CRE, SUM(VL_DEB) AS VL_DEB, COUNT(*) AS QT
        FROM (SELECT MEGA.F_PROXDIAUTIL(MOV_DT_VENCTO, 1, P_AGENTE_FERIADO) AS DT_DIA,
                     FIL_IN_CODIGO,
                     NVL(MOV_RE_VALORCRE, 0) AS VL_CRE,
                     NVL(MOV_RE_VALORDEB, 0) AS VL_DEB
                FROM MEGA.FIN_VW_ADIANTAMENTO
               WHERE MOV_DT_VENCTO BETWEEN P_DATA_INI - V_FOLGA AND P_DATA_FIM
                 AND NVL(MOV_CH_SITUACAO,'A') <> 'C'
                 AND (V_FIL_TODAS = 'S'
                      OR INSTR(',' || P_FILIAIS || ',', ',' || TO_CHAR(FIL_IN_CODIGO) || ',') > 0))
       WHERE DT_DIA BETWEEN P_DATA_INI AND P_DATA_FIM
       GROUP BY DT_DIA, FIL_IN_CODIGO
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
      -- [21/09/2026 - Alexandre Carvalho] V2: SO A JANELA PELO DIA ROLADO (B).
      FOR R IN (
        SELECT DT_DIA, FIL_IN_CODIGO, SIM_CH_TIPO, SUM(SIM_RE_VALOR) AS VL, COUNT(*) AS QT
          FROM (SELECT MEGA.F_PROXDIAUTIL(SIM_DT_DATA, 1, P_AGENTE_FERIADO) AS DT_DIA,
                       FIL_IN_CODIGO, SIM_CH_TIPO, SIM_RE_VALOR
                  FROM MEGA.CCS_TB_GFIN_FLX_SIM
                 WHERE SIM_DT_DATA BETWEEN P_DATA_INI - V_FOLGA AND P_DATA_FIM
                   AND (V_FIL_TODAS = 'S'
                        OR INSTR(',' || P_FILIAIS || ',', ',' || TO_CHAR(FIL_IN_CODIGO) || ',') > 0))
         WHERE DT_DIA BETWEEN P_DATA_INI AND P_DATA_FIM
         GROUP BY DT_DIA, FIL_IN_CODIGO, SIM_CH_TIPO
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
