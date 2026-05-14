-- ============================================================================
-- [05/05/2026 - Alexandre Carvalho] V3 - Saldos Bancarios + Saldo Bancario Estimado
--
-- A V2 retornava o "Saldo da Conta" (F_SALDOAGENTE), igual ao que o MEGA mostra
-- na tela Conciliacao Bancaria como "Saldo da Conta". Mas o Mega mostra TAMBEM
-- o "Saldo Conciliado" / "Saldo Bancario Estimado" (que considera os
-- movimentos pendentes nao conciliados). Para um SaaS de gestao bancaria, o
-- saldo bancario "real" e o que importa - bate com o extrato do banco.
--
-- Calculo:
--   SALDO_MEGA      = MEGA.F_SALDOAGENTE(...)
--   MOV_PENDENTES   = SUM(MOV_RE_VALORDEB) - SUM(MOV_RE_VALORCRE) dos movimentos
--                     com CONCILIADO='N' AND STATUSBXREF='N' (pendentes de baixa
--                     na conciliacao bancaria)
--   SALDO_BANCARIO  = SALDO_MEGA - MOV_PENDENTES
-- ============================================================================

CREATE OR REPLACE TYPE MEGA.CCS_TY_GFIN_SALDOBCO_LIN AS OBJECT (
  AGN_IN_CODIGO  NUMBER,
  AGN_ST_NOME    VARCHAR2(120),
  FIL_IN_CODIGO  NUMBER,
  FIL_ST_NOME    VARCHAR2(120),
  ENTRADAS       NUMBER,
  SAIDAS         NUMBER,
  SALDO          NUMBER  -- Saldo Bancario Estimado (saldo conta - pendentes)
);
/

CREATE OR REPLACE TYPE MEGA.CCS_TY_GFIN_SALDOBCO_TBL AS TABLE OF MEGA.CCS_TY_GFIN_SALDOBCO_LIN;
/

CREATE OR REPLACE FUNCTION MEGA.CCS_F_GFIN_SALDOS_BANCO(
    P_DATA IN DATE,
    P_FIL  IN NUMBER DEFAULT 0,
    P_AGN  IN NUMBER DEFAULT 0
  ) RETURN MEGA.CCS_TY_GFIN_SALDOBCO_TBL PIPELINED IS
    V_SALDO_MEGA      NUMBER;
    V_PENDENTES       NUMBER;
    V_SALDO_BANCARIO  NUMBER;
  BEGIN
    FOR R IN (
      SELECT M.AGN_IN_CODIGO,
             MAX(A.AGN_ST_NOME)                  AS AGN_ST_NOME,
             M.FIL_IN_CODIGO,
             MAX(NVL(O.ORG_ST_FANTASIA,
                     O.ORG_ST_NOME))             AS FIL_ST_NOME,
             NVL(SUM(M.MOV_RE_VALORDEB),0)       AS ENTRADAS,
             NVL(SUM(M.MOV_RE_VALORCRE),0)       AS SAIDAS
        FROM MEGA.FIN_MOVIMENTO       M,
             MEGA.GLO_AGENTES_ID      I,
             MEGA.GLO_AGENTES         A,
             MEGA.GLO_VW_ORGANIZACAO  O
       WHERE I.AGN_TAU_ST_CODIGO = 'N'
         AND M.AGN_TAB_IN_CODIGO = I.AGN_TAB_IN_CODIGO
         AND M.AGN_PAD_IN_CODIGO = I.AGN_PAD_IN_CODIGO
         AND M.AGN_IN_CODIGO     = I.AGN_IN_CODIGO
         AND M.AGN_TAU_ST_CODIGO = I.AGN_TAU_ST_CODIGO
         AND I.AGN_TAB_IN_CODIGO = A.AGN_TAB_IN_CODIGO
         AND I.AGN_PAD_IN_CODIGO = A.AGN_PAD_IN_CODIGO
         AND I.AGN_IN_CODIGO     = A.AGN_IN_CODIGO
         AND O.ORG_IN_CODIGO (+) = M.FIL_IN_CODIGO
         AND M.MOV_DT_VENCTO    <= P_DATA
         AND NVL(M.MOV_CH_SITUACAO,'A') <> 'C'
         AND (P_FIL = 0 OR M.FIL_IN_CODIGO = P_FIL)
         AND (P_AGN = 0 OR M.AGN_IN_CODIGO = P_AGN)
       GROUP BY M.AGN_IN_CODIGO, M.FIL_IN_CODIGO
    ) LOOP
      -- Saldo da Conta (mesmo calculo do MEGA na conciliacao)
      V_SALDO_MEGA := MEGA.F_SALDOAGENTE(
        PAGNPAD => 1, PAGNCOD => R.AGN_IN_CODIGO, PAGNTAU => 'N',
        PDATA => P_DATA, PTIPO => 'D', PATUANT => 'N',
        PFIL => R.FIL_IN_CODIGO, PFILATIVA => 'N',
        PCOMP => 'GFIN', PUSU => 1, PCRITERIO => 1
      );

      -- Movimentos pendentes (nao conciliados) no exercicio atual
      SELECT NVL(SUM(MOV_RE_VALORDEB),0) - NVL(SUM(MOV_RE_VALORCRE),0)
        INTO V_PENDENTES
        FROM MEGA.FIN_MOVIMENTO
       WHERE AGN_IN_CODIGO     = R.AGN_IN_CODIGO
         AND AGN_TAU_ST_CODIGO = 'N'
         AND FIL_IN_CODIGO     = R.FIL_IN_CODIGO
         AND MOV_CH_CONCILIADO = 'N'
         AND NVL(MOV_CH_STATUSBXREF,'N') = 'N'
         AND MOV_DT_VENCTO BETWEEN TRUNC(P_DATA,'YYYY') AND P_DATA
         AND NVL(MOV_CH_SITUACAO,'A') <> 'C';

      -- Saldo Bancario Estimado = Saldo Conta - Pendentes
      V_SALDO_BANCARIO := NVL(V_SALDO_MEGA,0) - NVL(V_PENDENTES,0);

      IF V_SALDO_BANCARIO <> 0 OR R.ENTRADAS <> 0 OR R.SAIDAS <> 0 THEN
        PIPE ROW(MEGA.CCS_TY_GFIN_SALDOBCO_LIN(
          R.AGN_IN_CODIGO, R.AGN_ST_NOME,
          R.FIL_IN_CODIGO, R.FIL_ST_NOME,
          R.ENTRADAS, R.SAIDAS,
          V_SALDO_BANCARIO
        ));
      END IF;
    END LOOP;
    RETURN;
  END;
/
