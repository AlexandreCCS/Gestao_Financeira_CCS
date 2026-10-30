-- ============================================================================
-- [14/05/2026 - CRIADO POR ALEXANDRE CARVALHO] Inteligencia de Credito - Fase 1.1
-- Modelo de dados + snapshot diario da carteira do Gestor Financeiro CCS.
--
-- O Mega e o system of record (contas a receber). Este modulo e a camada de
-- inteligencia ACIMA do ERP: guarda uma serie temporal diaria da carteira por
-- cliente (sem historico nao ha tendencia, score nem roll rate).
--
--   1. CCS_TB_GFIN_CARTEIRA_SNAP  - snapshot diario por cliente (a fundacao)
--   2. CCS_TB_GFIN_PAGAMENTO_HIST - historico de liquidacoes (populado na Fase 1.2)
--   3. CCS_TB_GFIN_SCORE          - score de risco atual (calculado na Fase 1.2)
--   4. CCS_TB_GFIN_SCORE_PARAM    - pesos/faixas configuraveis do score
--   5. CCS_P_GFIN_SNAPSHOT_CARTEIRA - procedure que grava o snapshot do dia
--   6. CCS_JOB_GFIN_SNAPSHOT      - job diario 03:30 (apos o reset de bloqueio 03:00)
--
-- Criterio de atraso identico a regra de bloqueio: exclui previstos (TPD='PDV'),
-- considera SALDO_EM_ABERTO > 0. Clientes internos (whitelist do bloqueio) e de
-- grupo de credito isento (GCR_ST_NAOBLOQUEIA='S') sao gravados, mas marcados.
-- ============================================================================

-- 1. Snapshot diario da carteira por cliente -----------------------------------
CREATE TABLE MEGA.CCS_TB_GFIN_CARTEIRA_SNAP (
  SNAP_DT            DATE          NOT NULL,
  AGN_IN_CODIGO      NUMBER        NOT NULL,
  SALDO_TOTAL        NUMBER(16,2)  DEFAULT 0 NOT NULL,   -- total em aberto (vencido + a vencer)
  SALDO_VENCIDO      NUMBER(16,2)  DEFAULT 0 NOT NULL,   -- prorrogado < SNAP_DT
  SALDO_AVENCER      NUMBER(16,2)  DEFAULT 0 NOT NULL,
  QT_TIT_TOTAL       NUMBER(7)     DEFAULT 0 NOT NULL,
  QT_TIT_VENCIDOS    NUMBER(7)     DEFAULT 0 NOT NULL,
  MAIOR_ATRASO_DIAS  NUMBER(6)     DEFAULT 0 NOT NULL,
  VL_D1_30           NUMBER(16,2)  DEFAULT 0 NOT NULL,   -- aging do saldo VENCIDO
  VL_D31_60          NUMBER(16,2)  DEFAULT 0 NOT NULL,
  VL_D61_90          NUMBER(16,2)  DEFAULT 0 NOT NULL,
  VL_D90P            NUMBER(16,2)  DEFAULT 0 NOT NULL,
  VL_AVENCER_30      NUMBER(16,2)  DEFAULT 0 NOT NULL,   -- a vencer nos proximos 30 dias
  CH_GRUPO_ISENTO    CHAR(1)       DEFAULT 'N' NOT NULL, -- grupo de credito GCR_ST_NAOBLOQUEIA='S'
  CH_INTERNO         CHAR(1)       DEFAULT 'N' NOT NULL, -- codigo na whitelist interna do bloqueio
  SCORE              NUMBER(4),                          -- preenchido na Fase 1.2
  CLASSE             VARCHAR2(1),                        -- A/B/C/D/E - Fase 1.2
  CONSTRAINT PK_CCS_TB_GFIN_CARTEIRA_SNAP PRIMARY KEY (SNAP_DT, AGN_IN_CODIGO)
)
/

CREATE INDEX MEGA.IX_CCS_GFIN_CARTSNAP_AGN
  ON MEGA.CCS_TB_GFIN_CARTEIRA_SNAP (AGN_IN_CODIGO, SNAP_DT)
/

-- 2. Historico de liquidacoes (comportamento de pagamento) - populado na Fase 1.2
CREATE TABLE MEGA.CCS_TB_GFIN_PAGAMENTO_HIST (
  PAG_IN_CODIGO        NUMBER        NOT NULL,
  AGN_IN_CODIGO        NUMBER        NOT NULL,
  FIL_IN_CODIGO        NUMBER,
  MOV_ST_DOCUMENTO     VARCHAR2(20),
  DT_VENCTO            DATE,
  DT_PRORROGADO        DATE,
  DT_BAIXA             DATE,
  VL_TITULO            NUMBER(16,2),
  DIAS_ATRASO_EFETIVO  NUMBER(6),                        -- DT_BAIXA - DT_PRORROGADO
  PAG_DT_CARGA         DATE          DEFAULT SYSDATE NOT NULL,
  CONSTRAINT PK_CCS_TB_GFIN_PAGAMENTO_HIST PRIMARY KEY (PAG_IN_CODIGO)
)
/

