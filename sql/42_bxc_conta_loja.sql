/* [23/11/2026 - Alexandre Carvalho] BAIXAR E CONCILIAR - CONTA DE LOJA (baixa automatica do varejo)
   Nas contas das lojas a baixa automatica (cartao/PIX/adiantamento) ja baixou os titulos: a entrada do extrato so CONCILIA com os
   lancamentos que ja estao no Mega (N lancamentos x 1 linha), nunca baixa titulo. Industria segue como esta (coluna = 'N').
   Caso de origem: conta 21725 (fil 401), PIX de 9.500,00 em 04/11 = PIX 996,00 (baixa do 35960) + PIX 8.498,30 (baixa do 11259)
   + adiantamento AD-00002048 de 5,70.
   Contas marcadas (com baixa automatica nos ultimos 30 dias em 23/11/2026): 21725 (401), 21724 (402), 21723 (403), 22971 (404), 27249 (460). */
ALTER TABLE MEGA.CCS_TB_GFIN_BXC_CONTA ADD CTA_CH_LOJA CHAR(1) DEFAULT 'N';

UPDATE MEGA.CCS_TB_GFIN_BXC_CONTA SET CTA_CH_LOJA = 'N' WHERE CTA_CH_LOJA IS NULL;
UPDATE MEGA.CCS_TB_GFIN_BXC_CONTA SET CTA_CH_LOJA = 'S' WHERE AGN_IN_CODIGO IN (21725, 21724, 21723, 22971, 27249);
COMMIT;
