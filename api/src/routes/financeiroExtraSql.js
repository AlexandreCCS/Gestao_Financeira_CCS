// [09/10/2026 - Alexandre Carvalho] SQL das telas do lote 2 do pedido "Gestor Financeiro – BI" (Quality).
// Modulo so de texto SQL (sem I/O): as rotas em financeiroExtra.js usam estas funcoes e os scripts de teste
// (agenda gf_07) rodam exatamente o mesmo texto no banco antes do deploy.
// Fontes levantadas em 09/10/2026 (agenda gf_ag_01..19):
//   creditos   = FIN_VW_ADIANTAMENTO (SALDO = credito ainda nao usado; TAU C cliente / F fornecedor)
//   movimento  = FIN_MOVIMENTO origem M (conta financeira em GLO_CONTASFIN); C = saida, D = entrada;
//                transferencia = acao 712 (TRANSFD sai / TRANSFC entra), contraparte por FIN_REFERENCIAFIN
//   pedidos    = EST_PEDCOMPRAS.PDC_ST_SITUACAO (AA em aprovacao, PA aberto/aprovado, PB atendido, PR reprovado, PC cancelado, PE encerrado)
//   solicitac. = titulo do contas a pagar x alcada Approvo (WGLO_ALCADA_DOCUMENTO aplicacao 13): sem documento = implantado
//   alteracoes = FIN_MOVIMENTO_LOG (datas) + CCS_TB_LOG_FORMA_REC (forma) + CCS_TB_LIBERA_EXC_ALT_EXEC (exc/alt liberadas)

const dt = s => `TO_DATE('${s}','YYYY-MM-DD')`;
const nomeUsu = col => `(SELECT MAX(GU.GRU_ST_NOME) FROM MEGA.GLO_GRUPO_USUARIO GU WHERE GU.GRU_IN_CODIGO = ${col})`;
const nomeAgn = col => `(SELECT MAX(NVL(AG.AGN_ST_FANTASIA, AG.AGN_ST_NOME)) FROM MEGA.GLO_AGENTES AG WHERE AG.AGN_IN_CODIGO = ${col})`;

// ---------------------------------------------------------------- Creditos de agentes (credito ainda nao usado)
export const sqlCreditosResumo = tau => `
  SELECT A.AGN_IN_CODIGO                                   AS AGN,
         MAX(A.AGN_ST_NOME)                                AS NOME,
         A.AGN_TAU_ST_CODIGO                               AS TAU,
         COUNT(*)                                          AS QTD,
         SUM(A.SALDO)                                      AS SALDO,
         SUM(A.MOV_RE_VALOR)                               AS VALOR,
         TO_CHAR(MIN(A.MOV_DT_DATADOCTO),'YYYY-MM-DD')     AS MAIS_ANTIGO,
         TO_CHAR(MAX(A.MOV_DT_DATADOCTO),'YYYY-MM-DD')     AS MAIS_RECENTE,
         LISTAGG(DISTINCT A.FIL_IN_CODIGO, ',') WITHIN GROUP (ORDER BY A.FIL_IN_CODIGO) AS FILIAIS
    FROM MEGA.FIN_VW_ADIANTAMENTO A
   WHERE NVL(A.MOV_CH_SITUACAO,'X') <> 'C'
     AND A.SALDO > 0.009
     ${tau ? `AND A.AGN_TAU_ST_CODIGO = '${tau}'` : ''}
   GROUP BY A.AGN_IN_CODIGO, A.AGN_TAU_ST_CODIGO
   ORDER BY SUM(A.SALDO) DESC`;

