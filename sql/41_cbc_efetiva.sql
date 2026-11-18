/* =====================================================================================================================
   [18/11/2026 - CRIADO POR ALEXANDRE CARVALHO] CONCILIACAO BANCARIA - CARTAO: EFETIVAR NA FIN_CONCILIACAO (Quality, OCPDB493)
   Pedido do Alexandre: "um botao efetivar que lance na fin_conciliacao na conta 27619 o que importamos" - decisao 18/11: so o
   RELATORIO DE RECEBIMENTOS da Rede, sempre na conta financeira 27619 (REDE) com a filial de cada estabelecimento:
     P (parcela paga)   -> CREDITO pelo liquido, na data do recebimento, tipo CARCRED/CARDEB pela modalidade
     D (deposito)       -> DEBITO pelo valor depositado (saida da Rede para o banco da loja), tipo TRANSFD
     A (ajuste)         -> DEBITO pelo valor cobrado (aluguel de maquininha etc.), tipo TARBANC
     C (cancelamento)   -> DEBITO pelo valor descontado, tipo CARCRED/CARDEB
     F (futuro) e V (vendas) NAO entram. So linhas com data ANTERIOR A HOJE (as do dia da emissao sao provisorias na Rede).
   A conta 27619 nao tem banco: as linhas usam o banco 999 (o dos lancamentos manuais do Mega), com de-para novo para
   CARCRED/CARDEB/TRANSFD/TARBANC. Grava em FIN_CONCILIACAO igual a importacao nativa (PCK_MEGA.PROXIMASEQUENCIATAB(358),
   tipo 'I', status 'N'). Tudo ou nada por efetivacao; a linha guarda o CBA criado (nunca efetiva duas vezes).
   Deploy pelo gateway SOAP: blocos separados por linha "/", DDL sem ";" final. Somente ASCII.
   ===================================================================================================================== */
ALTER TABLE MEGA.CCS_TB_GFIN_CBC_LINHA ADD (CBA_IN_SEQUENCIA NUMBER, EFE_IN_CODIGO NUMBER)
/
CREATE INDEX MEGA.IX_CCS_GFIN_CBC_LIN_CBA ON MEGA.CCS_TB_GFIN_CBC_LINHA (CBA_IN_SEQUENCIA)
/
CREATE TABLE MEGA.CCS_TB_GFIN_CBC_EFETIVA (
  EFE_IN_CODIGO      NUMBER        NOT NULL,
  FIL_IN_CODIGO      NUMBER(7)     NOT NULL,
  ORG_IN_CODIGO      NUMBER(7),
  CTA_AGN_IN_CODIGO  NUMBER(7)     NOT NULL,
  EFE_DT_INI         DATE,
  EFE_DT_FIM         DATE,
  EFE_IN_QT_LINHAS   NUMBER,
  EFE_IN_QT_PULADAS  NUMBER,
  EFE_RE_CREDITOS    NUMBER,
  EFE_RE_DEBITOS     NUMBER,
  EFE_CH_STATUS      CHAR(1)       NOT NULL,
  EFE_ST_MENSAGEM    VARCHAR2(1500),
  USU_IN_CODIGO      NUMBER,
  USU_ST_LOGIN       VARCHAR2(60),
  EFE_DT_INCLUSAO    DATE          DEFAULT SYSDATE NOT NULL,
  EFE_DT_PROCESSADO  DATE,
  CONSTRAINT PK_CCS_GFIN_CBC_EFETIVA PRIMARY KEY (EFE_IN_CODIGO),
  CONSTRAINT CK_CCS_GFIN_CBC_EFE_ST CHECK (EFE_CH_STATUS IN ('P', 'E', 'X'))
)
/
CREATE SEQUENCE MEGA.CCS_SEQ_GFIN_CBC_EFETIVA START WITH 1 INCREMENT BY 1 NOCACHE
/
MERGE INTO MEGA.CCS_TB_GFIN_PARAM D
USING (SELECT 'CBC_CONTA' CH, 27619 VL, 'CONCILIACAO CARTAO: CONTA FINANCEIRA (AGENTE) QUE RECEBE AS LINHAS DA REDE NA FIN_CONCILIACAO (DECISAO ALEXANDRE 18/11/2026)' DS FROM DUAL
       UNION ALL SELECT 'CBC_BANCO', 999, 'CONCILIACAO CARTAO: BANCO DO DE-PARA FIN_TIPODOCTOBANCO USADO NAS LINHAS DA REDE (999 = LANCAMENTOS SEM BANCO)' FROM DUAL) S
