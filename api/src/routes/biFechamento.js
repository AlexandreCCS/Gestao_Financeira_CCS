// [23/09/2026 - Alexandre Carvalho] BI FECHAMENTO (GRUPO) - a primeira tela: FATURAMENTO.
//
// Vem do briefing "BI Fechamento.xlsx". A descoberta que sustenta o modelo: "NF" e "PRO" nao sao tipo
// de documento, sao PARES DE FILIAIS - a filial com CNPJ real emite nota, a espelho (CNPJ fake, o proprio
// numero) e a operacao PRO. O cadastro do par esta em MEGA.CCS_TB_GFIN_BI_EMPRESA.
// [23/09/2026] REGRA DO ALEXANDRE: o termo e sempre PRO - nunca escrever "sem nota".
//
// Regras fechadas com o Alexandre em 23/09:
//   - faturamento = nota cuja ACAO gera contas a receber (ACAO_BO_CREC='S'), saida, nao cancelada;
//   - total do GRUPO e LIQUIDO (sem venda entre empresas do grupo), com o intragrupo mostrado a parte;
//   - JR, Procolor e NLS vendem 100% para dentro: saem do total e viram bloco "empresas internas";
//   - periodo padrao = mes anterior fechado;
//   - linha de produto usa a NOMENCLATURA DO MEGA (prefixo do nome do grupo: HOM, HOB, ESC, RQL...).
//
// Motor no banco: MEGA.CCS_F_GFIN_BI_FAT e MEGA.CCS_F_GFIN_BI_LINHA (pipelined, padrao da casa).
import { megaQuery } from '../soap/mega.js';

const dataOk = s => /^\d{4}-\d{2}-\d{2}$/.test(s);
const num = v => Number(v || 0);
// mes anterior fechado
function periodoPadrao() {
  const h = new Date();
  const ini = new Date(h.getFullYear(), h.getMonth() - 1, 1);
  const fim = new Date(h.getFullYear(), h.getMonth(), 0);
  const iso = d => d.toISOString().slice(0, 10);
  return { ini: iso(ini), fim: iso(fim) };
}
function lerPeriodo(req) {
  const p = periodoPadrao();
  const ini = dataOk(String(req.query.ini || '')) ? req.query.ini : p.ini;
  const fim = dataOk(String(req.query.fim || '')) ? req.query.fim : p.fim;
  if (fim < ini) { const e = new Error('Periodo invertido: a data final e anterior a inicial.'); e.statusCode = 400; throw e; }
  return { ini, fim };
}
const SEGMENTOS = ['IND', 'VAR', 'CD', 'DIST', 'SERV'];