export const sqlCreditosDetalhe = agn => `
  SELECT A.FIL_IN_CODIGO                                   AS FIL,
         A.MOV_ST_DOCUMENTO                                AS DOC,
         A.MOV_ST_PARCELA                                  AS PARC,
         A.TPD_ST_CODIGO                                   AS TPD,
         A.ACAO_IN_CODIGO                                  AS ACAO,
         (SELECT SUBSTR(MAX(AC.ACAO_ST_NOME),1,50) FROM MEGA.GLO_ACAO AC
           WHERE AC.ACAO_TAB_IN_CODIGO = A.ACAO_TAB_IN_CODIGO AND AC.ACAO_PAD_IN_CODIGO = A.ACAO_PAD_IN_CODIGO
             AND AC.ACAO_IN_CODIGO = A.ACAO_IN_CODIGO)     AS ACAO_NOME,
         TO_CHAR(A.MOV_DT_DATADOCTO,'YYYY-MM-DD')          AS DATA,
         A.MOV_RE_VALOR                                    AS VALOR,
         A.SALDO                                           AS SALDO,
         A.AGN_IN_CODIGOFIN                                AS CONTA,
         ${nomeAgn('A.AGN_IN_CODIGOFIN')}                  AS CONTA_NOME,
         (SELECT MAX(F.MOV_CH_CONCILIADO) FROM MEGA.FIN_MOVIMENTO F
           WHERE F.ORG_IN_CODIGO = A.ORG_IN_CODIGO AND F.AGN_IN_CODIGO = A.AGN_IN_CODIGOFIN
             AND F.MOV_ST_DOCUMENTO = A.MOV_ST_DOCUMENTOFIN AND F.ACAOM_IN_SEQUENCIA = A.ACAOM_IN_SEQUENCIA) AS CONC_BANCO,
         SUBSTR(A.MOV_ST_COMPLHIST,1,120)                  AS HIST
    FROM MEGA.FIN_VW_ADIANTAMENTO A
   WHERE A.AGN_IN_CODIGO = ${Number(agn)}
     AND NVL(A.MOV_CH_SITUACAO,'X') <> 'C'
     AND A.SALDO > 0.009
   ORDER BY A.MOV_DT_DATADOCTO`;

// ---------------------------------------------------------------- Movimento por conta (pagamentos/recebimentos/transferencias)
const keyM  = p => `${p}.ORG_TAB_IN_CODIGO=M.ORG_TAB_IN_CODIGO AND ${p}.ORG_PAD_IN_CODIGO=M.ORG_PAD_IN_CODIGO AND ${p}.ORG_IN_CODIGO=M.ORG_IN_CODIGO AND ${p}.ORG_TAU_ST_CODIGO=M.ORG_TAU_ST_CODIGO AND ${p}.MOV_TAB_IN_CODIGO=M.MOV_TAB_IN_CODIGO AND ${p}.MOV_SEQ_IN_CODIGO=M.MOV_SEQ_IN_CODIGO AND ${p}.MOV_IN_NUMLANCTO=M.MOV_IN_NUMLANCTO`;
const keyORI = keyM('R').replace(/R\.(ORG|MOV)_/g, 'R.ORI_$1_');   // M no papel ORI (baixa = movimento da conta)
const keyREF = keyM('R').replace(/R\.(ORG|MOV)_/g, 'R.REF_$1_');   // M no papel REF (perna destino da transferencia)
const tituloDe = (papelM, papelT) => `
   (SELECT MAX(T.AGN_IN_CODIGO||'§'||SUBSTR(NVL(AG.AGN_ST_FANTASIA,AG.AGN_ST_NOME),1,40)||'§'||T.MOV_ST_DOCUMENTO||'/'||T.MOV_ST_PARCELA||'§'||R.REF_ST_TIPO)
      FROM MEGA.FIN_REFERENCIAFIN R, MEGA.FIN_MOVIMENTO T, MEGA.GLO_AGENTES AG
     WHERE ${papelM} AND R.REF_ST_TIPO IN ('BXCPA','BXCRE','ADIANT')
       AND T.ORG_TAB_IN_CODIGO=R.${papelT}ORG_TAB_IN_CODIGO AND T.ORG_PAD_IN_CODIGO=R.${papelT}ORG_PAD_IN_CODIGO AND T.ORG_IN_CODIGO=R.${papelT}ORG_IN_CODIGO
       AND T.ORG_TAU_ST_CODIGO=R.${papelT}ORG_TAU_ST_CODIGO AND T.MOV_TAB_IN_CODIGO=R.${papelT}MOV_TAB_IN_CODIGO
       AND T.MOV_SEQ_IN_CODIGO=R.${papelT}MOV_SEQ_IN_CODIGO AND T.MOV_IN_NUMLANCTO=R.${papelT}MOV_IN_NUMLANCTO
       AND AG.AGN_TAB_IN_CODIGO=T.AGN_TAB_IN_CODIGO AND AG.AGN_PAD_IN_CODIGO=T.AGN_PAD_IN_CODIGO AND AG.AGN_IN_CODIGO=T.AGN_IN_CODIGO)`;

