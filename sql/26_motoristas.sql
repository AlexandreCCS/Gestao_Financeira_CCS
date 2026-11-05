-- [25/10/2026 - CRIADO POR ALEXANDRE CARVALHO] Modulo "Frete" do Gestor Financeiro - tela MOTORISTAS (Quality, OCPDB493).
-- Reuniao de frete/numerario (Quality): "quando o transportador tem o MEI, ha um limite mensal de faturamento (20.966,00);
-- o transportador tem que ter campos para informar". Primeira entrega: cadastro dos motoristas do Mega (VEN_CONDUTOR +
-- campos especificos VEN_CONDUTORCMPESP) com a marcacao MEI sim/nao por motorista e o parametro do limite.
-- NADA DO MEGA E ALTERADO: a flag fica em tabela propria (CCS_TB_GFIN_MOTORISTA), com log de quem mudou.
-- Deploy pelo gateway SOAP: blocos separados por linha "/", DDL sem ";" final (EXECUTE IMMEDIATE), comentarios "--" sao
-- removidos pelo script (ORA-01735 com comentario inline dentro do EXECUTE IMMEDIATE).

-- 1. Flag por motorista (1 linha por CDT_IN_SEQUENCIA; motorista sem linha = nao MEI) -----------------------------------
CREATE TABLE MEGA.CCS_TB_GFIN_MOTORISTA (
  CDT_IN_SEQUENCIA  NUMBER        NOT NULL,
  MOT_CH_MEI        CHAR(1)       DEFAULT 'N' NOT NULL,
  MOT_DT_ALTERACAO  DATE          DEFAULT SYSDATE,
  MOT_IN_USU        NUMBER,
  MOT_ST_USU        VARCHAR2(60),
  CONSTRAINT PK_CCS_TB_GFIN_MOTORISTA  PRIMARY KEY (CDT_IN_SEQUENCIA),
  CONSTRAINT CK_CCS_GFIN_MOTORISTA_MEI CHECK (MOT_CH_MEI IN ('S','N'))
)
/

-- 2. Log de alteracoes (de/para, quem, quando) ----------------------------------------------------------------------------
CREATE TABLE MEGA.CCS_TB_GFIN_MOTORISTA_LOG (
  LOG_IN_CODIGO     NUMBER        NOT NULL,
  CDT_IN_SEQUENCIA  NUMBER        NOT NULL,
  LOG_ST_CAMPO      VARCHAR2(20)  NOT NULL,
  LOG_ST_DE         VARCHAR2(60),
  LOG_ST_PARA       VARCHAR2(60),
  LOG_ST_MOTIVO     VARCHAR2(200),
  LOG_IN_USU        NUMBER,
  LOG_ST_USU        VARCHAR2(60),
  LOG_DT_DATA       DATE          DEFAULT SYSDATE NOT NULL,
  CONSTRAINT PK_CCS_TB_GFIN_MOTORISTA_LOG PRIMARY KEY (LOG_IN_CODIGO)
)
/
CREATE SEQUENCE MEGA.CCS_SEQ_GFIN_MOTORISTA_LOG START WITH 1
/
CREATE INDEX MEGA.CCS_IX_GFIN_MOTLOG_CDT ON MEGA.CCS_TB_GFIN_MOTORISTA_LOG (CDT_IN_SEQUENCIA, LOG_DT_DATA)
/

-- 3. Parametro: limite mensal de faturamento do motorista MEI (historico pela trigger CCS_T_GFIN_PARAM_HIST, sql/13) ---
BEGIN
  MERGE INTO MEGA.CCS_TB_GFIN_PARAM D
  USING (SELECT 'MOTORISTA_MEI_LIMITE_MES' CH,
                20966 VL,
                'LIMITE MENSAL DE FATURAMENTO DO MOTORISTA MEI (R$)' DS
           FROM DUAL) S
  ON (D.PARAM_ST_CHAVE = S.CH)
  WHEN MATCHED THEN UPDATE SET D.PARAM_ST_DESCRICAO = S.DS
  WHEN NOT MATCHED THEN INSERT (PARAM_ST_CHAVE, PARAM_RE_VALOR, PARAM_ST_DESCRICAO)
       VALUES (S.CH, S.VL, S.DS);
  COMMIT;
END;
/

-- 4. Modulo "Frete" no catalogo (ASCII puro; menu dropdown no front, 1a tela = Motoristas) ---------------------------------
BEGIN
  MERGE INTO MEGA.CCS_TB_GFIN_MODULO D
  USING (SELECT 'FRETE' AS COD, 'Frete' AS NOME, 10 AS ORD FROM DUAL) S
  ON (D.MOD_ST_CODIGO = S.COD)
  WHEN MATCHED THEN UPDATE SET D.MOD_ST_NOME = S.NOME, D.MOD_IN_ORDEM = S.ORD
  WHEN NOT MATCHED THEN INSERT (MOD_ST_CODIGO, MOD_ST_NOME, MOD_IN_ORDEM, MOD_CH_ATIVO)
                        VALUES (S.COD, S.NOME, S.ORD, 'S');
  COMMIT;
END;
/