CREATE INDEX MEGA.IX_CCS_GFIN_PAGHIST_AGN
  ON MEGA.CCS_TB_GFIN_PAGAMENTO_HIST (AGN_IN_CODIGO)
/

CREATE SEQUENCE MEGA.CCS_SEQ_GFIN_PAGAMENTO_HIST
  START WITH 1 INCREMENT BY 1 CACHE 50 NOCYCLE
/

-- 3. Score de risco atual por cliente - calculado na Fase 1.2 -------------------
CREATE TABLE MEGA.CCS_TB_GFIN_SCORE (
  AGN_IN_CODIGO     NUMBER        NOT NULL,
  SCORE             NUMBER(4),                           -- 0..1000
  CLASSE            VARCHAR2(1),                          -- A/B/C/D/E
  C_COMPORTAMENTO   NUMBER(6,4),                          -- componentes normalizados 0..1
  C_INADIMPLENCIA   NUMBER(6,4),
  C_TENDENCIA       NUMBER(6,4),
  C_EXPOSICAO       NUMBER(6,4),
  C_EXTERNO         NUMBER(6,4),
  LIMITE_SUGERIDO   NUMBER(16,2),
  DT_CALCULO        DATE,
  CONSTRAINT PK_CCS_TB_GFIN_SCORE PRIMARY KEY (AGN_IN_CODIGO)
)
/

-- 4. Parametros configuraveis do score (pesos e faixas) ------------------------
CREATE TABLE MEGA.CCS_TB_GFIN_SCORE_PARAM (
  PARAM_ST_CHAVE      VARCHAR2(40)  NOT NULL,
  PARAM_RE_VALOR      NUMBER        NOT NULL,
  PARAM_ST_DESCRICAO  VARCHAR2(200),
  CONSTRAINT PK_CCS_TB_GFIN_SCORE_PARAM PRIMARY KEY (PARAM_ST_CHAVE)
)
/

-- Seed dos pesos e faixas padrao (idempotente) ---------------------------------
BEGIN
  MERGE INTO MEGA.CCS_TB_GFIN_SCORE_PARAM D
  USING (
    SELECT 'PESO_COMPORTAMENTO' AS CH, 0.35 AS VL, 'Peso: comportamento de pagamento (% em dia, atraso medio)' AS DS FROM DUAL UNION ALL
    SELECT 'PESO_INADIMPLENCIA',       0.30, 'Peso: inadimplencia atual (saldo vencido / total, maior atraso)' FROM DUAL UNION ALL
    SELECT 'PESO_TENDENCIA',           0.15, 'Peso: tendencia (variacao do score, roll rate)' FROM DUAL UNION ALL
    SELECT 'PESO_EXPOSICAO',           0.10, 'Peso: exposicao (saldo devedor / limite de credito)' FROM DUAL UNION ALL
    SELECT 'PESO_EXTERNO',             0.10, 'Peso: sinais negativos de credito (cartorio, cheques devolvidos, bloqueios financeiros) - SUFRAMA nao entra' FROM DUAL UNION ALL
    SELECT 'FAIXA_A',                  800,  'Score minimo para classe A' FROM DUAL UNION ALL
    SELECT 'FAIXA_B',                  600,  'Score minimo para classe B' FROM DUAL UNION ALL
    SELECT 'FAIXA_C',                  400,  'Score minimo para classe C' FROM DUAL UNION ALL
    SELECT 'FAIXA_D',                  200,  'Score minimo para classe D (abaixo disso, classe E)' FROM DUAL
  ) S
  ON (D.PARAM_ST_CHAVE = S.CH)
  WHEN MATCHED THEN UPDATE SET D.PARAM_ST_DESCRICAO = S.DS
  WHEN NOT MATCHED THEN INSERT (PARAM_ST_CHAVE, PARAM_RE_VALOR, PARAM_ST_DESCRICAO)
                        VALUES (S.CH, S.VL, S.DS);
  COMMIT;
END;
/

-- 5. Procedure de snapshot diario da carteira ----------------------------------
-- Idempotente: regrava o snapshot da data (DELETE + INSERT da data).
-- pDATA default = hoje. Aceita data passada para recarga pontual.
CREATE OR REPLACE PROCEDURE MEGA.CCS_P_GFIN_SNAPSHOT_CARTEIRA(pDATA IN DATE DEFAULT NULL) IS
  vDT DATE := TRUNC(NVL(pDATA, SYSDATE));
