// [10/07/2026 - CRIADO POR ALEXANDRE CARVALHO] Rotas do modulo Liberacao de
// Data de Baixa do Gestor Financeiro CCS.
//   GET /liberacao-baixa/titulos?pdv=S|N - todos os titulos do contas a receber
//        com saldo em aberto (FIN_VW_CONTASRECEBER, SALDO_EM_ABERTO > 0), com
//        cliente, forma de recebimento (HCOB), datas e dias de atraso.
//        PDV (previstos do varejo, ~15 mil linhas) fica fora por padrao e entra
//        com pdv=S. KPIs calculados sobre o conjunto retornado.
// Contexto: a trava CCS_T_DATA_BAIXA (FIN_MOVIMENTO) bloqueia baixa de credito
// com data retroativa para quem nao tem a flag GRU_ST_BAIXA_DATAANT — esta tela
// e o ponto unico de visao dos titulos em aberto para gestao dessas liberacoes.
import { megaQuery, megaExec } from '../soap/mega.js';

const num = v => Number(v || 0);
const RX_DATA = /^\d{4}-\d{2}-\d{2}$/;
// sanitiza texto que entra em literal SQL (dobra aspas, corta tamanho)
const lit = (s, max) => String(s ?? '').slice(0, max).replace(/'/g, "''");

export default async function liberacaoBaixaRoutes(app) {
  const guard = { preHandler: [app.authenticate] };

  // [10/07/2026 - Alexandre Carvalho] PDV (previstos do varejo) SEMPRE fora,
  // sem toggle - pedido do Alexandre em 10/07.
  app.get('/liberacao-baixa/titulos', guard, async () => {
    const rows = await megaQuery(`
      SELECT C.AGN_IN_CODIGO                                   AS AGN,
             NVL(G.AGN_ST_NOME, G.AGN_ST_FANTASIA)             AS CLIENTE,
             C.FIL_IN_CODIGO                                   AS FIL,
             C.MOV_ST_DOCUMENTO                                AS DOC,
             C.MOV_ST_PARCELA                                  AS PARC,
             C.TPD_ST_CODIGO                                   AS TPD,
             SUBSTR(NVL(C.HCOB_ST_DESCRICAO, ''), 1, 60)       AS FORMA_RECEB,
             TO_CHAR(C.MOV_DT_DATADOCTO, 'YYYY-MM-DD')         AS EMISSAO,
             TO_CHAR(C.MOV_DT_VENCTO,    'YYYY-MM-DD')         AS VENCTO,
             TO_CHAR(C.MOV_DT_PRORROGADO,'YYYY-MM-DD')         AS PRORROGADO,
             TRUNC(SYSDATE) - TRUNC(C.MOV_DT_PRORROGADO)       AS DIAS,
             C.MOV_RE_VALOR                                    AS VALOR,
             C.SALDO_EM_ABERTO                                 AS SALDO
        FROM MEGA.FIN_VW_CONTASRECEBER C,
             MEGA.GLO_AGENTES           G
       WHERE C.SALDO_EM_ABERTO > 0
         AND C.TPD_ST_CODIGO <> 'PDV'
         AND G.AGN_IN_CODIGO (+) = C.AGN_IN_CODIGO
       ORDER BY C.MOV_DT_PRORROGADO, C.AGN_IN_CODIGO`);

    const titulos = rows.map(r => ({
      agn_id:      num(r.AGN),
      cliente:     r.CLIENTE || `Cliente ${r.AGN}`,
      fil_id:      num(r.FIL),
      documento:   r.DOC || '',
      parcela:     r.PARC || '',
      tipo:        r.TPD || '',
      forma_receb: r.FORMA_RECEB || '',
      emissao:     r.EMISSAO || null,
      vencto:      r.VENCTO || null,
      prorrogado:  r.PRORROGADO || null,
      dias_atraso: num(r.DIAS),          // positivo = vencido; negativo = a vencer
      valor:       num(r.VALOR),
      saldo:       num(r.SALDO)
    }));

    const venc = titulos.filter(t => t.dias_atraso > 0);
    const avenc = titulos.filter(t => t.dias_atraso <= 0);
    return {
      total: titulos.length,
      kpi: {
        qt_titulos:    titulos.length,
        saldo_total:   titulos.reduce((s, t) => s + t.saldo, 0),
        qt_clientes:   new Set(titulos.map(t => t.agn_id)).size,
        qt_vencidos:   venc.length,
        saldo_vencido: venc.reduce((s, t) => s + t.saldo, 0),
        qt_avencer:    avenc.length,
        saldo_avencer: avenc.reduce((s, t) => s + t.saldo, 0),
        maior_atraso:  venc.reduce((m, t) => Math.max(m, t.dias_atraso), 0)
      },
      titulos
    };
  });

  // [10/07/2026 - Alexandre Carvalho] Libera uma DATA de baixa retroativa para
  // um titulo (FIL+AGN+DOC+PARCELA). A trigger CCS_T_DATA_BAIXA passa a aceitar
  // baixa de credito com MOV_DT_DATADOCTO = data liberada e loga a execucao.
  app.post('/liberacao-baixa/liberar', {
    ...guard,
    schema: {
      body: {
        type: 'object',
        required: ['fil', 'agn', 'documento', 'data'],
        properties: {
          fil:       { type: 'integer', minimum: 1 },
          agn:       { type: 'integer', minimum: 1 },
          documento: { type: 'string',  minLength: 1, maxLength: 20 },
          parcela:   { type: 'string',  maxLength: 6 },
          data:      { type: 'string',  pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          motivo:    { type: 'string',  maxLength: 200 }
        }
      }
    }
  }, async (req, reply) => {
    const { fil, agn, data } = req.body;
    const documento = lit(req.body.documento, 20);
    const parcela   = lit(req.body.parcela || '', 6);
    const motivo    = lit(req.body.motivo || '', 200);
    if (data >= new Date().toISOString().slice(0, 10)) {
      return reply.code(400).send({ error: 'data_invalida',
        message: 'A data liberada precisa ser anterior a hoje (baixa retroativa).' });
    }

    // ja existe liberacao ativa identica?
    const dup = await megaQuery(`
      SELECT COUNT(*) N FROM MEGA.CCS_TB_LIBERA_DATA_BAIXA
       WHERE FIL_IN_CODIGO = ${num(fil)} AND AGN_IN_CODIGO = ${num(agn)}
         AND LIB_ST_DOCUMENTO = '${documento}'
         AND NVL(LIB_ST_PARCELA,'~') = NVL('${parcela}','~')
         AND LIB_DT_BAIXA = TO_DATE('${data}','YYYY-MM-DD')
         AND LIB_CH_STATUS = 'A'`);
    if (num(dup[0]?.N) > 0) {
      return reply.code(409).send({ error: 'ja_liberado',
        message: 'Este título já tem uma liberação ativa para esta data.' });
    }

    await megaExec(`
      BEGIN
        INSERT INTO MEGA.CCS_TB_LIBERA_DATA_BAIXA
          (LIB_IN_CODIGO, FIL_IN_CODIGO, AGN_IN_CODIGO, LIB_ST_DOCUMENTO, LIB_ST_PARCELA,
           LIB_DT_BAIXA, LIB_ST_MOTIVO, LIB_CH_STATUS, LIB_IN_USU_LIBEROU, LIB_ST_USU_LIBEROU)
        VALUES
          (MEGA.CCS_SEQ_LIBERA_DATA_BAIXA.NEXTVAL, ${num(fil)}, ${num(agn)},
           '${documento}', ${parcela ? `'${parcela}'` : 'NULL'},
           TO_DATE('${data}','YYYY-MM-DD'), ${motivo ? `'${motivo}'` : 'NULL'},
           'A', ${num(req.user.sub)}, '${lit(req.user.login, 60)}');
        COMMIT;
      END;`);
    return { ok: true };
  });

  // Revoga (cancela) uma liberacao ativa.
  app.post('/liberacao-baixa/revogar', {
    ...guard,
    schema: { body: { type: 'object', required: ['id'],
      properties: { id: { type: 'integer', minimum: 1 } } } }
  }, async (req, reply) => {
    const id = num(req.body.id);
    await megaExec(`
      BEGIN
        UPDATE MEGA.CCS_TB_LIBERA_DATA_BAIXA
           SET LIB_CH_STATUS = 'C',
               LIB_IN_USU_CANCELOU  = ${num(req.user.sub)},
               LIB_DT_CANCELAMENTO  = SYSDATE
         WHERE LIB_IN_CODIGO = ${id}
           AND LIB_CH_STATUS = 'A';
        COMMIT;
      END;`);
    return { ok: true };
  });

  // Historico: liberacoes + execucoes, com nomes de quem liberou/executou.
  // Tambem serve o modal (liberacoes de um titulo) via filtros agn/documento.
  app.get('/liberacao-baixa/liberacoes', guard, async (req) => {
    const agn = num(req.query.agn);
    const doc = lit(req.query.documento || '', 20);
    const filtro = agn && doc
      ? `AND L.AGN_IN_CODIGO = ${agn} AND L.LIB_ST_DOCUMENTO = '${doc}'` : '';

    const [libs, execs] = await Promise.all([
      megaQuery(`
        SELECT L.LIB_IN_CODIGO ID, L.FIL_IN_CODIGO FIL, L.AGN_IN_CODIGO AGN,
               NVL(G.AGN_ST_NOME, G.AGN_ST_FANTASIA) CLIENTE,
               L.LIB_ST_DOCUMENTO DOC, L.LIB_ST_PARCELA PARC,
               TO_CHAR(L.LIB_DT_BAIXA,'YYYY-MM-DD') DATA_LIBERADA,
               L.LIB_ST_MOTIVO MOTIVO, L.LIB_CH_STATUS STATUS,
               L.LIB_IN_USU_LIBEROU USU_LIB, L.LIB_ST_USU_LIBEROU USU_LIB_NOME,
               TO_CHAR(L.LIB_DT_LIBERACAO,'YYYY-MM-DD HH24:MI') LIBERADO_EM,
               L.LIB_IN_USU_CANCELOU USU_CANC,
               UC.GRU_ST_NOME USU_CANC_NOME,
               TO_CHAR(L.LIB_DT_CANCELAMENTO,'YYYY-MM-DD HH24:MI') CANCELADO_EM
          FROM MEGA.CCS_TB_LIBERA_DATA_BAIXA L,
               MEGA.GLO_AGENTES G,
               MEGA.GLO_GRUPO_USUARIO UC
         WHERE G.AGN_IN_CODIGO (+) = L.AGN_IN_CODIGO
           AND UC.GRU_IN_CODIGO (+) = L.LIB_IN_USU_CANCELOU
           ${filtro}
         ORDER BY L.LIB_DT_LIBERACAO DESC`),
      megaQuery(`
        SELECT E.LIB_IN_CODIGO ID, E.MOV_IN_NUMLANCTO LANC,
               E.LIBE_IN_USU_EXECUTOU USU_EXEC,
               NVL(U.GRU_ST_NOMECOMPLETO, U.GRU_ST_NOME) USU_EXEC_NOME,
               TO_CHAR(E.LIBE_DT_EXECUCAO,'YYYY-MM-DD HH24:MI') EXECUTADO_EM,
               E.LIBE_RE_VALOR VALOR
          FROM MEGA.CCS_TB_LIBERA_DATA_BAIXA_EXEC E,
               MEGA.GLO_GRUPO_USUARIO U
         WHERE U.GRU_IN_CODIGO (+) = E.LIBE_IN_USU_EXECUTOU
         ORDER BY E.LIBE_DT_EXECUCAO DESC`)
    ]);

    const porLib = new Map();
    for (const e of execs) {
      const k = num(e.ID);
      if (!porLib.has(k)) porLib.set(k, []);
      porLib.get(k).push({
        lancamento:   num(e.LANC),
        usu_exec:     num(e.USU_EXEC),
        usu_exec_nome: e.USU_EXEC_NOME || `Usuário ${e.USU_EXEC}`,
        executado_em: e.EXECUTADO_EM,
        valor:        num(e.VALOR)
      });
    }

    return {
      liberacoes: libs.map(l => ({
        id:            num(l.ID),
        fil_id:        num(l.FIL),
        agn_id:        num(l.AGN),
        cliente:       l.CLIENTE || `Cliente ${l.AGN}`,
        documento:     l.DOC,
        parcela:       l.PARC || '',
        data_liberada: l.DATA_LIBERADA,
        motivo:        l.MOTIVO || '',
        status:        l.STATUS,                       // A=ativa, C=cancelada
        usu_liberou:   num(l.USU_LIB),
        usu_liberou_nome: l.USU_LIB_NOME,
        liberado_em:   l.LIBERADO_EM,
        usu_cancelou_nome: l.USU_CANC_NOME || null,
        cancelado_em:  l.CANCELADO_EM || null,
        execucoes:     porLib.get(num(l.ID)) || []
      }))
    };
  });
}
