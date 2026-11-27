/* =====================================================================================================================
   [27/11/2026 - Alexandre Carvalho] GESTOR FINANCEIRO - CONCILIACAO BANCARIA CARTAO (QUALITY): DEPOSITO DA REDE QUE BAIXA E CONCILIA.
   Pedido do Alexandre (27/11): "os titulos que voce encontrar baixados ja vamos apenas conciliar, os titulos que nao tiverem baixados tem
   que buscar a correlacao e fazer a baixa (igual acontece hoje com a conciliacao normal) lembrando que essa baixa deve ter a acao de desconto
   referente a taxa".
   - Parcela da Rede ja baixada no Mega (baixa automatica do varejo ou baixa a mao com 706 na conta da loja): o movimento 706 existente entra
     na conciliacao da linha do extrato (P_MOVS_CONC do CCS_P_GFIN_BXC_X).
   - Parcela sem baixa: o titulo correlato e baixado pelo LIQUIDO no banco e a taxa (MDR da Rede) vai como desconto numa ACAO 956
     "Desconto Taxa Adm. Cartao (CRE)" propria, igual a baixa automatica (P_DESC_ACAO = 956).
   - Tudo numa transacao: baixas novas + conciliacao de (movimento novo + existentes) x a linha do deposito no extrato do Itau.
   Este arquivo: dados e colunas. Os procedimentos ficam em sql/30 (CCS_P_GFIN_BXC_X, CCS_P_GFIN_BXC) e sql/31 (CCS_P_GFIN_BXC_ESTORNO_X),
   republicados em 27/11 (agenda_23_11_a_29_11/mm48a_75). SO ASCII. Blocos separados por "/".
   ===================================================================================================================== */
MERGE INTO MEGA.CCS_TB_GFIN_BXC_CONT C USING (
  SELECT 956 ACAO, 'DESC' TREF, 'MVCRE' TAC, 3 SEQ, 'taxa do cartao (desconto 956, conciliacao de cartao) [27/11/2026]' OBS FROM DUAL
) X ON (C.ACAO_IN_CODIGO = X.ACAO AND C.TREF_ST_CODIGO = X.TREF)
WHEN NOT MATCHED THEN INSERT (ACAO_IN_CODIGO, TREF_ST_CODIGO, CONT_TAC_ST_CODIGO, CONT_CON_IN_SEQUENCIA, CONT_ST_OBS) VALUES (X.ACAO, X.TREF, X.TAC, X.SEQ, X.OBS)
/
MERGE INTO MEGA.CCS_TB_GFIN_PARAM P USING (
  SELECT 'BXC_CLA_CR_TAXA' K, 830 V, 'Classe da taxa do cartao (acao 956) na baixa pela conciliacao de cartao' D FROM DUAL UNION ALL
  SELECT 'BXC_CC_CR_TAXA', 24, 'Centro de custo da taxa do cartao (acao 956) na baixa pela conciliacao de cartao' FROM DUAL
) X ON (P.PARAM_ST_CHAVE = X.K)
WHEN NOT MATCHED THEN INSERT (PARAM_ST_CHAVE, PARAM_RE_VALOR, PARAM_ST_DESCRICAO, PARAM_DT_ALTERACAO, PARAM_ST_USU) VALUES (X.K, X.V, X.D, SYSDATE, 'CCS 27/11/2026')
/
ALTER TABLE MEGA.CCS_TB_GFIN_BXC_LOG_TIT ADD (ACAOM_DESC NUMBER)
/
ALTER TABLE MEGA.CCS_TB_GFIN_BXC_LOG ADD (LOG_ST_MOVS_CONC VARCHAR2(2000))
/
