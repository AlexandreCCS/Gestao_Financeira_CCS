// [18/11/2026 - CRIADO POR ALEXANDRE CARVALHO] Leitor dos ARQUIVOS DA REDE (Itau) NO NAVEGADOR, para a Conciliacao bancaria - Cartao.
// Dois layouts exportados pelo portal da Rede (validados com os arquivos de 18/11/2026 da Quality):
//   V - EXTRATO DE VENDAS: aba "vendas"; linha 1 = texto ("EXTRATO PARA SIMPLES CONFERENCIA / PERIODO / DATA DE EMISSAO"), linha 2 = cabecalho
//       ("data da venda", "hora da venda", "status da venda", "valor da venda original", ..., "NSU/CV", "numero do estabelecimento", "CNPJ", ...,
//       "ID Transacao"); datas m/d/aa, valores "R$ 1,234.56", vazio = "-". Pix nao tem NSU: a chave e o ID Transacao.
//   R - RELATORIO DE RECEBIMENTOS: abas "pagamentos" (P, parcelas pagas), "pagamentos futuros" (F, agendadas), "recebidos" (D, depositos por
//       dia/bandeira/modalidade), "ajustes" (A, aluguel de maquininha etc.), "cancelamentos e contestacoes" (C); datas dd/mm/aaaa.
// Tudo e agrupado por ESTABELECIMENTO (numero da Rede) - a API traduz para filial. Nada sai do navegador alem das linhas lidas.
import * as XLSX from 'xlsx';

const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const vazio = v => v == null || /^\s*-?\s*$/.test(String(v));
const txt = v => (vazio(v) ? '' : String(v).trim());
// "R$ 1,234.56" | "R$  3.23" | "1.96%" | "100,0000%" -> numero (ponto decimal no dinheiro; a coluna "%" usa virgula)
export const num = v => { if (vazio(v)) return null; let s = String(v).replace(/R\$|\s|%/g, ''); if (/,\d{1,4}$/.test(s) && !s.includes('.')) s = s.replace(',', '.'); else s = s.replace(/,/g, ''); const n = Number(s); return Number.isFinite(n) ? Math.round(n * 10000) / 10000 : null; };
const r2 = v => (v == null ? null : Math.round(v * 100) / 100);
const inteiro = v => { const n = parseInt(String(v ?? '').replace(/\D/g, ''), 10); return Number.isFinite(n) ? n : null; };
const sn = v => (/^s(im)?$/i.test(txt(v)) ? 'S' : /^n(ao|ão)?$/i.test(txt(v)) ? 'N' : null);
const digitos = v => txt(v).replace(/\D/g, '');
// chave de duplicidade so com ASCII: a API grava sem acento ('debito'), entao a chave do navegador tem de ser igual
const ascii = v => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E]/g, ' ');
// m/d/aa (vendas) ou dd/mm/aaaa (recebimentos)
const dataUS = v => { const m = txt(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); if (!m) return ''; const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; };
const dataBR = v => { const m = txt(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); if (!m) return ''; const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; };
// [27/11/2026] o relatorio de recebimentos da Rede vem ora em dd/mm/aaaa (exportado em 18/11), ora em m/d/aa (exportado em 26/11: "11/18/26")
// -> ORA-01843 "nao e um mes valido". O formato e decidido pelo proprio arquivo: dia > 12 na 1a posicao = BR; na 2a = US; ano com 2 digitos = US.
function formatoDatas(wb, abas) {
  let br = 0, us = 0, ano2 = 0;
  for (const sn of abas) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: false, defval: '' });
    for (const r of rows) for (const c of r) {
      const m = String(c || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
      if (!m) continue;
      if (+m[1] > 12) br++; else if (+m[2] > 12) us++;
      if (m[3].length === 2) ano2++;
    }
  }
  return br > us ? 'BR' : us > br ? 'US' : ano2 ? 'US' : 'BR';
}
const dataOk = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
const hora = v => { const m = txt(v).match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/); return m ? `${m[1].padStart(2, '0')}:${m[2]}:${m[3] || '00'}` : ''; };
// cabecalho das abas: "PERIODO: 01-10-2026 A 31-10-2026 / DATA DE EMISSAO: 06-11-2026 09:31:04"
function cabecalho(texto) {
  const t = String(texto || '');
  const p = t.match(/PER[IÍ]ODO:\s*(\d{2})[-/](\d{2})[-/](\d{4})\s*A\s*(\d{2})[-/](\d{2})[-/](\d{4})/i);
  const e = t.match(/EMISS[AÃ]O:\s*(\d{2})[-/](\d{2})[-/](\d{4})(?:\s+(\d{2}:\d{2}:\d{2}))?/i);
  return { periodo: p ? { ini: `${p[3]}-${p[2]}-${p[1]}`, fim: `${p[6]}-${p[5]}-${p[4]}` } : null, emissao: e ? `${e[3]}-${e[2]}-${e[1]}${e[4] ? ' ' + e[4] : ''}` : null };
}
// acha a linha do cabecalho (primeira celula igual ao nome esperado) e devolve objetos por nome de coluna normalizado
function tabela(ws, primeiraColuna) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: null });
  const h = rows.findIndex(r => norm(r?.[0]) === primeiraColuna);
  if (h < 0) return null;
  const cols = rows[h].map(norm);
  const dados = rows.slice(h + 1).filter(r => r && r.some(c => !vazio(c))).map(r => Object.fromEntries(cols.map((c, i) => [c, r[i]])));
  return { texto: rows.slice(0, h).flat().filter(Boolean).join('\n'), cols, dados };
}
const col = (r, ...nomes) => { for (const n of nomes) { const k = Object.keys(r).find(c => c === n || c.startsWith(n)); if (k !== undefined) return r[k]; } return null; };

