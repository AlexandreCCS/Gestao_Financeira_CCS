/* =====================================================================================================================
   [27/11/2026 - Alexandre Carvalho] GESTOR FINANCEIRO - CONCILIACAO DE CARTAO: IGNORAR deposito ou parcela da Rede (com motivo).
   Decisoes do Alexandre (27/11): ignorar exige motivo; parcela desmarcada (sem ignorar) continua pendente. O ignorado sai dos pendentes e
   aparece em "Ignorados", de onde pode voltar. SO ASCII. Blocos separados por "/".
   ===================================================================================================================== */
CREATE TABLE MEGA.CCS_TB_GFIN_CBC_IGNORA (
    IGN_IN_CODIGO     NUMBER         NOT NULL,
    FIL_IN_CODIGO     NUMBER         NOT NULL,
    IGN_CH_TIPO       CHAR(1)        NOT NULL,   -- D deposito | P parcela
    IGN_ST_CHAVE      VARCHAR2(80)   NOT NULL,   -- chave do deposito (data|bandeira|modalidade)
    IGN_ST_NSU        VARCHAR2(30),              -- parcela (tipo P)
    IGN_DT_DATA       DATE,                      -- data do deposito
    IGN_RE_VALOR      NUMBER,
    IGN_ST_MOTIVO     VARCHAR2(300)  NOT NULL,
    USU_IN_CODIGO     NUMBER,
    USU_ST_LOGIN      VARCHAR2(60),
    IGN_DT_INCLUSAO   DATE           DEFAULT SYSDATE NOT NULL,
    IGN_CH_ATIVO      CHAR(1)        DEFAULT 'S' NOT NULL,
    IGN_DT_VOLTA      DATE,
    IGN_ST_USU_VOLTA  VARCHAR2(60),
    CONSTRAINT CCS_PK_GFIN_CBC_IGNORA PRIMARY KEY (IGN_IN_CODIGO),
    CONSTRAINT CCS_CK_GFIN_CBC_IGN_TIPO CHECK (IGN_CH_TIPO IN ('D','P'))
)
/
CREATE INDEX MEGA.CCS_IX_GFIN_CBC_IGN_FIL ON MEGA.CCS_TB_GFIN_CBC_IGNORA (FIL_IN_CODIGO, IGN_CH_ATIVO)
/
CREATE SEQUENCE MEGA.CCS_SEQ_GFIN_CBC_IGNORA START WITH 1 INCREMENT BY 1 NOCACHE
/
