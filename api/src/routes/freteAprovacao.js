// [30/10/2026 - CRIADO POR ALEXANDRE CARVALHO] Frete > 2a aprovacao (fluxo novo do frete da Quality).
// A 1a aprovacao e a do Portal de Dados da Industria (Expedicao > Aprovacao de frete / efetivacao automatica): gera o ADIANTAMENTO
// (TADFOR/938, 70% PRO ou 67% MEI com nota) bloqueado no Approvo. Aqui, quando a carga encerra, a 2a aprovacao gera o TITULO FINAL ja com
// o adiantamento vinculado e baixado (MEGA.CCS_PCK_FRETE_TIT.P_GERA_FINAL; sql/69 do repo portal-dados-quality-industria):
//   adiantamento pago -> par nativo DESCADI/AMORTADI contra o credito ADIANT; nao pago -> estorno do TADFOR e o final paga o frete
//   inteiro menos o recibo de combustivel; MEI com nota -> o final nasce na entrada da NF (aqui so registra). Tudo bloqueado na regra 41.
//
//   GET  /frete/aprovacao?dias=N  - pendentes (adiantamento gerado) + aprovados nos ultimos N dias (padrao 30)
//   POST /frete/aprovacao/:efe    - 2a aprovacao da efetivacao
import { megaQuery, megaExec } from '../soap/mega.js';

const num = v => Number(v || 0);
const oraMsg = e => {
  const m = String(e?.message || e).match(/ORA-20\d{3}:\s*([^\n]+)/);
  return m ? m[1].replace(/\s*ORA-\d+.*$/, '').trim() : null;
};