export function lerArquivoRede(buf, nomeArquivo = '') {
  const wb = XLSX.read(buf, { type: 'array', cellDates: false });
  const abas = wb.SheetNames.map(norm);
  if (abas.includes('vendas') && !abas.includes('pagamentos')) return lerVendas(wb, nomeArquivo);
  if (abas.includes('pagamentos') || abas.includes('recebidos')) return lerRecebimentos(wb, nomeArquivo);
  throw new Error(`Não reconheci o layout: abas ${wb.SheetNames.join(', ')}. Esperado o extrato de vendas (aba "vendas") ou o relatório de recebimentos (abas "pagamentos", "recebidos"…) do portal da Rede.`);
}

function agrupar(linhas) {
  const m = new Map();
  for (const l of linhas) {
    const k = l.estab || '?';
    if (!m.has(k)) m.set(k, { estab: l.estab, cnpj: l.cnpj || '', nome: l.estab_nome || '', linhas: [] });
    const g = m.get(k); if (!g.cnpj && l.cnpj) g.cnpj = l.cnpj; if (!g.nome && l.estab_nome) g.nome = l.estab_nome;
    g.linhas.push(l);
  }
  return [...m.values()].sort((a, b) => String(a.estab).localeCompare(String(b.estab)));
}
const periodoDe = linhas => { const d = linhas.map(l => l.data).filter(dataOk).sort(); return { ini: d[0] || null, fim: d[d.length - 1] || null }; };

