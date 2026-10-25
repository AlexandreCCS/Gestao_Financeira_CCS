// [25/10/2026 - CRIADO POR ALEXANDRE CARVALHO] Rotas do modulo Frete > Veiculos do Gestor Financeiro CCS.
// SO LEITURA: consulta a frota cadastrada no Mega (OCPDB493). Nada e gravado.
//
// Mapeamento (levantado no banco em 25/10/2026, ver Gestor_Financeiro_CCS_Status.md):
//   VEN_VEICULO (531)            cadastro padrao do Mega: VCL_ST_PLACA, VCL_CH_TPVEIC (T tracao / R reboque),
//                                VCL_CH_TPROD (tipo de rodado: 01 Truck, 02 Toco, 03 Cavalo Mecanico, 04 VAN, 05 Utilitario,
//                                06 Outros; vazio nos reboques), VCL_CH_TPCAR (carroceria), UF, tara, capacidades, RENAVAM,
//                                VCL_ST_CINT (codigo interno - vazio em todos), PVC_IN_SEQUENCIA (proprietario - vazio em todos)
//   VEN_VEICULOCMPESP (202)      campos especificos CCS: VCL_TIPO_CAMINHAO (3/4, TOCO, TRUCK, CARRETA - usado pelo frete),
//                                VCL_CH_EXTERNO (S/N - veiculo externo), VCL_ST_CGC_RAIZ (raiz do CNPJ do dono, 'xx.xxx.xxx')
//   VEN_PROPRIETARIOVEICULO (1)  proprietario padrao do Mega (PVC_CH_TPPROP 0 agregado/1 independente/2 outros) - nao vinculado
//   GLO_ORGANIZACAO + GLO_AGENTES (TAB 53 PAD 1, AGN_IN_CODIGO = ORG_IN_CODIGO = filial): raiz do CNPJ da filial
//                                (AGN_ST_CGC ate a '/') para dizer se o dono do veiculo e a propria empresa (mesma regra do CCS_PCK_DAE)
//   CUS_TB_ROMANEIO_EXP          uso do veiculo (tracao em VCL_IN_SEQUENCIA, reboques em VCL_IN_SEQUENCIAR1..R3)
// NAO EXISTE no Mega da Quality: controle de combustivel/abastecimento por veiculo (FRO_ABASTECIMENTO* e TRA_VEICULO vazias,
// nenhuma tabela CCS de abastecimento), posto proprio e situacao cadastral do veiculo. A API devolve null nesses campos e a
// tela mostra NAO IDENTIFICADO - nunca S/N inventado.
//
// Propriedade (etiqueta): TERCEIRO = VCL_CH_EXTERNO 'S' ou proprietario padrao vinculado; PROPRIO = VCL_CH_EXTERNO 'N' e raiz do
// CNPJ igual a de uma filial; o resto = NAO IDENTIFICADO com o motivo. Obs.: a regra DAE-10 (CCS_PCK_DAE) trata o campo vazio
// como externo - aqui NAO, porque etiqueta e afirmacao, nao regra fiscal.
//
// [25/10/2026 - Alexandre Carvalho] Decisao: combustivel e posto proprio passam a ser informacao DO GESTOR (tabela propria
// CCS_TB_GFIN_VEICULO, sql/27), assim como a propriedade quando o cadastro do Mega nao diz. Mega continua intocado.
//
//   GET  /veiculos                  - frota completa (filtros, totais e paginacao no front)
//   POST /veiculos/:seq/campo       - { campo: PROPRIEDADE|COMBUSTIVEL|POSTO_PROPRIO, valor: P|T|S|N|null, motivo? } -> grava + log
//   GET  /veiculos/:seq/historico   - log de alteracoes do veiculo no Gestor
import { megaQuery, megaExec } from '../soap/mega.js';

