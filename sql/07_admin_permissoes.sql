-- ============================================================================
-- [14/05/2026 - CRIADO POR ALEXANDRE CARVALHO] Administracao de usuarios do
-- Gestor Financeiro CCS - permissao por modulo.
--
-- GRU_CH_GFIN_CCS (MEGA.GLO_GRUPO_USUARIOCMPESP) continua como porta de acesso:
--   'A'      = admin   -> loga, ve todos os modulos + tela de Administracao
--   'U'      = usuario -> loga, mas so ve os modulos liberados em
--              CCS_TB_GFIN_PERM_USU (menu vem vazio ate o admin liberar)
--   'N'/null = sem acesso -> nao loga
--
-- CCS_TB_GFIN_MODULO    - catalogo dos modulos do portal
-- CCS_TB_GFIN_PERM_USU  - quais modulos cada usuario enxerga (linha = liberado)
--
-- Nomes do catalogo em ASCII puro de proposito: o INSERT trafega no envelope
-- SOAP (UTF-8) e acento pode corromper no deploy. A UI exibe o rotulo bonito.
-- ============================================================================

-- Catalogo de modulos do portal -------------------------------------------------
CREATE TABLE MEGA.CCS_TB_GFIN_MODULO (
  MOD_ST_CODIGO  VARCHAR2(20)  NOT NULL,
  MOD_ST_NOME    VARCHAR2(60)  NOT NULL,
  MOD_IN_ORDEM   NUMBER(3)     DEFAULT 0   NOT NULL,
  MOD_CH_ATIVO   CHAR(1)       DEFAULT 'S' NOT NULL,
  CONSTRAINT PK_CCS_TB_GFIN_MODULO       PRIMARY KEY (MOD_ST_CODIGO),
  CONSTRAINT CK_CCS_TB_GFIN_MODULO_ATIVO CHECK (MOD_CH_ATIVO IN ('S','N'))
)
/

-- Permissao por usuario x modulo (linha presente = usuario enxerga o modulo) ----
CREATE TABLE MEGA.CCS_TB_GFIN_PERM_USU (
  GRU_IN_CODIGO    NUMBER        NOT NULL,
  MOD_ST_CODIGO    VARCHAR2(20)  NOT NULL,
  PERM_DT_INC      DATE          DEFAULT SYSDATE NOT NULL,
  PERM_IN_USU_INC  NUMBER,
  CONSTRAINT PK_CCS_TB_GFIN_PERM_USU PRIMARY KEY (GRU_IN_CODIGO, MOD_ST_CODIGO),
  CONSTRAINT FK_CCS_TB_GFIN_PERM_MOD FOREIGN KEY (MOD_ST_CODIGO)
    REFERENCES MEGA.CCS_TB_GFIN_MODULO (MOD_ST_CODIGO)
)
/

-- Seed dos modulos atuais do portal (idempotente, atomico) ----------------------
BEGIN
  MERGE INTO MEGA.CCS_TB_GFIN_MODULO D
  USING (
    SELECT 'SALDOS'      AS COD, 'Saldos Bancarios'           AS NOME, 1 AS ORD FROM DUAL UNION ALL
    SELECT 'CONCILIACAO' AS COD, 'Conciliacao Bancaria'       AS NOME, 2 AS ORD FROM DUAL UNION ALL
    SELECT 'FLUXO'       AS COD, 'Fluxo de Caixa Previsional' AS NOME, 3 AS ORD FROM DUAL
  ) S
  ON (D.MOD_ST_CODIGO = S.COD)
  WHEN MATCHED THEN UPDATE SET D.MOD_ST_NOME = S.NOME, D.MOD_IN_ORDEM = S.ORD
  WHEN NOT MATCHED THEN INSERT (MOD_ST_CODIGO, MOD_ST_NOME, MOD_IN_ORDEM, MOD_CH_ATIVO)
                        VALUES (S.COD, S.NOME, S.ORD, 'S');
  COMMIT;
END;
/
