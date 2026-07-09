// [05/05/2026 - Alexandre Carvalho] Saldos Bancarios por agente (caixa/banco) por filial
import { megaQuery } from '../soap/mega.js';

export default async function saldosBancoRoutes(app) {

  // GET /saldos-banco?data=YYYY-MM-DD&fil=0&agn=0
  app.get('/saldos-banco', { preHandler: [app.authenticate] }, async (req) => {
    const data = String(req.query.data || '').slice(0, 10);
    const fil  = parseInt(req.query.fil || '0', 10) || 0;
    const agn  = parseInt(req.query.agn || '0', 10) || 0;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
      const e = new Error('data eh obrigatorio no formato YYYY-MM-DD');
      e.statusCode = 400; throw e;
    }

    const sql = `
      SELECT AGN_IN_CODIGO, AGN_ST_NOME, FIL_IN_CODIGO, FIL_ST_NOME,
             NVL(ENTRADAS,0) ENTRADAS, NVL(SAIDAS,0) SAIDAS, NVL(SALDO,0) SALDO
        FROM TABLE(MEGA.CCS_F_GFIN_SALDOS_BANCO(
                     TO_DATE('${data}','YYYY-MM-DD'), ${fil}, ${agn}))`;
    const linhas = await megaQuery(sql);

    const total = linhas.reduce((s, r) => s + Number(r.SALDO || 0), 0);
    return {
      filtro: { data, fil, agn },
      total: { saldo: total, quantidade: linhas.length },
      linhas: linhas.map(r => ({
        agn_id:   Number(r.AGN_IN_CODIGO),
        agn_nome: r.AGN_ST_NOME,
        fil_id:   Number(r.FIL_IN_CODIGO),
        fil_nome: r.FIL_ST_NOME,
        entradas: Number(r.ENTRADAS || 0),
        saidas:   Number(r.SAIDAS   || 0),
        saldo:    Number(r.SALDO    || 0)
      }))
    };
  });

  // GET /saldos-banco/contas - lista de contas financeiras (caixas e bancos) ativas
  // [08/05/2026 - ALTERADO POR Alexandre Carvalho] Removido filtro de movimento dos ultimos 365 dias.
  // O filtro escondia 24 contas legitimas (sem movimento recente, mas ativas) - ex: contas novas
  // tipo CAIXA PIX I 502/503/504, contas dormentes com historico (CAIXA 22 DN, CARTAO BRADESCO),
  // HOLDING. Agora retorna todas as TAU=N ativas (110 vs 86 antes).
  app.get('/saldos-banco/contas', { preHandler: [app.authenticate] }, async () => {
    const rows = await megaQuery(`
      SELECT DISTINCT A.AGN_IN_CODIGO, A.AGN_ST_NOME
        FROM MEGA.GLO_AGENTES_ID  I,
             MEGA.GLO_AGENTES     A
       WHERE I.AGN_TAU_ST_CODIGO = 'N'
         AND NVL(I.AGN_CH_STATUS, 'A') = 'A'
         AND I.AGN_TAB_IN_CODIGO = A.AGN_TAB_IN_CODIGO
         AND I.AGN_PAD_IN_CODIGO = A.AGN_PAD_IN_CODIGO
         AND I.AGN_IN_CODIGO     = A.AGN_IN_CODIGO
       ORDER BY 1`);
    return rows.map(r => ({
      id: Number(r.AGN_IN_CODIGO),
      nome: r.AGN_ST_NOME
    }));
  });

  // GET /saldos-banco/lancamentos?agn=X&data_ini=YYYY-MM-DD&data_fim=YYYY-MM-DD&fil=0
  // [07/05/2026 - Alexandre Carvalho] V2: lista TODOS os movimentos da conta (todas as filiais),
  // com FIL_IN_CODIGO em cada lancamento para o frontend agrupar.
  // Saldo anterior: usa F_EXTRATOBANCARIOSALDOANTERIOR (igual function de saldos V2).
  // fil opcional: 0 = todas filiais (default).
  // [08/05/2026 - ALTERADO POR Alexandre Carvalho] V3: troca FIN_MOVIMENTO por FIN_CONCILIACAO
  // para o modal espelhar exatamente a tela de Conciliacao Bancaria do Mega (extrato real importado).
  // Antes mostrava lancamentos contabeis pendentes (FIN_MOVIMENTO) e divergia do Mega quando o
  // extrato bancario ainda nao tinha sido importado no periodo. Agora natureza C=entrada / D=saida,
  // status conciliado vem de CBA_CH_STATUS ('S'/'N'). Mapeamento: dt_vencto=CBA_DT_DATA,
  // mov_numero=CBA_IN_SEQUENCIA, his_desc=CBA_ST_HISTORICO, compl=CBA_ST_DOCUMENTO.
  app.get('/saldos-banco/lancamentos', { preHandler: [app.authenticate] }, async (req) => {
    const agn      = parseInt(req.query.agn || '0', 10);
    const fil      = parseInt(req.query.fil || '0', 10);  // 0 = todas
    const dataIni  = String(req.query.data_ini || '2000-01-01').slice(0, 10);
    const dataFim  = String(req.query.data_fim || '').slice(0, 10);
    const limit    = Math.min(parseInt(req.query.limit || '50000', 10), 100000);
    if (!agn || !/^\d{4}-\d{2}-\d{2}$/.test(dataIni) || !/^\d{4}-\d{2}-\d{2}$/.test(dataFim)) {
      const e = new Error('agn, data_ini e data_fim sao obrigatorios');
      e.statusCode = 400; throw e;
    }

    // 1. ORG dona (so pra exibicao - nao filtra calculo)
    const orgRows = await megaQuery(`
      SELECT MIN(ORG_IN_CODIGO) AS ORG_DONA
        FROM MEGA.FIN_CONCILIACAO
       WHERE AGN_IN_CODIGO = ${agn} AND AGN_TAU_ST_CODIGO = 'N'`);
    const orgDona = Number(orgRows[0]?.ORG_DONA || 0);

    // 2. [07/05/2026 - Alexandre Carvalho] V3: Saldo anterior usa helper que soma TODAS as ORGs.
    // Passa data_ini-1 para obter o saldo na vespera (ex: data_ini=01/05 -> saldo em 30/04).
    const ant = await megaQuery(`
      SELECT NVL(MEGA.CCS_F_GFIN_SALDO_BANCO_DT(
                ${agn}, TO_DATE('${dataIni}','YYYY-MM-DD') - 1), 0) AS S FROM DUAL`);
    const saldoAnterior = Number(ant[0]?.S || 0);

    // 3. [08/05/2026 - ALTERADO POR Alexandre Carvalho] Lancamentos do EXTRATO BANCARIO REAL
    // (FIN_CONCILIACAO) - mesma fonte da Conciliacao Bancaria do Mega. CBA_CH_NATUREZA C=entrada,
    // D=saida; conciliado quando CBA_CH_STATUS='S'.
    const filtroFil = fil > 0 ? `AND C.FIL_IN_CODIGO = ${fil}` : '';
    const sql = `
      SELECT * FROM (
        SELECT C.FIL_IN_CODIGO,
               NVL(O.ORG_ST_FANTASIA, O.ORG_ST_NOME) AS FIL_ST_NOME,
               C.CBA_IN_SEQUENCIA,
               TO_CHAR(C.CBA_DT_DATA,'YYYY-MM-DD')        AS DT_BANCO,
               TO_CHAR(C.CBA_DT_IMPORTACAO,'YYYY-MM-DD')  AS DT_IMP,
               C.CBA_CH_NATUREZA,
               C.CBA_CH_TIPO,
               CASE WHEN C.CBA_CH_NATUREZA = 'C' THEN NVL(C.CBA_RE_VALOR,0) ELSE 0 END AS VALOR_ENT,
               CASE WHEN C.CBA_CH_NATUREZA = 'D' THEN NVL(C.CBA_RE_VALOR,0) ELSE 0 END AS VALOR_SAI,
               NVL(C.CBA_CH_STATUS,'N') AS CONCILIADO,
               C.CBA_ST_DOCUMENTO,
               SUBSTR(C.CBA_ST_HISTORICO, 1, 240) AS HISTORICO
          FROM MEGA.FIN_CONCILIACAO     C,
               MEGA.GLO_VW_ORGANIZACAO  O
         WHERE C.AGN_IN_CODIGO     = ${agn}
           AND C.AGN_TAU_ST_CODIGO = 'N'
           AND C.FIL_IN_CODIGO     = O.ORG_IN_CODIGO (+)
           AND C.CBA_DT_DATA BETWEEN TO_DATE('${dataIni}','YYYY-MM-DD')
                                  AND TO_DATE('${dataFim}','YYYY-MM-DD')
           ${filtroFil}
         ORDER BY C.CBA_DT_DATA ASC, C.FIL_IN_CODIGO, C.CBA_IN_SEQUENCIA ASC
      ) WHERE ROWNUM <= ${limit}`;
    const rows = await megaQuery(sql);

    // 4. Running balance: saldo corrente apos cada lancamento
    // [08/05/2026 - ALTERADO POR Alexandre Carvalho] entrada/saida vem do CBA_CH_NATUREZA agora.
    let saldoCorrente = saldoAnterior;
    const lancamentos = rows.map(r => {
      const entrada = Number(r.VALOR_ENT || 0);
      const saida   = Number(r.VALOR_SAI || 0);
      saldoCorrente = saldoCorrente + entrada - saida;
      return {
        fil_id:     Number(r.FIL_IN_CODIGO),
        fil_nome:   r.FIL_ST_NOME || ('FIL ' + r.FIL_IN_CODIGO),
        mov_tab:    0,
        mov_seq:    0,
        mov_numero: Number(r.CBA_IN_SEQUENCIA || 0),
        dt_vencto:  r.DT_BANCO,
        dt_docto:   r.DT_BANCO,
        entrada,
        saida,
        natureza:   r.CBA_CH_NATUREZA || '',
        situacao:   r.CBA_CH_TIPO     || '',
        conciliado: r.CONCILIADO      || 'N',
        bxref:      'N',
        his_id:     0,
        his_desc:   r.HISTORICO       || '',
        compl:      r.CBA_ST_DOCUMENTO || '',
        saldo:      saldoCorrente
      };
    });

    const totEnt = lancamentos.reduce((s, l) => s + l.entrada, 0);
    const totSai = lancamentos.reduce((s, l) => s + l.saida,   0);
    const conciliados = lancamentos.filter(l => l.conciliado === 'S').length;

    return {
      filtro: { agn, fil, data_ini: dataIni, data_fim: dataFim, limit, org_dona: orgDona },
      saldo_anterior: saldoAnterior,
      saldo_final:    saldoAnterior + totEnt - totSai,
      total: {
        count: lancamentos.length,
        entradas: totEnt,
        saidas: totSai,
        conciliados,
        pendentes: lancamentos.length - conciliados
      },
      lancamentos
    };
  });

  // GET /saldos-banco/filiais - filiais ativas com movimento financeiro
  app.get('/saldos-banco/filiais', { preHandler: [app.authenticate] }, async () => {
    const rows = await megaQuery(`
      SELECT DISTINCT M.FIL_IN_CODIGO,
             NVL(O.ORG_ST_FANTASIA, O.ORG_ST_NOME) AS FIL_ST_NOME
        FROM MEGA.FIN_MOVIMENTO       M,
             MEGA.GLO_VW_ORGANIZACAO  O
       WHERE M.FIL_IN_CODIGO = O.ORG_IN_CODIGO (+)
         AND M.MOV_DT_VENCTO >= TRUNC(SYSDATE) - 365
       ORDER BY 1`);
    return rows.map(r => ({
      id: Number(r.FIL_IN_CODIGO),
      nome: r.FIL_ST_NOME || ('FIL ' + r.FIL_IN_CODIGO)
    }));
  });
}
