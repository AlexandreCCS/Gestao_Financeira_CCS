/* =====================================================================================================================
   [27/11/2026 - Alexandre Carvalho] GESTOR FINANCEIRO - CONCILIACAO DE CARTAO: BAIXAR AGORA, CONCILIAR DEPOIS.
   Pedido do Alexandre (27/11): "Vamos seguir o caminho B baixar agora e conciliar depois" (deposito da Rede sem o extrato do Itau importado).
   CCS_P_GFIN_BXC_X / CCS_P_GFIN_BXC ganham P_SEM_EXTRATO ('S' = baixa sem linha do extrato e sem conciliacao; so receber + taxa 956 + conta de
   loja) e CCS_P_GFIN_BXC_ESTORNO_X aceita log sem conciliacao (recusa se o movimento ja foi conciliado depois). Procedimentos em sql/30 e sql/31.
   Este arquivo: a coluna do log. SO ASCII.
   ===================================================================================================================== */
ALTER TABLE MEGA.CCS_TB_GFIN_BXC_LOG ADD (LOG_CH_SEM_EXTRATO CHAR(1) DEFAULT 'N')
/
