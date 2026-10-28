// [25/10/2026 - Alexandre Carvalho] FASE 2 QUALITY - "BAIXAR E CONCILIAR" (BXC): a baixa nasce da linha do extrato ja importada no Mega
// e sai conciliada na mesma transacao. Esta rota e o MOTOR DE CASAMENTO + a execucao (procedures CCS_P_GFIN_BXC*), a trilha/estorno,
// os pedidos de liberacao de encargos (Odette), o de-para dos movimentos reais (tarifas), a configuracao, o comprovante com OCR e o ROBO.
// Desenho: Instrucoes/Gestor_Financeiro_Baixa_e_Conciliacao_Fase2.md. SQL: sql/29, 30, 31 (bxc_*).
//
// Regras do motor, na ordem (cada linha pendente do extrato vira UM item e um titulo nunca e usado em dois itens):
//   ignorada (CCS_TB_GFIN_BXC_IGNORA) -> fora | APL/RESG/APLICACAO/RESG2/REND2 -> informativo | TPD com de-para ativo -> 'real'
//   lancamento do Mega com o mesmo valor, natureza espelhada e ate BXC_JANELA_DIAS -> 'conciliar' | linha COB -> 'lote' (soma de baixas
//   do retorno) | senao titulos em aberto: identidade (documento/nosso numero/nome no historico) > valor exato = saldo > valor = saldo +
//   encargos pela regra do titulo (ou - desconto) > soma de ate BXC_MAX_TITULOS titulos do mesmo agente | nada -> 'decidir' com candidatos.
//   Confianca alta = identidade ou nome confere; media = so a aritmetica fecha; baixa = aproximado. 'pronto' = alta ou media.
// Texto que vai para o SOAP: so ASCII e sem aspas simples. O usuario do Mega e o sub do token (nunca vem do corpo).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multipart from '@fastify/multipart';
import { megaQuery, megaExec } from '../soap/mega.js';
import { lerComprovante, confereComprovante } from './bxcOcr.js';

const MOD_OPERA = 'BAIXAS_CONCILIACAO', MOD_ENCARGOS = 'LIBERA_ENCARGOS';
const INFORMATIVOS = new Set(['APL', 'RESG', 'APLICACAO', 'RESG2', 'REND2', 'REND']);
// [28/10/2026] Itau Aplic Aut Mais: o lote da APLICACAO vem com categorias 000-007 (REND 000 liquido saindo, APLICACAO 001, RESG2 003, REND2 005
// bruto, IOF 006, IR 007) e e importado na mesma conta da c/c; fecha em zero. A entrada real do rendimento e a RESG C "REND PAGO APLIC AUT MAIS"
// da c/c, lancada pelo liquido via de-para COM "historico contem". IR/IOF desse lote ja estao descontados no liquido: nunca lancar.
const loteAplicacao = l => l.banco === 341 && /^00[0-7]$/.test(l.tpdb || '');
const motivoAplic = l => /APR D-1/i.test(l.hist) ? 'Previa do rendimento (arquivo do dia anterior): nao lancar'
  : l.tpd === 'REND' ? 'Rendimento liquido saindo da aplicacao: a entrada na conta e a linha REND PAGO APLIC AUT MAIS'
  : ['IR', 'IOF'].includes(l.tpd) ? `${l.tpd} do rendimento da aplicacao: ja descontado no liquido, nao lancar`
  : 'Aplicacao automatica / rendimento: movimento interno do banco';
const TPD_FIN_MAP = { PGTO: 'PGTOM', DEPP: 'DEPR' };
const UPLOADS = path.resolve(process.env.BXC_UPLOADS || 'uploads/bxc');

const num = v => Number(v || 0);
const r2 = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const f2 = v => r2(v).toFixed(2);
const ascii = (s, max) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]/g, ' ').replace(/'/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const dt = s => `TO_DATE('${s}','YYYY-MM-DD')`;
const isoHoje = () => new Date().toISOString().slice(0, 10);
const addDias = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dias = (a, b) => Math.round((Date.parse(a + 'T12:00:00Z') - Date.parse(b + 'T12:00:00Z')) / 86400000);
const isAdmin = u => u?.perm === 'A';
const temModulo = (u, cod) => isAdmin(u) || (u?.modulos || []).some(m => m.codigo === cod);
const ehData = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const RX_ID = /^(\d{1,6})\.(\d{1,6})\.(\d{1,12})$/;

// ---------------------------------------------------------------------------------------------------- parametros
let cacheParams = { t: 0, v: null };
export async function params() {
  if (cacheParams.v && Date.now() - cacheParams.t < 60_000) return cacheParams.v;
  const rows = await megaQuery(`SELECT PARAM_ST_CHAVE K, PARAM_RE_VALOR V FROM MEGA.CCS_TB_GFIN_PARAM WHERE PARAM_ST_CHAVE LIKE 'BXC_%' OR PARAM_ST_CHAVE LIKE 'CB_%'`);
  const v = {};
  for (const r of rows) v[r.K] = num(r.V);
  const p = {
    tolerancia: v.BXC_TOLERANCIA ?? 1, tetoRobo: v.BXC_TETO_ROBO ?? 50000, roboAtivo: (v.BXC_ROBO_ATIVO ?? 0) === 1, usuRobo: v.BXC_USU_ROBO ?? 0,
    janela: v.BXC_JANELA_DIAS ?? 5, titAntes: v.BXC_TIT_DIAS_ANTES ?? 90, titDepois: v.BXC_TIT_DIAS_DEPOIS ?? 30, maxTitulos: v.BXC_MAX_TITULOS ?? 6,
    // [26/10/2026] conciliacao bancaria: dias aceitos no nivel 2 (com identidade) e janela de sugestao (limitada a janela da procedure)
    diasForte: v.CB_DIAS_FORTE ?? 2, janelaCb: Math.min(v.CB_JANELA ?? 5, v.BXC_JANELA_DIAS ?? 5),
    exigeComprov: (v.BXC_EXIGE_COMPROV ?? 0) === 1, comprovAcima: v.BXC_COMPROV_ACIMA ?? 0, bruto: v,
  };
  cacheParams = { t: Date.now(), v: p };
  return p;
}

// ---------------------------------------------------------------------------------------------------- encargos
// Devolve { valor, juros, multa, desconto } que fecham o valor do banco para UM titulo, ou null se a regra do titulo nao explica a diferenca.
// Receber: juros = saldo x %juros/100/30 x dias de atraso + multa = saldo x %multa/100 (apenas em atraso). Pagar: a multa vira juros.
// Desconto: valor < saldo e a diferenca cabe no % de desconto ate a data base (ou e menor que a tolerancia).
export function calcEncargos(tipo, t, valorBanco, dataBanco, P) {
  const saldo = r2(t.saldo), vl = r2(valorBanco), tol = P.tolerancia;
  if (saldo <= 0 || vl <= 0) return null;
  const atraso = Math.max(0, dias(dataBanco, t.venc));
  if (Math.abs(vl - saldo) < 0.005) return { valor: saldo, juros: 0, multa: 0, desconto: 0, atraso };
  if (vl > saldo) {
    let juros = atraso > 0 ? r2(saldo * num(t.pjur) / 100 / 30 * atraso) : 0;
    let multa = atraso > 0 ? r2(saldo * num(t.pmul) / 100) : 0;
    if (tipo === 'P') { juros = r2(juros + multa); multa = 0; }
    const resid = r2(vl - (saldo + juros + multa));
    if (Math.abs(resid) > tol) return null;
    juros = r2(juros + resid);
    if (juros < 0) { multa = r2(multa + juros); juros = 0; if (multa < 0) return null; }
    return { valor: saldo, juros, multa, desconto: 0, atraso };
  }
  const desconto = r2(saldo - vl);
  const permitido = t.dtdesc && dataBanco <= t.dtdesc ? Math.max(r2(saldo * num(t.pdesc) / 100), r2(num(t.vdesc))) : r2(num(t.vdesc));
  if (desconto <= permitido + 0.005 || desconto <= tol) return { valor: vl, juros: 0, multa: 0, desconto, atraso };
  return null;
}

// palavras do historico do banco que identificam o agente (tira verbos/siglas do banco); nome confere se alguma esta no nome/fantasia
const palavras = h => String(h || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\b(BOLETO|PAGO|PIX|ENVIADO|RECEBIDO|TRANSF|TRANSFERENCIA|SISPAG|TED|DOC|PAG|PAGTO|PGTO|CRED|DEB|LIQ|LIQUIDACAO|COBRANCA|REM|NF|NFE|DEPOSITO|DEP|TITULO|REF|LTDA|EIRELI|S\/A|SA|ME|EPP|CIA|COM|IND|SERV)\b/g, ' ')
  .split(/[^A-Z0-9]+/).filter(w => w.length >= 4 && !/^\d+$/.test(w));
const nomeConfere = (hist, ...nomes) => { const ws = palavras(hist); if (!ws.length) return false; const n = nomes.filter(Boolean).join(' ').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); return ws.some(w => n.includes(w)); };
const numerosDe = s => [...String(s || '').matchAll(/\d{4,}/g)].map(m => m[0].replace(/^0+/, '')).filter(Boolean);
const identidade = (linha, t) => { const ns = numerosDe(linha.hist + ' ' + linha.doc); const alvo = [String(t.doc || '').replace(/^0+/, ''), String(t.nossonum || '').replace(/^0+/, '')].filter(x => x.length >= 4); return ns.some(n => alvo.some(a => a === n || (a.length >= 6 && n.endsWith(a)) || (n.length >= 6 && a.endsWith(n)))); };

const porAgente = lista => { const m = new Map(); for (const t of lista) { if (!m.has(t.agn_id)) m.set(t.agn_id, []); m.get(t.agn_id).push(t); } return [...m.values()]; };
// [28/10/2026] ate `limite` subconjuntos DIFERENTES cuja soma = alvo (para saber se a combinacao e unica); itens ordenados por valor desc
function combinacoes(itens, alvo, maxQt, limite = 2, orcamento = 60000) {
  if (limite <= 0) return [];
  const cents = itens.map(x => Math.round(x.vl * 100)), alvoC = Math.round(alvo * 100), saida = [];
  let nos = 0;
  const rec = (i, resto, pick) => {
    if (saida.length >= limite || nos++ > orcamento) return;
    if (resto === 0) { if (pick.length) saida.push(pick.map(k => itens[k])); return; }
    if (i >= cents.length || pick.length >= maxQt) return;
    let soma = 0; for (let k = i; k < cents.length && k < i + maxQt - pick.length; k++) soma += cents[k];
    if (soma < resto) return;
    if (cents[i] <= resto) { pick.push(i); rec(i + 1, resto - cents[i], pick); pick.pop(); }
    rec(i + 1, resto, pick);
  };
  rec(0, alvoC, []);
  return nos > orcamento ? [...saida, null].slice(0, limite) : saida;   // estourou o orcamento: trata como ambiguo
}

// subconjunto cuja soma = alvo (centavos), com poda e orcamento de nos; itens ja ordenados por valor desc
function subconjunto(itens, alvo, maxQt, orcamento = 150000) {
  const cents = itens.map(x => Math.round(x.vl * 100)), alvoC = Math.round(alvo * 100);
  let nos = 0, achado = null;
  const rec = (i, resto, pick) => {
    if (achado || nos++ > orcamento) return;
    if (resto === 0) { if (pick.length) achado = [...pick]; return; }
    if (i >= cents.length || pick.length >= maxQt) return;
    let soma = 0; for (let k = i; k < cents.length && k < i + maxQt - pick.length; k++) soma += cents[k];
    if (soma < resto) return;
    if (cents[i] <= resto) { pick.push(i); rec(i + 1, resto - cents[i], pick); pick.pop(); }
    rec(i + 1, resto, pick);
  };
  rec(0, alvoC, []);
  return achado ? achado.map(i => itens[i]) : null;
}

// ---------------------------------------------------------------------------------------------------- consultas do motor
async function contaInfo(agn) {
  const r = await megaQuery(`
    SELECT K.AGN_IN_CODIGO AGN, K.FIL_IN_CODIGO FIL, K.CTA_CH_ATIVA ATIVA, K.CTA_CH_ROBO ROBO, K.CTA_RE_TETO_ROBO TETO, K.CTA_IN_AGN_BANCO AGN_BANCO,
           (SELECT SUBSTR(MAX(A.AGN_ST_NOME),1,60) FROM MEGA.GLO_AGENTES A WHERE A.AGN_TAB_IN_CODIGO = 53 AND A.AGN_IN_CODIGO = K.AGN_IN_CODIGO) NOME,
           (SELECT MAX(C.BAN_IN_NUMERO) FROM MEGA.GLO_CONTASFIN C WHERE C.AGN_TAB_IN_CODIGO = 53 AND C.AGN_IN_CODIGO = K.AGN_IN_CODIGO AND C.AGN_TAU_ST_CODIGO = 'N') BANCO
      FROM MEGA.CCS_TB_GFIN_BXC_CONTA K WHERE K.AGN_IN_CODIGO = ${num(agn)}`);
  if (!r[0]) return null;
  const k = r[0];
  return { agn_id: num(k.AGN), nome: k.NOME || '', banco: k.BANCO ? num(k.BANCO) : null, fil_id: num(k.FIL), ativa: k.ATIVA === 'S', robo: k.ROBO === 'S', teto_robo: k.TETO ? num(k.TETO) : null, agn_banco: k.AGN_BANCO ? num(k.AGN_BANCO) : null };
}

export async function linhasPendentes(agn, ini, fim, filtro) {
  const rows = await megaQuery(`
    SELECT * FROM (
      SELECT B.CBA_IN_SEQUENCIA CBA, B.ORG_IN_CODIGO ORG, B.FIL_IN_CODIGO FIL, TO_CHAR(B.CBA_DT_DATA,'YYYY-MM-DD') DT, B.CBA_CH_NATUREZA NAT, B.CBA_RE_VALOR VL,
             B.TPD_ST_CODIGO TPD, B.TPDB_ST_CODIGO TPDB, SUBSTR(B.CBA_ST_HISTORICO,1,120) HIST, SUBSTR(B.CBA_ST_DOCUMENTO,1,60) DOC, B.CBA_ST_NOMEARQUIVO ARQ, B.BAN_IN_NUMERO BCO
        FROM MEGA.FIN_CONCILIACAO B
       WHERE B.AGN_IN_CODIGO = ${num(agn)} AND B.AGN_TAU_ST_CODIGO = 'N' AND NVL(B.CBA_CH_STATUS,'N') <> 'S' AND B.CON_IN_SEQUENCIAL IS NULL
         AND B.CBA_DT_DATA BETWEEN ${dt(ini)} AND ${dt(fim)} AND NVL(B.CBA_RE_VALOR,0) > 0
         AND NOT EXISTS (SELECT 1 FROM MEGA.CCS_TB_GFIN_BXC_IGNORA I WHERE I.CBA_IN_SEQUENCIA = B.CBA_IN_SEQUENCIA)
         ${filtro.nat ? `AND B.CBA_CH_NATUREZA = '${filtro.nat}'` : ''} ${filtro.tpd ? `AND B.TPD_ST_CODIGO = '${ascii(filtro.tpd, 10)}'` : ''}
       ORDER BY B.CBA_DT_DATA, B.CBA_IN_SEQUENCIA
    ) WHERE ROWNUM <= 3000`);
  return rows.map(r => ({ cba: num(r.CBA), org: num(r.ORG), fil: r.FIL ? num(r.FIL) : null, data: r.DT, nat: r.NAT, vl: r2(r.VL), tpd: r.TPD || '', tpdb: r.TPDB || '',
    hist: (r.HIST || '').trim(), doc: (r.DOC || '').trim(), arquivo: r.ARQ || '', banco: r.BCO ? num(r.BCO) : null }));
}

