-- ============================================================================
-- [14/05/2026 - CRIADO POR ALEXANDRE CARVALHO] Inadimplencia > Bloqueios.
-- Log de eventos de bloqueio de cliente do Gestor Financeiro CCS.
--
-- As procedures CCS_P_BLOQUEIA_CLIENTE (NF) e CCS_P_BLOQUEIA_CLIENTE_RESERVA
-- (romaneio) bloqueiam o cliente com RAISE_APPLICATION_ERROR e o chamador faz
-- ROLLBACK - por isso nenhum registro do bloqueio sobrevivia. Aqui criamos:
--   1. CCS_TB_GFIN_BLOQUEIO_LOG  - tabela de eventos de bloqueio
--   2. CCS_SEQ_GFIN_BLOQUEIO_LOG - sequence da PK
--   3. CCS_P_GFIN_LOG_BLOQUEIO   - logger com PRAGMA AUTONOMOUS_TRANSACTION
--      (commit proprio, sobrevive ao rollback do RAISE) - chamado pelas 2
--      procedures de bloqueio (alteradas em script a parte).
--
-- O "desbloqueio" (aprovacao manual, AGN_BO_BLOQUEIO N->S) ja e auditado
-- nativamente pelo Mega em ADT_OCORRENCIA + A#GLO_AGENTESCMPESP - nao precisa
-- de tabela nova, a API le direto de la.
-- ============================================================================

-- 1. Tabela de eventos de bloqueio ----------------------------------------------
CREATE TABLE MEGA.CCS_TB_GFIN_BLOQUEIO_LOG (
  BLO_IN_CODIGO      NUMBER         NOT NULL,
  BLO_DT_BLOQUEIO    DATE           DEFAULT SYSDATE NOT NULL,
  BLO_ST_ORIGEM      VARCHAR2(10)   NOT NULL,   -- 'NF' | 'RESERVA'
  AGN_IN_CODIGO      NUMBER         NOT NULL,   -- cliente bloqueado
  BLO_ST_CLIENTE     VARCHAR2(200),             -- nome do cliente (snapshot)
  BLO_ST_REFERENCIA  VARCHAR2(100),             -- NF / OE que disparou o bloqueio
  BLO_ST_MOTIVO      VARCHAR2(60)   NOT NULL,   -- 'FINANCEIRO' | 'SUFRAMA'
  BLO_ST_TITULOS     VARCHAR2(4000),            -- titulos em atraso (motivo financeiro)
  CONSTRAINT PK_CCS_TB_GFIN_BLOQUEIO_LOG  PRIMARY KEY (BLO_IN_CODIGO),
  CONSTRAINT CK_CCS_TB_GFIN_BLOQ_ORIGEM   CHECK (BLO_ST_ORIGEM IN ('NF','RESERVA'))
)
/

-- indice pelo dia do bloqueio (consulta da tela e sempre "por dia") -------------
CREATE INDEX MEGA.IX_CCS_TB_GFIN_BLOQ_LOG_DT
  ON MEGA.CCS_TB_GFIN_BLOQUEIO_LOG (BLO_DT_BLOQUEIO)
/

-- 2. Sequence da PK -------------------------------------------------------------
CREATE SEQUENCE MEGA.CCS_SEQ_GFIN_BLOQUEIO_LOG
  START WITH 1 INCREMENT BY 1 NOCYCLE CACHE 20
/

-- 3. Logger - PRAGMA AUTONOMOUS_TRANSACTION -------------------------------------
CREATE OR REPLACE PROCEDURE MEGA.CCS_P_GFIN_LOG_BLOQUEIO(
  pORIGEM      IN VARCHAR2,             -- 'NF' | 'RESERVA'
  pAGN         IN NUMBER,               -- cliente bloqueado
  pCLIENTE     IN VARCHAR2,             -- nome do cliente (pode vir NULL)
  pREFERENCIA  IN VARCHAR2,             -- NF / OE
  pMOTIVO      IN VARCHAR2,             -- 'FINANCEIRO' | 'SUFRAMA'
  pTITULOS     IN VARCHAR2 DEFAULT NULL -- titulos em atraso
) IS
  -- [14/05/2026 - CRIADO POR ALEXANDRE CARVALHO] Logger de evento de bloqueio
  -- para o Gestor Financeiro CCS (Inadimplencia > Bloqueios).
  -- AUTONOMOUS_TRANSACTION: o INSERT precisa de COMMIT proprio porque as
  -- procedures de bloqueio terminam em RAISE_APPLICATION_ERROR e o chamador faz
  -- ROLLBACK - sem isto o log seria desfeito junto. O WHEN OTHERS garante que
  -- uma falha no log NUNCA derruba o fluxo de bloqueio do faturamento/reserva.
  PRAGMA AUTONOMOUS_TRANSACTION;
BEGIN
  INSERT INTO MEGA.CCS_TB_GFIN_BLOQUEIO_LOG
    (BLO_IN_CODIGO, BLO_DT_BLOQUEIO, BLO_ST_ORIGEM, AGN_IN_CODIGO,
     BLO_ST_CLIENTE, BLO_ST_REFERENCIA, BLO_ST_MOTIVO, BLO_ST_TITULOS)
  VALUES
    (MEGA.CCS_SEQ_GFIN_BLOQUEIO_LOG.NEXTVAL, SYSDATE, pORIGEM, pAGN,
     SUBSTR(pCLIENTE,1,200), SUBSTR(pREFERENCIA,1,100), pMOTIVO,
     SUBSTR(pTITULOS,1,4000));
  COMMIT;
EXCEPTION
  WHEN OTHERS THEN
    ROLLBACK;
END;
/
