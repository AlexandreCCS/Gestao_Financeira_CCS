// [21/09/2026 - Alexandre Carvalho] CONTAS A PAGAR DO PERIODO - "o que eu tinha para pagar, o que esta pago, o que nao esta,
// e se esta pago saiu de qual conta" - VISAO DIRETIVA DE COBRANCA AO FINANCEIRO (ontem / semana / mes / trimestre).
// Pedido do Alexandre, presencial com a Renata (Quality). Cobre tambem o item do doc "BI Financeiro - Melhorias":
// "Consulta dos pagamentos realizados no periodo X conta que pagou (caixa), podendo abrir o titulo".
//
// BASE = O TITULO A PAGAR QUE VENCIA NO PERIODO (FIN_VW_CONTASPAGAR), NAO A SAIDA DE DINHEIRO:
//   - DIA DEVIDO = vencimento PRORROGADO rolado para o proximo dia util (mesma regra da matriz do Fluxo).
//   - STATUS: pago (SALDO_EM_ABERTO = 0) | parcial (0 < saldo < valor) | aberto (saldo = valor).
//   - A CONTA QUE PAGOU: FIN_REFERENCIAFIN REF_ST_TIPO='BXCPA' com o TITULO no papel REF e a BAIXA (movimento da conta
//     financeira) no papel ORI; o AGN_IN_CODIGO da baixa e o banco/caixa e o MOV_DT_VENCTO dela e a DATA DO PAGAMENTO
//     (DATADOCTO/ENTRADA/PRORROGADO da baixa sao iguais - medido em 3.168 baixas). 1 baixa = 1 titulo (medido).
//   - MODALIDADE = TPD da baixa: PGTOM pagamento bancario | CHP cheque | DINCP dinheiro.
//   - Titulo pago SEM baixa em conta = baixado por compensacao/adiantamento/outros (nao saiu dinheiro de banco).
// ATENCAO DE NEGOCIO: a baixa e lancada no Mega com atraso (mediana 1 dia, ate 16). "Em aberto" pode ser "pago e ainda
// nao lancado" - a rota devolve o ultimo dia com baixa lancada para a tela avisar.
// Registrada a partir de fluxoDocs.js (sem tocar no server.js).
import { megaQuery } from '../soap/mega.js';

const MODALIDADES = { PGTOM: 'Pagamento bancário', CHP: 'Cheque', DINCP: 'Dinheiro' };
const SEP = String.fromCharCode(167);   // § = CHR(167), separador dos campos empacotados nas subqueries escalares

