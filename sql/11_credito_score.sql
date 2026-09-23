-- ============================================================================
-- [14/05/2026 - CRIADO POR ALEXANDRE CARVALHO] Inteligencia de Credito - Fase 1.2
-- Motor de score de risco do Gestor Financeiro CCS.
--
-- Fonte do comportamento de pagamento: estatistica NATIVA do Mega
--   FIN_PCK_ESTATISTICA.F_GetEstatistica(pad,cod,'C') -> grava GLO_ESTATISTICAAGN
-- (atraso medio, maior atraso, maior acumulo, cartorio, cheques devolvidos...).
-- Como esse cache e lazy, ha um refresh throttled (CCS_P_GFIN_REFRESH_ESTATISTICA)
-- que atualiza os N clientes mais desatualizados por execucao - auto-convergente.
--
-- Score 0..1000, 5 componentes (pesos em CCS_TB_GFIN_SCORE_PARAM):
--   C_COMPORTAMENTO  - atraso medio e maior atraso historico (GLO_ESTATISTICAAGN)
--   C_INADIMPLENCIA  - % saldo vencido e maior atraso atual (CCS_TB_GFIN_CARTEIRA_SNAP)
--   C_TENDENCIA      - variacao do saldo vencido vs 30 dias atras (serie do snapshot)
--   C_EXPOSICAO      - saldo atual vs maior acumulo historico (proxy de limite)
--   C_EXTERNO        - sinais negativos: cartorio, cheque devolvido, bloqueios
-- Classe: A>=FAIXA_A, B>=FAIXA_B, C>=FAIXA_C, D>=FAIXA_D, senao E.
-- ============================================================================

-- 1. Parametros adicionais do score (limites de normalizacao) ------------------
-- O throttle do refresh (REFRESH_ESTAT_LIMITE) deixou de ser parametro:
-- agora e limite fixo (500) dentro da CCS_P_GFIN_REFRESH_ESTATISTICA.
BEGIN
  MERGE INTO MEGA.CCS_TB_GFIN_SCORE_PARAM D
  USING (
    SELECT 'NORM_ATRASO_MEDIO'    AS CH, 20  AS VL, 'Dias de atraso medio que zera o componente comportamento' AS DS FROM DUAL UNION ALL
    SELECT 'NORM_MAIOR_ATRASO',         90,  'Dias do maior atraso historico que zera o sub-componente' FROM DUAL UNION ALL
    SELECT 'NORM_ATRASO_ATUAL',        120,  'Dias do maior atraso atual que zera o sub-componente de inadimplencia' FROM DUAL
  ) S
  ON (D.PARAM_ST_CHAVE = S.CH)
  WHEN MATCHED THEN UPDATE SET D.PARAM_ST_DESCRICAO = S.DS
  WHEN NOT MATCHED THEN INSERT (PARAM_ST_CHAVE, PARAM_RE_VALOR, PARAM_ST_DESCRICAO)
                        VALUES (S.CH, S.VL, S.DS);
  -- remove o parametro antigo (virou limite fixo na procedure)
  DELETE FROM MEGA.CCS_TB_GFIN_SCORE_PARAM WHERE PARAM_ST_CHAVE = 'REFRESH_ESTAT_LIMITE';
  COMMIT;
END;
/

-- 2. Refresh throttled da estatistica nativa do Mega ---------------------------
-- Atualiza ate pLIMITE clientes do snapshot de hoje cuja GLO_ESTATISTICAAGN esta
-- ausente ou com mais de 7 dias, priorizando os mais desatualizados. Cada chamada
-- a F_GetEstatistica recalcula e regrava o cache nativo. Auto-convergente: em
-- poucas noites toda a carteira fica fresca e depois so mantem.
CREATE OR REPLACE PROCEDURE MEGA.CCS_P_GFIN_REFRESH_ESTATISTICA(pLIMITE IN NUMBER DEFAULT NULL) IS
  -- Limite fixo de 500 clientes por execucao. pLIMITE permite sobrepor
  -- pontualmente (ex.: lote menor em teste); o job sempre chama sem argumento.
  vLIM   NUMBER := NVL(pLIMITE, 500);
  vTMP   NUMBER;
