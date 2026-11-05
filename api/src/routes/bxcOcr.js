// [25/10/2026 - Alexandre Carvalho] BAIXAR E CONCILIAR - leitura do COMPROVANTE de PIX/TED por visao (API da Anthropic, SDK oficial).
// Pedido do Alexandre: "no caso de PIX e TED, opcao de anexar o comprovante e validar via OCR se o valor do PIX e igual ao titulo".
// Sem ANTHROPIC_API_KEY (ou outra credencial que o SDK resolva) a funcao devolve { ocr: null, motivo } e nada quebra: a baixa
// continua possivel sem comprovante. Modelo padrao claude-opus-5-5 (pode trocar por BXC_OCR_MODEL no .env).
// Fallback de recusa ligado por padrao (beta server-side-fallback-2026-07-01 + fallbacks "default"): se o classificador recusar a
// imagem, a API tenta o modelo de fallback na mesma chamada. Desligue com BXC_OCR_FALLBACK=0.
import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.BXC_OCR_MODEL || 'claude-opus-5-5';
const temCredencial = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE || process.env.BXC_OCR_SEM_CHAVE_OK === '1');

const INSTRUCAO = `Voce le comprovantes bancarios brasileiros (PIX, TED, DOC, transferencia, boleto pago). Extraia os dados do comprovante e responda SOMENTE com um JSON valido, sem comentarios, no formato:
{"valor": numero em reais com ponto decimal ou null, "data": "YYYY-MM-DD" da transacao ou null, "favorecido": "nome de quem recebeu" ou null, "favorecido_documento": "CPF/CNPJ de quem recebeu" ou null, "pagador": "nome de quem pagou" ou null, "pagador_documento": "CPF/CNPJ de quem pagou" ou null, "id_transacao": "ID/E2E/autenticacao" ou null, "banco": "banco emissor do comprovante" ou null, "tipo": "PIX" | "TED" | "DOC" | "BOLETO" | "OUTRO", "confianca": "alta" | "media" | "baixa", "observacao": "texto curto se algo estiver ilegivel ou ambiguo" ou null}
Regras: valor e o valor efetivamente transferido/pago (nao o saldo, nao a tarifa). Se houver mais de um valor, escolha o do campo "valor" ou "valor pago". Nao invente: use null quando nao estiver no documento.`;

const MIME_IMG = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

function extraiJson(texto) {
  const m = String(texto || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

/** Le o comprovante (imagem ou PDF). Devolve { ocr, modelo, motivo } - ocr null quando nao foi possivel. */
export async function lerComprovante(buffer, mime) {
  if (!temCredencial()) return { ocr: null, modelo: null, motivo: 'OCR nao configurado (sem ANTHROPIC_API_KEY)' };
  const m = String(mime || '').toLowerCase();
  let bloco;
  if (m === 'application/pdf') bloco = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') } };
  else if (MIME_IMG.has(m)) bloco = { type: 'image', source: { type: 'base64', media_type: m, data: buffer.toString('base64') } };
  else return { ocr: null, modelo: MODEL, motivo: `Formato ${m || 'desconhecido'} nao suportado (use JPG, PNG, WEBP, GIF ou PDF)` };
  if (buffer.length > 20 * 1024 * 1024) return { ocr: null, modelo: MODEL, motivo: 'Arquivo maior que 20 MB' };

  const client = new Anthropic({ timeout: 90_000, maxRetries: 2 });
  const comFallback = process.env.BXC_OCR_FALLBACK !== '0';
  const pedido = {
    model: MODEL, max_tokens: 2000, system: INSTRUCAO,
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content: [bloco, { type: 'text', text: 'Extraia os dados deste comprovante.' }] }],
  };
  try {
    const resp = comFallback
      ? await client.beta.messages.create({ ...pedido, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
      : await client.messages.create(pedido);
    if (resp.stop_reason === 'refusal') return { ocr: null, modelo: resp.model, motivo: `Leitura recusada pelo modelo${resp.stop_details?.category ? ` (${resp.stop_details.category})` : ''}` };
    const texto = resp.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
    const ocr = extraiJson(texto);
    if (!ocr) return { ocr: null, modelo: resp.model, motivo: 'Resposta do modelo sem JSON legivel' };
    if (ocr.valor != null) ocr.valor = Number(String(ocr.valor).replace(/[^\d.,-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')) || null;
    return { ocr, modelo: resp.model, motivo: null };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { ocr: null, modelo: MODEL, motivo: 'Credencial da API da Anthropic invalida' };
    if (e instanceof Anthropic.RateLimitError) return { ocr: null, modelo: MODEL, motivo: 'Limite de uso da API atingido, tente em instantes' };
    if (e instanceof Anthropic.APIConnectionError) return { ocr: null, modelo: MODEL, motivo: 'Sem conexao com a API da Anthropic' };
    return { ocr: null, modelo: MODEL, motivo: `OCR falhou: ${String(e.message || e).slice(0, 160)}` };
  }
}

/** Compara o que o OCR leu com o valor esperado: 'S' confere, 'N' diverge, '?' nao deu para ler. */
export function confereComprovante(ocr, valorEsperado) {
  if (!ocr || ocr.valor == null) return { confere: '?', motivo: 'Valor nao encontrado no comprovante' };
  const esperado = Number(valorEsperado);
  if (!Number.isFinite(esperado) || esperado <= 0) return { confere: '?', motivo: 'Valor esperado nao informado' };
  const dif = Math.abs(Number(ocr.valor) - esperado);
  return dif < 0.01 ? { confere: 'S', motivo: null } : { confere: 'N', motivo: `Comprovante R$ ${Number(ocr.valor).toFixed(2)} x esperado R$ ${esperado.toFixed(2)}` };
}
