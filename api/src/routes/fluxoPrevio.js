// [05/05/2026 - Alexandre Carvalho] Fluxo de Caixa Previo
// Consolidacao por filial, com saldo inicial, realizado/previsto, simulacoes.
import { megaQuery, megaExec } from '../soap/mega.js';

// Escapa string para SQL inline (basico - so aspas simples).
const sqlEsc = s => String(s ?? '').replace(/'/g, "''");

export default async function fluxoPrevioRoutes(app) {

  // ==========================================================================
  // GET /fluxo-previo?data_ini=YYYY-MM-DD&data_fim=YYYY-MM-DD&filiais=400,401&sim=S
  // Retorna a matriz dia x categoria, com saldo inicial, dias uteis, etc.
  // ==========================================================================
  app.get('/fluxo-previo', { preHandler: [app.authenticate] }, async (req) => {
    const dataIni = String(req.query.data_ini || '').slice(0, 10);
    const dataFim = String(req.query.data_fim || '').slice(0, 10);
    const fils    = String(req.query.filiais || '0').replace(/[^0-9,]/g, '') || '0';
    const sim     = (String(req.query.sim || 'S').toUpperCase() === 'S') ? 'S' : 'N';
    const prev    = (String(req.query.prev || 'N').toUpperCase() === 'S') ? 'S' : 'N';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataIni) || !/^\d{4}-\d{2}-\d{2}$/.test(dataFim)) {
      const e = new Error('data_ini e data_fim sao obrigatorios');
      e.statusCode = 400; throw e;
    }

    const sql = `
      SELECT TO_CHAR(DT_DIA,'YYYY-MM-DD') DT, CATEGORIA,
             FIL_IN_CODIGO, AGN_IN_CODIGO,
             DESCRICAO,
             NVL(ENTRADA,0)    ENTRADA,
             NVL(SAIDA,0)      SAIDA,
             NVL(QT_LANCTOS,0) QT_LANCTOS
        FROM TABLE(MEGA.CCS_F_GFIN_FLUXO_PREVIO(
                     TO_DATE('${dataIni}','YYYY-MM-DD'),
                     TO_DATE('${dataFim}','YYYY-MM-DD'),
                     '${sqlEsc(fils)}',
                     '${sim}',
                     200,
                     '${prev}'))
       ORDER BY DT_DIA, CATEGORIA, FIL_IN_CODIGO, AGN_IN_CODIGO`;

    const rows = await megaQuery(sql);
    const linhas = rows.map(r => ({
      dt:        r.DT,
      categoria: r.CATEGORIA,
      fil:       Number(r.FIL_IN_CODIGO || 0),
      agn:       Number(r.AGN_IN_CODIGO || 0),
      descricao: r.DESCRICAO || '',
      entrada:   Number(r.ENTRADA || 0),
      saida:     Number(r.SAIDA || 0),
      qt:        Number(r.QT_LANCTOS || 0)
    }));

    // Agrupa em matriz: data => categoria => acumulado
    const datasSet = new Set();
    let saldoInicial = 0;
    const buckets = {};   // { 'YYYY-MM-DD': { CR_PREVISTO: {ent, sai, qt}, ... } }

    for (const l of linhas) {
      if (l.categoria === 'SALDO_INICIAL') {
        saldoInicial += (l.entrada - l.saida);
        continue;
      }
      datasSet.add(l.dt);
      if (!buckets[l.dt]) buckets[l.dt] = {};
      if (!buckets[l.dt][l.categoria]) buckets[l.dt][l.categoria] = { ent: 0, sai: 0, qt: 0 };
      buckets[l.dt][l.categoria].ent += l.entrada;
      buckets[l.dt][l.categoria].sai += l.saida;
      buckets[l.dt][l.categoria].qt  += l.qt;
    }

    const datas = [...datasSet].sort();
    const CATS = ['CR_REALIZADO','CR_PREVISTO','ADIANT_C',
                  'CP_REALIZADO','CP_PREVISTO','ADIANT_D',
                  'SIMULACAO'];

    let saldoAcumulado = saldoInicial;
    const dias = datas.map(dt => {
      const cats = buckets[dt] || {};
      let entrada = 0, saida = 0;
      const detalhes = {};
      for (const k of CATS) {
        const v = cats[k] || { ent: 0, sai: 0, qt: 0 };
        entrada += v.ent; saida += v.sai;
        detalhes[k] = v;
      }
      const liquido = entrada - saida;
      saldoAcumulado += liquido;
      return {
        dt, entrada, saida, liquido,
        saldo_acum: saldoAcumulado,
        detalhes
      };
    });

    return {
      filtro: { data_ini: dataIni, data_fim: dataFim, filiais: fils, simulacoes: sim, previsao: prev },
      saldo_inicial: saldoInicial,
      saldo_final:   saldoAcumulado,
      categorias_ordem: CATS,
      dias
    };
  });

  // ==========================================================================
  // CONFIG DE CONTAS
  // GET    /fluxo-previo/contas-config            - lista todas com flag
  // POST   /fluxo-previo/contas-config { ids: [] } - substitui ativas pela lista
  // ==========================================================================
  app.get('/fluxo-previo/contas-config', { preHandler: [app.authenticate] }, async () => {
    const sql = `
      SELECT A.AGN_IN_CODIGO, A.AGN_ST_NOME,
             NVL((SELECT FLX_CH_ATIVO FROM MEGA.CCS_TB_GFIN_FLX_CONTA C
                   WHERE C.AGN_IN_CODIGO = A.AGN_IN_CODIGO),
                 CASE WHEN (SELECT COUNT(*) FROM MEGA.CCS_TB_GFIN_FLX_CONTA WHERE FLX_CH_ATIVO='S') > 0
                      THEN 'N' ELSE 'S' END) AS ATIVO
        FROM MEGA.GLO_AGENTES_ID I, MEGA.GLO_AGENTES A
       WHERE I.AGN_TAU_ST_CODIGO = 'N'
         AND I.AGN_TAB_IN_CODIGO = A.AGN_TAB_IN_CODIGO
         AND I.AGN_PAD_IN_CODIGO = A.AGN_PAD_IN_CODIGO
         AND I.AGN_IN_CODIGO     = A.AGN_IN_CODIGO
         AND EXISTS (SELECT 1 FROM MEGA.FIN_MOVIMENTO M
                      WHERE M.AGN_TAB_IN_CODIGO = I.AGN_TAB_IN_CODIGO
                        AND M.AGN_PAD_IN_CODIGO = I.AGN_PAD_IN_CODIGO
                        AND M.AGN_IN_CODIGO     = I.AGN_IN_CODIGO
                        AND M.AGN_TAU_ST_CODIGO = I.AGN_TAU_ST_CODIGO
                        AND M.MOV_DT_VENCTO >= TRUNC(SYSDATE) - 365)
       ORDER BY A.AGN_IN_CODIGO`;
    const rows = await megaQuery(sql);
    return rows.map(r => ({
      id: Number(r.AGN_IN_CODIGO),
      nome: r.AGN_ST_NOME,
      ativo: r.ATIVO === 'S'
    }));
  });

  app.post('/fluxo-previo/contas-config', {
    preHandler: [app.authenticate],
    schema: {
      body: {
        type: 'object', required: ['ids'],
        properties: {
          ids: { type: 'array', items: { type: 'integer' } }
        }
      }
    }
  }, async (req) => {
    const ids = (req.body.ids || []).map(n => parseInt(n, 10)).filter(n => n > 0);
    // Estrategia simples: zera tudo e reinsere os ativos
    await megaExec(`BEGIN
                      UPDATE MEGA.CCS_TB_GFIN_FLX_CONTA SET FLX_CH_ATIVO = 'N';
                      ${ids.map(id => `
                      MERGE INTO MEGA.CCS_TB_GFIN_FLX_CONTA C
                      USING (SELECT ${id} AS AGN FROM DUAL) S
                         ON (C.AGN_IN_CODIGO = S.AGN)
                       WHEN MATCHED THEN UPDATE SET FLX_CH_ATIVO = 'S'
                       WHEN NOT MATCHED THEN INSERT (AGN_IN_CODIGO, FLX_CH_ATIVO)
                                              VALUES (${id}, 'S');`).join('\n')}
                      COMMIT;
                    END;`);
    return { ok: true, qtd: ids.length };
  });

  // ==========================================================================
  // SIMULACOES
  // GET    /fluxo-previo/simulacoes - lista todas
  // POST   /fluxo-previo/simulacoes - cria
  // DELETE /fluxo-previo/simulacoes/:id - remove
  // ==========================================================================
  app.get('/fluxo-previo/simulacoes', { preHandler: [app.authenticate] }, async () => {
    const rows = await megaQuery(`
      SELECT SIM_IN_CODIGO, TO_CHAR(SIM_DT_DATA,'YYYY-MM-DD') DT,
             FIL_IN_CODIGO, SIM_CH_TIPO, SIM_RE_VALOR, SIM_ST_DESCRICAO,
             SIM_IN_USUARIO, TO_CHAR(SIM_DT_INC,'YYYY-MM-DD HH24:MI') DT_INC
        FROM MEGA.CCS_TB_GFIN_FLX_SIM
       ORDER BY SIM_DT_DATA, SIM_IN_CODIGO`);
    return rows.map(r => ({
      id:        Number(r.SIM_IN_CODIGO),
      data:      r.DT,
      fil:       Number(r.FIL_IN_CODIGO),
      tipo:      r.SIM_CH_TIPO,
      valor:     Number(r.SIM_RE_VALOR),
      descricao: r.SIM_ST_DESCRICAO || '',
      usuario:   Number(r.SIM_IN_USUARIO),
      dt_inc:    r.DT_INC
    }));
  });

  app.post('/fluxo-previo/simulacoes', {
    preHandler: [app.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['data','fil','tipo','valor'],
        properties: {
          data:      { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          fil:       { type: 'integer' },
          tipo:      { type: 'string', enum: ['C','D'] },
          valor:     { type: 'number', minimum: 0.01 },
          descricao: { type: 'string', maxLength: 200 }
        }
      }
    }
  }, async (req) => {
    const { data, fil, tipo, valor, descricao = '' } = req.body;
    const usu = parseInt(req.user?.sub || 1, 10);
    await megaExec(`BEGIN
        INSERT INTO MEGA.CCS_TB_GFIN_FLX_SIM
          (SIM_IN_CODIGO, SIM_DT_DATA, FIL_IN_CODIGO, SIM_CH_TIPO,
           SIM_RE_VALOR, SIM_ST_DESCRICAO, SIM_IN_USUARIO)
        VALUES
          (MEGA.CCS_SEQ_GFIN_FLX_SIM.NEXTVAL,
           TO_DATE('${data}','YYYY-MM-DD'),
           ${fil}, '${tipo}', ${valor},
           '${sqlEsc(descricao)}', ${usu});
        COMMIT;
      END;`);
    return { ok: true };
  });

  app.delete('/fluxo-previo/simulacoes/:id', { preHandler: [app.authenticate] }, async (req) => {
    const id = parseInt(req.params.id, 10);
    if (!id) { const e = new Error('id invalido'); e.statusCode = 400; throw e; }
    await megaExec(`BEGIN
        DELETE FROM MEGA.CCS_TB_GFIN_FLX_SIM WHERE SIM_IN_CODIGO = ${id};
        COMMIT;
      END;`);
    return { ok: true };
  });
}
