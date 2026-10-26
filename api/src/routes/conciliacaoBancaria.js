// [26/10/2026 - Alexandre Carvalho] CONCILIACAO BANCARIA (Quality): importacao do extrato pelo Gestor + conferencia com o Mega em niveis.
// Desenho e diagnostico: Instrucoes/Gestor_Financeiro_Conciliacao_Bancaria_Importacao.md. SQL: sql/34_cb_importacao.sql.
//   POST /cb/analisar               - SO LEITURA: conta do arquivo x GLO_CONTASFIN, tipo do banco x FIN_TIPODOCTOBANCO, ja importado, duplicidade, saldos
//   POST /cb/preparar               - grava a importacao PENDENTE (CCS_TB_GFIN_CB_ARQUIVO/LINHA) e VALIDA no Mega sem gravar (CCS_P_GFIN_CB_IMPORTA 'S')
//   POST /cb/arquivos/:id/importar  - grava de verdade em FIN_CONCILIACAO (tudo ou nada; duplicidade conferida de novo com a conta travada)
//   GET  /cb/arquivos[/:id]         - historico de importacoes e linhas
//   GET  /cb/conferencia            - linhas pendentes da conta x Mega (motor do Baixar e conciliar, com os niveis 1-3 de correspondencia)
//   GET  /cb/candidatos             - conciliacao manual: lancamentos do Mega da conta perto da linha do banco
//   POST /cb/conciliar              - pares banco x Mega -> CCS_P_GFIN_BXC_CONC (tipo A dos niveis 1-2, M quando o usuario montou o par)
// O leitor do .RET roda no navegador (web/src/pages/baixas/cnab240.js); aqui chegam so os lancamentos lidos. Nada e gravado sem confirmacao.
import crypto from 'node:crypto';
import { megaQuery, megaExec } from '../soap/mega.js';
import { motor, params, executarConc, orgDasLinhas, movsPendentes, tpdCompativel } from './baixarConciliar.js';