ON (D.PARAM_ST_CHAVE = S.CH)
WHEN MATCHED THEN UPDATE SET D.PARAM_ST_DESCRICAO = S.DS
WHEN NOT MATCHED THEN INSERT (PARAM_ST_CHAVE, PARAM_RE_VALOR, PARAM_ST_DESCRICAO) VALUES (S.CH, S.VL, S.DS)
/
MERGE INTO MEGA.FIN_TIPODOCTOBANCO D
USING (SELECT 'CARCRED' TPD, 999 BAN, '004' TPDB, 'REDE CARTAO CREDITO (GESTOR)' DS FROM DUAL
       UNION ALL SELECT 'CARDEB', 999, '005', 'REDE CARTAO DEBITO (GESTOR)' FROM DUAL
       UNION ALL SELECT 'TRANSFD', 999, '117', 'REDE DEPOSITO NO BANCO DA LOJA (GESTOR)' FROM DUAL
       UNION ALL SELECT 'TARBANC', 999, '105', 'REDE AJUSTE/TARIFA (GESTOR)' FROM DUAL) S
ON (D.TPD_ST_CODIGO = S.TPD AND D.BAN_IN_NUMERO = S.BAN AND D.TPDB_ST_CODIGO = S.TPDB)
WHEN NOT MATCHED THEN INSERT (TPD_ST_CODIGO, BAN_IN_NUMERO, TPDB_ST_CODIGO, TPDB_BO_IMPORTAR, TPDB_ST_DESCRICAO) VALUES (S.TPD, S.BAN, S.TPDB, 'S', S.DS)
/
CREATE OR REPLACE PROCEDURE MEGA.CCS_P_GFIN_CBC_EFETIVA_X (
    P_EFE IN NUMBER
) IS
    /* [18/11/2026 - Alexandre Carvalho] NUCLEO (NAO COMITA): le CCS_TB_GFIN_CBC_EFETIVA P_EFE (status P) e grava em FIN_CONCILIACAO,
       na conta CBC_CONTA e na filial da efetivacao, as linhas importadas (I) do relatorio de recebimentos (abas P/D/A/C) ainda sem CBA
       e com data anterior a hoje. */
    C_TAB CONSTANT NUMBER := 53; C_PAD CONSTANT NUMBER := 1;
    E MEGA.CCS_TB_GFIN_CBC_EFETIVA%ROWTYPE;
    W_CTA NUMBER; W_BAN NUMBER; W_PAD NUMBER; W_ORG NUMBER; W_N NUMBER; W_CBA NUMBER;
    W_NAT CHAR(1); W_VAL NUMBER; W_TPD VARCHAR2(10); W_TPDB VARCHAR2(20); W_HIST VARCHAR2(400); W_DOC VARCHAR2(100); W_MOD VARCHAR2(10);   -- montados largos e cortados no SUBSTR (ORA-06502 na 1a prova)
    W_QT NUMBER := 0; W_PUL NUMBER := 0; W_CRED NUMBER := 0; W_DEB NUMBER := 0; W_DI DATE; W_DF DATE;
    E_OCUPADO EXCEPTION; PRAGMA EXCEPTION_INIT(E_OCUPADO, -54);
