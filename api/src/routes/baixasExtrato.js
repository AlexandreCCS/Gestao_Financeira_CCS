// [21/09/2026 - Alexandre Carvalho] BAIXAS/CONCILIACAO - BAIXA AUTOMATICA DE CONTAS A PAGAR A PARTIR DO EXTRATO DO BANCO.
// Pedido do Alexandre (com a Renata/Quality): "botoes para baixar automaticamente no MEGA ... apenas o que nao existe nao
// vamos fazer nada, apenas alertar".
//
//   POST /baixas-conciliacao/baixar      { simular, arquivo, itens:[{ titulo_id, conta_id, data, valor, historico, documento }] }
//        -> para CADA item chama MEGA.CCS_P_GFIN_BAIXA_CPA (sql/19_baixa_cpa_extrato.sql) e le o resultado no log pelo token.
//           simular=true roda a MESMA procedure e desfaz tudo (nada e gravado): e o "validar antes".
//   POST /baixas-conciliacao/estornar    { log_id }      -> MEGA.CCS_P_GFIN_ESTORNO_BAIXA (so desfaz baixa ainda intacta)
//   GET  /baixas-conciliacao/baixas?dias=7               -> o que foi baixado por aqui (trilha + botao desfazer)
//   POST /baixas-conciliacao/conciliar | /desconciliar   e   GET /baixas-conciliacao/conciliacoes   -> idem, para a conciliacao (sql/20)
//
// A REGRA FICA NA PROCEDURE (uma fonte so): titulo a pagar aprovado, fora de remessa, sem rateio, valor do banco = saldo,
// data entre hoje-60 e hoje, usuario com hierarquia no Mega para baixar. Aqui so: permissao do modulo, formato, trilha.
// O usuario que baixa e o do token (sub = GRU_IN_CODIGO do Mega) - nunca vem do corpo da requisicao.
// TEXTO QUE VAI PARA O SOAP: so ASCII (o gateway corrompe acento) e sem aspas.
import crypto from 'node:crypto';
import { megaQuery, megaExec } from '../soap/mega.js';

