-- ============================================================================
-- [05/05/2026 - Alexandre Carvalho] Permissao de acesso ao Gestor Financeiro CCS
-- Adiciona coluna GRU_CH_GFIN_CCS em MEGA.GLO_GRUPO_USUARIOCMPESP.
-- 'A' = admin / 'U' = usuario / 'N' (default) = sem acesso.
-- O wrapper de login (CCS_F_VALIDA_LOGIN_PRJ) ja existe - reaproveitamos.
-- ============================================================================

ALTER TABLE MEGA.GLO_GRUPO_USUARIOCMPESP ADD GRU_CH_GFIN_CCS VARCHAR2(1) DEFAULT 'N';

-- Liberar usuario Mega (1)
UPDATE MEGA.GLO_GRUPO_USUARIOCMPESP SET GRU_CH_GFIN_CCS = 'A' WHERE GRU_IN_CODIGO = 1;
COMMIT;