const num = v => Number(v || 0);
const lit = (s, max) => String(s ?? '').slice(0, max).replace(/'/g, "''");
const oraMsg = e => { const m = String(e?.message || e).match(/ORA-209\d\d:\s*([^\n]+)/); return m ? m[1].replace(/\s*ORA-\d+.*$/, '').trim() : null; };
const CAMPOS = {
  PROPRIEDADE:       { coluna: 'VEI_CH_PROPRIEDADE',       valores: ['P', 'T'] },
  COMBUSTIVEL:       { coluna: 'VEI_CH_COMBUSTIVEL',       valores: ['S', 'N'] },
  POSTO_PROPRIO:     { coluna: 'VEI_CH_POSTO_PROPRIO',     valores: ['S', 'N'] },
  // [25/10/2026 - Alexandre Carvalho] vale-combustivel: valor FIXO por viagem (R$) e se desconta do frete (S/N; vazio = regra
  // padrao: terceiro desconta, frota propria nao)
  VALOR_COMBUSTIVEL: { coluna: 'VEI_RE_VALOR_COMBUSTIVEL', numerico: true },
  DESCONTA_FRETE:    { coluna: 'VEI_CH_DESCONTA_FRETE',    valores: ['S', 'N'] }
};
const PARAM_POSTO = 'FRETE_POSTO_PADRAO_AGN';

// preHandler: bloqueia quem nao for admin (mesmo padrao do admin.js)
async function adminOnly(req, reply) {
  if (req.user?.perm !== 'A') {
    return reply.code(403).send({ error: 'admin_only', message: 'Acesso restrito a administradores do Gestor Financeiro CCS.' });
  }
}

// dominios do Mega (comentarios das colunas em ALL_COL_COMMENTS)
const RODADO = { '01': 'Truck', '02': 'Toco', '03': 'Cavalo Mecânico', '04': 'VAN', '05': 'Utilitário', '06': 'Outros' };
const CARROCERIA = { '00': 'Não aplicável', '01': 'Aberta', '02': 'Fechada/Baú', '03': 'Granelera', '04': 'Porta Container', '05': 'Sider' };
const TPPROP = { '0': 'Agregado', '1': 'Independente', '2': 'Outros' };

export default async function veiculosRoutes(app) {
  const guard = { preHandler: [app.authenticate] };

  app.get('/veiculos', guard, async () => {
    const rows = await megaQuery(`
      SELECT V.VCL_IN_SEQUENCIA                                   AS SEQ,
             V.VCL_ST_PLACA                                       AS PLACA,
             V.VCL_ST_CINT                                        AS CINT,
             V.VCL_CH_TPVEIC                                      AS TPVEIC,
             V.VCL_CH_TPROD                                       AS TPROD,
             V.VCL_CH_TPCAR                                       AS TPCAR,
             V.VCL_ST_VEICUF                                      AS UF,
             V.VCL_IN_TARA                                        AS TARA,
             V.VCL_IN_CAPKG                                       AS CAPKG,
             V.VCL_IN_CAPM3                                       AS CAPM3,
             V.VCL_ST_RENAVAM                                     AS RENAVAM,
             V.PVC_IN_SEQUENCIA                                   AS PVC,
             P.PVC_ST_XNOME                                       AS PROP_NOME,
             P.PVC_CH_TPPROP                                      AS PROP_TP,
             CASE WHEN E.VCL_IN_SEQUENCIA IS NULL THEN 'N' ELSE 'S' END AS TEM_CMPESP,
             E.VCL_TIPO_CAMINHAO                                  AS TIPO_CCS,
             E.VCL_CH_EXTERNO                                     AS EXTERNO,
             E.VCL_ST_CGC_RAIZ                                    AS CGC_RAIZ,
             (SELECT MAX(F.AGN_IN_CODIGO || ' ' || F.AGN_ST_FANTASIA)
                FROM MEGA.GLO_AGENTES F
               WHERE F.AGN_TAB_IN_CODIGO = 53
                 AND F.AGN_PAD_IN_CODIGO = 1
                 AND F.AGN_IN_CODIGO IN (SELECT O.AGN_IN_CODIGO FROM MEGA.GLO_ORGANIZACAO O)
                 AND SUBSTR(F.AGN_ST_CGC, 1, INSTR(F.AGN_ST_CGC, '/') - 1) = E.VCL_ST_CGC_RAIZ) AS FILIAL_CGC,
             NVL(R.QT12, 0)                                       AS ROM_12M,
             NVL(R.QT, 0)                                         AS ROM_TOTAL,
             TO_CHAR(R.ULT, 'YYYY-MM-DD')                         AS ULT_ROM,
             G.VEI_CH_PROPRIEDADE                                 AS G_PROP,
             G.VEI_CH_COMBUSTIVEL                                 AS G_COMB,
             G.VEI_CH_POSTO_PROPRIO                               AS G_POSTO,
             G.VEI_RE_VALOR_COMBUSTIVEL                           AS G_VALOR,
             G.VEI_CH_DESCONTA_FRETE                              AS G_DESC,
             G.VEI_ST_OBS                                         AS G_OBS,
             TO_CHAR(G.VEI_DT_ALTERACAO, 'YYYY-MM-DD HH24:MI')    AS G_EM,
             G.VEI_ST_USU                                         AS G_POR
        FROM MEGA.VEN_VEICULO             V,
             MEGA.VEN_VEICULOCMPESP       E,
             MEGA.VEN_PROPRIETARIOVEICULO P,
             MEGA.CCS_TB_GFIN_VEICULO     G,
             (SELECT U.VCL,
                     COUNT(*)                                                                      QT,
                     SUM(CASE WHEN U.DT >= ADD_MONTHS(TRUNC(SYSDATE), -12) THEN 1 ELSE 0 END)     QT12,
                     MAX(U.DT)                                                                     ULT
                FROM (SELECT X.VCL_IN_SEQUENCIA   VCL, X.ROM_DT_EXPEDICAO DT FROM MEGA.CUS_TB_ROMANEIO_EXP X
                      UNION ALL
                      SELECT X.VCL_IN_SEQUENCIAR1,     X.ROM_DT_EXPEDICAO    FROM MEGA.CUS_TB_ROMANEIO_EXP X
                      UNION ALL
                      SELECT X.VCL_IN_SEQUENCIAR2,     X.ROM_DT_EXPEDICAO    FROM MEGA.CUS_TB_ROMANEIO_EXP X
                      UNION ALL
                      SELECT X.VCL_IN_SEQUENCIAR3,     X.ROM_DT_EXPEDICAO    FROM MEGA.CUS_TB_ROMANEIO_EXP X) U
               WHERE U.VCL IS NOT NULL
               GROUP BY U.VCL) R
       WHERE E.VCL_IN_SEQUENCIA (+) = V.VCL_IN_SEQUENCIA
         AND P.PVC_IN_SEQUENCIA (+) = V.PVC_IN_SEQUENCIA
         AND G.VCL_IN_SEQUENCIA (+) = V.VCL_IN_SEQUENCIA
         AND R.VCL              (+) = V.VCL_IN_SEQUENCIA
       ORDER BY V.VCL_ST_PLACA`);

    return {
      // o que o Mega NAO tem - a tela avisa; o que falta e informado no proprio Gestor (CCS_TB_GFIN_VEICULO)
      limitacoes: {
        combustivel_controlado: 'O Mega da Quality não tem controle de combustível por veículo (FRO_ABASTECIMENTO e TRA_VEICULO vazias, sem tabela CCS). A informação é do Gestor: marque Sim/Não na linha do veículo.',
        posto_proprio:          'O Mega não registra abastecimento em posto próprio. A informação é do Gestor: marque Sim/Não na linha do veículo.',
        propriedade:            'No Mega só 4 veículos têm o campo "veículo externo" preenchido. Quando o Mega não diz, a propriedade pode ser informada no Gestor (painel de detalhe).',
        situacao_cadastral:     'O cadastro de veículos do Mega (VEN_VEICULO/VEN_VEICULOCMPESP) não tem campo de situação (ativo/inativo). A coluna "Uso" mostra os romaneios de expedição, que é o dado real disponível.'
      },
      veiculos: rows.map(r => {
        const tpveic = r.TPVEIC === 'R' ? 'Reboque' : r.TPVEIC === 'T' ? 'Tração' : '';
        const rodado = r.TPROD ? (RODADO[r.TPROD] || `Rodado ${r.TPROD}`) : '';
        const carroceria = r.TPCAR ? (CARROCERIA[r.TPCAR] || `Carroceria ${r.TPCAR}`) : '';
        const prop = propriedade(r);
        return {
          seq:         num(r.SEQ),
          placa:       r.PLACA || '',
          cint:        r.CINT || '',
          tpveic:      r.TPVEIC || '',          // T | R
          tpveic_desc: tpveic,
          tprod:       r.TPROD || '',
          tipo_mega:   rodado,                   // classificacao padrao do Mega (tipo de rodado) - vazia nos reboques
          tpcar:       r.TPCAR || '',
          carroceria,
          tipo_ccs:    r.TIPO_CCS || '',          // classificacao CCS usada pelo frete (3/4, TOCO, TRUCK, CARRETA)
          uf:          r.UF || '',
          tara:        r.TARA == null || r.TARA === '' ? null : num(r.TARA),
          capkg:       r.CAPKG == null || r.CAPKG === '' ? null : num(r.CAPKG),
          capm3:       r.CAPM3 == null || r.CAPM3 === '' ? null : num(r.CAPM3),
          renavam:     r.RENAVAM || '',
          tem_cmpesp:  r.TEM_CMPESP === 'S',
          externo:     r.EXTERNO || '',           // S | N | ''
          cgc_raiz:    r.CGC_RAIZ || '',
          filial_cgc:  r.FILIAL_CGC || '',
          prop_mega:   r.PVC ? { nome: r.PROP_NOME || '', tipo: TPPROP[r.PROP_TP] || r.PROP_TP || '' } : null,
          propriedade: prop.valor,               // PROPRIO | TERCEIRO | NI
          propriedade_motivo: prop.motivo,
          propriedade_fonte: prop.fonte,         // MEGA | GESTOR | ''
          // informacoes do Gestor (CCS_TB_GFIN_VEICULO): true/false quando informadas, null = NAO IDENTIFICADO
          combustivel:   r.G_COMB  === 'S' ? true : r.G_COMB  === 'N' ? false : null,
          posto_proprio: r.G_POSTO === 'S' ? true : r.G_POSTO === 'N' ? false : null,
          gestor: { propriedade: r.G_PROP || '', obs: r.G_OBS || '', em: r.G_EM || '', por: r.G_POR || '' },
          // vale-combustivel (Gestor): valor fixo por viagem; desconta do frete = marcado no veiculo ou regra padrao pela propriedade
          vale_valor:     r.G_VALOR == null || r.G_VALOR === '' ? null : num(r.G_VALOR),
          desconta_frete: r.G_DESC || '',                                        // S | N | '' (padrao)
          desconta_efetivo: r.G_DESC || (prop.valor === 'TERCEIRO' ? 'S' : prop.valor === 'PROPRIO' ? 'N' : ''),
          situacao:    null,                     // sem campo no Mega
          rom_12m:     num(r.ROM_12M),
          rom_total:   num(r.ROM_TOTAL),
          ult_rom:     r.ULT_ROM || ''
        };
      })
    };
  });

  // Grava uma informacao do Gestor sobre o veiculo (MERGE) + log de/para. valor null = limpa (volta a NAO IDENTIFICADO)
  app.post('/veiculos/:seq/campo', {
    ...guard,
    schema: {
      params: { type: 'object', required: ['seq'], properties: { seq: { type: 'integer', minimum: 1 } } },
      body: { type: 'object', required: ['campo'],
              properties: { campo: { type: 'string', enum: Object.keys(CAMPOS) },
                            valor: { type: ['string', 'number', 'null'], maxLength: 20 },
                            motivo: { type: 'string', maxLength: 200 } } }
    }
  }, async (req, reply) => {
    const seq = num(req.params.seq);
    const def = CAMPOS[req.body.campo];
    let valor = null, v = 'NULL';
    if (def.numerico) {
      if (req.body.valor !== null && req.body.valor !== '' && req.body.valor !== undefined) {
        valor = Math.round(Number(req.body.valor) * 100) / 100;
        if (!Number.isFinite(valor) || valor < 0 || valor > 99999) return reply.code(400).send({ error: `Valor inválido para ${req.body.campo}: informe um valor em reais.` });
        v = String(valor);
      }
    } else {
      valor = req.body.valor ? String(req.body.valor).toUpperCase() : null;
      if (valor && !def.valores.includes(valor)) return reply.code(400).send({ error: `Valor inválido para ${req.body.campo}: use ${def.valores.join(' ou ')}.` });
      v = valor ? `'${valor}'` : 'NULL';
    }
    const motivo = String(req.body.motivo || '').trim();
    try {
      await megaExec(`
        DECLARE
          V_QTD NUMBER; V_DE VARCHAR2(60);
        BEGIN
          SELECT COUNT(*) INTO V_QTD FROM MEGA.VEN_VEICULO V WHERE V.VCL_IN_SEQUENCIA = ${seq};
          IF V_QTD = 0 THEN
            RAISE_APPLICATION_ERROR(-20921, 'VEICULO ${seq} NAO ENCONTRADO NO CADASTRO DO MEGA.');
          END IF;
          SELECT MAX(TO_CHAR(G.${def.coluna})) INTO V_DE FROM MEGA.CCS_TB_GFIN_VEICULO G WHERE G.VCL_IN_SEQUENCIA = ${seq};
          IF NVL(V_DE, '-') = NVL(TO_CHAR(${v}), '-') THEN
            RAISE_APPLICATION_ERROR(-20922, 'VEICULO JA ESTA COM ESSE VALOR.');
          END IF;

          MERGE INTO MEGA.CCS_TB_GFIN_VEICULO D
          USING (SELECT ${seq} VCL FROM DUAL) S
          ON (D.VCL_IN_SEQUENCIA = S.VCL)
          WHEN MATCHED THEN UPDATE SET D.${def.coluna} = ${v}, D.VEI_DT_ALTERACAO = SYSDATE,
                                       D.VEI_IN_USU = ${num(req.user.sub)}, D.VEI_ST_USU = '${lit(req.user.login, 60)}'
          WHEN NOT MATCHED THEN INSERT (VCL_IN_SEQUENCIA, ${def.coluna}, VEI_DT_ALTERACAO, VEI_IN_USU, VEI_ST_USU)
               VALUES (S.VCL, ${v}, SYSDATE, ${num(req.user.sub)}, '${lit(req.user.login, 60)}');

          INSERT INTO MEGA.CCS_TB_GFIN_VEICULO_LOG
            (LOG_IN_CODIGO, VCL_IN_SEQUENCIA, LOG_ST_CAMPO, LOG_ST_DE, LOG_ST_PARA, LOG_ST_MOTIVO, LOG_IN_USU, LOG_ST_USU)
          VALUES
            (MEGA.CCS_SEQ_GFIN_VEICULO_LOG.NEXTVAL, ${seq}, '${req.body.campo}', V_DE, TO_CHAR(${v}),
             ${motivo ? `'${lit(motivo, 200)}'` : 'NULL'}, ${num(req.user.sub)}, '${lit(req.user.login, 60)}');
          COMMIT;
        END;`);
      return { ok: true, seq, campo: req.body.campo, valor };
    } catch (e) {
      const msg = oraMsg(e);
      if (msg) return reply.code(400).send({ error: msg });
      throw e;
    }
  });

  app.get('/veiculos/:seq/historico', guard, async (req) => {
    const seq = num(req.params.seq);
    const rows = await megaQuery(`
      SELECT L.LOG_IN_CODIGO AS ID, L.LOG_ST_CAMPO AS CAMPO, L.LOG_ST_DE AS DE, L.LOG_ST_PARA AS PARA, L.LOG_ST_MOTIVO AS MOTIVO,
             NVL(NVL(U.GRU_ST_NOMECOMPLETO, U.GRU_ST_NOME), L.LOG_ST_USU) AS USUARIO,
             TO_CHAR(L.LOG_DT_DATA, 'YYYY-MM-DD HH24:MI') AS QUANDO
        FROM MEGA.CCS_TB_GFIN_VEICULO_LOG L, MEGA.GLO_GRUPO_USUARIO U
       WHERE L.VCL_IN_SEQUENCIA = ${seq}
         AND U.GRU_IN_CODIGO (+) = L.LOG_IN_USU
       ORDER BY L.LOG_IN_CODIGO DESC
       FETCH FIRST 200 ROWS ONLY`);
    const brl = v => Number(String(v).replace(',', '.')).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const rot = (c, v) => !v ? '—' : c === 'VALOR_COMBUSTIVEL' ? brl(v) : ({ S: 'Sim', N: 'Não', P: 'Próprio', T: 'Terceiro' }[v] || v);
    const campo = c => ({ PROPRIEDADE: 'Propriedade', COMBUSTIVEL: 'Combustível controlado', POSTO_PROPRIO: 'Posto próprio',
                          VALOR_COMBUSTIVEL: 'Vale-combustível (R$)', DESCONTA_FRETE: 'Desconta do frete' }[c] || c);
    return { historico: rows.map(r => ({ id: num(r.ID), campo: campo(r.CAMPO), de: rot(r.CAMPO, r.DE), para: rot(r.CAMPO, r.PARA), motivo: r.MOTIVO || '', usuario: r.USUARIO || '—', quando: r.QUANDO })) };
  });

  // Parametros da tela (engrenagem): posto padrao do vale-combustivel = agente FORNECEDOR do Mega (GLO_AGENTES_ID TAU 'F').
  // GET aberto a autenticados; PUT so admin. Historico pela trigger CCS_T_GFIN_PARAM_HIST (sql/13).
  app.get('/veiculos/parametros', guard, async () => {
    const rows = await megaQuery(`
      SELECT P.PARAM_RE_VALOR AS AGN,
             TO_CHAR(P.PARAM_DT_ALTERACAO, 'YYYY-MM-DD HH24:MI') AS ALTERADO_EM,
             P.PARAM_ST_USU AS ALTERADO_POR,
             (SELECT MAX(NVL(A.AGN_ST_FANTASIA, A.AGN_ST_NOME)) FROM MEGA.GLO_AGENTES A WHERE A.AGN_IN_CODIGO = P.PARAM_RE_VALOR) AS NOME,
             (SELECT MAX(A.AGN_ST_CGC) FROM MEGA.GLO_AGENTES A WHERE A.AGN_IN_CODIGO = P.PARAM_RE_VALOR) AS CGC
        FROM MEGA.CCS_TB_GFIN_PARAM P
       WHERE P.PARAM_ST_CHAVE = '${PARAM_POSTO}'`);
    const r = rows[0];
    const agn = num(r?.AGN);
    return { posto_padrao: agn ? { agn, nome: r.NOME || `Agente ${agn}`, cgc: r.CGC || '' } : null,
             alterado_em: r?.ALTERADO_EM || null, alterado_por: r?.ALTERADO_POR || null };
  });

  app.get('/veiculos/parametros/historico', guard, async () => {
    const rows = await megaQuery(`
      SELECT H.HIST_RE_VALOR_ANT AS DE, H.HIST_RE_VALOR_NOVO AS PARA,
             (SELECT MAX(NVL(A.AGN_ST_FANTASIA, A.AGN_ST_NOME)) FROM MEGA.GLO_AGENTES A WHERE A.AGN_IN_CODIGO = H.HIST_RE_VALOR_ANT)  AS DE_NOME,
             (SELECT MAX(NVL(A.AGN_ST_FANTASIA, A.AGN_ST_NOME)) FROM MEGA.GLO_AGENTES A WHERE A.AGN_IN_CODIGO = H.HIST_RE_VALOR_NOVO) AS PARA_NOME,
             NVL(NVL(U.GRU_ST_NOMECOMPLETO, U.GRU_ST_NOME), H.HIST_ST_USU) AS USUARIO,
             TO_CHAR(H.HIST_DT_ALTERACAO, 'YYYY-MM-DD HH24:MI') AS QUANDO
        FROM MEGA.CCS_TB_GFIN_PARAM_HIST H, MEGA.GLO_GRUPO_USUARIO U
       WHERE H.PARAM_ST_CHAVE = '${PARAM_POSTO}' AND U.GRU_IN_CODIGO (+) = H.HIST_IN_USU
       ORDER BY H.HIST_IN_CODIGO DESC FETCH FIRST 200 ROWS ONLY`);
    const nome = (agn, n) => (num(agn) ? `${num(agn)} ${n || ''}`.trim() : null);
    return { historico: rows.map(r => ({ parametro: 'Posto padrão', de: nome(r.DE, r.DE_NOME), para: nome(r.PARA, r.PARA_NOME) || '—', usuario: r.USUARIO || '—', quando: r.QUANDO })) };
  });

  app.put('/veiculos/parametros', {
    preHandler: [app.authenticate, adminOnly],
    schema: { body: { type: 'object', required: ['posto_padrao_agn'], properties: { posto_padrao_agn: { type: 'integer', minimum: 0 } } } }
  }, async (req, reply) => {
    const agn = num(req.body.posto_padrao_agn);
    if (agn) {
      const ok = await megaQuery(`
        SELECT COUNT(*) QT FROM MEGA.GLO_AGENTES A, MEGA.GLO_AGENTES_ID I
         WHERE A.AGN_IN_CODIGO = ${agn} AND I.AGN_IN_CODIGO = A.AGN_IN_CODIGO AND I.AGN_TAB_IN_CODIGO = A.AGN_TAB_IN_CODIGO
           AND I.AGN_PAD_IN_CODIGO = A.AGN_PAD_IN_CODIGO AND I.AGN_TAU_ST_CODIGO = 'F'`);
      if (!num(ok[0]?.QT)) return reply.code(400).send({ error: `O agente ${agn} não é fornecedor no Mega.` });
    }
    await megaExec(`
      BEGIN
        UPDATE MEGA.CCS_TB_GFIN_PARAM
           SET PARAM_RE_VALOR = ${agn}, PARAM_DT_ALTERACAO = SYSDATE,
               PARAM_IN_USU = ${num(req.user.sub)}, PARAM_ST_USU = '${lit(req.user.login, 60)}'
         WHERE PARAM_ST_CHAVE = '${PARAM_POSTO}' AND PARAM_RE_VALOR <> ${agn};
        COMMIT;
      END;`);
    return { ok: true, posto_padrao_agn: agn };
  });

  // Busca de fornecedor (posto) por codigo ou trecho do nome/fantasia
  app.get('/veiculos/fornecedores', guard, async (req) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return { fornecedores: [] };
    const cond = /^\d+$/.test(q) ? `A.AGN_IN_CODIGO = ${num(q)}`
      : `(UPPER(A.AGN_ST_NOME) LIKE '%${lit(q.toUpperCase(), 60)}%' OR UPPER(A.AGN_ST_FANTASIA) LIKE '%${lit(q.toUpperCase(), 60)}%')`;
    const rows = await megaQuery(`
      SELECT * FROM (
        SELECT A.AGN_IN_CODIGO AGN, NVL(A.AGN_ST_FANTASIA, A.AGN_ST_NOME) NOME, A.AGN_ST_NOME RAZAO, A.AGN_ST_CGC CGC
          FROM MEGA.GLO_AGENTES A, MEGA.GLO_AGENTES_ID I
         WHERE I.AGN_IN_CODIGO = A.AGN_IN_CODIGO AND I.AGN_TAB_IN_CODIGO = A.AGN_TAB_IN_CODIGO
           AND I.AGN_PAD_IN_CODIGO = A.AGN_PAD_IN_CODIGO AND I.AGN_TAU_ST_CODIGO = 'F'
           AND ${cond}
         ORDER BY A.AGN_ST_NOME)
       WHERE ROWNUM <= 20`);
    return { fornecedores: rows.map(r => ({ agn: num(r.AGN), nome: r.NOME || '', razao: r.RAZAO || '', cgc: r.CGC || '' })) };
  });
}