export default async function biFechamentoRoutes(app) {

  // GET /bi/faturamento?ini=&fim=&segmento=  -> uma linha por empresa (par NF+PRO consolidado)
  app.get('/bi/faturamento', { preHandler: [app.authenticate] }, async (req) => {
    const { ini, fim } = lerPeriodo(req);
    const seg = SEGMENTOS.includes(String(req.query.segmento)) ? `'${req.query.segmento}'` : 'NULL';
    const linhas = await megaQuery(`
      SELECT SIGLA, NOME, SEGMENTO, NO_TOTAL, FILIAIS_NF, FILIAIS_PRO,
             VL_TOTAL, VL_NF, VL_PRO, VL_INTRA, VL_LIQUIDO, QT_NOTAS, VL_ANT_TOTAL, VL_ANT_LIQ
        FROM TABLE(MEGA.CCS_F_GFIN_BI_FAT(TO_DATE('${ini}','YYYY-MM-DD'), TO_DATE('${fim}','YYYY-MM-DD'), ${seg}))`);

    const emp = linhas.map(r => ({
      sigla: r.SIGLA, nome: r.NOME, segmento: r.SEGMENTO, noTotal: r.NO_TOTAL === 'S',
      filiaisNf: (r.FILIAIS_NF || '').trim(), filiaisPro: (r.FILIAIS_PRO || '').trim(),
      total: num(r.VL_TOTAL), nf: num(r.VL_NF), pro: num(r.VL_PRO),
      intra: num(r.VL_INTRA), liquido: num(r.VL_LIQUIDO), notas: num(r.QT_NOTAS),
      anterior: num(r.VL_ANT_TOTAL), anteriorLiq: num(r.VL_ANT_LIQ),
    }));
    const soma = (arr, c) => arr.reduce((s, x) => s + x[c], 0);
    const doGrupo = emp.filter(e => e.noTotal);
    const internas = emp.filter(e => !e.noTotal);
    const t = {
      total: soma(doGrupo, 'total'), nf: soma(doGrupo, 'nf'), pro: soma(doGrupo, 'pro'),
      intra: soma(doGrupo, 'intra'), liquido: soma(doGrupo, 'liquido'),
      notas: soma(doGrupo, 'notas'), anterior: soma(doGrupo, 'anterior'), anteriorLiq: soma(doGrupo, 'anteriorLiq'),
    };
    t.variacao = t.anterior > 0 ? (t.total / t.anterior - 1) : null;
    t.variacaoLiq = t.anteriorLiq > 0 ? (t.liquido / t.anteriorLiq - 1) : null;
    t.percPro = t.total > 0 ? t.pro / t.total : 0;
    return {
      filtro: { ini, fim, segmento: req.query.segmento || null, padrao: periodoPadrao() },
      grupo: t,
      empresas: doGrupo,
      internas: { linhas: internas, total: soma(internas, 'total'), intra: soma(internas, 'intra') },
    };
  });

  // GET /bi/faturamento/linha?ini=&fim=&linha=&segmento=  -> por linha de produto; com "linha", desce nos grupos
  app.get('/bi/faturamento/linha', { preHandler: [app.authenticate] }, async (req) => {
    const { ini, fim } = lerPeriodo(req);
    const seg = SEGMENTOS.includes(String(req.query.segmento)) ? `'${req.query.segmento}'` : 'NULL';
    const linha = req.query.linha ? `'${String(req.query.linha).replace(/'/g, "''").slice(0, 60)}'` : 'NULL';
    const rows = await megaQuery(`
      SELECT LINHA, DETALHE, VL_TOTAL, VL_NF, VL_PRO, QTDE, VL_ANT, GRUPOS
        FROM TABLE(MEGA.CCS_F_GFIN_BI_LINHA(TO_DATE('${ini}','YYYY-MM-DD'), TO_DATE('${fim}','YYYY-MM-DD'), ${linha}, ${seg}))`);
    return {
      filtro: { ini, fim, linha: req.query.linha || null, segmento: req.query.segmento || null },
      linhas: rows.map(r => ({
        linha: r.LINHA, detalhe: r.DETALHE || null,
        total: num(r.VL_TOTAL), nf: num(r.VL_NF), pro: num(r.VL_PRO),
        qtde: num(r.QTDE), anterior: num(r.VL_ANT), grupos: num(r.GRUPOS),
      })),
    };
  });

  // GET /bi/empresas -> o cadastro (para a tela de parametros e para explicar o par NF/PRO)
  app.get('/bi/empresas', { preHandler: [app.authenticate] }, async () => {
    const rows = await megaQuery(`
      SELECT FIL_IN_CODIGO, EMP_ST_NOME, EMP_ST_SIGLA, EMP_CH_TIPO, EMP_IN_FIL_PAR,
             EMP_ST_SEGMENTO, EMP_BO_TOTAL_GRUPO, EMP_ST_CNPJ, EMP_IN_ORDEM
        FROM MEGA.CCS_TB_GFIN_BI_EMPRESA ORDER BY EMP_IN_ORDEM`);
    return rows.map(r => ({
      fil: num(r.FIL_IN_CODIGO), nome: r.EMP_ST_NOME, sigla: r.EMP_ST_SIGLA, tipo: r.EMP_CH_TIPO,
      par: r.EMP_IN_FIL_PAR ? num(r.EMP_IN_FIL_PAR) : null, segmento: r.EMP_ST_SEGMENTO,
      noTotal: r.EMP_BO_TOTAL_GRUPO === 'S', cnpj: (r.EMP_ST_CNPJ || '').trim(), ordem: num(r.EMP_IN_ORDEM),
    }));
  });
}
