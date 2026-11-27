-- ============================================================================
-- [26/11/2026 - Alexandre Carvalho] GESTOR FINANCEIRO: modulo CALC_JUROS = permissao PROPRIA da
-- "Calculadora de juros e multa" (Baixas/Conciliacao > Calculadora, rota /baixas-conciliacao/calculadora,
-- API GET /calculadora-juros/titulos). Antes a tela usava a permissao BAIXAS_CONCILIACAO.
-- Pedido: "No gestor financeiro, cria uma permissao especifica para calculadora".
-- Nome em ASCII puro (o deploy por SOAP corrompe acento); o rotulo bonito fica no web/src/modulos.js
-- (CALC_JUROS renderiza no mesmo dropdown "Baixas/Conciliacao", merge por label).
-- Ninguem recebeu o modulo automaticamente: liberar em Administracao de Usuarios (admin 'A' ve tudo).
-- Aplicado em 26/11/2026 (OCPDB493) pelo agenda_23_11_a_29_11/mm48c_38_gf_modulo_calc_juros.mjs.
-- ROLLBACK: DELETE FROM MEGA.CCS_TB_GFIN_USUARIO_MODULO WHERE MOD_ST_CODIGO='CALC_JUROS' (se a tabela de vinculo
--           for essa; ver api/src/soap/mega.js getModulosUsuario) + DELETE do modulo.
-- ============================================================================
MERGE INTO MEGA.CCS_TB_GFIN_MODULO M
USING (SELECT 'CALC_JUROS' COD FROM DUAL) X
   ON (M.MOD_ST_CODIGO = X.COD)
 WHEN NOT MATCHED THEN
      INSERT (MOD_ST_CODIGO, MOD_ST_NOME, MOD_IN_ORDEM, MOD_CH_ATIVO)
      VALUES ('CALC_JUROS', 'Calculadora de Juros e Multa', 12, 'S')
/
