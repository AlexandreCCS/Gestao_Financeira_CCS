CREATE OR REPLACE PROCEDURE      CCS_P_BLOQUEIA_CLIENTE_RESERVA(pROM_IN_CODIGO NUMBER) IS
  --*******************************************************************************--
  --NÃO INCLUIR COMMIT, POIS PROCEDURE É CHAMADA NO PROCESSO PENDENTE
  --NÃO INCLUIR COMMIT, POIS PROCEDURE É CHAMADA NO PROCESSO PENDENTE
  --NÃO INCLUIR COMMIT, POIS PROCEDURE É CHAMADA NO PROCESSO PENDENTE
  --*******************************************************************************--
  -- [07/05/2026 - ALTERADO POR ALEXANDRE CARVALHO] V2: MENSAGEM DE ERRO AGREGA
  -- TODAS AS OES BLOQUEADAS NUMA UNICA RAISE (ANTES SOBRESCREVIA vERRO A CADA
  -- ITERACAO E SO MOSTRAVA A ULTIMA OE) E PASSA A INCLUIR O AGN_IN_CODIGO PRA
  -- FACILITAR LOCALIZACAO DO CLIENTE NA TELA DE DESBLOQUEIO/APROVACAO.
  vCLIENTE       NUMBER := 0;
  vPOSSUI        VARCHAR2(1);
  vPEDIDOS       VARCHAR2(4000);
  vTEMBLOQUEIO   VARCHAR2(1);
  vTIPODOCUMENTO NUMBER;
  vEXECUTA       VARCHAR2(1);
  vDESCONSIDERA  VARCHAR2(1) := 'N';
  vTITULOS       VARCHAR2(4000) := '';
  vGRUPO         VARCHAR2(1);
  vERRO          VARCHAR2(4000) := NULL;
  -- [11/05/2026 - ALEXANDRE CARVALHO] V4: BLOQUEIO ADICIONAL POR SUFRAMA BLOQUEADO
  -- (DADOS DE CCS_TB_AGENTES_CNPJA, POPULADA PELO CRON VPS srv-ccs/cnpja-suframa).
  vBLOQ_SUF        VARCHAR2(1);
  vTEMBLOQUEIO_SUF VARCHAR2(1);
