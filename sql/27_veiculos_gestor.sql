-- [25/10/2026 - CRIADO POR ALEXANDRE CARVALHO] Frete > Veiculos: informacoes da frota que o Mega NAO tem e passam a ser do Gestor.
-- Decisao do Alexandre (25/10): "combustivel e posto proprio ficara entao do gestor". O cadastro do Mega (VEN_VEICULO/CMPESP) nao e
-- alterado; o Gestor guarda, por veiculo, se a empresa controla o combustivel, se abastece em posto proprio e, quando o Mega nao
-- informa, se o veiculo e proprio ou de terceiro. Log de quem mudou o que.
-- Deploy pelo gateway SOAP: blocos separados por linha "/", DDL sem ";" final.

CREATE TABLE MEGA.CCS_TB_GFIN_VEICULO (
  VCL_IN_SEQUENCIA     NUMBER        NOT NULL,
  VEI_CH_PROPRIEDADE   CHAR(1),
  VEI_CH_COMBUSTIVEL   CHAR(1),
  VEI_CH_POSTO_PROPRIO CHAR(1),
  VEI_ST_OBS           VARCHAR2(200),
  VEI_DT_ALTERACAO     DATE          DEFAULT SYSDATE,
  VEI_IN_USU           NUMBER,
  VEI_ST_USU           VARCHAR2(60),
  CONSTRAINT PK_CCS_TB_GFIN_VEICULO      PRIMARY KEY (VCL_IN_SEQUENCIA),
  CONSTRAINT CK_CCS_GFIN_VEICULO_PROP    CHECK (VEI_CH_PROPRIEDADE IN ('P','T')),
  CONSTRAINT CK_CCS_GFIN_VEICULO_COMB    CHECK (VEI_CH_COMBUSTIVEL IN ('S','N')),
  CONSTRAINT CK_CCS_GFIN_VEICULO_POSTO   CHECK (VEI_CH_POSTO_PROPRIO IN ('S','N'))
)
/
CREATE TABLE MEGA.CCS_TB_GFIN_VEICULO_LOG (
  LOG_IN_CODIGO     NUMBER        NOT NULL,
  VCL_IN_SEQUENCIA  NUMBER        NOT NULL,
  LOG_ST_CAMPO      VARCHAR2(20)  NOT NULL,
  LOG_ST_DE         VARCHAR2(60),
  LOG_ST_PARA       VARCHAR2(60),
  LOG_ST_MOTIVO     VARCHAR2(200),
  LOG_IN_USU        NUMBER,
  LOG_ST_USU        VARCHAR2(60),
  LOG_DT_DATA       DATE          DEFAULT SYSDATE NOT NULL,
  CONSTRAINT PK_CCS_TB_GFIN_VEICULO_LOG PRIMARY KEY (LOG_IN_CODIGO)
)
/
CREATE SEQUENCE MEGA.CCS_SEQ_GFIN_VEICULO_LOG START WITH 1
/
CREATE INDEX MEGA.CCS_IX_GFIN_VEILOG_VCL ON MEGA.CCS_TB_GFIN_VEICULO_LOG (VCL_IN_SEQUENCIA, LOG_DT_DATA)
/