// Etiqueta de propriedade: primeiro o cadastro do Mega (campos reais); se o Mega nao diz, o que foi informado no Gestor
function propriedade(r) {
  if (r.EXTERNO === 'S')
    return { valor: 'TERCEIRO', fonte: 'MEGA', motivo: 'Mega: campo específico "veículo externo" = S' };
  if (r.PVC)
    return { valor: 'TERCEIRO', fonte: 'MEGA', motivo: `Mega: proprietário cadastrado ${r.PROP_NOME || r.PVC} (${TPPROP[r.PROP_TP] || r.PROP_TP || 'tipo não informado'})` };
  if (r.EXTERNO === 'N' && r.CGC_RAIZ && r.FILIAL_CGC)
    return { valor: 'PROPRIO', fonte: 'MEGA', motivo: `Mega: veículo externo = N e raiz do CNPJ ${r.CGC_RAIZ} = filial ${r.FILIAL_CGC}` };
  if (r.G_PROP === 'P' || r.G_PROP === 'T')
    return { valor: r.G_PROP === 'P' ? 'PROPRIO' : 'TERCEIRO', fonte: 'GESTOR', motivo: `Informado no Gestor por ${r.G_POR || '—'} em ${r.G_EM || '—'}` };
  if (r.EXTERNO === 'N') {
    if (r.CGC_RAIZ)
      return { valor: 'NI', fonte: '', motivo: `Mega: veículo externo = N, mas a raiz do CNPJ ${r.CGC_RAIZ} não é de nenhuma filial` };
    return { valor: 'NI', fonte: '', motivo: 'Mega: veículo externo = N, sem raiz do CNPJ do dono' };
  }
  return { valor: 'NI', fonte: '', motivo: r.TEM_CMPESP === 'S'
    ? 'Mega: campo "veículo externo" não preenchido nos campos específicos'
    : 'Mega: veículo sem campos específicos (só o cadastro padrão)' };
}