BEGIN
    SELECT X.* INTO E FROM MEGA.CCS_TB_GFIN_CBC_EFETIVA X WHERE X.EFE_IN_CODIGO = P_EFE FOR UPDATE;
    IF E.EFE_CH_STATUS <> 'P' THEN RAISE_APPLICATION_ERROR(-20130, 'Esta efetivacao ja foi processada (situacao ' || E.EFE_CH_STATUS || ').'); END IF;
    BEGIN
        SELECT PARAM_RE_VALOR INTO W_CTA FROM MEGA.CCS_TB_GFIN_PARAM WHERE PARAM_ST_CHAVE = 'CBC_CONTA';
        SELECT PARAM_RE_VALOR INTO W_BAN FROM MEGA.CCS_TB_GFIN_PARAM WHERE PARAM_ST_CHAVE = 'CBC_BANCO';
    EXCEPTION WHEN NO_DATA_FOUND THEN RAISE_APPLICATION_ERROR(-20130, 'Parametros CBC_CONTA / CBC_BANCO nao cadastrados (CCS_TB_GFIN_PARAM).');
    END;
    IF NVL(E.CTA_AGN_IN_CODIGO, 0) <> W_CTA THEN RAISE_APPLICATION_ERROR(-20130, 'Conta da efetivacao (' || E.CTA_AGN_IN_CODIGO || ') diferente do parametro CBC_CONTA (' || W_CTA || ').'); END IF;
    -- conta financeira ativa
    BEGIN
        SELECT C.AGN_PAD_IN_CODIGO INTO W_PAD
          FROM MEGA.GLO_CONTASFIN C, MEGA.GLO_AGENTES_ID I
         WHERE C.AGN_TAB_IN_CODIGO = C_TAB AND C.AGN_IN_CODIGO = W_CTA AND C.AGN_TAU_ST_CODIGO = 'N'
           AND I.AGN_TAB_IN_CODIGO = C.AGN_TAB_IN_CODIGO AND I.AGN_PAD_IN_CODIGO = C.AGN_PAD_IN_CODIGO AND I.AGN_IN_CODIGO = C.AGN_IN_CODIGO
           AND I.AGN_TAU_ST_CODIGO = 'N' AND NVL(I.AGN_CH_STATUS, 'A') = 'A' AND ROWNUM = 1;
    EXCEPTION WHEN NO_DATA_FOUND THEN RAISE_APPLICATION_ERROR(-20130, 'Conta financeira ' || W_CTA || ' nao encontrada ou inativa no Mega.');
    END;
    -- empresa = organizacao-mae da filial
    BEGIN
        SELECT O.PAI_ORG_IN_CODIGO INTO W_ORG FROM MEGA.GLO_VW_ORGANIZACAO O
         WHERE O.ORG_TAB_IN_CODIGO = C_TAB AND O.ORG_PAD_IN_CODIGO = C_PAD AND O.ORG_IN_CODIGO = E.FIL_IN_CODIGO AND ROWNUM = 1;
    EXCEPTION WHEN NO_DATA_FOUND THEN RAISE_APPLICATION_ERROR(-20130, 'Filial ' || E.FIL_IN_CODIGO || ' nao encontrada no Mega.');
    END;
    IF W_ORG IS NULL THEN RAISE_APPLICATION_ERROR(-20130, 'Filial ' || E.FIL_IN_CODIGO || ' sem empresa no Mega.'); END IF;
    -- uma efetivacao por filial de cada vez (trava nos estabelecimentos da filial)
    BEGIN
        FOR T IN (SELECT ESTAB_ST_NUMERO FROM MEGA.CCS_TB_GFIN_CBC_ESTAB WHERE FIL_IN_CODIGO = E.FIL_IN_CODIGO FOR UPDATE NOWAIT) LOOP NULL; END LOOP;
    EXCEPTION WHEN E_OCUPADO THEN RAISE_APPLICATION_ERROR(-20130, 'Outra efetivacao ou importacao desta filial esta em andamento. Tente de novo em alguns segundos.');
    END;

    FOR L IN (SELECT L.*, A.ARQ_ST_NOME, A.ARQ_DT_EMISSAO
                FROM MEGA.CCS_TB_GFIN_CBC_LINHA L, MEGA.CCS_TB_GFIN_CBC_ARQUIVO A
               WHERE L.FIL_IN_CODIGO = E.FIL_IN_CODIGO AND L.LIN_CH_SITUACAO = 'I' AND L.CBA_IN_SEQUENCIA IS NULL
                 AND L.LIN_CH_ABA IN ('P', 'D', 'A', 'C') AND L.LIN_DT_DATA < TRUNC(SYSDATE)
                 AND A.ARQ_IN_CODIGO = L.ARQ_IN_CODIGO AND A.ARQ_CH_TIPO = 'R' AND A.ARQ_CH_STATUS = 'I'
               ORDER BY L.LIN_DT_DATA, L.ARQ_IN_CODIGO, L.LIN_IN_ORDEM) LOOP
        W_MOD := CASE WHEN UPPER(L.LIN_ST_MODALIDADE) LIKE 'CRED%' THEN 'CRED' WHEN UPPER(L.LIN_ST_MODALIDADE) LIKE 'DEB%' THEN 'DEB' ELSE 'PIX' END;
        IF L.LIN_CH_ABA = 'P' THEN
            W_NAT := 'C'; W_VAL := NVL(L.LIN_RE_LIQUIDO, NVL(L.LIN_RE_BRUTO, 0) - NVL(L.LIN_RE_MDR, 0));
            W_TPD := CASE W_MOD WHEN 'CRED' THEN 'CARCRED' WHEN 'DEB' THEN 'CARDEB' ELSE 'PIX' END;
            W_HIST := 'REDE ' || UPPER(L.LIN_ST_BANDEIRA) || ' ' || W_MOD || ' ' || NVL(L.LIN_IN_PARCELA, 1) || '/' || NVL(L.LIN_IN_PARCELAS, 1) || ' NSU ' || L.LIN_ST_NSU;
            W_DOC := L.LIN_ST_NSU;
        ELSIF L.LIN_CH_ABA = 'D' THEN
            W_NAT := 'D'; W_VAL := NVL(L.LIN_RE_BRUTO, 0); W_TPD := 'TRANSFD';
            W_HIST := 'REDE DEPOSITO ' || UPPER(L.LIN_ST_BANDEIRA) || ' ' || UPPER(L.LIN_ST_MODALIDADE) || ' BCO ' || L.LIN_ST_BANCO;
            W_DOC := NULL;
        ELSIF L.LIN_CH_ABA = 'A' THEN
            W_NAT := 'D'; W_VAL := NVL(L.LIN_RE_LIQUIDO, NVL(L.LIN_RE_BRUTO, 0)); W_TPD := 'TARBANC';
            W_HIST := 'REDE AJUSTE ' || UPPER(L.LIN_ST_DESCRICAO);
            W_DOC := L.LIN_ST_NSU;
        ELSE
            W_NAT := 'D'; W_VAL := NVL(L.LIN_RE_LIQUIDO, NVL(L.LIN_RE_BRUTO, 0));
            W_TPD := CASE W_MOD WHEN 'CRED' THEN 'CARCRED' WHEN 'DEB' THEN 'CARDEB' ELSE 'PIX' END;
            W_HIST := 'REDE CANCEL ' || UPPER(L.LIN_ST_BANDEIRA) || ' ' || UPPER(L.LIN_ST_STATUS) || ' NSU ' || L.LIN_ST_NSU;
            W_DOC := L.LIN_ST_NSU;
        END IF;
        IF NVL(W_VAL, 0) <= 0 THEN
            UPDATE MEGA.CCS_TB_GFIN_CBC_LINHA SET LIN_ST_MOTIVO = 'Nao efetivada: valor zero' WHERE ARQ_IN_CODIGO = L.ARQ_IN_CODIGO AND LIN_IN_ORDEM = L.LIN_IN_ORDEM;
            W_PUL := W_PUL + 1;
        ELSE
            BEGIN
                SELECT D.TPDB_ST_CODIGO INTO W_TPDB FROM MEGA.FIN_TIPODOCTOBANCO D WHERE D.BAN_IN_NUMERO = W_BAN AND D.TPD_ST_CODIGO = W_TPD AND ROWNUM = 1;
            EXCEPTION WHEN NO_DATA_FOUND THEN RAISE_APPLICATION_ERROR(-20130, 'Tipo ' || W_TPD || ' sem de-para no banco ' || W_BAN || ' (Financeiro > Tipos de documento x banco).');
            END;
            W_CBA := MEGA.PCK_MEGA.PROXIMASEQUENCIATAB(358);
            IF NVL(W_CBA, 0) = 0 THEN RAISE_APPLICATION_ERROR(-20130, 'Falha na numeracao do extrato do Mega (tabela 358).'); END IF;
            W_HIST := SUBSTR(W_HIST, 1, 50);   -- ja vem em ASCII (a API grava sem acento); a faixa '[^ -~]' dava ORA-12728 pelo gateway
            W_DOC := SUBSTR(W_DOC, 1, 20);
            INSERT INTO MEGA.FIN_CONCILIACAO
              (CBA_IN_SEQUENCIA, TPD_ST_CODIGO, TPDB_ST_CODIGO, BAN_IN_NUMERO,
               ORG_TAB_IN_CODIGO, ORG_PAD_IN_CODIGO, ORG_IN_CODIGO, ORG_TAU_ST_CODIGO, FIL_IN_CODIGO,
               AGN_TAB_IN_CODIGO, AGN_PAD_IN_CODIGO, AGN_IN_CODIGO, AGN_TAU_ST_CODIGO,
               CBA_DT_DATA, CBA_CH_NATUREZA, CBA_RE_VALOR, CBA_CH_TIPO, CBA_CH_STATUS,
               CBA_ST_HISTORICO, CBA_ST_DOCUMENTO, CBA_CH_SONUMEROS, CBA_DT_IMPORTACAO, CBA_DT_DATAARQUIVO, CBA_ST_NOMEARQUIVO)
            VALUES
              (W_CBA, W_TPD, W_TPDB, W_BAN,
               C_TAB, C_PAD, W_ORG, 'G', E.FIL_IN_CODIGO,
               C_TAB, W_PAD, W_CTA, 'N',
               L.LIN_DT_DATA, W_NAT, ROUND(W_VAL, 2), 'I', 'N',
               W_HIST, W_DOC, CASE WHEN REGEXP_LIKE(TRIM(W_DOC), '^[0-9]*$') OR TRIM(W_DOC) IS NULL THEN 'S' ELSE 'N' END,
               SYSDATE, NVL(L.ARQ_DT_EMISSAO, SYSDATE), SUBSTR(L.ARQ_ST_NOME, 1, 228));
            UPDATE MEGA.CCS_TB_GFIN_CBC_LINHA SET CBA_IN_SEQUENCIA = W_CBA, EFE_IN_CODIGO = P_EFE, LIN_ST_MOTIVO = NULL
             WHERE ARQ_IN_CODIGO = L.ARQ_IN_CODIGO AND LIN_IN_ORDEM = L.LIN_IN_ORDEM;
            W_QT := W_QT + 1;
            IF W_NAT = 'C' THEN W_CRED := W_CRED + W_VAL; ELSE W_DEB := W_DEB + W_VAL; END IF;
            IF W_DI IS NULL OR L.LIN_DT_DATA < W_DI THEN W_DI := L.LIN_DT_DATA; END IF;
            IF W_DF IS NULL OR L.LIN_DT_DATA > W_DF THEN W_DF := L.LIN_DT_DATA; END IF;
        END IF;
    END LOOP;
    IF W_QT = 0 THEN RAISE_APPLICATION_ERROR(-20130, 'Nada a efetivar nesta filial: nenhuma linha importada do relatorio de recebimentos com data anterior a hoje e ainda sem lancamento.'); END IF;
    UPDATE MEGA.CCS_TB_GFIN_CBC_EFETIVA SET ORG_IN_CODIGO = W_ORG, EFE_DT_INI = W_DI, EFE_DT_FIM = W_DF, EFE_IN_QT_LINHAS = W_QT, EFE_IN_QT_PULADAS = W_PUL,
           EFE_RE_CREDITOS = ROUND(W_CRED, 2), EFE_RE_DEBITOS = ROUND(W_DEB, 2)
     WHERE EFE_IN_CODIGO = P_EFE;
