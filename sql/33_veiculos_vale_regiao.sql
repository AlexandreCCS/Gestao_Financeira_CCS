-- [26/10/2026 - CRIADO POR ALEXANDRE CARVALHO] Frete > Veiculos: vale-combustivel por REGIAO do romaneio.
-- Regra da Quality: o vale depende do tipo do veiculo e da UF (PE/AL/PB x fora). O padrao por tipo fica em
-- MEGA.CCS_TB_FRT_VEICULO_TIPO.VALE_FORA / VALE_LOCAL (repo portal-dados-quality-industria, sql/53).
-- No veiculo: VEI_RE_VALOR_COMBUSTIVEL passa a ser o valor de FORA e nasce VEI_RE_VALOR_COMB_LOCAL (PE/AL/PB).
-- Vazio = usa o padrao do tipo. Veiculo sem tipo = usa o valor de fora do proprio veiculo.
-- Deploy pelo gateway SOAP: blocos separados por linha "/", DDL sem ";" final.

ALTER TABLE MEGA.CCS_TB_GFIN_VEICULO ADD (
  VEI_RE_VALOR_COMB_LOCAL NUMBER
)
/