// [26/10/2026] contraparte do lancamento da conta (cliente/fornecedor do titulo baixado ou conta destino da transferencia), via
// FIN_REFERENCIAFIN: baixa = ORI, titulo = REF (705/706/adiantamentos); transferencia = MOV (self). Doc: Conciliacao_Bancaria_Contraparte_FIN_REFERENCIAFIN.md
const subCp = papel => `(SELECT MAX(SUBSTR(AG.AGN_ST_NOME,1,60) || ' ' || SUBSTR(NVL(AG.AGN_ST_FANTASIA,''),1,40)) KEEP (DENSE_RANK FIRST ORDER BY T.MOV_IN_NUMLANCTO)
     FROM MEGA.FIN_REFERENCIAFIN R, MEGA.FIN_MOVIMENTO T, MEGA.GLO_AGENTES AG
    WHERE R.${papel}ORG_TAB_IN_CODIGO = M.ORG_TAB_IN_CODIGO AND R.${papel}ORG_PAD_IN_CODIGO = M.ORG_PAD_IN_CODIGO AND R.${papel}ORG_IN_CODIGO = M.ORG_IN_CODIGO
      AND R.${papel}ORG_TAU_ST_CODIGO = M.ORG_TAU_ST_CODIGO AND R.${papel}MOV_TAB_IN_CODIGO = M.MOV_TAB_IN_CODIGO AND R.${papel}MOV_SEQ_IN_CODIGO = M.MOV_SEQ_IN_CODIGO
      AND R.${papel}MOV_IN_NUMLANCTO = M.MOV_IN_NUMLANCTO
      AND T.ORG_TAB_IN_CODIGO = R.REF_ORG_TAB_IN_CODIGO AND T.ORG_PAD_IN_CODIGO = R.REF_ORG_PAD_IN_CODIGO AND T.ORG_IN_CODIGO = R.REF_ORG_IN_CODIGO
      AND T.ORG_TAU_ST_CODIGO = R.REF_ORG_TAU_ST_CODIGO AND T.MOV_TAB_IN_CODIGO = R.REF_MOV_TAB_IN_CODIGO AND T.MOV_SEQ_IN_CODIGO = R.REF_MOV_SEQ_IN_CODIGO
      AND T.MOV_IN_NUMLANCTO = R.REF_MOV_IN_NUMLANCTO AND T.AGN_IN_CODIGO <> M.AGN_IN_CODIGO
      AND AG.AGN_TAB_IN_CODIGO = T.AGN_TAB_IN_CODIGO AND AG.AGN_PAD_IN_CODIGO = T.AGN_PAD_IN_CODIGO AND AG.AGN_IN_CODIGO = T.AGN_IN_CODIGO)`;

export async function movsPendentes(agn, ini, fim) {
  const rows = await megaQuery(`
    SELECT M.ORG_IN_CODIGO ORG, M.MOV_SEQ_IN_CODIGO SEQ, M.MOV_IN_NUMLANCTO LANC, TO_CHAR(M.MOV_DT_DATADOCTO,'YYYY-MM-DD') DT, M.MOV_CH_NATUREZA NAT, M.MOV_RE_VALOR VL,
           M.TPD_ST_CODIGO TPD, M.MOV_ST_DOCUMENTO DOC, SUBSTR(NVL(M.MOV_ST_COMPLHIST,''),1,100) HIST, M.ACAO_IN_CODIGO ACAO,
           COALESCE(${subCp('ORI_')}, ${subCp('')}) CP
      FROM MEGA.FIN_MOVIMENTO M
     WHERE M.AGN_IN_CODIGO = ${num(agn)} AND M.AGN_TAU_ST_CODIGO = 'N' AND M.MOV_TAB_IN_CODIGO = 352 AND NVL(M.MOV_CH_CONCILIADO,'N') = 'N' AND M.CON_IN_SEQUENCIAL IS NULL
       AND NVL(M.MOV_CH_SITUACAO,'A') <> 'C' AND NVL(M.MOV_BO_PREVISAO,'N') = 'N' AND M.MOV_DT_DATADOCTO BETWEEN ${dt(ini)} AND ${dt(fim)}`);
  return rows.map(r => ({ org: num(r.ORG), seq: num(r.SEQ), lancto: num(r.LANC), data: r.DT, nat: r.NAT, vl: r2(r.VL), tpd: r.TPD || '', doc: r.DOC || '', hist: r.HIST || '', acao: num(r.ACAO),
    contraparte: (r.CP || '').trim(), usado: false }));
}

// [26/10/2026] NIVEIS DE CORRESPONDENCIA banco x lancamento ja existente no Mega (Gestor_Financeiro_Conciliacao_Bancaria_Importacao.md §2.2).
// Pares de tipo MEDIDOS nas conciliacoes 1x1 reais de 180 dias (tipo do banco -> tipos do Mega que o financeiro casou).
const TPD_COMPAT = {
  D: { AVDEB: ['PGTOM', 'TRANSFD', 'DINCP'], PGTO: ['PGTOM', 'TRANSFD'], TARBANC: ['PGTOM'], IR: ['PGTOM'], IOF: ['PGTOM'], DOCTEDP: ['PGTOM', 'DOCTEDP', 'TRANSFD'],
       TRANSFD: ['TRANSFD'], CHP: ['CHP'], PIX: ['PGTOM', 'PIX'] },
  C: { DOCTEDR: ['PIX', 'ADCLI', 'TRANSFC', 'DEPR', 'DEBITO'], PIX: ['PIX', 'ADCLI', 'DEPR'], AVCRED: ['DEPR', 'ADCLI', 'TRANSFC', 'CARDEB', 'PIX', 'COB', 'DINCR', 'AVCRED'],
       COB: ['COB'], TRANSFC: ['TRANSFC'], REND2: ['REND2'], DEPR: ['DEPR', 'ADCLI'], CHRD: ['CHRD'] },
};
export const tpdCompativel = (natBanco, tpdBanco, tpdMega) => (TPD_COMPAT[natBanco]?.[tpdBanco] || []).includes(tpdMega);
const docIgual = (a, b) => { const x = String(a || '').replace(/\D/g, '').replace(/^0+/, ''), y = String(b || '').replace(/\D/g, '').replace(/^0+/, ''); return x.length >= 3 && x === y; };
// nivel 1 = mesma data + unico nos dois sentidos + tipo compativel + identidade; 2 = unico + compativel + (mesma data ou ate CB_DIAS_FORTE com identidade);
// 3 = qualquer outro par de mesmo valor dentro da janela (ambiguo, data longe ou tipo fora da matriz) -> o usuario escolhe
export function nivelDoPar(l, m, unico, diasForte) {
  const d = Math.abs(dias(m.data, l.data));
  const compat = tpdCompativel(l.nat, l.tpd, m.tpd);
  const ident = nomeConfere(l.hist, m.contraparte) || docIgual(l.doc, m.doc);
  if (unico && compat && d === 0 && ident) return { nivel: 1, ident, compat, d };
  if (unico && compat && (d === 0 || (d <= diasForte && ident))) return { nivel: 2, ident, compat, d };
  return { nivel: 3, ident, compat, d };
}

async function deparas() {
  const rows = await megaQuery(`SELECT DEP_IN_CODIGO ID, BAN_IN_NUMERO BCO, CTA_AGN_IN_CODIGO CTA, TPD_ST_CODIGO TPD, DEP_ST_HIST_LIKE HL, DEP_CH_NATUREZA NAT, ACAO_IN_CODIGO ACAO, AGN_IN_CODIGO AGN,
      TPD_FIN_ST_CODIGO TPDF, CLA_IDE_ST_CODIGO CIDE, CLA_IN_REDUZIDO CLA, CCF_IDE_ST_CODIGO KIDE, CCF_IN_REDUZIDO CCF, PRO_IDE_ST_CODIGO PIDE, PRO_IN_REDUZIDO PRO, DEP_ST_HISTORICO HIST,
      DEP_CH_AUTO AUTO, DEP_RE_TETO TETO, DEP_CH_ATIVO ATIVO, TO_CHAR(DEP_DT_ALTERACAO,'YYYY-MM-DD HH24:MI') EM, DEP_ST_USU USU,
      (SELECT SUBSTR(MAX(A.AGN_ST_NOME),1,50) FROM MEGA.GLO_AGENTES A WHERE A.AGN_TAB_IN_CODIGO = 53 AND A.AGN_IN_CODIGO = D.AGN_IN_CODIGO) AGN_NOME
    FROM MEGA.CCS_TB_GFIN_BXC_DEPARA D ORDER BY D.DEP_CH_ATIVO DESC, D.TPD_ST_CODIGO, D.DEP_IN_CODIGO`);
  return rows.map(r => ({ id: num(r.ID), banco: num(r.BCO) || null, conta: num(r.CTA) || null, tpd: r.TPD, hist_like: r.HL || '', natureza: r.NAT, acao: num(r.ACAO), agn_id: num(r.AGN) || null, agn_nome: r.AGN_NOME || '',
    tpd_fin: r.TPDF || '', cla_ide: r.CIDE || '1', classe: r.CLA ? num(r.CLA) : null, ccf_ide: r.KIDE || '1', ccusto: r.CCF ? num(r.CCF) : null, pro_ide: r.PIDE || '9', projeto: r.PRO ? num(r.PRO) : null,
    historico: r.HIST || '', auto: r.AUTO === 'S', teto: num(r.TETO) || null, ativo: r.ATIVO === 'S', alterado_em: r.EM || '', alterado_por: r.USU || '',
    // apelidos usados pela tela de configuracao e pelo cartao do item
    agente: num(r.AGN) || null, classe_ide: r.CIDE || '1', ccusto_ide: r.KIDE || '1', descricao: r.HIST || `${r.TPD} ${r.NAT === 'D' ? 'saida' : 'entrada'} (acao ${r.ACAO})` }));
}

async function titulosCandidatos(tipo, orgs, ini, fim, P, forma) {
  if (!orgs.length) return [];
  const vencIni = addDias(ini, -P.titAntes), vencFim = addDias(fim, P.titDepois);
  const sql = tipo === 'P' ? `
    SELECT P.ORG_IN_CODIGO ORG, P.MOV_SEQ_IN_CODIGO SEQ, P.MOV_IN_NUMLANCTO LANC, P.AGN_IN_CODIGO AGN, SUBSTR(A.AGN_ST_NOME,1,60) NOME, SUBSTR(NVL(A.AGN_ST_FANTASIA,''),1,60) FANT,
           P.MOV_ST_DOCUMENTO DOC, P.MOV_ST_PARCELA PARC, P.TPD_ST_CODIGO TPD, P.FIL_IN_CODIGO FIL, TO_CHAR(NVL(P.MOV_DT_PRORROGADO,P.MOV_DT_VENCTO),'YYYY-MM-DD') VENC,
           P.SALDO_EM_ABERTO SALDO, P.MOV_RE_VALOR VALOR, NVL(C.CPA_RE_PERCJUROSEFET,0) PJUR, NVL(C.CPA_RE_PERCMULTAEFET,0) PMUL, NVL(C.CPA_RE_PERCDESCEFET,0) PDESC,
           TO_CHAR(C.CPA_DT_DTBASEDESC,'YYYY-MM-DD') DTDESC, NVL(C.CPA_RE_VRDESCCONDEFET,0) VDESC, C.CPA_IN_AP AP, '' NOSSONUM, '' FORMA
      FROM MEGA.FIN_VW_CONTASPAGAR P, MEGA.FIN_CONTASPAGAR C, MEGA.GLO_AGENTES A
     WHERE P.ORG_IN_CODIGO IN (${orgs.join(',')}) AND NVL(P.MOV_CH_SITUACAO,'A') <> 'C' AND P.TPD_ST_CODIGO <> 'PREVPDC' AND NVL(P.MOV_BO_PREVISAO,'N') = 'N'
       AND P.SALDO_EM_ABERTO > 0 AND NVL(P.MOV_BO_APROVADOADM,'N') = 'S' AND NVL(P.MOV_ST_HBKSTATUS,'NO') = 'NO'
       AND NVL(P.MOV_DT_PRORROGADO,P.MOV_DT_VENCTO) BETWEEN ${dt(vencIni)} AND ${dt(vencFim)}
       AND C.ORG_IN_CODIGO = P.ORG_IN_CODIGO AND C.MOV_TAB_IN_CODIGO = P.MOV_TAB_IN_CODIGO AND C.MOV_SEQ_IN_CODIGO = P.MOV_SEQ_IN_CODIGO AND C.MOV_IN_NUMLANCTO = P.MOV_IN_NUMLANCTO
       AND A.AGN_TAB_IN_CODIGO = P.AGN_TAB_IN_CODIGO AND A.AGN_PAD_IN_CODIGO = P.AGN_PAD_IN_CODIGO AND A.AGN_IN_CODIGO = P.AGN_IN_CODIGO` : `
    SELECT P.ORG_IN_CODIGO ORG, P.MOV_SEQ_IN_CODIGO SEQ, P.MOV_IN_NUMLANCTO LANC, P.AGN_IN_CODIGO AGN, SUBSTR(A.AGN_ST_NOME,1,60) NOME, SUBSTR(NVL(A.AGN_ST_FANTASIA,''),1,60) FANT,
           P.MOV_ST_DOCUMENTO DOC, P.MOV_ST_PARCELA PARC, P.TPD_ST_CODIGO TPD, P.FIL_IN_CODIGO FIL, TO_CHAR(NVL(P.MOV_DT_PRORROGADO,P.MOV_DT_VENCTO),'YYYY-MM-DD') VENC,
           P.SALDO_EM_ABERTO SALDO, P.MOV_RE_VALOR VALOR, NVL(P.CRE_RE_PERCJUROSEFET,0) PJUR, NVL(P.CRE_RE_PERCMULTAEFET,0) PMUL, NVL(P.CRE_RE_PERCDESCEFET,0) PDESC,
           TO_CHAR(P.CRE_DT_DTBASEDESC,'YYYY-MM-DD') DTDESC, NVL(P.CRE_RE_VRDESCCONDEFET,0) VDESC, NULL AP, NVL(P.CRE_ST_NOSSONUMBANC,'') NOSSONUM, SUBSTR(NVL(P.HCOB_ST_DESCRICAO,''),1,40) FORMA
      FROM MEGA.FIN_VW_CONTASRECEBER P, MEGA.GLO_AGENTES A
     WHERE P.ORG_IN_CODIGO IN (${orgs.join(',')}) AND NVL(P.MOV_CH_SITUACAO,'A') <> 'C' AND P.TPD_ST_CODIGO <> 'PDV' AND NVL(P.MOV_BO_PREVISAO,'N') = 'N' AND P.SALDO_EM_ABERTO > 0
       AND NVL(P.MOV_DT_PRORROGADO,P.MOV_DT_VENCTO) BETWEEN ${dt(vencIni)} AND ${dt(vencFim)}
       ${forma ? `AND UPPER(NVL(P.HCOB_ST_DESCRICAO,'(SEM FORMA)')) LIKE '%${ascii(forma, 40).toUpperCase()}%'` : ''}
       AND A.AGN_TAB_IN_CODIGO = P.AGN_TAB_IN_CODIGO AND A.AGN_PAD_IN_CODIGO = P.AGN_PAD_IN_CODIGO AND A.AGN_IN_CODIGO = P.AGN_IN_CODIGO`;
  const rows = await megaQuery(sql);
  return rows.map(r => ({ id: `${r.ORG}.${r.SEQ}.${r.LANC}`, org: num(r.ORG), seq: num(r.SEQ), lancto: num(r.LANC), agn_id: num(r.AGN), agn_nome: r.NOME || '', fantasia: r.FANT || '',
    doc: r.DOC || '', parcela: r.PARC || '', tpd: r.TPD || '', forma: r.FORMA || '', fil_id: num(r.FIL), venc: r.VENC, saldo: r2(r.SALDO), valor_titulo: r2(r.VALOR),
    pjur: num(r.PJUR), pmul: num(r.PMUL), pdesc: num(r.PDESC), dtdesc: r.DTDESC || null, vdesc: num(r.VDESC), ap: r.AP ? num(r.AP) : null, nossonum: r.NOSSONUM || '', usado: false }));
}

