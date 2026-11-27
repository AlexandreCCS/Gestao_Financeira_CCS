-- ============================================================================
-- [2026-11-27 - RONALDO FAJAN] GESTOR FINANCEIRO: CONCILIACAO PIX I (CAIXA PIX I (JE) JEANS.COM)
-- Pedido do cliente (27/11): "tela de conciliacao de PIX I; os titulos baixados nessa conta aparecem (varias filiais
-- PRO baixando na mesma conta), indicando os dados como na planilha; flag que, marcada, concilia aquele movimento.
-- Separar entradas e saidas; somatorio do dia; adiantamentos, transferencias etc. O lado do banco sao apenas
-- comprovantes." Decisoes de 27/11:
--   * contas do grupo: 24492 (lojas grupo FREEDOM, org 30), 24504 (grupo QUALITY, org 20) e 25515 (ANDRAR, so
--     pagamentos das filiais relacionadas); a 24502 fica fora.
--   * data de corte com saldo inicial: primeiro 27/11/2026 (teste); no mesmo dia, a pedido, 01/11/2026 ("assim ja
--     poderemos ver ate o que ja foi conciliado"). Saldo de abertura por loja = "SALDO DO DIA ANTERIOR" (30/10) da aba
--     03.11.2026 da planilha "11 NOVEMBRO 2026 EXTRATO JEANS.xlsx" (INDUSTRIA 23,40 e PRO-FREE 39,14, que somem da
--     planilha a partir de 04/11, somados em CARUARU). O Extrato do dia da tela soma TUDO o que esta conciliado no Mega
--     nessas contas (por esta tela ou fora dela), pela data da linha do banco.
--   * comprovantes chegam esparsos: o usuario marca 1 ou N lancamentos (a tela soma os marcados), INFORMA A DATA DO
--     BANCO (obrigatoria) e concilia na hora.
-- COMO CONCILIA (o lado do banco nao tem extrato): para CADA lancamento marcado, uma linha de banco digitada em
-- FIN_CONCILIACAO (tipo 'D', status 'S', natureza invertida, data = data do banco informada, TPD AVCRED/002 na entrada
-- e AVDEB/001 na saida - o mesmo que o financeiro digitava nessas contas, ex. CBA 73824) + FIN_CONCILIAMOVIMENTO tipo
-- 'M' (manual, como as 259 conciliacoes da 24504) + lancamento marcado. 1 x 1: desfazer um nao mexe nos outros.
-- Validacoes: conta do grupo, lancamento ativo e nao conciliado, data do Mega e do banco >= corte e <= hoje, filial
-- com loja configurada, usuario com hierarquia no Mov. Financeiro, periodo de conciliacao aberto
-- (FIN_PCK_CONCILIACAOBANC.P_VALIDACONCILIACAO).
-- DESFAZER (triggers nativos FIN_TRB_BANCONCILIADO/FIN_TRB_CONCILIADOREAL): solta o vinculo da linha do banco, desmarca
-- o lancamento, apaga a conciliacao e so entao apaga a linha digitada. Recusa se a conciliacao foi mexida fora da tela
-- ou ja foi conciliada na contabilidade (CON_IN_SEQCONCCONT).
-- SALDO POR LOJA: abertura (CCS_TB_GFIN_PIX_LOJA) + entradas - saidas conciliadas por aqui com data do banco >= corte.
-- A loja vem da filial do lancamento (CCS_TB_GFIN_PIX_FILIAL), gravada no apontamento.
-- ROLLBACK: DROP das procedures CCS_P_GFIN_PIX_*, tabelas CCS_TB_GFIN_PIX_*, sequences CCS_SEQ_GFIN_PIX_* e
--           DELETE FROM MEGA.CCS_TB_GFIN_MODULO WHERE MOD_ST_CODIGO = 'PIX_CONCILIA' (desfazer antes as conciliacoes
--           ativas pela tela, senao as linhas digitadas ficam no Mega como conciliacao manual comum).
-- ============================================================================

CREATE TABLE MEGA.CCS_TB_GFIN_PIX_GRUPO (
    GRP_IN_CODIGO     NUMBER        NOT NULL,
    GRP_ST_NOME       VARCHAR2(80)  NOT NULL,
    GRP_DT_CORTE      DATE          NOT NULL,
    GRP_CH_ATIVO      CHAR(1)       DEFAULT 'S' NOT NULL,
    GRP_DT_ALTERACAO  DATE,
    GRP_IN_USU        NUMBER,
    GRP_ST_USU        VARCHAR2(60),
    CONSTRAINT CCS_PK_GFIN_PIX_GRUPO PRIMARY KEY (GRP_IN_CODIGO)
)
/
CREATE TABLE MEGA.CCS_TB_GFIN_PIX_CONTA (
    GRP_IN_CODIGO     NUMBER        NOT NULL,
    AGN_IN_CODIGO     NUMBER        NOT NULL,
    CTA_ST_EMPRESA    VARCHAR2(30)  NOT NULL,
    CTA_IN_ORDEM      NUMBER        DEFAULT 0 NOT NULL,
    CONSTRAINT CCS_PK_GFIN_PIX_CONTA PRIMARY KEY (GRP_IN_CODIGO, AGN_IN_CODIGO)
)
/
CREATE TABLE MEGA.CCS_TB_GFIN_PIX_LOJA (
    GRP_IN_CODIGO     NUMBER        NOT NULL,
    LOJ_ST_CODIGO     VARCHAR2(20)  NOT NULL,
    LOJ_ST_NOME       VARCHAR2(40)  NOT NULL,
    LOJ_RE_SALDO_INI  NUMBER(15,2)  DEFAULT 0 NOT NULL,
    LOJ_IN_ORDEM      NUMBER        DEFAULT 0 NOT NULL,
    CONSTRAINT CCS_PK_GFIN_PIX_LOJA PRIMARY KEY (GRP_IN_CODIGO, LOJ_ST_CODIGO)
)
/
CREATE TABLE MEGA.CCS_TB_GFIN_PIX_FILIAL (
    GRP_IN_CODIGO     NUMBER        NOT NULL,
    FIL_IN_CODIGO     NUMBER        NOT NULL,
    LOJ_ST_CODIGO     VARCHAR2(20)  NOT NULL,
    CONSTRAINT CCS_PK_GFIN_PIX_FILIAL PRIMARY KEY (GRP_IN_CODIGO, FIL_IN_CODIGO)
)
/
CREATE TABLE MEGA.CCS_TB_GFIN_PIX_LOTE (
    LOT_IN_CODIGO     NUMBER        NOT NULL,
    LOT_ST_TOKEN      VARCHAR2(60)  NOT NULL,
    GRP_IN_CODIGO     NUMBER        NOT NULL,
    LOT_CH_TIPO       CHAR(1)       NOT NULL,          -- C conciliar | D desfazer
    LOT_CH_STATUS     CHAR(1)       NOT NULL,          -- B gravado | S simulado sem erro | X recusado
    LOT_DT_BANCO      DATE,
    LOT_IN_QTD        NUMBER,
    LOT_RE_ENTRADAS   NUMBER(15,2),
    LOT_RE_SAIDAS     NUMBER(15,2),
    LOT_ST_ITENS      VARCHAR2(4000),
    LOT_ST_MENSAGEM   VARCHAR2(1500),
    USU_IN_CODIGO     NUMBER        NOT NULL,
    USU_ST_LOGIN      VARCHAR2(60),
    LOT_DT_INCLUSAO   DATE          DEFAULT SYSDATE NOT NULL,
    CONSTRAINT CCS_PK_GFIN_PIX_LOTE PRIMARY KEY (LOT_IN_CODIGO)
)
/
CREATE INDEX MEGA.CCS_IX_GFIN_PIX_LOTE_TOKEN ON MEGA.CCS_TB_GFIN_PIX_LOTE (LOT_ST_TOKEN)
/
CREATE TABLE MEGA.CCS_TB_GFIN_PIX_APONT (
    APT_IN_CODIGO       NUMBER        NOT NULL,
    LOT_IN_CODIGO       NUMBER        NOT NULL,
    GRP_IN_CODIGO       NUMBER        NOT NULL,
    ORG_IN_CODIGO       NUMBER        NOT NULL,
    MOV_SEQ_IN_CODIGO   NUMBER        NOT NULL,
    MOV_IN_NUMLANCTO    NUMBER        NOT NULL,
    AGN_IN_CODIGO       NUMBER        NOT NULL,
    FIL_IN_CODIGO       NUMBER        NOT NULL,
    LOJ_ST_CODIGO       VARCHAR2(20)  NOT NULL,
    APT_CH_NATUREZA     CHAR(1)       NOT NULL,        -- natureza do lancamento na conta: D entrada | C saida
    APT_RE_VALOR        NUMBER(15,2)  NOT NULL,
    APT_DT_MOVIMENTO    DATE          NOT NULL,
    APT_DT_BANCO        DATE          NOT NULL,
    CBA_IN_SEQUENCIA    NUMBER        NOT NULL,
    CON_IN_SEQUENCIAL   NUMBER        NOT NULL,
    APT_CH_STATUS       CHAR(1)       DEFAULT 'A' NOT NULL,   -- A ativo | D desfeito
    USU_IN_CODIGO       NUMBER        NOT NULL,
    USU_ST_LOGIN        VARCHAR2(60),
    APT_DT_INCLUSAO     DATE          DEFAULT SYSDATE NOT NULL,
    LOT_IN_DESFAZ       NUMBER,
    USU_IN_DESFAZ       NUMBER,
    USU_ST_DESFAZ       VARCHAR2(60),
    APT_DT_DESFAZ       DATE,
    CONSTRAINT CCS_PK_GFIN_PIX_APONT PRIMARY KEY (APT_IN_CODIGO)
)
/
CREATE INDEX MEGA.CCS_IX_GFIN_PIX_APONT_MOV ON MEGA.CCS_TB_GFIN_PIX_APONT (ORG_IN_CODIGO, MOV_IN_NUMLANCTO)
/
CREATE INDEX MEGA.CCS_IX_GFIN_PIX_APONT_BANCO ON MEGA.CCS_TB_GFIN_PIX_APONT (GRP_IN_CODIGO, APT_CH_STATUS, APT_DT_BANCO)
/
CREATE SEQUENCE MEGA.CCS_SEQ_GFIN_PIX_LOTE START WITH 1 NOCACHE
/
CREATE SEQUENCE MEGA.CCS_SEQ_GFIN_PIX_APONT START WITH 1 NOCACHE
/

-- configuracao inicial (grupo 1). Corte 01/11/2026; saldo de abertura = "SALDO DO DIA ANTERIOR" (30/10) da aba 03.11.2026
-- (total 223.598,09). [27/11 - aplicado primeiro com corte 27/11 e saldos da aba 27.11 (383.014,76), trocado no mesmo dia.]
-- Filial -> loja: 501..504 sao as lojas; PRO-FREE (550/560/570) e ANDRAR II (970) saem do saldo de Caruaru, como a
-- planilha de 26/11 lanca (33,38 PRO-FREE e 7.000,00 ANDRAR II na loja CARUARU); PRO QUALITY/PRO BONI no PRO-QLT.
BEGIN
    INSERT INTO MEGA.CCS_TB_GFIN_PIX_GRUPO (GRP_IN_CODIGO, GRP_ST_NOME, GRP_DT_CORTE, GRP_CH_ATIVO, GRP_DT_ALTERACAO, GRP_ST_USU)
    VALUES (1, 'CAIXA PIX I (JE) JEANS.COM', DATE '2026-11-01', 'S', SYSDATE, 'RONALDO FAJAN');
    INSERT INTO MEGA.CCS_TB_GFIN_PIX_CONTA VALUES (1, 24492, 'PRO-FREE', 1);
    INSERT INTO MEGA.CCS_TB_GFIN_PIX_CONTA VALUES (1, 24504, 'PRO-QLT', 2);
    INSERT INTO MEGA.CCS_TB_GFIN_PIX_CONTA VALUES (1, 25515, 'ANDRAR II', 3);
    INSERT INTO MEGA.CCS_TB_GFIN_PIX_LOJA VALUES (1, 'CARUARU',   'CARUARU',    90473.05, 1);   -- 90.410,51 + INDUSTRIA 23,40 + PRO-FREE 39,14
    INSERT INTO MEGA.CCS_TB_GFIN_PIX_LOJA VALUES (1, 'GARANHUNS', 'GARANHUNS',   1539.63, 2);
    INSERT INTO MEGA.CCS_TB_GFIN_PIX_LOJA VALUES (1, 'ARCOVERDE', 'ARCOVERDE',    117.15, 3);
    INSERT INTO MEGA.CCS_TB_GFIN_PIX_LOJA VALUES (1, 'GRAVATA',   'GRAVATA',    15541.93, 4);
    INSERT INTO MEGA.CCS_TB_GFIN_PIX_LOJA VALUES (1, 'PRO-QLT',   'PRO-QLT',   115926.33, 5);
    INSERT INTO MEGA.CCS_TB_GFIN_PIX_FILIAL VALUES (1, 501, 'CARUARU');
    INSERT INTO MEGA.CCS_TB_GFIN_PIX_FILIAL VALUES (1, 502, 'GARANHUNS');
    INSERT INTO MEGA.CCS_TB_GFIN_PIX_FILIAL VALUES (1, 503, 'ARCOVERDE');
    INSERT INTO MEGA.CCS_TB_GFIN_PIX_FILIAL VALUES (1, 504, 'GRAVATA');
    INSERT INTO MEGA.CCS_TB_GFIN_PIX_FILIAL VALUES (1, 550, 'CARUARU');
    INSERT INTO MEGA.CCS_TB_GFIN_PIX_FILIAL VALUES (1, 560, 'CARUARU');
    INSERT INTO MEGA.CCS_TB_GFIN_PIX_FILIAL VALUES (1, 570, 'CARUARU');
    INSERT INTO MEGA.CCS_TB_GFIN_PIX_FILIAL VALUES (1, 970, 'CARUARU');
    INSERT INTO MEGA.CCS_TB_GFIN_PIX_FILIAL VALUES (1, 700, 'PRO-QLT');
    INSERT INTO MEGA.CCS_TB_GFIN_PIX_FILIAL VALUES (1, 710, 'PRO-QLT');
    COMMIT;
END;
/

-- permissao propria (Gestor: Administracao de Usuarios). Rotulo bonito em web/src/modulos.js (dropdown Baixas/Conciliacao).
MERGE INTO MEGA.CCS_TB_GFIN_MODULO M
USING (SELECT 'PIX_CONCILIA' COD FROM DUAL) X
   ON (M.MOD_ST_CODIGO = X.COD)
 WHEN NOT MATCHED THEN
      INSERT (MOD_ST_CODIGO, MOD_ST_NOME, MOD_IN_ORDEM, MOD_CH_ATIVO)
      VALUES ('PIX_CONCILIA', 'Conciliacao PIX', 13, 'S')
/

CREATE OR REPLACE PROCEDURE MEGA.CCS_P_GFIN_PIX_CONCILIA_X (
    P_LOT      IN NUMBER,
    P_GRP      IN NUMBER,
    P_MOVS     IN VARCHAR2,   -- 'org:seq:lancto;org:seq:lancto;...'
    P_DT_BANCO IN DATE,
    P_USU      IN NUMBER,
    P_LOGIN    IN VARCHAR2
) IS
    -- [2026-11-27 - RONALDO FAJAN] concilia 1 x 1 cada lancamento marcado na tela Conciliacao PIX com uma linha de banco
    -- digitada na data informada (ver cabecalho do sql/50). NAO COMITA (o CCS_P_GFIN_PIX_CONCILIA controla a transacao).
    C_ORG_TAB CONSTANT NUMBER := 53; C_ORG_PAD CONSTANT NUMBER := 1; C_ORG_TAU CONSTANT VARCHAR2(3) := 'G'; C_MOV_TAB CONSTANT NUMBER := 352;
    G      MEGA.CCS_TB_GFIN_PIX_GRUPO%ROWTYPE;
    M      MEGA.FIN_MOVIMENTO%ROWTYPE;
    W_I    NUMBER := 0;
    W_QTD  NUMBER := 0;
    W_ITEM VARCHAR2(80);
    W_ORG  NUMBER; W_SEQ NUMBER; W_LANC NUMBER;
    W_X    NUMBER;
    W_HUS  NUMBER;
    W_BAN  NUMBER;
    W_LOJ  VARCHAR2(20);
    W_TPD  VARCHAR2(10);
    W_TPDB VARCHAR2(20);
    W_HIST VARCHAR2(200);
    W_DOC  VARCHAR2(20);
    W_CBA  NUMBER;
    W_CON  NUMBER;
    W_DT   DATE;
    W_DTM  DATE;
    W_ENT  NUMBER := 0;
    W_SAI  NUMBER := 0;
    E_OCUPADO EXCEPTION; PRAGMA EXCEPTION_INIT(E_OCUPADO, -54);
BEGIN
    BEGIN
        SELECT * INTO G FROM MEGA.CCS_TB_GFIN_PIX_GRUPO WHERE GRP_IN_CODIGO = P_GRP;
    EXCEPTION WHEN NO_DATA_FOUND THEN RAISE_APPLICATION_ERROR(-20100, 'Grupo de conciliacao PIX ' || P_GRP || ' nao existe.');
    END;
    IF G.GRP_CH_ATIVO <> 'S' THEN RAISE_APPLICATION_ERROR(-20100, 'Grupo de conciliacao PIX ' || P_GRP || ' inativo.'); END IF;
    IF P_DT_BANCO IS NULL THEN RAISE_APPLICATION_ERROR(-20100, 'Informe a data do banco.'); END IF;
    W_DT := TRUNC(P_DT_BANCO);
    IF W_DT > TRUNC(SYSDATE) THEN RAISE_APPLICATION_ERROR(-20100, 'Data do banco no futuro (' || TO_CHAR(W_DT, 'DD/MM/YYYY') || ').'); END IF;
    IF W_DT < G.GRP_DT_CORTE THEN
        RAISE_APPLICATION_ERROR(-20100, 'Data do banco antes da data de corte da conciliacao (' || TO_CHAR(G.GRP_DT_CORTE, 'DD/MM/YYYY') || ').');
    END IF;
    SELECT MIN(H.HUS_IN_SEQUENCIA) INTO W_HUS FROM MEGA.GLO_HIERARQUIAUSUARIO H WHERE H.SIS_IN_CODIGO = 14 AND H.GRU_IN_CODIGO = P_USU;
    IF W_HUS IS NULL THEN RAISE_APPLICATION_ERROR(-20100, 'Usuario ' || P_USU || ' sem hierarquia no Mov. Financeiro do Mega para conciliar.'); END IF;

    LOOP
        W_I := W_I + 1;
        W_ITEM := REGEXP_SUBSTR(P_MOVS, '[^;]+', 1, W_I);
        EXIT WHEN W_ITEM IS NULL;
        W_QTD := W_QTD + 1;
        IF W_QTD > 300 THEN RAISE_APPLICATION_ERROR(-20100, 'No maximo 300 lancamentos por vez.'); END IF;
        W_ORG  := TO_NUMBER(REGEXP_SUBSTR(W_ITEM, '[^:]+', 1, 1));
        W_SEQ  := TO_NUMBER(REGEXP_SUBSTR(W_ITEM, '[^:]+', 1, 2));
        W_LANC := TO_NUMBER(REGEXP_SUBSTR(W_ITEM, '[^:]+', 1, 3));
        BEGIN
            SELECT X.* INTO M FROM MEGA.FIN_MOVIMENTO X
             WHERE X.ORG_TAB_IN_CODIGO = C_ORG_TAB AND X.ORG_PAD_IN_CODIGO = C_ORG_PAD AND X.ORG_IN_CODIGO = W_ORG AND X.ORG_TAU_ST_CODIGO = C_ORG_TAU
               AND X.MOV_TAB_IN_CODIGO = C_MOV_TAB AND X.MOV_SEQ_IN_CODIGO = W_SEQ AND X.MOV_IN_NUMLANCTO = W_LANC
               FOR UPDATE NOWAIT;
        EXCEPTION
            WHEN NO_DATA_FOUND THEN RAISE_APPLICATION_ERROR(-20100, 'Lancamento ' || W_LANC || ' nao encontrado no Mega.');
            WHEN E_OCUPADO THEN RAISE_APPLICATION_ERROR(-20100, 'Lancamento ' || W_LANC || ' em uso por outro usuario no Mega.');
        END;
        SELECT COUNT(*) INTO W_X FROM MEGA.CCS_TB_GFIN_PIX_CONTA K WHERE K.GRP_IN_CODIGO = P_GRP AND K.AGN_IN_CODIGO = M.AGN_IN_CODIGO;
        IF W_X = 0 OR M.AGN_TAB_IN_CODIGO <> C_ORG_TAB OR M.AGN_TAU_ST_CODIGO <> 'N' THEN
            RAISE_APPLICATION_ERROR(-20100, 'Lancamento ' || W_LANC || ' nao e de uma conta do ' || G.GRP_ST_NOME || '.');
        END IF;
        IF NVL(M.MOV_CH_SITUACAO, 'N') = 'C' OR NVL(M.MOV_BO_PREVISAO, 'N') <> 'N' THEN
            RAISE_APPLICATION_ERROR(-20100, 'Lancamento ' || W_LANC || ' cancelado ou de previsao.');
        END IF;
        IF NVL(M.MOV_CH_CONCILIADO, 'N') = 'S' OR M.CON_IN_SEQUENCIAL IS NOT NULL THEN
            RAISE_APPLICATION_ERROR(-20100, 'Lancamento ' || W_LANC || ' ja esta conciliado.');
        END IF;
        W_DTM := TRUNC(M.MOV_DT_DATADOCTO);
        IF W_DTM < G.GRP_DT_CORTE THEN
            RAISE_APPLICATION_ERROR(-20100, 'Lancamento ' || W_LANC || ' de ' || TO_CHAR(W_DTM, 'DD/MM/YYYY') || ' e anterior a data de corte (' || TO_CHAR(G.GRP_DT_CORTE, 'DD/MM/YYYY') || ').');
        END IF;
        IF W_DTM > TRUNC(SYSDATE) THEN
            RAISE_APPLICATION_ERROR(-20100, 'Lancamento ' || W_LANC || ' com data futura no Mega (' || TO_CHAR(W_DTM, 'DD/MM/YYYY') || '): corrija a data antes de conciliar.');
        END IF;
        BEGIN
            SELECT F.LOJ_ST_CODIGO INTO W_LOJ FROM MEGA.CCS_TB_GFIN_PIX_FILIAL F WHERE F.GRP_IN_CODIGO = P_GRP AND F.FIL_IN_CODIGO = M.FIL_IN_CODIGO;
        EXCEPTION WHEN NO_DATA_FOUND THEN
            RAISE_APPLICATION_ERROR(-20100, 'Filial ' || M.FIL_IN_CODIGO || ' (lancamento ' || W_LANC || ') sem loja na configuracao da conciliacao PIX.');
        END;
        SELECT NVL(MAX(C.BAN_IN_NUMERO), 999) INTO W_BAN FROM MEGA.GLO_CONTASFIN C
         WHERE C.AGN_TAB_IN_CODIGO = M.AGN_TAB_IN_CODIGO AND C.AGN_PAD_IN_CODIGO = M.AGN_PAD_IN_CODIGO
           AND C.AGN_IN_CODIGO = M.AGN_IN_CODIGO AND C.AGN_TAU_ST_CODIGO = M.AGN_TAU_ST_CODIGO;
        BEGIN
            MEGA.FIN_PCK_CONCILIACAOBANC.P_VALIDACONCILIACAO(M.ORG_IN_CODIGO, M.FIL_IN_CODIGO, LEAST(W_DTM, W_DT));
        EXCEPTION WHEN OTHERS THEN
            RAISE_APPLICATION_ERROR(-20100, 'Conciliacao bancaria encerrada no Mega para a filial ' || M.FIL_IN_CODIGO || ' em ' || TO_CHAR(LEAST(W_DTM, W_DT), 'DD/MM/YYYY') || '.');
        END;
        -- mesmo tipo de documento que o financeiro digitava nessas contas (conta 999: AVCRED 002 / AVDEB 001)
        W_TPD := CASE WHEN M.MOV_CH_NATUREZA = 'D' THEN 'AVCRED' ELSE 'AVDEB' END;
        SELECT MIN(D.TPDB_ST_CODIGO) INTO W_TPDB FROM MEGA.FIN_TIPODOCTOBANCO D WHERE D.TPD_ST_CODIGO = W_TPD AND D.BAN_IN_NUMERO = W_BAN;
        IF W_TPDB IS NULL THEN W_TPD := NULL; END IF;
        -- historico da linha do banco: nome de quem pagou/recebeu (o outro lado da mesma acao)
        SELECT MAX(A.AGN_ST_NOME) INTO W_HIST
          FROM MEGA.FIN_MOVIMENTO O, MEGA.GLO_AGENTES A
         WHERE O.ORG_TAB_IN_CODIGO = M.ORG_TAB_IN_CODIGO AND O.ORG_PAD_IN_CODIGO = M.ORG_PAD_IN_CODIGO AND O.ORG_IN_CODIGO = M.ORG_IN_CODIGO
           AND O.ORG_TAU_ST_CODIGO = M.ORG_TAU_ST_CODIGO AND O.ACAOM_IN_SEQUENCIA = M.ACAOM_IN_SEQUENCIA
           AND O.MOV_IN_NUMLANCTO <> M.MOV_IN_NUMLANCTO
           AND A.AGN_TAB_IN_CODIGO = O.AGN_TAB_IN_CODIGO AND A.AGN_PAD_IN_CODIGO = O.AGN_PAD_IN_CODIGO AND A.AGN_IN_CODIGO = O.AGN_IN_CODIGO;
        W_HIST := SUBSTR('PIX ' || NVL(W_HIST, M.MOV_ST_COMPLHIST), 1, 50);
        W_DOC  := SUBSTR(M.MOV_ST_DOCUMENTO, 1, 20);
        W_CBA  := PCK_MEGA.PROXIMASEQUENCIATAB(358);
        SELECT MEGA.FIN_SEQ_CONCILIACAO.NEXTVAL INTO W_CON FROM DUAL;
        IF NVL(W_CBA, 0) = 0 OR NVL(W_CON, 0) = 0 THEN RAISE_APPLICATION_ERROR(-20100, 'Falha na numeracao da conciliacao bancaria do Mega.'); END IF;

        INSERT INTO MEGA.FIN_CONCILIAMOVIMENTO
          (CON_IN_SEQUENCIAL, ORG_TAB_IN_CODIGO, ORG_PAD_IN_CODIGO, ORG_IN_CODIGO, ORG_TAU_ST_CODIGO,
           AGN_TAB_IN_CODIGO, AGN_PAD_IN_CODIGO, AGN_IN_CODIGO, AGN_TAU_ST_CODIGO,
           CON_CH_TIPO, CON_DT_CONCILIACAO, CON_DT_MAIORDATA, USU_IN_CODIGO, CON_RE_VALOR)
        VALUES
          (W_CON, M.ORG_TAB_IN_CODIGO, M.ORG_PAD_IN_CODIGO, M.ORG_IN_CODIGO, M.ORG_TAU_ST_CODIGO,
           M.AGN_TAB_IN_CODIGO, M.AGN_PAD_IN_CODIGO, M.AGN_IN_CODIGO, M.AGN_TAU_ST_CODIGO,
           'M', SYSDATE, GREATEST(W_DTM, W_DT), P_USU, M.MOV_RE_VALOR);
        INSERT INTO MEGA.FIN_CONCILIACAO
          (CBA_IN_SEQUENCIA, TPD_ST_CODIGO, TPDB_ST_CODIGO, BAN_IN_NUMERO,
           ORG_TAB_IN_CODIGO, ORG_PAD_IN_CODIGO, ORG_IN_CODIGO, ORG_TAU_ST_CODIGO, FIL_IN_CODIGO,
           AGN_TAB_IN_CODIGO, AGN_PAD_IN_CODIGO, AGN_IN_CODIGO, AGN_TAU_ST_CODIGO,
           CBA_DT_DATA, CBA_CH_NATUREZA, CBA_RE_VALOR, CBA_CH_TIPO, CBA_CH_STATUS,
           CBA_ST_HISTORICO, CBA_ST_DOCUMENTO, CBA_CH_SONUMEROS, CON_IN_SEQUENCIAL)
        VALUES
          (W_CBA, W_TPD, W_TPDB, W_BAN,
           M.ORG_TAB_IN_CODIGO, M.ORG_PAD_IN_CODIGO, M.ORG_IN_CODIGO, M.ORG_TAU_ST_CODIGO, M.FIL_IN_CODIGO,
           M.AGN_TAB_IN_CODIGO, M.AGN_PAD_IN_CODIGO, M.AGN_IN_CODIGO, M.AGN_TAU_ST_CODIGO,
           W_DT, CASE WHEN M.MOV_CH_NATUREZA = 'D' THEN 'C' ELSE 'D' END, M.MOV_RE_VALOR, 'D', 'S',
           W_HIST, W_DOC, CASE WHEN REGEXP_LIKE(NVL(W_DOC, 'X'), '^[0-9]+$') THEN 'S' ELSE 'N' END, W_CON);
        UPDATE MEGA.FIN_MOVIMENTO X
           SET X.MOV_CH_CONCILIADO = 'S', X.CON_IN_SEQUENCIAL = W_CON
         WHERE X.ORG_TAB_IN_CODIGO = C_ORG_TAB AND X.ORG_PAD_IN_CODIGO = C_ORG_PAD AND X.ORG_IN_CODIGO = W_ORG AND X.ORG_TAU_ST_CODIGO = C_ORG_TAU
           AND X.MOV_TAB_IN_CODIGO = C_MOV_TAB AND X.MOV_SEQ_IN_CODIGO = W_SEQ AND X.MOV_IN_NUMLANCTO = W_LANC;
        IF SQL%ROWCOUNT <> 1 THEN RAISE_APPLICATION_ERROR(-20100, 'Falha ao marcar o lancamento ' || W_LANC || ' como conciliado.'); END IF;

        INSERT INTO MEGA.CCS_TB_GFIN_PIX_APONT
          (APT_IN_CODIGO, LOT_IN_CODIGO, GRP_IN_CODIGO, ORG_IN_CODIGO, MOV_SEQ_IN_CODIGO, MOV_IN_NUMLANCTO, AGN_IN_CODIGO, FIL_IN_CODIGO,
           LOJ_ST_CODIGO, APT_CH_NATUREZA, APT_RE_VALOR, APT_DT_MOVIMENTO, APT_DT_BANCO, CBA_IN_SEQUENCIA, CON_IN_SEQUENCIAL,
           APT_CH_STATUS, USU_IN_CODIGO, USU_ST_LOGIN, APT_DT_INCLUSAO)
        VALUES
          (MEGA.CCS_SEQ_GFIN_PIX_APONT.NEXTVAL, P_LOT, P_GRP, W_ORG, W_SEQ, W_LANC, M.AGN_IN_CODIGO, M.FIL_IN_CODIGO,
           W_LOJ, M.MOV_CH_NATUREZA, M.MOV_RE_VALOR, W_DTM, W_DT, W_CBA, W_CON,
           'A', P_USU, SUBSTR(P_LOGIN, 1, 60), SYSDATE);
        IF M.MOV_CH_NATUREZA = 'D' THEN W_ENT := W_ENT + M.MOV_RE_VALOR; ELSE W_SAI := W_SAI + M.MOV_RE_VALOR; END IF;
    END LOOP;
    IF W_QTD = 0 THEN RAISE_APPLICATION_ERROR(-20100, 'Nenhum lancamento informado.'); END IF;
    UPDATE MEGA.CCS_TB_GFIN_PIX_LOTE
       SET LOT_DT_BANCO = W_DT, LOT_IN_QTD = W_QTD, LOT_RE_ENTRADAS = W_ENT, LOT_RE_SAIDAS = W_SAI
     WHERE LOT_IN_CODIGO = P_LOT;
END CCS_P_GFIN_PIX_CONCILIA_X;
/

CREATE OR REPLACE PROCEDURE MEGA.CCS_P_GFIN_PIX_CONCILIA (
    P_TOKEN    IN VARCHAR2,
    P_GRP      IN NUMBER,
    P_MOVS     IN VARCHAR2,
    P_DT_BANCO IN VARCHAR2,   -- 'YYYY-MM-DD'
    P_USU      IN NUMBER,
    P_LOGIN    IN VARCHAR2,
    P_SIMULAR  IN VARCHAR2 DEFAULT 'N'
) IS
    -- [2026-11-27 - RONALDO FAJAN] entrada da API (POST /pix/conciliar): lote com token, tudo ou nada, resultado em
    -- CCS_TB_GFIN_PIX_LOTE (a API le pelo token). Simulacao desfaz tudo e devolve 'S'.
    W_LOT NUMBER; W_ST CHAR(1); W_MSG VARCHAR2(1500);
BEGIN
    SELECT MEGA.CCS_SEQ_GFIN_PIX_LOTE.NEXTVAL INTO W_LOT FROM DUAL;
    INSERT INTO MEGA.CCS_TB_GFIN_PIX_LOTE (LOT_IN_CODIGO, LOT_ST_TOKEN, GRP_IN_CODIGO, LOT_CH_TIPO, LOT_CH_STATUS, LOT_ST_ITENS, USU_IN_CODIGO, USU_ST_LOGIN, LOT_DT_INCLUSAO)
    VALUES (W_LOT, SUBSTR(P_TOKEN, 1, 60), P_GRP, 'C', 'X', SUBSTR(P_MOVS, 1, 4000), P_USU, SUBSTR(P_LOGIN, 1, 60), SYSDATE);
    SAVEPOINT SP_GFIN_PIX_CONC;
    BEGIN
        MEGA.CCS_P_GFIN_PIX_CONCILIA_X(W_LOT, P_GRP, P_MOVS, TO_DATE(P_DT_BANCO, 'YYYY-MM-DD'), P_USU, P_LOGIN);
        IF NVL(P_SIMULAR, 'N') = 'S' THEN
            ROLLBACK TO SP_GFIN_PIX_CONC; W_ST := 'S'; W_MSG := 'Simulacao sem erro. Nada foi gravado.';
        ELSE
            W_ST := 'B'; W_MSG := NULL;
        END IF;
    EXCEPTION
        WHEN OTHERS THEN
            W_MSG := SUBSTR(REGEXP_REPLACE(SQLERRM, '^ORA-20100: ', ''), 1, 1500);
            ROLLBACK TO SP_GFIN_PIX_CONC; W_ST := 'X';
    END;
    UPDATE MEGA.CCS_TB_GFIN_PIX_LOTE SET LOT_CH_STATUS = W_ST, LOT_ST_MENSAGEM = W_MSG WHERE LOT_IN_CODIGO = W_LOT;
    COMMIT;
END CCS_P_GFIN_PIX_CONCILIA;
/

CREATE OR REPLACE PROCEDURE MEGA.CCS_P_GFIN_PIX_DESFAZ_X (
    P_LOT   IN NUMBER,
    P_GRP   IN NUMBER,
    P_APTS  IN VARCHAR2,   -- '12,13,14' (CCS_TB_GFIN_PIX_APONT.APT_IN_CODIGO)
    P_USU   IN NUMBER,
    P_LOGIN IN VARCHAR2
) IS
    -- [2026-11-27 - RONALDO FAJAN] desfaz conciliacoes feitas pela tela Conciliacao PIX. Ordem imposta pelos triggers
    -- nativos: solta a linha do banco (CON nulo), desmarca o lancamento, apaga FIN_CONCILIAMOVIMENTO, apaga a linha digitada.
    -- NAO COMITA.
    C_ORG_TAB CONSTANT NUMBER := 53; C_ORG_PAD CONSTANT NUMBER := 1; C_ORG_TAU CONSTANT VARCHAR2(3) := 'G'; C_MOV_TAB CONSTANT NUMBER := 352;
    A      MEGA.CCS_TB_GFIN_PIX_APONT%ROWTYPE;
    M      MEGA.FIN_MOVIMENTO%ROWTYPE;
    W_I    NUMBER := 0;
    W_QTD  NUMBER := 0;
    W_ITEM VARCHAR2(40);
    W_APT  NUMBER;
    W_X    NUMBER;
    W_CBA  NUMBER;
    W_CONT NUMBER;
    W_ENT  NUMBER := 0;
    W_SAI  NUMBER := 0;
    E_OCUPADO EXCEPTION; PRAGMA EXCEPTION_INIT(E_OCUPADO, -54);
BEGIN
    LOOP
        W_I := W_I + 1;
        W_ITEM := REGEXP_SUBSTR(P_APTS, '[^,]+', 1, W_I);
        EXIT WHEN W_ITEM IS NULL;
        W_QTD := W_QTD + 1;
        IF W_QTD > 300 THEN RAISE_APPLICATION_ERROR(-20100, 'No maximo 300 conciliacoes por vez.'); END IF;
        W_APT := TO_NUMBER(TRIM(W_ITEM));
        BEGIN
            SELECT X.* INTO A FROM MEGA.CCS_TB_GFIN_PIX_APONT X WHERE X.APT_IN_CODIGO = W_APT AND X.GRP_IN_CODIGO = P_GRP FOR UPDATE NOWAIT;
        EXCEPTION
            WHEN NO_DATA_FOUND THEN RAISE_APPLICATION_ERROR(-20100, 'Conciliacao ' || W_APT || ' nao encontrada.');
            WHEN E_OCUPADO THEN RAISE_APPLICATION_ERROR(-20100, 'Conciliacao ' || W_APT || ' em uso por outro usuario.');
        END;
        IF A.APT_CH_STATUS <> 'A' THEN RAISE_APPLICATION_ERROR(-20100, 'Conciliacao do lancamento ' || A.MOV_IN_NUMLANCTO || ' ja foi desfeita.'); END IF;
        BEGIN
            SELECT X.* INTO M FROM MEGA.FIN_MOVIMENTO X
             WHERE X.ORG_TAB_IN_CODIGO = C_ORG_TAB AND X.ORG_PAD_IN_CODIGO = C_ORG_PAD AND X.ORG_IN_CODIGO = A.ORG_IN_CODIGO AND X.ORG_TAU_ST_CODIGO = C_ORG_TAU
               AND X.MOV_TAB_IN_CODIGO = C_MOV_TAB AND X.MOV_SEQ_IN_CODIGO = A.MOV_SEQ_IN_CODIGO AND X.MOV_IN_NUMLANCTO = A.MOV_IN_NUMLANCTO
               FOR UPDATE NOWAIT;
        EXCEPTION
            WHEN NO_DATA_FOUND THEN RAISE_APPLICATION_ERROR(-20100, 'Lancamento ' || A.MOV_IN_NUMLANCTO || ' nao existe mais no Mega: confira a conciliacao ' || A.CON_IN_SEQUENCIAL || ' no Mega.');
            WHEN E_OCUPADO THEN RAISE_APPLICATION_ERROR(-20100, 'Lancamento ' || A.MOV_IN_NUMLANCTO || ' em uso por outro usuario no Mega.');
        END;
        IF NVL(M.CON_IN_SEQUENCIAL, -1) <> A.CON_IN_SEQUENCIAL THEN
            RAISE_APPLICATION_ERROR(-20100, 'A conciliacao do lancamento ' || A.MOV_IN_NUMLANCTO || ' foi alterada no Mega depois desta tela; desfaca pelo Mega.');
        END IF;
        SELECT COUNT(*) INTO W_X FROM MEGA.FIN_MOVIMENTO X WHERE X.CON_IN_SEQUENCIAL = A.CON_IN_SEQUENCIAL;
        IF W_X <> 1 THEN RAISE_APPLICATION_ERROR(-20100, 'A conciliacao ' || A.CON_IN_SEQUENCIAL || ' tem ' || W_X || ' lancamentos no Mega; desfaca pelo Mega.'); END IF;
        SELECT COUNT(*), MAX(B.CBA_IN_SEQUENCIA), MAX(B.CON_IN_SEQCONCCONT) INTO W_X, W_CBA, W_CONT
          FROM MEGA.FIN_CONCILIACAO B WHERE B.CON_IN_SEQUENCIAL = A.CON_IN_SEQUENCIAL;
        IF W_X <> 1 OR W_CBA <> A.CBA_IN_SEQUENCIA THEN
            RAISE_APPLICATION_ERROR(-20100, 'A conciliacao ' || A.CON_IN_SEQUENCIAL || ' nao tem so a linha do banco desta tela; desfaca pelo Mega.');
        END IF;
        IF W_CONT IS NOT NULL THEN
            RAISE_APPLICATION_ERROR(-20100, 'Lancamento ' || A.MOV_IN_NUMLANCTO || ' ja conciliado na Contabilidade: nao pode ser desfeito.');
        END IF;
        BEGIN
            MEGA.FIN_PCK_CONCILIACAOBANC.P_VALIDACONCILIACAO(M.ORG_IN_CODIGO, M.FIL_IN_CODIGO, LEAST(TRUNC(M.MOV_DT_DATADOCTO), A.APT_DT_BANCO));
        EXCEPTION WHEN OTHERS THEN
            RAISE_APPLICATION_ERROR(-20100, 'Conciliacao bancaria encerrada no Mega para a filial ' || M.FIL_IN_CODIGO || ': nao pode ser desfeita.');
        END;
        UPDATE MEGA.FIN_CONCILIACAO SET CBA_CH_STATUS = 'N', CON_IN_SEQUENCIAL = NULL WHERE CBA_IN_SEQUENCIA = A.CBA_IN_SEQUENCIA;
        UPDATE MEGA.FIN_MOVIMENTO X
           SET X.MOV_CH_CONCILIADO = 'N', X.CON_IN_SEQUENCIAL = NULL
         WHERE X.ORG_TAB_IN_CODIGO = C_ORG_TAB AND X.ORG_PAD_IN_CODIGO = C_ORG_PAD AND X.ORG_IN_CODIGO = A.ORG_IN_CODIGO AND X.ORG_TAU_ST_CODIGO = C_ORG_TAU
           AND X.MOV_TAB_IN_CODIGO = C_MOV_TAB AND X.MOV_SEQ_IN_CODIGO = A.MOV_SEQ_IN_CODIGO AND X.MOV_IN_NUMLANCTO = A.MOV_IN_NUMLANCTO;
        IF SQL%ROWCOUNT <> 1 THEN RAISE_APPLICATION_ERROR(-20100, 'Falha ao desmarcar o lancamento ' || A.MOV_IN_NUMLANCTO || '.'); END IF;
        DELETE FROM MEGA.FIN_CONCILIAMOVIMENTO WHERE CON_IN_SEQUENCIAL = A.CON_IN_SEQUENCIAL;
        DELETE FROM MEGA.FIN_CONCILIACAO WHERE CBA_IN_SEQUENCIA = A.CBA_IN_SEQUENCIA AND CON_IN_SEQUENCIAL IS NULL;
        IF SQL%ROWCOUNT <> 1 THEN RAISE_APPLICATION_ERROR(-20100, 'Falha ao apagar a linha do banco ' || A.CBA_IN_SEQUENCIA || '.'); END IF;
        UPDATE MEGA.CCS_TB_GFIN_PIX_APONT
           SET APT_CH_STATUS = 'D', LOT_IN_DESFAZ = P_LOT, USU_IN_DESFAZ = P_USU, USU_ST_DESFAZ = SUBSTR(P_LOGIN, 1, 60), APT_DT_DESFAZ = SYSDATE
         WHERE APT_IN_CODIGO = A.APT_IN_CODIGO;
        IF A.APT_CH_NATUREZA = 'D' THEN W_ENT := W_ENT + A.APT_RE_VALOR; ELSE W_SAI := W_SAI + A.APT_RE_VALOR; END IF;
    END LOOP;
    IF W_QTD = 0 THEN RAISE_APPLICATION_ERROR(-20100, 'Nenhuma conciliacao informada.'); END IF;
    UPDATE MEGA.CCS_TB_GFIN_PIX_LOTE SET LOT_IN_QTD = W_QTD, LOT_RE_ENTRADAS = W_ENT, LOT_RE_SAIDAS = W_SAI WHERE LOT_IN_CODIGO = P_LOT;
END CCS_P_GFIN_PIX_DESFAZ_X;
/

CREATE OR REPLACE PROCEDURE MEGA.CCS_P_GFIN_PIX_DESFAZ (
    P_TOKEN   IN VARCHAR2,
    P_GRP     IN NUMBER,
    P_APTS    IN VARCHAR2,
    P_USU     IN NUMBER,
    P_LOGIN   IN VARCHAR2,
    P_SIMULAR IN VARCHAR2 DEFAULT 'N'
) IS
    -- [2026-11-27 - RONALDO FAJAN] entrada da API (POST /pix/desfazer): mesmo controle do CCS_P_GFIN_PIX_CONCILIA.
    W_LOT NUMBER; W_ST CHAR(1); W_MSG VARCHAR2(1500);
BEGIN
    SELECT MEGA.CCS_SEQ_GFIN_PIX_LOTE.NEXTVAL INTO W_LOT FROM DUAL;
    INSERT INTO MEGA.CCS_TB_GFIN_PIX_LOTE (LOT_IN_CODIGO, LOT_ST_TOKEN, GRP_IN_CODIGO, LOT_CH_TIPO, LOT_CH_STATUS, LOT_ST_ITENS, USU_IN_CODIGO, USU_ST_LOGIN, LOT_DT_INCLUSAO)
    VALUES (W_LOT, SUBSTR(P_TOKEN, 1, 60), P_GRP, 'D', 'X', SUBSTR(P_APTS, 1, 4000), P_USU, SUBSTR(P_LOGIN, 1, 60), SYSDATE);
    SAVEPOINT SP_GFIN_PIX_DESF;
    BEGIN
        MEGA.CCS_P_GFIN_PIX_DESFAZ_X(W_LOT, P_GRP, P_APTS, P_USU, P_LOGIN);
        IF NVL(P_SIMULAR, 'N') = 'S' THEN
            ROLLBACK TO SP_GFIN_PIX_DESF; W_ST := 'S'; W_MSG := 'Simulacao sem erro. Nada foi gravado.';
        ELSE
            W_ST := 'B'; W_MSG := NULL;
        END IF;
    EXCEPTION
        WHEN OTHERS THEN
            W_MSG := SUBSTR(REGEXP_REPLACE(SQLERRM, '^ORA-20100: ', ''), 1, 1500);
            ROLLBACK TO SP_GFIN_PIX_DESF; W_ST := 'X';
    END;
    UPDATE MEGA.CCS_TB_GFIN_PIX_LOTE SET LOT_CH_STATUS = W_ST, LOT_ST_MENSAGEM = W_MSG WHERE LOT_IN_CODIGO = W_LOT;
    COMMIT;
END CCS_P_GFIN_PIX_DESFAZ;
/

-- ============================================================================
-- [2026-11-27 - RONALDO FAJAN] SALDO DE ABERTURA POR CONTA. Pedido: "lembre que a conciliacao e por conta, mesmo que aconteca em
-- varias filiais - baixas da mesma conta". Tela, extrato e fechamento diario passam a ser por conta do Mega (a loja vira so
-- informacao da linha). Abertura em 01/11 (aba 03.11, saldo de 30/10): 24492 = lojas Freedom (Caruaru 90.473,05 + Garanhuns
-- 1.539,63 + Arcoverde 117,15 + Gravata 15.541,93) = 107.671,76; 24504 = PRO-QLT 115.926,33; 25515 = 0 (sem bolso na planilha).
-- CCS_TB_GFIN_PIX_LOJA.LOJ_RE_SALDO_INI deixa de ser usado no saldo (fica como historico).
-- ============================================================================
ALTER TABLE MEGA.CCS_TB_GFIN_PIX_CONTA ADD (CTA_RE_SALDO_INI NUMBER(15,2) DEFAULT 0 NOT NULL)
/
BEGIN
    UPDATE MEGA.CCS_TB_GFIN_PIX_CONTA SET CTA_RE_SALDO_INI = 107671.76 WHERE GRP_IN_CODIGO = 1 AND AGN_IN_CODIGO = 24492;
    UPDATE MEGA.CCS_TB_GFIN_PIX_CONTA SET CTA_RE_SALDO_INI = 115926.33 WHERE GRP_IN_CODIGO = 1 AND AGN_IN_CODIGO = 24504;
    UPDATE MEGA.CCS_TB_GFIN_PIX_CONTA SET CTA_RE_SALDO_INI = 0 WHERE GRP_IN_CODIGO = 1 AND AGN_IN_CODIGO = 25515;
    COMMIT;
END;
/