BEGIN
  BEGIN
    DELETE FROM MEGA.CCS_TB_PEDIDOS_BLOQUEADOS_MSG;
  END;
  FOR X IN (SELECT DISTINCT AGN.AGN_IN_CODIGO,
                            EXP.EXP_IN_CODIGO,
                            AGN.AGN_ST_NOME
              FROM CCS_TB_EXPEDICAO     T,
                   MEGA.VEN_EXPEDICAO   EXP,
                   MEGA.VEN_PEDIDOVENDA PV,
                   MEGA.GLO_AGENTES     AGN,
                   MEGA.VEN_TIPODOCUMENTOCMPESP CMP
             WHERE T.ROM_IN_CODIGO_EXP = pROM_IN_CODIGO
               AND T.EXP_IN_CODIGO = EXP.EXP_IN_CODIGO
               AND EXP.PED_IN_CODIGO = PV.PED_IN_CODIGO
               AND EXP.SER_ST_CODIGO = PV.SER_ST_CODIGO
               AND EXP.FIL_IN_CODIGO = PV.FIL_IN_CODIGO
               AND
                   PV.CLI_TAB_IN_CODIGO = AGN.AGN_TAB_IN_CODIGO
               AND PV.CLI_PAD_IN_CODIGO = AGN.AGN_PAD_IN_CODIGO
               AND PV.CLI_IN_CODIGO = AGN.AGN_IN_CODIGO
               AND PV.TPD_TAB_IN_CODIGO = CMP.TPD_TAB_IN_CODIGO (+)
               AND PV.TPD_PAD_IN_CODIGO = CMP.TPD_PAD_IN_CODIGO (+)
               AND PV.TPD_IN_CODIGO     = CMP.TPD_IN_CODIGO     (+)
               AND NVL(CMP.TPD_ST_NAOBLOQ_LOG,'N') = 'N'
               ) LOOP
    BEGIN
      vCLIENTE := X.AGN_IN_CODIGO;
      vEXECUTA := 'S';
      IF NVL(vCLIENTE, 0) NOT IN (0,
                                  200,
                                  400,
                                  800,
                                  401,
                                  1,
                                  9,
                                  10,
                                  20,
                                  30,
                                  40,
                                  90,
                                  100,
                                  200,
                                  300,
                                  400,
                                  401,
                                  402,
                                  403,
                                  404,
                                  450,
                                  460,
                                  500,
                                  501,
                                  502,
                                  503,
                                  504,
                                  550,
                                  560,
                                  570,
                                  600,
                                  700,
                                  710,
                                  800,
                                  900,
                                  950,
                                  960,
                                  970,
                                  999,
                                  21574,
                                  21704,
                                  21703) AND NVL(vEXECUTA, 'N') = 'S' THEN
        -- VERIFICA SE CLIENTE TEM ATRASO
        BEGIN
          SELECT DISTINCT 'S'
            INTO vPOSSUI
            FROM MEGA.FIN_VW_CONTASRECEBER X
           WHERE X.SALDO_EM_ABERTO > 0
             AND X.MOV_DT_PRORROGADO < TRUNC(SYSDATE - 2)
             AND X.AGN_IN_CODIGO = vCLIENTE
             AND X.TPD_ST_CODIGO NOT IN ('PDV');
        EXCEPTION
          WHEN NO_DATA_FOUND THEN
            vPOSSUI := 'N';
        END;
        -- VERIFICA SE CLIENTE ESTA EM GRUPO DE CREDITO
        FOR cGR IN (SELECT DISTINCT GR.GCR_ST_CODIGO
                      FROM MEGA.VEN_AGENTESGRUPO GR
                     WHERE GR.AGN_IN_CODIGO = vCLIENTE) LOOP
          BEGIN
            FOR cCLIGR IN (SELECT *
                             FROM MEGA.VEN_AGENTESGRUPO M
                            WHERE M.GCR_ST_CODIGO = cGR.Gcr_St_Codigo) LOOP
              BEGIN
                BEGIN
                  SELECT DISTINCT 'S'
                    INTO vGRUPO
                    FROM MEGA.FIN_VW_CONTASRECEBER X
                   WHERE X.SALDO_EM_ABERTO > 0
                     AND X.MOV_DT_PRORROGADO < TRUNC(SYSDATE - 2)
                     AND X.AGN_IN_CODIGO = cCLIGR.Agn_In_Codigo
                     AND X.TPD_ST_CODIGO NOT IN ('PDV');
                EXCEPTION
                  WHEN NO_DATA_FOUND THEN
                    NULL;
                END;
                IF NVL(vGRUPO, 'N') = 'S' THEN
                  vPOSSUI := 'S';
                END IF;
              END;
            END LOOP;
          END;
        END LOOP;
        vPEDIDOS := '';
        vTITULOS := '';
        IF NVL(vPOSSUI, 'N') = 'S' THEN
          FOR ZI IN (SELECT X.MOV_ST_DOCUMENTO, X.FIL_IN_CODIGO
                       FROM MEGA.FIN_VW_CONTASRECEBER X
                      WHERE X.SALDO_EM_ABERTO > 0
                        AND X.MOV_DT_PRORROGADO < TRUNC(SYSDATE - 1)
                        AND X.AGN_IN_CODIGO = vCLIENTE
                        AND X.TPD_ST_CODIGO NOT IN ('PDV')
                        AND X.FIL_IN_CODIGO not in (401, 501)) LOOP
            BEGIN
              vTITULOS := vTITULOS || ' - ' || ZI.MOV_ST_DOCUMENTO || ' - ' ||
                          ZI.FIL_IN_CODIGO || ' - ';
            END;
          END LOOP;
        END IF;
        -- ANALISA GRUPO DE CRÉDITO
        IF NVL(vPOSSUI, 'N') = 'S' AND NVL(vTITULOS, 'N') = 'N' THEN
          vTITULOS := vTITULOS || 'TITULOS DO GRUPO COM PENDENCIA';
        END IF;
        BEGIN
          SELECT DISTINCT 'S'
            INTO vDESCONSIDERA
            FROM MEGA.VEN_AGENTESGRUPO AGN, MEGA.VEN_GRUPOCREDITOCMPESP GCR
           WHERE AGN.GCR_TAB_IN_CODIGO = GCR.GCR_TAB_IN_CODIGO
             AND AGN.GCR_PAD_IN_CODIGO = GCR.GCR_PAD_IN_CODIGO
             AND AGN.GCR_ST_CODIGO = GCR.GCR_ST_CODIGO
             AND NVL(GCR.GCR_ST_NAOBLOQUEIA, 'N') = 'S'
             AND AGN.AGN_IN_CODIGO = vCLIENTE;
        EXCEPTION
          WHEN NO_DATA_FOUND THEN
            vDESCONSIDERA := 'N';
        END;
        IF NVL(vDESCONSIDERA, 'N') = 'N' THEN
          IF NVL(vPOSSUI, 'N') = 'S' THEN
            -- VERIFICA SE CLIENTE POSSUI APROVACAO PENDENTE
            BEGIN
              SELECT DISTINCT 'S'
                INTO vTEMBLOQUEIO
                FROM MEGA.GLO_AGENTESCMPESP A
               WHERE A.AGN_IN_CODIGO = vCLIENTE
                 AND NVL(A.AGN_BO_BLOQUEIO, 'N') = 'S';
            EXCEPTION
              WHEN NO_DATA_FOUND THEN
                vTEMBLOQUEIO := 'N';
            END;
            IF NVL(vTEMBLOQUEIO, 'N') = 'N' THEN
              -- CASO TENHA BLOQUEIO, DIGA QUAL OE DE QUAL CLIENTE TEM TITULO ATRASADO
              BEGIN
                -- VERIFICA QUAL PEDIDOS QUE ESTÃO BLOQUEADOS
                /*FOR C IN (SELECT DISTINCT ITPITN.PE_PED_IN_CODIGO
                 FROM MEGA.VEN_ITEMPEDI_VEN_ITEMNOT ITPITN
                WHERE 1 = 1
                  AND ITPITN.NF_ORG_IN_CODIGO = pORG_IN_CODIGO
                  AND ITPITN.NF_SEQ_IN_CODIGO = pSEQ_IN_CODIGO
                  AND ITPITN.NF_NOT_IN_CODIGO = pNOT_IN_CODIGO) LOOP*/
                BEGIN
                  vPEDIDOS := X.EXP_IN_CODIGO;
                END;
                -- END LOOP;
                vPEDIDOS := SUBSTR(vPEDIDOS, 1, LENGTH(vPEDIDOS) - 1);
                vPEDIDOS := 'OE: ' || vPEDIDOS;
              END;
              /* BEGIN
                INSERT INTO MEGA.CCS_TB_PEDIDOS_BLOQUEADOS
                  (ORG_IN_CODIGO,
                   SEQ_IN_CODIGO,
                   PED_ST_CODIGOS,
                   AGN_IN_CODIGO,
                   DATA_GERACAO,
                   CONTADOR)
                VALUES
                  (10,
                   1,
                   vPEDIDOS,
                   vCLIENTE,
                   TRUNC(SYSDATE),
                   1);
              END;*/
              BEGIN
                INSERT INTO MEGA.CCS_TB_PEDIDOS_BLOQUEADOS_MSG
                  (OE, CLIENTE, MSG, AGN_IN_CODIGO)
                VALUES
                  (X.EXP_IN_CODIGO,
                   X.AGN_ST_NOME,
                   'Cliente possui titulos em aberto, favor solicitar aprovação!  ',
                   vCLIENTE);
              END;
              -- [14/05/2026 - ALTERADO POR ALEXANDRE CARVALHO] LOG DO BLOQUEIO
              -- PARA O GESTOR FINANCEIRO CCS (INADIMPLENCIA > BLOQUEIOS).
              MEGA.CCS_P_GFIN_LOG_BLOQUEIO('RESERVA', vCLIENTE, X.AGN_ST_NOME,
                'OE ' || X.EXP_IN_CODIGO, 'FINANCEIRO', vTITULOS);
            ELSE
              --RAISE_APPLICATION_ERROR (-20000, 'Cliente possui Aprovação de Crédito a ser efetuada!' );
              /*BEGIN
                -- DESMARCA APROVAÇÃO
                UPDATE MEGA.GLO_AGENTESCMPESP X
                   SET X.AGN_BO_BLOQUEIO = 'N'
                 WHERE X.AGN_IN_CODIGO = vCLIENTE;
              END;*/
              NULL;
            END IF;
          END IF;
        END IF;
        -- [11/05/2026 - ALEXANDRE CARVALHO] V4: BLOQUEIO POR SUFRAMA BLOQUEADO.
        -- LE FLAG AGN_ST_BLOQ_SUFRAMA_CNPJA EM CCS_TB_AGENTES_CNPJA (CACHE DA API CNPJa).
        -- USA MESMA WHITELIST DA VERIFICACAO FINANCEIRA E RESPEITA APROVACAO MANUAL
        -- DO DIA (AGN_BO_BLOQUEIO='S' EM GLO_AGENTESCMPESP).
        BEGIN
          SELECT 'S'
            INTO vBLOQ_SUF
            FROM MEGA.CCS_TB_AGENTES_CNPJA
           WHERE AGN_IN_CODIGO = vCLIENTE
             AND NVL(AGN_ST_BLOQ_SUFRAMA_CNPJA, 'N') = 'S'
             AND ROWNUM = 1;
        EXCEPTION
          WHEN NO_DATA_FOUND THEN
            vBLOQ_SUF := 'N';
        END;
        IF NVL(vBLOQ_SUF, 'N') = 'S' THEN
          BEGIN
            SELECT DISTINCT 'S'
              INTO vTEMBLOQUEIO_SUF
              FROM MEGA.GLO_AGENTESCMPESP A
             WHERE A.AGN_IN_CODIGO = vCLIENTE
               AND NVL(A.AGN_BO_BLOQUEIO, 'N') = 'S';
          EXCEPTION
            WHEN NO_DATA_FOUND THEN
              vTEMBLOQUEIO_SUF := 'N';
          END;
          IF NVL(vTEMBLOQUEIO_SUF, 'N') = 'N' THEN
            BEGIN
              INSERT INTO MEGA.CCS_TB_PEDIDOS_BLOQUEADOS_MSG
                (OE, CLIENTE, MSG, AGN_IN_CODIGO)
              VALUES
                (X.EXP_IN_CODIGO,
                 X.AGN_ST_NOME,
                 'Cliente bloqueado no SUFRAMA (consulta CNPJa).',
                 vCLIENTE);
            END;
            -- [14/05/2026 - ALTERADO POR ALEXANDRE CARVALHO] LOG DO BLOQUEIO (SUFRAMA).
            MEGA.CCS_P_GFIN_LOG_BLOQUEIO('RESERVA', vCLIENTE, X.AGN_ST_NOME,
              'OE ' || X.EXP_IN_CODIGO, 'SUFRAMA', NULL);
          END IF;
        END IF;
      END IF;
    END;
  END LOOP;
  COMMIT;
  BEGIN
    -- [07/05/2026 - ALTERADO POR ALEXANDRE CARVALHO] AGREGA TODAS AS OES
    -- BLOQUEADAS NUMA UNICA MENSAGEM (ANTES O := SOBRESCREVIA A CADA ITERACAO).
    -- [07/05/2026 - ALTERADO POR ALEXANDRE CARVALHO] V3: REMOVIDO OE DO TEXTO.
    -- AGORA LISTA APENAS UMA LINHA POR CLIENTE (DISTINCT) COM AGN_IN_CODIGO E
    -- NOME, PARA REDUZIR POLUICAO QUANDO O MESMO CLIENTE TEM VARIAS OES NO
    -- ROMANEIO.
    FOR I IN (SELECT K.AGN_IN_CODIGO,
                       MAX(K.CLIENTE) AS CLIENTE,
                       LISTAGG(DISTINCT K.MSG, ' | ') WITHIN GROUP (ORDER BY K.MSG) AS MOTIVOS
                  FROM MEGA.CCS_TB_PEDIDOS_BLOQUEADOS_MSG K
                 GROUP BY K.AGN_IN_CODIGO
                 ORDER BY K.AGN_IN_CODIGO) LOOP
      BEGIN
        IF vERRO IS NULL THEN
          vERRO := 'Existem cliente(s) bloqueado(s) nesse romaneio:' || chr(13) || chr(10);
        END IF;
        vERRO := vERRO || ' - Cliente: ' || I.AGN_IN_CODIGO ||
                          ' - ' || I.CLIENTE ||
                          ' - ' || I.MOTIVOS ||
                          chr(13) || chr(10);
      END;
    END LOOP;
    IF vERRO IS NOT NULL THEN
      RAISE_APPLICATION_ERROR(-20000, SUBSTR(vERRO, 1, 3900));
    END IF;
  END;
END;
