// [27/11/2026 - Ronaldo Fajan] Baixas/Conciliacao > CONCILIACAO PIX I (Quality). Desenho e regras: sql/50_pix_conciliacao.sql.
// A conta PIX I nao tem extrato: o lado do banco sao comprovantes. A tela lista os lancamentos do Mega nas contas do grupo
// (24492 PRO-FREE, 24504 PRO-QLT, 25515 ANDRAR II) a partir da data de corte, separados em entradas e saidas, como a planilha
// "EXTRATO JEANS". O usuario marca 1 ou N lancamentos, informa a DATA DO BANCO e concilia (CCS_P_GFIN_PIX_CONCILIA: uma
// linha de banco digitada + conciliacao manual por lancamento). Desfazer: CCS_P_GFIN_PIX_DESFAZ.
//   GET  /pix/painel?grp=1&de=AAAA-MM-DD&ate=AAAA-MM-DD  grupo, lojas, lancamentos do periodo e saldos por loja (data do banco)
//   POST /pix/conciliar  { grp, data_banco, movs: [{org, seq, lanc}], simular }
//   POST /pix/desfazer   { grp, apts: [id], simular }
//   PUT  /pix/config     { grp, corte, lojas: [{codigo, saldo_ini}] }   (so administrador)
// Texto que vai para o SOAP: so numeros, datas validadas e login em ASCII. O usuario do Mega e o sub do token.
import crypto from 'node:crypto';
import { megaQuery, megaExec } from '../soap/mega.js';

const MOD = 'PIX_CONCILIA';
const isAdmin = u => u?.perm === 'A';
const temModulo = (u, cod) => isAdmin(u) || (u?.modulos || []).some(m => m.codigo === cod);
const num = v => Number(v || 0);
const ascii = (s, max) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]/g, ' ').replace(/'/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const RX_DATA = /^\d{4}-\d{2}-\d{2}$/;
const hoje = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);   // Brasilia (UTC-3)
const dt = s => `TO_DATE('${s}', 'YYYY-MM-DD')`;

// o que o lancamento e, pelo lado da conta (natureza D = entrou na conta, C = saiu) e pela acao do Mega
function tipoDe(m) {
  const transf = m.contra_tau === 'N' || m.acao === 712;
  if (m.nat === 'D') return transf ? 'Transf. recebida' : m.acao === 704 ? 'Adiant. de cliente' : m.acao === 706 ? 'Recebimento' : 'Entrada';
  return transf ? 'Transf. enviada' : m.acao === 705 ? 'Pagamento' : [708, 710].includes(m.acao) ? 'Saída avulsa' : 'Saída';
}

async function grupoDe(grp) {
  const [g] = await megaQuery(`SELECT GRP_IN_CODIGO ID, GRP_ST_NOME NOME, TO_CHAR(GRP_DT_CORTE, 'YYYY-MM-DD') CORTE, GRP_CH_ATIVO ATIVO
                                 FROM MEGA.CCS_TB_GFIN_PIX_GRUPO WHERE GRP_IN_CODIGO = ${num(grp)}`);
  if (!g) return null;
  const contas = await megaQuery(`SELECT K.AGN_IN_CODIGO AGN, K.CTA_ST_EMPRESA EMP, K.CTA_IN_ORDEM ORD, K.CTA_RE_SALDO_INI SALDO,
                                         (SELECT SUBSTR(MAX(A.AGN_ST_NOME), 1, 60) FROM MEGA.GLO_AGENTES A WHERE A.AGN_TAB_IN_CODIGO = 53 AND A.AGN_IN_CODIGO = K.AGN_IN_CODIGO) NOME
                                    FROM MEGA.CCS_TB_GFIN_PIX_CONTA K WHERE K.GRP_IN_CODIGO = ${num(grp)} ORDER BY K.CTA_IN_ORDEM`);
  const lojas = await megaQuery(`SELECT LOJ_ST_CODIGO COD, LOJ_ST_NOME NOME, LOJ_RE_SALDO_INI SALDO, LOJ_IN_ORDEM ORD
                                   FROM MEGA.CCS_TB_GFIN_PIX_LOJA WHERE GRP_IN_CODIGO = ${num(grp)} ORDER BY LOJ_IN_ORDEM`);
  const filiais = await megaQuery(`SELECT FIL_IN_CODIGO FIL, LOJ_ST_CODIGO LOJ FROM MEGA.CCS_TB_GFIN_PIX_FILIAL WHERE GRP_IN_CODIGO = ${num(grp)}`);
  return {
    id: num(g.ID), nome: g.NOME || '', corte: g.CORTE, ativo: g.ATIVO === 'S',
    contas: contas.map(c => ({ agn: num(c.AGN), empresa: c.EMP || '', nome: c.NOME || '', saldo_ini: num(c.SALDO) })),
    lojas: lojas.map(l => ({ codigo: l.COD, nome: l.NOME || l.COD, saldo_ini: num(l.SALDO) })),
    filiais: Object.fromEntries(filiais.map(f => [num(f.FIL), f.LOJ])),
  };
}

