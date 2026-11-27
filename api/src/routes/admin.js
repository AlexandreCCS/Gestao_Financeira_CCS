// [14/05/2026 - CRIADO POR ALEXANDRE CARVALHO] Rotas de Administracao de Usuarios
// do Gestor Financeiro CCS. Todas exigem perm='A' (admin).
//   GET  /admin/modulos          - catalogo de modulos do portal
//   GET  /admin/usuarios         - usuarios com acesso + perm + modulos liberados
//   PUT  /admin/usuarios/:gru    - grava perm (A/U) + modulos liberados do usuario
import { megaQuery, megaExec } from '../soap/mega.js';

// preHandler: bloqueia quem nao for admin
async function adminOnly(req, reply) {
  if (req.user?.perm !== 'A') {
    return reply.code(403).send({
      error: 'admin_only',
      message: 'Acesso restrito a administradores do Gestor Financeiro CCS.'
    });
  }
}

export default async function adminRoutes(app) {
  const guard = { preHandler: [app.authenticate, adminOnly] };

  // Catalogo de modulos do portal -------------------------------------------
  app.get('/admin/modulos', guard, async () => {
    const rows = await megaQuery(
      `SELECT MOD_ST_CODIGO, MOD_ST_NOME, MOD_IN_ORDEM, MOD_CH_ATIVO
         FROM MEGA.CCS_TB_GFIN_MODULO
        ORDER BY MOD_IN_ORDEM`);
    return rows.map(r => ({
      codigo: r.MOD_ST_CODIGO,
      nome:   r.MOD_ST_NOME,
      ordem:  Number(r.MOD_IN_ORDEM),
      ativo:  r.MOD_CH_ATIVO === 'S'
    }));
  });

  // Usuarios com acesso (A/U) + perm + modulos liberados --------------------
  app.get('/admin/usuarios', guard, async () => {
    const rows = await megaQuery(
      `SELECT U.GRU_IN_CODIGO, U.GRU_ST_NOME, U.GRU_ST_NOMECOMPLETO,
              C.GRU_CH_GFIN_CCS AS PERM, U.GRU_CH_STATUS
         FROM MEGA.GLO_GRUPO_USUARIO       U,
              MEGA.GLO_GRUPO_USUARIOCMPESP C
        WHERE U.GRU_IN_CODIGO = C.GRU_IN_CODIGO
          AND C.GRU_CH_GFIN_CCS IN ('A','U')
        ORDER BY C.GRU_CH_GFIN_CCS, U.GRU_ST_NOME`);
    const perms = await megaQuery(
      `SELECT GRU_IN_CODIGO, MOD_ST_CODIGO FROM MEGA.CCS_TB_GFIN_PERM_USU`);
    const byUser = {};
    for (const p of perms) {
      (byUser[p.GRU_IN_CODIGO] ||= []).push(p.MOD_ST_CODIGO);
    }
    return rows.map(r => ({
      gru:     Number(r.GRU_IN_CODIGO),
      login:   r.GRU_ST_NOME,
      nome:    r.GRU_ST_NOMECOMPLETO,
      perm:    r.PERM,                         // 'A' | 'U'
      ativo:   r.GRU_CH_STATUS === 'A',        // status do usuario no Mega
      modulos: byUser[r.GRU_IN_CODIGO] || []   // ignorado para perm='A' (ve tudo)
    }));
  });

  // Grava perm + modulos liberados de um usuario ----------------------------
  app.put('/admin/usuarios/:gru', {
    ...guard,
    schema: {
      body: {
        type: 'object', required: ['perm', 'modulos'],
        properties: {
          perm:    { type: 'string', enum: ['A', 'U'] },
          modulos: { type: 'array', items: { type: 'string' } }
        }
      }
    }
  }, async (req, reply) => {
    const gru = parseInt(req.params.gru, 10);
    if (!gru) return reply.code(400).send({ error: 'gru_invalido' });
    const { perm, modulos } = req.body;
    const adminGru = parseInt(req.user.sub, 10);

    // trava anti-lockout: admin nao pode se rebaixar
    if (gru === adminGru && perm !== 'A') {
      return reply.code(400).send({
        error: 'auto_rebaixar',
        message: 'Voce nao pode remover seu proprio acesso de administrador.'
      });
    }

    // confirma que o alvo realmente tem acesso ao portal (A/U)
    const alvo = await megaQuery(
      `SELECT NVL(C.GRU_CH_GFIN_CCS,'N') AS PERM
         FROM MEGA.GLO_GRUPO_USUARIOCMPESP C WHERE C.GRU_IN_CODIGO = ${gru}`);
    if (!alvo.length || !['A', 'U'].includes(alvo[0].PERM)) {
      return reply.code(404).send({
        error: 'sem_acesso',
        message: 'Usuario nao possui acesso ao portal (GRU_CH_GFIN_CCS).'
      });
    }

    // so grava modulos que existem e estao ativos no catalogo
    const cat = await megaQuery(
      `SELECT MOD_ST_CODIGO FROM MEGA.CCS_TB_GFIN_MODULO WHERE MOD_CH_ATIVO='S'`);
    const validos = new Set(cat.map(r => r.MOD_ST_CODIGO));
    const mods = [...new Set(modulos)].filter(m => validos.has(m));

    // bloco PL/SQL atomico: atualiza a flag + regrava CCS_TB_GFIN_PERM_USU.
    // perm='A' nao grava linhas (admin ve tudo via getModulosUsuario).
    const inserts = perm === 'A' ? '' : mods.map(m =>
      `  INSERT INTO MEGA.CCS_TB_GFIN_PERM_USU (GRU_IN_CODIGO, MOD_ST_CODIGO, PERM_IN_USU_INC) ` +
      `VALUES (${gru}, '${m}', ${adminGru});`).join('\n');
    const plsql = `BEGIN
  UPDATE MEGA.GLO_GRUPO_USUARIOCMPESP SET GRU_CH_GFIN_CCS = '${perm}' WHERE GRU_IN_CODIGO = ${gru};
  DELETE FROM MEGA.CCS_TB_GFIN_PERM_USU WHERE GRU_IN_CODIGO = ${gru};
${inserts}
  COMMIT;
END;`;
    await megaExec(plsql);

    return { ok: true, gru, perm, modulos: perm === 'A' ? 'ALL' : mods };
  });
}
