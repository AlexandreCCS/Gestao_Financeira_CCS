/* =====================================================================================================================
   [26/11/2026 - Alexandre Carvalho] GESTOR FINANCEIRO - BAIXAR E CONCILIAR (QUALITY): CHEQUE DEVOLVIDO v2 - O DEPOSITO.
   Processo (planilha do Alexandre, 26/11):
     1) linha "DEP CHEQUE ATM N. <n>" x 2) baixa dos titulos pelo Gestor no deposito (org 10), conciliados  -> JA EXISTIA;
     3) linha CHRD x 4) 971 conciliada (decisao: "a 977 pode usar a 971 mesmo")                              -> JA EXISTIA (sql/38);
     5) reabrir TODOS os titulos pagos com o cheque, em todas as filiais:
        a) parcelas do cadastro de cheques (org 20/30)                                                        -> JA EXISTIA (sql/38);
        b) titulos baixados no deposito: estorna a baixa do Gestor do deposito (libera a linha DEP CHEQUE)     -> NOVO;
     6) 978 "Cheque Depositado" com a data do deposito, conciliada com a linha DEP CHEQUE                    -> NOVO.
   Parcela do cadastro de cheques com COMISSAO JA PAGA (ORA-20922 do CUS_T_ESTORNA_COMISSAO_MOV): pula so ela e avisa (opcao 2, 26/11).
   Baixa do deposito JA CONTABILIZADA (ou feita fora do Gestor): nao estorna; faz o resto e avisa "estornar pelo Mega" (decisao (a)).
   Pegada da 978 (teste manual 26/11, ORG 10 / ACAOM 98806069): CHR nat D na conta (MVFIN 0, rateio 9/2) + CREDITO AVISTA no agente
   1000 tau C (MVFIN 0, classe 1/840 RECEITA DE CHEQUES DEPOSITADOS A COMPENSAR, CC 1/195, projeto 9/2) = pegada do 711 do REAL_X.
   CHAVE: BXC_CHD_DEP = 0 desligado (comportamento de 03/11) | 1 todas as devolucoes | N > 1 so a linha CHRD de CBA = N (validacao).
   O de-para 978 fica INATIVO (senao o motor sugeriria 978 para toda linha DEP CHEQUE no lugar da baixa): o CHDEV_X liga so dentro
   da transacao e desliga em seguida.
   Pre-requisitos: sql/31 com o REAL_X aceitando 978 (26/11), sql/37, sql/38. SO ASCII. Blocos separados por "/".
   Diagnostico: agenda_23_11_a_29_11/mm48a_42..51.
   ===================================================================================================================== */
MERGE INTO MEGA.CCS_TB_GFIN_BXC_CONT C USING (
  SELECT 978 ACAO, '-' TREF, 'MVFIN' TAC, 0 SEQ, 'cheque depositado (cheque devolvido v2): mov da conta (CHR) [26/11/2026]' OBS FROM DUAL UNION ALL
  SELECT 978, 'AVISTA', 'MVFIN', 0, 'cheque depositado (cheque devolvido v2): contraparte a vista [26/11/2026]' FROM DUAL
) X ON (C.ACAO_IN_CODIGO = X.ACAO AND C.TREF_ST_CODIGO = X.TREF)
WHEN NOT MATCHED THEN INSERT (ACAO_IN_CODIGO, TREF_ST_CODIGO, CONT_TAC_ST_CODIGO, CONT_CON_IN_SEQUENCIA, CONT_ST_OBS) VALUES (X.ACAO, X.TREF, X.TAC, X.SEQ, X.OBS)
/
MERGE INTO MEGA.CCS_TB_GFIN_BXC_DEPARA D USING (SELECT 'AVCRED' TPD, 978 ACAO FROM DUAL) X
ON (D.TPD_ST_CODIGO = X.TPD AND D.ACAO_IN_CODIGO = X.ACAO)
WHEN NOT MATCHED THEN INSERT (DEP_IN_CODIGO, TPD_ST_CODIGO, DEP_ST_HIST_LIKE, DEP_CH_NATUREZA, ACAO_IN_CODIGO, AGN_IN_CODIGO, TPD_FIN_ST_CODIGO, CLA_IDE_ST_CODIGO, CLA_IN_REDUZIDO,
    CCF_IDE_ST_CODIGO, CCF_IN_REDUZIDO, PRO_IDE_ST_CODIGO, PRO_IN_REDUZIDO, DEP_ST_HISTORICO, DEP_CH_AUTO, DEP_CH_ATIVO, DEP_DT_ALTERACAO, DEP_ST_USU, DEP_CH_MODO)
  VALUES (MEGA.CCS_SEQ_GFIN_BXC_DEPARA.NEXTVAL, 'AVCRED', 'DEP CH', 'C', 978, 1000, 'CHR', '1', 840, '1', 195, '9', 2,
    'USO INTERNO DO CHEQUE DEVOLVIDO (978) - NAO ATIVAR', 'N', 'N', SYSDATE, 'CCS 26/11/2026', 'A')
/
MERGE INTO MEGA.CCS_TB_GFIN_PARAM P USING (SELECT 'BXC_CHD_DEP' K FROM DUAL) X ON (P.PARAM_ST_CHAVE = X.K)
WHEN NOT MATCHED THEN INSERT (PARAM_ST_CHAVE, PARAM_RE_VALOR, PARAM_ST_DESCRICAO, PARAM_DT_ALTERACAO, PARAM_ST_USU)
  VALUES ('BXC_CHD_DEP', 0, 'Cheque devolvido v2 (estorna a baixa do deposito + 978): 0 desligado, 1 todas, N = so a linha CHRD de CBA N', SYSDATE, 'CCS 26/11/2026')
