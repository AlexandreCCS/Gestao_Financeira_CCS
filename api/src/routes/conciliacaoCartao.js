// [18/11/2026 - CRIADO POR ALEXANDRE CARVALHO] CONCILIACAO BANCARIA - CARTAO (Quality): importacao dos arquivos da Rede pelo Gestor, POR FILIAL.
// Copia do fluxo da conciliacao bancaria (conciliacaoBancaria.js): o leitor roda no navegador (web/src/pages/baixas/rede.js) e aqui
// chegam so as linhas lidas, agrupadas por estabelecimento da Rede. SQL: sql/40_cbc_importacao.sql.
//   POST /cbc/analisar               - SO LEITURA: estabelecimento -> filial (de-para CCS_TB_GFIN_CBC_ESTAB ou CNPJ x GLO_AGENTES), ja importado, repetidas, erros
//   POST /cbc/preparar               - grava a importacao PENDENTE de UM estabelecimento/filial (CCS_TB_GFIN_CBC_ARQUIVO/LINHA) e VALIDA sem gravar (procedure 'S')
//   POST /cbc/arquivos/:id/importar  - confirma (procedure 'N': tudo ou nada; duplicidade conferida de novo com o estabelecimento travado)
//   GET  /cbc/arquivos[/:id]         - historico de importacoes e linhas
//   GET  /cbc/filiais                - filiais validas + de-para de estabelecimentos
// Nada grava em tabela nativa do Mega; a conferencia com o caixa/financeiro e a proxima etapa.
import crypto from 'node:crypto';
import { megaQuery, megaExec } from '../soap/mega.js';
import { conferirCredito } from './cbcCredito.js';   // [19/11/2026] conferencia do credito (Rede x Mega), so leitura

