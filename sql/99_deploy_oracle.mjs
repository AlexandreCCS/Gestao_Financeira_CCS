// [05/05/2026 - Alexandre Carvalho] Deploy dos artefatos Oracle do Gestor Financeiro
// 00_permissao.sql       - DDL simples (split por ;) - rodar uma unica vez
// 01_pck_fluxo_caixa.sql - PL/SQL (split por linha '/')
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import url from 'node:url';

const HOST  = 'apiquality1.ccstecno.com.br';
const BANCO = 'OCPDB493';
const USU   = process.env.MEGA_SOAP_USUARIO || 'MEGA';
const SEN   = process.env.MEGA_SOAP_SENHA   || 'krEuUzN2Xo';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const FILES = [
  // 00_permissao.sql apenas no primeiro deploy. Comente apos o primeiro run para evitar erro
  // "ORA-01430 a coluna ja existe" - nao quebra deploy mas polui o log.
  { f: '00_permissao.sql',           mode: 'semi'  },
  { f: '01_pck_fluxo_caixa.sql',     mode: 'slash' },
  { f: '02_pck_saldos_banco.sql',    mode: 'slash' },
  { f: '03_pck_conciliacao.sql',     mode: 'slash' },
  { f: '04_pck_fluxo_previo.sql',    mode: 'slash' },
  { f: '05_pck_fluxo_previo_func.sql', mode: 'slash' },
  // [14/05/2026 - Alexandre Carvalho] 06 estava faltando na lista de deploy
  { f: '06_pck_gfin_docs.sql',       mode: 'slash' },
  // [14/05/2026 - Alexandre Carvalho] admin de permissoes (tabelas + seed)
  { f: '07_admin_permissoes.sql',    mode: 'slash' },
  // [14/05/2026 - Alexandre Carvalho] modulo Inadimplencia no catalogo
  { f: '08_inadimplencia_modulo.sql', mode: 'slash' },
  // [14/05/2026 - Alexandre Carvalho] Inadimplencia > Bloqueios: log + logger.
  // Obs: a instrumentacao das procedures CCS_P_BLOQUEIA_CLIENTE / _RESERVA e
  // feita a parte (deploy_bloqueios.mjs) - sao objetos core da Quality.
  { f: '09_inadimplencia_bloqueios.sql', mode: 'slash' },
  // [14/05/2026 - Alexandre Carvalho] Inteligencia de Credito Fase 1.1:
  // modelo de dados + snapshot diario da carteira + job DBMS_SCHEDULER.
  { f: '10_credito_snapshot.sql',     mode: 'slash' },
  // [14/05/2026 - Alexandre Carvalho] Inteligencia de Credito Fase 1.2:
  // refresh da estatistica nativa (FIN_PCK_ESTATISTICA) + motor de score.
  { f: '11_credito_score.sql',        mode: 'slash' },
  // [14/05/2026 - Alexandre Carvalho] modulo Inteligencia de Credito no catalogo
  { f: '12_credito_modulo.sql',       mode: 'slash' }
];

function escXml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function postSOAP(op, sql) {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/">
  <soap:Body><tem:${op}><tem:Banco>${BANCO}</tem:Banco><tem:Usuario>${USU}</tem:Usuario>
  <tem:Senha>${SEN}</tem:Senha><tem:QuerySQL>${escXml(sql)}</tem:QuerySQL></tem:${op}></soap:Body></soap:Envelope>`;
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: HOST, path: '/webService.asmx', method: 'POST',
      headers: {
        'Content-Type':'text/xml; charset=utf-8',
        'SOAPAction':`http://tempuri.org/${op}`,
        'Content-Length':Buffer.byteLength(body)
      }, timeout: 90_000
    }, res => {
      let chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

function checkErr(xml) {
  const m = xml.match(/<(ERRO|MENSAGEM)>([\s\S]*?)<\/\1>/);
  if (!m) return null;
  const t = m[2].trim();
  return /^(OK|Sucesso|Success)/i.test(t) ? null : t;
}

function stripComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--.*$/gm, '');
}