BEGIN
  FOR c IN (
    SELECT S.AGN_IN_CODIGO
      FROM MEGA.CCS_TB_GFIN_CARTEIRA_SNAP S,
           (SELECT AGN_IN_CODIGO, MAX(EST_DT_ATUALIZACAO) ULT
              FROM MEGA.GLO_ESTATISTICAAGN GROUP BY AGN_IN_CODIGO) E
     WHERE E.AGN_IN_CODIGO (+) = S.AGN_IN_CODIGO
       AND S.SNAP_DT = TRUNC(SYSDATE)
       AND (E.ULT IS NULL OR E.ULT < TRUNC(SYSDATE) - 7)
     ORDER BY E.ULT ASC NULLS FIRST
  ) LOOP
    EXIT WHEN vLIM <= 0;
    BEGIN
      -- iterar a pipelined forca o recalculo + regravacao do cache nativo
      SELECT COUNT(*) INTO vTMP
        FROM TABLE(MEGA.FIN_PCK_ESTATISTICA.F_GetEstatistica(1, c.AGN_IN_CODIGO, 'C'));
    EXCEPTION WHEN OTHERS THEN
      NULL;  -- um cliente com erro nunca derruba o lote
    END;
    vLIM := vLIM - 1;
  END LOOP;
  COMMIT;
END CCS_P_GFIN_REFRESH_ESTATISTICA;
/

-- 3. Motor de score ------------------------------------------------------------
CREATE OR REPLACE PROCEDURE MEGA.CCS_P_GFIN_CALC_SCORE(pDATA IN DATE DEFAULT NULL) IS
  vDT     DATE := TRUNC(NVL(pDATA, SYSDATE));
  pComp   NUMBER; pInad NUMBER; pTend NUMBER; pExpo NUMBER; pExt NUMBER;
  fA      NUMBER; fB NUMBER; fC NUMBER; fD NUMBER;
  nAtMed  NUMBER; nMaiAt NUMBER; nAtAtu NUMBER;

  FUNCTION par(pCh VARCHAR2, pDef NUMBER) RETURN NUMBER IS
    v NUMBER;
  BEGIN
    SELECT PARAM_RE_VALOR INTO v FROM MEGA.CCS_TB_GFIN_SCORE_PARAM
     WHERE PARAM_ST_CHAVE = pCh;
    RETURN v;
  EXCEPTION WHEN NO_DATA_FOUND THEN RETURN pDef;
  END;
