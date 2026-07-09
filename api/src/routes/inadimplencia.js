// [14/05/2026 - CRIADO POR ALEXANDRE CARVALHO] Rotas do modulo Inadimplencia
// do Gestor Financeiro CCS:
//   GET /inadimplencia/bloqueios?data=YYYY-MM-DD     - clientes que o sistema
//        bloqueou no dia (CCS_TB_GFIN_BLOQUEIO_LOG, populada pelas procedures
//        CCS_P_BLOQUEIA_CLIENTE / _RESERVA via logger autonomo).
//   GET /inadimplencia/desbloqueios?data=YYYY-MM-DD  - aprovacoes manuais do dia
//        (auditoria nativa Mega: AGN_BO_BLOQUEIO N->S em A#GLO_AGENTESCMPESP +
//        ADT_OCORRENCIA), com data, hora e por quem.
//   GET /inadimplencia/clientes-atraso               - todos os titulos em
//        atraso, usando o MESMO criterio da regra de bloqueio (FIN_VW_CONTASRECEBER:
//        SALDO_EM_ABERTO>0, MOV_DT_PRORROGADO < SYSDATE-2, TPD_ST_CODIGO<>'PDV').
import { megaQuery } from '../soap/mega.js';

// Clientes internos (whitelist da CCS_P_BLOQUEIA_CLIENTE_RESERVA) - nao sao
// bloqueados pela regra. Marcamos com a flag `interno` p/ o front poder ocultar.
const WHITELIST_INTERNOS = new Set([
  0, 1, 9, 10, 20, 30, 40, 90, 100, 200, 300, 400, 401, 402, 403, 404, 450, 460,
  500, 501, 502, 503, 504, 550, 560, 570, 600, 700, 710, 800, 900, 950, 960, 970,
  999, 21574, 21704, 21703
]);

const RX_DATA = /^\d{4}-\d{2}-\d{2}$/;
function dataParam(req) {
  const d = String(req.query.data || '').slice(0, 10);
  if (d && !RX_DATA.test(d)) {
    const e = new Error('parametro data invalido (use YYYY-MM-DD)');
    e.statusCode = 400; throw e;
  }
  return d || new Date().toISOString().slice(0, 10);  // default: hoje
}

