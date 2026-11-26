// [26/11/2026 - CRIADO POR ALEXANDRE CARVALHO] Baixas/Conciliacao > CALCULADORA DE JUROS E MULTA (Quality).
//   GET /calculadora-juros/titulos?doc=68703 - parcelas do contas a receber com saldo em aberto daquele documento,
//        com cliente e os encargos gravados no titulo (variacao do CR, FIN_CONTASRECEBER):
//        CRE_RE_PERCJUROSEFET (% juros ao mes), CRE_RE_VRMORAEFET (mora por dia, R$), CRE_RE_PERCMULTAEFET (% multa),
//        CRE_RE_VRMULTAEFET (multa, R$), CRE_DT_DTBASEMULTA (data base da multa).
// Conferido no titulo 68703/001 (fil 200, 3.030,88): mora 5,0515/dia x 310 dias (prorrogado 20/01 -> 26/11) = juros 1.565,96
// do Mega; multa 60,6176 -> 60,62. A conta (dias, proporcao, valor da baixa) fica no front. Somente leitura.
import { megaQuery } from '../soap/mega.js';

const MOD = 'BAIXAS_CONCILIACAO';
const temModulo = (u, cod) => u?.perm === 'A' || (u?.modulos || []).some(m => m.codigo === cod);
const num = v => Number(v || 0);

export default async function calculadoraJurosRoutes(app) {
  const guard = { preHandler: [app.authenticate] };

  app.get('/calculadora-juros/titulos', guard, async (req, reply) => {
    if (!temModulo(req.user, MOD)) return reply.code(403).send({ error: 'sem_modulo', message: 'Seu usuario nao tem o modulo Baixas/Conciliacao.' });
    const doc = String(req.query?.doc || '').trim().toUpperCase();
    if (!/^[0-9A-Z\-\/\.]{1,30}$/.test(doc)) return reply.code(400).send({ error: 'doc_invalido', message: 'Informe o numero do titulo.' });
    const rows = await megaQuery(`
      SELECT C.ORG_IN_CODIGO                              AS ORG,
             C.FIL_IN_CODIGO                              AS FIL,
             C.MOV_IN_NUMLANCTO                           AS LANC,
             C.MOV_ST_DOCUMENTO                           AS DOC,
             C.MOV_ST_PARCELA                             AS PARC,
             C.TPD_ST_CODIGO                              AS TPD,
             C.AGN_IN_CODIGO                              AS AGN,
             NVL(G.AGN_ST_NOME, G.AGN_ST_FANTASIA)        AS CLIENTE,
             G.AGN_ST_FANTASIA                            AS FANTASIA,
             SUBSTR(NVL(C.HCOB_ST_DESCRICAO, ''), 1, 60)  AS FORMA_RECEB,
             TO_CHAR(C.MOV_DT_DATADOCTO, 'YYYY-MM-DD')    AS EMISSAO,
             TO_CHAR(C.MOV_DT_VENCTO,    'YYYY-MM-DD')    AS VENCTO,
             TO_CHAR(C.MOV_DT_PRORROGADO,'YYYY-MM-DD')    AS PRORROGADO,
             TO_CHAR(C.CRE_DT_DTBASEMULTA,'YYYY-MM-DD')   AS DT_MULTA,
             C.MOV_RE_VALOR                               AS VALOR,
             C.SALDO_EM_ABERTO                            AS SALDO,
             NVL(C.CRE_RE_PERCJUROSEFET, 0)               AS PJ,
             NVL(C.CRE_RE_VRMORAEFET, 0)                  AS VMORA,
             NVL(C.CRE_RE_PERCMULTAEFET, 0)               AS PM,
             NVL(C.CRE_RE_VRMULTAEFET, 0)                 AS VMULTA,
             TO_CHAR(SYSDATE, 'YYYY-MM-DD')               AS HOJE
        FROM MEGA.FIN_VW_CONTASRECEBER C,
             MEGA.GLO_AGENTES          G
       WHERE UPPER(C.MOV_ST_DOCUMENTO) = '${doc.replace(/'/g, "''")}'
         AND C.SALDO_EM_ABERTO > 0
         AND G.AGN_IN_CODIGO (+) = C.AGN_IN_CODIGO
       ORDER BY C.FIL_IN_CODIGO, C.MOV_ST_PARCELA
       FETCH FIRST 60 ROWS ONLY`);
    return {
      titulos: rows.map(r => ({
        org: num(r.ORG), fil: num(r.FIL), lanc: num(r.LANC), doc: r.DOC, parcela: r.PARC, tpd: r.TPD,
        agn: num(r.AGN), cliente: r.CLIENTE || '', fantasia: r.FANTASIA || '', forma: r.FORMA_RECEB || '',
        emissao: r.EMISSAO, vencto: r.VENCTO, prorrogado: r.PRORROGADO, dtMulta: r.DT_MULTA || null,
        valor: num(r.VALOR), saldo: num(r.SALDO),
        percJuros: num(r.PJ), moraDia: num(r.VMORA), percMulta: num(r.PM), vrMulta: num(r.VMULTA), hoje: r.HOJE,
      })),
    };
  });
}