BEGIN
  pComp  := par('PESO_COMPORTAMENTO', 0.35);
  pInad  := par('PESO_INADIMPLENCIA', 0.30);
  pTend  := par('PESO_TENDENCIA',     0.15);
  pExpo  := par('PESO_EXPOSICAO',     0.10);
  pExt   := par('PESO_EXTERNO',       0.10);
  fA     := par('FAIXA_A', 800);
  fB     := par('FAIXA_B', 600);
  fC     := par('FAIXA_C', 400);
  fD     := par('FAIXA_D', 200);
  nAtMed := par('NORM_ATRASO_MEDIO',  20);
  nMaiAt := par('NORM_MAIOR_ATRASO',  90);
  nAtAtu := par('NORM_ATRASO_ATUAL', 120);

  MERGE INTO MEGA.CCS_TB_GFIN_SCORE D
  USING (
    SELECT q.AGN_IN_CODIGO,
           q.c_comp, q.c_inad, q.c_tend, q.c_expo, q.c_ext,
           ROUND(1000 * (pComp*q.c_comp + pInad*q.c_inad + pTend*q.c_tend
                       + pExpo*q.c_expo + pExt*q.c_ext)) AS score,
           ROUND(NVL(q.maiacumulo,0) *
                 (0.5 + (pComp*q.c_comp + pInad*q.c_inad + pTend*q.c_tend
                       + pExpo*q.c_expo + pExt*q.c_ext) / 2), -2) AS limite_sugerido
      FROM (
        SELECT b.AGN_IN_CODIGO, b.maiacumulo,
               -- C_COMPORTAMENTO: atraso medio (0.7) + maior atraso historico (0.3)
               -- sem estatistica nativa ainda = neutro 0.5 (nao inflar como pagador perfeito)
               CASE WHEN b.diasatrasomed IS NULL THEN 0.5
                    ELSE ( 0.7 * GREATEST(0, 1 - b.diasatrasomed       / nAtMed)
                         + 0.3 * GREATEST(0, 1 - NVL(b.ndiasmaiatraso,0) / nMaiAt) ) END AS c_comp,
               -- C_INADIMPLENCIA: % saldo vencido (0.6) + maior atraso atual (0.4)
               ( 0.6 * (1 - CASE WHEN b.saldo_total > 0
                                 THEN b.saldo_vencido / b.saldo_total ELSE 0 END)
               + 0.4 * GREATEST(0, 1 - b.maior_atraso_dias / nAtAtu) ) AS c_inad,
               -- C_TENDENCIA: vencido caiu vs 30d atras = bom; sem historico = neutro
               CASE WHEN b.venc_30 IS NULL                       THEN 0.5
                    WHEN b.venc_30 = 0 AND b.saldo_vencido = 0   THEN 0.8
                    WHEN b.venc_30 = 0                           THEN 0.3
                    ELSE GREATEST(0, LEAST(1,
                         0.5 + (b.venc_30 - b.saldo_vencido) / (2 * b.venc_30))) END AS c_tend,
               -- C_EXPOSICAO: saldo atual vs maior acumulo historico (proxy de limite)
               CASE WHEN NVL(b.maiacumulo,0) <= 0 THEN 0.5
                    ELSE GREATEST(0, LEAST(1, 1 - b.saldo_total / b.maiacumulo)) END AS c_expo,
               -- C_EXTERNO: penalidades por sinais negativos de credito.
               -- SUFRAMA NAO entra: e bloqueio fiscal/regulatorio, nunca pesa no credito
               -- (qt_bloqueios abaixo so conta os bloqueios de motivo FINANCEIRO).
               GREATEST(0, 1
                 - CASE WHEN NVL(b.valorcartorio,0)   > 0 THEN 0.4 ELSE 0 END
                 - CASE WHEN NVL(b.chequedevolvido,0) > 0 THEN 0.3 ELSE 0 END
                 - LEAST(0.3, NVL(b.qt_bloqueios,0) * 0.05) ) AS c_ext
          FROM (
            SELECT S.AGN_IN_CODIGO,
                   S.SALDO_TOTAL       AS saldo_total,
                   S.SALDO_VENCIDO     AS saldo_vencido,
                   S.MAIOR_ATRASO_DIAS AS maior_atraso_dias,
                   E.DIASATRASOMED     AS diasatrasomed,
                   E.NDIASMAIATRASO    AS ndiasmaiatraso,
                   E.VALORCARTORIO     AS valorcartorio,
                   E.CHEQUEDEVOLVIDO   AS chequedevolvido,
                   E.MAIACUMULO        AS maiacumulo,
                   S30.SALDO_VENCIDO   AS venc_30,
                   B.QT                AS qt_bloqueios
              FROM MEGA.CCS_TB_GFIN_CARTEIRA_SNAP S,
                   (SELECT AGN_IN_CODIGO,
                           MAX(CASE WHEN ATE_ST_CODIGO='DIASATRASOMED'   THEN EST_RE_VRNUM END) DIASATRASOMED,
                           MAX(CASE WHEN ATE_ST_CODIGO='NDIASMAIATRASO'  THEN EST_RE_VRNUM END) NDIASMAIATRASO,
                           MAX(CASE WHEN ATE_ST_CODIGO='VALORCARTORIO'   THEN EST_RE_VRNUM END) VALORCARTORIO,
                           MAX(CASE WHEN ATE_ST_CODIGO='CHEQUEDEVOLVIDO' THEN EST_RE_VRNUM END) CHEQUEDEVOLVIDO,
                           MAX(CASE WHEN ATE_ST_CODIGO='MAIACUMULO'      THEN EST_RE_VRNUM END) MAIACUMULO
                      FROM MEGA.GLO_ESTATISTICAAGN
                     GROUP BY AGN_IN_CODIGO) E,
                   MEGA.CCS_TB_GFIN_CARTEIRA_SNAP S30,
                   (SELECT AGN_IN_CODIGO, COUNT(*) QT
                      FROM MEGA.CCS_TB_GFIN_BLOQUEIO_LOG
                     WHERE BLO_ST_MOTIVO = 'FINANCEIRO'   -- SUFRAMA nunca pesa no score de credito
                     GROUP BY AGN_IN_CODIGO) B
             WHERE S.SNAP_DT = vDT
               AND E.AGN_IN_CODIGO   (+) = S.AGN_IN_CODIGO
               AND S30.AGN_IN_CODIGO (+) = S.AGN_IN_CODIGO
               AND S30.SNAP_DT       (+) = vDT - 30
               AND B.AGN_IN_CODIGO   (+) = S.AGN_IN_CODIGO
          ) b
      ) q
  ) S
  ON (D.AGN_IN_CODIGO = S.AGN_IN_CODIGO)
  WHEN MATCHED THEN UPDATE SET
    D.SCORE = S.score, D.CLASSE = CASE WHEN S.score >= fA THEN 'A'
                                       WHEN S.score >= fB THEN 'B'
                                       WHEN S.score >= fC THEN 'C'
                                       WHEN S.score >= fD THEN 'D' ELSE 'E' END,
    D.C_COMPORTAMENTO = S.c_comp, D.C_INADIMPLENCIA = S.c_inad,
    D.C_TENDENCIA = S.c_tend, D.C_EXPOSICAO = S.c_expo, D.C_EXTERNO = S.c_ext,
    D.LIMITE_SUGERIDO = S.limite_sugerido, D.DT_CALCULO = SYSDATE
  WHEN NOT MATCHED THEN INSERT
    (AGN_IN_CODIGO, SCORE, CLASSE, C_COMPORTAMENTO, C_INADIMPLENCIA,
     C_TENDENCIA, C_EXPOSICAO, C_EXTERNO, LIMITE_SUGERIDO, DT_CALCULO)
  VALUES
    (S.AGN_IN_CODIGO, S.score, CASE WHEN S.score >= fA THEN 'A'
                                    WHEN S.score >= fB THEN 'B'
                                    WHEN S.score >= fC THEN 'C'
                                    WHEN S.score >= fD THEN 'D' ELSE 'E' END,
     S.c_comp, S.c_inad, S.c_tend, S.c_expo, S.c_ext, S.limite_sugerido, SYSDATE);

  -- replica score/classe no snapshot do dia (serie temporal de score)
  UPDATE MEGA.CCS_TB_GFIN_CARTEIRA_SNAP C
     SET (C.SCORE, C.CLASSE) = (SELECT G.SCORE, G.CLASSE
                                  FROM MEGA.CCS_TB_GFIN_SCORE G
                                 WHERE G.AGN_IN_CODIGO = C.AGN_IN_CODIGO)
   WHERE C.SNAP_DT = vDT
     AND EXISTS (SELECT 1 FROM MEGA.CCS_TB_GFIN_SCORE G
                  WHERE G.AGN_IN_CODIGO = C.AGN_IN_CODIGO);
  COMMIT;