// TPD do movimento financeiro: os que o Mega usa na baixa manual (pagar: PGTOM/PIX/DOCTEDP/CHP; receber: DEPR/PIX/DOCTEDR/COB/CHP);
// o resto do extrato (AVDEB "lancamento avisado", PGTO, DEPP...) vira PGTOM ou DEPR.
const TPD_FIN_OK = { D: new Set(['PGTOM', 'PIX', 'DOCTEDP', 'CHP']), C: new Set(['DEPR', 'PIX', 'DOCTEDR', 'COB', 'CHP']) };
const tpdFinDe = linha => { const t = TPD_FIN_MAP[linha.tpd] || linha.tpd; return TPD_FIN_OK[linha.nat]?.has(t) ? t : (linha.nat === 'D' ? 'PGTOM' : 'DEPR'); };
const docFinDe = linha => { const d = String(linha.doc || '').replace(/^0+/, '').trim(); return ascii(d && !/^0*$/.test(d) ? d : `EXT${linha.cba}`, 30); };
const tituloSaida = (t, enc, dif) => ({ id: t.id, org: t.org, seq: t.seq, lancto: t.lancto, agn_id: t.agn_id, agn_nome: t.agn_nome, fantasia: t.fantasia, doc: t.doc, parcela: t.parcela, tpd: t.tpd, forma: t.forma,
  fil_id: t.fil_id, venc: t.venc, saldo: t.saldo, valor_titulo: t.valor_titulo, ap: t.ap, pjur: t.pjur, pmul: t.pmul, pdesc: t.pdesc, dtdesc: t.dtdesc,
  valor: enc.valor, juros: enc.juros, multa: enc.multa, desconto: enc.desconto, atraso: enc.atraso ?? 0, dif_dias: dif, calc: { juros: enc.juros, multa: enc.multa, desconto: enc.desconto }, pedido: null });

// [25/10/2026] pedidos de liberacao de encargos pendentes (P) ou liberados (L) dos titulos: a tela mostra o estado e manda o ped_id
async function anexarPedidos(todosTit) {
  if (!todosTit.length) return;
  const lancs = [...new Set(todosTit.map(t => t.lancto))];
  const peds = [];
  for (let k = 0; k < lancs.length; k += 500) {
    peds.push(...await megaQuery(`SELECT PED_IN_CODIGO ID, ORG_IN_CODIGO ORG, MOV_SEQ_IN_CODIGO SEQ, MOV_IN_NUMLANCTO LANC, PED_CH_STATUS ST, PED_RE_JUROS_PED J, PED_RE_MULTA_PED M, PED_RE_DESC_PED D, PED_ST_MOTIVO MOT
      FROM MEGA.CCS_TB_GFIN_BXC_PEDIDO WHERE PED_CH_STATUS IN ('P','L') AND MOV_IN_NUMLANCTO IN (${lancs.slice(k, k + 500).join(',')}) ORDER BY PED_IN_CODIGO`));
  }
  for (const p of peds) for (const t of todosTit) {
    if (t.lancto === num(p.LANC) && t.seq === num(p.SEQ) && t.org === num(p.ORG)) t.pedido = { id: num(p.ID), status: p.ST, juros: r2(p.J), multa: r2(p.M), desconto: r2(p.D), motivo: p.MOT || '' };
  }
}

// [28/10/2026] BUSCA MANUAL no contas a pagar/receber (pedido do Alexandre: "abra uma caixa permitindo filtrar por data, nome e valor"), para
// linha que o motor nao casa (banco agrupa titulos, nome diferente). So leitura. Pagar: nao aprovado ou em remessa eletronica volta com
// `bloqueio` (a tela mostra e nao deixa marcar; a CCS_P_GFIN_BXC_X recusa do mesmo jeito). Nome sem acento: TRANSLATE com UNISTR (SOAP so ASCII).
const SEM_ACENTO = c => `TRANSLATE(UPPER(${c}), UNISTR('\\00C1\\00C0\\00C2\\00C3\\00C4\\00C9\\00C8\\00CA\\00CB\\00CD\\00CC\\00CE\\00CF\\00D3\\00D2\\00D4\\00D5\\00D6\\00DA\\00D9\\00DB\\00DC\\00C7'), 'AAAAAEEEEIIIIOOOOOUUUUC')`;
export async function buscarTitulos(f) {
  const pagar = f.tipo === 'P';
  const V = pagar ? 'MEGA.FIN_VW_CONTASPAGAR' : 'MEGA.FIN_VW_CONTASRECEBER';
  const w = [`P.ORG_IN_CODIGO = ${num(f.org)}`, `NVL(P.MOV_CH_SITUACAO,'A') <> 'C'`, `NVL(P.MOV_BO_PREVISAO,'N') = 'N'`, `P.SALDO_EM_ABERTO > 0`, `P.TPD_ST_CODIGO <> '${pagar ? 'PREVPDC' : 'PDV'}'`];
  if (f.lanctos?.length) w.push(`P.MOV_IN_NUMLANCTO IN (${f.lanctos.map(num).join(',')})`);
  else {
    w.push(`NVL(P.MOV_DT_PRORROGADO,P.MOV_DT_VENCTO) BETWEEN ${dt(f.venc_ini)} AND ${dt(f.venc_fim)}`);
    const nome = ascii(f.nome, 60).toUpperCase(), digitos = String(f.nome || '').replace(/\D/g, '');
    if (nome) w.push(`(${SEM_ACENTO('A.AGN_ST_NOME')} LIKE '%${nome}%' OR ${SEM_ACENTO('A.AGN_ST_FANTASIA')} LIKE '%${nome}%'${digitos.length >= 5 ? ` OR REGEXP_REPLACE(A.AGN_ST_CGC,'[^0-9]','') LIKE '%${digitos}%'` : ''})`);
    if (f.doc) w.push(`UPPER(P.MOV_ST_DOCUMENTO) LIKE '%${ascii(f.doc, 30).toUpperCase()}%'`);
    if (f.vmin != null) w.push(`P.SALDO_EM_ABERTO >= ${r2(f.vmin)}`);
    if (f.vmax != null) w.push(`P.SALDO_EM_ABERTO <= ${r2(f.vmax)}`);
  }
  const rows = await megaQuery(`SELECT * FROM (
    SELECT P.ORG_IN_CODIGO ORG, P.MOV_SEQ_IN_CODIGO SEQ, P.MOV_IN_NUMLANCTO LANC, P.AGN_IN_CODIGO AGN, SUBSTR(A.AGN_ST_NOME,1,60) NOME, SUBSTR(NVL(A.AGN_ST_FANTASIA,''),1,60) FANT, A.AGN_ST_CGC CGC,
           P.MOV_ST_DOCUMENTO DOC, P.MOV_ST_PARCELA PARC, P.TPD_ST_CODIGO TPD, P.FIL_IN_CODIGO FIL, TO_CHAR(NVL(P.MOV_DT_PRORROGADO,P.MOV_DT_VENCTO),'YYYY-MM-DD') VENC,
           P.SALDO_EM_ABERTO SALDO, P.MOV_RE_VALOR VALOR, ${pagar ? `NVL(P.MOV_BO_APROVADOADM,'N') APROV, NVL(P.MOV_ST_HBKSTATUS,'NO') HBK` : `'S' APROV, 'NO' HBK`}
      FROM ${V} P, MEGA.GLO_AGENTES A
     WHERE ${w.join(' AND ')}
       AND A.AGN_TAB_IN_CODIGO = P.AGN_TAB_IN_CODIGO AND A.AGN_PAD_IN_CODIGO = P.AGN_PAD_IN_CODIGO AND A.AGN_IN_CODIGO = P.AGN_IN_CODIGO
     ORDER BY NVL(P.MOV_DT_PRORROGADO,P.MOV_DT_VENCTO), A.AGN_ST_NOME, P.MOV_ST_DOCUMENTO, P.MOV_ST_PARCELA) WHERE ROWNUM <= 201`);
  const titulos = rows.slice(0, 200).map(r => ({ id: `${r.ORG}.${r.SEQ}.${r.LANC}`, org: num(r.ORG), seq: num(r.SEQ), lancto: num(r.LANC), agn_id: num(r.AGN), agn_nome: r.NOME || '', fantasia: r.FANT || '', cnpj: r.CGC || '',
    doc: r.DOC || '', parcela: r.PARC || '', tpd: r.TPD || '', fil_id: num(r.FIL), venc: r.VENC, saldo: r2(r.SALDO), valor_titulo: r2(r.VALOR), pedido: null,
    bloqueio: r.APROV !== 'S' ? 'nao aprovado para pagamento' : r.HBK !== 'NO' ? `em remessa eletronica (${r.HBK}): a baixa vem pelo retorno` : '' }));
  await anexarPedidos(titulos);
  return { titulos, mais: rows.length > 200 };
}

