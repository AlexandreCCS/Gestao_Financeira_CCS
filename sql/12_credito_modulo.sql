-- ============================================================================
-- [14/05/2026 - CRIADO POR ALEXANDRE CARVALHO] Modulo "Inteligencia de Credito"
-- no catalogo do Gestor Financeiro CCS - liberavel na tela de Administracao.
-- Nome em ASCII puro de proposito (deploy SOAP corrompe acento; a UI exibe bonito).
-- ============================================================================
BEGIN
  MERGE INTO MEGA.CCS_TB_GFIN_MODULO D
  USING (
    SELECT 'CREDITO' AS COD, 'Inteligencia de Credito' AS NOME, 5 AS ORD FROM DUAL
  ) S
  ON (D.MOD_ST_CODIGO = S.COD)
  WHEN MATCHED THEN UPDATE SET D.MOD_ST_NOME = S.NOME, D.MOD_IN_ORDEM = S.ORD
  WHEN NOT MATCHED THEN INSERT (MOD_ST_CODIGO, MOD_ST_NOME, MOD_IN_ORDEM, MOD_CH_ATIVO)
                        VALUES (S.COD, S.NOME, S.ORD, 'S');
  COMMIT;
END;
/