export default async function fluxoPagosRoutes(app) {

  // ==========================================================================
  // GET /fluxo-previo/pagar-periodo?data_ini&data_fim&filiais[&cmp_ini&cmp_fim]
  // 1 linha por TITULO devido no periodo. A tela agrega tudo no navegador: o sintetico e o analitico sao sempre
  // o mesmo numero e o clique abre na hora. cmp_* = periodo anterior equivalente (so agregados).
  // ==========================================================================
  app.get('/fluxo-previo/pagar-periodo', { preHandler: [app.authenticate] }, async (req) => {
    const d = k => String(req.query[k] || '').slice(0, 10);
    const dataIni = d('data_ini'), dataFim = d('data_fim'), cmpIni = d('cmp_ini'), cmpFim = d('cmp_fim');
    const filiais = String(req.query.filiais || '0').replace(/[^0-9,]/g, '') || '0';
    const okD = s => /^\d{4}-\d{2}-\d{2}$/.test(s);
    if (!okD(dataIni) || !okD(dataFim)) { const e = new Error('data_ini e data_fim sao obrigatorios'); e.statusCode = 400; throw e; }
    const dt = s => `TO_DATE('${s}','YYYY-MM-DD')`;
    const base   = `NVL(M.MOV_DT_PRORROGADO, M.MOV_DT_VENCTO)`;
    const devido = `MEGA.F_PROXDIAUTIL(${base}, 1, 200)`;
    const filtro = (ini, fim) => `NVL(M.MOV_CH_SITUACAO,'A') <> 'C' AND M.TPD_ST_CODIGO <> 'PREVPDC'
             AND ${base} BETWEEN ${dt(ini)} - 15 AND ${dt(fim)}
             AND ${devido} BETWEEN ${dt(ini)} AND ${dt(fim)}
             AND ${filiais === '0' ? '1=1' : `INSTR(',${filiais},', ',' || TO_CHAR(M.FIL_IN_CODIGO) || ',') > 0`}`;
    // baixas do titulo M na conta financeira (titulo = REF, baixa = ORI)
    const baixas = `FROM MEGA.FIN_REFERENCIAFIN R, MEGA.FIN_MOVIMENTO B, MEGA.GLO_AGENTES AG
               WHERE R.REF_ORG_TAB_IN_CODIGO = M.ORG_TAB_IN_CODIGO AND R.REF_ORG_PAD_IN_CODIGO = M.ORG_PAD_IN_CODIGO
                 AND R.REF_ORG_IN_CODIGO     = M.ORG_IN_CODIGO     AND R.REF_ORG_TAU_ST_CODIGO = M.ORG_TAU_ST_CODIGO
                 AND R.REF_MOV_TAB_IN_CODIGO = M.MOV_TAB_IN_CODIGO AND R.REF_MOV_SEQ_IN_CODIGO = M.MOV_SEQ_IN_CODIGO
                 AND R.REF_MOV_IN_NUMLANCTO  = M.MOV_IN_NUMLANCTO  AND R.REF_ST_TIPO = 'BXCPA'
                 AND B.ORG_TAB_IN_CODIGO = R.ORI_ORG_TAB_IN_CODIGO AND B.ORG_PAD_IN_CODIGO = R.ORI_ORG_PAD_IN_CODIGO
                 AND B.ORG_IN_CODIGO     = R.ORI_ORG_IN_CODIGO     AND B.ORG_TAU_ST_CODIGO = R.ORI_ORG_TAU_ST_CODIGO
                 AND B.MOV_TAB_IN_CODIGO = R.ORI_MOV_TAB_IN_CODIGO AND B.MOV_SEQ_IN_CODIGO = R.ORI_MOV_SEQ_IN_CODIGO
                 AND B.MOV_IN_NUMLANCTO  = R.ORI_MOV_IN_NUMLANCTO  AND NVL(B.MOV_CH_SITUACAO,'A') <> 'C'
                 AND AG.AGN_TAB_IN_CODIGO = B.AGN_TAB_IN_CODIGO AND AG.AGN_PAD_IN_CODIGO = B.AGN_PAD_IN_CODIGO
                 AND AG.AGN_IN_CODIGO     = B.AGN_IN_CODIGO`;

    const sql = `
      SELECT M.ORG_IN_CODIGO || '.' || M.MOV_SEQ_IN_CODIGO || '.' || M.MOV_IN_NUMLANCTO  AS ID,
             M.FIL_IN_CODIGO                                                             AS FIL,
             (SELECT SUBSTR(NVL(O.ORG_ST_FANTASIA, O.ORG_ST_NOME),1,40) FROM MEGA.GLO_VW_ORGANIZACAO O
               WHERE O.ORG_IN_CODIGO = M.FIL_IN_CODIGO AND ROWNUM = 1)                    AS FIL_NOME,
             M.AGN_IN_CODIGO                                                             AS FORN,
             SUBSTR(AGN.AGN_ST_NOME, 1, 60)                                              AS FORN_NOME,
             SUBSTR(NVL(AGN.AGN_ST_CGC,''), 1, 20)                                       AS CGC,
             CASE WHEN EXISTS (SELECT 1 FROM MEGA.GLO_AGENTES_ID GI WHERE GI.AGN_IN_CODIGO = M.AGN_IN_CODIGO AND GI.AGN_TAU_ST_CODIGO = 'G')
                    OR EXISTS (SELECT 1 FROM MEGA.CCS_TB_GFIN_LIB_GRUPO_AGN GX WHERE GX.AGN_IN_CODIGO = M.AGN_IN_CODIGO)
                  THEN 'S' ELSE 'N' END                                                  AS GRUPO,
             M.MOV_ST_DOCUMENTO                                                          AS DOCUMENTO,
             M.MOV_ST_PARCELA                                                            AS PARCELA,
             M.TPD_ST_CODIGO                                                             AS TPD,
             TO_CHAR(M.MOV_DT_DATADOCTO, 'YYYY-MM-DD')                                   AS EMISSAO,
             TO_CHAR(M.MOV_DT_VENCTO,    'YYYY-MM-DD')                                   AS VENCIMENTO,
             TO_CHAR(${base},   'YYYY-MM-DD')                                            AS VENC_PROR,
             TO_CHAR(${devido}, 'YYYY-MM-DD')                                            AS DT_DEVIDA,
             NVL(M.MOV_RE_VALOR, 0)                                                      AS VALOR,
             NVL(M.SALDO_EM_ABERTO, 0)                                                   AS SALDO,
             SUBSTR(NVL(M.MOV_ST_COMPLHIST,''), 1, 200)                                  AS HISTORICO,
             (SELECT MAX(SUBSTR(C.CLA_ST_DESCRICAO,1,60))
                     KEEP (DENSE_RANK FIRST ORDER BY NVL(L.LCL_RE_VALORDEB,0) + NVL(L.LCL_RE_VALORCRE,0) DESC)
                FROM MEGA.FIN_LANCCLASSE L, MEGA.FIN_CLASSE C
               WHERE L.ORG_TAB_IN_CODIGO = M.ORG_TAB_IN_CODIGO AND L.ORG_PAD_IN_CODIGO = M.ORG_PAD_IN_CODIGO
                 AND L.ORG_IN_CODIGO     = M.ORG_IN_CODIGO     AND L.ORG_TAU_ST_CODIGO = M.ORG_TAU_ST_CODIGO
                 AND L.MOV_TAB_IN_CODIGO = M.MOV_TAB_IN_CODIGO AND L.MOV_SEQ_IN_CODIGO = M.MOV_SEQ_IN_CODIGO
                 AND L.MOV_IN_NUMLANCTO  = M.MOV_IN_NUMLANCTO
                 AND C.CLA_TAB_IN_CODIGO = L.CLA_TAB_IN_CODIGO AND C.CLA_PAD_IN_CODIGO = L.CLA_PAD_IN_CODIGO
                 AND C.CLA_IDE_ST_CODIGO = L.CLA_IDE_ST_CODIGO AND C.CLA_IN_REDUZIDO   = L.CLA_IN_REDUZIDO) AS CLASSE,
             (SELECT MAX(B.AGN_IN_CODIGO || CHR(167) || SUBSTR(AG.AGN_ST_NOME,1,60) || CHR(167) || TO_CHAR(B.MOV_DT_VENCTO,'YYYY-MM-DD')
                         || CHR(167) || B.TPD_ST_CODIGO || CHR(167) || B.MOV_ST_DOCUMENTO || CHR(167) || TO_CHAR(B.MOV_DT_DATAINC,'YYYY-MM-DD HH24:MI'))
                     KEEP (DENSE_RANK LAST ORDER BY B.MOV_DT_VENCTO, B.MOV_IN_NUMLANCTO)
                ${baixas})                                                               AS ULT_BAIXA,
             (SELECT COUNT(*) || CHR(167) || NVL(SUM(NVL(B.MOV_RE_VALORCRE,0)),0) ${baixas}) AS TOT_BAIXA
        FROM MEGA.FIN_VW_CONTASPAGAR M, MEGA.GLO_AGENTES AGN
       WHERE M.AGN_TAB_IN_CODIGO = AGN.AGN_TAB_IN_CODIGO(+)
         AND M.AGN_PAD_IN_CODIGO = AGN.AGN_PAD_IN_CODIGO(+)
         AND M.AGN_IN_CODIGO     = AGN.AGN_IN_CODIGO(+)
         AND ${filtro(dataIni, dataFim)}
       ORDER BY ${devido}, M.MOV_RE_VALOR DESC`;

    const agregado = (ini, fim) => `
      SELECT COUNT(*) QT, ROUND(NVL(SUM(M.MOV_RE_VALOR),0),2) VL, ROUND(NVL(SUM(M.SALDO_EM_ABERTO),0),2) ABERTO,
             SUM(CASE WHEN NVL(M.SALDO_EM_ABERTO,0) > 0 THEN 1 ELSE 0 END) QT_ABERTO
        FROM MEGA.FIN_VW_CONTASPAGAR M WHERE ${filtro(ini, fim)}`;

    const [rows, cmp, saude] = await Promise.all([
      megaQuery(sql),
      (okD(cmpIni) && okD(cmpFim)) ? megaQuery(agregado(cmpIni, cmpFim)) : Promise.resolve([]),
      megaQuery(`SELECT TO_CHAR(MAX(CASE WHEN B.MOV_DT_VENCTO <= TRUNC(SYSDATE) THEN B.MOV_DT_VENCTO END),'YYYY-MM-DD') ULT_DIA,
                        TO_CHAR(MAX(B.MOV_DT_DATAINC),'YYYY-MM-DD HH24:MI') ULT_LANC
                   FROM MEGA.FIN_MOVIMENTO B
                  WHERE B.AGN_TAU_ST_CODIGO = 'N' AND B.MOV_CH_NATUREZA = 'C' AND NVL(B.MOV_CH_SITUACAO,'A') <> 'C'
                    AND B.ACAO_IN_CODIGO = 705 AND B.MOV_DT_VENCTO >= TRUNC(SYSDATE) - 60`)
    ]);

    const num = v => Number(v || 0);
    const hojeBr = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Recife' });
    const dias = (a, b) => Math.round((Date.parse(a + 'T12:00:00Z') - Date.parse(b + 'T12:00:00Z')) / 86400000);
    const titulos = rows.map(r => {
      const valor = num(r.VALOR), saldo = num(r.SALDO), pago = +(valor - saldo).toFixed(2);
      const status = saldo <= 0.005 ? 'pago' : (saldo + 0.005 < valor ? 'parcial' : 'aberto');
      const u = r.ULT_BAIXA ? String(r.ULT_BAIXA).split(SEP) : null;
      const t = r.TOT_BAIXA ? String(r.TOT_BAIXA).split(SEP) : ['0', '0'];
      const dtPagto = u ? u[2] : '';
      const diasPagto = dtPagto && r.VENC_PROR ? dias(dtPagto, r.VENC_PROR) : null;   // > 0 pago com atraso | < 0 antecipado
      return {
        id: r.ID, fil_id: num(r.FIL), fil_nome: r.FIL_NOME || '',
        forn_id: num(r.FORN), forn_nome: r.FORN_NOME || `Agente ${r.FORN}`, cgc: r.CGC || '', grupo: r.GRUPO === 'S',
        documento: r.DOCUMENTO || '', parcela: r.PARCELA || '', tpd: r.TPD || '',
        emissao: r.EMISSAO || '', vencimento: r.VENCIMENTO || '', venc_pror: r.VENC_PROR || '', dt_devida: r.DT_DEVIDA || '',
        valor, saldo, pago, status, classe: (r.CLASSE || '').trim() || '(sem classe)', historico: r.HISTORICO || '',
        // baixa em conta financeira (a mais recente) + totais
        conta_id: u ? num(u[0]) : null, conta_nome: u ? (u[1] || `Conta ${u[0]}`) : '',
        dt_pagto: dtPagto, modalidade: u ? (MODALIDADES[u[3]] || u[3] || '(sem tipo)') : '', doc_baixa: u ? (u[4] || '') : '',
        dt_lancamento: u ? (u[5] || '') : '',
        qt_baixas: num(t[0]), vl_baixas_conta: num(t[1]),
        // pago/parcial sem nenhuma baixa em conta = compensacao, adiantamento, devolucao... (nao saiu de banco)
        sem_conta: status !== 'aberto' && !u,
        dias_pagto: diasPagto,
        pontualidade: status === 'aberto' ? null : (diasPagto == null ? 'sem_conta' : diasPagto > 0 ? 'atraso' : diasPagto < 0 ? 'antecipado' : 'no_dia'),
        dias_vencido: status === 'pago' ? 0 : Math.max(0, dias(hojeBr, r.VENC_PROR || hojeBr))
      };
    });

    return {
      filtro: { data_ini: dataIni, data_fim: dataFim, filiais, cmp_ini: cmpIni || null, cmp_fim: cmpFim || null, hoje: hojeBr },
      titulos,
      comparativo: cmp.length ? { qt: num(cmp[0].QT), valor: num(cmp[0].VL), aberto: num(cmp[0].ABERTO), qt_aberto: num(cmp[0].QT_ABERTO) } : null,
      saude: { ult_dia_com_baixa: saude[0]?.ULT_DIA || null, ult_lancamento: saude[0]?.ULT_LANC || null }
    };
  });

  // GET /fluxo-previo/pagar-periodo/base - hoje e o DIA UTIL ANTERIOR ("ontem" de quem gere caixa: na segunda-feira
  // e a sexta; depois de feriado, o ultimo dia util). Calendario de feriados do agente 200, o mesmo do Fluxo.
  app.get('/fluxo-previo/pagar-periodo/base', { preHandler: [app.authenticate] }, async () => {
    const r = await megaQuery(`
      SELECT TO_CHAR(TRUNC(SYSDATE),'YYYY-MM-DD') HOJE,
             TO_CHAR((SELECT MAX(D) FROM (SELECT TRUNC(SYSDATE) - LEVEL D FROM DUAL CONNECT BY LEVEL <= 12)
                       WHERE MEGA.F_PROXDIAUTIL(D, 1, 200) = D), 'YYYY-MM-DD') ONTEM_UTIL
        FROM DUAL`);
    return { hoje: r[0]?.HOJE, ontem_util: r[0]?.ONTEM_UTIL };
  });

  // ==========================================================================
  // [21/09/2026 - Alexandre Carvalho] EXTRATO DO BANCO x MEGA - "arrasto o arquivo da conciliacao e a tela diz o que
  // deveria estar BAIXADO e CONCILIADO". Pedido do Alexandre (com a Renata/Quality).
  // POST /fluxo-previo/extrato/analisar   body: { contas: [{ banco, agencia, conta, lancamentos: [...] }] }
  // O ARQUIVO (.RET CNAB 240, servico 04 / segmento E) E LIDO NO NAVEGADOR; aqui chegam so as linhas ja lidas - nada e gravado.
  //
  // Para cada lancamento do banco:
  //   1) acha a CONTA do Mega: GLO_CONTASFIN por banco + agencia (AGE_IN_CODIGO) + digitos da conta (CTA_ST_NUMERO vem sujo).
  //   2) procura o LANCAMENTO DO MEGA na conta (FIN_MOVIMENTO): mesmo valor, natureza espelhada (debito no banco = natureza
  //      'C' no Mega; credito = 'D'), data ate 5 dias de distancia; o mais proximo ganha e NUNCA e reutilizado
  //      (ha valores repetidos: 3 PIX de 5.280,00 no mesmo dia).
  //   3) com lancamento: conciliado (MOV_CH_CONCILIADO='S') -> OK | senao -> CONCILIAR.
  //   4) sem lancamento: PAGAMENTO/RECEBIMENTO -> BAIXAR, com sugestao de TITULO EM ABERTO de mesmo saldo (vencimento mais
  //      proximo, sem reutilizar; confianca ALTA quando o nome do favorecido no historico confere com o agente do titulo);
  //      TARIFA/TRANSFERENCIA -> LANCAR; APLICACAO AUTOMATICA/RENDIMENTO -> informativo.
  //   5) diz tambem se a linha ja foi IMPORTADA no Mega (FIN_CONCILIACAO) e o status dela la.
  // ==========================================================================
  app.post('/fluxo-previo/extrato/analisar', {
    preHandler: [app.authenticate], bodyLimit: 8 * 1024 * 1024,
    schema: { body: { type: 'object', required: ['contas'], properties: { contas: { type: 'array', minItems: 1, maxItems: 20, items: {
      type: 'object', required: ['banco', 'agencia', 'conta', 'lancamentos'],
      properties: { banco: { type: 'integer' }, agencia: { type: 'string', maxLength: 10 }, conta: { type: 'string', maxLength: 20 }, dv: { type: 'string', maxLength: 3 },
        lancamentos: { type: 'array', maxItems: 6000, items: { type: 'object', required: ['data', 'valor', 'dc'],
          properties: { seq: { type: 'string' }, data: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, valor: { type: 'number', minimum: 0 },
            dc: { type: 'string', enum: ['D', 'C'] }, natureza: { type: 'string' }, categoria: { type: 'string' }, cod_hist: { type: 'string' },
            historico: { type: 'string', maxLength: 60 }, documento: { type: 'string', maxLength: 60 } } } } } } } } } }
  }, async (req) => {
    const num = v => Number(v || 0), so = s => String(s || '').replace(/\D/g, '').replace(/^0+/, '');
    const dias = (a, b) => Math.round((Date.parse(a + 'T12:00:00Z') - Date.parse(b + 'T12:00:00Z')) / 86400000);
    const dt = s => `TO_DATE('${s}','YYYY-MM-DD')`;
    const tipoDe = l => {
      const h = (l.historico || '').toUpperCase();
      if (l.natureza === 'APL' || /^(APL |RES |REND|APLICACAO|RESGATE)/.test(h)) return 'aplicacao';
      if (/^TAR |TARIFA/.test(h)) return 'tarifa';
      if (/TRANSF/.test(h)) return 'transferencia';
      if (/MOV TIT COB|COBRANCA/.test(h)) return 'cobranca';
      return l.dc === 'D' ? 'pagamento' : 'recebimento';
    };
    // palavras do favorecido no historico do banco (tira o verbo: BOLETO PAGO / PIX ENVIADO / SISPAG / TED ...)
    const favorecido = h => String(h || '').toUpperCase().replace(/^(BOLETO PAGO|PIX ENVIADO|PIX RECEBIDO|SISPAG|TED|DOC|PAG|PAGTO|TRANSF)\s*/,'').split(/[^A-Z0-9]+/).filter(w => w.length >= 4);
    const nomeConfere = (h, nome) => { const n = String(nome || '').toUpperCase(); return favorecido(h).some(w => n.includes(w)); };

    const saida = [];
    for (const c of req.body.contas) {
      const ls = c.lancamentos.filter(l => l.valor > 0);
      const base = { banco: c.banco, agencia: c.agencia, conta: c.conta, qt: ls.length };
      const cad = await megaQuery(`
        SELECT C.AGN_IN_CODIGO AGN, SUBSTR(A.AGN_ST_NOME,1,70) NOME, C.CTA_ST_NUMERO NUMERO, C.FIL_IN_CODIGO FIL
          FROM MEGA.GLO_CONTASFIN C, MEGA.GLO_AGENTES A
         WHERE A.AGN_TAB_IN_CODIGO = C.AGN_TAB_IN_CODIGO AND A.AGN_PAD_IN_CODIGO = C.AGN_PAD_IN_CODIGO AND A.AGN_IN_CODIGO = C.AGN_IN_CODIGO
           AND C.AGN_TAU_ST_CODIGO = 'N' AND C.BAN_IN_NUMERO = ${parseInt(c.banco, 10) || 0} AND C.AGE_IN_CODIGO = ${parseInt(so(c.agencia), 10) || 0}`);
      // no Mega o numero vem com o digito ("08839-5"); no CNAB o digito e campo separado -> compara COM o DV e, se nao achar, sem
      const conta = cad.find(x => so(x.NUMERO) === so(String(c.conta) + String(c.dv || ''))) || cad.find(x => so(x.NUMERO) === so(c.conta));
      if (!conta || !ls.length) { saida.push({ ...base, encontrada: !!conta, agn_id: conta ? num(conta.AGN) : null, agn_nome: conta?.NOME || '', linhas: [] }); continue; }
      const agn = num(conta.AGN), datas = ls.map(l => l.data).sort(), dMin = datas[0], dMax = datas[datas.length - 1];

      const [movs, ext] = await Promise.all([
        megaQuery(`
          SELECT M.ORG_IN_CODIGO || '.' || M.MOV_SEQ_IN_CODIGO || '.' || M.MOV_IN_NUMLANCTO AS ID, TO_CHAR(M.MOV_DT_VENCTO,'YYYY-MM-DD') AS DT,
                 M.MOV_CH_NATUREZA AS NAT, NVL(M.MOV_RE_VALORCRE,0) + NVL(M.MOV_RE_VALORDEB,0) AS VL, NVL(M.MOV_CH_CONCILIADO,'N') AS CONC,
                 M.ACAO_IN_CODIGO AS ACAO, M.TPD_ST_CODIGO AS TPD, M.MOV_ST_DOCUMENTO AS DOC, SUBSTR(NVL(M.MOV_ST_COMPLHIST,''),1,120) AS HIST,
                 (SELECT MAX(T.AGN_IN_CODIGO || CHR(167) || SUBSTR(AG.AGN_ST_NOME,1,60) || CHR(167) || T.MOV_ST_DOCUMENTO || CHR(167) || T.MOV_ST_PARCELA)
                    FROM MEGA.FIN_REFERENCIAFIN R, MEGA.FIN_MOVIMENTO T, MEGA.GLO_AGENTES AG
                   WHERE R.REF_ST_TIPO IN ('BXCPA','BXCRE')
                     AND R.ORI_ORG_TAB_IN_CODIGO = M.ORG_TAB_IN_CODIGO AND R.ORI_ORG_PAD_IN_CODIGO = M.ORG_PAD_IN_CODIGO
                     AND R.ORI_ORG_IN_CODIGO     = M.ORG_IN_CODIGO     AND R.ORI_ORG_TAU_ST_CODIGO = M.ORG_TAU_ST_CODIGO
                     AND R.ORI_MOV_TAB_IN_CODIGO = M.MOV_TAB_IN_CODIGO AND R.ORI_MOV_SEQ_IN_CODIGO = M.MOV_SEQ_IN_CODIGO
                     AND R.ORI_MOV_IN_NUMLANCTO  = M.MOV_IN_NUMLANCTO
                     AND T.ORG_TAB_IN_CODIGO = R.REF_ORG_TAB_IN_CODIGO AND T.ORG_PAD_IN_CODIGO = R.REF_ORG_PAD_IN_CODIGO
                     AND T.ORG_IN_CODIGO     = R.REF_ORG_IN_CODIGO     AND T.ORG_TAU_ST_CODIGO = R.REF_ORG_TAU_ST_CODIGO
                     AND T.MOV_TAB_IN_CODIGO = R.REF_MOV_TAB_IN_CODIGO AND T.MOV_SEQ_IN_CODIGO = R.REF_MOV_SEQ_IN_CODIGO
                     AND T.MOV_IN_NUMLANCTO  = R.REF_MOV_IN_NUMLANCTO
                     AND AG.AGN_TAB_IN_CODIGO = T.AGN_TAB_IN_CODIGO AND AG.AGN_PAD_IN_CODIGO = T.AGN_PAD_IN_CODIGO AND AG.AGN_IN_CODIGO = T.AGN_IN_CODIGO) AS TITULO
            FROM MEGA.FIN_MOVIMENTO M
           WHERE M.AGN_IN_CODIGO = ${agn} AND M.AGN_TAU_ST_CODIGO = 'N' AND NVL(M.MOV_CH_SITUACAO,'A') <> 'C'
             AND M.MOV_DT_VENCTO BETWEEN ${dt(dMin)} - 5 AND ${dt(dMax)} + 5`),
        megaQuery(`
          SELECT CBA_IN_SEQUENCIA AS ID, TO_CHAR(CBA_DT_DATA,'YYYY-MM-DD') AS DT, CBA_CH_NATUREZA AS NAT, CBA_RE_VALOR AS VL, NVL(CBA_CH_STATUS,'N') AS ST,
                 TO_CHAR(CBA_DT_IMPORTACAO,'YYYY-MM-DD HH24:MI') AS IMP
            FROM MEGA.FIN_CONCILIACAO
           WHERE AGN_IN_CODIGO = ${agn} AND AGN_TAU_ST_CODIGO = 'N' AND CBA_DT_DATA BETWEEN ${dt(dMin)} AND ${dt(dMax)}`)
      ]);
      const M = movs.map(m => ({ id: m.ID, dt: m.DT, nat: m.NAT, vl: num(m.VL), conc: m.CONC === 'S', acao: num(m.ACAO), tpd: m.TPD || '', doc: m.DOC || '',
                                 hist: m.HIST || '', titulo: m.TITULO ? String(m.TITULO).split(SEP) : null, usado: false }));
      const E = ext.map(e => ({ id: num(e.ID), dt: e.DT, nat: e.NAT, vl: num(e.VL), st: e.ST === 'S', imp: e.IMP || '', usado: false }));

      // (2) casamento com o lancamento do Mega - do maior valor para o menor, o mais proximo na data ganha
      const linhas = ls.map((l, i) => ({ ...l, i, tipo: tipoDe(l), mov: null, ext: null, sugestoes: [] }));
      for (const l of [...linhas].sort((a, b) => b.valor - a.valor)) {
        const natMega = l.dc === 'D' ? 'C' : 'D';
        const cand = M.filter(m => !m.usado && m.nat === natMega && Math.abs(m.vl - l.valor) < 0.005 && Math.abs(dias(m.dt, l.data)) <= 5)
                      .sort((a, b) => Math.abs(dias(a.dt, l.data)) - Math.abs(dias(b.dt, l.data)));
        if (cand[0]) { cand[0].usado = true; l.mov = cand[0]; }
        // [21/09/2026] linha importada no Mega (FIN_CONCILIACAO): com valores repetidos no dia, prefere a que esta no MESMO estado do
        // lancamento (conciliado com conciliada, pendente com pendente) - e o ext_id dela que o botao "Conciliar no Mega" usa.
        const mesma = x => !x.usado && x.dt === l.data && x.nat === l.dc && Math.abs(x.vl - l.valor) < 0.005;
        const e = E.find(x => mesma(x) && x.st === !!l.mov?.conc) || E.find(mesma);
        if (e) { e.usado = true; l.ext = e; }
      }

      // (4) sem lancamento: titulos em aberto de mesmo saldo
      const semMov = linhas.filter(l => !l.mov && ['pagamento', 'recebimento'].includes(l.tipo));
      for (const [dc, view, prev] of [['D', 'FIN_VW_CONTASPAGAR', 'PREVPDC'], ['C', 'FIN_VW_CONTASRECEBER', 'PDV']]) {
        const valores = [...new Set(semMov.filter(l => l.dc === dc).map(l => l.valor.toFixed(2)))];
        const tit = [];
        for (let k = 0; k < valores.length; k += 400) {
          tit.push(...await megaQuery(`
            SELECT P.ORG_IN_CODIGO || '.' || P.MOV_SEQ_IN_CODIGO || '.' || P.MOV_IN_NUMLANCTO AS ID, P.AGN_IN_CODIGO AS AGN, SUBSTR(A.AGN_ST_NOME,1,60) AS NOME,
                   P.MOV_ST_DOCUMENTO AS DOC, P.MOV_ST_PARCELA AS PARC, P.TPD_ST_CODIGO AS TPD, P.FIL_IN_CODIGO AS FIL,
                   TO_CHAR(NVL(P.MOV_DT_PRORROGADO, P.MOV_DT_VENCTO),'YYYY-MM-DD') AS VENC, P.SALDO_EM_ABERTO AS SALDO, P.MOV_RE_VALOR AS VALOR
              FROM MEGA.${view} P, MEGA.GLO_AGENTES A
             WHERE A.AGN_TAB_IN_CODIGO = P.AGN_TAB_IN_CODIGO AND A.AGN_PAD_IN_CODIGO = P.AGN_PAD_IN_CODIGO AND A.AGN_IN_CODIGO = P.AGN_IN_CODIGO
               AND NVL(P.MOV_CH_SITUACAO,'A') <> 'C' AND P.TPD_ST_CODIGO <> '${prev}'
               AND P.SALDO_EM_ABERTO IN (${valores.slice(k, k + 400).join(',')})
               AND NVL(P.MOV_DT_PRORROGADO, P.MOV_DT_VENCTO) BETWEEN ${dt(dMin)} - 90 AND ${dt(dMax)} + 30`));
        }
        const Tt = tit.map(t => ({ id: t.ID, agn_id: num(t.AGN), nome: t.NOME || '', doc: t.DOC || '', parcela: t.PARC || '', tpd: t.TPD || '', fil_id: num(t.FIL),
                                   venc: t.VENC, saldo: num(t.SALDO), valor: num(t.VALOR), usado: false }));
        for (const l of semMov.filter(x => x.dc === dc).sort((a, b) => b.valor - a.valor)) {
          const cand = Tt.filter(t => !t.usado && Math.abs(t.saldo - l.valor) < 0.005)
            .map(t => ({ ...t, nome_confere: nomeConfere(l.historico, t.nome), dist: Math.abs(dias(t.venc, l.data)) }))
            .sort((a, b) => (b.nome_confere - a.nome_confere) || (a.dist - b.dist));
          if (cand[0]) { const orig = Tt.find(t => t.id === cand[0].id); if (orig) orig.usado = true; }
          l.sugestoes = cand.slice(0, 3).map(t => ({ id: t.id, agn_id: t.agn_id, nome: t.nome, doc: t.doc, parcela: t.parcela, tpd: t.tpd, fil_id: t.fil_id, venc: t.venc, saldo: t.saldo,
            confianca: t.nome_confere ? 'alta' : t.dist <= 5 ? 'media' : 'baixa' }));
        }
      }

      const res = linhas.sort((a, b) => a.i - b.i).map(l => {
        const situacao = l.mov ? (l.mov.conc ? 'ok' : 'conciliar')
          : ['pagamento', 'recebimento'].includes(l.tipo) ? 'baixar'
          : l.tipo === 'aplicacao' ? 'informativo' : 'lancar';
        return { seq: l.seq || '', data: l.data, valor: l.valor, dc: l.dc, natureza: l.natureza || '', historico: l.historico || '', documento: l.documento || '',
                 tipo: l.tipo, situacao, importado: !!l.ext, ext_id: l.ext?.id || null, extrato_conciliado: !!l.ext?.st, importado_em: l.ext?.imp || '',
                 mov: l.mov ? { id: l.mov.id, data: l.mov.dt, conciliado: l.mov.conc, acao: l.mov.acao, tpd: l.mov.tpd, doc: l.mov.doc, historico: l.mov.hist,
                                dif_dias: dias(l.mov.dt, l.data),
                                contraparte_id: l.mov.titulo ? num(l.mov.titulo[0]) : null, contraparte: l.mov.titulo ? l.mov.titulo[1] : '',
                                titulo: l.mov.titulo ? `${l.mov.titulo[2]}/${l.mov.titulo[3]}` : '' } : null,
                 sugestoes: l.sugestoes };
      });
      saida.push({ ...base, encontrada: true, agn_id: agn, agn_nome: conta.NOME, fil_id: num(conta.FIL), periodo: { ini: dMin, fim: dMax },
                   importados: res.filter(x => x.importado).length, linhas: res });
    }
    return { contas: saida };
  });
}