export const sqlMovimentoConta = ({ ini, fim, natureza, conta }) => `
  SELECT M.AGN_IN_CODIGO                                   AS CONTA,
         ${nomeAgn('M.AGN_IN_CODIGO')}                     AS CONTA_NOME,
         M.FIL_IN_CODIGO                                   AS FIL,
         TO_CHAR(M.MOV_DT_DATADOCTO,'YYYY-MM-DD')          AS DIA,
         M.MOV_CH_NATUREZA                                 AS NAT,
         M.ACAO_IN_CODIGO                                  AS ACAO,
         (SELECT SUBSTR(MAX(AC.ACAO_ST_NOME),1,40) FROM MEGA.GLO_ACAO AC
           WHERE AC.ACAO_TAB_IN_CODIGO = M.ACAO_TAB_IN_CODIGO AND AC.ACAO_PAD_IN_CODIGO = M.ACAO_PAD_IN_CODIGO
             AND AC.ACAO_IN_CODIGO = M.ACAO_IN_CODIGO)     AS ACAO_NOME,
         M.TPD_ST_CODIGO                                   AS TPD,
         M.MOV_IN_NUMLANCTO                                AS LANC,
         M.MOV_ST_DOCUMENTO                                AS DOC,
         M.MOV_RE_VALOR                                    AS VALOR,
         M.MOV_CH_CONCILIADO                               AS CONC,
         CASE WHEN M.ACAO_IN_CODIGO = 712 THEN
           NVL((SELECT MAX(T.AGN_IN_CODIGO||'§'||SUBSTR(NVL(AG.AGN_ST_FANTASIA,AG.AGN_ST_NOME),1,40))
                  FROM MEGA.FIN_REFERENCIAFIN R, MEGA.FIN_MOVIMENTO T, MEGA.GLO_AGENTES AG
                 WHERE ${keyM('R')} AND R.REF_ST_TIPO IN ('TRANSF','TRANSFDEST')
                   AND T.ORG_IN_CODIGO=R.REF_ORG_IN_CODIGO AND T.MOV_TAB_IN_CODIGO=R.REF_MOV_TAB_IN_CODIGO
                   AND T.MOV_SEQ_IN_CODIGO=R.REF_MOV_SEQ_IN_CODIGO AND T.MOV_IN_NUMLANCTO=R.REF_MOV_IN_NUMLANCTO
                   AND AG.AGN_TAB_IN_CODIGO=T.AGN_TAB_IN_CODIGO AND AG.AGN_PAD_IN_CODIGO=T.AGN_PAD_IN_CODIGO AND AG.AGN_IN_CODIGO=T.AGN_IN_CODIGO),
               (SELECT MAX(T.AGN_IN_CODIGO||'§'||SUBSTR(NVL(AG.AGN_ST_FANTASIA,AG.AGN_ST_NOME),1,40))
                  FROM MEGA.FIN_REFERENCIAFIN R, MEGA.FIN_MOVIMENTO T, MEGA.GLO_AGENTES AG
                 WHERE ${keyREF} AND R.REF_ST_TIPO IN ('TRANSF','TRANSFDEST')
                   AND T.ORG_IN_CODIGO=R.ORG_IN_CODIGO AND T.MOV_TAB_IN_CODIGO=R.MOV_TAB_IN_CODIGO
                   AND T.MOV_SEQ_IN_CODIGO=R.MOV_SEQ_IN_CODIGO AND T.MOV_IN_NUMLANCTO=R.MOV_IN_NUMLANCTO
                   AND AG.AGN_TAB_IN_CODIGO=T.AGN_TAB_IN_CODIGO AND AG.AGN_PAD_IN_CODIGO=T.AGN_PAD_IN_CODIGO AND AG.AGN_IN_CODIGO=T.AGN_IN_CODIGO))
         END                                               AS TRANSF,
         CASE WHEN M.ACAO_IN_CODIGO <> 712 THEN ${tituloDe(keyORI, 'REF_')} END AS TITULO,
         (SELECT SUBSTR(MAX(F.MVF_ST_NOMINAL),1,60) FROM MEGA.FIN_MOVFIN F
           WHERE F.ORG_IN_CODIGO=M.ORG_IN_CODIGO AND F.MOV_TAB_IN_CODIGO=M.MOV_TAB_IN_CODIGO
             AND F.MOV_SEQ_IN_CODIGO=M.MOV_SEQ_IN_CODIGO AND F.MOV_IN_NUMLANCTO=M.MOV_IN_NUMLANCTO) AS NOMINAL,
         SUBSTR(M.MOV_ST_COMPLHIST,1,100)                  AS HIST
    FROM MEGA.FIN_MOVIMENTO M
   WHERE M.MOV_CH_ORIGEM = 'M'
     AND M.MOV_DT_DATADOCTO >= ${dt(ini)} AND M.MOV_DT_DATADOCTO < ${dt(fim)} + 1
     AND NVL(M.MOV_CH_SITUACAO,'X') <> 'C' AND NVL(M.MOV_BO_PREVISAO,'N') = 'N'
     AND EXISTS (SELECT 1 FROM MEGA.GLO_CONTASFIN CF WHERE CF.AGN_IN_CODIGO = M.AGN_IN_CODIGO)
     ${natureza === 'C' || natureza === 'D' ? `AND M.MOV_CH_NATUREZA = '${natureza}'` : ''}
     ${conta ? `AND M.AGN_IN_CODIGO = ${Number(conta)}` : ''}
   ORDER BY M.AGN_IN_CODIGO, M.MOV_DT_DATADOCTO, M.MOV_CH_NATUREZA, M.MOV_RE_VALOR DESC`;

