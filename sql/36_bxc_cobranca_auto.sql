/* =====================================================================================================================
   [29/10/2026 - Alexandre Carvalho] GESTOR FINANCEIRO - BAIXAR E CONCILIAR (QUALITY): CONCILIACAO AUTOMATICA DA COBRANCA.
   O retorno do banco continua no Mega (JOELMA); o robo da cobranca do Gestor (api rodarCobranca, a cada 5 min e apos importar
   extrato pelo portal) concilia o dia de cobranca fechado no centavo: linhas de cobranca + PIX QRS do extrato x baixas 706/COB do
   retorno do mesmo dia, via CCS_P_GFIN_BXC_CONC (origem R). Decisoes do Alexandre: usuario MEGA (1), contas 14424/1002/1003,
   PIX QRS entra, liga direto na publicacao.
   BXC_AUTO_COB nasce 0 (desligado): liga com o deploy da API. SO ASCII. Blocos separados por "/".
   ===================================================================================================================== */
ALTER TABLE MEGA.CCS_TB_GFIN_BXC_CONTA ADD (CTA_CH_AUTO_COB CHAR(1) DEFAULT 'N' NOT NULL CONSTRAINT CCS_CK_GFIN_BXC_CONTA_AC CHECK (CTA_CH_AUTO_COB IN ('S','N')))
/
MERGE INTO MEGA.CCS_TB_GFIN_PARAM D USING (
  SELECT 'BXC_AUTO_COB' CH, 0 VL, 'BXC: CONCILIACAO AUTOMATICA DA COBRANCA (1=LIGADA/0=DESLIGADA)' DS FROM DUAL UNION ALL
  SELECT 'BXC_USU_COB', 1, 'BXC: USUARIO DO MEGA QUE GRAVA A CONCILIACAO AUTOMATICA DA COBRANCA' FROM DUAL
) S ON (D.PARAM_ST_CHAVE = S.CH)
WHEN MATCHED THEN UPDATE SET D.PARAM_ST_DESCRICAO = S.DS
WHEN NOT MATCHED THEN INSERT (PARAM_ST_CHAVE, PARAM_RE_VALOR, PARAM_ST_DESCRICAO) VALUES (S.CH, S.VL, S.DS)
/
UPDATE MEGA.CCS_TB_GFIN_BXC_CONTA SET CTA_CH_AUTO_COB = 'S', CTA_DT_ALTERACAO = SYSDATE, CTA_ST_USU = 'CCS 29/10/2026' WHERE AGN_IN_CODIGO IN (14424, 1002, 1003) AND CTA_CH_AUTO_COB = 'N'
/
