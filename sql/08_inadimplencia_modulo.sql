-- ============================================================================
-- [14/05/2026 - CRIADO POR ALEXANDRE CARVALHO] Modulo "Inadimplencia" do
-- Gestor Financeiro CCS - menu com submenus.
--
-- Apenas cadastra o modulo no catalogo CCS_TB_GFIN_MODULO (criado em
-- 07_admin_permissoes.sql), para que o admin possa liberar o acesso na tela
-- de Administracao de Usuarios. Os submenus (Painel, Titulos em Atraso,
-- Clientes Inadimplentes, Regua de Cobranca) sao tratados no front-end:
-- a permissao continua sendo por modulo (quem ve "Inadimplencia" ve todos
-- os submenus dela).
--
-- Nome do catalogo em ASCII puro de proposito: o MERGE trafega no envelope
-- SOAP (UTF-8) e acento pode corromper no deploy. A UI exibe o rotulo bonito.
-- ============================================================================

-- Cadastra/atualiza o modulo Inadimplencia no catalogo (idempotente, atomico) ---
BEGIN
  MERGE INTO MEGA.CCS_TB_GFIN_MODULO D
  USING (
    SELECT 'INADIMPLENCIA' AS COD, 'Inadimplencia' AS NOME, 4 AS ORD FROM DUAL
  ) S
  ON (D.MOD_ST_CODIGO = S.COD)
  WHEN MATCHED THEN UPDATE SET D.MOD_ST_NOME = S.NOME, D.MOD_IN_ORDEM = S.ORD
  WHEN NOT MATCHED THEN INSERT (MOD_ST_CODIGO, MOD_ST_NOME, MOD_IN_ORDEM, MOD_CH_ATIVO)
                        VALUES (S.COD, S.NOME, S.ORD, 'S');
  COMMIT;
END;
/