// ------------------------------------------------------------------ V: extrato de vendas
function lerVendas(wb, nome) {
  const ws = wb.Sheets[wb.SheetNames.find(s => norm(s) === 'vendas')];
  const t = tabela(ws, 'data da venda');
  if (!t) throw new Error('Aba "vendas" sem o cabeçalho esperado ("data da venda" na primeira coluna).');
  const cab = cabecalho(t.texto);
  let invalidas = 0;
  const linhas = t.dados.map((r, i) => {
    const data = dataUS(col(r, 'data da venda')), valor = num(col(r, 'valor da venda original'));
    const nsu = txt(col(r, 'nsu/cv')), idt = txt(col(r, 'id transação', 'id transacao'));
    const l = {
      ordem: i + 1, aba: 'V', data, hora: hora(col(r, 'hora da venda')), status: norm(col(r, 'status da venda')),
      bruto: valor, bruto_atual: num(col(r, 'valor da venda atualizado')), modalidade: norm(col(r, 'modalidade')), tipo: norm(col(r, 'tipo')),
      parcelas: inteiro(col(r, 'número de parcelas', 'numero de parcelas')), bandeira: txt(col(r, 'bandeira')),
      taxa_mdr: num(col(r, 'taxa mdr')), mdr: num(col(r, 'valor mdr')), taxa_ra: num(col(r, 'taxa de recebimento automático', 'taxa de recebimento automatico')),
      ra: num(col(r, 'valor taxa de recebimento')), taxas: num(col(r, 'valor total das taxas descontadas')), liquido: num(col(r, 'valor líquido', 'valor liquido')),
      nsu, prazo: txt(col(r, 'prazo de recebimento')).replace(/\s+/g, ' '), lote: txt(col(r, 'resumo de vendas/número do lote', 'resumo de vendas/numero do lote')),
      autorizacao: txt(col(r, 'número da autorização', 'numero da autorizacao')),
      estab: digitos(col(r, 'número do estabelecimento', 'numero do estabelecimento')), estab_nome: txt(col(r, 'nome do estabelecimento')), cnpj: digitos(col(r, 'cnpj')),
      cartao: txt(col(r, 'número do cartão', 'numero do cartao')), meio: txt(col(r, 'meio de pagamento')), maquininha: txt(col(r, 'código da maquininha', 'codigo da maquininha')),
      tid: txt(col(r, 'tid')), pedido: txt(col(r, 'número do pedido', 'numero do pedido')), id_transacao: idt,
      cancelada: sn(col(r, 'cancelada pelo estabelecimento')), dt_cancel: dataUS(col(r, 'data do cancelamento')) || null, cancelado: num(col(r, 'valor cancelado')),
      chargeback: sn(col(r, 'em disputa de chargeback')),
      descricao: '', situacao: 'nova', motivo: '',
    };
    if (l.liquido == null && l.bruto != null) l.liquido = r2(l.bruto - (l.taxas || 0));   // pix vem com "valor liquido" = "-"
    l.chave = ascii(`V|${l.estab}|${l.data}|${l.hora}|${(l.bruto ?? 0).toFixed(2)}|${nsu || idt}`);
    if (!dataOk(data) || valor == null || !l.estab) { l.situacao = 'erro'; l.motivo = !dataOk(data) ? 'Data da venda inválida' : valor == null ? 'Valor inválido' : 'Sem número do estabelecimento'; invalidas++; }
    return l;
  });
  const aprov = linhas.filter(l => ['aprovada', 'pago'].includes(l.status));
  return {
    arquivo: nome, tipo: 'V', tipo_nome: 'Extrato de vendas', emissao: cab.emissao, periodo: cab.periodo || periodoDe(linhas), abas: ['vendas'],
    linhas: linhas.length, invalidas, estabs: agrupar(linhas),
    totais: { aprovadas: aprov.length, bruto: r2(aprov.reduce((s, l) => s + (l.bruto || 0), 0)), taxas: r2(aprov.reduce((s, l) => s + (l.taxas || 0), 0)), liquido: r2(aprov.reduce((s, l) => s + (l.liquido || 0), 0)) },
  };
}