// ---------------------------------------------------------------------------------------------------- o motor
export async function motor(agn, filtro = {}) {
  const P = await params();
  const conta = await contaInfo(agn);
  if (!conta) { const e = new Error('Conta fora do escopo do Baixar e Conciliar'); e.statusCode = 404; throw e; }
  const fim = ehData(filtro.fim) ? filtro.fim : isoHoje();
  const ini = ehData(filtro.ini) ? filtro.ini : addDias(fim, -60);
  const nat = filtro.tipo === 'P' ? 'D' : filtro.tipo === 'R' ? 'C' : null;
  const linhas = await linhasPendentes(agn, ini, fim, { nat, tpd: filtro.tpd });
  const orgs = [...new Set(linhas.map(l => l.org).filter(Boolean))];
  const temD = linhas.some(l => l.nat === 'D'), temC = linhas.some(l => l.nat === 'C');
  const [movs, deps, candP, candR] = await Promise.all([
    movsPendentes(agn, addDias(ini, -P.janela), addDias(fim, P.janela)), deparas(),
    temD ? titulosCandidatos('P', orgs, ini, fim, P, null) : [], temC ? titulosCandidatos('R', orgs, ini, fim, P, filtro.forma) : [],
  ]);
  const depAtivos = deps.filter(d => d.ativo);
  const itens = [];
  const base = l => ({ id: `L${l.cba}`, linhas: [{ cba: l.cba, data: l.data, valor: l.vl, natureza: l.nat, historico: l.hist, documento: l.doc, tpd: l.tpd, arquivo: l.arquivo }], valor_banco: l.vl, data: l.data, org: l.org,
    tpd_fin: tpdFinDe(l), doc_fin: docFinDe(l), titulos: [], candidatos: [], movs: [], depara: null, motivo: '', selecionado: false });

  for (const l of [...linhas].sort((a, b) => b.vl - a.vl)) {
    const it = base(l);
    // 1) aplicacao automatica: so informa, salvo de-para COM "historico contem" (rendimento liquido na c/c). [28/10/2026] antes o
    //    INFORMATIVOS vinha antes do de-para e REND/IR/IOF do lote da aplicacao caiam em titulos a pagar (ICMS "fecha com encargos").
    const aplic = INFORMATIVOS.has(l.tpd) || loteAplicacao(l);
    // 2) de-para: movimento real
    const dep = depAtivos.find(d => (!aplic || d.hist_like) && d.tpd === l.tpd && d.natureza === l.nat && (!d.banco || d.banco === l.banco) && (!d.conta || d.conta === conta.agn_id) && (!d.hist_like || l.hist.toUpperCase().includes(d.hist_like.toUpperCase())));
    if (dep) {
      const ok = !!dep.classe && (dep.agn_id || conta.agn_banco);
      itens.push({ ...it, situacao: ok ? 'real' : 'decidir', tipo: 'A', confianca: ok ? 'alta' : 'baixa', depara: dep, selecionado: ok && dep.auto,
        motivo: ok ? `${dep.historico || dep.tpd}: lanca ${dep.acao === 710 ? 'saida' : 'entrada'} avulsa na classe ${dep.classe} e concilia` : 'De-para sem classe financeira ou sem agente contraparte: configure em Baixar e conciliar > Configuracao' });
      continue;
    }
    if (aplic) { itens.push({ ...it, situacao: 'informativo', tipo: 'I', confianca: 'alta', motivo: motivoAplic(l) }); continue; }
    // 3) ja existe o lancamento no Mega: so conciliar. [26/10/2026] por NIVEIS (antes: so valor + natureza +-janela, o mais proximo,
    //    marcado e no robo). Nivel 1 = alta (robo); 2 = media (marcado, confirma); 3 = baixa (o usuario escolhe entre os candidatos).
    const natMega = l.nat === 'D' ? 'C' : 'D';
    const cand = movs.filter(m => !m.usado && m.nat === natMega && Math.abs(m.vl - l.vl) < 0.005 && Math.abs(dias(m.data, l.data)) <= P.janela).sort((a, b) => Math.abs(dias(a.data, l.data)) - Math.abs(dias(b.data, l.data)));
    if (cand.length) {
      const rivais = linhas.filter(o => o.cba !== l.cba && !o.casada && o.nat === l.nat && Math.abs(o.vl - l.vl) < 0.005 && Math.abs(dias(o.data, cand[0].data)) <= P.janela).length;
      const unico = cand.length === 1 && rivais === 0;
      const av = nivelDoPar(l, cand[0], unico, P.diasForte);
      const porque = [av.d === 0 ? 'mesma data' : `${av.d} dia(s) de diferenca`, unico ? 'par unico' : `${cand.length} lancamento(s) e ${rivais + 1} linha(s) do banco com esse valor`,
        av.compat ? 'tipo compativel' : `tipo ${l.tpd} x ${cand[0].tpd} fora do padrao`, av.ident ? 'nome/documento confere' : 'sem nome no historico'].join(', ');
      if (av.nivel <= 2) {
        cand[0].usado = true; l.casada = true;
        itens.push({ ...it, situacao: 'conciliar', tipo: 'C', nivel: av.nivel, confianca: av.nivel === 1 ? 'alta' : 'media', selecionado: true, movs: [cand[0]],
          motivo: `Lancamento ${cand[0].lancto} de ${cand[0].data} ja esta no Mega (nivel ${av.nivel}: ${porque})` });
      } else {
        itens.push({ ...it, situacao: 'conciliar', tipo: 'C', nivel: 3, confianca: 'baixa', selecionado: false, movs: [], candidatos_mov: cand.slice(0, 8),
          motivo: `Possivel correspondencia, confirme o lancamento (nivel 3: ${porque})` });
      }
      continue;
    }
    // 4) lote de cobranca: soma das baixas do retorno
    if (l.tpd === 'COB' && l.nat === 'C') {
      const pool = movs.filter(m => !m.usado && m.nat === 'D' && Math.abs(dias(m.data, l.data)) <= P.janela).sort((a, b) => b.vl - a.vl);
      const mesmoDia = pool.filter(m => m.data === l.data);
      let achado = null;
      if (mesmoDia.length && Math.abs(mesmoDia.reduce((s, m) => s + m.vl, 0) - l.vl) < 0.005) achado = mesmoDia;
      else if (pool.length && pool.length <= 60) achado = subconjunto(pool, l.vl, 60);
      // [26/10/2026] lote: soma exata do mesmo dia = nivel 2 (marcado, confirma); subconjunto de dias diferentes = nivel 3 (o usuario confere)
      if (achado) { const dia = achado === mesmoDia; achado.forEach(m => (m.usado = true)); itens.push({ ...it, situacao: 'lote', tipo: 'C', nivel: dia ? 2 : 3, confianca: dia ? 'media' : 'baixa', selecionado: dia, movs: achado, motivo: `Liquidacao de cobranca = soma de ${achado.length} baixa(s) do retorno${dia ? ' do mesmo dia' : ' de dias proximos'}` }); continue; }
      itens.push({ ...it, situacao: 'decidir', tipo: 'C', confianca: 'baixa', movs: pool.slice(0, 40), motivo: pool.length ? 'Liquidacao de cobranca sem combinacao exata de baixas do retorno: confira o retorno do banco' : 'Liquidacao de cobranca sem baixas de retorno no Mega: o retorno do banco nao entrou' });
      continue;
    }
    // 5) titulos em aberto
    const tipo = l.nat === 'D' ? 'P' : 'R';
    const cands = (tipo === 'P' ? candP : candR).filter(t => !t.usado);
    const marca = t => ({ ...t, ident: identidade(l, t), nome: nomeConfere(l.hist, t.agn_nome, t.fantasia), dist: Math.abs(dias(t.venc, l.data)) });
    const ordem = (a, b) => (b.ident - a.ident) || (b.nome - a.nome) || (a.dist - b.dist);
    const exatos = cands.filter(t => Math.abs(t.saldo - l.vl) < 0.005).map(marca).sort(ordem);
    let escolha = null, conf = null, motivo = '';
    if (exatos[0]) { escolha = [{ t: exatos[0], enc: { valor: exatos[0].saldo, juros: 0, multa: 0, desconto: 0, atraso: Math.max(0, dias(l.data, exatos[0].venc)) } }]; conf = (exatos[0].ident || exatos[0].nome) ? 'alta' : 'media'; motivo = exatos[0].ident ? 'Documento do titulo identificado no historico do banco' : exatos[0].nome ? 'Valor igual ao saldo e nome do agente no historico' : 'Valor igual ao saldo de um titulo em aberto'; }
    if (!escolha) {
      const comEnc = cands.map(marca).map(t => ({ t, enc: calcEncargos(tipo, t, l.vl, l.data, P) })).filter(x => x.enc).sort((a, b) => ordem(a.t, b.t));
      const pref = comEnc.find(x => x.t.ident || x.t.nome) || (comEnc.length === 1 ? comEnc[0] : null);
      if (pref) { escolha = [pref]; conf = (pref.t.ident || pref.t.nome) ? 'alta' : 'media'; motivo = pref.enc.desconto > 0 ? `Saldo menos desconto de R$ ${f2(pref.enc.desconto)} dentro da regra do titulo` : `Saldo mais encargos pela regra do titulo (${pref.enc.atraso} dia(s) de atraso)`; }
      else if (comEnc.length > 1) { it.candidatos = comEnc.slice(0, 5).map(x => ({ ...tituloSaida(x.t, x.enc, x.t.dist), confianca: (x.t.ident || x.t.nome) ? 'alta' : 'media' })); motivo = 'Mais de um titulo fecha com encargos: escolha'; }
    }
    if (!escolha) {
      const porAgn = new Map();
      for (const t of cands.map(marca)) { if (!porAgn.has(t.agn_id)) porAgn.set(t.agn_id, []); porAgn.get(t.agn_id).push(t); }
      const grupos = [...porAgn.values()].filter(g => g.length >= 2 && g.length <= 40).sort((a, b) => (b.some(x => x.nome || x.ident) - a.some(x => x.nome || x.ident)));
      for (const g of grupos) {
        const sub = subconjunto([...g].sort((a, b) => b.saldo - a.saldo).map(t => ({ ...t, vl: t.saldo })), l.vl, P.maxTitulos, 60000);
        if (sub) { escolha = sub.map(t => ({ t, enc: { valor: t.saldo, juros: 0, multa: 0, desconto: 0, atraso: Math.max(0, dias(l.data, t.venc)) } })); conf = sub.some(t => t.nome || t.ident) ? 'alta' : 'media'; motivo = `${sub.length} titulos do mesmo agente somam o valor do banco`; break; }
      }
    }
    if (escolha) {
      escolha.forEach(x => { const orig = cands.find(t => t.id === x.t.id); if (orig) orig.usado = true; });
      itens.push({ ...it, situacao: 'pronto', tipo, confianca: conf, selecionado: conf === 'alta', titulos: escolha.map(x => tituloSaida(x.t, x.enc, x.t.dist)), motivo });
      continue;
    }
    if (!it.candidatos.length) {
      const aprox = cands.map(marca).filter(t => t.nome || t.ident || Math.abs(t.saldo - l.vl) / l.vl <= 0.05).sort((a, b) => ordem(a, b) || (Math.abs(a.saldo - l.vl) - Math.abs(b.saldo - l.vl))).slice(0, 5);
      it.candidatos = aprox.map(t => ({ ...tituloSaida(t, { valor: Math.min(t.saldo, l.vl), juros: 0, multa: 0, desconto: 0, atraso: Math.max(0, dias(l.data, t.venc)) }, t.dist), confianca: (t.ident || t.nome) ? 'media' : 'baixa' }));
      motivo = aprox.length ? 'Nenhum titulo fecha exatamente: candidatos por agente ou valor proximo' : (tipo === 'P' ? 'Pagamento sem titulo em aberto correspondente' : 'Recebimento sem titulo em aberto correspondente (adiantamento de cliente?)');
    }
    itens.push({ ...it, situacao: 'decidir', tipo, confianca: 'baixa', motivo });
  }

  // [25/10/2026] pedidos de liberacao de encargos pendentes (P) ou liberados (L) dos titulos listados: a tela mostra o estado e manda o ped_id
  // [28/10/2026] SEGUNDA PASSADA - pagamento agrupado pelo banco (SISPAG "PROG FORNECEDORES" sem nome no historico) que ficou sem candidato.
  //    O passo por agente acima so olha agentes com ate 40 titulos na janela (a TALUMI tem 100+). Aqui: so linhas 'decidir' SEM candidato
  //    (nao tira titulo de quem casou), titulos do mesmo agente que vencem ate 1 dia da data do banco, ate 3 titulos e combinacao UNICA no
  //    agente e entre agentes (varias guias pequenas da SEFAZ fecham qualquer valor por coincidencia: ai fica para a busca manual). Media, nunca robo.
  for (const it of itens.filter(i => i.situacao === 'decidir' && ['P', 'R'].includes(i.tipo) && !i.candidatos.length && !i.movs.length).sort((a, b) => b.valor_banco - a.valor_banco)) {
    const pool = (it.tipo === 'P' ? candP : candR).filter(t => !t.usado && Math.abs(dias(t.venc, it.data)) <= 1);
    const achados = [];
    for (const g of porAgente(pool)) {
      if (g.length < 2) continue;
      achados.push(...combinacoes([...g].sort((a, b) => b.saldo - a.saldo).map(t => ({ ...t, vl: t.saldo })), it.valor_banco, 3, 2 - achados.length));
      if (achados.length > 1) break;
    }
    if (achados.length !== 1 || !achados[0]) continue;
    const sub = achados[0];
    sub.forEach(x => { const o = pool.find(t => t.id === x.id); if (o) o.usado = true; });
    Object.assign(it, { situacao: 'pronto', confianca: 'media', selecionado: false, motivo: `${sub.length} titulos de ${sub[0].agn_nome} com vencimento na data do banco somam o valor (combinacao unica)`,
      titulos: sub.map(t => tituloSaida(t, { valor: t.saldo, juros: 0, multa: 0, desconto: 0, atraso: Math.max(0, dias(it.data, t.venc)) }, Math.abs(dias(t.venc, it.data)))) });
  }

  await anexarPedidos(itens.flatMap(i => [...(i.titulos || []), ...(i.candidatos || [])]));

  let lista = itens;
  if (filtro.busca) {
    const q = String(filtro.busca).toUpperCase();
    lista = itens.filter(i => JSON.stringify([i.linhas.map(x => [x.historico, x.documento]), i.titulos.map(t => [t.agn_nome, t.doc]), i.candidatos.map(t => [t.agn_nome, t.doc])]).toUpperCase().includes(q));
  }
  const soma = arr => r2(arr.reduce((s, i) => s + i.valor_banco, 0));
  const g = s => lista.filter(i => i.situacao === s);
  const resumo = { linhas: lista.length, prontos: g('pronto').length, decidir: g('decidir').length, reais: g('real').length, lotes: g('lote').length, conciliar: g('conciliar').length, informativos: g('informativo').length,
    valor_prontos: soma(g('pronto')), valor_decidir: soma(g('decidir')), valor_total: soma(lista.filter(i => i.situacao !== 'informativo')), selecionados: lista.filter(i => i.selecionado).length };
  const ordemSit = { pronto: 0, real: 1, conciliar: 2, lote: 3, decidir: 4, informativo: 5 };
  lista.sort((a, b) => (ordemSit[a.situacao] - ordemSit[b.situacao]) || (b.valor_banco - a.valor_banco));
  return { conta, periodo: { ini, fim }, params: { tolerancia: P.tolerancia, janela: P.janela, max_titulos: P.maxTitulos, teto_robo: P.tetoRobo, robo_ativo: P.roboAtivo, exige_comprov: P.exigeComprov, comprov_acima: P.comprovAcima }, resumo, itens: lista };
}

// ---------------------------------------------------------------------------------------------------- execucao (procedures)
const SQL_LOG = `
  SELECT L.LOG_IN_CODIGO, L.LOG_ST_TOKEN, L.LOG_CH_TIPO, L.LOG_CH_STATUS, L.LOG_CH_ORIGEM, L.ORG_IN_CODIGO, L.CTA_AGN_IN_CODIGO, L.FIL_IN_CODIGO, TO_CHAR(L.LOG_DT_BANCO,'YYYY-MM-DD') DT_BANCO,
         L.LOG_RE_VALOR_BANCO, L.LOG_RE_VALOR_TITULOS, L.LOG_RE_JUROS, L.LOG_RE_MULTA, L.LOG_RE_DESCONTO, L.LOG_IN_QT_TITULOS, L.LOG_ST_CBAS, L.LOG_ST_MOVS, L.TPD_FIN_ST_CODIGO, L.LOG_ST_DOC_FIN,
         L.ACAO_IN_CODIGO, L.ACAOM_IN_SEQUENCIA, L.MOV_SEQ_IN_CODIGO, L.LANCTO_FIN, L.LANCTO_CONTRA, L.CON_IN_SEQUENCIAL, L.DEP_IN_CODIGO, L.COMP_IN_CODIGO, L.USU_IN_CODIGO, L.USU_ST_LOGIN,
         TO_CHAR(L.LOG_DT_INCLUSAO,'YYYY-MM-DD HH24:MI') EM, L.EXT_ST_HISTORICO, L.EXT_ST_ARQUIVO, L.LOG_ST_MENSAGEM, L.EST_USU_ST_LOGIN, TO_CHAR(L.EST_DT,'YYYY-MM-DD HH24:MI') EST_EM,
         (SELECT SUBSTR(MAX(A.AGN_ST_NOME),1,50) FROM MEGA.GLO_AGENTES A WHERE A.AGN_TAB_IN_CODIGO = 53 AND A.AGN_IN_CODIGO = L.CTA_AGN_IN_CODIGO) CONTA_NOME
    FROM MEGA.CCS_TB_GFIN_BXC_LOG L`;
const linhaLog = r => ({ log_id: num(r.LOG_IN_CODIGO), token: r.LOG_ST_TOKEN, tipo: r.LOG_CH_TIPO, status: r.LOG_CH_STATUS, origem: r.LOG_CH_ORIGEM, org: num(r.ORG_IN_CODIGO), conta_id: r.CTA_AGN_IN_CODIGO ? num(r.CTA_AGN_IN_CODIGO) : null, conta_nome: r.CONTA_NOME || '',
  fil_id: r.FIL_IN_CODIGO ? num(r.FIL_IN_CODIGO) : null, data_banco: r.DT_BANCO || '', valor_banco: num(r.LOG_RE_VALOR_BANCO), valor_titulos: num(r.LOG_RE_VALOR_TITULOS), juros: num(r.LOG_RE_JUROS), multa: num(r.LOG_RE_MULTA), desconto: num(r.LOG_RE_DESCONTO),
  qt_titulos: num(r.LOG_IN_QT_TITULOS), cbas: String(r.LOG_ST_CBAS || '').split(',').filter(Boolean).map(Number), movs: String(r.LOG_ST_MOVS || '').split(',').filter(Boolean), tpd_fin: r.TPD_FIN_ST_CODIGO || '', doc_fin: r.LOG_ST_DOC_FIN || '',
  acao: r.ACAO_IN_CODIGO ? num(r.ACAO_IN_CODIGO) : null, acaom: r.ACAOM_IN_SEQUENCIA ? num(r.ACAOM_IN_SEQUENCIA) : null, seq: r.MOV_SEQ_IN_CODIGO ? num(r.MOV_SEQ_IN_CODIGO) : null, lancto_fin: r.LANCTO_FIN ? num(r.LANCTO_FIN) : null,
  lancto_contra: r.LANCTO_CONTRA ? num(r.LANCTO_CONTRA) : null, con_id: r.CON_IN_SEQUENCIAL ? num(r.CON_IN_SEQUENCIAL) : null, dep_id: r.DEP_IN_CODIGO ? num(r.DEP_IN_CODIGO) : null, comp_id: r.COMP_IN_CODIGO ? num(r.COMP_IN_CODIGO) : null,
  usuario: r.USU_ST_LOGIN || '', usuario_id: r.USU_IN_CODIGO ? num(r.USU_IN_CODIGO) : null, em: r.EM || '', historico: r.EXT_ST_HISTORICO || '', arquivo: r.EXT_ST_ARQUIVO || '', mensagem: r.LOG_ST_MENSAGEM || '', estornado_por: r.EST_USU_ST_LOGIN || '', estornado_em: r.EST_EM || '' });