END CCS_P_GFIN_CALC_SCORE;
/

-- 4. Re-cria o job diario encadeando snapshot -> refresh estatistica -> score --
BEGIN
  BEGIN
    DBMS_SCHEDULER.DROP_JOB('MEGA.CCS_JOB_GFIN_SNAPSHOT', TRUE);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  DBMS_SCHEDULER.CREATE_JOB(
    JOB_NAME        => 'MEGA.CCS_JOB_GFIN_SNAPSHOT',
    JOB_TYPE        => 'PLSQL_BLOCK',
    JOB_ACTION      => 'BEGIN MEGA.CCS_P_GFIN_SNAPSHOT_CARTEIRA; ' ||
                       'MEGA.CCS_P_GFIN_REFRESH_ESTATISTICA; ' ||
                       'MEGA.CCS_P_GFIN_CALC_SCORE; END;',
    START_DATE      => TRUNC(SYSDATE) + 1 + 3.5/24,
    REPEAT_INTERVAL => 'FREQ=DAILY; BYHOUR=3; BYMINUTE=30; BYSECOND=0',
    ENABLED         => TRUE,
    AUTO_DROP       => FALSE,
    COMMENTS        => 'Gestor Financeiro CCS - Inteligencia de Credito: snapshot + refresh estatistica + score'
  );
END;
/
