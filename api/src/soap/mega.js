// [05/05/2026 - Alexandre Carvalho] Cliente SOAP do Mega Quality (apiquality1)
// Padrao igual aos demais portais CCS - sem MCP, sem axios, https nativo.
import https from 'node:https';

const HOST  = process.env.MEGA_SOAP_HOST  || 'apiquality1.ccstecno.com.br';
const PATH  = process.env.MEGA_SOAP_PATH  || '/webService.asmx';
const BANCO = process.env.MEGA_SOAP_BANCO || 'OCPDB493';
const USU   = process.env.MEGA_SOAP_USUARIO;
const SEN   = process.env.MEGA_SOAP_SENHA;

function escXml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function envelope(op, sql) {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/">
  <soap:Body>
    <tem:${op}>
      <tem:Banco>${escXml(BANCO)}</tem:Banco>
      <tem:Usuario>${escXml(USU)}</tem:Usuario>
      <tem:Senha>${escXml(SEN)}</tem:Senha>
      <tem:QuerySQL>${escXml(sql)}</tem:QuerySQL>
    </tem:${op}>
  </soap:Body>
</soap:Envelope>`;
}

function postSOAP(op, sql) {
  const body = envelope(op, sql);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: HOST, path: PATH, method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction':   `http://tempuri.org/${op}`,
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 60_000
    }, res => {
      let chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('soap timeout')));
    req.write(body); req.end();
  });
}

function checkErr(xml) {
  const m = xml.match(/<(ERRO|MENSAGEM)>([\s\S]*?)<\/\1>/);
  if (!m) return null;
  const txt = m[2].trim();
  if (/^(OK|Sucesso|Success)/i.test(txt)) return null;
  return txt;
}

function parseRows(xml) {
  const err = checkErr(xml);
  if (err) {
    const e = new Error(err);
    e.oracle = true;
    throw e;
  }
  const rows = [];
  const re = /<Table[\s>][^>]*?>([\s\S]*?)<\/Table>/g;
  let m;
  while ((m = re.exec(xml))) {
    const o = {};
    const re2 = /<([^\/!?][^>]*?)>([\s\S]*?)<\/\1>/g;
    let f;
    while ((f = re2.exec(m[1]))) {
      o[f[1]] = f[2]
        .replace(/&lt;/g,'<').replace(/&gt;/g,'>')
        .replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
    }
    rows.push(o);
  }
  return rows;
}

export async function megaQuery(sql) {
  const xml = await postSOAP('GetDataSet', sql);
  return parseRows(xml);
}

export async function megaExec(plsql) {
  const xml = await postSOAP('ExecuteNonQuery', plsql);
  const err = checkErr(xml);
  if (err) {
    const e = new Error(err);
    e.oracle = true;
    throw e;
  }
  return true;
}

// Login Mega via MEGA.CCS_F_VALIDA_LOGIN_PRJ (wrapper compartilhado entre os portais).
// Function ja existe no banco - criada na implementacao do Projetos Quality.
// Retorno: '<STATUS>:<GRU_IN_CODIGO>'
//   N - normal/OK     I - senha invalida    E - usuario nao encontrado
//   B - bloqueado     T - senha expirada    G - eh um grupo
export async function loginMega(login, senha) {
  const loginEsc = String(login).replace(/'/g, "''");
  const senhaEsc = String(senha).replace(/'/g, "''");
  const sqlAuth = `SELECT MEGA.CCS_F_VALIDA_LOGIN_PRJ('${loginEsc}','${senhaEsc}') AS R FROM DUAL`;
  const rowsA = await megaQuery(sqlAuth);
  const r = String(rowsA[0]?.R || '');
  const [statusV, gruStr] = r.split(':');
  const gruIn = parseInt(gruStr || '0', 10);
  if (statusV === 'B') { const e = new Error('Usuario bloqueado'); e.statusCode = 401; throw e; }
  if (statusV === 'G') { const e = new Error('Voce esta logando como grupo, nao usuario'); e.statusCode = 401; throw e; }
  if (statusV === 'T') { const e = new Error('Senha expirada - troque pelo Mega'); e.statusCode = 401; throw e; }
  if (statusV !== 'N' || !gruIn) {
    const e = new Error('Login ou senha incorretos'); e.statusCode = 401; throw e;
  }
  // Busca dados completos + permissao especifica do Gestor Financeiro
  const sqlData = `SELECT U.GRU_IN_CODIGO, U.GRU_ST_NOME, U.GRU_ST_NOMECOMPLETO,
                          U.GRU_ST_EMAIL, U.GRU_ST_CELULAR, U.GRU_ST_AREA, U.GRU_ST_CARGO,
                          NVL(C.GRU_CH_GFIN_CCS, 'N') AS PERM_GFIN
                     FROM MEGA.GLO_GRUPO_USUARIO U,
                          MEGA.GLO_GRUPO_USUARIOCMPESP C
                    WHERE U.GRU_IN_CODIGO = ${gruIn}
                      AND U.GRU_IN_CODIGO = C.GRU_IN_CODIGO (+)`;
  const rowsD = await megaQuery(sqlData);
  if (rowsD.length === 0) {
    const e = new Error('Usuario validado mas nao encontrado em GLO_GRUPO_USUARIO'); e.statusCode = 500; throw e;
  }
  return rowsD[0];
}
