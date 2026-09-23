-- ============================================================================
-- [21/09/2026 - Alexandre Carvalho] Fluxo de Caixa - PRAZO DE CREDITO POR FORMA DE RECEBIMENTO ("D+1")
-- Pedido da Renata (Quality), doc "BI Financeiro - Melhorias" de 15/09/2026, bloco Fluxo de Caixa >
-- Recebimentos: "Considerar D+1 (data que de fato teremos o credito em conta)".
-- Resposta dela em 21/09: boleto D+1 | cartao de DEBITO D+1 | cartao de CREDITO 30+1.
--
-- A CHAVE E A DESCRICAO DA FORMA (UPPER/TRIM de FIN_VW_CONTASRECEBER.HCOB_ST_DESCRICAO), NAO o
-- HCOB_IN_SEQUENCIA: a mesma forma tem varios codigos (DEPOSITO BANCARIO = 8 sequencias).
-- Titulo sem forma usa a linha '(SEM FORMA)'.
--
-- DATA DO CREDITO = dia util do pagamento (vencimento prorrogado rolado)
--                   + PRZ_IN_DIAS_CORRIDOS (rola de novo para dia util)
--                   + PRZ_IN_DIAS_UTEIS dias uteis.
--   boleto          0 corridos + 1 util   -> vence sexta, credita segunda; vence sabado, paga segunda, credita terca
--   cartao credito 30 corridos + 1 util
-- ============================================================================

CREATE TABLE MEGA.CCS_TB_GFIN_FLX_PRAZO (
  FORMA_ST_DESCRICAO    VARCHAR2(60)  NOT NULL,
  PRZ_IN_DIAS_CORRIDOS  NUMBER(3)     DEFAULT 0 NOT NULL,
  PRZ_IN_DIAS_UTEIS     NUMBER(2)     DEFAULT 0 NOT NULL,
  PRZ_DT_ALTERACAO      DATE          DEFAULT SYSDATE NOT NULL,
  PRZ_IN_USU            NUMBER,
  PRZ_ST_USU            VARCHAR2(60),
  CONSTRAINT PK_CCS_TB_GFIN_FLX_PRAZO PRIMARY KEY (FORMA_ST_DESCRICAO),
  CONSTRAINT CK_CCS_GFIN_FLX_PRAZO_COR CHECK (PRZ_IN_DIAS_CORRIDOS BETWEEN 0 AND 120),
  CONSTRAINT CK_CCS_GFIN_FLX_PRAZO_UTE CHECK (PRZ_IN_DIAS_UTEIS BETWEEN 0 AND 10)
)
/

-- CARGA INICIAL: TODAS AS FORMAS QUE EXISTEM NOS TITULOS DOS ULTIMOS 2 ANOS. SEM LITERAL ACENTUADO
-- (O DEPLOY POR SOAP CORROMPE ACENTO): O "_" DO LIKE CASA COM A LETRA ACENTUADA OU NAO.
--   COB%                 = cobranca eletronica / boleto (COBELET*, COBITA*, COBITAI*, COB. ELET.*) -> 0 + 1
--   CART_O DE D_BITO     -> 0 + 1
--   CART_O DE CR_DITO    -> 30 + 1
--   demais (deposito, PIX, dinheiro, cheque, promissoria) e (SEM FORMA) -> 0 + 0 (credito no dia)
INSERT INTO MEGA.CCS_TB_GFIN_FLX_PRAZO (FORMA_ST_DESCRICAO, PRZ_IN_DIAS_CORRIDOS, PRZ_IN_DIAS_UTEIS, PRZ_ST_USU)
SELECT F,
       CASE WHEN F LIKE 'CART_O DE CR_DITO%' THEN 30 ELSE 0 END,
       CASE WHEN F LIKE 'COB%' OR F LIKE 'CART_O DE D_BITO%' OR F LIKE 'CART_O DE CR_DITO%' THEN 1 ELSE 0 END,
       'CARGA INICIAL 21/09/2026'
  FROM (SELECT DISTINCT UPPER(TRIM(HCOB_ST_DESCRICAO)) F
          FROM MEGA.FIN_VW_CONTASRECEBER
         WHERE HCOB_ST_DESCRICAO IS NOT NULL
           AND MOV_DT_VENCTO >= TRUNC(SYSDATE) - 730
        UNION
        SELECT '(SEM FORMA)' FROM DUAL)
/

CREATE OR REPLACE FUNCTION MEGA.CCS_F_GFIN_FLX_DT_CREDITO(
    P_DT        IN DATE,
    P_CORRIDOS  IN NUMBER,
    P_UTEIS     IN NUMBER,
    P_AGN_FER   IN NUMBER DEFAULT 200
  ) RETURN DATE IS
    -- [21/09/2026 - Alexandre Carvalho] DATA EM QUE O DINHEIRO ENTRA NA CONTA (VER CABECALHO DO ARQUIVO).
    -- F_PROXDIAUTIL(D, 1, AGN) DEVOLVE O PROPRIO D SE FOR DIA UTIL, SENAO O PROXIMO.
    V DATE;
  BEGIN
    IF P_DT IS NULL THEN RETURN NULL; END IF;
    V := MEGA.F_PROXDIAUTIL(TRUNC(P_DT), 1, P_AGN_FER);
    IF NVL(P_CORRIDOS, 0) > 0 THEN
      V := MEGA.F_PROXDIAUTIL(V + P_CORRIDOS, 1, P_AGN_FER);
    END IF;
    FOR I IN 1 .. LEAST(NVL(P_UTEIS, 0), 10) LOOP
      V := MEGA.F_PROXDIAUTIL(V + 1, 1, P_AGN_FER);
    END LOOP;
    RETURN V;
  END;
/