END CCS_P_GFIN_CBC_EFETIVA_X;
/
CREATE OR REPLACE PROCEDURE MEGA.CCS_P_GFIN_CBC_EFETIVA (
    P_EFE     IN NUMBER,
    P_SIMULAR IN VARCHAR2 DEFAULT 'N'
) IS
    /* [18/11/2026 - Alexandre Carvalho] WRAPPER: tudo ou nada. Simular = roda inteiro e desfaz (efetivacao continua P com a mensagem).
       Situacao: P pendente | E efetivado | X recusado. Cada simulacao consome numeros da tabela 358 (funcao autonoma do Mega). */
    W_ST CHAR(1); W_MSG VARCHAR2(1500); W_QT NUMBER; W_PUL NUMBER; W_C NUMBER; W_D NUMBER;
BEGIN
    SAVEPOINT SP_GFIN_CBC_EFE;
    BEGIN
        MEGA.CCS_P_GFIN_CBC_EFETIVA_X(P_EFE);
        SELECT EFE_IN_QT_LINHAS, EFE_IN_QT_PULADAS, EFE_RE_CREDITOS, EFE_RE_DEBITOS INTO W_QT, W_PUL, W_C, W_D FROM MEGA.CCS_TB_GFIN_CBC_EFETIVA WHERE EFE_IN_CODIGO = P_EFE;
        IF NVL(P_SIMULAR, 'N') = 'S' THEN
            ROLLBACK TO SP_GFIN_CBC_EFE; W_ST := 'P';
            W_MSG := 'Validacao sem erro: ' || W_QT || ' linha(s) seriam lancadas na FIN_CONCILIACAO (creditos ' || TO_CHAR(W_C, 'FM999G999G990D00') || ', debitos ' ||
                     TO_CHAR(W_D, 'FM999G999G990D00') || ')' || CASE WHEN W_PUL > 0 THEN '; ' || W_PUL || ' com valor zero ficam de fora' END || '. Nada foi gravado.';
        ELSE
            W_ST := 'E';
            W_MSG := W_QT || ' linha(s) lancada(s) na FIN_CONCILIACAO (creditos ' || TO_CHAR(W_C, 'FM999G999G990D00') || ', debitos ' || TO_CHAR(W_D, 'FM999G999G990D00') || ')' ||
                     CASE WHEN W_PUL > 0 THEN '; ' || W_PUL || ' com valor zero ficaram de fora' END || '.';
        END IF;
    EXCEPTION
        WHEN OTHERS THEN
            W_MSG := SUBSTR(REGEXP_REPLACE(SQLERRM, '^ORA-20130: ', ''), 1, 1500);
            ROLLBACK TO SP_GFIN_CBC_EFE; W_ST := 'X';
    END;
    UPDATE MEGA.CCS_TB_GFIN_CBC_EFETIVA SET EFE_CH_STATUS = W_ST, EFE_ST_MENSAGEM = W_MSG, EFE_DT_PROCESSADO = SYSDATE WHERE EFE_IN_CODIGO = P_EFE;
    COMMIT;
END CCS_P_GFIN_CBC_EFETIVA;
/
