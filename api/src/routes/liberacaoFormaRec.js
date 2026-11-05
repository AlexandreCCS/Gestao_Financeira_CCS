// [09/10/2026 - CRIADO POR ALEXANDRE CARVALHO] Liberacao de troca de FORMA DE RECEBIMENTO do titulo.
// Trava: trigger CCS_T_LIBERA_FORMA_REC (FIN_CONTASRECEBER, BEFORE UPDATE OF HCOB_IN_SEQUENCIA) - sql/24_libera_forma_rec.sql.
// Liberacao ANTECIPADA e de USO UNICO por titulo (ORG + MOV_IN_NUMLANCTO) + forma nova (HCOB_IN_PARA); a trigger consome (A -> E).
// Todas as filiais. Livre (so registra): titulo sem forma; BOLETO (atual ou novo - so banco do dia, fora da trava); rotina automatica.
// [09/10/2026 V2] titulos em boleto e formas de boleto nao aparecem nesta tela.
//   GET  /liberacao-forma/titulos           - titulos CR em aberto (PDV fora) com a forma atual
//   GET  /liberacao-forma/formas?fil=       - formas de recebimento validas da filial
//   POST /liberacao-forma/liberar           - cria liberacao (titulo + forma nova + motivo)
//   POST /liberacao-forma/revogar           - cancela liberacao ativa
//   GET  /liberacao-forma/liberacoes        - historico (opcional ?org=&lanc=)
//   GET  /liberacao-forma/trocas?ini=&fim=  - todas as trocas registradas pela trigger (inclui bloqueadas) - base do BI
import { megaQuery, megaExec } from '../soap/mega.js';