export const sqlContasFin = () => `
  SELECT DISTINCT CF.AGN_IN_CODIGO AS CONTA, ${nomeAgn('CF.AGN_IN_CODIGO')} AS NOME
    FROM MEGA.GLO_CONTASFIN CF ORDER BY 1`;

// ---------------------------------------------------------------- Pedidos de compra por status
export const sqlPedidosCompra = ({ ini, fim }) => `
  SELECT P.FIL_IN_CODIGO                                   AS FIL,
         P.PDC_IN_CODIGO                                   AS PEDIDO,
         TO_CHAR(P.PDC_DT_EMISSAO,'YYYY-MM-DD')            AS EMISSAO,
         P.PDC_ST_SITUACAO                                 AS SIT,
         P.AGN_IN_CODIGO                                   AS AGN,
         ${nomeAgn('P.AGN_IN_CODIGO')}                     AS FORNECEDOR,
         P.PDC_RE_TOTALPEDIDO                              AS VALOR,
         P.COND_ST_CODIGO                                  AS COND,
         ${nomeUsu('P.GRU_IN_CODIGO')}                     AS COMPRADOR
    FROM MEGA.EST_PEDCOMPRAS P
   WHERE P.PDC_DT_EMISSAO >= ${dt(ini)} AND P.PDC_DT_EMISSAO < ${dt(fim)} + 1
   ORDER BY P.PDC_DT_EMISSAO DESC, P.PDC_IN_CODIGO DESC`;