// ------------------------------------------------------------------ R: relatorio de recebimentos
const ABAS_R = [
  { nome: 'pagamentos', aba: 'P', primeira: 'data do recebimento' },
  { nome: 'pagamentos futuros', aba: 'F', primeira: 'data prevista do recebimento' },
  { nome: 'recebidos', aba: 'D', primeira: 'data' },
  { nome: 'ajustes', aba: 'A', primeira: 'data do ajuste' },
  { nome: 'cancelamentos e contestações', aba: 'C', primeira: 'data do débito' },
];
function lerRecebimentos(wb, nome) {
  const linhas = []; const abasLidas = []; let cab = { periodo: null, emissao: null }; let invalidas = 0;
  const abasR = ABAS_R.map(def => wb.SheetNames.find(s => norm(s) === def.nome || norm(s) === def.nome.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))).filter(Boolean);
  const dataR = formatoDatas(wb, abasR) === 'US' ? dataUS : dataBR;
  for (const def of ABAS_R) {
    const sn0 = wb.SheetNames.find(s => norm(s) === def.nome || norm(s) === def.nome.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
    if (!sn0) continue;
    const t = tabela(wb.Sheets[sn0], def.primeira);
    if (!t) continue;
    abasLidas.push(def.nome);
    if (!cab.periodo) cab = cabecalho(t.texto);
    for (const r of t.dados) {
      const base = { aba: def.aba, estab_nome: txt(col(r, 'nome do estabelecimento')), cnpj: '', situacao: 'nova', motivo: '', descricao: '' };
      let l;
      if (def.aba === 'P' || def.aba === 'F') {
        const data = dataR(col(r, 'data do recebimento', 'data prevista do recebimento'));
        l = { ...base, data, dt_venda: dataR(col(r, 'data original da venda')) || null, dt_vencto: dataR(col(r, 'data original de vencimento')) || null,
          bruto: num(col(r, 'valor bruto da parcela original')), bruto_atual: num(col(r, 'valor bruto da parcela atualizada')), taxa_mdr: num(col(r, 'taxa mdr')), mdr: num(col(r, 'valor mdr descontado')),
          liquido: num(col(r, 'valor líquido da parcela', 'valor liquido da parcela')), nsu: txt(col(r, 'nsu/cv')), tid: txt(col(r, 'tid')), pedido: txt(col(r, 'número do pedido', 'numero do pedido')),
          autorizacao: txt(col(r, 'número da autorização', 'numero da autorizacao', 'número de autorização', 'numero de autorizacao')), lote: txt(col(r, 'resumo de vendas/número do lote', 'resumo de vendas/numero do lote')),
          estab: digitos(col(r, 'estabelecimento')), cartao: txt(col(r, 'número do cartão', 'numero do cartao')), modalidade: norm(col(r, 'modalidade')), bandeira: txt(col(r, 'bandeira')),
          parcelas: inteiro(col(r, 'número de parcelas', 'numero de parcelas')), parcela: inteiro(col(r, 'parcela')), banco: txt(col(r, 'banco')), agencia: txt(col(r, 'agência', 'agencia')), conta: txt(col(r, 'conta-corrente', 'conta corrente')),
          status: norm(col(r, 'status')), cancelada: vazio(col(r, 'cancelamento/contestação', 'cancelamento/contestacao')) ? null : 'S', dt_cancel: dataR(col(r, 'data do cancelamento')) || null };
        l.taxas = l.mdr; l.chave = ascii(`${def.aba}|${l.estab}|${l.nsu}|${l.parcela ?? ''}|${l.data}|${(l.bruto ?? 0).toFixed(2)}`);
        if (!dataOk(data) || l.bruto == null || !l.estab) { l.situacao = 'erro'; l.motivo = !dataOk(data) ? 'Data do recebimento inválida' : l.bruto == null ? 'Valor inválido' : 'Sem estabelecimento'; }
      } else if (def.aba === 'D') {
        const data = dataR(col(r, 'data'));
        l = { ...base, data, bruto: num(col(r, 'valor depositado')), liquido: num(col(r, 'valor depositado')), bandeira: txt(col(r, 'bandeira')), modalidade: norm(col(r, 'modalidade')),
          banco: txt(col(r, 'banco domicilio', 'banco domicílio')), estab: digitos(col(r, 'estabelecimento')), status: norm(col(r, 'status')), descricao: txt(col(r, 'negociadas')) };
        l.chave = ascii(`D|${l.estab}|${l.data}|${l.bandeira}|${l.modalidade}|${(l.bruto ?? 0).toFixed(2)}`);
        if (!dataOk(data) || l.bruto == null || !l.estab) { l.situacao = 'erro'; l.motivo = 'Data, valor ou estabelecimento inválido'; }
      } else if (def.aba === 'A') {
        const data = dataR(col(r, 'data do ajuste'));
        const id = txt(col(r, 'id ajuste'));
        l = { ...base, data, dt_venda: dataR(col(r, 'data do lançamento', 'data do lancamento')) || null, bruto: num(col(r, 'valor total original do ajuste')), liquido: num(col(r, 'valor cobrado nesta data')),
          bruto_atual: num(col(r, 'valor creditado nesta data')), bandeira: txt(col(r, 'bandeira ajustada')), lote: txt(col(r, 'resumo de vendas/número do lote ajustado', 'resumo de vendas/numero do lote ajustado')),
          estab: digitos(col(r, 'número do estabelecimento cobrado', 'numero do estabelecimento cobrado')), estab_nome: txt(col(r, 'nome do estabelecimento cobrado')),
          banco: txt(col(r, 'banco')), agencia: txt(col(r, 'agência', 'agencia')), conta: txt(col(r, 'conta-corrente', 'conta corrente')), nsu: id, status: norm(col(r, 'tipo do ajuste')),
          descricao: [txt(col(r, 'tipo do ajuste')), txt(col(r, 'forma de compensação', 'forma de compensacao')), txt(col(r, 'motivo'))].filter(Boolean).join(' · ') };
        l.chave = ascii(`A|${l.estab}|${id}|${l.data}`);
        if (!dataOk(data) || !l.estab) { l.situacao = 'erro'; l.motivo = 'Data ou estabelecimento inválido'; }
      } else {
        const data = dataR(col(r, 'data do débito', 'data do debito'));
        l = { ...base, data, dt_venda: dataR(col(r, 'data original da venda')) || null, bruto: num(col(r, 'valor original da venda')), liquido: num(col(r, 'valor descontado')),
          modalidade: norm(col(r, 'modalidade da venda')), bandeira: txt(col(r, 'bandeira da venda')), parcelas: inteiro(col(r, 'número de parcelas', 'numero de parcelas')),
          estab: digitos(col(r, 'estabelecimento da venda')), estab_nome: txt(col(r, 'nome do estabelecimento da venda')), nsu: txt(col(r, 'nsu/cv')), tid: txt(col(r, 'tid')),
          autorizacao: txt(col(r, 'número da autorização', 'numero da autorizacao')), lote: txt(col(r, 'resumo de vendas/número do lote da venda', 'resumo de vendas/numero do lote da venda')),
          status: norm(col(r, 'cancelamento/chargeback')), descricao: txt(col(r, 'motivo do cancelamento')), banco: txt(col(r, 'banco')), agencia: txt(col(r, 'agência', 'agencia')), conta: txt(col(r, 'conta-corrente', 'conta corrente')) };
        l.chave = ascii(`C|${l.estab}|${l.nsu}|${l.data}|${(l.bruto ?? 0).toFixed(2)}`);
        if (!dataOk(data) || !l.estab) { l.situacao = 'erro'; l.motivo = 'Data ou estabelecimento inválido'; }
      }
      if (l.situacao === 'erro') invalidas++;
      linhas.push(l);
    }
  }
  if (!abasLidas.length) throw new Error('Relatório de recebimentos sem as abas esperadas (pagamentos, pagamentos futuros, recebidos, ajustes).');
  linhas.forEach((l, i) => { l.ordem = i + 1; });
  const pagas = linhas.filter(l => l.aba === 'P');
  return {
    arquivo: nome, tipo: 'R', tipo_nome: 'Relatório de recebimentos', emissao: cab.emissao, periodo: cab.periodo || periodoDe(linhas), abas: abasLidas,
    linhas: linhas.length, invalidas, estabs: agrupar(linhas),
    totais: { aprovadas: pagas.length, bruto: r2(pagas.reduce((s, l) => s + (l.bruto || 0), 0)), taxas: r2(pagas.reduce((s, l) => s + (l.mdr || 0), 0)), liquido: r2(pagas.reduce((s, l) => s + (l.liquido || 0), 0)) },
  };
}
