// [06/08/2026 - CRIADO POR ALEXANDRE CARVALHO] Rotas do modulo Liberacao de
// Agentes do Gestor Financeiro CCS.
//
// A liberacao manual do bloqueio por atraso (flag AGN_BO_BLOQUEIO da side-table
// de campos especificos do agente) era feita direto no cadastro do agente no
// Mega XT. Passa a ser feita por aqui, com log de quem liberou/revogou
// (CCS_TB_GFIN_LIBERA_AGN_LOG). O MOTOR NAO MUDA: as rotinas de bloqueio da
// reserva/romaneio e do faturamento continuam lendo a mesma flag, e o job das
// 03:00 continua zerando as liberacoes todo dia (liberacao vale o dia inteiro).
//
//   GET  /liberacao-agentes/liberados        - agentes com liberacao ativa hoje
//   GET  /liberacao-agentes/busca?q=         - busca agente por codigo ou nome
//   POST /liberacao-agentes/liberar          - { agn, motivo } -> flag 'S' + log
//   POST /liberacao-agentes/revogar          - { agn, motivo } -> flag 'N' + log
//   GET  /liberacao-agentes/historico?dias=  - log de liberacoes/revogacoes
import { megaQuery, megaExec } from '../soap/mega.js';

const num = v => Number(v || 0);
// sanitiza texto que entra em literal SQL (dobra aspas, corta tamanho)
const lit = (s, max) => String(s ?? '').slice(0, max).replace(/'/g, "''");
// mensagem amigavel de RAISE_APPLICATION_ERROR (-209xx) sem o prefixo ORA
const oraMsg = e => {
  const m = String(e?.message || e).match(/ORA-209\d\d:\s*([^\n]+)/);
  return m ? m[1].replace(/\s*ORA-\d+.*$/, '').trim() : null;
};

// filtro padrao de titulo em atraso qualificado (mesmo criterio do motor de
// bloqueio: saldo aberto, 2+ dias de atraso, previstos fora)
const ATRASO = `
       R.SALDO_EM_ABERTO > 0
   AND R.MOV_DT_PRORROGADO < TRUNC(SYSDATE - 1)
   AND R.TPD_ST_CODIGO NOT IN ('PDV')`;

export default async function liberacaoAgentesRoutes(app) {
  const guard = { preHandler: [app.authenticate] };

  // Agentes com liberacao ativa (flag 'S' agora) + quem liberou (ultimo log 'S')
  app.get('/liberacao-agentes/liberados', guard, async () => {
    const rows = await megaQuery(`
      SELECT C.AGN_IN_CODIGO                              AS AGN,
             (SELECT MAX(NVL(G.AGN_ST_NOME, G.AGN_ST_FANTASIA))
                FROM MEGA.GLO_AGENTES G
               WHERE G.AGN_IN_CODIGO = C.AGN_IN_CODIGO)   AS NOME
        FROM MEGA.GLO_AGENTESCMPESP C
       WHERE C.AGN_BO_BLOQUEIO = 'S'
       ORDER BY C.AGN_IN_CODIGO`);
    if (rows.length === 0) return { liberados: [] };

    const logs = await megaQuery(`
      SELECT L.AGN_IN_CODIGO                              AS AGN,
             L.LOG_ST_USU                                 AS USU,
             L.LOG_ST_MOTIVO                              AS MOTIVO,
             TO_CHAR(L.LOG_DT_DATA, 'YYYY-MM-DD HH24:MI') AS DT
        FROM MEGA.CCS_TB_GFIN_LIBERA_AGN_LOG L
       WHERE L.LOG_CH_PARA = 'S'
         AND L.LOG_IN_CODIGO = (SELECT MAX(L2.LOG_IN_CODIGO)
                                  FROM MEGA.CCS_TB_GFIN_LIBERA_AGN_LOG L2
                                 WHERE L2.AGN_IN_CODIGO = L.AGN_IN_CODIGO
                                   AND L2.LOG_CH_PARA = 'S')`);
    const byAgn = Object.fromEntries(logs.map(l => [num(l.AGN), l]));

    return {
      liberados: rows.map(r => {
        const l = byAgn[num(r.AGN)];
        return {
          agn:          num(r.AGN),
          nome:         r.NOME || `Agente ${r.AGN}`,
          liberado_por: l?.USU || '',       // vazio = liberado fora do portal
          liberado_em:  l?.DT || '',
          motivo:       l?.MOTIVO || ''
        };
      })
    };
  });

  // Busca de agente por codigo exato ou trecho do nome/fantasia
  app.get('/liberacao-agentes/busca', guard, async (req) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return { agentes: [] };
    const cond = /^\d+$/.test(q)
      ? `G.AGN_IN_CODIGO = ${num(q)}`
      : `(UPPER(G.AGN_ST_NOME) LIKE '%${lit(q.toUpperCase(), 60)}%'
          OR UPPER(G.AGN_ST_FANTASIA) LIKE '%${lit(q.toUpperCase(), 60)}%')`;

    const rows = await megaQuery(`
      SELECT A.AGN, A.NOME, A.LIBERADO, NVL(R.QT, 0) QT_ATRASO, NVL(R.VL, 0) VL_ATRASO
        FROM (SELECT * FROM (
                SELECT G.AGN_IN_CODIGO AGN,
                       MAX(NVL(G.AGN_ST_NOME, G.AGN_ST_FANTASIA)) NOME,
                       NVL((SELECT MAX(C.AGN_BO_BLOQUEIO)
                              FROM MEGA.GLO_AGENTESCMPESP C
                             WHERE C.AGN_IN_CODIGO = G.AGN_IN_CODIGO), 'N') LIBERADO
                  FROM MEGA.GLO_AGENTES G
                 WHERE ${cond}
                 GROUP BY G.AGN_IN_CODIGO
                 ORDER BY 2)
               WHERE ROWNUM <= 30) A,
             (SELECT R.AGN_IN_CODIGO, COUNT(*) QT, SUM(R.SALDO_EM_ABERTO) VL
                FROM MEGA.FIN_VW_CONTASRECEBER R
               WHERE ${ATRASO}
               GROUP BY R.AGN_IN_CODIGO) R
       WHERE R.AGN_IN_CODIGO (+) = A.AGN
       ORDER BY A.NOME`);

    return {
      agentes: rows.map(r => ({
        agn:       num(r.AGN),
        nome:      r.NOME || `Agente ${r.AGN}`,
        liberado:  r.LIBERADO === 'S',
        qt_atraso: num(r.QT_ATRASO),
        vl_atraso: num(r.VL_ATRASO)
      }))
    };
  });

  // Libera o agente (flag 'S' — vale ate o reset diario das 03:00) + log
  app.post('/liberacao-agentes/liberar', {
    ...guard,
    schema: {
      body: {
        type: 'object', required: ['agn'],
        properties: { agn: { type: 'number' }, motivo: { type: 'string', maxLength: 200 } }
      }
    }
  }, async (req, reply) => {
    const { agn, motivo } = req.body;
    try {
      await megaExec(`
        DECLARE
          V_TAB NUMBER; V_PAD NUMBER; V_QTD NUMBER;
        BEGIN
          BEGIN
            SELECT MAX(G.AGN_TAB_IN_CODIGO), MAX(G.AGN_PAD_IN_CODIGO)
              INTO V_TAB, V_PAD
              FROM MEGA.GLO_AGENTES G
             WHERE G.AGN_IN_CODIGO = ${num(agn)};
          EXCEPTION WHEN NO_DATA_FOUND THEN V_TAB := NULL;
          END;
          IF V_TAB IS NULL THEN
            RAISE_APPLICATION_ERROR(-20901, 'AGENTE ${num(agn)} NAO ENCONTRADO NO CADASTRO.');
          END IF;

          SELECT COUNT(*) INTO V_QTD FROM MEGA.GLO_AGENTESCMPESP C
           WHERE C.AGN_IN_CODIGO = ${num(agn)} AND NVL(C.AGN_BO_BLOQUEIO, 'N') = 'S';
          IF V_QTD > 0 THEN
            RAISE_APPLICATION_ERROR(-20902, 'AGENTE JA ESTA LIBERADO HOJE.');
          END IF;

          -- MESMO ALVO DO MOTOR DE BLOQUEIO: TODAS AS LINHAS DA CMPESP DO AGENTE
          UPDATE MEGA.GLO_AGENTESCMPESP C
             SET C.AGN_BO_BLOQUEIO = 'S'
           WHERE C.AGN_IN_CODIGO = ${num(agn)};
          IF SQL%ROWCOUNT = 0 THEN
            INSERT INTO MEGA.GLO_AGENTESCMPESP
              (AGN_TAB_IN_CODIGO, AGN_PAD_IN_CODIGO, AGN_IN_CODIGO, AGN_BO_BLOQUEIO)
            VALUES (V_TAB, V_PAD, ${num(agn)}, 'S');
          END IF;

          INSERT INTO MEGA.CCS_TB_GFIN_LIBERA_AGN_LOG
            (LOG_IN_CODIGO, AGN_IN_CODIGO, LOG_CH_DE, LOG_CH_PARA, LOG_ST_MOTIVO, LOG_IN_USU, LOG_ST_USU)
          VALUES
            (MEGA.CCS_SEQ_GFIN_LIBERA_AGN_LOG.NEXTVAL, ${num(agn)}, 'N', 'S',
             ${motivo ? `'${lit(motivo, 200)}'` : 'NULL'},
             ${num(req.user.sub)}, '${lit(req.user.login, 60)}');
          COMMIT;
        END;`);
      return { ok: true, agn: num(agn) };
    } catch (e) {
      const msg = oraMsg(e);
      // o client do front exibe o campo `error` — vai a mensagem amigavel nele
      if (msg) return reply.code(400).send({ error: msg });
      throw e;
    }
  });

  // Revoga a liberacao (flag 'N') + log
  app.post('/liberacao-agentes/revogar', {
    ...guard,
    schema: {
      body: {
        type: 'object', required: ['agn'],
        properties: { agn: { type: 'number' }, motivo: { type: 'string', maxLength: 200 } }
      }
    }
  }, async (req, reply) => {
    const { agn, motivo } = req.body;
    try {
      await megaExec(`
        BEGIN
          UPDATE MEGA.GLO_AGENTESCMPESP C
             SET C.AGN_BO_BLOQUEIO = 'N'
           WHERE C.AGN_IN_CODIGO = ${num(agn)}
             AND NVL(C.AGN_BO_BLOQUEIO, 'N') = 'S';
          IF SQL%ROWCOUNT = 0 THEN
            RAISE_APPLICATION_ERROR(-20903, 'AGENTE NAO ESTA LIBERADO — NADA A REVOGAR.');
          END IF;

          INSERT INTO MEGA.CCS_TB_GFIN_LIBERA_AGN_LOG
            (LOG_IN_CODIGO, AGN_IN_CODIGO, LOG_CH_DE, LOG_CH_PARA, LOG_ST_MOTIVO, LOG_IN_USU, LOG_ST_USU)
          VALUES
            (MEGA.CCS_SEQ_GFIN_LIBERA_AGN_LOG.NEXTVAL, ${num(agn)}, 'S', 'N',
             ${motivo ? `'${lit(motivo, 200)}'` : 'NULL'},
             ${num(req.user.sub)}, '${lit(req.user.login, 60)}');
          COMMIT;
        END;`);
      return { ok: true, agn: num(agn) };
    } catch (e) {
      const msg = oraMsg(e);
      // o client do front exibe o campo `error` — vai a mensagem amigavel nele
      if (msg) return reply.code(400).send({ error: msg });
      throw e;
    }
  });

  // Historico de liberacoes/revogacoes
  app.get('/liberacao-agentes/historico', guard, async (req) => {
    const dias = Math.min(Math.max(num(req.query.dias) || 30, 1), 365);
    const rows = await megaQuery(`
      SELECT * FROM (
        SELECT L.LOG_IN_CODIGO                              AS ID,
               L.AGN_IN_CODIGO                              AS AGN,
               (SELECT MAX(NVL(G.AGN_ST_NOME, G.AGN_ST_FANTASIA))
                  FROM MEGA.GLO_AGENTES G
                 WHERE G.AGN_IN_CODIGO = L.AGN_IN_CODIGO)   AS NOME,
               L.LOG_CH_PARA                                AS PARA,
               L.LOG_ST_MOTIVO                              AS MOTIVO,
               L.LOG_ST_USU                                 AS USU,
               TO_CHAR(L.LOG_DT_DATA, 'YYYY-MM-DD HH24:MI') AS DT
          FROM MEGA.CCS_TB_GFIN_LIBERA_AGN_LOG L
         WHERE L.LOG_DT_DATA >= TRUNC(SYSDATE) - ${dias}
         ORDER BY L.LOG_IN_CODIGO DESC)
       WHERE ROWNUM <= 500`);
    return {
      eventos: rows.map(r => ({
        id:      num(r.ID),
        agn:     num(r.AGN),
        nome:    r.NOME || `Agente ${r.AGN}`,
        acao:    r.PARA === 'S' ? 'LIBEROU' : 'REVOGOU',
        motivo:  r.MOTIVO || '',
        usuario: r.USU || '',
        data:    r.DT
      }))
    };
  });
}
