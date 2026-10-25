// [25/10/2026 - CRIADO POR ALEXANDRE CARVALHO] Rotas do modulo Frete > Motoristas do Gestor Financeiro CCS.
//
// Cadastro dos motoristas do Mega (VEN_CONDUTOR + campos especificos VEN_CONDUTORCMPESP: tipo interno/externo,
// ativo, bloqueio, telefone) com a marcacao MEI sim/nao por motorista (tabela propria CCS_TB_GFIN_MOTORISTA,
// log em CCS_TB_GFIN_MOTORISTA_LOG) e o parametro do limite mensal de faturamento do MEI (CCS_TB_GFIN_PARAM).
// Nada do Mega e alterado. Uso do motorista = romaneios de expedicao (CUS_TB_ROMANEIO_EXP.CDT_IN_SEQUENCIA).
//
//   GET  /motoristas                       - todos os motoristas (filtros no front)
//   POST /motoristas/:cdt/mei              - { mei: true|false, motivo? } -> grava flag + log
//   GET  /motoristas/:cdt/historico        - log de alteracoes do motorista
//   GET  /motoristas/parametros            - limite mensal MEI
//   GET  /motoristas/parametros/historico  - historico do parametro (trigger CCS_T_GFIN_PARAM_HIST)
//   PUT  /motoristas/parametros            - { limite_mei_mes } (admin)
import { megaQuery, megaExec } from '../soap/mega.js';

