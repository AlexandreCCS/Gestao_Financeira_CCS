// [21/09/2026 - CRIADO POR ALEXANDRE CARVALHO] Leitor de EXTRATO BANCARIO CNAB 240 (servico 04, segmento E) NO NAVEGADOR.
// E o arquivo de "conciliacao" que o banco manda (.RET): header de arquivo (0), header de lote (1) com o SALDO INICIAL,
// lancamentos (3, segmento E) e trailer de lote (5) com o SALDO FINAL. Layout FEBRABAN 240 posicoes (validado com o
// BL18096A.RET do Itau: saldo inicial + creditos - debitos = saldo final, ao centavo).
// Posicoes 1-based inclusivas:
//   header arq : 1-3 banco | 19-32 CNPJ | 53-57 agencia | 59-70 conta | 72 DV | 73-102 empresa | 103-132 banco | 144-151 geracao | 158-163 seq
//   header lote: 10-11 servico (04) | 143-150 data saldo inicial | 151-168 valor | 169 C/D | 170 posicao (P/F/I)
//   segmento E : 9-13 seq | 14 'E' | 109-111 natureza (DPV c/c, APL aplicacao...) | 143-150 data | 151-168 valor | 169 D/C
//                170-172 categoria | 173-176 cod. historico | 177-201 historico | 202-240 documento
//   trailer lote: 143-150 data | 151-168 SALDO FINAL | 169 C/D | 170 posicao | 177-194 soma debitos | 195-212 soma creditos
// Lotes da MESMA agencia/conta (no Itau: a c/c e a APLICACAO AUTOMATICA) viram UMA conta - e assim que o Mega importa.

const f   = (s, a, b) => s.slice(a - 1, b);
const val = s => (parseInt(s, 10) || 0) / 100;
const iso = s => (/^\d{8}$/.test(s) && s !== '00000000') ? `${s.slice(4, 8)}-${s.slice(2, 4)}-${s.slice(0, 2)}` : '';

export function lerExtratoCnab240(texto, nomeArquivo = '') {
  const linhas = String(texto).split(/\r?\n/).filter(l => l.trim().length > 0);
  if (!linhas.length) throw new Error('Arquivo vazio.');
  const ruins = linhas.filter(l => l.length !== 240).length;
  if (ruins > linhas.length / 2) throw new Error('Não é um arquivo CNAB 240 (as linhas não têm 240 posições).');
  const h = linhas.find(l => f(l, 8, 8) === '0');
  if (!h) throw new Error('CNAB 240 sem header de arquivo.');

  const contas = new Map(); let atual = null, lotesExtrato = 0, outrosServicos = 0;
  for (const l of linhas) {
    if (l.length !== 240) continue;
    const tipo = f(l, 8, 8);
    if (tipo === '1') {
      if (f(l, 10, 11) !== '04') { atual = null; outrosServicos++; continue; }       // so extrato p/ conciliacao
      lotesExtrato++;
      const agencia = f(l, 53, 57), conta = f(l, 59, 70), dv = f(l, 71, 72).trim(), chave = `${agencia}|${conta}`;
      if (!contas.has(chave)) contas.set(chave, { agencia, conta, dv, titular: f(l, 73, 102).trim(), lotes: [], lancamentos: [] });
      atual = { conta: contas.get(chave), lote: { numero: f(l, 4, 7), saldo_inicial: { data: iso(f(l, 143, 150)), valor: val(f(l, 151, 168)) * (f(l, 169, 169) === 'D' ? -1 : 1), posicao: f(l, 170, 170) },
                                                  saldo_final: null, natureza: '', qt: 0, debitos: 0, creditos: 0 } };
      atual.conta.lotes.push(atual.lote);
    } else if (tipo === '3' && atual && f(l, 14, 14) === 'E') {
      const dc = f(l, 169, 169), valor = val(f(l, 151, 168)), data = iso(f(l, 143, 150)), natureza = f(l, 109, 111).trim();
      if (!data || !['D', 'C'].includes(dc)) continue;
      atual.lote.natureza = atual.lote.natureza || natureza; atual.lote.qt++; atual.lote[dc === 'D' ? 'debitos' : 'creditos'] += valor;
      atual.conta.lancamentos.push({ seq: `${atual.lote.numero}-${f(l, 9, 13)}`, data, valor, dc, natureza, categoria: f(l, 170, 172), cod_hist: f(l, 173, 176),
                                     historico: f(l, 177, 201).trim(), documento: f(l, 202, 240).trim().replace(/^0+$/, '') });
    } else if (tipo === '5' && atual) {
      atual.lote.saldo_final = { data: iso(f(l, 143, 150)), valor: val(f(l, 151, 168)) * (f(l, 169, 169) === 'D' ? -1 : 1), posicao: f(l, 170, 170) };
      atual = null;
    }
  }
  if (!lotesExtrato) throw new Error(outrosServicos ? 'É um CNAB 240, mas não é extrato para conciliação (serviço 04). Parece um retorno de cobrança ou de pagamentos.' : 'CNAB 240 sem lote de extrato.');

  const lista = [...contas.values()].map(c => {
    const datas = c.lancamentos.map(x => x.data).sort();
    // o lote "fecha" quando saldo inicial + creditos - debitos = saldo final (quando o trailer e do mesmo dia do ultimo lancamento)
    const confere = c.lotes.map(L => L.saldo_final ? Math.abs(L.saldo_inicial.valor + L.creditos - L.debitos - L.saldo_final.valor) < 0.01 : null);
    return { ...c, periodo: { ini: datas[0] || '', fim: datas[datas.length - 1] || '' }, fecha: confere };
  });
  return {
    arquivo: nomeArquivo, banco: parseInt(f(h, 1, 3), 10) || 0, banco_nome: f(h, 103, 132).trim(), cnpj: f(h, 19, 32), empresa: f(h, 73, 102).trim(),
    gerado_em: iso(f(h, 144, 151)), hora: f(h, 152, 157), sequencia: f(h, 158, 163), linhas: linhas.length, contas: lista
  };
}