const MOD_OPERA = 'BAIXAS_CONCILIACAO';
const EFETIVAR_LIGADO = false;   // [20/11/2026] POST /cbc/efetivar desligado (ver comentario na rota)
const num = v => Number(v || 0);
const r2 = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const ehData = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const dt = s => `TO_DATE('${s}','YYYY-MM-DD')`;
const dtOuNull = s => (ehData(s) ? dt(s) : 'NULL');
const nOuNull = v => (v == null || v === '' || !Number.isFinite(Number(v)) ? 'NULL' : String(Number(v)));
// o gateway SOAP so aceita ASCII: tira acento (GRAVATA), troca o resto por espaco, dobra a aspa
const txt = (s, max) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]/g, ' ').slice(0, max).replace(/'/g, "''");
const sOuNull = (s, max) => (s == null || s === '' ? 'NULL' : `'${txt(s, max)}'`);
const digitos = s => String(s || '').replace(/\D/g, '');
const temModulo = (u, cod) => u?.perm === 'A' || (u?.modulos || []).some(m => m.codigo === cod);
const falha = (code, msg) => Object.assign(new Error(msg), { statusCode: code });
const ABAS = { V: 'venda', P: 'pagamento', F: 'pagamento futuro', D: 'deposito', A: 'ajuste', C: 'cancelamento' };
const isoHoje = () => new Date().toISOString().slice(0, 10);
const addDias = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// ------------------------------------------------------------------------------------------------ filiais e estabelecimentos
async function filiaisValidas() {
  const r = await megaQuery(`SELECT O.ORG_IN_CODIGO FIL, O.PAI_ORG_IN_CODIGO ORG, SUBSTR(O.ORG_ST_FANTASIA,1,40) NOME,
       (SELECT REPLACE(REPLACE(REPLACE(MAX(A.AGN_ST_CGC),'.',''),'/',''),'-','') FROM MEGA.GLO_AGENTES A WHERE A.AGN_TAB_IN_CODIGO = 53 AND A.AGN_IN_CODIGO = O.ORG_IN_CODIGO) CNPJ
     FROM MEGA.GLO_VW_ORGANIZACAO O WHERE O.ORG_TAB_IN_CODIGO = 53 AND O.ORG_PAD_IN_CODIGO = 1 AND O.PAI_ORG_IN_CODIGO IN (10, 20, 30) ORDER BY O.ORG_IN_CODIGO`);
  return r.map(x => ({ fil: num(x.FIL), org: num(x.ORG), nome: (x.NOME || '').trim(), cnpj: digitos(x.CNPJ) }));
}
async function estabsCadastrados() {
  const r = await megaQuery(`SELECT ESTAB_ST_NUMERO NUM, ESTAB_ST_CNPJ CNPJ, FIL_IN_CODIGO FIL, ESTAB_ST_NOME NOME, ESTAB_CH_ATIVO AT FROM MEGA.CCS_TB_GFIN_CBC_ESTAB ORDER BY FIL_IN_CODIGO`);
  return r.map(x => ({ estab: String(x.NUM), cnpj: digitos(x.CNPJ), fil: num(x.FIL), nome: (x.NOME || '').trim(), ativo: x.AT === 'S' }));
}
// filial do estabelecimento: escolha do usuario > de-para > CNPJ da planilha x CNPJ da filial
function resolverFilial(bloco, filiais, estabs, escolha) {
  if (escolha) { const f = filiais.find(x => x.fil === num(escolha)); if (f) return { fil: f.fil, nome: f.nome, origem: 'escolhida' }; }
  const e = estabs.find(x => x.estab === String(bloco.estab) && x.ativo);
  if (e) { const f = filiais.find(x => x.fil === e.fil); return { fil: e.fil, nome: f?.nome || e.nome, origem: 'cadastro' }; }
  if (bloco.cnpj) { const f = filiais.find(x => x.cnpj && x.cnpj === digitos(bloco.cnpj)); if (f) return { fil: f.fil, nome: f.nome, origem: 'cnpj' }; }
  return null;
}

// ------------------------------------------------------------------------------------------------ analise de um estabelecimento
async function analisarBloco(arquivo, bloco, filiais, estabs, escolha) {
  const lancs = (bloco.linhas || []).map((l, i) => ({ ...l, ordem: num(l.ordem) || i + 1 }));
  const filial = resolverFilial(bloco, filiais, estabs, escolha);
  const datas = lancs.map(l => l.data).filter(ehData).sort();
  const periodo = { ini: datas[0] || null, fim: datas[datas.length - 1] || null };
  const out = { estab: String(bloco.estab || ''), cnpj: digitos(bloco.cnpj), nome: String(bloco.nome || '').slice(0, 80), filial, filial_identificada: !!filial,
    resumo: { linhas: lancs.length, periodo, por_aba: {}, por_status: {} }, linhas: [], arquivo_ja_importado: [] };
  // chaves ja importadas nesta filial (importacoes I) no periodo do arquivo
  const existentes = new Map();
  if (filial && periodo.ini) {
    const rows = await megaQuery(`SELECT L.LIN_ST_CHAVE K, COUNT(*) N FROM MEGA.CCS_TB_GFIN_CBC_LINHA L, MEGA.CCS_TB_GFIN_CBC_ARQUIVO A
        WHERE L.FIL_IN_CODIGO = ${filial.fil} AND L.LIN_CH_SITUACAO = 'I' AND A.ARQ_IN_CODIGO = L.ARQ_IN_CODIGO AND A.ARQ_CH_STATUS = 'I'
          AND L.LIN_DT_DATA BETWEEN ${dt(periodo.ini)} AND ${dt(periodo.fim)} GROUP BY L.LIN_ST_CHAVE`);
    for (const r of rows) existentes.set(String(r.K), num(r.N));
    const porHash = await megaQuery(`SELECT ARQ_IN_CODIGO ID, ARQ_ST_NOME NOME, TO_CHAR(ARQ_DT_PROCESSADO,'YYYY-MM-DD HH24:MI') EM, USU_ST_LOGIN USU FROM MEGA.CCS_TB_GFIN_CBC_ARQUIVO
       WHERE FIL_IN_CODIGO = ${filial.fil} AND ARQ_ST_HASH = '${txt(arquivo.hash, 64)}' AND ARQ_CH_STATUS = 'I'`);
    out.arquivo_ja_importado = porHash.map(p => ({ id: num(p.ID), em: p.EM, por: p.USU || '' }));
  }
  const vistos = new Map(), noArquivo = new Map();
  for (const l of lancs) noArquivo.set(l.chave, (noArquivo.get(l.chave) || 0) + 1);
  const hoje = isoHoje();
  for (const l of lancs) {
    const n = (vistos.get(l.chave) || 0) + 1; vistos.set(l.chave, n);
    const linha = { ...l, repetida_no_arquivo: noArquivo.get(l.chave) > 1 ? noArquivo.get(l.chave) : 0, situacao: l.situacao === 'erro' ? 'erro' : 'nova', motivo: l.motivo || '' };
    if (linha.situacao !== 'erro') {
      if (!ehData(l.data) || l.data > addDias(hoje, 400) || l.data < '2020-01-01') { linha.situacao = 'erro'; linha.motivo = 'Data invalida ou fora do esperado'; }
      else if (!ABAS[l.aba]) { linha.situacao = 'erro'; linha.motivo = 'Aba desconhecida'; }
      else if (!l.chave || l.chave.length > 200) { linha.situacao = 'erro'; linha.motivo = 'Chave da linha invalida'; }
      else if (filial && n <= (existentes.get(l.chave) || 0)) { linha.situacao = 'ja'; linha.motivo = 'Ja importada nesta filial'; }
    }
    out.linhas.push(linha);
    const a = ABAS[l.aba] || l.aba; out.resumo.por_aba[a] = (out.resumo.por_aba[a] || 0) + 1;
    const st = l.status || '(sem status)'; out.resumo.por_status[st] = (out.resumo.por_status[st] || 0) + 1;
  }
  const c = s => out.linhas.filter(x => x.situacao === s).length;
  const entra = out.linhas.filter(x => x.situacao === 'nova' && ((x.aba === 'V' && ['aprovada', 'pago'].includes(x.status)) || x.aba === 'P'));
  Object.assign(out.resumo, { novas: c('nova'), ja_importadas: c('ja'), erros: c('erro'), repetidas: out.linhas.filter(x => x.repetida_no_arquivo).length,
    bruto: r2(entra.reduce((s, x) => s + num(x.bruto), 0)), taxas: r2(entra.reduce((s, x) => s + num(x.taxas), 0)), liquido: r2(entra.reduce((s, x) => s + num(x.liquido), 0)),
    depositos: r2(out.linhas.filter(x => x.aba === 'D').reduce((s, x) => s + num(x.bruto), 0)), futuros: r2(out.linhas.filter(x => x.aba === 'F').reduce((s, x) => s + num(x.liquido), 0)) });
  return out;
}

function validaArquivo(b) {
  if (!b?.arquivo || !b.arquivo.nome || !/^[0-9a-f]{64}$/i.test(String(b.arquivo.hash || ''))) throw falha(400, 'Arquivo sem nome ou sem assinatura (hash).');
  if (!['V', 'R'].includes(b.arquivo.tipo)) throw falha(400, 'Tipo do arquivo desconhecido (esperado extrato de vendas ou relatorio de recebimentos da Rede).');
  if (!Array.isArray(b.estabs) || !b.estabs.length) throw falha(400, 'Nenhum estabelecimento no arquivo.');
  if (b.estabs.reduce((s, e) => s + (e.linhas || []).length, 0) > 20000) throw falha(400, 'Arquivo com mais de 20.000 linhas. Exporte um periodo menor.');
}

// ------------------------------------------------------------------------------------------------ rotas
export default async function conciliacaoCartaoRoutes(app) {
  const podeOperar = async (req, reply) => {
    if (!temModulo(req.user, MOD_OPERA)) return reply.code(403).send({ error: 'sem_modulo', message: 'Seu usuario nao tem o modulo Baixas/Conciliacao.' });
    if (!Number.isInteger(Number(req.user?.sub)) || Number(req.user.sub) <= 0) return reply.code(403).send({ error: 'sem_usuario_mega', message: 'Sessao sem usuario do Mega. Entre de novo.' });
  };
  const opera = { preHandler: [app.authenticate, podeOperar], bodyLimit: 12 * 1024 * 1024 };
  const login = req => String(req.user.login || req.user.nome || '').slice(0, 60);

  app.get('/cbc/filiais', opera, async () => ({ filiais: await filiaisValidas(), estabelecimentos: await estabsCadastrados() }));

  app.post('/cbc/analisar', opera, async (req) => {
    validaArquivo(req.body);
    const escolhas = req.body.escolhas || {};
    const [filiais, estabs] = [await filiaisValidas(), await estabsCadastrados()];
    const blocos = [];
    for (const b of req.body.estabs) blocos.push(await analisarBloco(req.body.arquivo, b, filiais, estabs, escolhas[String(b.estab)]));
    return { arquivo: { nome: req.body.arquivo.nome, tipo: req.body.arquivo.tipo, emissao: req.body.arquivo.emissao || null, periodo: req.body.arquivo.periodo || null }, filiais, estabelecimentos: blocos };
  });

  // grava a importacao pendente de UM estabelecimento (cabecalho + linhas) e valida sem gravar
  app.post('/cbc/preparar', opera, async (req) => {
    validaArquivo(req.body);
    const b = req.body, bloco = b.estabs[0], fil = num(b.fil);
    if (!fil) throw falha(400, 'Escolha a filial.');
    const [filiais, estabs] = [await filiaisValidas(), await estabsCadastrados()];
    const f = filiais.find(x => x.fil === fil);
    if (!f) throw falha(400, `Filial ${fil} invalida.`);
    const an = await analisarBloco(b.arquivo, bloco, filiais, estabs, fil);      // nunca confiar na situacao vinda do navegador
    if (!an.resumo.novas) throw falha(400, 'Nada novo para importar neste estabelecimento.');
    // de-para novo ou mudado: grava para as proximas importacoes (quem escolheu fica registrado)
    if (an.estab) {
      const e = estabs.find(x => x.estab === an.estab);
      if (!e) await megaExec(`BEGIN INSERT INTO MEGA.CCS_TB_GFIN_CBC_ESTAB (ESTAB_ST_NUMERO, ESTAB_ST_CNPJ, FIL_IN_CODIGO, ESTAB_ST_NOME, USU_ST_LOGIN) VALUES ('${txt(an.estab, 20)}', ${sOuNull(an.cnpj, 14)}, ${fil}, ${sOuNull(an.nome, 80)}, '${txt(login(req), 60)}'); COMMIT; END;`);
      else if (e.fil !== fil) {
        if (b.confirma_filial_diferente !== true) throw falha(400, `O estabelecimento ${an.estab} esta cadastrado na filial ${e.fil}. Confirme a troca para a filial ${fil}.`);
        await megaExec(`BEGIN UPDATE MEGA.CCS_TB_GFIN_CBC_ESTAB SET FIL_IN_CODIGO = ${fil}, USU_ST_LOGIN = '${txt(login(req), 60)}' WHERE ESTAB_ST_NUMERO = '${txt(an.estab, 20)}'; COMMIT; END;`);
      }
    }
    const token = crypto.randomUUID();
    const id = num((await megaQuery(`SELECT MEGA.CCS_SEQ_GFIN_CBC_ARQUIVO.NEXTVAL ID FROM DUAL`))[0].ID);
    const R = an.resumo, em = String(b.arquivo.emissao || '');
    const dtEm = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/.test(em) ? `TO_DATE('${em.length === 10 ? em + ' 00:00:00' : em}','YYYY-MM-DD HH24:MI:SS')` : 'NULL';
    await megaExec(`BEGIN
      INSERT INTO MEGA.CCS_TB_GFIN_CBC_ARQUIVO (ARQ_IN_CODIGO, ARQ_ST_TOKEN, ARQ_ST_HASH, ARQ_ST_NOME, ARQ_CH_TIPO, ARQ_DT_EMISSAO, ARQ_DT_INI, ARQ_DT_FIM, FIL_IN_CODIGO, ORG_IN_CODIGO,
        ESTAB_ST_NUMERO, ESTAB_ST_NOME, ARQ_IN_QT_LIDAS, ARQ_IN_QT_NOVAS, ARQ_IN_QT_JA, ARQ_IN_QT_ERRO, ARQ_RE_BRUTO, ARQ_RE_TAXAS, ARQ_RE_LIQUIDO, ARQ_CH_STATUS, USU_IN_CODIGO, USU_ST_LOGIN)
      VALUES (${id}, '${token}', '${txt(b.arquivo.hash, 64)}', '${txt(b.arquivo.nome, 228)}', '${b.arquivo.tipo}', ${dtEm}, ${dtOuNull(R.periodo.ini)}, ${dtOuNull(R.periodo.fim)}, ${fil}, ${f.org},
        ${sOuNull(an.estab, 20)}, ${sOuNull(an.nome, 80)}, ${R.linhas}, ${R.novas}, ${R.ja_importadas}, ${R.erros}, ${R.bruto}, ${R.taxas}, ${R.liquido}, 'P', ${num(req.user.sub)}, '${txt(login(req), 60)}');
      COMMIT; END;`);
    const sit = { nova: 'N', ja: 'J', erro: 'E' };
    const ins = l => `INSERT INTO MEGA.CCS_TB_GFIN_CBC_LINHA (ARQ_IN_CODIGO, LIN_IN_ORDEM, FIL_IN_CODIGO, ESTAB_ST_NUMERO, LIN_CH_ABA, LIN_ST_CHAVE, LIN_DT_DATA, LIN_ST_HORA, LIN_DT_VENDA, LIN_DT_VENCTO,
        LIN_ST_STATUS, LIN_ST_MODALIDADE, LIN_ST_TIPO, LIN_ST_BANDEIRA, LIN_IN_PARCELAS, LIN_IN_PARCELA, LIN_RE_BRUTO, LIN_RE_BRUTO_ATUAL, LIN_RE_TAXA_MDR, LIN_RE_MDR, LIN_RE_TAXA_RA, LIN_RE_RA, LIN_RE_TAXAS, LIN_RE_LIQUIDO,
        LIN_ST_NSU, LIN_ST_AUTORIZACAO, LIN_ST_LOTE, LIN_ST_TID, LIN_ST_PEDIDO, LIN_ST_ID_TRANSACAO, LIN_ST_CARTAO, LIN_ST_MEIO, LIN_ST_MAQUININHA, LIN_ST_PRAZO, LIN_CH_CANCELADA, LIN_DT_CANCEL, LIN_RE_CANCELADO,
        LIN_CH_CHARGEBACK, LIN_ST_BANCO, LIN_ST_AGENCIA, LIN_ST_CONTA, LIN_ST_DESCRICAO, LIN_CH_SITUACAO, LIN_ST_MOTIVO)
      VALUES (${id}, ${l.ordem}, ${fil}, ${sOuNull(an.estab, 20)}, '${l.aba}', '${txt(l.chave, 200)}', ${ehData(l.data) ? dt(l.data) : "DATE '1900-01-01'"}, ${sOuNull(l.hora, 8)}, ${dtOuNull(l.dt_venda)}, ${dtOuNull(l.dt_vencto)},
        ${sOuNull(l.status, 40)}, ${sOuNull(l.modalidade, 30)}, ${sOuNull(l.tipo, 40)}, ${sOuNull(l.bandeira, 30)}, ${nOuNull(l.parcelas)}, ${nOuNull(l.parcela)}, ${nOuNull(l.bruto)}, ${nOuNull(l.bruto_atual)}, ${nOuNull(l.taxa_mdr)}, ${nOuNull(l.mdr)}, ${nOuNull(l.taxa_ra)}, ${nOuNull(l.ra)}, ${nOuNull(l.taxas)}, ${nOuNull(l.liquido)},
        ${sOuNull(l.nsu, 30)}, ${sOuNull(l.autorizacao, 20)}, ${sOuNull(l.lote, 30)}, ${sOuNull(l.tid, 60)}, ${sOuNull(l.pedido, 60)}, ${sOuNull(l.id_transacao, 80)}, ${sOuNull(l.cartao, 30)}, ${sOuNull(l.meio, 40)}, ${sOuNull(l.maquininha, 30)}, ${sOuNull(l.prazo, 30)}, ${sOuNull(l.cancelada, 1)}, ${dtOuNull(l.dt_cancel)}, ${nOuNull(l.cancelado)},
        ${sOuNull(l.chargeback, 1)}, ${sOuNull(l.banco, 40)}, ${sOuNull(l.agencia, 10)}, ${sOuNull(l.conta, 20)}, ${sOuNull(l.descricao, 300)}, '${sit[l.situacao] || 'E'}', ${sOuNull(l.motivo, 300)});`;
    for (let i = 0; i < an.linhas.length; i += 25) {
      await megaExec(`BEGIN\n${an.linhas.slice(i, i + 25).map(ins).join('\n')}\nCOMMIT;\nEND;`);
    }
    await megaExec(`BEGIN MEGA.CCS_P_GFIN_CBC_IMPORTA(${id}, 'S'); END;`);
    return { id, ...(await lerArquivo(id)) };
  });

  app.post('/cbc/arquivos/:id/importar', opera, async (req) => {
    const id = num(req.params.id);
    const a = (await megaQuery(`SELECT ARQ_CH_STATUS ST, ROUND((SYSDATE - ARQ_DT_INCLUSAO) * 24, 2) HORAS FROM MEGA.CCS_TB_GFIN_CBC_ARQUIVO WHERE ARQ_IN_CODIGO = ${id}`))[0];
    if (!a) throw falha(404, 'Importacao nao encontrada.');
    if (a.ST !== 'P') throw falha(409, a.ST === 'I' ? 'Esta importacao ja foi gravada.' : 'Esta importacao foi recusada na validacao. Analise o arquivo de novo.');
    if (num(a.HORAS) > 6) throw falha(409, 'Validacao com mais de 6 horas. Analise o arquivo de novo.');
    try { await megaExec(`BEGIN MEGA.CCS_P_GFIN_CBC_IMPORTA(${id}, 'N'); END;`); }
    catch (e) {
      const r = await lerArquivo(id).catch(() => null);
      if (r && r.status !== 'P') return { id, ...r };
      throw falha(502, `Falha de comunicacao com o Mega (${String(e.message || e).slice(0, 160)}). Abra o historico de importacoes antes de tentar de novo.`);
    }
    req.log.info({ gfin: 'cbc_importar', id, usu: req.user.sub }, 'importacao de arquivo da Rede');
    return { id, ...(await lerArquivo(id)) };
  });

  async function lerArquivo(id, comLinhas = true) {
    const a = (await megaQuery(`SELECT A.*, TO_CHAR(A.ARQ_DT_INCLUSAO,'YYYY-MM-DD HH24:MI') EM, TO_CHAR(A.ARQ_DT_PROCESSADO,'YYYY-MM-DD HH24:MI') PROC,
        TO_CHAR(A.ARQ_DT_EMISSAO,'YYYY-MM-DD HH24:MI') EMISSAO, TO_CHAR(A.ARQ_DT_INI,'YYYY-MM-DD') DI, TO_CHAR(A.ARQ_DT_FIM,'YYYY-MM-DD') DF,
        (SELECT SUBSTR(MAX(O.ORG_ST_FANTASIA),1,40) FROM MEGA.GLO_VW_ORGANIZACAO O WHERE O.ORG_TAB_IN_CODIGO = 53 AND O.ORG_PAD_IN_CODIGO = 1 AND O.ORG_IN_CODIGO = A.FIL_IN_CODIGO) FIL_NOME
        FROM MEGA.CCS_TB_GFIN_CBC_ARQUIVO A WHERE A.ARQ_IN_CODIGO = ${num(id)}`))[0];
    if (!a) throw falha(404, 'Importacao nao encontrada.');
    const ls = comLinhas ? await megaQuery(`SELECT LIN_IN_ORDEM ORD, LIN_CH_ABA ABA, TO_CHAR(LIN_DT_DATA,'YYYY-MM-DD') DT, LIN_ST_HORA HR, LIN_ST_STATUS ST, LIN_ST_MODALIDADE MOD, LIN_ST_TIPO TP, LIN_ST_BANDEIRA BAND,
        LIN_IN_PARCELAS NP, LIN_IN_PARCELA PARC, LIN_RE_BRUTO BRUTO, LIN_RE_TAXAS TAXAS, LIN_RE_LIQUIDO LIQ, LIN_ST_NSU NSU, LIN_ST_AUTORIZACAO AUT, LIN_ST_DESCRICAO DESCR, LIN_CH_SITUACAO SIT, LIN_ST_MOTIVO MOT
        FROM MEGA.CCS_TB_GFIN_CBC_LINHA WHERE ARQ_IN_CODIGO = ${num(id)} ORDER BY LIN_IN_ORDEM`) : [];
    return { status: a.ARQ_CH_STATUS, mensagem: a.ARQ_ST_MENSAGEM || '', nome: a.ARQ_ST_NOME, tipo: a.ARQ_CH_TIPO, emissao: a.EMISSAO, filial: num(a.FIL_IN_CODIGO), filial_nome: (a.FIL_NOME || '').trim(),
      estab: a.ESTAB_ST_NUMERO || '', estab_nome: a.ESTAB_ST_NOME || '', periodo: { ini: a.DI, fim: a.DF }, lidas: num(a.ARQ_IN_QT_LIDAS), novas: num(a.ARQ_IN_QT_NOVAS), ja: num(a.ARQ_IN_QT_JA), erros: num(a.ARQ_IN_QT_ERRO),
      bruto: num(a.ARQ_RE_BRUTO), taxas: num(a.ARQ_RE_TAXAS), liquido: num(a.ARQ_RE_LIQUIDO), usuario: a.USU_ST_LOGIN || '', em: a.EM, processado_em: a.PROC,
      linhas: ls.map(l => ({ ordem: num(l.ORD), aba: l.ABA, data: l.DT, hora: l.HR || '', status: l.ST || '', modalidade: l.MOD || '', tipo: l.TP || '', bandeira: l.BAND || '', parcelas: l.NP ? num(l.NP) : null, parcela: l.PARC ? num(l.PARC) : null,
        bruto: l.BRUTO == null ? null : num(l.BRUTO), taxas: l.TAXAS == null ? null : num(l.TAXAS), liquido: l.LIQ == null ? null : num(l.LIQ), nsu: l.NSU || '', autorizacao: l.AUT || '', descricao: l.DESCR || '',
        situacao: { N: 'nova', J: 'ja', E: 'erro', I: 'importada' }[l.SIT] || l.SIT, motivo: l.MOT || '' })) };
  }

  app.get('/cbc/arquivos/:id', opera, async (req) => ({ id: num(req.params.id), ...(await lerArquivo(req.params.id)) }));
  app.get('/cbc/arquivos', opera, async (req) => {
    const fil = num(req.query.filial);
    const rows = await megaQuery(`SELECT * FROM (SELECT A.ARQ_IN_CODIGO ID, A.ARQ_ST_NOME NOME, A.ARQ_CH_TIPO TIPO, A.FIL_IN_CODIGO FIL, A.ESTAB_ST_NUMERO ESTAB, A.ESTAB_ST_NOME ESTAB_NOME, A.ARQ_CH_STATUS ST, A.ARQ_ST_MENSAGEM MSG,
        A.ARQ_IN_QT_LIDAS LIDAS, A.ARQ_IN_QT_NOVAS NOVAS, A.ARQ_IN_QT_JA JA, A.ARQ_IN_QT_ERRO ERROS, A.ARQ_RE_BRUTO BRUTO, A.ARQ_RE_LIQUIDO LIQ, A.USU_ST_LOGIN USU, TO_CHAR(A.ARQ_DT_PROCESSADO,'YYYY-MM-DD HH24:MI') EM,
        TO_CHAR(A.ARQ_DT_INI,'YYYY-MM-DD') DI, TO_CHAR(A.ARQ_DT_FIM,'YYYY-MM-DD') DF
        FROM MEGA.CCS_TB_GFIN_CBC_ARQUIVO A WHERE A.ARQ_CH_STATUS IN ('I','X') ${fil ? `AND A.FIL_IN_CODIGO = ${fil}` : ''} ORDER BY A.ARQ_IN_CODIGO DESC) WHERE ROWNUM <= 80`);
    return { arquivos: rows.map(r => ({ id: num(r.ID), nome: r.NOME, tipo: r.TIPO, filial: num(r.FIL), estab: r.ESTAB || '', estab_nome: r.ESTAB_NOME || '', status: r.ST, mensagem: r.MSG || '',
      lidas: num(r.LIDAS), novas: num(r.NOVAS), ja: num(r.JA), erros: num(r.ERROS), bruto: num(r.BRUTO), liquido: num(r.LIQ), usuario: r.USU || '', em: r.EM, periodo: { ini: r.DI, fim: r.DF } })) };
  });

  // ------------------------------------------------------------------------------------------------ efetivar na FIN_CONCILIACAO (conta REDE)
  // [18/11/2026 - Alexandre Carvalho] "botao efetivar que lance na fin_conciliacao na conta 27619 o que importamos": so o relatorio de recebimentos
  // (P credito liquido, D/A/C debito), por filial, linhas com data anterior a hoje e ainda sem CBA. SQL: sql/41_cbc_efetiva.sql (CCS_P_GFIN_CBC_EFETIVA).
  const CRIT = fil => `L.FIL_IN_CODIGO = ${fil} AND L.LIN_CH_SITUACAO = 'I' AND L.CBA_IN_SEQUENCIA IS NULL AND L.LIN_CH_ABA IN ('P','D','A','C')
       AND A.ARQ_IN_CODIGO = L.ARQ_IN_CODIGO AND A.ARQ_CH_TIPO = 'R' AND A.ARQ_CH_STATUS = 'I'`;
  const VALOR = `CASE WHEN L.LIN_CH_ABA = 'P' THEN NVL(L.LIN_RE_LIQUIDO, NVL(L.LIN_RE_BRUTO,0) - NVL(L.LIN_RE_MDR,0)) WHEN L.LIN_CH_ABA = 'D' THEN NVL(L.LIN_RE_BRUTO,0) ELSE NVL(L.LIN_RE_LIQUIDO, NVL(L.LIN_RE_BRUTO,0)) END`;
  async function contaRede() {
    const p = await megaQuery(`SELECT PARAM_ST_CHAVE CH, PARAM_RE_VALOR VL FROM MEGA.CCS_TB_GFIN_PARAM WHERE PARAM_ST_CHAVE IN ('CBC_CONTA','CBC_BANCO')`);
    const conta = num(p.find(x => x.CH === 'CBC_CONTA')?.VL), banco = num(p.find(x => x.CH === 'CBC_BANCO')?.VL);
    if (!conta) throw falha(500, 'Parametro CBC_CONTA (conta financeira da Rede) nao cadastrado.');
    const n = (await megaQuery(`SELECT SUBSTR(AGN_ST_NOME,1,60) NOME FROM MEGA.GLO_AGENTES WHERE AGN_TAB_IN_CODIGO = 53 AND AGN_IN_CODIGO = ${conta}`))[0];
    return { conta, banco, nome: (n?.NOME || '').trim() };
  }
  // o que seria lancado agora nesta filial (so leitura) + o que ainda espera (data de hoje)
  app.get('/cbc/efetivar/pendentes', opera, async (req) => {
    const fil = num(req.query.filial);
    if (!fil) throw falha(400, 'Informe a filial.');
    const c = await contaRede();
    const porAba = await megaQuery(`SELECT L.LIN_CH_ABA ABA, CASE WHEN L.LIN_DT_DATA < TRUNC(SYSDATE) THEN 'P' ELSE 'H' END Q, COUNT(*) N, SUM(${VALOR}) V,
        TO_CHAR(MIN(L.LIN_DT_DATA),'YYYY-MM-DD') DI, TO_CHAR(MAX(L.LIN_DT_DATA),'YYYY-MM-DD') DF
        FROM MEGA.CCS_TB_GFIN_CBC_LINHA L, MEGA.CCS_TB_GFIN_CBC_ARQUIVO A WHERE ${CRIT(fil)} GROUP BY L.LIN_CH_ABA, CASE WHEN L.LIN_DT_DATA < TRUNC(SYSDATE) THEN 'P' ELSE 'H' END`);
    const linhas = await megaQuery(`SELECT * FROM (SELECT L.ARQ_IN_CODIGO ARQ, L.LIN_IN_ORDEM ORD, L.LIN_CH_ABA ABA, TO_CHAR(L.LIN_DT_DATA,'YYYY-MM-DD') DT, L.LIN_ST_STATUS ST, L.LIN_ST_MODALIDADE MOD, L.LIN_ST_BANDEIRA BAND,
        L.LIN_IN_PARCELAS NP, L.LIN_IN_PARCELA PARC, L.LIN_ST_NSU NSU, L.LIN_ST_DESCRICAO DESCR, ${VALOR} V, CASE WHEN L.LIN_DT_DATA < TRUNC(SYSDATE) THEN 'P' ELSE 'H' END Q
        FROM MEGA.CCS_TB_GFIN_CBC_LINHA L, MEGA.CCS_TB_GFIN_CBC_ARQUIVO A WHERE ${CRIT(fil)} ORDER BY L.LIN_DT_DATA, L.ARQ_IN_CODIGO, L.LIN_IN_ORDEM) WHERE ROWNUM <= 1500`);
    const ja = (await megaQuery(`SELECT COUNT(*) N, NVL(SUM(CBA_RE_VALOR),0) V FROM MEGA.FIN_CONCILIACAO WHERE AGN_TAB_IN_CODIGO = 53 AND AGN_IN_CODIGO = ${c.conta} AND AGN_TAU_ST_CODIGO = 'N' AND FIL_IN_CODIGO = ${fil}`))[0];
    const soma = (q, nat) => r2(porAba.filter(x => x.Q === q && (nat === 'C' ? x.ABA === 'P' : x.ABA !== 'P')).reduce((s, x) => s + num(x.V), 0));
    const qt = q => porAba.filter(x => x.Q === q).reduce((s, x) => s + num(x.N), 0);
    const datas = porAba.filter(x => x.Q === 'P').flatMap(x => [x.DI, x.DF]).filter(Boolean).sort();
    return { conta: c, filial: fil, prontas: { linhas: qt('P'), creditos: soma('P', 'C'), debitos: soma('P', 'D'), periodo: { ini: datas[0] || null, fim: datas[datas.length - 1] || null },
        por_aba: Object.fromEntries(porAba.filter(x => x.Q === 'P').map(x => [ABAS[x.ABA] || x.ABA, { linhas: num(x.N), valor: r2(x.V) }])) },
      aguardando_hoje: { linhas: qt('H'), creditos: soma('H', 'C'), debitos: soma('H', 'D') },
      ja_na_conta: { linhas: num(ja?.N), valor: r2(ja?.V) },
      linhas: linhas.map(l => ({ arq: num(l.ARQ), ordem: num(l.ORD), aba: l.ABA, data: l.DT, status: l.ST || '', modalidade: l.MOD || '', bandeira: l.BAND || '', parcelas: l.NP ? num(l.NP) : null, parcela: l.PARC ? num(l.PARC) : null,
        nsu: l.NSU || '', descricao: l.DESCR || '', natureza: l.ABA === 'P' ? 'C' : 'D', valor: r2(l.V), hoje: l.Q === 'H' })) };
  });
  async function lerEfetivacao(id) {
    const e = (await megaQuery(`SELECT E.*, TO_CHAR(E.EFE_DT_INCLUSAO,'YYYY-MM-DD HH24:MI') EM, TO_CHAR(E.EFE_DT_PROCESSADO,'YYYY-MM-DD HH24:MI') PROC, TO_CHAR(E.EFE_DT_INI,'YYYY-MM-DD') DI, TO_CHAR(E.EFE_DT_FIM,'YYYY-MM-DD') DF
        FROM MEGA.CCS_TB_GFIN_CBC_EFETIVA E WHERE E.EFE_IN_CODIGO = ${num(id)}`))[0];
    if (!e) throw falha(404, 'Efetivacao nao encontrada.');
    return { id: num(e.EFE_IN_CODIGO), status: e.EFE_CH_STATUS, mensagem: e.EFE_ST_MENSAGEM || '', filial: num(e.FIL_IN_CODIGO), conta: num(e.CTA_AGN_IN_CODIGO), periodo: { ini: e.DI, fim: e.DF },
      linhas: num(e.EFE_IN_QT_LINHAS), puladas: num(e.EFE_IN_QT_PULADAS), creditos: num(e.EFE_RE_CREDITOS), debitos: num(e.EFE_RE_DEBITOS), usuario: e.USU_ST_LOGIN || '', em: e.EM, processado_em: e.PROC };
  }
  // simular = 'valida tudo e desfaz'; sem simular = grava (tudo ou nada). Uma efetivacao por chamada.
  app.post('/cbc/efetivar', { ...opera, schema: { body: { type: 'object', required: ['filial'], properties: { filial: { type: 'integer', minimum: 1 }, simular: { type: 'boolean' } } } } }, async (req) => {
    // [20/11/2026 - ALEXANDRE CARVALHO] DESLIGADO: a baixa do cartao cai no Itau da loja, a 27619 nunca tem par na conciliacao do Mega.
    // A perna do Mega e feita no extrato do Itau. As 112 linhas da efetivacao 9 foram apagadas (backup CCS_TB_BKP_CBC_FINCONC_20112026).
    if (!EFETIVAR_LIGADO) throw falha(410, 'Efetivar na conta REDE esta desligado desde 20/11/2026: a conciliacao do cartao e feita no extrato do Itau da loja.');
    const fil = num(req.body.filial), simular = req.body.simular === true;
    const fils = await filiaisValidas();
    if (!fils.some(f => f.fil === fil)) throw falha(400, `Filial ${fil} invalida.`);
    const c = await contaRede();
    // nada pronto = responde antes de abrir uma efetivacao (senao o historico enche de "recusada: nada a efetivar")
    const n = num((await megaQuery(`SELECT COUNT(*) N FROM MEGA.CCS_TB_GFIN_CBC_LINHA L, MEGA.CCS_TB_GFIN_CBC_ARQUIVO A WHERE ${CRIT(fil)} AND L.LIN_DT_DATA < TRUNC(SYSDATE)`))[0]?.N);
    if (!n) throw falha(400, 'Nada a efetivar nesta filial: nenhuma linha importada do relatorio de recebimentos com data anterior a hoje e ainda sem lancamento.');
    const id = num((await megaQuery(`SELECT MEGA.CCS_SEQ_GFIN_CBC_EFETIVA.NEXTVAL ID FROM DUAL`))[0].ID);
    await megaExec(`BEGIN INSERT INTO MEGA.CCS_TB_GFIN_CBC_EFETIVA (EFE_IN_CODIGO, FIL_IN_CODIGO, CTA_AGN_IN_CODIGO, EFE_CH_STATUS, USU_IN_CODIGO, USU_ST_LOGIN)
      VALUES (${id}, ${fil}, ${c.conta}, 'P', ${num(req.user.sub)}, '${txt(login(req), 60)}'); COMMIT; END;`);
    try { await megaExec(`BEGIN MEGA.CCS_P_GFIN_CBC_EFETIVA(${id}, '${simular ? 'S' : 'N'}'); END;`); }
    catch (e) {
      const r = await lerEfetivacao(id).catch(() => null);
      if (r && r.status !== 'P') return r;
      throw falha(502, `Falha de comunicacao com o Mega (${String(e.message || e).slice(0, 160)}). Veja o historico de efetivacoes antes de tentar de novo.`);
    }
    const r = await lerEfetivacao(id);
    if (simular && r.status === 'P') { await megaExec(`BEGIN DELETE FROM MEGA.CCS_TB_GFIN_CBC_EFETIVA WHERE EFE_IN_CODIGO = ${id} AND EFE_CH_STATUS = 'P'; COMMIT; END;`).catch(() => {}); }
    req.log.info({ gfin: 'cbc_efetivar', id, fil, simular, usu: req.user.sub, status: r.status }, 'efetivacao Rede na FIN_CONCILIACAO');
    return r;
  });
  // [19/11/2026 - ALEXANDRE CARVALHO] CONFERENCIA DO CARTAO DE CREDITO por filial (Rede x baixa automatica do Mega), so leitura. Ver cbcCredito.js.
  app.get('/cbc/conferencia/credito', opera, async (req) => conferirCredito(megaQuery, req.query.filial));
  app.get('/cbc/efetivacoes', opera, async (req) => {
    const fil = num(req.query.filial);
    const rows = await megaQuery(`SELECT * FROM (SELECT E.EFE_IN_CODIGO ID, E.FIL_IN_CODIGO FIL, E.CTA_AGN_IN_CODIGO CTA, E.EFE_CH_STATUS ST, E.EFE_ST_MENSAGEM MSG, E.EFE_IN_QT_LINHAS N, E.EFE_RE_CREDITOS C, E.EFE_RE_DEBITOS D,
        E.USU_ST_LOGIN USU, TO_CHAR(E.EFE_DT_PROCESSADO,'YYYY-MM-DD HH24:MI') EM, TO_CHAR(E.EFE_DT_INI,'YYYY-MM-DD') DI, TO_CHAR(E.EFE_DT_FIM,'YYYY-MM-DD') DF
        FROM MEGA.CCS_TB_GFIN_CBC_EFETIVA E WHERE E.EFE_CH_STATUS IN ('E','X') ${fil ? `AND E.FIL_IN_CODIGO = ${fil}` : ''} ORDER BY E.EFE_IN_CODIGO DESC) WHERE ROWNUM <= 80`);
    return { efetivacoes: rows.map(r => ({ id: num(r.ID), filial: num(r.FIL), conta: num(r.CTA), status: r.ST, mensagem: r.MSG || '', linhas: num(r.N), creditos: num(r.C), debitos: num(r.D), usuario: r.USU || '', em: r.EM, periodo: { ini: r.DI, fim: r.DF } })) };
  });
}