async function lerLote(token) {
  const [r] = await megaQuery(`SELECT LOT_IN_CODIGO ID, LOT_CH_STATUS ST, LOT_ST_MENSAGEM MSG, LOT_IN_QTD QTD, LOT_RE_ENTRADAS ENT, LOT_RE_SAIDAS SAI
                                 FROM MEGA.CCS_TB_GFIN_PIX_LOTE WHERE LOT_ST_TOKEN = '${token}'`);
  return r ? { lote: num(r.ID), status: r.ST, mensagem: r.MSG || '', qtd: num(r.QTD), entradas: num(r.ENT), saidas: num(r.SAI) } : null;
}

export default async function conciliacaoPixRoutes(app) {
  const podeOperar = async (req, reply) => {
    if (!temModulo(req.user, MOD)) return reply.code(403).send({ error: 'sem_modulo', message: 'Seu usuario nao tem o modulo Conciliacao PIX.' });
    if (!Number.isInteger(Number(req.user?.sub)) || Number(req.user.sub) <= 0) return reply.code(403).send({ error: 'sem_usuario_mega', message: 'Sessao sem usuario do Mega. Entre de novo.' });
  };
  const soAdmin = async (req, reply) => { if (!isAdmin(req.user)) return reply.code(403).send({ error: 'so_admin', message: 'Somente administrador.' }); };
  const opera = { preHandler: [app.authenticate, podeOperar] };
  const admin = { preHandler: [app.authenticate, soAdmin] };
  const login = req => ascii(req.user.login || req.user.nome || '', 60);

  app.get('/pix/painel', opera, async (req, reply) => {
    const g = await grupoDe(req.query?.grp || 1);
    if (!g) return reply.code(404).send({ error: 'sem_grupo', message: 'Grupo de conciliacao PIX nao encontrado.' });
    const ate = RX_DATA.test(req.query?.ate || '') ? req.query.ate : hoje();
    let de = RX_DATA.test(req.query?.de || '') ? req.query.de : g.corte;
    if (de < g.corte) de = g.corte;
    const contas = g.contas.map(c => c.agn).join(',') || '0';
    const empresa = Object.fromEntries(g.contas.map(c => [c.agn, c.empresa]));
    const contaNome = Object.fromEntries(g.contas.map(c => [c.agn, c.nome]));

    const movs = await megaQuery(`
      SELECT M.ORG_IN_CODIGO ORG, M.MOV_SEQ_IN_CODIGO SEQ, M.MOV_IN_NUMLANCTO LANC, M.FIL_IN_CODIGO FIL, M.AGN_IN_CODIGO CTA,
             TO_CHAR(M.MOV_DT_DATADOCTO, 'YYYY-MM-DD') DT, M.MOV_CH_NATUREZA NAT, M.MOV_RE_VALOR VALOR, M.ACAO_IN_CODIGO ACAO,
             M.TPD_ST_CODIGO TPD, M.MOV_ST_DOCUMENTO DOC, SUBSTR(M.MOV_ST_COMPLHIST, 1, 160) COMPL,
             M.MOV_CH_CONCILIADO CONC, M.CON_IN_SEQUENCIAL CON,
             (SELECT SUBSTR(MAX(U.GRU_ST_NOME), 1, 40) FROM MEGA.GLO_GRUPO_USUARIO U WHERE U.GRU_IN_CODIGO = M.USU_IN_INCLUSAO) USU_INC,
             (SELECT MAX(O.AGN_IN_CODIGO || '|' || O.AGN_TAU_ST_CODIGO || '|' || O.TPD_ST_CODIGO || '|' || O.MOV_ST_DOCUMENTO || '|' || REPLACE(SUBSTR(A.AGN_ST_NOME, 1, 70), '|', ' '))
                FROM MEGA.FIN_MOVIMENTO O, MEGA.GLO_AGENTES A
               WHERE O.ORG_TAB_IN_CODIGO = M.ORG_TAB_IN_CODIGO AND O.ORG_PAD_IN_CODIGO = M.ORG_PAD_IN_CODIGO AND O.ORG_IN_CODIGO = M.ORG_IN_CODIGO
                 AND O.ORG_TAU_ST_CODIGO = M.ORG_TAU_ST_CODIGO AND O.ACAOM_IN_SEQUENCIA = M.ACAOM_IN_SEQUENCIA AND O.MOV_IN_NUMLANCTO <> M.MOV_IN_NUMLANCTO
                 AND A.AGN_TAB_IN_CODIGO = O.AGN_TAB_IN_CODIGO AND A.AGN_PAD_IN_CODIGO = O.AGN_PAD_IN_CODIGO AND A.AGN_IN_CODIGO = O.AGN_IN_CODIGO) CONTRA,
             (SELECT COUNT(*) FROM MEGA.FIN_MOVIMENTO O
               WHERE O.ORG_TAB_IN_CODIGO = M.ORG_TAB_IN_CODIGO AND O.ORG_PAD_IN_CODIGO = M.ORG_PAD_IN_CODIGO AND O.ORG_IN_CODIGO = M.ORG_IN_CODIGO
                 AND O.ORG_TAU_ST_CODIGO = M.ORG_TAU_ST_CODIGO AND O.ACAOM_IN_SEQUENCIA = M.ACAOM_IN_SEQUENCIA AND O.MOV_IN_NUMLANCTO <> M.MOV_IN_NUMLANCTO) NCONTRA
        FROM MEGA.FIN_MOVIMENTO M
       WHERE M.AGN_TAB_IN_CODIGO = 53 AND M.AGN_TAU_ST_CODIGO = 'N' AND M.AGN_IN_CODIGO IN (${contas})
         AND M.ORG_TAB_IN_CODIGO = 53 AND M.MOV_TAB_IN_CODIGO = 352
         AND M.MOV_DT_DATADOCTO >= ${dt(de)} AND M.MOV_DT_DATADOCTO < ${dt(ate)} + 1
         AND NVL(M.MOV_CH_SITUACAO, 'N') <> 'C' AND NVL(M.MOV_BO_PREVISAO, 'N') = 'N'
       ORDER BY M.MOV_DT_DATADOCTO, M.MOV_IN_NUMLANCTO
       FETCH FIRST 3000 ROWS ONLY`);

    // solicitacao financeira (portal) que gerou o lancamento: solicitante e justificativa
    const porOrg = {};
    for (const m of movs) (porOrg[num(m.ORG)] ||= []).push(num(m.LANC));
    const sol = new Map();
    for (const [org, lancs] of Object.entries(porOrg)) {
      for (let i = 0; i < lancs.length; i += 900) {
        const rows = await megaQuery(`SELECT S.ORG_IN_CODIGO ORG, S.BX_FIN_MOV_IN_NUMLANCTO LANC, S.SOL_IN_ID ID, SUBSTR(S.SOL_ST_JUSTIFICATIVA, 1, 160) JUST,
                                             (SELECT SUBSTR(MAX(U.GRU_ST_NOME), 1, 40) FROM MEGA.GLO_GRUPO_USUARIO U WHERE U.GRU_IN_CODIGO = S.GRU_IN_SOLICITANTE) SOLIC
                                        FROM MEGA.CCS_TB_SOLFIN S WHERE S.ORG_IN_CODIGO = ${num(org)} AND S.BX_FIN_MOV_IN_NUMLANCTO IN (${lancs.slice(i, i + 900).join(',')})`);
        for (const r of rows) sol.set(`${num(r.ORG)}:${num(r.LANC)}`, { id: num(r.ID), solicitante: r.SOLIC || '', justificativa: r.JUST || '' });
      }
    }
    // conciliacoes feitas por esta tela (ativas) dos lancamentos do periodo
    const apts = await megaQuery(`SELECT A.APT_IN_CODIGO ID, A.ORG_IN_CODIGO ORG, A.MOV_IN_NUMLANCTO LANC, A.CON_IN_SEQUENCIAL CON, A.LOJ_ST_CODIGO LOJ,
                                         TO_CHAR(A.APT_DT_BANCO, 'YYYY-MM-DD') DTB, A.USU_ST_LOGIN LOGIN, TO_CHAR(A.APT_DT_INCLUSAO, 'YYYY-MM-DD HH24:MI') QUANDO
                                    FROM MEGA.CCS_TB_GFIN_PIX_APONT A
                                   WHERE A.GRP_IN_CODIGO = ${g.id} AND A.APT_CH_STATUS = 'A'
                                     AND A.APT_DT_MOVIMENTO >= ${dt(de)} AND A.APT_DT_MOVIMENTO < ${dt(ate)} + 1`);
    const aptDe = new Map(apts.map(a => [`${num(a.ORG)}:${num(a.LANC)}`, a]));

    // [27/11/2026] saldo por loja pela data do banco: abertura + TUDO que esta conciliado no Mega nessas contas (por esta tela,
    // pelo financeiro no Mega, pela SolFin ou pelo Baixar e conciliar), lancamento a partir do corte. Data do banco = menor data
    // das linhas de banco da conciliacao (sem linha: data do lancamento). A tela monta o dia.
    const conBanco = `(SELECT B.CON_IN_SEQUENCIAL CON, MIN(TRUNC(B.CBA_DT_DATA)) DTB FROM MEGA.FIN_CONCILIACAO B
                        WHERE B.AGN_TAB_IN_CODIGO = 53 AND B.AGN_IN_CODIGO IN (${contas}) AND B.CON_IN_SEQUENCIAL IS NOT NULL GROUP BY B.CON_IN_SEQUENCIAL)`;
    // [27/11/2026] POR CONTA (pedido: "a conciliacao e por conta, mesmo que aconteca em varias filiais - baixas da mesma conta")
    const serie = await megaQuery(`
      SELECT M.AGN_IN_CODIGO AGN, TO_CHAR(NVL(D.DTB, TRUNC(M.MOV_DT_DATADOCTO)), 'YYYY-MM-DD') D,
             SUM(CASE WHEN M.MOV_CH_NATUREZA = 'D' THEN M.MOV_RE_VALOR ELSE 0 END) ENT, SUM(CASE WHEN M.MOV_CH_NATUREZA = 'C' THEN M.MOV_RE_VALOR ELSE 0 END) SAI
        FROM MEGA.FIN_MOVIMENTO M, ${conBanco} D
       WHERE M.AGN_TAB_IN_CODIGO = 53 AND M.AGN_TAU_ST_CODIGO = 'N' AND M.AGN_IN_CODIGO IN (${contas})
         AND M.ORG_TAB_IN_CODIGO = 53 AND M.MOV_TAB_IN_CODIGO = 352 AND M.MOV_DT_DATADOCTO >= ${dt(g.corte)}
         AND NVL(M.MOV_CH_SITUACAO, 'N') <> 'C' AND NVL(M.MOV_BO_PREVISAO, 'N') = 'N'
         AND M.CON_IN_SEQUENCIAL IS NOT NULL AND D.CON (+) = M.CON_IN_SEQUENCIAL
         AND NVL(D.DTB, TRUNC(M.MOV_DT_DATADOCTO)) >= ${dt(g.corte)}
       GROUP BY M.AGN_IN_CODIGO, NVL(D.DTB, TRUNC(M.MOV_DT_DATADOCTO)) ORDER BY 2`);
    // [27/11/2026] fechamento diario da grid: movimento do Mega por CONTA e dia (data do lancamento, conciliado ou nao) desde o
    // corte ate o fim do periodo - o saldo do dia nao depende dos filtros da tela
    const movdia = await megaQuery(`
      SELECT M.AGN_IN_CODIGO AGN, TO_CHAR(TRUNC(M.MOV_DT_DATADOCTO), 'YYYY-MM-DD') D,
             SUM(CASE WHEN M.MOV_CH_NATUREZA = 'D' THEN M.MOV_RE_VALOR ELSE 0 END) ENT, SUM(CASE WHEN M.MOV_CH_NATUREZA = 'C' THEN M.MOV_RE_VALOR ELSE 0 END) SAI
        FROM MEGA.FIN_MOVIMENTO M
       WHERE M.AGN_TAB_IN_CODIGO = 53 AND M.AGN_TAU_ST_CODIGO = 'N' AND M.AGN_IN_CODIGO IN (${contas})
         AND M.ORG_TAB_IN_CODIGO = 53 AND M.MOV_TAB_IN_CODIGO = 352
         AND M.MOV_DT_DATADOCTO >= ${dt(g.corte)} AND M.MOV_DT_DATADOCTO < ${dt(ate)} + 1
         AND NVL(M.MOV_CH_SITUACAO, 'N') <> 'C' AND NVL(M.MOV_BO_PREVISAO, 'N') = 'N'
       GROUP BY M.AGN_IN_CODIGO, TRUNC(M.MOV_DT_DATADOCTO) ORDER BY 2`);
    // data do banco das conciliacoes feitas fora desta tela (para a coluna Situacao)
    const cons = [...new Set(movs.filter(m => m.CON).map(m => num(m.CON)))];
    const dtbDe = new Map();
    for (let i = 0; i < cons.length; i += 900) {
      const rows = await megaQuery(`SELECT B.CON_IN_SEQUENCIAL CON, TO_CHAR(MIN(B.CBA_DT_DATA), 'YYYY-MM-DD') DTB, MAX(C.CON_CH_TIPO) TIPO
                                      FROM MEGA.FIN_CONCILIACAO B, MEGA.FIN_CONCILIAMOVIMENTO C
                                     WHERE B.CON_IN_SEQUENCIAL IN (${cons.slice(i, i + 900).join(',')}) AND C.CON_IN_SEQUENCIAL = B.CON_IN_SEQUENCIAL
                                     GROUP BY B.CON_IN_SEQUENCIAL`);
      for (const r of rows) dtbDe.set(num(r.CON), { data: r.DTB, tipo: r.TIPO || '' });
    }
    // lancamentos com data futura no Mega (nao entram na tela: corrigir a data antes)
    const [fut] = await megaQuery(`SELECT COUNT(*) N, SUM(M.MOV_RE_VALOR) V FROM MEGA.FIN_MOVIMENTO M
                                    WHERE M.AGN_TAB_IN_CODIGO = 53 AND M.AGN_TAU_ST_CODIGO = 'N' AND M.AGN_IN_CODIGO IN (${contas})
                                      AND M.ORG_TAB_IN_CODIGO = 53 AND M.MOV_TAB_IN_CODIGO = 352 AND M.MOV_DT_DATADOCTO >= TRUNC(SYSDATE) + 1
                                      AND NVL(M.MOV_CH_SITUACAO, 'N') <> 'C' AND NVL(M.MOV_BO_PREVISAO, 'N') = 'N' AND NVL(M.MOV_CH_CONCILIADO, 'N') <> 'S'`);

    const lancamentos = movs.map(r => {
      const org = num(r.ORG), lanc = num(r.LANC), cta = num(r.CTA), fil = num(r.FIL);
      const [cAgn, cTau, cTpd, cDoc, cNome] = String(r.CONTRA || '').split('|');
      const a = aptDe.get(`${org}:${lanc}`);
      const s = sol.get(`${org}:${lanc}`);
      const m = {
        key: `${org}:${num(r.SEQ)}:${lanc}`, org, seq: num(r.SEQ), lanc, fil, conta: cta, empresa: empresa[cta] || '',
        loja: g.filiais[fil] || null, data: r.DT, nat: r.NAT, valor: num(r.VALOR), acao: num(r.ACAO), tpd: r.TPD || '', doc: r.DOC || '',
        historico: r.COMPL || '', usu_inclusao: r.USU_INC || '',
        contra_agn: cAgn ? num(cAgn) : null, contra_tau: cTau || '', contra_tpd: cTpd || '', contra_doc: cDoc || '', contra_nome: cNome || '', contra_qtd: num(r.NCONTRA),
        conciliado: r.CONC === 'S' || !!r.CON,
        banco: r.CON ? (dtbDe.get(num(r.CON)) || null) : null,   // { data, tipo } da conciliacao no Mega (A/M/G)
        apt: a ? { id: num(a.ID), data_banco: a.DTB, login: a.LOGIN || '', quando: a.QUANDO || '', loja: a.LOJ } : null,
        sol: s || null,
      };
      m.tipo = tipoDe(m);
      m.nome = m.contra_tau === 'N' ? `↔ ${contaNome[m.contra_agn] || m.contra_nome}` : (m.contra_nome || m.historico);
      m.solicitante = s?.solicitante || m.usu_inclusao;
      m.obs = s ? `Sol. ${s.id} - ${s.justificativa}` : m.historico;
      return m;
    });

    return {
      grupo: { id: g.id, nome: g.nome, corte: g.corte, ativo: g.ativo, contas: g.contas },
      lojas: g.lojas, filiais: g.filiais, de, ate, hoje: hoje(),
      lancamentos, limite: movs.length >= 3000,
      serie: serie.map(x => ({ conta: num(x.AGN), data: x.D, ent: num(x.ENT), sai: num(x.SAI) })),
      movdia: movdia.map(x => ({ conta: num(x.AGN), data: x.D, ent: num(x.ENT), sai: num(x.SAI) })),
      futuros: { qtd: num(fut?.N), valor: num(fut?.V) },
    };
  });

  app.post('/pix/conciliar', { ...opera, schema: { body: { type: 'object', required: ['grp', 'data_banco', 'movs'], properties: {
    grp: { type: 'integer', minimum: 1 }, data_banco: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, simular: { type: 'boolean' },
    movs: { type: 'array', minItems: 1, maxItems: 300, items: { type: 'object', required: ['org', 'seq', 'lanc'], properties: {
      org: { type: 'integer', minimum: 1 }, seq: { type: 'integer', minimum: 0 }, lanc: { type: 'integer', minimum: 1 } } } } } } } }, async (req) => {
    const b = req.body;
    const token = crypto.randomUUID();
    const movs = b.movs.map(m => `${num(m.org)}:${num(m.seq)}:${num(m.lanc)}`).join(';');
    try {
      await megaExec(`BEGIN MEGA.CCS_P_GFIN_PIX_CONCILIA('${token}', ${num(b.grp)}, '${movs}', '${b.data_banco}', ${Number(req.user.sub)}, '${login(req)}', '${b.simular ? 'S' : 'N'}'); END;`);
      return (await lerLote(token)) || { status: 'X', mensagem: 'O Mega nao devolveu o resultado. Atualize a tela e confira antes de tentar de novo.' };
    } catch (e) {
      return (await lerLote(token).catch(() => null)) || { status: 'X', mensagem: `Falha ao falar com o Mega (${String(e.message || e).slice(0, 160)}). Atualize a tela e confira antes de tentar de novo.` };
    }
  });

  app.post('/pix/desfazer', { ...opera, schema: { body: { type: 'object', required: ['grp', 'apts'], properties: {
    grp: { type: 'integer', minimum: 1 }, simular: { type: 'boolean' },
    apts: { type: 'array', minItems: 1, maxItems: 300, items: { type: 'integer', minimum: 1 } } } } } }, async (req) => {
    const b = req.body;
    const token = crypto.randomUUID();
    try {
      await megaExec(`BEGIN MEGA.CCS_P_GFIN_PIX_DESFAZ('${token}', ${num(b.grp)}, '${b.apts.map(num).join(',')}', ${Number(req.user.sub)}, '${login(req)}', '${b.simular ? 'S' : 'N'}'); END;`);
      return (await lerLote(token)) || { status: 'X', mensagem: 'O Mega nao devolveu o resultado. Atualize a tela e confira antes de tentar de novo.' };
    } catch (e) {
      return (await lerLote(token).catch(() => null)) || { status: 'X', mensagem: `Falha ao falar com o Mega (${String(e.message || e).slice(0, 160)}). Atualize a tela e confira antes de tentar de novo.` };
    }
  });

  // data de corte e saldo de abertura POR CONTA (virada da conciliacao: a planilha deixa de ser a referencia)
  app.put('/pix/config', { ...admin, schema: { body: { type: 'object', required: ['grp', 'corte', 'contas'], properties: {
    grp: { type: 'integer', minimum: 1 }, corte: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    contas: { type: 'array', maxItems: 50, items: { type: 'object', required: ['agn', 'saldo_ini'], properties: {
      agn: { type: 'integer', minimum: 1 }, saldo_ini: { type: 'number' } } } } } } } }, async (req, reply) => {
    const b = req.body;
    if (!(await grupoDe(b.grp))) return reply.code(404).send({ error: 'sem_grupo', message: 'Grupo de conciliacao PIX nao encontrado.' });
    const sets = b.contas.map(c => `UPDATE MEGA.CCS_TB_GFIN_PIX_CONTA SET CTA_RE_SALDO_INI = ${Math.round(Number(c.saldo_ini) * 100) / 100} WHERE GRP_IN_CODIGO = ${num(b.grp)} AND AGN_IN_CODIGO = ${num(c.agn)};`).join(' ');
    await megaExec(`BEGIN UPDATE MEGA.CCS_TB_GFIN_PIX_GRUPO SET GRP_DT_CORTE = ${dt(b.corte)}, GRP_DT_ALTERACAO = SYSDATE, GRP_IN_USU = ${Number(req.user.sub)}, GRP_ST_USU = '${login(req)}' WHERE GRP_IN_CODIGO = ${num(b.grp)}; ${sets} COMMIT; END;`);
    return { ok: true, grupo: await grupoDe(b.grp) };
  });
}