/
ALTER TABLE MEGA.CCS_TB_GFIN_BXC_CHDEV ADD (
    CHD_IN_CBA_DEP     NUMBER,
    CHD_IN_LOG_DEP     NUMBER,
    CHD_CH_DEP_EST     CHAR(1),
    CHD_IN_LOG_978     NUMBER,
    CHD_ST_DEP_MSG     VARCHAR2(500),
    CHD_ST_PULADAS     VARCHAR2(1000)
)
/
CREATE OR REPLACE PROCEDURE MEGA.CCS_P_GFIN_BXC_CHDEV_X (
    P_LOG IN NUMBER,
    P_CBA IN NUMBER,
    P_CUS IN NUMBER,
    P_USU IN NUMBER
) IS
    /* [03/11/2026 - Alexandre Carvalho] PARTE DO CHEQUE (a 971 ja foi lancada e conciliada pelo REAL_X na mesma transacao). NAO COMITA.
       Reabre as parcelas baixadas pelo cheque (so baixa 706 intacta: DOCTEDP + CREDITO BXCRE, nao contabilizada, nao conciliada, sem
       referencia de fora), marca o cheque D, enfileira o WhatsApp e grava CCS_TB_GFIN_BXC_CHDEV.
       [26/11/2026 - Alexandre Carvalho] + O DEPOSITO (sql/44, chave BXC_CHD_DEP): acha a linha DEP CHEQUE do cheque, estorna a baixa do
       Gestor feita nela (reabre os titulos da org 10) e lanca a 978 com a data do deposito conciliada com a linha. */
    C_ORG_TAB CONSTANT NUMBER := 53; C_ORG_PAD CONSTANT NUMBER := 1; C_ORG_TAU CONSTANT VARCHAR2(3) := 'G'; C_MOV_TAB CONSTANT NUMBER := 352;
    C_RX CONSTANT VARCHAR2(60) := 'DEV CH (NAC|DEP) ([0-9]{3}) ([0-9]+) ([0-9]+)';
    B MEGA.FIN_CONCILIACAO%ROWTYPE;
    CH MEGA.CUS_FIN_CHEQUESCRE%ROWTYPE;
    W_BAN VARCHAR2(3); W_NUM VARCHAR2(20); W_ALI VARCHAR2(5); W_NOME VARCHAR2(100);
    W_DESDE DATE; W_JANELA NUMBER; W_REABRE NUMBER; W_MARCA NUMBER; W_WHATS NUMBER; W_LISTA NUMBER; W_CHDEP NUMBER;
    W_N NUMBER; W_NREAB NUMBER := 0; W_VREAB NUMBER := 0; W_ACAOMS VARCHAR2(2000); W_TITS VARCHAR2(2000); W_ZAP NUMBER; W_MSG VARCHAR2(4000); W_SALDO NUMBER;
    /* [26/11/2026] deposito */
    W_PUL VARCHAR2(1000); W_DEP_CBA NUMBER; W_DEP_LOG NUMBER; W_DEP_EST CHAR(1); W_LOG978 NUMBER; W_DEPMSG VARCHAR2(500); W_DEPTITS VARCHAR2(1000);
    E_OCUPADO EXCEPTION; PRAGMA EXCEPTION_INIT(E_OCUPADO, -54);
    FUNCTION PAR(P_K VARCHAR2, P_DEF NUMBER) RETURN NUMBER IS V NUMBER;
    BEGIN SELECT MAX(PARAM_RE_VALOR) INTO V FROM MEGA.CCS_TB_GFIN_PARAM WHERE PARAM_ST_CHAVE = P_K; RETURN NVL(V, P_DEF); END;
    FUNCTION VAL(P_V NUMBER) RETURN VARCHAR2 IS BEGIN RETURN TO_CHAR(P_V, 'FM999G999G990D00', 'NLS_NUMERIC_CHARACTERS='',.'''); END;
    PROCEDURE DESATUALIZA(R MEGA.FIN_MOVIMENTO%ROWTYPE) IS
    BEGIN
        FIN_PCK_MOVIMENTO.REFAZENDOFIN := 'S'; FIN_PCK_MOVIMENTO.REFAZENDOORC := 'N'; FIN_PCK_MOVIMENTO.ORCREFAZ := 0;
        FIN_PCK_MOVIMENTO.P_DESATUALIZAMOVIMENTO(
            PMOV_DT_DATADOCTO => R.MOV_DT_DATADOCTO, PMOV_DT_ENTRADA => R.MOV_DT_ENTRADA, PMOV_DT_VENCTO => R.MOV_DT_VENCTO,
            PMOV_DT_PRORROGADO => R.MOV_DT_PRORROGADO, PMOV_DT_ORCAMENTO => R.MOV_DT_ORCAMENTO,
            PMOV_TAB_IN_CODIGO => R.MOV_TAB_IN_CODIGO, PMOV_SEQ_IN_CODIGO => R.MOV_SEQ_IN_CODIGO, PMOV_IN_NUMLANCTO => R.MOV_IN_NUMLANCTO,
            PBAN_IN_NUMERO => 0, PIND_IN_CODIGOMOE => 0, PORG_IN_CODIGO => R.ORG_IN_CODIGO, PFIL_IN_CODIGO => R.FIL_IN_CODIGO,
            PAGN_TAB_IN_CODIGO => R.AGN_TAB_IN_CODIGO, PAGN_PAD_IN_CODIGO => R.AGN_PAD_IN_CODIGO, PAGN_IN_CODIGO => R.AGN_IN_CODIGO,
            PAGN_TAU_ST_CODIGO => R.AGN_TAU_ST_CODIGO, PMOV_BO_PREVISAO => 'N', PTREF_ST_CODIGO => R.TREF_ST_CODIGO,
            PMOV_CH_ORIGEM => R.MOV_CH_ORIGEM, PMOV_CH_NATUREZA => R.MOV_CH_NATUREZA,
            PMOV_RE_VALOR => R.MOV_RE_VALOR, PMOV_RE_VALORMOE => R.MOV_RE_VALORMOE,
            PUPDATEKIND => 'D', PMOV_CH_SITUACAO => R.MOV_CH_SITUACAO, PUSU_IN_ALTERACAO => P_USU,
            PACAOM_IN_SEQUENCIA => R.ACAOM_IN_SEQUENCIA, PMARCAPARACONTABILIZAR => 'N');
    END;