// ---------------------------------------------------------------- Solicitacoes de pagamento (titulo a pagar x alcada app 13)
export const sqlSolicitacoesPag = ({ ini, fim }) => `
  SELECT M.FIL_IN_CODIGO                                   AS FIL,
         M.MOV_IN_NUMLANCTO                                AS LANC,
         M.MOV_ST_DOCUMENTO                                AS DOC,
         M.MOV_ST_PARCELA                                  AS PARC,
         M.TPD_ST_CODIGO                                   AS TPD,
         M.AGN_IN_CODIGO                                   AS AGN,
         ${nomeAgn('M.AGN_IN_CODIGO')}                     AS FORNECEDOR,
         M.MOV_RE_VALOR                                    AS VALOR,
         TO_CHAR(M.MOV_DT_DATAINC,'YYYY-MM-DD HH24:MI')    AS INCLUSAO,
         TO_CHAR(NVL(M.MOV_DT_PRORROGADO, M.MOV_DT_VENCTO),'YYYY-MM-DD') AS VENCTO,
         M.MOV_CH_SITUACAO                                 AS SIT_MOV,
         ${nomeUsu('M.USU_IN_INCLUSAO')}                   AS INCLUIU,
         D.STATUS_DOCUMENTO                                AS ST_ALCADA,
         D.NOME_SOLICITANTE                                AS SOLICITANTE,
         (SELECT MAX(O.NOME_APROVADOR||'§'||TO_CHAR(O.DATA_OCORRENCIA,'YYYY-MM-DD HH24:MI')||'§'||SUBSTR(O.PARECER,1,120))
                 KEEP (DENSE_RANK LAST ORDER BY O.DATA_OCORRENCIA, O.OCO_IN_CODIGO)
            FROM MEGA.WGLO_ALCADA_OCORRENCIA O
           WHERE O.DOC_IN_CODIGO = D.DOC_IN_CODIGO AND O.NOME_APROVADOR IS NOT NULL) AS ULT_APROV
    FROM MEGA.FIN_MOVIMENTO M,
         (SELECT DOC_IN_CODIGO, CHAVE_COMPLETA, STATUS_DOCUMENTO, NOME_SOLICITANTE
            FROM MEGA.WGLO_ALCADA_DOCUMENTO
           WHERE CODIGO_APLICACAO = 13 AND DATA_DOCUMENTO >= ${dt(ini)} - 120) D
   WHERE M.MOV_CH_ORIGEM = 'P' AND M.TREF_ST_CODIGO IS NULL
     AND M.MOV_DT_DATAINC >= ${dt(ini)} AND M.MOV_DT_DATAINC < ${dt(fim)} + 1
     AND D.CHAVE_COMPLETA (+) = M.ORG_TAB_IN_CODIGO||';'||M.ORG_PAD_IN_CODIGO||';'||M.ORG_IN_CODIGO||';'||M.ORG_TAU_ST_CODIGO||';'||M.MOV_TAB_IN_CODIGO||';'||M.MOV_SEQ_IN_CODIGO||';'||M.MOV_IN_NUMLANCTO
   ORDER BY M.MOV_DT_DATAINC DESC`;