const MODULO = 'BAIXAS_CONCILIACAO';
const num = v => Number(v || 0);
const ascii = (s, max) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E]/g, ' ').replace(/'/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const RX_ID = /^(\d{1,6})\.(\d{1,6})\.(\d{1,12})$/;

async function podeBaixar(req, reply) {
  const ok = req.user?.perm === 'A' || (req.user?.modulos || []).some(m => m.codigo === MODULO);
  if (!ok) return reply.code(403).send({ error: 'sem_modulo', message: 'Seu usuario nao tem o modulo Baixas/Conciliacao.' });
  if (!Number.isInteger(Number(req.user?.sub)) || Number(req.user.sub) <= 0)
    return reply.code(403).send({ error: 'sem_usuario_mega', message: 'Sessao sem usuario do Mega. Entre de novo.' });
}

const linhaLog = r => ({
  log_id: num(r.LOG_IN_CODIGO), status: r.LOG_CH_STATUS, mensagem: r.LOG_ST_MENSAGEM || '',
  titulo_id: `${r.ORG_IN_CODIGO}.${r.MOV_SEQ_IN_CODIGO}.${r.MOV_IN_NUMLANCTO}`,
  forn_id: r.AGN_IN_CODIGO ? num(r.AGN_IN_CODIGO) : null, forn_nome: r.FORN_NOME || '', doc: r.MOV_ST_DOCUMENTO || '', parcela: r.MOV_ST_PARCELA || '',
  fil_id: r.FIL_IN_CODIGO ? num(r.FIL_IN_CODIGO) : null, conta_id: num(r.CTA_AGN_IN_CODIGO), conta_nome: r.CONTA_NOME || '',
  data: r.DT_BAIXA || '', valor: num(r.LOG_RE_VALOR), lancto_fin: r.LANCTO_FIN ? num(r.LANCTO_FIN) : null, lancto_bx: r.LANCTO_BX ? num(r.LANCTO_BX) : null,
  acao_bx: r.ACAO_BX_IN_CODIGO ? num(r.ACAO_BX_IN_CODIGO) : null, usuario: r.USU_ST_LOGIN || '', em: r.EM || '',
  historico: r.EXT_ST_HISTORICO || '', documento_banco: r.EXT_ST_DOCUMENTO || '', arquivo: r.EXT_ST_ARQUIVO || '',
  estornado_por: r.EST_USU_ST_LOGIN || '', estornado_em: r.EST_EM || '',
  conciliado: r.CONC === 'S', contabilizado: num(r.CTB) > 0
});

const SQL_LOG = `
  SELECT L.LOG_IN_CODIGO, L.LOG_CH_STATUS, L.LOG_ST_MENSAGEM, L.ORG_IN_CODIGO, L.MOV_SEQ_IN_CODIGO, L.MOV_IN_NUMLANCTO, L.AGN_IN_CODIGO,
         L.MOV_ST_DOCUMENTO, L.MOV_ST_PARCELA, L.FIL_IN_CODIGO, L.CTA_AGN_IN_CODIGO, TO_CHAR(L.LOG_DT_BAIXA,'YYYY-MM-DD') AS DT_BAIXA, L.LOG_RE_VALOR,
         L.LANCTO_FIN, L.LANCTO_BX, L.ACAO_BX_IN_CODIGO, L.USU_ST_LOGIN, TO_CHAR(L.LOG_DT_INCLUSAO,'YYYY-MM-DD HH24:MI') AS EM,
         L.EXT_ST_HISTORICO, L.EXT_ST_DOCUMENTO, L.EXT_ST_ARQUIVO, L.EST_USU_ST_LOGIN, TO_CHAR(L.EST_DT,'YYYY-MM-DD HH24:MI') AS EST_EM,
         (SELECT SUBSTR(MAX(A.AGN_ST_NOME),1,60) FROM MEGA.GLO_AGENTES A WHERE A.AGN_TAB_IN_CODIGO = 53 AND A.AGN_IN_CODIGO = L.AGN_IN_CODIGO) AS FORN_NOME,
         (SELECT SUBSTR(MAX(A.AGN_ST_NOME),1,60) FROM MEGA.GLO_AGENTES A WHERE A.AGN_TAB_IN_CODIGO = 53 AND A.AGN_IN_CODIGO = L.CTA_AGN_IN_CODIGO) AS CONTA_NOME,
         (SELECT MAX(NVL(F.MOV_CH_CONCILIADO,'N')) FROM MEGA.FIN_MOVIMENTO F WHERE L.LOG_CH_STATUS = 'B' AND F.ORG_IN_CODIGO = L.ORG_IN_CODIGO AND F.MOV_TAB_IN_CODIGO = 352
             AND F.MOV_SEQ_IN_CODIGO = L.BX_MOV_SEQ_IN_CODIGO AND F.MOV_IN_NUMLANCTO = L.LANCTO_FIN) AS CONC,
         (SELECT COUNT(*) FROM MEGA.CON_LANCAMENTO C WHERE L.LOG_CH_STATUS = 'B' AND C.ACAOM_ORG_IN_CODIGO = L.ORG_IN_CODIGO AND C.ACAOM_IN_SEQUENCIA = L.ACAOM_IN_SEQUENCIA) AS CTB
    FROM MEGA.CCS_TB_GFIN_BAIXA_LOG L`;

// ---------------------------------------------------------------------------------------------------- conciliacao
const linhaConc = r => ({
  log_id: num(r.LOG_IN_CODIGO), status: r.LOG_CH_STATUS, mensagem: r.LOG_ST_MENSAGEM || '', mov_id: `${r.ORG_IN_CODIGO}.${r.MOV_SEQ_IN_CODIGO}.${r.MOV_IN_NUMLANCTO}`,
  lancto: num(r.MOV_IN_NUMLANCTO), ext_id: num(r.CBA_IN_SEQUENCIA), con_id: r.CON_IN_SEQUENCIAL ? num(r.CON_IN_SEQUENCIAL) : null,
  conta_id: r.CTA_AGN_IN_CODIGO ? num(r.CTA_AGN_IN_CODIGO) : null, conta_nome: r.CONTA_NOME || '', data_banco: r.DT_BCO || '', data_mov: r.DT_MOV || '', valor: num(r.LOG_RE_VALOR),
  usuario: r.USU_ST_LOGIN || '', em: r.EM || '', historico: r.EXT_ST_HISTORICO || '', arquivo: r.EXT_ST_ARQUIVO || '', desfeito_por: r.DES_USU_ST_LOGIN || '', desfeito_em: r.DES_EM || ''
});
const SQL_CONC = `
  SELECT L.LOG_IN_CODIGO, L.LOG_CH_STATUS, L.LOG_ST_MENSAGEM, L.ORG_IN_CODIGO, L.MOV_SEQ_IN_CODIGO, L.MOV_IN_NUMLANCTO, L.CBA_IN_SEQUENCIA, L.CON_IN_SEQUENCIAL,
         L.CTA_AGN_IN_CODIGO, TO_CHAR(L.LOG_DT_BANCO,'YYYY-MM-DD') AS DT_BCO, TO_CHAR(L.LOG_DT_MOVIMENTO,'YYYY-MM-DD') AS DT_MOV, L.LOG_RE_VALOR, L.USU_ST_LOGIN,
         TO_CHAR(L.LOG_DT_INCLUSAO,'YYYY-MM-DD HH24:MI') AS EM, L.EXT_ST_HISTORICO, L.EXT_ST_ARQUIVO, L.DES_USU_ST_LOGIN, TO_CHAR(L.DES_DT,'YYYY-MM-DD HH24:MI') AS DES_EM,
         (SELECT SUBSTR(MAX(A.AGN_ST_NOME),1,60) FROM MEGA.GLO_AGENTES A WHERE A.AGN_TAB_IN_CODIGO = 53 AND A.AGN_IN_CODIGO = L.CTA_AGN_IN_CODIGO) AS CONTA_NOME
    FROM MEGA.CCS_TB_GFIN_CONC_LOG L`;

export default async function baixasExtratoRoutes(app) {
  const guard = { preHandler: [app.authenticate, podeBaixar] };

  // [21/09/2026 - Alexandre Carvalho] CONCILIAR NO MEGA: par 1 x 1 (linha do extrato JA IMPORTADA no Mega x lancamento da conta).
  // MEGA.CCS_P_GFIN_CONCILIA (sql/20_conciliacao_extrato.sql) espelha o pacote nativo FIN_PCK_CONCILIACAOBANC; tipo 'A' (automatica).
  app.post('/baixas-conciliacao/conciliar', {
    ...guard,
    schema: { body: { type: 'object', required: ['itens'], properties: {
      simular: { type: 'boolean' }, arquivo: { type: 'string', maxLength: 200 },
      itens: { type: 'array', minItems: 1, maxItems: 25, items: { type: 'object', required: ['mov_id', 'ext_id'], properties: {
        ref: { type: 'string', maxLength: 40 }, mov_id: { type: 'string', pattern: RX_ID.source }, ext_id: { type: 'integer', minimum: 1 }, historico: { type: 'string', maxLength: 120 } } } } } } }
  }, async (req) => {
    const simular = req.body.simular === true, usu = Number(req.user.sub), login = ascii(req.user.login || req.user.nome, 60), arq = ascii(req.body.arquivo, 120);
    const resultados = [];
    for (const it of req.body.itens) {
      const [, org, seq, lancto] = it.mov_id.match(RX_ID), token = crypto.randomUUID();
      let r;
      try {
        await megaExec(`BEGIN MEGA.CCS_P_GFIN_CONCILIA('${token}', ${+org}, ${+seq}, ${+lancto}, ${+it.ext_id}, ${usu}, '${login}', '${ascii(it.historico, 120)}', '${arq}', '${simular ? 'S' : 'N'}'); END;`);
        const log = await megaQuery(`${SQL_CONC} WHERE L.LOG_ST_TOKEN = '${token}'`);
        r = log[0] ? linhaConc(log[0]) : { status: 'X', mensagem: 'O Mega nao devolveu o resultado desta conciliacao. Confira no Mega antes de tentar de novo.' };
      } catch (e) {
        const log = await megaQuery(`${SQL_CONC} WHERE L.LOG_ST_TOKEN = '${token}'`).catch(() => []);
        r = log[0] ? linhaConc(log[0]) : { status: 'X', mensagem: `Falha de comunicacao com o Mega (${String(e.message || e).slice(0, 160)}). Confira no Mega antes de tentar de novo.` };
      }
      req.log.info({ gfin: 'concilia', simular, usu, mov: it.mov_id, ext: it.ext_id, status: r.status, msg: r.mensagem }, 'conciliacao pelo extrato');
      resultados.push({ ref: it.ref || '', ...r });
    }
    return { simular, resultados };
  });

  app.post('/baixas-conciliacao/desconciliar', {
    ...guard, schema: { body: { type: 'object', required: ['log_id'], properties: { log_id: { type: 'integer', minimum: 1 } } } }
  }, async (req, reply) => {
    const id = Number(req.body.log_id), usu = Number(req.user.sub), login = ascii(req.user.login || req.user.nome, 60);
    await megaExec(`BEGIN MEGA.CCS_P_GFIN_DESCONCILIA(${id}, ${usu}, '${login}'); END;`);
    const log = await megaQuery(`${SQL_CONC} WHERE L.LOG_IN_CODIGO = ${id}`);
    if (!log[0]) return reply.code(404).send({ error: 'nao_encontrado', message: 'Conciliacao nao encontrada.' });
    const r = linhaConc(log[0]);
    req.log.info({ gfin: 'desconcilia', usu, log_id: id, status: r.status, msg: r.mensagem }, 'desfaz conciliacao pelo extrato');
    return { ok: r.status === 'D', ...r };
  });

  app.get('/baixas-conciliacao/conciliacoes', { preHandler: [app.authenticate] }, async (req) => {
    const dias = Math.min(Math.max(parseInt(req.query.dias, 10) || 7, 1), 90);
    const itens = (await megaQuery(`${SQL_CONC} WHERE L.LOG_CH_STATUS IN ('C','D') AND L.LOG_DT_INCLUSAO >= TRUNC(SYSDATE) - ${dias} ORDER BY L.LOG_IN_CODIGO DESC`)).map(linhaConc);
    return { dias, itens, qt: itens.filter(i => i.status === 'C').length, total: itens.filter(i => i.status === 'C').reduce((s, i) => s + i.valor, 0) };
  });

  app.post('/baixas-conciliacao/baixar', {
    ...guard,
    schema: { body: { type: 'object', required: ['itens'], properties: {
      simular: { type: 'boolean' }, arquivo: { type: 'string', maxLength: 200 },
      itens: { type: 'array', minItems: 1, maxItems: 25, items: { type: 'object', required: ['titulo_id', 'conta_id', 'data', 'valor'], properties: {
        ref: { type: 'string', maxLength: 40 }, titulo_id: { type: 'string', pattern: RX_ID.source }, conta_id: { type: 'integer', minimum: 1 },
        data: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, valor: { type: 'number', exclusiveMinimum: 0 },
        historico: { type: 'string', maxLength: 120 }, documento: { type: 'string', maxLength: 60 } } } } } } }
  }, async (req) => {
    const simular = req.body.simular === true, usu = Number(req.user.sub), login = ascii(req.user.login || req.user.nome, 60), arq = ascii(req.body.arquivo, 120);
    const resultados = [];
    for (const it of req.body.itens) {           // UM POR VEZ: cada baixa e uma transacao propria no Mega
      const [, org, seq, lancto] = it.titulo_id.match(RX_ID), token = crypto.randomUUID();
      let r;
      try {
        await megaExec(`BEGIN MEGA.CCS_P_GFIN_BAIXA_CPA('${token}', ${+org}, ${+seq}, ${+lancto}, ${+it.conta_id}, TO_DATE('${it.data}','YYYY-MM-DD'), ${Number(it.valor).toFixed(2)}, ${usu}, '${login}', '${ascii(it.historico, 120)}', '${ascii(it.documento, 60)}', '${arq}', '${simular ? 'S' : 'N'}'); END;`);
        const log = await megaQuery(`${SQL_LOG} WHERE L.LOG_ST_TOKEN = '${token}'`);
        r = log[0] ? linhaLog(log[0]) : { status: 'X', mensagem: 'O Mega nao devolveu o resultado desta baixa. Confira o titulo antes de tentar de novo.' };
      } catch (e) {
        // falha de transporte/gateway: NAO se sabe se gravou -> tenta ler o log; se nao houver, avisa para conferir
        const log = await megaQuery(`${SQL_LOG} WHERE L.LOG_ST_TOKEN = '${token}'`).catch(() => []);
        r = log[0] ? linhaLog(log[0]) : { status: 'X', mensagem: `Falha de comunicacao com o Mega (${String(e.message || e).slice(0, 160)}). Confira o titulo antes de tentar de novo.` };
      }
      req.log.info({ gfin: 'baixa_cpa', simular, usu, titulo: it.titulo_id, conta: it.conta_id, valor: it.valor, status: r.status, msg: r.mensagem }, 'baixa pelo extrato');
      resultados.push({ ref: it.ref || '', ...r });
    }
    return { simular, resultados };
  });

  app.post('/baixas-conciliacao/estornar', {
    ...guard, schema: { body: { type: 'object', required: ['log_id'], properties: { log_id: { type: 'integer', minimum: 1 } } } }
  }, async (req, reply) => {
    const id = Number(req.body.log_id), usu = Number(req.user.sub), login = ascii(req.user.login || req.user.nome, 60);
    await megaExec(`BEGIN MEGA.CCS_P_GFIN_ESTORNO_BAIXA(${id}, ${usu}, '${login}'); END;`);
    const log = await megaQuery(`${SQL_LOG} WHERE L.LOG_IN_CODIGO = ${id}`);
    if (!log[0]) return reply.code(404).send({ error: 'nao_encontrado', message: 'Baixa nao encontrada.' });
    const r = linhaLog(log[0]);
    req.log.info({ gfin: 'estorno_baixa_cpa', usu, log_id: id, status: r.status, msg: r.mensagem }, 'estorno de baixa pelo extrato');
    return { ok: r.status === 'E', ...r };
  });

  app.get('/baixas-conciliacao/baixas', { preHandler: [app.authenticate] }, async (req) => {
    const dias = Math.min(Math.max(parseInt(req.query.dias, 10) || 7, 1), 90);
    const rows = await megaQuery(`${SQL_LOG} WHERE L.LOG_CH_STATUS IN ('B','E') AND L.LOG_DT_INCLUSAO >= TRUNC(SYSDATE) - ${dias} ORDER BY L.LOG_IN_CODIGO DESC`);
    const itens = rows.map(linhaLog);
    return { dias, itens, total_baixado: itens.filter(i => i.status === 'B').reduce((s, i) => s + i.valor, 0), qt_baixado: itens.filter(i => i.status === 'B').length };
  });
}