export default async function inadimplenciaRoutes(app) {
  const guard = { preHandler: [app.authenticate] };

  // Clientes bloqueados pelo sistema no dia ----------------------------------
  app.get('/inadimplencia/bloqueios', guard, async (req) => {
    const data = dataParam(req);
    const rows = await megaQuery(`
      SELECT TO_CHAR(L.BLO_DT_BLOQUEIO,'HH24:MI:SS')          AS HORA,
             L.BLO_ST_ORIGEM                                  AS ORIGEM,
             L.AGN_IN_CODIGO                                  AS AGN,
             NVL(L.BLO_ST_CLIENTE, G.AGN_ST_NOME)             AS CLIENTE,
             L.BLO_ST_REFERENCIA                              AS REFERENCIA,
             L.BLO_ST_MOTIVO                                  AS MOTIVO,
             L.BLO_ST_TITULOS                                 AS TITULOS
        FROM MEGA.CCS_TB_GFIN_BLOQUEIO_LOG L,
             MEGA.GLO_AGENTES              G
       WHERE L.AGN_IN_CODIGO = G.AGN_IN_CODIGO (+)
         AND TRUNC(L.BLO_DT_BLOQUEIO) = TO_DATE('${data}','YYYY-MM-DD')
       ORDER BY L.BLO_DT_BLOQUEIO DESC`);

    // agrupa por cliente: cada cliente pode ter varias ocorrencias no dia
    const porCliente = new Map();
    for (const r of rows) {
      const agn = Number(r.AGN);
      if (!porCliente.has(agn)) {
        porCliente.set(agn, {
          agn_id:  agn,
          cliente: r.CLIENTE || `Cliente ${agn}`,
          total:   0,
          origens: new Set(),
          motivos: new Set(),
          primeira_hora: r.HORA,
          ultima_hora:   r.HORA,
          ocorrencias:   []
        });
      }
      const c = porCliente.get(agn);
      c.total++;
      c.origens.add(r.ORIGEM);
      c.motivos.add(r.MOTIVO);
      // rows vem DESC: a primeira vista e a ultima do dia, a ultima vista a primeira
      c.primeira_hora = r.HORA;
      c.ocorrencias.push({
        hora:       r.HORA,
        origem:     r.ORIGEM,
        motivo:     r.MOTIVO,
        referencia: r.REFERENCIA || null,
        titulos:    r.TITULOS || null
      });
    }
    const clientes = [...porCliente.values()].map(c => ({
      ...c,
      origens: [...c.origens],
      motivos: [...c.motivos]
    }));

    return {
      data,
      total_eventos:  rows.length,
      total_clientes: clientes.length,
      clientes
    };
  });

  // Desbloqueios (aprovacoes manuais) do dia - auditoria nativa Mega ----------
  app.get('/inadimplencia/desbloqueios', guard, async (req) => {
    const data = dataParam(req);
    const rows = await megaQuery(`
      SELECT TO_CHAR(O.ADO_DT_INCLUSAO,'HH24:MI:SS')          AS HORA,
             O.USU_IN_CODIGO                                  AS USU,
             U.NOME                                           AS USUARIO,
             A.AGN_IN_CODIGO_NEW                              AS AGN,
             G.AGN_ST_NOME                                    AS CLIENTE
        FROM MEGA.A#GLO_AGENTESCMPESP A,
             MEGA.ADT_OCORRENCIA      O,
             MEGA.GLO_AGENTES         G,
             (SELECT USU_IN_CODIGO, MAX(USU_ST_NOME) AS NOME
                FROM MEGA.GLO_LOG_ACESSO GROUP BY USU_IN_CODIGO) U
       WHERE O.ADO_IN_OCORRENCIA = A.ADO_IN_OCORRENCIA
         AND G.AGN_IN_CODIGO (+) = A.AGN_IN_CODIGO_NEW
         AND U.USU_IN_CODIGO (+) = O.USU_IN_CODIGO
         AND NVL(A.AGN_BO_BLOQUEIO_OLD,'N') = 'N'
         AND A.AGN_BO_BLOQUEIO_NEW          = 'S'
         AND TRUNC(O.ADO_DT_INCLUSAO) = TO_DATE('${data}','YYYY-MM-DD')
       ORDER BY O.ADO_DT_INCLUSAO DESC`);

    const itens = rows.map(r => ({
      hora:    r.HORA,
      usu_id:  Number(r.USU),
      usuario: r.USUARIO || `usuario ${r.USU}`,
      agn_id:  Number(r.AGN),
      cliente: r.CLIENTE || `Cliente ${r.AGN}`
    }));
    return { data, total: itens.length, itens };
  });

  // Todos os titulos em atraso (mesmo criterio da regra de bloqueio) ----------
  // "Nao bloqueamos" = clientes que a rotina de bloqueio isenta:
  //   - interno: codigo na whitelist hardcoded da CCS_P_BLOQUEIA_CLIENTE_RESERVA
  //   - grupo isento: cliente em VEN_AGENTESGRUPO cujo grupo de credito tem
  //     VEN_GRUPOCREDITOCMPESP.GCR_ST_NAOBLOQUEIA = 'S' (o vDESCONSIDERA das procs)
  app.get('/inadimplencia/clientes-atraso', guard, async () => {
    const rows = await megaQuery(`
      SELECT C.AGN_IN_CODIGO                                   AS AGN,
             NVL(G.AGN_ST_NOME, G.AGN_ST_FANTASIA)             AS CLIENTE,
             C.FIL_IN_CODIGO                                   AS FIL,
             C.MOV_ST_DOCUMENTO                                AS DOCUMENTO,
             C.MOV_ST_PARCELA                                  AS PARCELA,
             C.TPD_ST_CODIGO                                   AS TPD,
             TO_CHAR(C.MOV_DT_VENCTO,'YYYY-MM-DD')             AS VENCTO,
             TO_CHAR(C.MOV_DT_PRORROGADO,'YYYY-MM-DD')         AS PRORROGADO,
             C.SALDO_EM_ABERTO                                 AS SALDO,
             TRUNC(SYSDATE) - TRUNC(C.MOV_DT_PRORROGADO)       AS DIAS,
             (SELECT MAX('S')
                FROM MEGA.VEN_AGENTESGRUPO        AGR,
                     MEGA.VEN_GRUPOCREDITOCMPESP  GCR
               WHERE AGR.GCR_TAB_IN_CODIGO = GCR.GCR_TAB_IN_CODIGO
                 AND AGR.GCR_PAD_IN_CODIGO = GCR.GCR_PAD_IN_CODIGO
                 AND AGR.GCR_ST_CODIGO     = GCR.GCR_ST_CODIGO
                 AND NVL(GCR.GCR_ST_NAOBLOQUEIA,'N') = 'S'
                 AND AGR.AGN_IN_CODIGO     = C.AGN_IN_CODIGO)   AS GRUPO_ISENTO
        FROM MEGA.FIN_VW_CONTASRECEBER C,
             MEGA.GLO_AGENTES          G
       WHERE C.AGN_IN_CODIGO = G.AGN_IN_CODIGO (+)
         AND C.SALDO_EM_ABERTO   > 0
         AND C.MOV_DT_PRORROGADO < TRUNC(SYSDATE - 2)
         AND C.TPD_ST_CODIGO NOT IN ('PDV')
       ORDER BY C.SALDO_EM_ABERTO DESC`);

    const faixa = d => (d <= 30 ? 'd0_30' : d <= 60 ? 'd31_60' : d <= 90 ? 'd61_90' : 'd90p');
    const titulos = rows.map(r => {
      const agn   = Number(r.AGN);
      const dias  = Number(r.DIAS || 0);
      const saldo = Number(r.SALDO || 0);
      const interno      = WHITELIST_INTERNOS.has(agn);
      const grupoIsento  = r.GRUPO_ISENTO === 'S';
      return {
        agn_id:      agn,
        cliente:     r.CLIENTE || `Cliente ${agn}`,
        fil_id:      Number(r.FIL || 0),
        documento:   r.DOCUMENTO || '',
        parcela:     r.PARCELA || '',
        tipo:        r.TPD || '',
        vencto:      r.VENCTO || null,
        prorrogado:  r.PRORROGADO || null,
        dias_atraso: dias,
        saldo,
        faixa:       faixa(dias),
        interno,
        grupo_isento: grupoIsento,
        // a regra de bloqueio isenta este cliente? (whitelist OU grupo isento)
        isento:       interno || grupoIsento,
        isento_motivo: interno ? 'INTERNO' : grupoIsento ? 'GRUPO' : null
      };
    });

    // KPIs - so os clientes que a regra REALMENTE bloquearia; isentos a parte
    const bloq = titulos.filter(t => !t.isento);
    const soma = arr => arr.reduce((s, t) => s + t.saldo, 0);
    const aging = { d0_30: 0, d31_60: 0, d61_90: 0, d90p: 0 };
    for (const t of bloq) aging[t.faixa] += t.saldo;
    const isentos = titulos.filter(t => t.isento);

    return {
      criterio: 'SALDO_EM_ABERTO > 0 AND MOV_DT_PRORROGADO < SYSDATE-2 AND TPD <> PDV; '
              + 'isenta whitelist interna + grupo de credito com GCR_ST_NAOBLOQUEIA=S',
      kpi: {
        qt_titulos:  bloq.length,
        qt_clientes: new Set(bloq.map(t => t.agn_id)).size,
        vl_total:    soma(bloq),
        vl_90p:      aging.d90p,
        aging,
        // clientes que a regra nao bloqueia, reportados a parte
        qt_titulos_isentos: isentos.length,
        qt_clientes_isentos: new Set(isentos.map(t => t.agn_id)).size,
        vl_isentos:          soma(isentos),
        vl_internos:         soma(titulos.filter(t => t.interno)),
        vl_grupo_isento:     soma(titulos.filter(t => t.grupo_isento && !t.interno))
      },
      titulos
    };
  });
}
