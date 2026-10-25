-- [25/10/2026 - CRIADO POR ALEXANDRE CARVALHO] Frete > Veiculos: vale-combustivel por veiculo (fase 1 do recibo de combustivel).
-- Decisoes do Alexandre (25/10): valor FIXO por viagem por veiculo; posto padrao = agente FORNECEDOR do Mega, parametro unico na
-- engrenagem da tela Veiculos; regra "desconta do frete": terceiro desconta, frota propria nao, com excecao por veiculo;
-- recibo comeca do numero 1 (fase seguinte, no portal da industria). Fase 2: contas a pagar.
-- Deploy pelo gateway SOAP: blocos separados por linha "/", DDL sem ";" final.

ALTER TABLE MEGA.CCS_TB_GFIN_VEICULO ADD (
  VEI_RE_VALOR_COMBUSTIVEL NUMBER,
  VEI_CH_DESCONTA_FRETE    CHAR(1),
  CONSTRAINT CK_CCS_GFIN_VEICULO_DESC CHECK (VEI_CH_DESCONTA_FRETE IN ('S','N'))
)
/
BEGIN
  MERGE INTO MEGA.CCS_TB_GFIN_PARAM D
  USING (SELECT 'FRETE_POSTO_PADRAO_AGN' CH,
                0 VL,
                'POSTO PADRAO DO VALE-COMBUSTIVEL (CODIGO DO AGENTE FORNECEDOR; 0 = NAO DEFINIDO)' DS
           FROM DUAL) S
  ON (D.PARAM_ST_CHAVE = S.CH)
  WHEN MATCHED THEN UPDATE SET D.PARAM_ST_DESCRICAO = S.DS
  WHEN NOT MATCHED THEN INSERT (PARAM_ST_CHAVE, PARAM_RE_VALOR, PARAM_ST_DESCRICAO)
       VALUES (S.CH, S.VL, S.DS);
  COMMIT;
END;
/