function splitBySemi(sql) {
  const clean = stripComments(sql);
  const out = []; let buf = ''; let inStr = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (c === "'" && clean[i-1] !== '\\') inStr = !inStr;
    if (c === ';' && !inStr) {
      if (buf.trim()) out.push(buf.trim());
      buf = '';
    } else { buf += c; }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

function splitBySlash(sql) {
  return sql.split(/^\s*\/\s*$/m).map(b => b.trim()).filter(Boolean);
}

async function execStmt(stmt) {
  const xml = await postSOAP('ExecuteNonQuery', `BEGIN EXECUTE IMMEDIATE q'~${stmt}~'; END;`);
  const err = checkErr(xml);
  if (err && !/ORA-24344|ORA-01430|ORA-00955/.test(err)) throw new Error(err);
  if (err && /ORA-24344/.test(err)) console.log('  (compilou com warnings)');
  if (err && /ORA-01430|ORA-00955/.test(err)) console.log('  (objeto ja existe, ignorado)');
}

async function recompila() {
  console.log('\n==> Recompilando invalidos do schema MEGA...');
  await postSOAP('ExecuteNonQuery', `BEGIN DBMS_UTILITY.COMPILE_SCHEMA(SCHEMA=>'MEGA', COMPILE_ALL=>FALSE); END;`);
  const xml = await postSOAP('GetDataSet',
    `SELECT OBJECT_NAME, OBJECT_TYPE FROM ALL_OBJECTS
      WHERE OWNER='MEGA' AND STATUS='INVALID'
        AND (OBJECT_NAME LIKE 'CCS_%GFIN%' OR OBJECT_NAME LIKE 'CCS_TY_GFIN%')
      ORDER BY 2,1`);
  const rows = [...xml.matchAll(/<OBJECT_NAME>([^<]+)<\/OBJECT_NAME>\s*<OBJECT_TYPE>([^<]+)<\/OBJECT_TYPE>/g)]
                 .map(m => `${m[2]}: ${m[1]}`);
  if (rows.length) {
    console.log('XX restou invalido:'); rows.forEach(r => console.log('  -', r));
    // imprime erros
    for (const m of [...xml.matchAll(/<OBJECT_NAME>([^<]+)<\/OBJECT_NAME>/g)]) {
      const e = await postSOAP('GetDataSet', `SELECT LINE,POSITION,TEXT FROM ALL_ERRORS WHERE OWNER='MEGA' AND NAME='${m[1]}' ORDER BY SEQUENCE`);
      [...e.matchAll(/<LINE>([^<]+)<\/LINE>\s*<POSITION>([^<]+)<\/POSITION>\s*<TEXT>([^<]+)<\/TEXT>/g)]
        .forEach(em => console.log(`    ${m[1]} L${em[1]}.${em[2]}: ${em[3]}`));
    }
  } else {
    console.log('OK sem objetos invalidos.');
  }
}

(async () => {
  for (const { f, mode } of FILES) {
    console.log(`\n==> Aplicando ${f}  [${mode}]`);
    const filePath = path.join(__dirname, f);
    if (!fs.existsSync(filePath)) { console.log(`  pulando (arquivo nao existe): ${f}`); continue; }
    const sql = fs.readFileSync(filePath, 'utf8');
    const blocos = mode === 'semi' ? splitBySemi(sql) : splitBySlash(sql);
    let okN = 0, errN = 0;
    for (const b of blocos) {
      try { await execStmt(b); process.stdout.write('.'); okN++; }
      catch (e) {
        process.stdout.write('!'); errN++;
        console.error(`\n  ERRO bloco ${okN+errN}: ${(e.message||'').slice(0,200)}`);
        console.error('  Trecho:', b.substring(0, 180).replace(/\s+/g,' ') + '...');
      }
    }
    console.log(`\n  ${f}: ${okN} OK, ${errN} erros (de ${blocos.length} blocos)`);
  }
  await recompila();
  console.log('\n==> Deploy Oracle concluido.');
})().catch(e => { console.error(e); process.exit(1); });
