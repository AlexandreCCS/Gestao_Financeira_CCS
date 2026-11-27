-- ============================================================================
-- [21/09/2026 - Alexandre Carvalho] Modulo "Baixas/Conciliacao" no catalogo do Gestor Financeiro.
-- Pedido do Alexandre (com a Renata/Quality): o quadro de arrastar o extrato do banco sai da aba
-- "Contas a pagar: pago x em aberto" do Fluxo e ganha MENU PROPRIO, com a tela dentro dele.
-- Nome em ASCII puro (o deploy por SOAP corrompe acento); o rotulo bonito fica no web/src/modulos.js.
-- ============================================================================
MERGE INTO MEGA.CCS_TB_GFIN_MODULO M
USING (SELECT 'BAIXAS_CONCILIACAO' COD FROM DUAL) X
   ON (M.MOD_ST_CODIGO = X.COD)
 WHEN NOT MATCHED THEN
      INSERT (MOD_ST_CODIGO, MOD_ST_NOME, MOD_IN_ORDEM, MOD_CH_ATIVO)
      VALUES ('BAIXAS_CONCILIACAO', 'Baixas/Conciliacao', 8, 'S')
/

-- Quem ja tinha o FLUXO liberado usava o quadro la dentro: recebe o menu novo para nao perder o acesso.
-- (Administrador ve todos os modulos ativos e nao precisa de linha aqui.) Idempotente.
INSERT INTO MEGA.CCS_TB_GFIN_PERM_USU (GRU_IN_CODIGO, MOD_ST_CODIGO, PERM_DT_INC, PERM_IN_USU_INC)
SELECT P.GRU_IN_CODIGO, 'BAIXAS_CONCILIACAO', SYSDATE, 0
  FROM MEGA.CCS_TB_GFIN_PERM_USU P
 WHERE P.MOD_ST_CODIGO = 'FLUXO'
   AND NOT EXISTS (SELECT 1 FROM MEGA.CCS_TB_GFIN_PERM_USU Q
                    WHERE Q.GRU_IN_CODIGO = P.GRU_IN_CODIGO AND Q.MOD_ST_CODIGO = 'BAIXAS_CONCILIACAO')
/