// ---------------------------------------------------------------- Alteracoes em titulos (fontes existentes)
export const sqlAlteracoesTitulo = ({ ini, fim }) => `
  SELECT * FROM (
    -- datas do titulo (log nativo do Mega; grava todo update, so interessa OLD <> NEW)
    SELECT 'DATA' AS FONTE, TO_CHAR(L.LOG_DT_OPERACAO,'YYYY-MM-DD HH24:MI') AS QUANDO,
           M.FIL_IN_CODIGO AS FIL, M.MOV_CH_ORIGEM AS ORIG, M.AGN_IN_CODIGO AS AGN, ${nomeAgn('M.AGN_IN_CODIGO')} AS AGENTE,
           M.MOV_ST_DOCUMENTO AS DOC, M.MOV_ST_PARCELA AS PARC, M.MOV_RE_VALOR AS VALOR,
           CASE WHEN NVL(L.MOV_DT_PRORROGADO_OLD,DATE '1900-01-01') <> NVL(L.MOV_DT_PRORROGADO_NEW,DATE '1900-01-01') THEN 'Vencimento prorrogado' ELSE 'Vencimento' END AS CAMPO,
           TO_CHAR(CASE WHEN NVL(L.MOV_DT_PRORROGADO_OLD,DATE '1900-01-01') <> NVL(L.MOV_DT_PRORROGADO_NEW,DATE '1900-01-01') THEN L.MOV_DT_PRORROGADO_OLD ELSE L.MOV_DT_VENCTO_OLD END,'DD/MM/YYYY') AS DE,
           TO_CHAR(CASE WHEN NVL(L.MOV_DT_PRORROGADO_OLD,DATE '1900-01-01') <> NVL(L.MOV_DT_PRORROGADO_NEW,DATE '1900-01-01') THEN L.MOV_DT_PRORROGADO_NEW ELSE L.MOV_DT_VENCTO_NEW END,'DD/MM/YYYY') AS PARA,
           L.USU_IN_CODIGO AS USU, ${nomeUsu('L.USU_IN_CODIGO')} AS USUARIO, NULL AS MOTIVO
      FROM MEGA.FIN_MOVIMENTO_LOG L, MEGA.FIN_MOVIMENTO M
     WHERE L.LOG_DT_OPERACAO >= ${dt(ini)} AND L.LOG_DT_OPERACAO < ${dt(fim)} + 1
       AND L.LOG_ST_OPERACAO <> 'I'
       AND (NVL(L.MOV_DT_VENCTO_OLD,DATE '1900-01-01') <> NVL(L.MOV_DT_VENCTO_NEW,DATE '1900-01-01')
         OR NVL(L.MOV_DT_PRORROGADO_OLD,DATE '1900-01-01') <> NVL(L.MOV_DT_PRORROGADO_NEW,DATE '1900-01-01'))
       AND M.MOV_IN_NUMLANCTO = L.MOV_IN_NUMLANCTO AND M.MOV_CH_ORIGEM IN ('R','P')
    UNION ALL
    -- forma de recebimento (log da Liberacao de Forma de Recebimento, desde 09/10/2026)
    SELECT 'FORMA', TO_CHAR(F.LOG_DT,'YYYY-MM-DD HH24:MI'), F.FIL_IN_CODIGO, 'R', F.AGN_IN_CODIGO, ${nomeAgn('F.AGN_IN_CODIGO')},
           F.LOG_ST_DOCUMENTO, F.LOG_ST_PARCELA, NULL,
           'Forma de recebimento',
           (SELECT SUBSTR(MAX(H.HCOB_ST_DESCRICAO),1,40) FROM MEGA.FIN_HBKCOBRANCA H WHERE H.HCOB_IN_SEQUENCIA = F.HCOB_IN_DE),
           (SELECT SUBSTR(MAX(H.HCOB_ST_DESCRICAO),1,40) FROM MEGA.FIN_HBKCOBRANCA H WHERE H.HCOB_IN_SEQUENCIA = F.HCOB_IN_PARA),
           F.USU_IN_CODIGO, ${nomeUsu('F.USU_IN_CODIGO')}, NULL
      FROM MEGA.CCS_TB_LOG_FORMA_REC F
     WHERE F.LOG_DT >= ${dt(ini)} AND F.LOG_DT < ${dt(fim)} + 1
       AND NVL(F.HCOB_IN_DE,-1) <> NVL(F.HCOB_IN_PARA,-1)
    UNION ALL
    -- alteracao/exclusao de titulo baixado executada sob liberacao (Liberacao de Exc./Alt.)
    SELECT 'EXC_ALT', TO_CHAR(E.LIBE_DT_EXECUCAO,'YYYY-MM-DD HH24:MI'), L.FIL_IN_CODIGO, NULL, L.AGN_IN_CODIGO, ${nomeAgn('L.AGN_IN_CODIGO')},
           L.LIB_ST_DOCUMENTO, L.LIB_ST_PARCELA, E.LIBE_RE_VALOR,
           CASE E.LIBE_CH_OPERACAO WHEN 'D' THEN 'Exclusão (liberada)' ELSE 'Alteração (liberada)' END,
           NULL, NULL,
           E.LIBE_IN_USU_EXECUTOU, ${nomeUsu('E.LIBE_IN_USU_EXECUTOU')},
           SUBSTR(L.LIB_ST_MOTIVO,1,200)||' (liberado por '||L.LIB_ST_USU_LIBEROU||')'
      FROM MEGA.CCS_TB_LIBERA_EXC_ALT_EXEC E, MEGA.CCS_TB_LIBERA_EXC_ALT L
     WHERE L.LIB_IN_CODIGO = E.LIB_IN_CODIGO
       AND E.LIBE_DT_EXECUCAO >= ${dt(ini)} AND E.LIBE_DT_EXECUCAO < ${dt(fim)} + 1
  ) ORDER BY QUANDO DESC`;