export async function lerLogPorToken(token) {
  const r = await megaQuery(`${SQL_LOG} WHERE L.LOG_ST_TOKEN = '${token}'`);
  return r[0] ? linhaLog(r[0]) : null;
}
const falhaComunicacao = (e, oque) => ({ status: 'X', mensagem: `Falha de comunicacao com o Mega (${String(e.message || e).slice(0, 160)}). Confira ${oque} no Mega antes de tentar de novo.` });

// executa UMA baixa (tipo P/R) - usado pela tela e pelo robo
async function executarBaixa(item, ctx) {
  const token = crypto.randomUUID();
  const tits = item.titulos.map(t => `${num(t.seq)}:${num(t.lancto)}:${f2(t.valor)}:${f2(t.juros)}:${f2(t.multa)}:${f2(t.desconto)}`).join(';');
  const cbas = item.cbas.map(Number).join(',');
  const plsql = `BEGIN MEGA.CCS_P_GFIN_BXC('${token}', '${item.tipo}', ${num(item.org)}, ${num(item.conta)}, ${dt(item.data)}, '${ascii(item.tpd_fin, 10)}', '${ascii(item.doc_fin, 30)}', '${ascii(item.hist, 400)}', ${ctx.usu}, '${ascii(ctx.login, 60)}', '${tits}', '${cbas}', '${ctx.origem}', '${ascii(item.arquivo, 120)}', ${item.comp_id ? num(item.comp_id) : 'NULL'}, '${ctx.simular ? 'S' : 'N'}'); END;`;
  try {
    await megaExec(plsql);
    return (await lerLogPorToken(token)) || { status: 'X', mensagem: 'O Mega nao devolveu o resultado desta baixa. Confira os titulos antes de tentar de novo.' };
  } catch (e) {
    return (await lerLogPorToken(token).catch(() => null)) || falhaComunicacao(e, 'os titulos');
  }
}
export async function executarConc(item, ctx) {
  const token = crypto.randomUUID();
  const movs = item.movs.map(m => `${num(m.seq)}:${num(m.lancto)}`).join(';'), cbas = item.cbas.map(Number).join(',');
  try {
    await megaExec(`BEGIN MEGA.CCS_P_GFIN_BXC_CONC('${token}', ${num(item.org)}, ${num(item.conta)}, ${ctx.usu}, '${ascii(ctx.login, 60)}', '${movs}', '${cbas}', '${ctx.origem}', '${ctx.simular ? 'S' : 'N'}', '${item.tipo_conc === 'M' ? 'M' : 'A'}'); END;`);
    return (await lerLogPorToken(token)) || { status: 'X', mensagem: 'O Mega nao devolveu o resultado desta conciliacao.' };
  } catch (e) { return (await lerLogPorToken(token).catch(() => null)) || falhaComunicacao(e, 'a conciliacao'); }
}
async function executarReal(item, ctx) {
  const token = crypto.randomUUID();
  try {
    await megaExec(`BEGIN MEGA.CCS_P_GFIN_BXC_REAL('${token}', ${num(item.org)}, ${num(item.cba)}, ${num(item.dep_id)}, ${ctx.usu}, '${ascii(ctx.login, 60)}', ${item.hist ? `'${ascii(item.hist, 400)}'` : 'NULL'}, '${ctx.origem}', '${ctx.simular ? 'S' : 'N'}'); END;`);
    return (await lerLogPorToken(token)) || { status: 'X', mensagem: 'O Mega nao devolveu o resultado deste lancamento.' };
  } catch (e) { return (await lerLogPorToken(token).catch(() => null)) || falhaComunicacao(e, 'o lancamento'); }
}

// organizacao e conta das linhas informadas (nunca confiar so no corpo)
export async function orgDasLinhas(cbas) {
  const r = await megaQuery(`SELECT MIN(ORG_IN_CODIGO) ORG, MIN(AGN_IN_CODIGO) CTA, MAX(AGN_IN_CODIGO) CTA2, COUNT(*) N, SUM(CBA_RE_VALOR) VL FROM MEGA.FIN_CONCILIACAO WHERE CBA_IN_SEQUENCIA IN (${cbas.map(Number).join(',')})`);
  const x = r[0] || {};
  if (num(x.N) !== cbas.length) throw Object.assign(new Error('Linha do extrato nao encontrada no Mega'), { statusCode: 400 });
  if (num(x.CTA) !== num(x.CTA2)) throw Object.assign(new Error('Linhas do extrato de contas diferentes'), { statusCode: 400 });
  return { org: num(x.ORG), conta: num(x.CTA), valor: r2(x.VL) };
}

// encargos esperados hoje para os titulos de um item (recalculo no servidor, mesma funcao do motor)
async function esperadoDosTitulos(tipo, titulos, valorBanco, data, P) {
  if (!titulos.length) return [];
  const chaves = titulos.map(t => `(M.MOV_SEQ_IN_CODIGO = ${num(t.seq)} AND M.MOV_IN_NUMLANCTO = ${num(t.lancto)})`).join(' OR ');
  const C = tipo === 'P' ? { tab: 'MEGA.FIN_CONTASPAGAR', pre: 'CPA' } : { tab: 'MEGA.FIN_CONTASRECEBER', pre: 'CRE' };
  const rows = await megaQuery(`
    SELECT M.MOV_SEQ_IN_CODIGO SEQ, M.MOV_IN_NUMLANCTO LANC, NVL(M.MOV_RE_SALDOCPACRE,0) SALDO, TO_CHAR(NVL(M.MOV_DT_PRORROGADO,M.MOV_DT_VENCTO),'YYYY-MM-DD') VENC,
           NVL(C.${C.pre}_RE_PERCJUROSEFET,0) PJUR, NVL(C.${C.pre}_RE_PERCMULTAEFET,0) PMUL, NVL(C.${C.pre}_RE_PERCDESCEFET,0) PDESC, TO_CHAR(C.${C.pre}_DT_DTBASEDESC,'YYYY-MM-DD') DTDESC, NVL(C.${C.pre}_RE_VRDESCCONDEFET,0) VDESC
      FROM MEGA.FIN_MOVIMENTO M, ${C.tab} C
     WHERE M.MOV_TAB_IN_CODIGO = 352 AND (${chaves})
       AND C.ORG_IN_CODIGO = M.ORG_IN_CODIGO AND C.MOV_TAB_IN_CODIGO = M.MOV_TAB_IN_CODIGO AND C.MOV_SEQ_IN_CODIGO = M.MOV_SEQ_IN_CODIGO AND C.MOV_IN_NUMLANCTO = M.MOV_IN_NUMLANCTO`);
  return titulos.map(t => {
    const r = rows.find(x => num(x.SEQ) === num(t.seq) && num(x.LANC) === num(t.lancto));
    if (!r) return { ...t, esperado: null };
    const base = { saldo: r2(r.SALDO), venc: r.VENC, pjur: num(r.PJUR), pmul: num(r.PMUL), pdesc: num(r.PDESC), dtdesc: r.DTDESC || null, vdesc: num(r.VDESC) };
    // 1 titulo: o valor do banco inteiro fecha com ele; varios: cada um pelo saldo (sem encargos)
    const esperado = titulos.length === 1 ? calcEncargos(tipo, base, valorBanco, data, P) : { valor: base.saldo, juros: 0, multa: 0, desconto: 0 };
    return { ...t, saldo: base.saldo, esperado };
  });
}
const difere = (a, b) => Math.abs(num(a) - num(b)) > 0.01;

// ---------------------------------------------------------------------------------------------------- robo
export async function rodarRobo(app, disparo = 'agendado') {
  const P = await params();
  const resumo = { disparo, contas: 0, executados: 0, recusados: 0, pulados: 0, detalhes: [] };
  if (!P.roboAtivo || P.usuRobo <= 0) { resumo.motivo = !P.roboAtivo ? 'Robo desligado (BXC_ROBO_ATIVO = 0)' : 'Usuario do robo nao definido (BXC_USU_ROBO)'; return resumo; }
  const contas = await megaQuery(`SELECT AGN_IN_CODIGO AGN, CTA_RE_TETO_ROBO TETO FROM MEGA.CCS_TB_GFIN_BXC_CONTA WHERE CTA_CH_ATIVA = 'S' AND CTA_CH_ROBO = 'S'`);
  const ctx = { usu: P.usuRobo, login: 'ROBO BXC', origem: 'R', simular: false };
  for (const c of contas) {
    resumo.contas++;
    const teto = Math.min(P.tetoRobo, c.TETO ? num(c.TETO) : Infinity);
    let m;
    try { m = await motor(num(c.AGN), { ini: addDias(isoHoje(), -30) }); } catch (e) { resumo.detalhes.push({ conta: num(c.AGN), erro: String(e.message || e).slice(0, 200) }); continue; }
    for (const it of m.itens) {
      let r = null;
      if (it.situacao === 'pronto' && it.confianca === 'alta' && it.valor_banco <= teto && it.titulos.length) {
        if (P.exigeComprov && it.valor_banco >= P.comprovAcima && ['PIX', 'DOCTEDP', 'DOCTEDR'].includes(it.tpd_fin)) { resumo.pulados++; continue; }   // exige comprovante: fica para a tela
        r = await executarBaixa({ tipo: it.tipo, org: it.org, conta: m.conta.agn_id, data: it.data, tpd_fin: it.tpd_fin, doc_fin: it.doc_fin, hist: `ROBO: ${it.motivo}`, cbas: it.linhas.map(l => l.cba), titulos: it.titulos, arquivo: it.linhas[0]?.arquivo }, ctx);
      } else if (it.situacao === 'real' && it.depara?.auto && it.depara.classe && (!it.depara.teto || it.valor_banco <= it.depara.teto)) {
        r = await executarReal({ org: it.org, cba: it.linhas[0].cba, dep_id: it.depara.id }, ctx);
      } else if (it.situacao === 'conciliar' && it.confianca === 'alta') {
        r = await executarConc({ org: it.org, conta: m.conta.agn_id, movs: it.movs, cbas: it.linhas.map(l => l.cba) }, ctx);
      } else { resumo.pulados++; continue; }
      if (r.status === 'B') resumo.executados++; else resumo.recusados++;
      resumo.detalhes.push({ conta: m.conta.agn_id, item: it.id, situacao: it.situacao, valor: it.valor_banco, status: r.status, log_id: r.log_id || null, mensagem: r.mensagem || '' });
    }
  }
  app.log.info({ bxc: 'robo', ...resumo, detalhes: undefined }, 'robo do Baixar e conciliar');
  return resumo;
}