BEGIN
    W_DESDE := TO_DATE(TO_CHAR(PAR('BXC_CHD_DESDE', 20261023)), 'YYYYMMDD');
    W_JANELA := PAR('BXC_CHD_JANELA', 90); W_REABRE := PAR('BXC_CHD_REABRE', 1); W_MARCA := PAR('BXC_CHD_MARCA', 1);
    W_WHATS := PAR('BXC_CHD_WHATS', 0); W_LISTA := PAR('BXC_CHD_ZAP_LISTA', 11); W_CHDEP := PAR('BXC_CHD_DEP', 0);

    /* a linha e o cheque */
    SELECT X.* INTO B FROM MEGA.FIN_CONCILIACAO X WHERE X.CBA_IN_SEQUENCIA = P_CBA;
    IF NVL(B.TPD_ST_CODIGO, '-') <> 'CHRD' OR B.CBA_CH_NATUREZA <> 'D' THEN RAISE_APPLICATION_ERROR(-20100, 'A linha do extrato nao e uma devolucao de cheque (CHRD).'); END IF;
    IF TRUNC(B.CBA_DT_DATA) < W_DESDE THEN RAISE_APPLICATION_ERROR(-20100, 'Devolucao anterior a ' || TO_CHAR(W_DESDE, 'DD/MM/YYYY') || ': fica como esta (BXC_CHD_DESDE).'); END IF;
    W_BAN := REGEXP_SUBSTR(B.CBA_ST_HISTORICO, C_RX, 1, 1, NULL, 2); W_NUM := REGEXP_SUBSTR(B.CBA_ST_HISTORICO, C_RX, 1, 1, NULL, 3); W_ALI := REGEXP_SUBSTR(B.CBA_ST_HISTORICO, C_RX, 1, 1, NULL, 4);
    IF W_BAN IS NULL THEN RAISE_APPLICATION_ERROR(-20100, 'Historico da linha fora do padrao DEV CH NAC <banco> <cheque> <alinea>.'); END IF;
    SELECT COUNT(*) INTO W_N FROM MEGA.CUS_FIN_CHEQUESCRE C
     WHERE LPAD(C.BAN_IN_NUMERO, 3, '0') = W_BAN AND LTRIM(C.CHEQR_IN_NUMEROCHEQUE, '0') = LTRIM(W_NUM, '0') AND ABS(C.CHEQR_RE_VALOR - B.CBA_RE_VALOR) < 0.005;
    IF W_N <> 1 THEN RAISE_APPLICATION_ERROR(-20100, W_N || ' cheque(s) com banco ' || W_BAN || ', numero ' || W_NUM || ' e valor da linha: trate pelo Mega.'); END IF;
    BEGIN
        SELECT C.* INTO CH FROM MEGA.CUS_FIN_CHEQUESCRE C WHERE C.CUS_IN_SEQUENCIA = P_CUS FOR UPDATE NOWAIT;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN RAISE_APPLICATION_ERROR(-20100, 'Cheque ' || P_CUS || ' nao existe.');
        WHEN E_OCUPADO THEN RAISE_APPLICATION_ERROR(-20100, 'Cheque ' || P_CUS || ' em uso por outro usuario no Mega.');
    END;
    IF LPAD(CH.BAN_IN_NUMERO, 3, '0') <> W_BAN OR LTRIM(CH.CHEQR_IN_NUMEROCHEQUE, '0') <> LTRIM(W_NUM, '0') OR ABS(CH.CHEQR_RE_VALOR - B.CBA_RE_VALOR) >= 0.005 THEN
        RAISE_APPLICATION_ERROR(-20100, 'O cheque ' || P_CUS || ' nao e o da linha (banco, numero ou valor diferente).');
    END IF;
    IF CH.CHEQR_DT_DATAPRE IS NOT NULL AND TRUNC(B.CBA_DT_DATA) - TRUNC(CH.CHEQR_DT_DATAPRE) > W_JANELA THEN
        RAISE_APPLICATION_ERROR(-20100, 'Devolucao ' || (TRUNC(B.CBA_DT_DATA) - TRUNC(CH.CHEQR_DT_DATAPRE)) || ' dias apos o bom para (limite ' || W_JANELA || ').');
    END IF;
    SELECT COUNT(*) INTO W_N FROM MEGA.CCS_TB_GFIN_BXC_CHDEV D, MEGA.CCS_TB_GFIN_BXC_LOG L
     WHERE D.CBA_IN_SEQUENCIA = P_CBA AND D.CHD_CH_DESFEITO = 'N' AND L.LOG_IN_CODIGO = D.LOG_IN_CODIGO AND L.LOG_CH_STATUS = 'B';
    IF W_N > 0 THEN RAISE_APPLICATION_ERROR(-20100, 'Esta devolucao ja foi tratada pelo Gestor.'); END IF;
    SELECT SUBSTR(MAX(A.AGN_ST_NOME), 1, 60) INTO W_NOME FROM MEGA.GLO_AGENTES A WHERE A.AGN_TAB_IN_CODIGO = C_ORG_TAB AND A.AGN_IN_CODIGO = CH.AGN_IN_CODIGO;

    /* 1) REABRE as parcelas: cada baixa a receber do cheque ainda nao estornada */
    IF W_REABRE = 1 THEN
        FIN_PCK_MOVIMENTO.COMP_ST_NOME := 'MEGA'; FIN_PCK_MOVIMENTO.USU_IN_CODIGO := P_USU;
        FOR O IN (SELECT X.* FROM MEGA.CUS_FIN_CHEQUESCRE_OCO X
                   WHERE X.CUS_IN_SEQUENCIA = P_CUS AND UPPER(X.CUSO_ST_TPCONTA) = 'RECEBER' AND X.CUSO_ST_OCORRENCIA LIKE 'BAIXA%' AND X.MOV_IN_NUMLANCTO_REF IS NOT NULL
                     AND NOT EXISTS (SELECT 1 FROM MEGA.CUS_FIN_CHEQUESCRE_OCO E WHERE E.CUS_IN_SEQUENCIA = X.CUS_IN_SEQUENCIA AND E.CUSO_ST_OCORRENCIA LIKE 'ESTORNO%'
                                        AND E.MOV_IN_NUMLANCTO_REF = X.MOV_IN_NUMLANCTO_REF)
                   ORDER BY X.CUSO_IN_CODIGO) LOOP
            DECLARE
                BX MEGA.FIN_MOVIMENTO%ROWTYPE; TT MEGA.FIN_MOVIMENTO%ROWTYPE; W_LISTA_MOV VARCHAR2(400);
            BEGIN
                /* [26/11/2026] comissao da baixa ja fechada/paga (trigger CUS_T_ESTORNA_COMISSAO_MOV, ORA-20922): pula SO esta parcela, avisa e segue
                   (decisao do Alexandre, opcao 2). Qualquer outro erro continua derrubando a operacao inteira. */
                SAVEPOINT SP_CHDEV_PARC;
                BEGIN
                    SELECT M.* INTO BX FROM MEGA.FIN_MOVIMENTO M
                     WHERE M.ORG_TAB_IN_CODIGO = C_ORG_TAB AND M.ORG_PAD_IN_CODIGO = C_ORG_PAD AND M.ORG_IN_CODIGO = O.ORG_IN_CODIGO AND M.ORG_TAU_ST_CODIGO = C_ORG_TAU
                       AND M.MOV_TAB_IN_CODIGO = C_MOV_TAB AND M.MOV_IN_NUMLANCTO = O.MOV_IN_NUMLANCTO_REF AND M.CONT_TAC_ST_CODIGO = 'MVCRE' AND M.TREF_ST_CODIGO = 'BXCRE'
                       AND M.MOV_ST_COMPLHIST LIKE '%NUMERO DO CHEQUE:%';
                EXCEPTION WHEN NO_DATA_FOUND THEN RAISE_APPLICATION_ERROR(-20100, 'Baixa ' || O.MOV_IN_NUMLANCTO_REF || ' do cheque nao encontrada no Mega: trate pelo Mega.');
                END;
                SELECT COUNT(*) INTO W_N FROM MEGA.CON_LANCAMENTO C WHERE C.ACAOM_ORG_IN_CODIGO = BX.ORG_IN_CODIGO AND C.ACAOM_IN_SEQUENCIA = BX.ACAOM_IN_SEQUENCIA;
                IF W_N > 0 THEN RAISE_APPLICATION_ERROR(-20100, 'A baixa do cheque (acao-mov ' || BX.ACAOM_IN_SEQUENCIA || ') ja foi contabilizada: estorne pelo Mega.'); END IF;
                SELECT COUNT(*) INTO W_N FROM MEGA.FIN_MOVIMENTO M WHERE M.ORG_IN_CODIGO = BX.ORG_IN_CODIGO AND M.ACAOM_IN_SEQUENCIA = BX.ACAOM_IN_SEQUENCIA
                   AND NOT ((M.TPD_ST_CODIGO = 'DOCTEDP' AND M.TREF_ST_CODIGO IS NULL) OR (M.TPD_ST_CODIGO = 'CREDITO' AND M.TREF_ST_CODIGO = 'BXCRE'));
                IF W_N > 0 THEN RAISE_APPLICATION_ERROR(-20100, 'A baixa do cheque (acao-mov ' || BX.ACAOM_IN_SEQUENCIA || ') tem juros, desconto ou outro movimento: estorne pelo Mega.'); END IF;
                SELECT COUNT(*), SUM(CASE WHEN M.MOV_CH_CONCILIADO = 'S' OR M.CON_IN_SEQUENCIAL IS NOT NULL THEN 1 ELSE 0 END) INTO W_N, W_SALDO FROM MEGA.FIN_MOVIMENTO M
                 WHERE M.ORG_IN_CODIGO = BX.ORG_IN_CODIGO AND M.ACAOM_IN_SEQUENCIA = BX.ACAOM_IN_SEQUENCIA;
                IF W_N <> 2 THEN RAISE_APPLICATION_ERROR(-20100, 'A baixa do cheque (acao-mov ' || BX.ACAOM_IN_SEQUENCIA || ') tem ' || W_N || ' movimentos (esperado 2): estorne pelo Mega.'); END IF;
                IF W_SALDO > 0 THEN RAISE_APPLICATION_ERROR(-20100, 'A baixa do cheque (acao-mov ' || BX.ACAOM_IN_SEQUENCIA || ') esta conciliada: desconcilie pelo Mega.'); END IF;
                SELECT LISTAGG(M.MOV_IN_NUMLANCTO, ',') WITHIN GROUP (ORDER BY M.MOV_IN_NUMLANCTO) INTO W_LISTA_MOV FROM MEGA.FIN_MOVIMENTO M
                 WHERE M.ORG_IN_CODIGO = BX.ORG_IN_CODIGO AND M.ACAOM_IN_SEQUENCIA = BX.ACAOM_IN_SEQUENCIA;
                /* nada de fora aponta para a baixa, salvo a referencia ao proprio titulo */
                SELECT COUNT(*) INTO W_N FROM MEGA.FIN_REFERENCIAFIN R
                 WHERE R.ORG_IN_CODIGO = BX.ORG_IN_CODIGO AND R.MOV_TAB_IN_CODIGO = C_MOV_TAB AND INSTR(',' || W_LISTA_MOV || ',', ',' || R.MOV_IN_NUMLANCTO || ',') = 0
                   AND (INSTR(',' || W_LISTA_MOV || ',', ',' || R.REF_MOV_IN_NUMLANCTO || ',') > 0 OR INSTR(',' || W_LISTA_MOV || ',', ',' || R.ORI_MOV_IN_NUMLANCTO || ',') > 0);
                IF W_N > 0 THEN RAISE_APPLICATION_ERROR(-20100, 'Ha outros lancamentos ligados a baixa do cheque (acao-mov ' || BX.ACAOM_IN_SEQUENCIA || '): estorne pelo Mega.'); END IF;
                /* o titulo */
                BEGIN
                    SELECT M.* INTO TT FROM MEGA.FIN_MOVIMENTO M
                     WHERE M.ORG_TAB_IN_CODIGO = C_ORG_TAB AND M.ORG_PAD_IN_CODIGO = C_ORG_PAD AND M.ORG_IN_CODIGO = O.ORG_IN_CODIGO AND M.ORG_TAU_ST_CODIGO = C_ORG_TAU
                       AND M.MOV_TAB_IN_CODIGO = C_MOV_TAB AND M.MOV_IN_NUMLANCTO = O.MOV_IN_NUMLANCTO
                       AND EXISTS (SELECT 1 FROM MEGA.FIN_REFERENCIAFIN R WHERE R.ORG_IN_CODIGO = BX.ORG_IN_CODIGO AND R.MOV_IN_NUMLANCTO = BX.MOV_IN_NUMLANCTO AND R.REF_ST_TIPO = 'BXCRE'
                                      AND R.REF_MOV_SEQ_IN_CODIGO = M.MOV_SEQ_IN_CODIGO AND R.REF_MOV_IN_NUMLANCTO = M.MOV_IN_NUMLANCTO)
                       FOR UPDATE NOWAIT;
                EXCEPTION
                    WHEN NO_DATA_FOUND THEN RAISE_APPLICATION_ERROR(-20100, 'Titulo ' || O.MOV_IN_NUMLANCTO || ' da baixa do cheque nao encontrado: trate pelo Mega.');
                    WHEN E_OCUPADO THEN RAISE_APPLICATION_ERROR(-20100, 'Titulo ' || O.MOV_IN_NUMLANCTO || ' em uso por outro usuario no Mega.');
                END;
                /* desatualiza e apaga os 2 movimentos da baixa (ordem inversa da criacao) e a acao-movimento */
                FOR M IN (SELECT X.* FROM MEGA.FIN_MOVIMENTO X WHERE X.ORG_IN_CODIGO = BX.ORG_IN_CODIGO AND X.ACAOM_IN_SEQUENCIA = BX.ACAOM_IN_SEQUENCIA
                           ORDER BY X.MOV_IN_NUMLANCTO DESC FOR UPDATE NOWAIT) LOOP
                    DESATUALIZA(M);
                END LOOP;
                FOR M IN (SELECT X.MOV_SEQ_IN_CODIGO S, X.MOV_IN_NUMLANCTO L FROM MEGA.FIN_MOVIMENTO X WHERE X.ORG_IN_CODIGO = BX.ORG_IN_CODIGO AND X.ACAOM_IN_SEQUENCIA = BX.ACAOM_IN_SEQUENCIA
                           ORDER BY X.MOV_IN_NUMLANCTO DESC) LOOP
                    DELETE FROM MEGA.FIN_REFERENCIAFIN WHERE ORG_IN_CODIGO = BX.ORG_IN_CODIGO AND MOV_TAB_IN_CODIGO = C_MOV_TAB AND MOV_SEQ_IN_CODIGO = M.S AND MOV_IN_NUMLANCTO = M.L;
                    DELETE FROM MEGA.FIN_LANCPROJ WHERE ORG_IN_CODIGO = BX.ORG_IN_CODIGO AND MOV_TAB_IN_CODIGO = C_MOV_TAB AND MOV_SEQ_IN_CODIGO = M.S AND MOV_IN_NUMLANCTO = M.L;
                    DELETE FROM MEGA.FIN_LANCCCUSTO WHERE ORG_IN_CODIGO = BX.ORG_IN_CODIGO AND MOV_TAB_IN_CODIGO = C_MOV_TAB AND MOV_SEQ_IN_CODIGO = M.S AND MOV_IN_NUMLANCTO = M.L;
                    DELETE FROM MEGA.FIN_LANCCLASSE WHERE ORG_IN_CODIGO = BX.ORG_IN_CODIGO AND MOV_TAB_IN_CODIGO = C_MOV_TAB AND MOV_SEQ_IN_CODIGO = M.S AND MOV_IN_NUMLANCTO = M.L;
                    DELETE FROM MEGA.FIN_MOVFIN WHERE ORG_IN_CODIGO = BX.ORG_IN_CODIGO AND MOV_TAB_IN_CODIGO = C_MOV_TAB AND MOV_SEQ_IN_CODIGO = M.S AND MOV_IN_NUMLANCTO = M.L;
                    DELETE FROM MEGA.FIN_MOVIMENTO WHERE ORG_IN_CODIGO = BX.ORG_IN_CODIGO AND MOV_TAB_IN_CODIGO = C_MOV_TAB AND MOV_SEQ_IN_CODIGO = M.S AND MOV_IN_NUMLANCTO = M.L;
                    IF SQL%ROWCOUNT <> 1 THEN RAISE_APPLICATION_ERROR(-20100, 'Movimento ' || M.L || ' da baixa do cheque nao pode ser apagado.'); END IF;
                END LOOP;
                DELETE FROM MEGA.GLO_ACAOMOVIMENTO WHERE ORG_TAB_IN_CODIGO = C_ORG_TAB AND ORG_PAD_IN_CODIGO = C_ORG_PAD AND ORG_IN_CODIGO = BX.ORG_IN_CODIGO AND ORG_TAU_ST_CODIGO = C_ORG_TAU
                   AND ACAOM_IN_SEQUENCIA = BX.ACAOM_IN_SEQUENCIA;
                /* o trigger CCS_T_MOV_CHQ (delete da baixa) gravou o estorno no cheque; nenhum OUTRO cheque pode ter recebido estorno com esse numero (numero de
                   lancamento se repete entre organizacoes) */
                SELECT COUNT(*) INTO W_N FROM MEGA.CUS_FIN_CHEQUESCRE_OCO E WHERE E.MOV_IN_NUMLANCTO_REF = BX.MOV_IN_NUMLANCTO AND E.CUSO_ST_OCORRENCIA LIKE 'ESTORNO%'
                   AND E.CUS_IN_SEQUENCIA <> P_CUS AND E.CUSO_DT_DATA >= SYSDATE - 1/1440;
                IF W_N > 0 THEN RAISE_APPLICATION_ERROR(-20100, 'O estorno da baixa ' || BX.MOV_IN_NUMLANCTO || ' atingiria outro cheque (numero repetido entre organizacoes): trate pelo Mega.'); END IF;
                SELECT COUNT(*) INTO W_N FROM MEGA.CUS_FIN_CHEQUESCRE_OCO E WHERE E.CUS_IN_SEQUENCIA = P_CUS AND E.MOV_IN_NUMLANCTO_REF = BX.MOV_IN_NUMLANCTO AND E.CUSO_ST_OCORRENCIA LIKE 'ESTORNO%';
                IF W_N = 0 THEN RAISE_APPLICATION_ERROR(-20100, 'O trigger do cheque nao registrou o estorno da baixa ' || BX.MOV_IN_NUMLANCTO || ': trate pelo Mega.'); END IF;
                /* saldo da parcela pela rotina oficial do Mega (absoluta, a partir das baixas); marca a ocorrencia como ja ajustada */
                W_SALDO := FIN_PCK_UTILIDADE.F_ATUALIZASALDODOCUMENTO(pOrg => TT.ORG_IN_CODIGO, pSeq => TT.MOV_SEQ_IN_CODIGO, pLancto => TT.MOV_IN_NUMLANCTO, pLanctoVinc => 0);
                UPDATE MEGA.CUS_FIN_CHEQUESCRE_OCO SET CHEQ_ST_ESTORNO = 'S'
                 WHERE CUS_IN_SEQUENCIA = P_CUS AND MOV_IN_NUMLANCTO_REF = BX.MOV_IN_NUMLANCTO AND CUSO_ST_OCORRENCIA LIKE 'ESTORNO%' AND NVL(CHEQ_ST_ESTORNO, 'N') = 'N';
                W_NREAB := W_NREAB + 1; W_VREAB := W_VREAB + BX.MOV_RE_VALOR;
                W_ACAOMS := SUBSTR(W_ACAOMS || CASE WHEN W_ACAOMS IS NOT NULL THEN ',' END || BX.ORG_IN_CODIGO || ':' || BX.ACAOM_IN_SEQUENCIA, 1, 2000);
                W_TITS := SUBSTR(W_TITS || CASE WHEN W_TITS IS NOT NULL THEN ', ' END || TT.MOV_ST_DOCUMENTO || '-' || TT.MOV_ST_PARCELA || ' (saldo ' || VAL(W_SALDO) || ')', 1, 2000);
            EXCEPTION WHEN OTHERS THEN
                IF SQLCODE = -20922 THEN
                    ROLLBACK TO SP_CHDEV_PARC;
                    W_PUL := SUBSTR(W_PUL || CASE WHEN W_PUL IS NOT NULL THEN ', ' END || NVL(TT.MOV_ST_DOCUMENTO || '-' || TT.MOV_ST_PARCELA, 'lanc ' || O.MOV_IN_NUMLANCTO)
                             || ' org ' || O.ORG_IN_CODIGO || ' (' || NVL(REGEXP_SUBSTR(SQLERRM, 'COMISSAO N\. [0-9]+ DO REPRESENTANTE [0-9]+'), 'comissao ja paga') || ')', 1, 1000);
                ELSE RAISE; END IF;
            END;
        END LOOP;
    END IF;

    /* 1b) [26/11/2026] O DEPOSITO: estorna a baixa do Gestor feita na linha DEP CHEQUE (reabre os titulos da org 10) e lanca a 978 com a data do
           deposito conciliada com a linha. Chave BXC_CHD_DEP: 0 desligado, 1 todas, N = so a linha CHRD de CBA N. */
    IF W_CHDEP = 1 OR (W_CHDEP > 1 AND W_CHDEP = P_CBA) THEN
        /* a linha do deposito: mesma conta, DEP CH, mesmo numero (sem zeros) e valor, ate a data da devolucao. Reapresentacao (2 depositos):
           vale o que ainda tem baixa do Gestor viva; senao o mais recente ainda livre. */
        SELECT MAX(CBA) KEEP (DENSE_RANK FIRST ORDER BY PRIO, DT DESC, CBA DESC) INTO W_DEP_CBA FROM (
            SELECT P.CBA_IN_SEQUENCIA CBA, P.CBA_DT_DATA DT,
                   CASE WHEN EXISTS (SELECT 1 FROM MEGA.CCS_TB_GFIN_BXC_LOG L WHERE L.CON_IN_SEQUENCIAL = P.CON_IN_SEQUENCIAL AND L.LOG_CH_STATUS = 'B' AND L.LOG_CH_TIPO = 'R') THEN 0
                        WHEN NVL(P.CBA_CH_STATUS, 'N') <> 'S' AND P.CON_IN_SEQUENCIAL IS NULL THEN 1 ELSE 2 END PRIO
              FROM MEGA.FIN_CONCILIACAO P
             WHERE P.AGN_IN_CODIGO = B.AGN_IN_CODIGO AND P.ORG_IN_CODIGO = B.ORG_IN_CODIGO AND P.CBA_CH_NATUREZA = 'C'
               AND UPPER(P.CBA_ST_HISTORICO) LIKE 'DEP CH%' AND LTRIM(REGEXP_SUBSTR(P.CBA_ST_HISTORICO, '[0-9]+$'), '0') = LTRIM(W_NUM, '0')
               AND ABS(P.CBA_RE_VALOR - B.CBA_RE_VALOR) < 0.005 AND TRUNC(P.CBA_DT_DATA) <= TRUNC(B.CBA_DT_DATA) AND TRUNC(P.CBA_DT_DATA) >= TRUNC(B.CBA_DT_DATA) - W_JANELA
               AND NOT EXISTS (SELECT 1 FROM MEGA.CCS_TB_GFIN_BXC_CHDEV D WHERE D.CHD_IN_CBA_DEP = P.CBA_IN_SEQUENCIA AND D.CHD_CH_DESFEITO = 'N'));
        IF W_DEP_CBA IS NULL THEN
            W_DEPMSG := 'deposito do cheque nao encontrado no extrato da conta ' || B.AGN_IN_CODIGO || ' (sem 978)';
        ELSE
            DECLARE
                P MEGA.FIN_CONCILIACAO%ROWTYPE; W_DEP978 NUMBER; W_LOGIN VARCHAR2(60); W_ORIG VARCHAR2(1); W_TOK VARCHAR2(40); W_CT NUMBER; W_TIPO VARCHAR2(1);
            BEGIN
                SELECT X.* INTO P FROM MEGA.FIN_CONCILIACAO X WHERE X.CBA_IN_SEQUENCIA = W_DEP_CBA FOR UPDATE NOWAIT;
                /* a) a baixa do deposito */
                IF NVL(P.CBA_CH_STATUS, 'N') = 'S' OR P.CON_IN_SEQUENCIAL IS NOT NULL THEN
                    SELECT MAX(L.LOG_IN_CODIGO), MAX(L.LOG_CH_TIPO) KEEP (DENSE_RANK LAST ORDER BY L.LOG_IN_CODIGO) INTO W_DEP_LOG, W_TIPO
                      FROM MEGA.CCS_TB_GFIN_BXC_LOG L WHERE L.CON_IN_SEQUENCIAL = P.CON_IN_SEQUENCIAL AND L.LOG_CH_STATUS = 'B';
                    IF W_DEP_LOG IS NULL OR W_TIPO <> 'R' THEN
                        W_DEP_EST := 'N';
                        W_DEPMSG := 'deposito ' || TO_CHAR(P.CBA_DT_DATA, 'DD/MM') || ' conciliado fora da baixa do Gestor: ESTORNE/DESCONCILIE PELO MEGA (978 nao lancada)';
                    ELSE
                        SELECT COUNT(*) INTO W_CT FROM MEGA.CON_LANCAMENTO C, MEGA.CCS_TB_GFIN_BXC_LOG L
                         WHERE L.LOG_IN_CODIGO = W_DEP_LOG AND C.ACAOM_ORG_IN_CODIGO = L.ORG_IN_CODIGO AND C.ACAOM_IN_SEQUENCIA = L.ACAOM_IN_SEQUENCIA;
                        SELECT LISTAGG(T.MOV_ST_DOCUMENTO || '-' || T.MOV_ST_PARCELA || ' fil ' || T.FIL_IN_CODIGO, ', ') WITHIN GROUP (ORDER BY T.LGT_IN_CODIGO) INTO W_DEPTITS
                          FROM MEGA.CCS_TB_GFIN_BXC_LOG_TIT T WHERE T.LOG_IN_CODIGO = W_DEP_LOG;
                        IF W_CT > 0 THEN
                            W_DEP_EST := 'N';
                            W_DEPMSG := SUBSTR('baixa do deposito ' || TO_CHAR(P.CBA_DT_DATA, 'DD/MM') || ' (log ' || W_DEP_LOG || ': ' || W_DEPTITS || ') JA CONTABILIZADA: ESTORNE PELO MEGA; a 978 entra depois', 1, 500);
                        ELSE
                            SAVEPOINT SP_CHDEV_DEP;
                            BEGIN
                                MEGA.CCS_P_GFIN_BXC_ESTORNO_X(W_DEP_LOG, P_USU);
                                UPDATE MEGA.CCS_TB_GFIN_BXC_LOG SET LOG_CH_STATUS = 'E', EST_USU_IN_CODIGO = P_USU, EST_DT = SYSDATE,
                                       LOG_ST_MENSAGEM = SUBSTR('Estornada pelo cheque devolvido (log ' || P_LOG || ')', 1, 1500)
                                 WHERE LOG_IN_CODIGO = W_DEP_LOG;
                                W_DEP_EST := 'S';
                            EXCEPTION WHEN OTHERS THEN
                                ROLLBACK TO SP_CHDEV_DEP; W_DEP_EST := 'N';
                                W_DEPMSG := SUBSTR('baixa do deposito (log ' || W_DEP_LOG || ') nao estornada: ' || REGEXP_REPLACE(SQLERRM, '^ORA-20100: ', '') || ' ESTORNE PELO MEGA', 1, 500);
                            END;
                        END IF;
                    END IF;
                END IF;
                /* b) a 978 com a data do deposito, conciliada com a linha (so se a linha ficou livre) */
                SELECT X.* INTO P FROM MEGA.FIN_CONCILIACAO X WHERE X.CBA_IN_SEQUENCIA = W_DEP_CBA;
                IF NVL(P.CBA_CH_STATUS, 'N') <> 'S' AND P.CON_IN_SEQUENCIAL IS NULL THEN
                    SELECT MAX(DEP_IN_CODIGO) INTO W_DEP978 FROM MEGA.CCS_TB_GFIN_BXC_DEPARA WHERE TPD_ST_CODIGO = 'AVCRED' AND ACAO_IN_CODIGO = 978;
                    IF W_DEP978 IS NULL THEN RAISE_APPLICATION_ERROR(-20100, 'De-para AVCRED/978 nao encontrado (sql/44).'); END IF;
                    SELECT SUBSTR(USU_ST_LOGIN, 1, 60), LOG_CH_ORIGEM, SUBSTR(LOG_ST_TOKEN, 1, 34) || '-978' INTO W_LOGIN, W_ORIG, W_TOK FROM MEGA.CCS_TB_GFIN_BXC_LOG WHERE LOG_IN_CODIGO = P_LOG;
                    SELECT MEGA.CCS_SEQ_GFIN_BXC_LOG.NEXTVAL INTO W_LOG978 FROM DUAL;
                    INSERT INTO MEGA.CCS_TB_GFIN_BXC_LOG ( LOG_IN_CODIGO, LOG_ST_TOKEN, LOG_CH_TIPO, LOG_CH_STATUS, LOG_CH_ORIGEM, ORG_IN_CODIGO, LOG_ST_CBAS, DEP_IN_CODIGO, USU_IN_CODIGO, USU_ST_LOGIN, LOG_DT_INCLUSAO )
                    VALUES ( W_LOG978, W_TOK, 'A', 'B', W_ORIG, P.ORG_IN_CODIGO, TO_CHAR(W_DEP_CBA), W_DEP978, P_USU, W_LOGIN, SYSDATE );
                    /* o de-para 978 so fica ativo dentro desta transacao (fora dela o motor sugeriria 978 para toda linha DEP CHEQUE) */
                    UPDATE MEGA.CCS_TB_GFIN_BXC_DEPARA SET DEP_CH_ATIVO = 'S' WHERE DEP_IN_CODIGO = W_DEP978;
                    MEGA.CCS_P_GFIN_BXC_REAL_X(W_LOG978, P.ORG_IN_CODIGO, W_DEP_CBA, W_DEP978, P_USU,
                        SUBSTR('CHEQUE DEPOSITADO ' || W_BAN || ' ' || W_NUM || ' - ' || W_NOME || ' - DEVOLVIDO EM ' || TO_CHAR(B.CBA_DT_DATA, 'DD/MM/YYYY') || ' (GESTOR FINANCEIRO)', 1, 500));
                    UPDATE MEGA.CCS_TB_GFIN_BXC_DEPARA SET DEP_CH_ATIVO = 'N' WHERE DEP_IN_CODIGO = W_DEP978;
                    UPDATE MEGA.CCS_TB_GFIN_BXC_LOG SET LOG_ST_MENSAGEM = SUBSTR('978 do cheque devolvido ' || W_BAN || '/' || W_NUM || ' (log ' || P_LOG || ')', 1, 1500) WHERE LOG_IN_CODIGO = W_LOG978;
                    W_DEPMSG := SUBSTR(CASE WHEN W_DEP_EST = 'S' THEN 'baixa do deposito ' || TO_CHAR(P.CBA_DT_DATA, 'DD/MM') || ' estornada (log ' || W_DEP_LOG || ': ' || W_DEPTITS || ' reabertos); '
                                            ELSE 'deposito ' || TO_CHAR(P.CBA_DT_DATA, 'DD/MM') || ' estava sem baixa; ' END
                                       || '978 lancada em ' || TO_CHAR(P.CBA_DT_DATA, 'DD/MM/YYYY') || ' e conciliada com o deposito', 1, 500);
                END IF;
            EXCEPTION
                WHEN E_OCUPADO THEN RAISE_APPLICATION_ERROR(-20100, 'Linha do deposito ' || W_DEP_CBA || ' em uso por outro usuario no Mega.');
            END;
        END IF;
    END IF;

    /* 2) MARCA o cheque */
    IF W_MARCA = 1 THEN
        UPDATE MEGA.CUS_FIN_CHEQUESCRE
           SET CHEQR_CH_STATUS = 'D', CUS_DT_CHEQR_CH_STATUS = SYSDATE, CHEQR_DT_ALTERACAO = SYSDATE, CHEQR_IN_ALTERACAO = P_USU,
               CHEQR_ST_STATUS = SUBSTR('MOTIVO ' || W_ALI || ' - GESTOR ' || TO_CHAR(SYSDATE, 'DD/MM/YY') || CASE WHEN CH.CHEQR_ST_STATUS IS NOT NULL THEN ' | ' || CH.CHEQR_ST_STATUS END, 1, 100)
         WHERE CUS_IN_SEQUENCIA = P_CUS;
    END IF;

    /* 3) AVISA a equipe (fila do WhatsApp, linha 1 = NUMERO QUALITY) */
    IF W_WHATS = 1 AND W_LISTA > 0 THEN
        W_MSG := '*CHEQUE DEVOLVIDO*' || CHR(10) || 'Cliente: ' || W_NOME || ' (' || CH.AGN_IN_CODIGO || ')' || CHR(10)
              || 'Cheque: banco ' || W_BAN || ' n. ' || W_NUM || ' - R$ ' || VAL(CH.CHEQR_RE_VALOR) || CHR(10)
              || 'Alinea: ' || W_ALI || CHR(10) || 'Devolvido em ' || TO_CHAR(B.CBA_DT_DATA, 'DD/MM/YYYY') || ' na conta ' || B.AGN_IN_CODIGO || CHR(10)
              || 'Parcelas reabertas: ' || NVL(W_TITS, 'nenhuma') || CHR(10)
              || CASE WHEN W_PUL IS NOT NULL THEN 'NAO reabertas (comissao ja paga, tratar pelo Mega): ' || W_PUL || CHR(10) END
              || CASE WHEN W_DEPMSG IS NOT NULL THEN 'Deposito: ' || W_DEPMSG || CHR(10) END || '(Gestor Financeiro - Baixar e conciliar)';
        INSERT INTO MEGA.CCS_TB_ZAP_MSG_ATIVO (ZMSG_IN_CODIGO, ZLINHA_IN_CODIGO, ZMSG_IN_TAREFA, ZLISTA_IN_CODIGO, ZMSG_ST_MENSAGEM, ZMSG_BO_ENVIADO, ZMSG_DT_MENSAGEM)
        VALUES (0, 1, 9997, W_LISTA, SUBSTR(W_MSG, 1, 4000), 'N', SYSDATE)
        RETURNING ZMSG_IN_CODIGO INTO W_ZAP;
    END IF;

    INSERT INTO MEGA.CCS_TB_GFIN_BXC_CHDEV (LOG_IN_CODIGO, CBA_IN_SEQUENCIA, CUS_IN_SEQUENCIA, CHD_ST_BANCO, CHD_ST_NUMERO, CHD_ST_ALINEA, CHD_RE_VALOR, AGN_IN_CODIGO,
        CHQ_CH_STATUS_ANT, CHQ_ST_STATUS_ANT, CHD_CH_MARCOU, CHD_IN_QT_REAB, CHD_RE_VALOR_REAB, CHD_ST_ACAOMS, CHD_ST_TITULOS, ZMSG_IN_CODIGO,
        CHD_IN_CBA_DEP, CHD_IN_LOG_DEP, CHD_CH_DEP_EST, CHD_IN_LOG_978, CHD_ST_DEP_MSG, CHD_ST_PULADAS)
    VALUES (P_LOG, P_CBA, P_CUS, W_BAN, W_NUM, W_ALI, CH.CHEQR_RE_VALOR, CH.AGN_IN_CODIGO,
        CH.CHEQR_CH_STATUS, CH.CHEQR_ST_STATUS, CASE WHEN W_MARCA = 1 THEN 'S' ELSE 'N' END, W_NREAB, W_VREAB, W_ACAOMS, W_TITS, W_ZAP,
        W_DEP_CBA, W_DEP_LOG, W_DEP_EST, W_LOG978, W_DEPMSG, W_PUL);
    UPDATE MEGA.CCS_TB_GFIN_BXC_LOG
       SET LOG_IN_QT_TITULOS = W_NREAB, LOG_RE_VALOR_TITULOS = W_VREAB,
           LOG_ST_MENSAGEM = SUBSTR('Cheque devolvido ' || W_BAN || '/' || W_NUM || ' alinea ' || W_ALI || ' de ' || W_NOME || ': 971 lancada e conciliada; '
             || CASE WHEN W_NREAB > 0 THEN W_NREAB || ' parcela(s) reaberta(s): ' || W_TITS ELSE 'nenhuma parcela a reabrir' END
             || CASE WHEN W_PUL IS NOT NULL THEN '; NAO reaberta(s) - comissao ja paga, trate pelo Mega: ' || W_PUL END
             || CASE WHEN W_DEPMSG IS NOT NULL THEN '; ' || W_DEPMSG END
             || CASE WHEN W_MARCA = 1 THEN '; cheque marcado D' END || CASE WHEN W_ZAP IS NOT NULL THEN '; aviso no WhatsApp' END, 1, 1500)
     WHERE LOG_IN_CODIGO = P_LOG;
END CCS_P_GFIN_BXC_CHDEV_X;
/