const num = v => Number(v || 0);
const RX_DATA = /^\d{4}-\d{2}-\d{2}$/;
const lit = (s, max) => String(s ?? '').slice(0, max).replace(/'/g, "''");
const TIPOS = { S: 'Sem forma → preenchida', D: 'Boleto (banco do dia)', A: 'Rotina automática', L: 'Com liberação', X: 'Bloqueada' };

export default async function liberacaoFormaRecRoutes(app) {
  const guard = { preHandler: [app.authenticate] };

  app.get('/liberacao-forma/titulos', guard, async () => {
    const rows = await megaQuery(`
      SELECT C.ORG_IN_CODIGO ORG, C.MOV_IN_NUMLANCTO LANC, C.AGN_IN_CODIGO AGN,
             NVL(G.AGN_ST_NOME, G.AGN_ST_FANTASIA) CLIENTE, C.FIL_IN_CODIGO FIL,
             C.MOV_ST_DOCUMENTO DOC, C.MOV_ST_PARCELA PARC, C.TPD_ST_CODIGO TPD,
             C.HCOB_IN_SEQUENCIA HCOB, SUBSTR(NVL(C.HCOB_ST_DESCRICAO, ''), 1, 60) FORMA,
             H.TCOB_ST_CODIGO TCOB,
             TO_CHAR(C.MOV_DT_DATADOCTO, 'YYYY-MM-DD') EMISSAO,
             TO_CHAR(C.MOV_DT_PRORROGADO,'YYYY-MM-DD') VENCTO,
             TRUNC(SYSDATE) - TRUNC(C.MOV_DT_PRORROGADO) DIAS,
             C.MOV_RE_VALOR VALOR, C.SALDO_EM_ABERTO SALDO,
             (SELECT COUNT(*) FROM MEGA.CCS_TB_LIBERA_FORMA_REC L
               WHERE L.ORG_IN_CODIGO = C.ORG_IN_CODIGO AND L.MOV_IN_NUMLANCTO = C.MOV_IN_NUMLANCTO AND L.LIB_CH_STATUS = 'A') LIB_ATIVA
        FROM MEGA.FIN_VW_CONTASRECEBER C, MEGA.GLO_AGENTES G, MEGA.FIN_HBKCOBRANCA H
       WHERE C.SALDO_EM_ABERTO > 0
         AND C.TPD_ST_CODIGO <> 'PDV'
         AND G.AGN_IN_CODIGO (+) = C.AGN_IN_CODIGO
         AND H.HCOB_IN_SEQUENCIA (+) = C.HCOB_IN_SEQUENCIA
         AND NVL(H.TCOB_ST_CODIGO, 'X') <> 'SIMP'
       ORDER BY C.MOV_DT_PRORROGADO, C.AGN_IN_CODIGO`);
    const titulos = rows.map(r => ({
      org: num(r.ORG), lanc: num(r.LANC), agn_id: num(r.AGN), cliente: r.CLIENTE || `Cliente ${r.AGN}`,
      fil_id: num(r.FIL), documento: r.DOC || '', parcela: r.PARC || '', tipo: r.TPD || '',
      hcob: r.HCOB ? num(r.HCOB) : null, forma_receb: r.FORMA || '', boleto: r.TCOB === 'SIMP',
      emissao: r.EMISSAO || null, vencto: r.VENCTO || null, dias_atraso: num(r.DIAS),
      valor: num(r.VALOR), saldo: num(r.SALDO), lib_ativa: num(r.LIB_ATIVA) > 0
    }));
    return {
      total: titulos.length,
      kpi: {
        qt_titulos:   titulos.length,
        saldo_total:  titulos.reduce((s, t) => s + t.saldo, 0),
        qt_sem_forma: titulos.filter(t => !t.hcob).length,
        qt_lib_ativa: titulos.filter(t => t.lib_ativa).length
      },
      titulos
    };
  });

  app.get('/liberacao-forma/formas', guard, async (req) => {
    const fil = num(req.query.fil);
    const rows = await megaQuery(`
      SELECT HCOB_IN_SEQUENCIA H, HCOB_ST_DESCRICAO D, TCOB_ST_CODIGO T
        FROM MEGA.FIN_HBKCOBRANCA
       WHERE ORG_IN_CODIGO = ${fil} AND NVL(HCOB_DT_VALIDADE, SYSDATE) >= TRUNC(SYSDATE) AND TCOB_ST_CODIGO <> 'SIMP'
       ORDER BY TCOB_ST_CODIGO, HCOB_ST_DESCRICAO`);
    const vig = await megaQuery(`SELECT MEGA.CCS_F_BANCODIA_HCOB_VIGENTE(${fil}) V FROM DUAL`).catch(() => []);
    return {
      banco_do_dia: vig[0]?.V ? num(vig[0].V) : null,
      formas: rows.map(r => ({ hcob: num(r.H), descricao: r.D, boleto: r.T === 'SIMP' }))
    };
  });

  app.post('/liberacao-forma/liberar', {
    ...guard,
    schema: { body: { type: 'object', required: ['org', 'lanc', 'para'],
      properties: {
        org: { type: 'integer', minimum: 1 }, lanc: { type: 'integer', minimum: 1 },
        para: { type: 'integer', minimum: 0 }, motivo: { type: 'string', maxLength: 200 }
      } } }
  }, async (req, reply) => {
    const org = num(req.body.org), lanc = num(req.body.lanc), para = num(req.body.para);
    const motivo = lit(req.body.motivo || '', 200);
    if (!motivo.trim()) return reply.code(400).send({ error: 'motivo', message: 'Informe o motivo da troca.' });
    const t = await megaQuery(`
      SELECT C.FIL_IN_CODIGO FIL, C.AGN_IN_CODIGO AGN, C.MOV_ST_DOCUMENTO DOC, C.MOV_ST_PARCELA PARC, C.HCOB_IN_SEQUENCIA HCOB
        FROM MEGA.FIN_VW_CONTASRECEBER C WHERE C.ORG_IN_CODIGO = ${org} AND C.MOV_IN_NUMLANCTO = ${lanc}`);
    if (!t.length) return reply.code(404).send({ error: 'titulo', message: 'Título não encontrado.' });
    const tt = t[0];
    // para = 0 -> liberar REMOVER a forma (titulo fica sem forma; a trigger casa HCOB_IN_PARA nulo)
    if (para === 0 && !tt.HCOB) return reply.code(400).send({ error: 'mesma_forma', message: 'O título já está sem forma de recebimento.' });
    if (para && num(tt.HCOB) === para) return reply.code(400).send({ error: 'mesma_forma', message: 'O título já está com essa forma de recebimento.' });
    if (para) {
      const f = await megaQuery(`SELECT COUNT(*) N FROM MEGA.FIN_HBKCOBRANCA WHERE HCOB_IN_SEQUENCIA = ${para} AND ORG_IN_CODIGO = ${num(tt.FIL)} AND TCOB_ST_CODIGO <> 'SIMP'`);
      if (!num(f[0]?.N)) return reply.code(400).send({ error: 'forma', message: 'Essa forma de recebimento não é da filial do título.' });
    }
    const dup = await megaQuery(`SELECT COUNT(*) N FROM MEGA.CCS_TB_LIBERA_FORMA_REC
       WHERE ORG_IN_CODIGO = ${org} AND MOV_IN_NUMLANCTO = ${lanc} AND LIB_CH_STATUS = 'A'`);
    if (num(dup[0]?.N) > 0) return reply.code(409).send({ error: 'ja_liberado',
      message: 'Este título já tem uma liberação ativa. Revogue a anterior para liberar outra forma.' });
    await megaExec(`
      BEGIN
        INSERT INTO MEGA.CCS_TB_LIBERA_FORMA_REC
          (LIB_IN_CODIGO, ORG_IN_CODIGO, MOV_IN_NUMLANCTO, FIL_IN_CODIGO, AGN_IN_CODIGO, LIB_ST_DOCUMENTO, LIB_ST_PARCELA,
           HCOB_IN_DE, HCOB_IN_PARA, LIB_ST_MOTIVO, LIB_CH_STATUS, LIB_IN_USU_LIBEROU, LIB_ST_USU_LIBEROU)
        VALUES
          (MEGA.CCS_SEQ_LIBERA_FORMA_REC.NEXTVAL, ${org}, ${lanc}, ${num(tt.FIL)}, ${num(tt.AGN)},
           '${lit(tt.DOC, 20)}', ${tt.PARC ? `'${lit(tt.PARC, 6)}'` : 'NULL'},
           ${tt.HCOB ? num(tt.HCOB) : 'NULL'}, ${para || 'NULL'}, '${motivo}', 'A', ${num(req.user.sub)}, '${lit(req.user.login, 60)}');
        COMMIT;
      END;`);
    return { ok: true };
  });

  app.post('/liberacao-forma/revogar', {
    ...guard,
    schema: { body: { type: 'object', required: ['id'], properties: { id: { type: 'integer', minimum: 1 } } } }
  }, async (req) => {
    await megaExec(`
      BEGIN
        UPDATE MEGA.CCS_TB_LIBERA_FORMA_REC
           SET LIB_CH_STATUS = 'C', LIB_IN_USU_CANCELOU = ${num(req.user.sub)}, LIB_DT_CANCELAMENTO = SYSDATE
         WHERE LIB_IN_CODIGO = ${num(req.body.id)} AND LIB_CH_STATUS = 'A';
        COMMIT;
      END;`);
    return { ok: true };
  });

  app.get('/liberacao-forma/liberacoes', guard, async (req) => {
    const org = num(req.query.org), lanc = num(req.query.lanc);
    const filtro = org && lanc ? `AND L.ORG_IN_CODIGO = ${org} AND L.MOV_IN_NUMLANCTO = ${lanc}` : '';
    const rows = await megaQuery(`
      SELECT L.LIB_IN_CODIGO ID, L.ORG_IN_CODIGO ORG, L.MOV_IN_NUMLANCTO LANC, L.FIL_IN_CODIGO FIL, L.AGN_IN_CODIGO AGN,
             NVL(G.AGN_ST_NOME, G.AGN_ST_FANTASIA) CLIENTE, L.LIB_ST_DOCUMENTO DOC, L.LIB_ST_PARCELA PARC,
             L.HCOB_IN_DE DE, HD.HCOB_ST_DESCRICAO DE_NOME, L.HCOB_IN_PARA PARA, HP.HCOB_ST_DESCRICAO PARA_NOME,
             L.LIB_ST_MOTIVO MOTIVO, L.LIB_CH_STATUS STATUS, L.LIB_ST_USU_LIBEROU USU_LIB_NOME,
             TO_CHAR(L.LIB_DT_LIBERACAO,'YYYY-MM-DD HH24:MI') LIBERADO_EM,
             NVL(UC.GRU_ST_NOMECOMPLETO, UC.GRU_ST_NOME) USU_CANC_NOME, TO_CHAR(L.LIB_DT_CANCELAMENTO,'YYYY-MM-DD HH24:MI') CANCELADO_EM,
             NVL(UE.GRU_ST_NOMECOMPLETO, UE.GRU_ST_NOME) USU_EXEC_NOME, L.LIB_IN_USU_EXECUTOU USU_EXEC,
             TO_CHAR(L.LIB_DT_EXECUCAO,'YYYY-MM-DD HH24:MI') EXECUTADO_EM
        FROM MEGA.CCS_TB_LIBERA_FORMA_REC L, MEGA.GLO_AGENTES G, MEGA.FIN_HBKCOBRANCA HD, MEGA.FIN_HBKCOBRANCA HP,
             MEGA.GLO_GRUPO_USUARIO UC, MEGA.GLO_GRUPO_USUARIO UE
       WHERE G.AGN_IN_CODIGO (+) = L.AGN_IN_CODIGO
         AND HD.HCOB_IN_SEQUENCIA (+) = L.HCOB_IN_DE AND HP.HCOB_IN_SEQUENCIA (+) = L.HCOB_IN_PARA
         AND UC.GRU_IN_CODIGO (+) = L.LIB_IN_USU_CANCELOU AND UE.GRU_IN_CODIGO (+) = L.LIB_IN_USU_EXECUTOU
         ${filtro}
       ORDER BY L.LIB_DT_LIBERACAO DESC`);
    return {
      liberacoes: rows.map(l => ({
        id: num(l.ID), org: num(l.ORG), lanc: num(l.LANC), fil_id: num(l.FIL), agn_id: num(l.AGN),
        cliente: l.CLIENTE || `Cliente ${l.AGN}`, documento: l.DOC, parcela: l.PARC || '',
        de: l.DE ? num(l.DE) : null, de_nome: l.DE_NOME || 'Sem forma', para: l.PARA ? num(l.PARA) : null, para_nome: l.PARA_NOME || 'Sem forma (remover)',
        motivo: l.MOTIVO || '', status: l.STATUS, usu_liberou_nome: l.USU_LIB_NOME, liberado_em: l.LIBERADO_EM,
        usu_cancelou_nome: l.USU_CANC_NOME || null, cancelado_em: l.CANCELADO_EM || null,
        usu_executou_nome: l.USU_EXEC_NOME || (l.USU_EXEC ? `Usuário ${l.USU_EXEC}` : null), executado_em: l.EXECUTADO_EM || null
      }))
    };
  });

  app.get('/liberacao-forma/trocas', guard, async (req) => {
    const hoje = new Date();
    const ini = RX_DATA.test(req.query.ini || '') ? req.query.ini : new Date(hoje.getTime() - 30 * 86400000).toISOString().slice(0, 10);
    const fim = RX_DATA.test(req.query.fim || '') ? req.query.fim : hoje.toISOString().slice(0, 10);
    const rows = await megaQuery(`
      SELECT TO_CHAR(L.LOG_DT,'YYYY-MM-DD HH24:MI') DT, L.LOG_CH_TIPO TIPO, L.FIL_IN_CODIGO FIL, L.AGN_IN_CODIGO AGN,
             NVL(G.AGN_ST_NOME, G.AGN_ST_FANTASIA) CLIENTE, L.LOG_ST_DOCUMENTO DOC, L.LOG_ST_PARCELA PARC, L.TPD_ST_CODIGO TPD,
             L.HCOB_IN_DE DE, HD.HCOB_ST_DESCRICAO DE_NOME, L.HCOB_IN_PARA PARA, HP.HCOB_ST_DESCRICAO PARA_NOME,
             L.LIB_IN_CODIGO LIB, L.USU_IN_CODIGO USU, NVL(U.GRU_ST_NOMECOMPLETO, U.GRU_ST_NOME) USU_NOME,
             L.LOG_ST_MODULO MODULO, L.LOG_ST_PROGRAMA PROG
        FROM MEGA.CCS_TB_LOG_FORMA_REC L, MEGA.GLO_AGENTES G, MEGA.FIN_HBKCOBRANCA HD, MEGA.FIN_HBKCOBRANCA HP, MEGA.GLO_GRUPO_USUARIO U
       WHERE TRUNC(L.LOG_DT) BETWEEN TO_DATE('${ini}','YYYY-MM-DD') AND TO_DATE('${fim}','YYYY-MM-DD')
         AND G.AGN_IN_CODIGO (+) = L.AGN_IN_CODIGO
         AND HD.HCOB_IN_SEQUENCIA (+) = L.HCOB_IN_DE AND HP.HCOB_IN_SEQUENCIA (+) = L.HCOB_IN_PARA
         AND U.GRU_IN_CODIGO (+) = L.USU_IN_CODIGO
       ORDER BY L.LOG_DT DESC`);
    const trocas = rows.map(r => ({
      data: r.DT, tipo: r.TIPO, tipo_nome: TIPOS[r.TIPO] || r.TIPO, fil_id: num(r.FIL), agn_id: num(r.AGN),
      cliente: r.CLIENTE || (r.AGN ? `Cliente ${r.AGN}` : ''), documento: r.DOC || '', parcela: r.PARC || '', tpd: r.TPD || '',
      de_nome: r.DE_NOME || 'Sem forma', para_nome: r.PARA_NOME || 'Sem forma', liberacao: r.LIB ? num(r.LIB) : null,
      usuario: r.USU_NOME || (num(r.USU) ? `Usuário ${r.USU}` : 'Sistema'), origem: r.PROG || r.MODULO || ''
    }));
    const kpi = {};
    for (const k of Object.keys(TIPOS)) kpi[k] = trocas.filter(t => t.tipo === k).length;
    return { periodo: { ini, fim }, total: trocas.length, kpi, trocas };
  });
}