// ---------------------------------------------------------------------------------------------------- rotas
export default async function baixarConciliarRoutes(app) {
  await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 10 } });
  const podeOperar = async (req, reply) => {
    if (!temModulo(req.user, MOD_OPERA)) return reply.code(403).send({ error: 'sem_modulo', message: 'Seu usuario nao tem o modulo Baixas/Conciliacao.' });
    if (!Number.isInteger(Number(req.user?.sub)) || Number(req.user.sub) <= 0) return reply.code(403).send({ error: 'sem_usuario_mega', message: 'Sessao sem usuario do Mega. Entre de novo.' });
  };
  const podeLiberar = async (req, reply) => { if (!temModulo(req.user, MOD_ENCARGOS)) return reply.code(403).send({ error: 'sem_modulo', message: 'Liberar encargos exige o modulo Liberacao de Encargos.' }); };
  const soAdmin = async (req, reply) => { if (!isAdmin(req.user)) return reply.code(403).send({ error: 'so_admin', message: 'Somente administrador.' }); };
  const ctxDe = (req, simular) => ({ usu: Number(req.user.sub), login: req.user.login || req.user.nome || '', origem: 'T', simular: !!simular });
  const auth = { preHandler: [app.authenticate] };
  const opera = { preHandler: [app.authenticate, podeOperar] };
  const libera = { preHandler: [app.authenticate, podeLiberar] };
  const admin = { preHandler: [app.authenticate, soAdmin] };

  // -------- contas no escopo
  app.get('/bxc/contas', auth, async () => {
    const rows = await megaQuery(`
      SELECT K.AGN_IN_CODIGO AGN, K.FIL_IN_CODIGO FIL, K.CTA_CH_ATIVA ATIVA, K.CTA_CH_ROBO ROBO, K.CTA_RE_TETO_ROBO TETO, K.CTA_IN_AGN_BANCO AGN_BANCO,
             (SELECT SUBSTR(MAX(A.AGN_ST_NOME),1,60) FROM MEGA.GLO_AGENTES A WHERE A.AGN_TAB_IN_CODIGO = 53 AND A.AGN_IN_CODIGO = K.AGN_IN_CODIGO) NOME,
             (SELECT MAX(C.BAN_IN_NUMERO) FROM MEGA.GLO_CONTASFIN C WHERE C.AGN_TAB_IN_CODIGO = 53 AND C.AGN_IN_CODIGO = K.AGN_IN_CODIGO AND C.AGN_TAU_ST_CODIGO = 'N') BANCO,
             (SELECT COUNT(*) FROM MEGA.FIN_CONCILIACAO B WHERE B.AGN_IN_CODIGO = K.AGN_IN_CODIGO AND NVL(B.CBA_CH_STATUS,'N') <> 'S' AND B.CON_IN_SEQUENCIAL IS NULL AND B.CBA_DT_DATA >= TRUNC(SYSDATE) - 90
                 AND NOT EXISTS (SELECT 1 FROM MEGA.CCS_TB_GFIN_BXC_IGNORA I WHERE I.CBA_IN_SEQUENCIA = B.CBA_IN_SEQUENCIA)) PENDENTES,
             (SELECT TO_CHAR(MAX(B.CBA_DT_DATA),'YYYY-MM-DD') FROM MEGA.FIN_CONCILIACAO B WHERE B.AGN_IN_CODIGO = K.AGN_IN_CODIGO) ULTIMA
        FROM MEGA.CCS_TB_GFIN_BXC_CONTA K ORDER BY K.CTA_CH_ATIVA DESC, K.FIL_IN_CODIGO, K.AGN_IN_CODIGO`);
    return { contas: rows.map(r => ({ agn_id: num(r.AGN), nome: r.NOME || '', banco: r.BANCO ? num(r.BANCO) : null, fil_id: num(r.FIL), ativa: r.ATIVA === 'S', robo: r.ROBO === 'S', teto_robo: r.TETO ? num(r.TETO) : null,
      agn_banco: r.AGN_BANCO ? num(r.AGN_BANCO) : null, pendentes: num(r.PENDENTES), ultima_linha: r.ULTIMA || '' })) };
  });

  // -------- o motor
  app.get('/bxc/pendentes', auth, async (req) => {
    const q = req.query || {};
    const conta = num(q.conta);
    if (!conta) { const e = new Error('conta e obrigatoria'); e.statusCode = 400; throw e; }
    return motor(conta, { tipo: ['P', 'R'].includes(q.tipo) ? q.tipo : null, forma: q.forma ? String(q.forma).slice(0, 40) : null, tpd: q.tpd ? String(q.tpd).slice(0, 10) : null, ini: q.ini, fim: q.fim, busca: q.busca ? String(q.busca).slice(0, 60) : null });
  });

  // -------- baixar e conciliar (um item por vez: cada um e uma transacao no Mega)
  // [28/10/2026] busca manual de titulos (painel "Buscar no contas a pagar/receber" do item)
  app.get('/bxc/titulos', auth, async (req, reply) => {
    const q = req.query || {}, tipo = q.tipo === 'R' ? 'R' : 'P', org = num(q.org);
    const lanctos = String(q.lanctos || '').split(',').map(num).filter(Boolean).slice(0, 60);
    if (!org) return reply.code(400).send({ error: 'org', message: 'Informe a empresa (org) da linha do extrato.' });
    if (!lanctos.length) {
      if (!ehData(q.venc_ini) || !ehData(q.venc_fim) || q.venc_fim < q.venc_ini) return reply.code(400).send({ error: 'periodo', message: 'Informe o vencimento de/ate.' });
      if (dias(q.venc_fim, q.venc_ini) > 120) return reply.code(400).send({ error: 'periodo', message: 'Periodo de vencimento de no maximo 120 dias.' });
    }
    const valor = x => (x == null || x === '' || !Number.isFinite(Number(x)) ? null : Number(x));
    return buscarTitulos({ tipo, org, lanctos, venc_ini: q.venc_ini, venc_fim: q.venc_fim, nome: q.nome, doc: q.doc, vmin: valor(q.vmin), vmax: valor(q.vmax) });
  });

  app.post('/bxc/executar', {
    ...opera, schema: { body: { type: 'object', required: ['itens'], properties: {
      simular: { type: 'boolean' }, arquivo: { type: 'string', maxLength: 200 },
      itens: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'object', required: ['tipo', 'cbas', 'titulos', 'data'], properties: {
        ref: { type: 'string', maxLength: 40 }, tipo: { type: 'string', enum: ['P', 'R'] }, conta: { type: 'integer' }, org: { type: 'integer' }, data: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        tpd_fin: { type: 'string', maxLength: 10 }, doc_fin: { type: 'string', maxLength: 30 }, hist: { type: 'string', maxLength: 400 }, comp_id: { type: 'integer' },
        cbas: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'integer', minimum: 1 } },
        titulos: { type: 'array', minItems: 1, maxItems: 30, items: { type: 'object', required: ['seq', 'lancto', 'valor'], properties: {
          seq: { type: 'integer' }, lancto: { type: 'integer' }, valor: { type: 'number' }, juros: { type: 'number' }, multa: { type: 'number' }, desconto: { type: 'number' }, ped_id: { type: 'integer' } } } } } } } } } }
  }, async (req) => {
    const simular = req.body.simular === true, P = await params(), ctx = ctxDe(req, simular), liberaDireto = temModulo(req.user, MOD_ENCARGOS);
    const resultados = [];
    for (const it of req.body.itens) {
      let r;
      try {
        const li = await orgDasLinhas(it.cbas);
        if (it.conta && num(it.conta) !== li.conta) throw Object.assign(new Error('Linhas do extrato nao sao da conta informada'), { statusCode: 400 });
        const titulos = it.titulos.map(t => ({ seq: num(t.seq), lancto: num(t.lancto), valor: r2(t.valor), juros: r2(t.juros), multa: r2(it.tipo === 'P' ? 0 : t.multa), desconto: r2(t.desconto), ped_id: t.ped_id ? num(t.ped_id) : null }));
        if (it.tipo === 'P') titulos.forEach((t, i) => { t.juros = r2(t.juros + r2(it.titulos[i].multa || 0)); });  // pagar: multa vira juros
        // encargos: o que o usuario mandou x o que a regra do titulo calcula hoje
        const conf = await esperadoDosTitulos(it.tipo, titulos, li.valor, it.data, P);
        for (const t of conf) {
          const alterou = !t.esperado || difere(t.juros, t.esperado.juros) || difere(t.multa, t.esperado.multa) || difere(t.desconto, t.esperado.desconto);
          if (!alterou || liberaDireto) continue;
          if (!t.ped_id) throw Object.assign(new Error(`Titulo ${t.lancto}: encargos diferentes da regra. Peca a liberacao de encargos antes de baixar.`), { statusCode: 409 });
          const ped = (await megaQuery(`SELECT PED_CH_STATUS ST, PED_RE_JUROS_PED J, PED_RE_MULTA_PED M, PED_RE_DESC_PED D FROM MEGA.CCS_TB_GFIN_BXC_PEDIDO WHERE PED_IN_CODIGO = ${t.ped_id} AND MOV_SEQ_IN_CODIGO = ${t.seq} AND MOV_IN_NUMLANCTO = ${t.lancto}`))[0];
          if (!ped || ped.ST !== 'L') throw Object.assign(new Error(`Titulo ${t.lancto}: pedido de liberacao ${!ped ? 'nao encontrado' : ped.ST === 'P' ? 'ainda pendente' : ped.ST === 'N' ? 'negado' : 'ja usado'}.`), { statusCode: 409 });
          if (difere(t.juros, ped.J) || difere(t.multa, ped.M) || difere(t.desconto, ped.D)) throw Object.assign(new Error(`Titulo ${t.lancto}: encargos diferentes dos liberados (juros ${f2(ped.J)}, multa ${f2(ped.M)}, desconto ${f2(ped.D)}).`), { statusCode: 409 });
        }
        if (P.exigeComprov && !simular && li.valor >= P.comprovAcima && ['PIX', 'DOCTEDP', 'DOCTEDR'].includes(it.tpd_fin) && !it.comp_id) throw Object.assign(new Error('Comprovante obrigatorio para PIX/TED deste valor.'), { statusCode: 409 });
        r = await executarBaixa({ tipo: it.tipo, org: li.org, conta: li.conta, data: it.data, tpd_fin: it.tpd_fin || (it.tipo === 'P' ? 'PGTOM' : 'DEPR'), doc_fin: it.doc_fin || `EXT${it.cbas[0]}`, hist: it.hist || '', cbas: it.cbas, titulos, arquivo: req.body.arquivo || '', comp_id: it.comp_id }, ctx);
        if (r.status === 'B') {
          for (const t of titulos.filter(x => x.ped_id)) await megaExec(`BEGIN UPDATE MEGA.CCS_TB_GFIN_BXC_PEDIDO SET PED_CH_STATUS = 'U', LOG_IN_CODIGO = ${r.log_id} WHERE PED_IN_CODIGO = ${t.ped_id} AND PED_CH_STATUS = 'L'; COMMIT; END;`).catch(() => {});
          if (it.comp_id) await megaExec(`BEGIN UPDATE MEGA.CCS_TB_GFIN_BXC_COMPROV SET LOG_IN_CODIGO = ${r.log_id} WHERE COMP_IN_CODIGO = ${num(it.comp_id)}; COMMIT; END;`).catch(() => {});
        }
      } catch (e) { r = { status: 'X', mensagem: String(e.message || e).slice(0, 300) }; }
      req.log.info({ gfin: 'bxc_executar', simular, usu: ctx.usu, ref: it.ref, status: r.status, msg: r.mensagem }, 'baixar e conciliar');
      resultados.push({ ref: it.ref || '', ...r });
    }
    return { simular, resultados };
  });

  app.post('/bxc/conciliar', {
    ...opera, schema: { body: { type: 'object', required: ['itens'], properties: { simular: { type: 'boolean' },
      itens: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'object', required: ['movs', 'cbas'], properties: { ref: { type: 'string', maxLength: 40 }, conta: { type: 'integer' },
        movs: { type: 'array', minItems: 1, maxItems: 60, items: { type: 'object', required: ['seq', 'lancto'], properties: { seq: { type: 'integer' }, lancto: { type: 'integer' } } } },
        cbas: { type: 'array', minItems: 1, maxItems: 60, items: { type: 'integer', minimum: 1 } } } } } } } }
  }, async (req) => {
    const ctx = ctxDe(req, req.body.simular === true), resultados = [];
    for (const it of req.body.itens) {
      let r;
      try { const li = await orgDasLinhas(it.cbas); r = await executarConc({ org: li.org, conta: li.conta, movs: it.movs, cbas: it.cbas }, ctx); }
      catch (e) { r = { status: 'X', mensagem: String(e.message || e).slice(0, 300) }; }
      req.log.info({ gfin: 'bxc_conciliar', usu: ctx.usu, ref: it.ref, status: r.status, msg: r.mensagem }, 'conciliar lote');
      resultados.push({ ref: it.ref || '', ...r });
    }
    return { simular: ctx.simular, resultados };
  });

  app.post('/bxc/real', {
    ...opera, schema: { body: { type: 'object', required: ['itens'], properties: { simular: { type: 'boolean' },
      itens: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object', required: ['cba', 'dep_id'], properties: { ref: { type: 'string', maxLength: 40 }, cba: { type: 'integer', minimum: 1 }, dep_id: { type: 'integer', minimum: 1 }, hist: { type: 'string', maxLength: 400 } } } } } } }
  }, async (req) => {
    const ctx = ctxDe(req, req.body.simular === true), resultados = [];
    for (const it of req.body.itens) {
      let r;
      try { const li = await orgDasLinhas([it.cba]); r = await executarReal({ org: li.org, cba: it.cba, dep_id: it.dep_id, hist: it.hist }, ctx); }
      catch (e) { r = { status: 'X', mensagem: String(e.message || e).slice(0, 300) }; }
      req.log.info({ gfin: 'bxc_real', usu: ctx.usu, ref: it.ref, status: r.status, msg: r.mensagem }, 'movimento real');
      resultados.push({ ref: it.ref || '', ...r });
    }
    return { simular: ctx.simular, resultados };
  });

  // -------- estorno e trilha
  app.post('/bxc/estornar', { ...opera, schema: { body: { type: 'object', required: ['log_id'], properties: { log_id: { type: 'integer', minimum: 1 } } } } }, async (req, reply) => {
    const id = num(req.body.log_id), ctx = ctxDe(req, false);
    await megaExec(`BEGIN MEGA.CCS_P_GFIN_BXC_ESTORNO(${id}, ${ctx.usu}, '${ascii(ctx.login, 60)}'); END;`);
    const r = await megaQuery(`${SQL_LOG} WHERE L.LOG_IN_CODIGO = ${id}`);
    if (!r[0]) return reply.code(404).send({ error: 'nao_encontrado', message: 'Operacao nao encontrada.' });
    const log = linhaLog(r[0]);
    req.log.info({ gfin: 'bxc_estorno', usu: ctx.usu, log_id: id, status: log.status, msg: log.mensagem }, 'estorno');
    return { ok: log.status === 'E', log };
  });

  app.get('/bxc/feitas', auth, async (req) => {
    const d = Math.min(Math.max(parseInt(req.query.dias, 10) || 7, 1), 180), conta = num(req.query.conta);
    const logs = (await megaQuery(`${SQL_LOG} WHERE L.LOG_CH_STATUS IN ('B','E') AND L.LOG_DT_INCLUSAO >= TRUNC(SYSDATE) - ${d} ${conta ? `AND L.CTA_AGN_IN_CODIGO = ${conta}` : ''} ORDER BY L.LOG_IN_CODIGO DESC`)).map(linhaLog);
    if (logs.length) {
      const tits = await megaQuery(`SELECT T.LOG_IN_CODIGO LOG_ID, T.MOV_SEQ_IN_CODIGO SEQ, T.MOV_IN_NUMLANCTO LANC, T.AGN_IN_CODIGO AGN, T.MOV_ST_DOCUMENTO DOC, T.MOV_ST_PARCELA PARC, T.FIL_IN_CODIGO FIL, T.LGT_RE_VALOR VAL, T.LGT_RE_JUROS JUR, T.LGT_RE_MULTA MUL, T.LGT_RE_DESCONTO DES,
          T.LGT_RE_SALDO_ANT SALDO_ANT, T.LANCTO_BX BX, (SELECT SUBSTR(MAX(A.AGN_ST_NOME),1,50) FROM MEGA.GLO_AGENTES A WHERE A.AGN_TAB_IN_CODIGO = 53 AND A.AGN_IN_CODIGO = T.AGN_IN_CODIGO) NOME
          FROM MEGA.CCS_TB_GFIN_BXC_LOG_TIT T WHERE T.LOG_IN_CODIGO IN (${logs.map(l => l.log_id).join(',')}) ORDER BY T.LGT_IN_CODIGO`);
      for (const l of logs) l.titulos = tits.filter(t => num(t.LOG_ID) === l.log_id).map(t => ({ seq: num(t.SEQ), lancto: num(t.LANC), agn_id: num(t.AGN), agn_nome: t.NOME || '', doc: t.DOC || '', parcela: t.PARC || '', fil_id: num(t.FIL), valor: num(t.VAL), juros: num(t.JUR), multa: num(t.MUL), desconto: num(t.DES), saldo_ant: num(t.SALDO_ANT), lancto_bx: t.BX ? num(t.BX) : null }));
    }
    const ok = logs.filter(l => l.status === 'B');
    return { dias: d, itens: logs, qt: ok.length, total: r2(ok.reduce((s, l) => s + l.valor_banco, 0)) };
  });

  app.post('/bxc/ignorar', { ...opera, schema: { body: { type: 'object', required: ['cba'], properties: { cba: { type: 'integer', minimum: 1 }, motivo: { type: 'string', maxLength: 200 } } } } }, async (req) => {
    const ctx = ctxDe(req);
    await megaExec(`BEGIN MERGE INTO MEGA.CCS_TB_GFIN_BXC_IGNORA I USING (SELECT ${num(req.body.cba)} C FROM DUAL) X ON (I.CBA_IN_SEQUENCIA = X.C)
      WHEN NOT MATCHED THEN INSERT (CBA_IN_SEQUENCIA, IGN_ST_MOTIVO, IGN_IN_USU, IGN_ST_USU) VALUES (X.C, '${ascii(req.body.motivo, 200)}', ${ctx.usu}, '${ascii(ctx.login, 60)}'); COMMIT; END;`);
    return { ok: true };
  });
  app.delete('/bxc/ignorar/:cba', opera, async (req) => { await megaExec(`BEGIN DELETE FROM MEGA.CCS_TB_GFIN_BXC_IGNORA WHERE CBA_IN_SEQUENCIA = ${num(req.params.cba)}; COMMIT; END;`); return { ok: true }; });
  app.get('/bxc/ignoradas', auth, async (req) => {
    const conta = num(req.query.conta);
    const rows = await megaQuery(`SELECT I.CBA_IN_SEQUENCIA CBA, I.IGN_ST_MOTIVO MOTIVO, I.IGN_ST_USU USU, TO_CHAR(I.IGN_DT,'YYYY-MM-DD HH24:MI') EM, TO_CHAR(B.CBA_DT_DATA,'YYYY-MM-DD') DT, B.CBA_RE_VALOR VL, B.CBA_CH_NATUREZA NAT, SUBSTR(B.CBA_ST_HISTORICO,1,80) HIST, B.AGN_IN_CODIGO CTA
      FROM MEGA.CCS_TB_GFIN_BXC_IGNORA I, MEGA.FIN_CONCILIACAO B WHERE B.CBA_IN_SEQUENCIA = I.CBA_IN_SEQUENCIA ${conta ? `AND B.AGN_IN_CODIGO = ${conta}` : ''} ORDER BY I.IGN_DT DESC`);
    return { itens: rows.map(r => ({ cba: num(r.CBA), motivo: r.MOTIVO || '', usuario: r.USU || '', em: r.EM || '', data: r.DT, valor: num(r.VL), natureza: r.NAT, historico: r.HIST || '', conta_id: num(r.CTA) })) };
  });

  // -------- de-para dos movimentos reais (admin)
  app.get('/bxc/depara', auth, async () => ({ itens: await deparas() }));
  app.post('/bxc/depara', { ...admin, schema: { body: { type: 'object', required: ['tpd', 'natureza', 'acao'], properties: {
    id: { type: 'integer' }, banco: { anyOf: [{ type: 'integer' }, { type: 'null' }] }, conta: { anyOf: [{ type: 'integer' }, { type: 'null' }] }, tpd: { type: 'string', maxLength: 10 }, hist_like: { type: 'string', maxLength: 60 }, natureza: { type: 'string', enum: ['D', 'C'] },
    acao: { type: 'integer', enum: [710, 711] }, agn_id: { anyOf: [{ type: 'integer' }, { type: 'null' }] }, agente: { anyOf: [{ type: 'integer' }, { type: 'string' }, { type: 'null' }] }, tpd_fin: { type: 'string', maxLength: 10 },
    cla_ide: { type: 'string', maxLength: 3 }, classe_ide: { type: 'string', maxLength: 3 }, classe: { anyOf: [{ type: 'integer' }, { type: 'string' }, { type: 'null' }] }, ccf_ide: { type: 'string', maxLength: 3 }, ccusto_ide: { type: 'string', maxLength: 3 }, ccusto: { anyOf: [{ type: 'integer' }, { type: 'string' }, { type: 'null' }] },
    pro_ide: { type: 'string', maxLength: 3 }, projeto: { anyOf: [{ type: 'integer' }, { type: 'string' }, { type: 'null' }] }, historico: { type: 'string', maxLength: 120 }, auto: { anyOf: [{ type: 'boolean' }, { type: 'string' }] }, teto: { anyOf: [{ type: 'number' }, { type: 'string' }, { type: 'null' }] }, ativo: { anyOf: [{ type: 'boolean' }, { type: 'string' }] },
    banco: { anyOf: [{ type: 'integer' }, { type: 'string' }, { type: 'null' }] }, conta: { anyOf: [{ type: 'integer' }, { type: 'string' }, { type: 'null' }] } } } } }, async (req) => {
    // [25/10/2026] aceita os apelidos da tela (agente, classe_ide, ccusto_ide) e booleanos em texto ('S'/'N')
    const b = req.body, ctx = ctxDe(req), id = b.id ? num(b.id) : null;
    const v = x => (x == null || x === '' ? 'NULL' : num(x));
    const v0 = x => (num(x) ? num(x) : 'NULL');   // [28/10/2026] banco/conta/agente/teto: 0 = vazio (todos); a procedure recusava 0
    const s = (x, n) => (x == null || x === '' ? 'NULL' : `'${ascii(x, n)}'`);
    const simNao = (x, padrao) => (x === true || x === 'S' || x === 'true' ? 'S' : x === false || x === 'N' || x === 'false' ? 'N' : padrao);
    const agn = b.agn_id ?? b.agente, cide = b.cla_ide || b.classe_ide || '1', kide = b.ccf_ide || b.ccusto_ide || '1';
    const sets = `BAN_IN_NUMERO = ${v0(b.banco)}, CTA_AGN_IN_CODIGO = ${v0(b.conta)}, TPD_ST_CODIGO = '${ascii(b.tpd, 10)}', DEP_ST_HIST_LIKE = ${s(b.hist_like, 60)}, DEP_CH_NATUREZA = '${b.natureza}', ACAO_IN_CODIGO = ${num(b.acao)}, AGN_IN_CODIGO = ${v0(agn)},
      TPD_FIN_ST_CODIGO = ${s(b.tpd_fin, 10)}, CLA_IDE_ST_CODIGO = ${s(cide, 3)}, CLA_IN_REDUZIDO = ${v(b.classe)}, CCF_IDE_ST_CODIGO = ${s(kide, 3)}, CCF_IN_REDUZIDO = ${v(b.ccusto)}, PRO_IDE_ST_CODIGO = ${s(b.pro_ide || '9', 3)}, PRO_IN_REDUZIDO = ${b.projeto == null || b.projeto === '' ? 2 : num(b.projeto)},
      DEP_ST_HISTORICO = ${s(b.historico, 120)}, DEP_CH_AUTO = '${simNao(b.auto, 'N')}', DEP_RE_TETO = ${v0(b.teto)}, DEP_CH_ATIVO = '${simNao(b.ativo, 'S')}', DEP_DT_ALTERACAO = SYSDATE, DEP_IN_USU = ${ctx.usu}, DEP_ST_USU = '${ascii(ctx.login, 60)}'`;
    if (id) await megaExec(`BEGIN UPDATE MEGA.CCS_TB_GFIN_BXC_DEPARA SET ${sets} WHERE DEP_IN_CODIGO = ${id}; COMMIT; END;`);
    else await megaExec(`BEGIN INSERT INTO MEGA.CCS_TB_GFIN_BXC_DEPARA (DEP_IN_CODIGO, TPD_ST_CODIGO, DEP_CH_NATUREZA, ACAO_IN_CODIGO) VALUES (MEGA.CCS_SEQ_GFIN_BXC_DEPARA.NEXTVAL, '${ascii(b.tpd, 10)}', '${b.natureza}', ${num(b.acao)});
      UPDATE MEGA.CCS_TB_GFIN_BXC_DEPARA SET ${sets} WHERE DEP_IN_CODIGO = (SELECT MAX(DEP_IN_CODIGO) FROM MEGA.CCS_TB_GFIN_BXC_DEPARA); COMMIT; END;`);
    req.log.info({ gfin: 'bxc_depara', usu: ctx.usu, id, tpd: b.tpd }, 'de-para salvo');
    return { itens: await deparas() };
  });
  app.delete('/bxc/depara/:id', admin, async (req) => { await megaExec(`BEGIN DELETE FROM MEGA.CCS_TB_GFIN_BXC_DEPARA WHERE DEP_IN_CODIGO = ${num(req.params.id)}; COMMIT; END;`); return { itens: await deparas() }; });

  // -------- configuracao (admin): parametros BXC_* e contas do escopo
  const CHAVES = ['BXC_TOLERANCIA', 'BXC_TETO_ROBO', 'BXC_ROBO_ATIVO', 'BXC_USU_ROBO', 'BXC_JANELA_DIAS', 'BXC_TIT_DIAS_ANTES', 'BXC_TIT_DIAS_DEPOIS', 'BXC_MAX_TITULOS', 'BXC_CLA_CP_JUROS', 'BXC_CLA_CP_DESC', 'BXC_CLA_CR_JUROS', 'BXC_CLA_CR_MULTA', 'BXC_CLA_CR_DESC', 'BXC_EXIGE_COMPROV', 'BXC_COMPROV_ACIMA'];
  app.get('/bxc/config', auth, async () => {
    const rows = await megaQuery(`SELECT PARAM_ST_CHAVE K, PARAM_RE_VALOR V, PARAM_ST_DESCRICAO D, TO_CHAR(PARAM_DT_ALTERACAO,'YYYY-MM-DD HH24:MI') EM, PARAM_ST_USU U FROM MEGA.CCS_TB_GFIN_PARAM WHERE PARAM_ST_CHAVE LIKE 'BXC_%' ORDER BY 1`);
    const contas = (await megaQuery(`SELECT K.*, (SELECT SUBSTR(MAX(A.AGN_ST_NOME),1,60) FROM MEGA.GLO_AGENTES A WHERE A.AGN_TAB_IN_CODIGO = 53 AND A.AGN_IN_CODIGO = K.AGN_IN_CODIGO) NOME,
        (SELECT SUBSTR(MAX(A.AGN_ST_NOME),1,50) FROM MEGA.GLO_AGENTES A WHERE A.AGN_TAB_IN_CODIGO = 53 AND A.AGN_IN_CODIGO = K.CTA_IN_AGN_BANCO) BANCO_NOME FROM MEGA.CCS_TB_GFIN_BXC_CONTA K ORDER BY K.FIL_IN_CODIGO, K.AGN_IN_CODIGO`))
      .map(k => ({ agn_id: num(k.AGN_IN_CODIGO), nome: k.NOME || '', fil_id: num(k.FIL_IN_CODIGO), ativa: k.CTA_CH_ATIVA === 'S', robo: k.CTA_CH_ROBO === 'S', teto_robo: k.CTA_RE_TETO_ROBO ? num(k.CTA_RE_TETO_ROBO) : null, agn_banco: k.CTA_IN_AGN_BANCO ? num(k.CTA_IN_AGN_BANCO) : null, banco_nome: k.BANCO_NOME || '', obs: k.CTA_ST_OBS || '' }));
    const usuRobo = rows.find(r => r.K === 'BXC_USU_ROBO');
    const robo = usuRobo && num(usuRobo.V) > 0 ? (await megaQuery(`SELECT GRU_ST_NOME N FROM MEGA.GLO_GRUPO_USUARIO WHERE GRU_IN_CODIGO = ${num(usuRobo.V)}`))[0]?.N : null;
    return { params: Object.fromEntries(rows.map(r => [r.K, num(r.V)])), detalhes: rows.map(r => ({ chave: r.K, valor: num(r.V), descricao: r.D || '', alterado_em: r.EM || '', alterado_por: r.U || '' })), contas, usuario_robo_nome: robo || '' };
  });
  app.put('/bxc/config', { ...admin, schema: { body: { type: 'object', properties: {
    params: { type: 'object', additionalProperties: { type: 'number' } },
    contas: { type: 'array', maxItems: 100, items: { type: 'object', required: ['agn_id'], properties: { agn_id: { type: 'integer' }, fil_id: { type: 'integer' }, ativa: { type: 'boolean' }, robo: { type: 'boolean' }, teto_robo: { anyOf: [{ type: 'number' }, { type: 'null' }] }, agn_banco: { anyOf: [{ type: 'integer' }, { type: 'null' }] }, obs: { type: 'string', maxLength: 200 } } } } } } }
  }, async (req) => {
    const ctx = ctxDe(req), ps = req.body.params || {}, cs = req.body.contas || [];
    for (const [k, v] of Object.entries(ps)) {
      if (!CHAVES.includes(k) || !Number.isFinite(Number(v))) continue;
      await megaExec(`BEGIN UPDATE MEGA.CCS_TB_GFIN_PARAM SET PARAM_RE_VALOR = ${Number(v)}, PARAM_DT_ALTERACAO = SYSDATE, PARAM_IN_USU = ${ctx.usu}, PARAM_ST_USU = '${ascii(ctx.login, 60)}' WHERE PARAM_ST_CHAVE = '${k}'; COMMIT; END;`);
    }
    for (const c of cs) {
      const existe = (await megaQuery(`SELECT COUNT(*) N FROM MEGA.CCS_TB_GFIN_BXC_CONTA WHERE AGN_IN_CODIGO = ${num(c.agn_id)}`))[0];
      const sets = `${c.fil_id ? `FIL_IN_CODIGO = ${num(c.fil_id)},` : ''} CTA_CH_ATIVA = '${c.ativa === false ? 'N' : 'S'}', CTA_CH_ROBO = '${c.robo ? 'S' : 'N'}', CTA_RE_TETO_ROBO = ${c.teto_robo == null ? 'NULL' : Number(c.teto_robo)}, CTA_IN_AGN_BANCO = ${c.agn_banco == null ? 'NULL' : num(c.agn_banco)}, CTA_ST_OBS = '${ascii(c.obs, 200)}', CTA_DT_ALTERACAO = SYSDATE, CTA_IN_USU = ${ctx.usu}, CTA_ST_USU = '${ascii(ctx.login, 60)}'`;
      if (num(existe?.N)) await megaExec(`BEGIN UPDATE MEGA.CCS_TB_GFIN_BXC_CONTA SET ${sets} WHERE AGN_IN_CODIGO = ${num(c.agn_id)}; COMMIT; END;`);
      else if (c.fil_id) await megaExec(`BEGIN INSERT INTO MEGA.CCS_TB_GFIN_BXC_CONTA (AGN_IN_CODIGO, FIL_IN_CODIGO) VALUES (${num(c.agn_id)}, ${num(c.fil_id)}); UPDATE MEGA.CCS_TB_GFIN_BXC_CONTA SET ${sets} WHERE AGN_IN_CODIGO = ${num(c.agn_id)}; COMMIT; END;`);
    }
    cacheParams = { t: 0, v: null };
    req.log.info({ gfin: 'bxc_config', usu: ctx.usu, params: Object.keys(ps), contas: cs.length }, 'configuracao salva');
    return { ok: true };
  });
  app.get('/bxc/contas-mega', admin, async (req) => {   // contas de banco do Mega para incluir no escopo
    const q = ascii(req.query.q, 40).toUpperCase();
    const rows = await megaQuery(`SELECT * FROM (SELECT C.AGN_IN_CODIGO AGN, SUBSTR(A.AGN_ST_NOME,1,60) NOME, C.BAN_IN_NUMERO BCO FROM MEGA.GLO_CONTASFIN C, MEGA.GLO_AGENTES A
      WHERE C.AGN_TAB_IN_CODIGO = 53 AND C.AGN_TAU_ST_CODIGO = 'N' AND NVL(C.BAN_IN_NUMERO, 999) <> 999 AND A.AGN_TAB_IN_CODIGO = 53 AND A.AGN_PAD_IN_CODIGO = C.AGN_PAD_IN_CODIGO AND A.AGN_IN_CODIGO = C.AGN_IN_CODIGO
      ${q ? `AND (UPPER(A.AGN_ST_NOME) LIKE '%${q}%' OR TO_CHAR(C.AGN_IN_CODIGO) = '${q}')` : ''} ORDER BY A.AGN_ST_NOME) WHERE ROWNUM <= 50`);
    return { itens: rows.map(r => ({ agn_id: num(r.AGN), nome: r.NOME || '', banco: r.BCO ? num(r.BCO) : null })) };
  });

  // -------- pedidos de liberacao de encargos
  const SQL_PED = `SELECT P.*, TO_CHAR(P.PED_DT_INCLUSAO,'YYYY-MM-DD HH24:MI') EM, TO_CHAR(P.LIB_DT,'YYYY-MM-DD HH24:MI') LIB_EM,
      (SELECT SUBSTR(MAX(A.AGN_ST_NOME),1,50) FROM MEGA.GLO_AGENTES A WHERE A.AGN_TAB_IN_CODIGO = 53 AND A.AGN_IN_CODIGO = P.AGN_IN_CODIGO) AGN_NOME,
      (SELECT TO_CHAR(MAX(NVL(M.MOV_DT_PRORROGADO, M.MOV_DT_VENCTO)),'YYYY-MM-DD') FROM MEGA.FIN_MOVIMENTO M WHERE M.ORG_IN_CODIGO = P.ORG_IN_CODIGO AND M.MOV_TAB_IN_CODIGO = 352 AND M.MOV_SEQ_IN_CODIGO = P.MOV_SEQ_IN_CODIGO AND M.MOV_IN_NUMLANCTO = P.MOV_IN_NUMLANCTO) VENC
      FROM MEGA.CCS_TB_GFIN_BXC_PEDIDO P`;
  const linhaPed = r => ({ id: num(r.PED_IN_CODIGO), tipo: r.PED_CH_TIPO, org: num(r.ORG_IN_CODIGO), seq: num(r.MOV_SEQ_IN_CODIGO), lancto: num(r.MOV_IN_NUMLANCTO), agn_id: r.AGN_IN_CODIGO ? num(r.AGN_IN_CODIGO) : null, agn_nome: r.AGN_NOME || '',
    doc: r.MOV_ST_DOCUMENTO || '', parcela: r.MOV_ST_PARCELA || '', cba: r.CBA_IN_SEQUENCIA ? num(r.CBA_IN_SEQUENCIA) : null, saldo: num(r.PED_RE_SALDO), valor_banco: num(r.PED_RE_VALOR_BANCO),
    calc: { juros: num(r.PED_RE_JUROS_CALC), multa: num(r.PED_RE_MULTA_CALC), desconto: num(r.PED_RE_DESC_CALC) }, pedido: { juros: num(r.PED_RE_JUROS_PED), multa: num(r.PED_RE_MULTA_PED), desconto: num(r.PED_RE_DESC_PED) },
    motivo: r.PED_ST_MOTIVO || '', status: r.PED_CH_STATUS, solicitante: r.SOL_USU_ST_LOGIN || '', em: r.EM || '', liberador: r.LIB_USU_ST_LOGIN || '', liberado_em: r.LIB_EM || '', lib_em: r.LIB_EM || '', parecer: r.LIB_ST_PARECER || '', log_id: r.LOG_IN_CODIGO ? num(r.LOG_IN_CODIGO) : null,
    titulo: { doc: r.MOV_ST_DOCUMENTO || '', parcela: r.MOV_ST_PARCELA || '', agn_id: r.AGN_IN_CODIGO ? num(r.AGN_IN_CODIGO) : null, agn_nome: r.AGN_NOME || '', saldo: num(r.PED_RE_SALDO), venc: r.VENC || '' } });
  app.get('/bxc/pedidos', auth, async (req) => {
    const stRaw = String(req.query.status || 'P').toUpperCase();
    const st = (stRaw === 'H' ? 'LNUC' : stRaw.replace(/[^PLNUC]/g, '')) || 'P', dias_ = Math.min(parseInt(req.query.dias, 10) || 90, 365);   // H = historico (liberados, negados, usados, cancelados)
    const rows = await megaQuery(`${SQL_PED} WHERE P.PED_CH_STATUS IN (${[...st].map(c => `'${c}'`).join(',')}) AND P.PED_DT_INCLUSAO >= TRUNC(SYSDATE) - ${dias_} ORDER BY P.PED_IN_CODIGO DESC`);
    return { itens: rows.map(linhaPed) };
  });
  app.post('/bxc/pedidos', { ...opera, schema: { body: { type: 'object', required: ['tipo', 'org', 'seq', 'lancto', 'pedido'], properties: {
    tipo: { type: 'string', enum: ['P', 'R'] }, org: { type: 'integer' }, seq: { type: 'integer' }, lancto: { type: 'integer' }, cba: { type: 'integer' }, saldo: { type: 'number' }, valor_banco: { type: 'number' },
    calc: { type: 'object' }, pedido: { type: 'object', required: ['juros', 'multa', 'desconto'] }, motivo: { type: 'string', minLength: 5, maxLength: 400 } } } } }, async (req) => {
    const b = req.body, ctx = ctxDe(req), c = b.calc || {}, p = b.pedido;
    const t = (await megaQuery(`SELECT AGN_IN_CODIGO AGN, MOV_ST_DOCUMENTO DOC, MOV_ST_PARCELA PARC, NVL(MOV_RE_SALDOCPACRE,0) SALDO FROM MEGA.FIN_MOVIMENTO WHERE ORG_IN_CODIGO = ${num(b.org)} AND MOV_TAB_IN_CODIGO = 352 AND MOV_SEQ_IN_CODIGO = ${num(b.seq)} AND MOV_IN_NUMLANCTO = ${num(b.lancto)}`))[0];
    if (!t) { const e = new Error('Titulo nao encontrado'); e.statusCode = 404; throw e; }
    await megaExec(`BEGIN UPDATE MEGA.CCS_TB_GFIN_BXC_PEDIDO SET PED_CH_STATUS = 'C' WHERE PED_CH_STATUS = 'P' AND ORG_IN_CODIGO = ${num(b.org)} AND MOV_SEQ_IN_CODIGO = ${num(b.seq)} AND MOV_IN_NUMLANCTO = ${num(b.lancto)};
      INSERT INTO MEGA.CCS_TB_GFIN_BXC_PEDIDO (PED_IN_CODIGO, PED_CH_TIPO, ORG_IN_CODIGO, MOV_SEQ_IN_CODIGO, MOV_IN_NUMLANCTO, AGN_IN_CODIGO, MOV_ST_DOCUMENTO, MOV_ST_PARCELA, CBA_IN_SEQUENCIA, PED_RE_SALDO, PED_RE_VALOR_BANCO,
        PED_RE_JUROS_CALC, PED_RE_MULTA_CALC, PED_RE_DESC_CALC, PED_RE_JUROS_PED, PED_RE_MULTA_PED, PED_RE_DESC_PED, PED_ST_MOTIVO, PED_CH_STATUS, SOL_USU_IN_CODIGO, SOL_USU_ST_LOGIN)
      VALUES (MEGA.CCS_SEQ_GFIN_BXC_PEDIDO.NEXTVAL, '${b.tipo}', ${num(b.org)}, ${num(b.seq)}, ${num(b.lancto)}, ${num(t.AGN)}, '${ascii(t.DOC, 30)}', '${ascii(t.PARC, 10)}', ${b.cba ? num(b.cba) : 'NULL'}, ${f2(b.saldo ?? t.SALDO)}, ${f2(b.valor_banco)},
        ${f2(c.juros)}, ${f2(c.multa)}, ${f2(c.desconto)}, ${f2(p.juros)}, ${f2(p.multa)}, ${f2(p.desconto)}, '${ascii(b.motivo, 400)}', 'P', ${ctx.usu}, '${ascii(ctx.login, 60)}'); COMMIT; END;`);
    const r = await megaQuery(`${SQL_PED} WHERE P.ORG_IN_CODIGO = ${num(b.org)} AND P.MOV_SEQ_IN_CODIGO = ${num(b.seq)} AND P.MOV_IN_NUMLANCTO = ${num(b.lancto)} AND P.PED_CH_STATUS = 'P' ORDER BY P.PED_IN_CODIGO DESC`);
    req.log.info({ gfin: 'bxc_pedido', usu: ctx.usu, lancto: b.lancto }, 'pedido de liberacao de encargos');
    return { pedido: r[0] ? linhaPed(r[0]) : null };
  });
  const decide = (status) => async (req, reply) => {
    const id = num(req.params.id), ctx = ctxDe(req), b = req.body || {};
    const atual = (await megaQuery(`SELECT PED_CH_STATUS ST FROM MEGA.CCS_TB_GFIN_BXC_PEDIDO WHERE PED_IN_CODIGO = ${id}`))[0];
    if (!atual) return reply.code(404).send({ error: 'nao_encontrado', message: 'Pedido nao encontrado.' });
    if (atual.ST !== 'P') return reply.code(409).send({ error: 'ja_decidido', message: `Pedido ja ${atual.ST === 'L' ? 'liberado' : atual.ST === 'N' ? 'negado' : atual.ST === 'U' ? 'usado' : 'cancelado'}.` });
    const ajuste = status === 'L' && b.pedido ? `, PED_RE_JUROS_PED = ${f2(b.pedido.juros)}, PED_RE_MULTA_PED = ${f2(b.pedido.multa)}, PED_RE_DESC_PED = ${f2(b.pedido.desconto)}` : '';
    await megaExec(`BEGIN UPDATE MEGA.CCS_TB_GFIN_BXC_PEDIDO SET PED_CH_STATUS = '${status}', LIB_USU_IN_CODIGO = ${ctx.usu}, LIB_USU_ST_LOGIN = '${ascii(ctx.login, 60)}', LIB_DT = SYSDATE, LIB_ST_PARECER = '${ascii(b.parecer, 400)}' ${ajuste} WHERE PED_IN_CODIGO = ${id}; COMMIT; END;`);
    const r = await megaQuery(`${SQL_PED} WHERE P.PED_IN_CODIGO = ${id}`);
    req.log.info({ gfin: 'bxc_pedido_decisao', usu: ctx.usu, id, status }, 'decisao do pedido de encargos');
    return { pedido: linhaPed(r[0]) };
  };
  app.post('/bxc/pedidos/:id/liberar', libera, decide('L'));
  app.post('/bxc/pedidos/:id/negar', libera, decide('N'));

  // -------- comprovante (PIX/TED) com OCR
  app.post('/bxc/comprovante', opera, async (req, reply) => {
    const ctx = ctxDe(req);
    let arquivo = null, campos = {};
    for await (const part of req.parts()) {
      if (part.type === 'file') arquivo = { nome: part.filename, mime: part.mimetype, buf: await part.toBuffer() };
      else campos[part.fieldname] = part.value;
    }
    if (!arquivo || !arquivo.buf?.length) return reply.code(400).send({ error: 'sem_arquivo', message: 'Envie o comprovante (imagem ou PDF).' });
    const pasta = path.join(UPLOADS, new Date().toISOString().slice(0, 7));
    fs.mkdirSync(pasta, { recursive: true });
    const ext = (path.extname(arquivo.nome || '') || { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf' }[arquivo.mime] || '.bin').toLowerCase().slice(0, 6);
    const destino = path.join(pasta, `${crypto.randomUUID()}${ext}`);
    fs.writeFileSync(destino, arquivo.buf);
    const hash = crypto.createHash('sha256').update(arquivo.buf).digest('hex');
    const { ocr, modelo, motivo } = await lerComprovante(arquivo.buf, arquivo.mime);
    const conf = confereComprovante(ocr, campos.valor_esperado);
    const dataOcr = ocr?.data && ehData(ocr.data) ? dt(ocr.data) : 'NULL';
    const token = crypto.randomUUID();
    await megaExec(`BEGIN INSERT INTO MEGA.CCS_TB_GFIN_BXC_COMPROV (COMP_IN_CODIGO, COMP_ST_ARQUIVO, COMP_ST_NOME, COMP_ST_MIME, COMP_IN_BYTES, COMP_ST_HASH, COMP_RE_VALOR, COMP_DT_DATA, COMP_ST_FAVORECIDO, COMP_ST_PAGADOR, COMP_ST_IDTRANSACAO, COMP_ST_BANCO,
      COMP_CH_CONFERE, COMP_ST_OCR, COMP_ST_MOTIVO, CBA_IN_SEQUENCIA, USU_IN_CODIGO, USU_ST_LOGIN)
      VALUES (MEGA.CCS_SEQ_GFIN_BXC_COMPROV.NEXTVAL, '${ascii(path.relative(UPLOADS, destino), 300)}', '${ascii(arquivo.nome, 200)}', '${ascii(arquivo.mime, 80)}', ${arquivo.buf.length}, '${hash}', ${ocr?.valor != null ? f2(ocr.valor) : 'NULL'}, ${dataOcr},
      '${ascii(ocr?.favorecido, 120)}', '${ascii(ocr?.pagador, 120)}', '${ascii(ocr?.id_transacao, 80)}', '${ascii(ocr?.banco, 60)}', '${conf.confere}', '${ascii(ocr ? JSON.stringify({ ...ocr, modelo, token }) : `{"token":"${token}"}`, 3900)}', '${ascii(motivo || conf.motivo, 400)}',
      ${campos.cba ? num(campos.cba) : 'NULL'}, ${ctx.usu}, '${ascii(ctx.login, 60)}'); COMMIT; END;`);
    const id = (await megaQuery(`SELECT MAX(COMP_IN_CODIGO) ID FROM MEGA.CCS_TB_GFIN_BXC_COMPROV WHERE COMP_ST_HASH = '${hash}' AND USU_IN_CODIGO = ${ctx.usu}`))[0];
    req.log.info({ gfin: 'bxc_comprovante', usu: ctx.usu, bytes: arquivo.buf.length, confere: conf.confere, ocr: !!ocr }, 'comprovante lido');
    return { comp_id: id ? num(id.ID) : null, ocr, modelo, confere: conf.confere, motivo: motivo || conf.motivo, hash };
  });
  app.get('/bxc/comprovante/:id', auth, async (req, reply) => {
    const r = (await megaQuery(`SELECT COMP_ST_ARQUIVO ARQ, COMP_ST_MIME MIME, COMP_ST_NOME NOME FROM MEGA.CCS_TB_GFIN_BXC_COMPROV WHERE COMP_IN_CODIGO = ${num(req.params.id)}`))[0];
    if (!r) return reply.code(404).send({ error: 'nao_encontrado' });
    const caminho = path.join(UPLOADS, r.ARQ);
    if (!caminho.startsWith(UPLOADS) || !fs.existsSync(caminho)) return reply.code(404).send({ error: 'arquivo_ausente' });
    reply.header('Content-Disposition', `inline; filename="${ascii(r.NOME || 'comprovante', 80)}"`);
    return reply.type(r.MIME || 'application/octet-stream').send(fs.createReadStream(caminho));
  });

  // -------- robo
  app.post('/bxc/robo/rodar', admin, async (req) => rodarRobo(app, `manual por ${req.user.login || req.user.sub}`));
  if (process.env.BXC_ROBO !== '0') {
    let rodando = false;
    const timer = setInterval(async () => {
      if (rodando) return; rodando = true;
      try { await rodarRobo(app, 'agendado'); } catch (e) { app.log.error({ bxc: 'robo', err: String(e.message || e) }, 'robo falhou'); } finally { rodando = false; }
    }, 10 * 60 * 1000);
    timer.unref?.();
  }
}