BEGIN
  DELETE FROM MEGA.CCS_TB_GFIN_CARTEIRA_SNAP WHERE SNAP_DT = vDT;

  INSERT INTO MEGA.CCS_TB_GFIN_CARTEIRA_SNAP
    (SNAP_DT, AGN_IN_CODIGO, SALDO_TOTAL, SALDO_VENCIDO, SALDO_AVENCER,
     QT_TIT_TOTAL, QT_TIT_VENCIDOS, MAIOR_ATRASO_DIAS,
     VL_D1_30, VL_D31_60, VL_D61_90, VL_D90P, VL_AVENCER_30,
     CH_GRUPO_ISENTO, CH_INTERNO)
  SELECT vDT,
         C.AGN_IN_CODIGO,
         SUM(C.SALDO_EM_ABERTO),
         SUM(CASE WHEN C.MOV_DT_PRORROGADO <  vDT THEN C.SALDO_EM_ABERTO ELSE 0 END),
         SUM(CASE WHEN C.MOV_DT_PRORROGADO >= vDT THEN C.SALDO_EM_ABERTO ELSE 0 END),
         COUNT(*),
         SUM(CASE WHEN C.MOV_DT_PRORROGADO <  vDT THEN 1 ELSE 0 END),
         MAX(CASE WHEN C.MOV_DT_PRORROGADO <  vDT
                  THEN vDT - TRUNC(C.MOV_DT_PRORROGADO) ELSE 0 END),
         SUM(CASE WHEN C.MOV_DT_PRORROGADO < vDT
                   AND vDT - TRUNC(C.MOV_DT_PRORROGADO) <= 30
                  THEN C.SALDO_EM_ABERTO ELSE 0 END),
         SUM(CASE WHEN vDT - TRUNC(C.MOV_DT_PRORROGADO) BETWEEN 31 AND 60
                  THEN C.SALDO_EM_ABERTO ELSE 0 END),
         SUM(CASE WHEN vDT - TRUNC(C.MOV_DT_PRORROGADO) BETWEEN 61 AND 90
                  THEN C.SALDO_EM_ABERTO ELSE 0 END),
         SUM(CASE WHEN vDT - TRUNC(C.MOV_DT_PRORROGADO) > 90
                  THEN C.SALDO_EM_ABERTO ELSE 0 END),
         SUM(CASE WHEN C.MOV_DT_PRORROGADO >= vDT
                   AND C.MOV_DT_PRORROGADO <  vDT + 30
                  THEN C.SALDO_EM_ABERTO ELSE 0 END),
         -- grupo de credito isento (mesma regra do vDESCONSIDERA das procs de bloqueio)
         CASE WHEN EXISTS (
                SELECT 1
                  FROM MEGA.VEN_AGENTESGRUPO        AGR,
                       MEGA.VEN_GRUPOCREDITOCMPESP  GCR
                 WHERE AGR.GCR_TAB_IN_CODIGO = GCR.GCR_TAB_IN_CODIGO
                   AND AGR.GCR_PAD_IN_CODIGO = GCR.GCR_PAD_IN_CODIGO
                   AND AGR.GCR_ST_CODIGO     = GCR.GCR_ST_CODIGO
                   AND NVL(GCR.GCR_ST_NAOBLOQUEIA,'N') = 'S'
                   AND AGR.AGN_IN_CODIGO     = C.AGN_IN_CODIGO)
              THEN 'S' ELSE 'N' END,
         -- whitelist interna hardcoded (mesma lista da CCS_P_BLOQUEIA_CLIENTE_RESERVA)
         CASE WHEN C.AGN_IN_CODIGO IN
                (0,1,9,10,20,30,40,90,100,200,300,400,401,402,403,404,450,460,
                 500,501,502,503,504,550,560,570,600,700,710,800,900,950,960,970,
                 999,21574,21704,21703)
              THEN 'S' ELSE 'N' END
    FROM MEGA.FIN_VW_CONTASRECEBER C
   WHERE C.SALDO_EM_ABERTO > 0
     AND C.TPD_ST_CODIGO NOT IN ('PDV')
   GROUP BY C.AGN_IN_CODIGO;

  COMMIT;
END CCS_P_GFIN_SNAPSHOT_CARTEIRA;
/

-- 6. Job diario do snapshot - DBMS_SCHEDULER, 03:30 ----------------------------
-- (apos o CCS_JOB_RESET_BLOQ_CLI das 03:00). Drop-if-exists torna idempotente.
BEGIN
  BEGIN
    DBMS_SCHEDULER.DROP_JOB('MEGA.CCS_JOB_GFIN_SNAPSHOT', TRUE);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  DBMS_SCHEDULER.CREATE_JOB(
    JOB_NAME        => 'MEGA.CCS_JOB_GFIN_SNAPSHOT',
    JOB_TYPE        => 'PLSQL_BLOCK',
    JOB_ACTION      => 'BEGIN MEGA.CCS_P_GFIN_SNAPSHOT_CARTEIRA; END;',
    START_DATE      => TRUNC(SYSDATE) + 1 + 3.5/24,
    REPEAT_INTERVAL => 'FREQ=DAILY; BYHOUR=3; BYMINUTE=30; BYSECOND=0',
    ENABLED         => TRUE,
    AUTO_DROP       => FALSE,
    COMMENTS        => 'Gestor Financeiro CCS - snapshot diario da carteira (Inteligencia de Credito)'
  );
END;
/