const num = v => Number(v || 0);
// sanitiza texto que entra em literal SQL (dobra aspas, corta tamanho)
const lit = (s, max) => String(s ?? '').slice(0, max).replace(/'/g, "''");
// mensagem amigavel de RAISE_APPLICATION_ERROR (-209xx) sem o prefixo ORA
const oraMsg = e => {
  const m = String(e?.message || e).match(/ORA-209\d\d:\s*([^\n]+)/);
  return m ? m[1].replace(/\s*ORA-\d+.*$/, '').trim() : null;
};
const PARAM_LIMITE = 'MOTORISTA_MEI_LIMITE_MES';

// preHandler: bloqueia quem nao for admin (mesmo padrao do admin.js)
async function adminOnly(req, reply) {
  if (req.user?.perm !== 'A') {
    return reply.code(403).send({ error: 'admin_only', message: 'Acesso restrito a administradores do Gestor Financeiro CCS.' });
  }
}

export default async function motoristasRoutes(app) {
  const guard = { preHandler: [app.authenticate] };

  // Lista completa (~1.250 motoristas): o front filtra, pagina e exporta.
  app.get('/motoristas', guard, async () => {
    const rows = await megaQuery(`
      SELECT C.CDT_IN_SEQUENCIA                                   AS CDT,
             C.CDT_ST_XNOME                                       AS NOME,
             C.CDT_ST_CPF                                         AS CPF,
             E.CDT_ST_MOTORISTA                                   AS TIPO,
             E.CDT_ST_ATIVO                                       AS ATIVO,
             E.CDT_ST_BLOQUEIO                                    AS BLOQ,
             E.CDT_ST_MOTIVOBLOQ                                  AS MOTIVO_BLOQ,
             NVL(E.CDT_ST_CELULAR, E.CDT_ST_TELEFONE)             AS FONE,
             NVL(M.MOT_CH_MEI, 'N')                               AS MEI,
             TO_CHAR(M.MOT_DT_ALTERACAO, 'YYYY-MM-DD HH24:MI')    AS MEI_EM,
             M.MOT_ST_USU                                         AS MEI_POR,
             NVL(R.QT12, 0)                                       AS ROM_12M,
             NVL(R.QT, 0)                                         AS ROM_TOTAL,
             TO_CHAR(R.ULT, 'YYYY-MM-DD')                         AS ULT_ROM
        FROM MEGA.VEN_CONDUTOR           C,
             MEGA.VEN_CONDUTORCMPESP     E,
             MEGA.CCS_TB_GFIN_MOTORISTA  M,
             (SELECT X.CDT_IN_SEQUENCIA,
                     COUNT(*)                                                                             QT,
                     SUM(CASE WHEN X.ROM_DT_EXPEDICAO >= ADD_MONTHS(TRUNC(SYSDATE), -12) THEN 1 ELSE 0 END) QT12,
                     MAX(X.ROM_DT_EXPEDICAO)                                                              ULT
                FROM MEGA.CUS_TB_ROMANEIO_EXP X
               WHERE X.CDT_IN_SEQUENCIA IS NOT NULL
               GROUP BY X.CDT_IN_SEQUENCIA) R
       WHERE E.CDT_IN_SEQUENCIA (+) = C.CDT_IN_SEQUENCIA
         AND M.CDT_IN_SEQUENCIA (+) = C.CDT_IN_SEQUENCIA
         AND R.CDT_IN_SEQUENCIA (+) = C.CDT_IN_SEQUENCIA
       ORDER BY C.CDT_ST_XNOME`);
    return {
      motoristas: rows.map(r => ({
        cdt:        num(r.CDT),
        nome:       r.NOME || `Motorista ${r.CDT}`,
        cpf:        r.CPF || '',
        tipo:       r.TIPO || '',                 // INTERNO | EXTERNO | ''
        ativo:      r.ATIVO === 'S',
        sem_cadastro_esp: r.ATIVO == null && r.TIPO == null,  // sem linha na VEN_CONDUTORCMPESP
        bloqueado:  r.BLOQ === 'S',
        motivo_bloq: r.MOTIVO_BLOQ || '',
        fone:       r.FONE || '',
        mei:        r.MEI === 'S',
        mei_em:     r.MEI_EM || '',
        mei_por:    r.MEI_POR || '',
        rom_12m:    num(r.ROM_12M),
        rom_total:  num(r.ROM_TOTAL),
        ult_rom:    r.ULT_ROM || ''
      }))
    };
  });

  // Marca/desmarca MEI (MERGE na tabela propria) + log de/para com o usuario do portal
  app.post('/motoristas/:cdt/mei', {
    ...guard,
    schema: {
      params: { type: 'object', required: ['cdt'], properties: { cdt: { type: 'integer', minimum: 1 } } },
      body:   { type: 'object', required: ['mei'],
                properties: { mei: { type: 'boolean' }, motivo: { type: 'string', maxLength: 200 } } }
    }
  }, async (req, reply) => {
    const cdt  = num(req.params.cdt);
    const para = req.body.mei ? 'S' : 'N';
    const motivo = String(req.body.motivo || '').trim();
    try {
      await megaExec(`
        DECLARE
          V_QTD NUMBER; V_DE VARCHAR2(1);
        BEGIN
          SELECT COUNT(*) INTO V_QTD FROM MEGA.VEN_CONDUTOR C WHERE C.CDT_IN_SEQUENCIA = ${cdt};
          IF V_QTD = 0 THEN
            RAISE_APPLICATION_ERROR(-20911, 'MOTORISTA ${cdt} NAO ENCONTRADO NO CADASTRO DO MEGA.');
          END IF;
          SELECT NVL(MAX(M.MOT_CH_MEI), 'N') INTO V_DE FROM MEGA.CCS_TB_GFIN_MOTORISTA M WHERE M.CDT_IN_SEQUENCIA = ${cdt};
          IF V_DE = '${para}' THEN
            RAISE_APPLICATION_ERROR(-20912, 'MOTORISTA JA ESTA MARCADO COMO ${para === 'S' ? 'MEI' : 'NAO MEI'}.');
          END IF;

          MERGE INTO MEGA.CCS_TB_GFIN_MOTORISTA D
          USING (SELECT ${cdt} CDT FROM DUAL) S
          ON (D.CDT_IN_SEQUENCIA = S.CDT)
          WHEN MATCHED THEN UPDATE SET D.MOT_CH_MEI = '${para}', D.MOT_DT_ALTERACAO = SYSDATE,
                                       D.MOT_IN_USU = ${num(req.user.sub)}, D.MOT_ST_USU = '${lit(req.user.login, 60)}'
          WHEN NOT MATCHED THEN INSERT (CDT_IN_SEQUENCIA, MOT_CH_MEI, MOT_DT_ALTERACAO, MOT_IN_USU, MOT_ST_USU)
               VALUES (S.CDT, '${para}', SYSDATE, ${num(req.user.sub)}, '${lit(req.user.login, 60)}');

          INSERT INTO MEGA.CCS_TB_GFIN_MOTORISTA_LOG
            (LOG_IN_CODIGO, CDT_IN_SEQUENCIA, LOG_ST_CAMPO, LOG_ST_DE, LOG_ST_PARA, LOG_ST_MOTIVO, LOG_IN_USU, LOG_ST_USU)
          VALUES
            (MEGA.CCS_SEQ_GFIN_MOTORISTA_LOG.NEXTVAL, ${cdt}, 'MEI', V_DE, '${para}',
             ${motivo ? `'${lit(motivo, 200)}'` : 'NULL'}, ${num(req.user.sub)}, '${lit(req.user.login, 60)}');
          COMMIT;
        END;`);
      return { ok: true, cdt, mei: para === 'S' };
    } catch (e) {
      const msg = oraMsg(e);
      if (msg) return reply.code(400).send({ error: msg });
      throw e;
    }
  });

  // Historico de alteracoes de um motorista
  app.get('/motoristas/:cdt/historico', guard, async (req) => {
    const cdt = num(req.params.cdt);
    const rows = await megaQuery(`
      SELECT L.LOG_IN_CODIGO                                              AS ID,
             L.LOG_ST_CAMPO                                               AS CAMPO,
             L.LOG_ST_DE                                                  AS DE,
             L.LOG_ST_PARA                                                AS PARA,
             L.LOG_ST_MOTIVO                                              AS MOTIVO,
             NVL(NVL(U.GRU_ST_NOMECOMPLETO, U.GRU_ST_NOME), L.LOG_ST_USU) AS USUARIO,
             TO_CHAR(L.LOG_DT_DATA, 'YYYY-MM-DD HH24:MI')                 AS QUANDO
        FROM MEGA.CCS_TB_GFIN_MOTORISTA_LOG L,
             MEGA.GLO_GRUPO_USUARIO         U
       WHERE L.CDT_IN_SEQUENCIA = ${cdt}
         AND U.GRU_IN_CODIGO (+) = L.LOG_IN_USU
       ORDER BY L.LOG_IN_CODIGO DESC
       FETCH FIRST 200 ROWS ONLY`);
    const simNao = v => (v === 'S' ? 'Sim' : v === 'N' ? 'Não' : (v || '—'));
    return {
      historico: rows.map(r => ({
        id: num(r.ID), campo: r.CAMPO, de: simNao(r.DE), para: simNao(r.PARA),
        motivo: r.MOTIVO || '', usuario: r.USUARIO || '—', quando: r.QUANDO
      }))
    };
  });

  // Parametros do modulo: GET aberto a autenticados (o modal exibe o valor); PUT restrito a admin.
  app.get('/motoristas/parametros', guard, async () => {
    const rows = await megaQuery(`
      SELECT PARAM_RE_VALOR                                   AS VALOR,
             TO_CHAR(PARAM_DT_ALTERACAO, 'YYYY-MM-DD HH24:MI') AS ALTERADO_EM,
             PARAM_ST_USU                                     AS ALTERADO_POR
        FROM MEGA.CCS_TB_GFIN_PARAM
       WHERE PARAM_ST_CHAVE = '${PARAM_LIMITE}'`);
    const r = rows[0];
    return {
      limite_mei_mes: num(r?.VALOR ?? 20966),
      alterado_em:    r?.ALTERADO_EM  || null,
      alterado_por:   r?.ALTERADO_POR || null
    };
  });

  app.get('/motoristas/parametros/historico', guard, async () => {
    const rows = await megaQuery(`
      SELECT H.HIST_RE_VALOR_ANT                                          AS DE,
             H.HIST_RE_VALOR_NOVO                                         AS PARA,
             H.HIST_IN_USU                                                AS USU,
             NVL(NVL(U.GRU_ST_NOMECOMPLETO, U.GRU_ST_NOME), H.HIST_ST_USU) AS USUARIO,
             TO_CHAR(H.HIST_DT_ALTERACAO, 'YYYY-MM-DD HH24:MI')            AS QUANDO
        FROM MEGA.CCS_TB_GFIN_PARAM_HIST H,
             MEGA.GLO_GRUPO_USUARIO      U
       WHERE H.PARAM_ST_CHAVE = '${PARAM_LIMITE}'
         AND U.GRU_IN_CODIGO (+) = H.HIST_IN_USU
       ORDER BY H.HIST_IN_CODIGO DESC
       FETCH FIRST 500 ROWS ONLY`);
    return {
      historico: rows.map(r => ({
        parametro: 'Limite mensal MEI',
        de:      r.DE === '' || r.DE == null ? null : num(r.DE),
        para:    num(r.PARA),
        usuario: r.USUARIO || (r.USU ? `Usuário ${r.USU}` : '—'),
        quando:  r.QUANDO
      }))
    };
  });

  app.put('/motoristas/parametros', {
    preHandler: [app.authenticate, adminOnly],
    schema: {
      body: { type: 'object', required: ['limite_mei_mes'],
              properties: { limite_mei_mes: { type: 'number', minimum: 0, maximum: 99999999 } } }
    }
  }, async (req) => {
    const valor = Math.round(num(req.body.limite_mei_mes) * 100) / 100;
    // so grava valor DIFERENTE (a trigger de historico ja ignora igual, mas o UPDATE cego
    // carimbaria PARAM_DT_ALTERACAO/USU sem mudanca real)
    await megaExec(`
      BEGIN
        UPDATE MEGA.CCS_TB_GFIN_PARAM
           SET PARAM_RE_VALOR     = ${valor},
               PARAM_DT_ALTERACAO = SYSDATE,
               PARAM_IN_USU       = ${num(req.user.sub)},
               PARAM_ST_USU       = '${lit(req.user.login, 60)}'
         WHERE PARAM_ST_CHAVE = '${PARAM_LIMITE}'
           AND PARAM_RE_VALOR <> ${valor};
        COMMIT;
      END;`);
    return { ok: true, limite_mei_mes: valor };
  });
}