const MOD_OPERA = 'BAIXAS_CONCILIACAO';
const num = v => Number(v || 0);
const r2 = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const ehData = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const dt = s => `TO_DATE('${s}','YYYY-MM-DD')`;
const isoHoje = () => new Date().toISOString().slice(0, 10);
const addDias = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dias = (a, b) => Math.round((Date.parse(a + 'T12:00:00Z') - Date.parse(b + 'T12:00:00Z')) / 86400000);
// texto do banco vai igual ao arquivo (o Mega guarda espacos duplos: 'SISPAG  CARAJAS'); so tira o que o gateway nao aceita e dobra a aspa
const txt = (s, max) => String(s ?? '').replace(/[^\x20-\x7E]/g, ' ').slice(0, max).replace(/'/g, "''");
const chaveLinha = (data, nat, valor, hist) => `${data}|${nat}|${r2(valor).toFixed(2)}|${String(hist || '').trim().toUpperCase()}`;
const digitos = s => String(s || '').replace(/\D/g, '').replace(/^0+/, '');
const temModulo = (u, cod) => u?.perm === 'A' || (u?.modulos || []).some(m => m.codigo === cod);
// documento como a importacao nativa grava: Itau (layout 341.EXT.CONCILIACAO) = 12 ultimas posicoes do campo 202-240; demais = texto do campo
const docDoBanco = (banco, bruto, limpo) => (banco === 341 ? String(bruto ?? '').padStart(39, ' ').slice(-12) : String(bruto ?? limpo ?? '').trim().slice(-20));
const falha = (code, msg) => Object.assign(new Error(msg), { statusCode: code });

// ------------------------------------------------------------------------------------------------ identificacao da conta
async function contasDoBanco(banco) {
  const rows = await megaQuery(`
    SELECT C.AGN_IN_CODIGO AGN, C.AGN_PAD_IN_CODIGO PAD, C.AGE_IN_CODIGO AGE, C.CTA_ST_NUMERO CTA, NVL(C.CTA_BO_IMPORTAEXTRATO,'N') IMPEXT,
           TO_CHAR(C.CTA_DT_CONCFINANC,'YYYY-MM-DD') IMPLANT, SUBSTR(A.AGN_ST_NOME,1,70) NOME,
           (SELECT COUNT(*) FROM MEGA.CCS_TB_GFIN_BXC_CONTA K WHERE K.AGN_IN_CODIGO = C.AGN_IN_CODIGO AND K.CTA_CH_ATIVA = 'S') ESCOPO
      FROM MEGA.GLO_CONTASFIN C, MEGA.GLO_AGENTES_ID I, MEGA.GLO_AGENTES A
     WHERE C.AGN_TAB_IN_CODIGO = 53 AND C.AGN_TAU_ST_CODIGO = 'N' AND C.BAN_IN_NUMERO = ${num(banco)}
       AND I.AGN_TAB_IN_CODIGO = C.AGN_TAB_IN_CODIGO AND I.AGN_PAD_IN_CODIGO = C.AGN_PAD_IN_CODIGO AND I.AGN_IN_CODIGO = C.AGN_IN_CODIGO
       AND I.AGN_TAU_ST_CODIGO = 'N' AND NVL(I.AGN_CH_STATUS,'A') = 'A'
       AND A.AGN_TAB_IN_CODIGO = C.AGN_TAB_IN_CODIGO AND A.AGN_PAD_IN_CODIGO = C.AGN_PAD_IN_CODIGO AND A.AGN_IN_CODIGO = C.AGN_IN_CODIGO`);
  return rows.map(r => ({ agn: num(r.AGN), pad: num(r.PAD), agencia: String(r.AGE || ''), numero: String(r.CTA || '').trim(), nome: (r.NOME || '').trim(),
    importa_extrato: r.IMPEXT === 'S', implantacao: r.IMPLANT || null, no_escopo: num(r.ESCOPO) > 0 }));
}
// agencia: o Mega guarda o numero (453) ou numero+DV (32111); conta: digitos do texto (com DV) = conta do arquivo + DV (ou sem DV)
function casarConta(contas, agencia, conta, dv) {
  const ag = String(parseInt(agencia, 10) || ''), ct = digitos(conta), alvo = new Set([`${ct}${String(dv || '').trim()}`, ct].map(digitos).filter(Boolean));
  return contas.filter(c => {
    const a = digitos(c.agencia);
    const agOk = a === ag || (a.length === ag.length + 1 && a.startsWith(ag));
    return agOk && alvo.has(digitos(c.numero));
  });
}
async function filiaisDaConta(agn) {
  const usadas = await megaQuery(`SELECT B.FIL_IN_CODIGO FIL, B.ORG_IN_CODIGO ORG, COUNT(*) N FROM MEGA.FIN_CONCILIACAO B
     WHERE B.AGN_TAB_IN_CODIGO = 53 AND B.AGN_IN_CODIGO = ${num(agn)} AND B.AGN_TAU_ST_CODIGO = 'N' AND B.CBA_DT_DATA > SYSDATE - 180
     GROUP BY B.FIL_IN_CODIGO, B.ORG_IN_CODIGO ORDER BY 3 DESC`);
  const escopo = await megaQuery(`SELECT FIL_IN_CODIGO FIL FROM MEGA.CCS_TB_GFIN_BXC_CONTA WHERE AGN_IN_CODIGO = ${num(agn)}`);
  const lista = usadas.map(u => ({ fil: num(u.FIL), org: num(u.ORG), linhas_180d: num(u.N) }));
  const sugerida = lista[0]?.fil ?? (escopo[0]?.FIL ? num(escopo[0].FIL) : null);
  return { sugerida, usadas: lista };
}
async function filiaisValidas() {
  const r = await megaQuery(`SELECT O.ORG_IN_CODIGO FIL, O.PAI_ORG_IN_CODIGO ORG, SUBSTR(O.ORG_ST_FANTASIA,1,40) NOME FROM MEGA.GLO_VW_ORGANIZACAO O
     WHERE O.ORG_TAB_IN_CODIGO = 53 AND O.ORG_PAD_IN_CODIGO = 1 AND O.PAI_ORG_IN_CODIGO IN (10, 20, 30) ORDER BY O.ORG_IN_CODIGO`);
  return r.map(x => ({ fil: num(x.FIL), org: num(x.ORG), nome: (x.NOME || '').trim() }));
}

// ------------------------------------------------------------------------------------------------ analise de uma conta do arquivo
async function analisarConta(arquivo, bloco, agnEscolhida) {
  const banco = num(arquivo.banco);
  const contas = await contasDoBanco(banco);
  const candidatas = casarConta(contas, bloco.agencia, bloco.conta, bloco.dv);
  const escolhida = agnEscolhida ? contas.find(c => c.agn === num(agnEscolhida)) : (candidatas.length === 1 ? candidatas[0] : null);
  const lancs = (bloco.lancamentos || []).map((l, i) => ({ ...l, ordem: i + 1 }));
  const creditos = r2(lancs.filter(l => l.dc === 'C').reduce((s, l) => s + num(l.valor), 0));
  const debitos = r2(lancs.filter(l => l.dc === 'D').reduce((s, l) => s + num(l.valor), 0));
  const lotes = bloco.lotes || [];
  const datas = lancs.map(l => l.data).filter(ehData).sort();
  const periodo = { ini: datas[0] || null, fim: datas[datas.length - 1] || null };
  const out = {
    agencia: bloco.agencia, conta: bloco.conta, dv: bloco.dv, titular: bloco.titular || '',
    candidatas, escolhida, conta_identificada: !!escolhida, ambigua: !agnEscolhida && candidatas.length > 1,
    resumo: { lancamentos: lancs.length, creditos, debitos, saldo_inicial: lotes[0]?.saldo_inicial ?? null, saldo_final: lotes[lotes.length - 1]?.saldo_final ?? null,
      lotes: lotes.map((L, k) => ({ natureza: L.natureza, qt: L.qt, saldo_inicial: L.saldo_inicial, saldo_final: L.saldo_final, fecha: bloco.fecha?.[k] ?? null })), periodo },
    linhas: [], filiais: null, arquivo_ja_importado: [],
  };
  // tipos do banco no Mega
  const tipos = new Map((await megaQuery(`SELECT TPDB_ST_CODIGO TPDB, TPD_ST_CODIGO TPD, NVL(TPDB_BO_IMPORTAR,'S') IMP FROM MEGA.FIN_TIPODOCTOBANCO WHERE BAN_IN_NUMERO = ${banco}`))
    .map(t => [String(t.TPDB), { tpd: t.TPD, importar: t.IMP === 'S' }]));
  // ja existente na conta (multiconjunto) - so quando a conta esta definida
  const existentes = new Map();
  if (escolhida && periodo.ini) {
    const rows = await megaQuery(`SELECT B.CBA_IN_SEQUENCIA CBA, TO_CHAR(B.CBA_DT_DATA,'YYYY-MM-DD') DT, B.CBA_CH_NATUREZA NAT, B.CBA_RE_VALOR VL, B.CBA_ST_HISTORICO HIST,
        B.CBA_CH_TIPO TP, NVL(B.CBA_CH_STATUS,'N') ST, B.CON_IN_SEQUENCIAL CON, B.CBA_ST_NOMEARQUIVO ARQ
        FROM MEGA.FIN_CONCILIACAO B WHERE B.AGN_TAB_IN_CODIGO = 53 AND B.AGN_IN_CODIGO = ${escolhida.agn} AND B.AGN_TAU_ST_CODIGO = 'N'
         AND B.CBA_DT_DATA BETWEEN ${dt(periodo.ini)} AND ${dt(periodo.fim)} ORDER BY B.CBA_IN_SEQUENCIA`);
    for (const r of rows) {
      const k = chaveLinha(r.DT, r.NAT, r.VL, r.HIST);
      if (!existentes.has(k)) existentes.set(k, []);
      existentes.get(k).push({ cba: num(r.CBA), tipo: r.TP, conciliada: r.ST === 'S' || !!r.CON, arquivo: r.ARQ || '' });
    }
    out.filiais = await filiaisDaConta(escolhida.agn);
    const porHash = await megaQuery(`SELECT ARQ_IN_CODIGO ID, ARQ_ST_NOME NOME, TO_CHAR(ARQ_DT_PROCESSADO,'YYYY-MM-DD HH24:MI') EM, USU_ST_LOGIN USU FROM MEGA.CCS_TB_GFIN_CB_ARQUIVO
       WHERE CTA_AGN_IN_CODIGO = ${escolhida.agn} AND ARQ_ST_HASH = '${txt(arquivo.hash, 64)}' AND ARQ_CH_STATUS = 'I'`);
    const porNome = await megaQuery(`SELECT COUNT(*) N, TO_CHAR(MAX(CBA_DT_IMPORTACAO),'YYYY-MM-DD HH24:MI') EM FROM MEGA.FIN_CONCILIACAO
       WHERE AGN_TAB_IN_CODIGO = 53 AND AGN_IN_CODIGO = ${escolhida.agn} AND REPLACE(UPPER(CBA_ST_NOMEARQUIVO),' ','') = '${txt(String(arquivo.nome).toUpperCase().replace(/\s+/g, ''), 228)}'`);
    out.arquivo_ja_importado = [...porHash.map(p => ({ origem: 'gestor', id: num(p.ID), em: p.EM, por: p.USU || '' })),
      ...(num(porNome[0]?.N) ? [{ origem: 'mega', linhas: num(porNome[0].N), em: porNome[0].EM }] : [])];
  }
  const vistos = new Map(), noArquivo = new Map();
  for (const l of lancs) { const k = chaveLinha(l.data, l.dc, l.valor, l.historico); noArquivo.set(k, (noArquivo.get(k) || 0) + 1); }
  const hoje = isoHoje();
  for (const l of lancs) {
    const k = chaveLinha(l.data, l.dc, l.valor, l.historico);
    const n = (vistos.get(k) || 0) + 1; vistos.set(k, n);
    const tp = tipos.get(String(l.categoria || ''));
    const doc = docDoBanco(banco, l.doc_bruto, l.documento);
    const linha = { ordem: l.ordem, seq: l.seq, data: l.data, natureza: l.dc, valor: r2(l.valor), lote: l.natureza || '', categoria: l.categoria || '', cod_hist: l.cod_hist || '',
      historico: String(l.historico || '').slice(0, 50), documento: doc, tpd: tp?.tpd || null, repetida_no_arquivo: noArquivo.get(k) > 1 ? noArquivo.get(k) : 0, situacao: 'nova', motivo: '' };
    if (!ehData(l.data) || l.data > addDias(hoje, 1) || l.data < '2015-01-01') { linha.situacao = 'erro'; linha.motivo = 'Data invalida ou fora do esperado'; }
    else if (!(num(l.valor) > 0)) { linha.situacao = 'erro'; linha.motivo = 'Valor zerado ou invalido'; }
    else if (!tp) { linha.situacao = 'erro'; linha.motivo = `Codigo ${l.categoria || '(vazio)'} do banco ${banco} sem tipo de documento no Mega`; }
    else if (!tp.importar) { linha.situacao = 'fora'; linha.motivo = 'Tipo do banco marcado no Mega para nao importar'; }
    else if (escolhida) {
      const ex = existentes.get(k) || [];
      if (n <= ex.length) { linha.situacao = 'ja'; linha.existente = ex[n - 1]; linha.motivo = ex[n - 1].conciliada ? 'Ja esta no Mega e conciliada' : 'Ja esta no Mega (pendente de conciliar)'; }
    }
    out.linhas.push(linha);
  }
  const c = s => out.linhas.filter(x => x.situacao === s).length;
  Object.assign(out.resumo, { novas: c('nova'), ja_importadas: c('ja'), fora: c('fora'), erros: c('erro'), repetidas: out.linhas.filter(x => x.repetida_no_arquivo).length,
    lotes_fecham: out.resumo.lotes.every(L => L.fecha !== false) });
  return out;
}

function validaArquivo(b) {
  if (!b?.arquivo || !b.arquivo.nome || !/^[0-9a-f]{64}$/i.test(String(b.arquivo.hash || ''))) throw falha(400, 'Arquivo sem nome ou sem assinatura (hash).');
  if (!num(b.arquivo.banco)) throw falha(400, 'Arquivo sem codigo do banco no header.');
  if (!Array.isArray(b.contas) || !b.contas.length) throw falha(400, 'Nenhuma conta de extrato no arquivo.');
}

// ------------------------------------------------------------------------------------------------ rotas
export default async function conciliacaoBancariaRoutes(app) {
  const podeOperar = async (req, reply) => {
    if (!temModulo(req.user, MOD_OPERA)) return reply.code(403).send({ error: 'sem_modulo', message: 'Seu usuario nao tem o modulo Baixas/Conciliacao.' });
    if (!Number.isInteger(Number(req.user?.sub)) || Number(req.user.sub) <= 0) return reply.code(403).send({ error: 'sem_usuario_mega', message: 'Sessao sem usuario do Mega. Entre de novo.' });
  };
  const opera = { preHandler: [app.authenticate, podeOperar], bodyLimit: 8 * 1024 * 1024 };
  const login = req => String(req.user.login || req.user.nome || '').slice(0, 60);

  app.post('/cb/analisar', opera, async (req) => {
    validaArquivo(req.body);
    const escolhas = req.body.escolhas || {};
    const contas = [];
    for (const bloco of req.body.contas) contas.push(await analisarConta(req.body.arquivo, bloco, escolhas[`${bloco.agencia}|${bloco.conta}`]));
    return { arquivo: { nome: req.body.arquivo.nome, banco: num(req.body.arquivo.banco), banco_nome: req.body.arquivo.banco_nome || '', gerado_em: req.body.arquivo.gerado_em || null },
      filiais: await filiaisValidas(), contas };
  });

  // grava a importacao pendente (cabecalho + linhas) e valida no Mega sem gravar
  app.post('/cb/preparar', opera, async (req) => {
    validaArquivo(req.body);
    const b = req.body, bloco = b.contas[0], agn = num(b.agn), fil = num(b.fil);
    if (!agn || !fil) throw falha(400, 'Escolha a conta e a filial.');
    const fils = await filiaisValidas();
    if (!fils.some(f => f.fil === fil)) throw falha(400, `Filial ${fil} invalida.`);
    const an = await analisarConta(b.arquivo, bloco, agn);                       // nunca confiar na situacao vinda do navegador
    if (!an.escolhida) throw falha(400, 'Conta nao encontrada entre as contas ativas do banco do arquivo.');
    if (!an.candidatas.some(c => c.agn === agn) && b.confirma_conta_diferente !== true) throw falha(400, 'A conta escolhida nao bate com agencia/conta do arquivo. Confirme a conta diferente para continuar.');
    const token = crypto.randomUUID();
    const id = num((await megaQuery(`SELECT MEGA.CCS_SEQ_GFIN_CB_ARQUIVO.NEXTVAL ID FROM DUAL`))[0].ID);
    const R = an.resumo, si = R.saldo_inicial?.valor, sf = R.saldo_final?.valor;
    const dtArq = ehData(String(b.arquivo.data_arquivo || '').slice(0, 10)) ? `TO_DATE('${String(b.arquivo.data_arquivo).slice(0, 19).replace('T', ' ')}','YYYY-MM-DD HH24:MI:SS')` : 'SYSDATE';
    await megaExec(`BEGIN
      INSERT INTO MEGA.CCS_TB_GFIN_CB_ARQUIVO (ARQ_IN_CODIGO, ARQ_ST_TOKEN, ARQ_ST_HASH, ARQ_ST_NOME, ARQ_DT_ARQUIVO, BAN_IN_NUMERO, ARQ_ST_AGENCIA, ARQ_ST_CONTA,
        CTA_AGN_IN_CODIGO, FIL_IN_CODIGO, ARQ_DT_INI, ARQ_DT_FIM, ARQ_RE_SALDO_INI, ARQ_RE_SALDO_FIM, ARQ_RE_CREDITOS, ARQ_RE_DEBITOS, ARQ_IN_QT_LIDAS,
        ARQ_IN_QT_NOVAS, ARQ_IN_QT_JA, ARQ_IN_QT_FORA, ARQ_IN_QT_ERRO, ARQ_CH_STATUS, USU_IN_CODIGO, USU_ST_LOGIN)
      VALUES (${id}, '${token}', '${txt(b.arquivo.hash, 64)}', '${txt(b.arquivo.nome, 228)}', ${dtArq}, ${num(b.arquivo.banco)}, '${txt(bloco.agencia, 10)}', '${txt(`${bloco.conta}-${bloco.dv || ''}`, 20)}',
        ${agn}, ${fil}, ${R.periodo.ini ? dt(R.periodo.ini) : 'NULL'}, ${R.periodo.fim ? dt(R.periodo.fim) : 'NULL'}, ${si == null ? 'NULL' : r2(si)}, ${sf == null ? 'NULL' : r2(sf)},
        ${R.creditos}, ${R.debitos}, ${R.lancamentos}, ${R.novas}, ${R.ja_importadas}, ${R.fora}, ${R.erros}, 'P', ${num(req.user.sub)}, '${txt(login(req), 60)}');
      COMMIT; END;`);
    const sit = { nova: 'N', ja: 'J', fora: 'N', erro: 'E' };      // 'fora' vai como N: a procedure confere o TPDB_BO_IMPORTAR e marca F
    for (let i = 0; i < an.linhas.length; i += 40) {
      const parte = an.linhas.slice(i, i + 40).map(l => `INSERT INTO MEGA.CCS_TB_GFIN_CB_LINHA (ARQ_IN_CODIGO, LIN_IN_ORDEM, LIN_ST_SEQARQ, LIN_ST_LOTE_NAT, LIN_DT_DATA, LIN_CH_NATUREZA,
          LIN_RE_VALOR, LIN_ST_CATEGORIA, LIN_ST_CODHIST, LIN_ST_HISTORICO, LIN_ST_DOCUMENTO, TPD_ST_CODIGO, LIN_CH_SITUACAO, LIN_ST_MOTIVO, CBA_IN_SEQUENCIA)
        VALUES (${id}, ${l.ordem}, '${txt(l.seq, 20)}', '${txt(l.lote, 3)}', ${ehData(l.data) ? dt(l.data) : 'DATE \'1900-01-01\''}, '${l.natureza === 'C' ? 'C' : 'D'}',
          ${r2(l.valor)}, '${txt(l.categoria, 3)}', '${txt(l.cod_hist, 4)}', '${txt(l.historico, 50)}', '${txt(l.documento, 20)}', ${l.tpd ? `'${txt(l.tpd, 10)}'` : 'NULL'},
          '${sit[l.situacao] || 'E'}', ${l.motivo ? `'${txt(l.motivo, 300)}'` : 'NULL'}, ${l.existente?.cba ? num(l.existente.cba) : 'NULL'});`).join('\n');
      await megaExec(`BEGIN\n${parte}\nCOMMIT;\nEND;`);
    }
    await megaExec(`BEGIN MEGA.CCS_P_GFIN_CB_IMPORTA(${id}, 'S'); END;`);
    return { id, ...(await lerArquivo(id)) };
  });

  app.post('/cb/arquivos/:id/importar', opera, async (req) => {
    const id = num(req.params.id);
    const a = (await megaQuery(`SELECT ARQ_CH_STATUS ST, ROUND((SYSDATE - ARQ_DT_INCLUSAO) * 24, 2) HORAS FROM MEGA.CCS_TB_GFIN_CB_ARQUIVO WHERE ARQ_IN_CODIGO = ${id}`))[0];
    if (!a) throw falha(404, 'Importacao nao encontrada.');
    if (a.ST !== 'P') throw falha(409, a.ST === 'I' ? 'Esta importacao ja foi gravada.' : 'Esta importacao foi recusada na validacao. Analise o arquivo de novo.');
    if (num(a.HORAS) > 6) throw falha(409, 'Validacao com mais de 6 horas. Analise o arquivo de novo.');
    try { await megaExec(`BEGIN MEGA.CCS_P_GFIN_CB_IMPORTA(${id}, 'N'); END;`); }
    catch (e) {
      const r = await lerArquivo(id).catch(() => null);
      if (r && r.status !== 'P') return { id, ...r };
      throw falha(502, `Falha de comunicacao com o Mega (${String(e.message || e).slice(0, 160)}). Abra o historico de importacoes antes de tentar de novo.`);
    }
    req.log.info({ gfin: 'cb_importar', id, usu: req.user.sub }, 'importacao de extrato');
    return { id, ...(await lerArquivo(id)) };
  });

  async function lerArquivo(id) {
    const a = (await megaQuery(`SELECT A.*, TO_CHAR(A.ARQ_DT_INCLUSAO,'YYYY-MM-DD HH24:MI') EM, TO_CHAR(A.ARQ_DT_PROCESSADO,'YYYY-MM-DD HH24:MI') PROC,
        TO_CHAR(A.ARQ_DT_INI,'YYYY-MM-DD') DI, TO_CHAR(A.ARQ_DT_FIM,'YYYY-MM-DD') DF,
        (SELECT SUBSTR(MAX(G.AGN_ST_NOME),1,60) FROM MEGA.GLO_AGENTES G WHERE G.AGN_TAB_IN_CODIGO = 53 AND G.AGN_IN_CODIGO = A.CTA_AGN_IN_CODIGO) CONTA_NOME
        FROM MEGA.CCS_TB_GFIN_CB_ARQUIVO A WHERE A.ARQ_IN_CODIGO = ${num(id)}`))[0];
    if (!a) throw falha(404, 'Importacao nao encontrada.');
    const ls = await megaQuery(`SELECT LIN_IN_ORDEM ORD, TO_CHAR(LIN_DT_DATA,'YYYY-MM-DD') DT, LIN_CH_NATUREZA NAT, LIN_RE_VALOR VL, LIN_ST_HISTORICO HIST, TPD_ST_CODIGO TPD,
        LIN_ST_CATEGORIA CAT, LIN_CH_SITUACAO SIT, LIN_ST_MOTIVO MOT, CBA_IN_SEQUENCIA CBA FROM MEGA.CCS_TB_GFIN_CB_LINHA WHERE ARQ_IN_CODIGO = ${num(id)} ORDER BY LIN_IN_ORDEM`);
    return { status: a.ARQ_CH_STATUS, mensagem: a.ARQ_ST_MENSAGEM || '', nome: a.ARQ_ST_NOME, conta: num(a.CTA_AGN_IN_CODIGO), conta_nome: a.CONTA_NOME || '', filial: num(a.FIL_IN_CODIGO),
      periodo: { ini: a.DI, fim: a.DF }, creditos: num(a.ARQ_RE_CREDITOS), debitos: num(a.ARQ_RE_DEBITOS), lidas: num(a.ARQ_IN_QT_LIDAS),
      novas: num(a.ARQ_IN_QT_NOVAS), ja: num(a.ARQ_IN_QT_JA), fora: num(a.ARQ_IN_QT_FORA), erros: num(a.ARQ_IN_QT_ERRO), usuario: a.USU_ST_LOGIN || '', em: a.EM, processado_em: a.PROC,
      linhas: ls.map(l => ({ ordem: num(l.ORD), data: l.DT, natureza: l.NAT, valor: num(l.VL), historico: l.HIST || '', tpd: l.TPD || '', categoria: l.CAT || '',
        situacao: { N: 'nova', J: 'ja', F: 'fora', E: 'erro', I: 'importada' }[l.SIT] || l.SIT, motivo: l.MOT || '', cba: l.CBA ? num(l.CBA) : null })) };
  }

  app.get('/cb/arquivos/:id', opera, async (req) => ({ id: num(req.params.id), ...(await lerArquivo(req.params.id)) }));
  app.get('/cb/arquivos', opera, async (req) => {
    const conta = num(req.query.conta);
    const rows = await megaQuery(`SELECT * FROM (SELECT A.ARQ_IN_CODIGO ID, A.ARQ_ST_NOME NOME, A.CTA_AGN_IN_CODIGO CTA, A.FIL_IN_CODIGO FIL, A.ARQ_CH_STATUS ST, A.ARQ_ST_MENSAGEM MSG,
        A.ARQ_IN_QT_LIDAS LIDAS, A.ARQ_IN_QT_NOVAS NOVAS, A.ARQ_IN_QT_JA JA, A.ARQ_IN_QT_ERRO ERROS, A.USU_ST_LOGIN USU, TO_CHAR(A.ARQ_DT_PROCESSADO,'YYYY-MM-DD HH24:MI') EM,
        TO_CHAR(A.ARQ_DT_INI,'YYYY-MM-DD') DI, TO_CHAR(A.ARQ_DT_FIM,'YYYY-MM-DD') DF,
        (SELECT SUBSTR(MAX(G.AGN_ST_NOME),1,60) FROM MEGA.GLO_AGENTES G WHERE G.AGN_TAB_IN_CODIGO = 53 AND G.AGN_IN_CODIGO = A.CTA_AGN_IN_CODIGO) CONTA_NOME
        FROM MEGA.CCS_TB_GFIN_CB_ARQUIVO A WHERE A.ARQ_CH_STATUS IN ('I','X') ${conta ? `AND A.CTA_AGN_IN_CODIGO = ${conta}` : ''} ORDER BY A.ARQ_IN_CODIGO DESC) WHERE ROWNUM <= 60`);
    return { arquivos: rows.map(r => ({ id: num(r.ID), nome: r.NOME, conta: num(r.CTA), conta_nome: r.CONTA_NOME || '', filial: num(r.FIL), status: r.ST, mensagem: r.MSG || '',
      lidas: num(r.LIDAS), novas: num(r.NOVAS), ja: num(r.JA), erros: num(r.ERROS), usuario: r.USU || '', em: r.EM, periodo: { ini: r.DI, fim: r.DF } })) };
  });

  // conferencia: motor do Baixar e conciliar (niveis) + o que ja foi conciliado no periodo e o lado Mega sem extrato
  app.get('/cb/conferencia', opera, async (req) => {
    const conta = num(req.query.conta);
    if (!conta) throw falha(400, 'Informe a conta.');
    const fim = ehData(req.query.fim) ? req.query.fim : isoHoje(), ini = ehData(req.query.ini) ? req.query.ini : addDias(fim, -30);
    const m = await motor(conta, { ini, fim });
    const conc = (await megaQuery(`SELECT COUNT(*) N, NVL(SUM(CBA_RE_VALOR),0) V FROM MEGA.FIN_CONCILIACAO WHERE AGN_TAB_IN_CODIGO = 53 AND AGN_IN_CODIGO = ${conta}
        AND AGN_TAU_ST_CODIGO = 'N' AND CBA_DT_DATA BETWEEN ${dt(ini)} AND ${dt(fim)} AND (NVL(CBA_CH_STATUS,'N') = 'S' OR CON_IN_SEQUENCIAL IS NOT NULL)`))[0];
    const P = await params();
    const usados = new Set(m.itens.flatMap(i => (i.movs || []).map(x => `${x.seq}.${x.lancto}`)));
    const megaSemBanco = (await movsPendentes(conta, ini, fim)).filter(x => !usados.has(`${x.seq}.${x.lancto}`));
    return { ...m, ja_conciliadas: { linhas: num(conc?.N), valor: r2(conc?.V) }, mega_sem_extrato: { qt: megaSemBanco.length, valor: r2(megaSemBanco.reduce((s, x) => s + x.vl, 0)) },
      niveis: { dias_forte: P.diasForte, janela: P.janela } };
  });

  // conciliacao manual: lancamentos pendentes da conta perto da linha do banco (natureza espelhada), com o tipo e a contraparte
  app.get('/cb/candidatos', opera, async (req) => {
    const conta = num(req.query.conta), cba = num(req.query.cba), janela = Math.min(Math.max(num(req.query.dias) || 10, 1), 45);
    if (!conta || !cba) throw falha(400, 'Informe a conta e a linha do extrato.');
    const l = (await megaQuery(`SELECT CBA_IN_SEQUENCIA CBA, TO_CHAR(CBA_DT_DATA,'YYYY-MM-DD') DT, CBA_CH_NATUREZA NAT, CBA_RE_VALOR VL, TPD_ST_CODIGO TPD, CBA_ST_HISTORICO HIST,
        CBA_ST_DOCUMENTO DOC, NVL(CBA_CH_STATUS,'N') ST, CON_IN_SEQUENCIAL CON FROM MEGA.FIN_CONCILIACAO WHERE CBA_IN_SEQUENCIA = ${cba} AND AGN_IN_CODIGO = ${conta}`))[0];
    if (!l) throw falha(404, 'Linha do extrato nao encontrada nesta conta.');
    if (l.ST === 'S' || l.CON) throw falha(409, 'Esta linha do extrato ja esta conciliada.');
    const natMega = l.NAT === 'D' ? 'C' : 'D', vl = r2(l.VL);
    const movs = (await movsPendentes(conta, addDias(l.DT, -janela), addDias(l.DT, janela))).filter(x => x.nat === natMega)
      .map(x => ({ seq: x.seq, lancto: x.lancto, data: x.data, valor: x.vl, tpd: x.tpd, documento: x.doc, historico: x.hist, contraparte: x.contraparte, acao: x.acao,
        dif_valor: r2(x.vl - vl), dif_dias: dias(x.data, l.DT), tipo_compativel: tpdCompativel(l.NAT, l.TPD, x.tpd) }))
      .sort((a, b) => Math.abs(a.dif_valor) - Math.abs(b.dif_valor) || Math.abs(a.dif_dias) - Math.abs(b.dif_dias)).slice(0, 150);
    return { linha: { cba: num(l.CBA), data: l.DT, natureza: l.NAT, valor: vl, tpd: l.TPD || '', historico: (l.HIST || '').trim(), documento: (l.DOC || '').trim() }, janela, movs };
  });

  app.post('/cb/conciliar', {
    ...opera, schema: { body: { type: 'object', required: ['pares'], properties: { simular: { type: 'boolean' },
      pares: { type: 'array', minItems: 1, maxItems: 200, items: { type: 'object', required: ['cbas', 'movs'], properties: { ref: { type: 'string', maxLength: 40 }, tipo: { type: 'string', enum: ['A', 'M'] },
        cbas: { type: 'array', minItems: 1, maxItems: 60, items: { type: 'integer', minimum: 1 } },
        movs: { type: 'array', minItems: 1, maxItems: 60, items: { type: 'object', required: ['seq', 'lancto'], properties: { seq: { type: 'integer' }, lancto: { type: 'integer' } } } } } } } } } }
  }, async (req) => {
    const ctx = { usu: Number(req.user.sub), login: login(req), origem: 'T', simular: req.body.simular === true }, resultados = [];
    for (const p of req.body.pares) {
      let r;
      try { const li = await orgDasLinhas(p.cbas); r = await executarConc({ org: li.org, conta: li.conta, movs: p.movs, cbas: p.cbas, tipo_conc: p.tipo === 'M' ? 'M' : 'A' }, ctx); }
      catch (e) { r = { status: 'X', mensagem: String(e.message || e).slice(0, 300) }; }
      req.log.info({ gfin: 'cb_conciliar', usu: ctx.usu, ref: p.ref, tipo: p.tipo, status: r.status, msg: r.mensagem }, 'conciliacao bancaria');
      resultados.push({ ref: p.ref || '', status: r.status, mensagem: r.mensagem || '', log_id: r.log_id || null, con_id: r.con_id || null });
    }
    return { simular: ctx.simular, resultados };
  });
}