export default async function freteAprovacaoRoutes(app) {
  const guard = { preHandler: [app.authenticate] };

  app.get('/frete/aprovacao', guard, async (req) => {
    const dias = Math.min(Math.max(num(req.query.dias) || 30, 1), 365);
    const param = await megaQuery(`SELECT FLUXO_ADTO, ADTO_PCT_PRO, ADTO_PCT_MEI, FIL_PADRAO_PGTO FROM MEGA.CCS_TB_FRT_PARAM WHERE PAR_IN_CODIGO = 1`);
    const rows = await megaQuery(`
      SELECT E.EFE_IN_CODIGO AS EFE, E.ROM_IN_CODIGO_EXP AS ROM, E.FIL_IN_CODIGO AS FIL, E.FIL_PAGAMENTO AS FIL_PAG, E.MEI_FLAG AS MEI,
             TO_CHAR(R.ROM_DT_EXPEDICAO, 'YYYY-MM-DD') AS DT_EXP, SUBSTR(R.ROM_ST_DESCRICAO, 1, 80) AS DESCRICAO,
             R.ROM_IN_TRANSPORTADORA AS TRANSP,
             (SELECT MAX(NVL(A.AGN_ST_FANTASIA, A.AGN_ST_NOME)) FROM MEGA.GLO_AGENTES A WHERE A.AGN_IN_CODIGO = R.ROM_IN_TRANSPORTADORA) AS TRANSP_NOME,
             (SELECT MAX(V.CDT_ST_XNOME) FROM MEGA.VEN_CONDUTOR V WHERE V.CDT_IN_SEQUENCIA = E.CDT_IN_SEQUENCIA) AS MOTORISTA,
             E.PLACA, E.TIPO, NVL(E.VLR_APROVADO, E.FRETE_LANCADO) AS FRETE,
             CASE WHEN E.VALE_DESCONTA = 'S' THEN NVL(E.VALE_VALOR, 0) ELSE 0 END AS VALE,
             E.TIT_STATUS, E.TIT_ST_MSG, TO_CHAR(E.APROV2_DT, 'YYYY-MM-DD HH24:MI') AS APROV2_DT,
             (SELECT MAX(NVL(U.GRU_ST_NOMECOMPLETO, U.GRU_ST_NOME)) FROM MEGA.GLO_GRUPO_USUARIO U WHERE U.GRU_IN_CODIGO = E.APROV2_USU) AS APROV2_POR,
             (SELECT NVL(SUM(T.VALOR), 0) FROM MEGA.CCS_TB_FRT_TITULO T WHERE T.ROM_IN_CODIGO_EXP = E.ROM_IN_CODIGO_EXP AND T.TIPO = 'ADTO' AND T.STATUS = 'GERADO') AS ADTO,
             (SELECT NVL(SUM(T.VALOR - NVL(M.MOV_RE_SALDOCPACRE, 0)), 0) FROM MEGA.CCS_TB_FRT_TITULO T, MEGA.FIN_MOVIMENTO M
               WHERE T.ROM_IN_CODIGO_EXP = E.ROM_IN_CODIGO_EXP AND T.TIPO = 'ADTO' AND T.STATUS = 'GERADO'
                 AND M.ORG_IN_CODIGO = T.ORG_IN_CODIGO AND M.MOV_TAB_IN_CODIGO = 352 AND M.MOV_IN_NUMLANCTO = T.MOV_IN_NUMLANCTO) AS ADTO_PAGO,
             (SELECT LISTAGG(T.CPA_IN_AP || ' (' || T.FIL_IN_CODIGO || ')', ', ') WITHIN GROUP (ORDER BY T.FIL_IN_CODIGO) FROM MEGA.CCS_TB_FRT_TITULO T
               WHERE T.ROM_IN_CODIGO_EXP = E.ROM_IN_CODIGO_EXP AND T.TIPO = 'ADTO' AND T.STATUS = 'GERADO') AS ADTO_APS,
             (SELECT MIN(D.STATUS_DOCUMENTO) FROM MEGA.CCS_TB_FRT_TITULO T, MEGA.WGLO_ALCADA_DOCUMENTO D
               WHERE T.ROM_IN_CODIGO_EXP = E.ROM_IN_CODIGO_EXP AND T.TIPO = 'ADTO' AND T.STATUS = 'GERADO' AND D.DOC_IN_CODIGO = T.ALC_DOC_IN_CODIGO) AS ADTO_APPROVO
        FROM MEGA.CCS_TB_FRT_EFETIVACAO E, MEGA.CUS_TB_ROMANEIO_EXP R
       WHERE R.ROM_IN_CODIGO_EXP = E.ROM_IN_CODIGO_EXP AND E.DT_CANCELAMENTO IS NULL
         AND (E.TIT_STATUS = 'ADTO' OR (E.TIT_STATUS IN ('FINAL', 'APROV2_NF') AND E.APROV2_DT >= TRUNC(SYSDATE) - ${dias}))
       ORDER BY CASE WHEN E.TIT_STATUS = 'ADTO' THEN 0 ELSE 1 END, R.ROM_DT_EXPEDICAO, E.ROM_IN_CODIGO_EXP`);
    const p = param[0] || {};
    const filPad = num(p.FIL_PADRAO_PGTO) || 700;
    return {
      fluxo_ligado: p.FLUXO_ADTO === 'S',
      pct_pro: num(p.ADTO_PCT_PRO), pct_mei: num(p.ADTO_PCT_MEI),
      cargas: rows.map(r => {
        const frete = num(r.FRETE), vale = num(r.VALE), adto = num(r.ADTO), pago = num(r.ADTO_PAGO);
        const mei = num(r.FIL_PAG) !== filPad;
        return {
          efe: num(r.EFE), rom: num(r.ROM), fil: num(r.FIL), fil_pag: num(r.FIL_PAG), mei_nota: mei,
          dt_exp: r.DT_EXP || '', descricao: r.DESCRICAO || '', transp: num(r.TRANSP), transp_nome: r.TRANSP_NOME || '',
          motorista: r.MOTORISTA || '', placa: r.PLACA || '', tipo: r.TIPO || '',
          frete, vale, adto, adto_pago: pago, adto_aberto: Math.round((adto - pago) * 100) / 100,
          adto_aps: r.ADTO_APS || '', adto_approvo: r.ADTO_APPROVO || '',
          // previsao do saldo do titulo final (PRO): frete - recibo - parte paga do adiantamento (a nao paga e estornada)
          saldo_previsto: mei ? null : Math.round((frete - vale - pago) * 100) / 100,
          status: r.TIT_STATUS, msg: r.TIT_ST_MSG || '', aprov2_dt: r.APROV2_DT || '', aprov2_por: r.APROV2_POR || '',
        };
      }),
    };
  });

  app.post('/frete/aprovacao/:efe', {
    ...guard,
    schema: { params: { type: 'object', required: ['efe'], properties: { efe: { type: 'integer', minimum: 1 } } } },
  }, async (req, reply) => {
    const efe = num(req.params.efe);
    const usu = num(req.user.sub);
    try {
      await megaExec(`
        DECLARE vMSG VARCHAR2(4000);
        BEGIN
          MEGA.CCS_PCK_FRETE_TIT.P_GERA_FINAL(${efe}, ${usu}, vMSG);
          COMMIT;
        EXCEPTION WHEN OTHERS THEN ROLLBACK; RAISE;
        END;`);
      const r = await megaQuery(`SELECT TIT_STATUS, TIT_ST_MSG FROM MEGA.CCS_TB_FRT_EFETIVACAO WHERE EFE_IN_CODIGO = ${efe}`);
      return { ok: true, status: r[0]?.TIT_STATUS || '', mensagem: r[0]?.TIT_ST_MSG || '2a aprovacao registrada.' };
    } catch (e) {
      const msg = oraMsg(e);
      if (msg) return reply.code(400).send({ error: msg });
      throw e;
    }
  });
}
