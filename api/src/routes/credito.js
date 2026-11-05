// [14/05/2026 - CRIADO POR ALEXANDRE CARVALHO] Rotas do modulo Inteligencia de
// Credito do Gestor Financeiro CCS - Fase 1.2.
//   GET /credito/carteira          - todos os clientes pontuados (score, classe,
//        saldo, aging) a partir de CCS_TB_GFIN_SCORE + CCS_TB_GFIN_CARTEIRA_SNAP
//   GET /credito/cliente/:agn      - ficha 360: score + componentes + tendencia
//        (serie do snapshot) + estatistica nativa Mega + bloqueios + titulos
//   GET /credito/parametros        - pesos/faixas do score (CCS_TB_GFIN_SCORE_PARAM)
//   PUT /credito/parametros        - grava os parametros (admin)
import { megaQuery, megaExec } from '../soap/mega.js';

// preHandler: bloqueia quem nao for admin
async function adminOnly(req, reply) {
  if (req.user?.perm !== 'A') {
    return reply.code(403).send({ error: 'admin_only',
      message: 'Acesso restrito a administradores.' });
  }
}

const num = v => Number(v || 0);

export default async function creditoRoutes(app) {
  const guard = { preHandler: [app.authenticate] };

  // Carteira pontuada -------------------------------------------------------
  app.get('/credito/carteira', guard, async () => {
    const rows = await megaQuery(`
      SELECT SC.AGN_IN_CODIGO                          AS AGN,
             NVL(G.AGN_ST_NOME, G.AGN_ST_FANTASIA)     AS CLIENTE,
             SC.SCORE, SC.CLASSE, SC.LIMITE_SUGERIDO,
             SC.C_COMPORTAMENTO, SC.C_INADIMPLENCIA, SC.C_TENDENCIA,
             SC.C_EXPOSICAO, SC.C_EXTERNO,
             TO_CHAR(SC.DT_CALCULO,'YYYY-MM-DD HH24:MI') AS DT_CALCULO,
             SN.SALDO_TOTAL, SN.SALDO_VENCIDO, SN.SALDO_AVENCER,
             SN.MAIOR_ATRASO_DIAS, SN.QT_TIT_VENCIDOS, SN.VL_D90P,
             SN.CH_INTERNO, SN.CH_GRUPO_ISENTO
        FROM MEGA.CCS_TB_GFIN_SCORE         SC,
             MEGA.CCS_TB_GFIN_CARTEIRA_SNAP SN,
             MEGA.GLO_AGENTES               G
       WHERE SN.AGN_IN_CODIGO = SC.AGN_IN_CODIGO
         AND SN.SNAP_DT = (SELECT MAX(SNAP_DT) FROM MEGA.CCS_TB_GFIN_CARTEIRA_SNAP)
         AND G.AGN_IN_CODIGO (+) = SC.AGN_IN_CODIGO
       ORDER BY SC.SCORE ASC`);

    const clientes = rows.map(r => ({
      agn_id:  num(r.AGN),
      cliente: r.CLIENTE || `Cliente ${r.AGN}`,
      score:   r.SCORE != null ? num(r.SCORE) : null,
      classe:  r.CLASSE || null,
      limite_sugerido: num(r.LIMITE_SUGERIDO),
      componentes: {
        comportamento: num(r.C_COMPORTAMENTO),
        inadimplencia: num(r.C_INADIMPLENCIA),
        tendencia:     num(r.C_TENDENCIA),
        exposicao:     num(r.C_EXPOSICAO),
        externo:       num(r.C_EXTERNO)
      },
      saldo_total:   num(r.SALDO_TOTAL),
      saldo_vencido: num(r.SALDO_VENCIDO),
      saldo_avencer: num(r.SALDO_AVENCER),
      maior_atraso_dias: num(r.MAIOR_ATRASO_DIAS),
      qt_tit_vencidos:   num(r.QT_TIT_VENCIDOS),
      vl_90p:        num(r.VL_D90P),
      interno:       r.CH_INTERNO === 'S',
      grupo_isento:  r.CH_GRUPO_ISENTO === 'S',
      isento:        r.CH_INTERNO === 'S' || r.CH_GRUPO_ISENTO === 'S',
      dt_calculo:    r.DT_CALCULO || null
    }));

    // KPIs - so clientes que a regra de bloqueio realmente pega
    const bloq = clientes.filter(c => !c.isento);
    const porClasse = {};
    for (const c of bloq) {
      const k = c.classe || '?';
      porClasse[k] = porClasse[k] || { qt: 0, vl_vencido: 0 };
      porClasse[k].qt++;
      porClasse[k].vl_vencido += c.saldo_vencido;
    }
    return {
      total: clientes.length,
      kpi: {
        qt_clientes:  bloq.length,
        vl_vencido:   bloq.reduce((s, c) => s + c.saldo_vencido, 0),
        score_medio:  bloq.length ? Math.round(bloq.reduce((s, c) => s + (c.score || 0), 0) / bloq.length) : 0,
        por_classe:   porClasse
      },
      clientes
    };
  });

  // Ficha 360 do cliente ----------------------------------------------------
  app.get('/credito/cliente/:agn', guard, async (req) => {
    const agn = parseInt(req.params.agn, 10);
    if (!agn) { const e = new Error('agn invalido'); e.statusCode = 400; throw e; }

    const [score, snap, serie, estat, bloq, titulos] = await Promise.all([
      megaQuery(`
        SELECT SC.AGN_IN_CODIGO AS AGN, NVL(G.AGN_ST_NOME,G.AGN_ST_FANTASIA) AS CLIENTE,
               SC.SCORE, SC.CLASSE, SC.LIMITE_SUGERIDO,
               SC.C_COMPORTAMENTO, SC.C_INADIMPLENCIA, SC.C_TENDENCIA,
               SC.C_EXPOSICAO, SC.C_EXTERNO,
               TO_CHAR(SC.DT_CALCULO,'YYYY-MM-DD HH24:MI') AS DT_CALCULO
          FROM MEGA.CCS_TB_GFIN_SCORE SC, MEGA.GLO_AGENTES G
         WHERE SC.AGN_IN_CODIGO = ${agn}
           AND G.AGN_IN_CODIGO (+) = SC.AGN_IN_CODIGO`),
      // [09/07/2026 - Alexandre Carvalho] Carteira atual calculada AO VIVO (mesma fonte/filtros
      // da lista de titulos), em vez do snapshot 00:00 — baixas intradiarias divergiam da lista.
      // O snapshot segue sendo usado na tendencia e no score; flags vem do ultimo snapshot.
      megaQuery(`
        SELECT A.*, F.CH_INTERNO, F.CH_GRUPO_ISENTO
          FROM (SELECT NVL(SUM(C.SALDO_EM_ABERTO),0) AS SALDO_TOTAL,
                       NVL(SUM(CASE WHEN C.MOV_DT_PRORROGADO < TRUNC(SYSDATE) THEN C.SALDO_EM_ABERTO ELSE 0 END),0) AS SALDO_VENCIDO,
                       NVL(SUM(CASE WHEN C.MOV_DT_PRORROGADO >= TRUNC(SYSDATE) THEN C.SALDO_EM_ABERTO ELSE 0 END),0) AS SALDO_AVENCER,
                       COUNT(*) AS QT_TIT_TOTAL,
                       NVL(SUM(CASE WHEN C.MOV_DT_PRORROGADO < TRUNC(SYSDATE) THEN 1 ELSE 0 END),0) AS QT_TIT_VENCIDOS,
                       NVL(MAX(CASE WHEN C.MOV_DT_PRORROGADO < TRUNC(SYSDATE)
                                    THEN TRUNC(SYSDATE) - TRUNC(C.MOV_DT_PRORROGADO) END),0) AS MAIOR_ATRASO_DIAS,
                       NVL(SUM(CASE WHEN C.MOV_DT_PRORROGADO < TRUNC(SYSDATE)
                                     AND TRUNC(SYSDATE) - TRUNC(C.MOV_DT_PRORROGADO) <= 30
                                    THEN C.SALDO_EM_ABERTO ELSE 0 END),0) AS VL_D1_30,
                       NVL(SUM(CASE WHEN TRUNC(SYSDATE) - TRUNC(C.MOV_DT_PRORROGADO) BETWEEN 31 AND 60
                                    THEN C.SALDO_EM_ABERTO ELSE 0 END),0) AS VL_D31_60,
                       NVL(SUM(CASE WHEN TRUNC(SYSDATE) - TRUNC(C.MOV_DT_PRORROGADO) BETWEEN 61 AND 90
                                    THEN C.SALDO_EM_ABERTO ELSE 0 END),0) AS VL_D61_90,
                       NVL(SUM(CASE WHEN TRUNC(SYSDATE) - TRUNC(C.MOV_DT_PRORROGADO) > 90
                                    THEN C.SALDO_EM_ABERTO ELSE 0 END),0) AS VL_D90P,
                       NVL(SUM(CASE WHEN C.MOV_DT_PRORROGADO >= TRUNC(SYSDATE)
                                     AND C.MOV_DT_PRORROGADO < TRUNC(SYSDATE) + 30
                                    THEN C.SALDO_EM_ABERTO ELSE 0 END),0) AS VL_AVENCER_30
                  FROM MEGA.FIN_VW_CONTASRECEBER C
                 WHERE C.AGN_IN_CODIGO = ${agn}
                   AND C.SALDO_EM_ABERTO > 0
                   AND C.TPD_ST_CODIGO NOT IN ('PDV')) A,
               (SELECT MAX(S.CH_INTERNO) AS CH_INTERNO, MAX(S.CH_GRUPO_ISENTO) AS CH_GRUPO_ISENTO
                  FROM MEGA.CCS_TB_GFIN_CARTEIRA_SNAP S
                 WHERE S.AGN_IN_CODIGO = ${agn}
                   AND S.SNAP_DT = (SELECT MAX(SNAP_DT) FROM MEGA.CCS_TB_GFIN_CARTEIRA_SNAP)) F`),
      megaQuery(`
        SELECT TO_CHAR(SNAP_DT,'YYYY-MM-DD') AS DT, SALDO_TOTAL, SALDO_VENCIDO, SCORE
          FROM MEGA.CCS_TB_GFIN_CARTEIRA_SNAP
         WHERE AGN_IN_CODIGO = ${agn}
           AND SNAP_DT >= TRUNC(SYSDATE) - 90
         ORDER BY SNAP_DT`),
      megaQuery(`
        SELECT ATE_ST_CODIGO, EST_ST_VALOR, EST_RE_VRNUM,
               TO_CHAR(EST_DT_VRDATA,'YYYY-MM-DD') AS VRDATA,
               TO_CHAR(EST_DT_ATUALIZACAO,'YYYY-MM-DD') AS ATUALIZ
          FROM MEGA.GLO_ESTATISTICAAGN
         WHERE AGN_IN_CODIGO = ${agn}`),
      megaQuery(`
        SELECT TO_CHAR(BLO_DT_BLOQUEIO,'YYYY-MM-DD HH24:MI') AS DT,
               BLO_ST_ORIGEM, BLO_ST_MOTIVO, BLO_ST_REFERENCIA
          FROM MEGA.CCS_TB_GFIN_BLOQUEIO_LOG
         WHERE AGN_IN_CODIGO = ${agn}
         ORDER BY BLO_DT_BLOQUEIO DESC`),
      megaQuery(`
        SELECT C.MOV_ST_DOCUMENTO AS DOC, C.MOV_ST_PARCELA AS PARC, C.TPD_ST_CODIGO AS TPD,
               C.FIL_IN_CODIGO AS FIL,
               TO_CHAR(C.MOV_DT_PRORROGADO,'YYYY-MM-DD') AS PRORROGADO,
               C.SALDO_EM_ABERTO AS SALDO,
               TRUNC(SYSDATE) - TRUNC(C.MOV_DT_PRORROGADO) AS DIAS,
               -- [09/07/2026 - ALEXANDRE CARVALHO] FORMA DE RECEBIMENTO (HCOB) DO TITULO
               SUBSTR(NVL(C.HCOB_ST_DESCRICAO,''), 1, 60) AS FORMA_RECEB
          FROM MEGA.FIN_VW_CONTASRECEBER C
         WHERE C.AGN_IN_CODIGO = ${agn}
           AND C.SALDO_EM_ABERTO > 0
           AND C.TPD_ST_CODIGO NOT IN ('PDV')
         ORDER BY C.MOV_DT_PRORROGADO`)
    ]);

    if (!score.length) { const e = new Error('cliente sem score'); e.statusCode = 404; throw e; }
    const s = score[0];
    const sn = snap[0] || {};
    // estatistica nativa Mega -> mapa codigo->{valor,num,data}
    const est = {};
    for (const r of estat) est[r.ATE_ST_CODIGO] = {
      valor: r.EST_ST_VALOR, num: num(r.EST_RE_VRNUM), data: r.VRDATA || null, atualizado: r.ATUALIZ || null
    };

    return {
      agn_id:  agn,
      cliente: s.CLIENTE || `Cliente ${agn}`,
      score:   s.SCORE != null ? num(s.SCORE) : null,
      classe:  s.CLASSE || null,
      limite_sugerido: num(s.LIMITE_SUGERIDO),
      dt_calculo: s.DT_CALCULO || null,
      componentes: {
        comportamento: num(s.C_COMPORTAMENTO),
        inadimplencia: num(s.C_INADIMPLENCIA),
        tendencia:     num(s.C_TENDENCIA),
        exposicao:     num(s.C_EXPOSICAO),
        externo:       num(s.C_EXTERNO)
      },
      carteira: {
        saldo_total:   num(sn.SALDO_TOTAL),
        saldo_vencido: num(sn.SALDO_VENCIDO),
        saldo_avencer: num(sn.SALDO_AVENCER),
        qt_tit_total:  num(sn.QT_TIT_TOTAL),
        qt_tit_vencidos: num(sn.QT_TIT_VENCIDOS),
        maior_atraso_dias: num(sn.MAIOR_ATRASO_DIAS),
        aging: { d1_30: num(sn.VL_D1_30), d31_60: num(sn.VL_D31_60),
                 d61_90: num(sn.VL_D61_90), d90p: num(sn.VL_D90P) },
        avencer_30: num(sn.VL_AVENCER_30),
        interno:      sn.CH_INTERNO === 'S',
        grupo_isento: sn.CH_GRUPO_ISENTO === 'S'
      },
      // estatistica nativa do Mega (perfil de credito)
      estatistica: {
        atraso_medio:        est.DIASATRASOMED?.num ?? null,
        maior_atraso_dias:   est.NDIASMAIATRASO?.num ?? null,
        total_dias_atraso:   est.TOTDIASATRASO?.num ?? null,
        parcelas_com_atraso: est.NPARCELAATRASO?.num ?? null,
        maior_acumulo:       est.MAIACUMULO?.num ?? null,
        maior_acumulo_data:  est.DTMAIACUMULO?.data ?? null,
        valor_cartorio:      est.VALORCARTORIO?.num ?? null,
        cheques_devolvidos:  est.CHEQUEDEVOLVIDO?.num ?? null,
        cheques_abertos:     est.CHEQUEABERTO?.num ?? null,
        primeira_compra:     est.PRIDTCOMPRA?.data ?? null,
        ultima_compra:       est.ULTDTCOMPRA?.data ?? null,
        maior_compra:        est.MAICOMPRA?.num ?? null,
        dias_inativo:        est.DIASINAT?.num ?? null,
        atualizado_em:       est.DIASATRASOMED?.atualizado ?? null
      },
      tendencia: serie.map(r => ({
        data: r.DT, saldo_total: num(r.SALDO_TOTAL),
        saldo_vencido: num(r.SALDO_VENCIDO), score: r.SCORE != null ? num(r.SCORE) : null
      })),
      bloqueios: {
        total: bloq.length,
        ultimos: bloq.slice(0, 10).map(r => ({
          data: r.DT, origem: r.BLO_ST_ORIGEM, motivo: r.BLO_ST_MOTIVO,
          referencia: r.BLO_ST_REFERENCIA || null
        }))
      },
      titulos: titulos.map(r => ({
        documento: r.DOC, parcela: r.PARC, tipo: r.TPD, fil_id: num(r.FIL),
        prorrogado: r.PRORROGADO, saldo: num(r.SALDO), dias_atraso: num(r.DIAS),
        forma_receb: r.FORMA_RECEB || ''
      }))
    };
  });

  // Parametros do score -----------------------------------------------------
  app.get('/credito/parametros', { preHandler: [app.authenticate, adminOnly] }, async () => {
    const rows = await megaQuery(`
      SELECT PARAM_ST_CHAVE, PARAM_RE_VALOR, PARAM_ST_DESCRICAO
        FROM MEGA.CCS_TB_GFIN_SCORE_PARAM ORDER BY PARAM_ST_CHAVE`);
    return rows.map(r => ({
      chave: r.PARAM_ST_CHAVE, valor: Number(r.PARAM_RE_VALOR),
      descricao: r.PARAM_ST_DESCRICAO || ''
    }));
  });

  app.put('/credito/parametros', {
    preHandler: [app.authenticate, adminOnly],
    schema: {
      body: {
        type: 'object', required: ['parametros'],
        properties: {
          parametros: {
            type: 'array',
            items: {
              type: 'object', required: ['chave', 'valor'],
              properties: { chave: { type: 'string' }, valor: { type: 'number' } }
            }
          }
        }
      }
    }
  }, async (req) => {
    // so atualiza chaves que ja existem (nao cria parametro novo pela API)
    const cat = await megaQuery(`SELECT PARAM_ST_CHAVE FROM MEGA.CCS_TB_GFIN_SCORE_PARAM`);
    const validas = new Set(cat.map(r => r.PARAM_ST_CHAVE));
    const ups = req.body.parametros
      .filter(p => validas.has(p.chave))
      .map(p => `  UPDATE MEGA.CCS_TB_GFIN_SCORE_PARAM SET PARAM_RE_VALOR = ${Number(p.valor)} ` +
                `WHERE PARAM_ST_CHAVE = '${String(p.chave).replace(/'/g, "''")}';`);
    if (ups.length) await megaExec(`BEGIN\n${ups.join('\n')}\n  COMMIT;\nEND;`);
    return { ok: true, atualizados: ups.length };
  });

  // Cliente aleatorio que atende criterios, para o exemplo da tela de Ajuda -----
  // (externo, score 200-800, com inadimplencia real e estatistica) + os dados
  // brutos e os parametros vigentes, para a Ajuda montar o passo a passo.
  app.get('/credito/exemplo', guard, async () => {
    const rows = await megaQuery(`
      SELECT * FROM (
        SELECT SC.AGN_IN_CODIGO AS AGN, NVL(G.AGN_ST_NOME, G.AGN_ST_FANTASIA) AS CLIENTE,
               SC.SCORE, SC.CLASSE, SC.LIMITE_SUGERIDO,
               SC.C_COMPORTAMENTO AS CC, SC.C_INADIMPLENCIA AS CI, SC.C_TENDENCIA AS CT,
               SC.C_EXPOSICAO AS CE, SC.C_EXTERNO AS CX,
               SN.SALDO_TOTAL, SN.SALDO_VENCIDO, SN.QT_TIT_TOTAL, SN.QT_TIT_VENCIDOS,
               SN.MAIOR_ATRASO_DIAS,
               E.DIASATRASOMED, E.NDIASMAIATRASO, E.VALORCARTORIO, E.CHEQUEDEVOLVIDO, E.MAIACUMULO,
               S30.SALDO_VENCIDO AS VENC_30,
               B.QT AS QT_BLOQUEIOS
          FROM MEGA.CCS_TB_GFIN_SCORE          SC,
               MEGA.CCS_TB_GFIN_CARTEIRA_SNAP  SN,
               MEGA.GLO_AGENTES                G,
               (SELECT AGN_IN_CODIGO,
                       MAX(CASE WHEN ATE_ST_CODIGO='DIASATRASOMED'   THEN EST_RE_VRNUM END) DIASATRASOMED,
                       MAX(CASE WHEN ATE_ST_CODIGO='NDIASMAIATRASO'  THEN EST_RE_VRNUM END) NDIASMAIATRASO,
                       MAX(CASE WHEN ATE_ST_CODIGO='VALORCARTORIO'   THEN EST_RE_VRNUM END) VALORCARTORIO,
                       MAX(CASE WHEN ATE_ST_CODIGO='CHEQUEDEVOLVIDO' THEN EST_RE_VRNUM END) CHEQUEDEVOLVIDO,
                       MAX(CASE WHEN ATE_ST_CODIGO='MAIACUMULO'      THEN EST_RE_VRNUM END) MAIACUMULO
                  FROM MEGA.GLO_ESTATISTICAAGN GROUP BY AGN_IN_CODIGO) E,
               -- snapshot de 30 dias atras ja pre-filtrado (coluna com (+) nao pode
               -- comparar com subquery - ORA-01799 - entao o filtro vai aqui dentro)
               (SELECT AGN_IN_CODIGO, SALDO_VENCIDO
                  FROM MEGA.CCS_TB_GFIN_CARTEIRA_SNAP
                 WHERE SNAP_DT = (SELECT MAX(SNAP_DT) - 30 FROM MEGA.CCS_TB_GFIN_CARTEIRA_SNAP)) S30,
               (SELECT AGN_IN_CODIGO, COUNT(*) QT FROM MEGA.CCS_TB_GFIN_BLOQUEIO_LOG
                 WHERE BLO_ST_MOTIVO = 'FINANCEIRO' GROUP BY AGN_IN_CODIGO) B
         WHERE SN.AGN_IN_CODIGO = SC.AGN_IN_CODIGO
           AND SN.SNAP_DT = (SELECT MAX(SNAP_DT) FROM MEGA.CCS_TB_GFIN_CARTEIRA_SNAP)
           AND G.AGN_IN_CODIGO   (+) = SC.AGN_IN_CODIGO
           AND E.AGN_IN_CODIGO   (+) = SC.AGN_IN_CODIGO
           AND S30.AGN_IN_CODIGO (+) = SC.AGN_IN_CODIGO
           AND B.AGN_IN_CODIGO   (+) = SC.AGN_IN_CODIGO
           AND SN.CH_INTERNO = 'N' AND SN.CH_GRUPO_ISENTO = 'N'
           AND SC.SCORE BETWEEN 200 AND 800
           AND SC.C_INADIMPLENCIA BETWEEN 0.02 AND 0.95
           AND E.DIASATRASOMED IS NOT NULL
         ORDER BY DBMS_RANDOM.VALUE
      ) WHERE ROWNUM = 1`);

    if (!rows.length) return { disponivel: false };
    const r = rows[0];

    const par = await megaQuery(
      `SELECT PARAM_ST_CHAVE, PARAM_RE_VALOR FROM MEGA.CCS_TB_GFIN_SCORE_PARAM`);
    const parametros = {};
    for (const p of par) parametros[p.PARAM_ST_CHAVE] = Number(p.PARAM_RE_VALOR);

    return {
      disponivel: true,
      cliente: {
        agn_id:  num(r.AGN),
        nome:    r.CLIENTE || `Cliente ${r.AGN}`,
        score:   num(r.SCORE),
        classe:  r.CLASSE,
        limite_sugerido: num(r.LIMITE_SUGERIDO),
        componentes: {
          comportamento: num(r.CC), inadimplencia: num(r.CI), tendencia: num(r.CT),
          exposicao: num(r.CE), externo: num(r.CX)
        }
      },
      dados: {
        saldo_total:        num(r.SALDO_TOTAL),
        saldo_vencido:      num(r.SALDO_VENCIDO),
        qt_tit_total:       num(r.QT_TIT_TOTAL),
        qt_tit_vencidos:    num(r.QT_TIT_VENCIDOS),
        maior_atraso_dias:  num(r.MAIOR_ATRASO_DIAS),
        atraso_medio:       num(r.DIASATRASOMED),
        pior_atraso:        num(r.NDIASMAIATRASO),
        valor_cartorio:     num(r.VALORCARTORIO),
        cheques_devolvidos: num(r.CHEQUEDEVOLVIDO),
        maior_acumulo:      num(r.MAIACUMULO),
        venc_30:            r.VENC_30 != null ? num(r.VENC_30) : null,
        qt_bloqueios:       num(r.QT_BLOQUEIOS)
      },
      parametros
    };
  });

  // Painel Executivo: visao consolidada da carteira de credito --------------
  // KPIs, aging, distribuicao por classe, evolucao (serie do snapshot),
  // forecast de recebimento e a analise por filial. Sempre sobre os clientes
  // que a regra de bloqueio pega (externos: nao interno, nao grupo isento).
  app.get('/credito/painel', guard, async () => {
    // base do snapshot de hoje, so clientes externos
    const SNAP_HOJE = `S.SNAP_DT = (SELECT MAX(SNAP_DT) FROM MEGA.CCS_TB_GFIN_CARTEIRA_SNAP)
                       AND S.CH_INTERNO = 'N' AND S.CH_GRUPO_ISENTO = 'N'`;

    const [kpiR, classeR, evolR, fcR, filialR, topR] = await Promise.all([
      // KPIs + aging consolidado
      megaQuery(`
        SELECT COUNT(*)                       AS QT_CLIENTES,
               SUM(S.SALDO_TOTAL)             AS VL_CARTEIRA,
               SUM(S.SALDO_VENCIDO)           AS VL_VENCIDO,
               SUM(S.SALDO_AVENCER)           AS VL_AVENCER,
               SUM(S.VL_D1_30)                AS D1_30,
               SUM(S.VL_D31_60)               AS D31_60,
               SUM(S.VL_D61_90)               AS D61_90,
               SUM(S.VL_D90P)                 AS D90P,
               ROUND(AVG(SC.SCORE))           AS SCORE_MEDIO,
               SUM(CASE WHEN S.SALDO_VENCIDO > 0 THEN 1 ELSE 0 END) AS QT_INADIMPLENTES
          FROM MEGA.CCS_TB_GFIN_CARTEIRA_SNAP S, MEGA.CCS_TB_GFIN_SCORE SC
         WHERE SC.AGN_IN_CODIGO (+) = S.AGN_IN_CODIGO AND ${SNAP_HOJE}`),
      // distribuicao por classe
      megaQuery(`
        SELECT NVL(SC.CLASSE,'?') AS CLASSE, COUNT(*) AS QT,
               SUM(S.SALDO_VENCIDO) AS VL_VENCIDO, SUM(S.SALDO_TOTAL) AS VL_TOTAL
          FROM MEGA.CCS_TB_GFIN_CARTEIRA_SNAP S, MEGA.CCS_TB_GFIN_SCORE SC
         WHERE SC.AGN_IN_CODIGO (+) = S.AGN_IN_CODIGO AND ${SNAP_HOJE}
         GROUP BY NVL(SC.CLASSE,'?')`),
      // evolucao - serie diaria do snapshot (ate 90 dias)
      megaQuery(`
        SELECT TO_CHAR(SNAP_DT,'YYYY-MM-DD') AS DT,
               SUM(SALDO_TOTAL) AS VL_TOTAL, SUM(SALDO_VENCIDO) AS VL_VENCIDO,
               ROUND(AVG(SCORE)) AS SCORE_MEDIO
          FROM MEGA.CCS_TB_GFIN_CARTEIRA_SNAP
         WHERE SNAP_DT >= TRUNC(SYSDATE) - 90
           AND CH_INTERNO = 'N' AND CH_GRUPO_ISENTO = 'N'
         GROUP BY SNAP_DT ORDER BY SNAP_DT`),
      // forecast de recebimento (a vencer) + prazo medio de atraso ponderado
      megaQuery(`
        SELECT
          SUM(CASE WHEN C.MOV_DT_PRORROGADO >= TRUNC(SYSDATE)
                    AND C.MOV_DT_PRORROGADO <  TRUNC(SYSDATE)+30  THEN C.SALDO_EM_ABERTO ELSE 0 END) AS J30,
          SUM(CASE WHEN C.MOV_DT_PRORROGADO >= TRUNC(SYSDATE)+30
                    AND C.MOV_DT_PRORROGADO <  TRUNC(SYSDATE)+60  THEN C.SALDO_EM_ABERTO ELSE 0 END) AS J60,
          SUM(CASE WHEN C.MOV_DT_PRORROGADO >= TRUNC(SYSDATE)+60
                    AND C.MOV_DT_PRORROGADO <  TRUNC(SYSDATE)+90  THEN C.SALDO_EM_ABERTO ELSE 0 END) AS J90,
          SUM(CASE WHEN C.MOV_DT_PRORROGADO < TRUNC(SYSDATE)
                   THEN C.SALDO_EM_ABERTO * (TRUNC(SYSDATE) - TRUNC(C.MOV_DT_PRORROGADO)) ELSE 0 END) AS SOMA_PESO,
          SUM(CASE WHEN C.MOV_DT_PRORROGADO < TRUNC(SYSDATE)
                   THEN C.SALDO_EM_ABERTO ELSE 0 END) AS SOMA_VENC
          FROM MEGA.FIN_VW_CONTASRECEBER C,
               (SELECT AGN_IN_CODIGO, CH_INTERNO, CH_GRUPO_ISENTO
                  FROM MEGA.CCS_TB_GFIN_CARTEIRA_SNAP
                 WHERE SNAP_DT = (SELECT MAX(SNAP_DT) FROM MEGA.CCS_TB_GFIN_CARTEIRA_SNAP)) X
         WHERE X.AGN_IN_CODIGO (+) = C.AGN_IN_CODIGO
           AND C.SALDO_EM_ABERTO > 0 AND C.TPD_ST_CODIGO NOT IN ('PDV')
           AND NVL(X.CH_INTERNO,'N') = 'N' AND NVL(X.CH_GRUPO_ISENTO,'N') = 'N'`),
      // analise por filial
      megaQuery(`
        SELECT C.FIL_IN_CODIGO AS FIL,
               COUNT(DISTINCT C.AGN_IN_CODIGO) AS QT_CLIENTES,
               SUM(C.SALDO_EM_ABERTO) AS VL_CARTEIRA,
               SUM(CASE WHEN C.MOV_DT_PRORROGADO < TRUNC(SYSDATE) THEN C.SALDO_EM_ABERTO ELSE 0 END) AS VL_VENCIDO,
               COUNT(DISTINCT CASE WHEN C.MOV_DT_PRORROGADO < TRUNC(SYSDATE) THEN C.AGN_IN_CODIGO END) AS QT_INADIMPLENTES,
               SUM(CASE WHEN C.MOV_DT_PRORROGADO < TRUNC(SYSDATE)
                         AND TRUNC(SYSDATE)-TRUNC(C.MOV_DT_PRORROGADO) <= 30  THEN C.SALDO_EM_ABERTO ELSE 0 END) AS D1_30,
               SUM(CASE WHEN TRUNC(SYSDATE)-TRUNC(C.MOV_DT_PRORROGADO) BETWEEN 31 AND 60 THEN C.SALDO_EM_ABERTO ELSE 0 END) AS D31_60,
               SUM(CASE WHEN TRUNC(SYSDATE)-TRUNC(C.MOV_DT_PRORROGADO) BETWEEN 61 AND 90 THEN C.SALDO_EM_ABERTO ELSE 0 END) AS D61_90,
               SUM(CASE WHEN TRUNC(SYSDATE)-TRUNC(C.MOV_DT_PRORROGADO) > 90 THEN C.SALDO_EM_ABERTO ELSE 0 END) AS D90P
          FROM MEGA.FIN_VW_CONTASRECEBER C,
               (SELECT AGN_IN_CODIGO, CH_INTERNO, CH_GRUPO_ISENTO
                  FROM MEGA.CCS_TB_GFIN_CARTEIRA_SNAP
                 WHERE SNAP_DT = (SELECT MAX(SNAP_DT) FROM MEGA.CCS_TB_GFIN_CARTEIRA_SNAP)) X
         WHERE X.AGN_IN_CODIGO (+) = C.AGN_IN_CODIGO
           AND C.SALDO_EM_ABERTO > 0 AND C.TPD_ST_CODIGO NOT IN ('PDV')
           AND NVL(X.CH_INTERNO,'N') = 'N' AND NVL(X.CH_GRUPO_ISENTO,'N') = 'N'
         GROUP BY C.FIL_IN_CODIGO ORDER BY VL_VENCIDO DESC`),
      // top 10 devedores
      megaQuery(`
        SELECT * FROM (
          SELECT S.AGN_IN_CODIGO AS AGN, NVL(G.AGN_ST_NOME,G.AGN_ST_FANTASIA) AS CLIENTE,
                 S.SALDO_VENCIDO, S.MAIOR_ATRASO_DIAS, SC.SCORE, SC.CLASSE
            FROM MEGA.CCS_TB_GFIN_CARTEIRA_SNAP S, MEGA.CCS_TB_GFIN_SCORE SC, MEGA.GLO_AGENTES G
           WHERE SC.AGN_IN_CODIGO (+) = S.AGN_IN_CODIGO
             AND G.AGN_IN_CODIGO  (+) = S.AGN_IN_CODIGO
             AND ${SNAP_HOJE} AND S.SALDO_VENCIDO > 0
           ORDER BY S.SALDO_VENCIDO DESC
        ) WHERE ROWNUM <= 10`)
    ]);

    const k = kpiR[0] || {};
    const vlCarteira = num(k.VL_CARTEIRA), vlVencido = num(k.VL_VENCIDO);
    const fc = fcR[0] || {};
    const somaVenc = num(fc.SOMA_VENC);

    const porClasse = {};
    for (const r of classeR) porClasse[r.CLASSE] = {
      qt: num(r.QT), vl_vencido: num(r.VL_VENCIDO), vl_total: num(r.VL_TOTAL)
    };

    return {
      kpi: {
        qt_clientes:       num(k.QT_CLIENTES),
        qt_inadimplentes:  num(k.QT_INADIMPLENTES),
        vl_carteira:       vlCarteira,
        vl_vencido:        vlVencido,
        vl_avencer:        num(k.VL_AVENCER),
        pct_inadimplencia: vlCarteira > 0 ? Math.round(vlVencido / vlCarteira * 1000) / 10 : 0,
        score_medio:       num(k.SCORE_MEDIO),
        prazo_medio_atraso: somaVenc > 0 ? Math.round(num(fc.SOMA_PESO) / somaVenc) : 0
      },
      aging: { d1_30: num(k.D1_30), d31_60: num(k.D31_60), d61_90: num(k.D61_90), d90p: num(k.D90P) },
      por_classe: porClasse,
      evolucao: evolR.map(r => ({
        data: r.DT, vl_total: num(r.VL_TOTAL), vl_vencido: num(r.VL_VENCIDO),
        score_medio: num(r.SCORE_MEDIO),
        pct_inadimplencia: num(r.VL_TOTAL) > 0 ? Math.round(num(r.VL_VENCIDO) / num(r.VL_TOTAL) * 1000) / 10 : 0
      })),
      forecast: { j30: num(fc.J30), j60: num(fc.J60), j90: num(fc.J90) },
      por_filial: filialR.map(r => {
        const cart = num(r.VL_CARTEIRA), venc = num(r.VL_VENCIDO);
        return {
          fil_id:           num(r.FIL),
          qt_clientes:      num(r.QT_CLIENTES),
          qt_inadimplentes: num(r.QT_INADIMPLENTES),
          vl_carteira:      cart,
          vl_vencido:       venc,
          pct_inadimplencia: cart > 0 ? Math.round(venc / cart * 1000) / 10 : 0,
          aging: { d1_30: num(r.D1_30), d31_60: num(r.D31_60), d61_90: num(r.D61_90), d90p: num(r.D90P) }
        };
      }),
      top_devedores: topR.map(r => ({
        agn_id: num(r.AGN), cliente: r.CLIENTE || `Cliente ${r.AGN}`,
        vl_vencido: num(r.SALDO_VENCIDO), maior_atraso: num(r.MAIOR_ATRASO_DIAS),
        score: r.SCORE != null ? num(r.SCORE) : null, classe: r.CLASSE || null
      }))
    };
  });
}
