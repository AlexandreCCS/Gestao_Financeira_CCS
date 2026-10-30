// [14/05/2026 - CRIADO POR ALEXANDRE CARVALHO] Inteligencia de Credito > Ajuda.
// Explica em detalhe como a nota de risco (score) e calculada. O exemplo passo a
// passo NAO e fixo: a cada abertura sorteia um cliente real que atende os criterios
// (externo, score 200-800, com inadimplencia real) e monta o calculo com os
// numeros dele. Fonte: GET /credito/exemplo.
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, BookOpen, Calculator, Layers, Lightbulb, AlertCircle, RefreshCw } from 'lucide-react';
import { api } from '../../api/client';

const fmt  = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtN = v => Number(v || 0).toLocaleString('pt-BR');
const d3   = v => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

function Formula({ children }) {
  return (
    <div className="bg-ink-950 border border-ink-700 rounded p-2.5 font-mono text-xs text-prim-200 my-1.5 overflow-x-auto">
      {children}
    </div>
  );
}
function Secao({ icone, titulo, children }) {
  return (
    <div className="card p-5">
      <h2 className="text-base font-bold text-prim-400 flex items-center gap-2 mb-3">{icone} {titulo}</h2>
      <div className="space-y-2.5 text-sm text-gray-300 leading-relaxed">{children}</div>
    </div>
  );
}

// reproduz a formula do motor de score (CCS_P_GFIN_CALC_SCORE) no front
function calcular(d, p) {
  const nAtMed = p.NORM_ATRASO_MEDIO || 20, nMaiAt = p.NORM_MAIOR_ATRASO || 90, nAtAtu = p.NORM_ATRASO_ATUAL || 120;
  const g0 = x => Math.max(0, x), clamp01 = x => Math.max(0, Math.min(1, x));
  const cComp = 0.7 * g0(1 - d.atraso_medio / nAtMed) + 0.3 * g0(1 - d.pior_atraso / nMaiAt);
  const pctVenc = d.saldo_total > 0 ? d.saldo_vencido / d.saldo_total : 0;
  const cInad = 0.6 * (1 - pctVenc) + 0.4 * g0(1 - d.maior_atraso_dias / nAtAtu);
  let cTend;
  if (d.venc_30 == null)                          cTend = 0.5;
  else if (d.venc_30 === 0 && d.saldo_vencido===0) cTend = 0.8;
  else if (d.venc_30 === 0)                        cTend = 0.3;
  else cTend = clamp01(0.5 + (d.venc_30 - d.saldo_vencido) / (2 * d.venc_30));
  const cExpo = d.maior_acumulo <= 0 ? 0.5 : clamp01(1 - d.saldo_total / d.maior_acumulo);
  const penal = (d.valor_cartorio > 0 ? 0.4 : 0) + (d.cheques_devolvidos > 0 ? 0.3 : 0)
              + Math.min(0.3, d.qt_bloqueios * 0.05);
  const cExt = g0(1 - penal);
  const pC = p.PESO_COMPORTAMENTO || 0.35, pI = p.PESO_INADIMPLENCIA || 0.30,
        pT = p.PESO_TENDENCIA || 0.15, pE = p.PESO_EXPOSICAO || 0.10, pX = p.PESO_EXTERNO || 0.10;
  const soma = pC*cComp + pI*cInad + pT*cTend + pE*cExpo + pX*cExt;
  return { cComp, cInad, cTend, cExpo, cExt, soma, score: Math.round(1000 * soma), pctVenc, penal,
           nAtMed, nMaiAt, nAtAtu, pC, pI, pT, pE, pX };
}

export default function Ajuda() {
  const nav = useNavigate();
  const [ex,   setEx]   = useState(null);
  const [busy, setBusy] = useState(true);
  const [erro, setErro] = useState('');

  async function sortear() {
    setBusy(true); setErro('');
    try { setEx(await api.creditoExemplo()); }
    catch (e) { setErro(e.message || 'Erro ao carregar o exemplo'); setEx(null); }
    finally { setBusy(false); }
  }
  useEffect(() => { sortear(); }, []);

  // parametros vigentes (com fallback) para as formulas da secao 2 ficarem em sincronia
  const P = ex?.parametros || {};
  const nAtMed = P.NORM_ATRASO_MEDIO || 20, nMaiAt = P.NORM_MAIOR_ATRASO || 90, nAtAtu = P.NORM_ATRASO_ATUAL || 120;
  const pC = P.PESO_COMPORTAMENTO ?? 0.35, pI = P.PESO_INADIMPLENCIA ?? 0.30,
        pT = P.PESO_TENDENCIA ?? 0.15, pE = P.PESO_EXPOSICAO ?? 0.10, pX = P.PESO_EXTERNO ?? 0.10;
  const pct = w => `${Math.round(w * 100)}%`;

  return (
    <div className="p-6 space-y-5 max-w-4xl mx-auto">
      <button className="btn-ghost" onClick={() => nav('/credito/carteira')}>
        <ArrowLeft size={16} /> Carteira de Crédito
      </button>

      <div>
        <h1 className="text-xl font-bold text-prim-400 flex items-center gap-2">
          <BookOpen size={20} /> Como funciona o Score de Crédito
        </h1>
        <p className="text-sm text-gray-400 mt-1">
          Tudo o que entra no cálculo da nota de risco de cada cliente, com um exemplo real
          — sorteado a cada abertura — do começo ao fim.
        </p>
      </div>

      {/* 1. Visao geral */}
      <Secao icone={<Lightbulb size={16} />} titulo="1. O que é o score">
        <p>
          O <b>score</b> é uma nota de <b>0 a 1000</b> que resume o risco de crédito de cada
          cliente — quanto <b>maior</b>, <b>melhor</b>. É recalculado automaticamente todo dia
          às 03:30, lendo a posição da carteira (contas a receber) e a estatística de
          pagamento nativa do Mega.
        </p>
        <p>
          A nota nasce da soma de <b>5 fatores</b> (cada um de 0 a 1), multiplicados pelos
          seus pesos. A soma dos pesos é 1,00; multiplicada por 1000 dá o score:
        </p>
        <Formula>
          score = 1000 × ( {d3(pC)}·Comportamento + {d3(pI)}·Inadimplência + {d3(pT)}·Tendência
          + {d3(pE)}·Exposição + {d3(pX)}·Sinais&nbsp;negativos )
        </Formula>
        <p>Depois, o score vira uma <b>classe</b> de A (melhor) a E (pior):</p>
        <div className="flex flex-wrap gap-2 text-xs">
          {[['A', `≥ ${fmtN(P.FAIXA_A ?? 800)}`,'bg-emerald-700/30 text-emerald-300'],
            ['B', `${fmtN(P.FAIXA_B ?? 600)} – ${fmtN((P.FAIXA_A ?? 800) - 1)}`,'bg-prim-700/30 text-prim-300'],
            ['C', `${fmtN(P.FAIXA_C ?? 400)} – ${fmtN((P.FAIXA_B ?? 600) - 1)}`,'bg-amber-700/30 text-amber-300'],
            ['D', `${fmtN(P.FAIXA_D ?? 200)} – ${fmtN((P.FAIXA_C ?? 400) - 1)}`,'bg-orange-700/30 text-orange-300'],
            ['E', `< ${fmtN(P.FAIXA_D ?? 200)}`,'bg-rose-700/30 text-rose-300']].map(([c,f,cor]) => (
            <span key={c} className={`px-2 py-1 rounded ${cor}`}><b>{c}</b> · {f}</span>
          ))}
        </div>
      </Secao>

      {/* 2. Os 5 fatores */}
      <Secao icone={<Layers size={16} />} titulo="2. Os 5 fatores, um por um">
        <p className="text-gray-400">
          Cada fator é normalizado para a escala 0–1 (0 = pior, 1 = melhor). Os limites das
          fórmulas ({nAtMed}, {nMaiAt}, {nAtAtu} dias) são ajustáveis na tela de Parâmetros.
        </p>

        <div className="mt-1">
          <div className="font-semibold text-gray-100">Comportamento de pagamento — peso {pct(pC)}</div>
          <p>Como o cliente costuma pagar, pelo histórico do Mega. Combina o atraso médio
            (70%) com o pior atraso que ele já teve (30%).</p>
          <Formula>
            Comportamento = 0,70 × (1 − atraso_médio ÷ {nAtMed}) + 0,30 × (1 − pior_atraso ÷ {nMaiAt})
          </Formula>
        </div>

        <div>
          <div className="font-semibold text-gray-100">Inadimplência atual — peso {pct(pI)}</div>
          <p>O quanto o cliente está devendo vencido <i>agora</i>. Combina o percentual da
            carteira que está vencida (60%) com o maior atraso em aberto (40%).</p>
          <Formula>
            Inadimplência = 0,60 × (1 − saldo_vencido ÷ saldo_total) + 0,40 × (1 − maior_atraso_atual ÷ {nAtAtu})
          </Formula>
        </div>

        <div>
          <div className="font-semibold text-gray-100">Tendência — peso {pct(pT)}</div>
          <p>Se a dívida vencida vem <b>caindo</b> ou <b>subindo</b> nos últimos 30 dias.
            Enquanto não há histórico de 30 dias, vale <b>0,5</b> (neutro).</p>
          <Formula>
            Tendência = 0,5 + (vencido_30d_atrás − vencido_hoje) ÷ (2 × vencido_30d_atrás)
          </Formula>
        </div>

        <div>
          <div className="font-semibold text-gray-100">Exposição — peso {pct(pE)}</div>
          <p>O tamanho da dívida atual comparado ao <b>maior acúmulo histórico</b> do cliente
            (referência usada por não haver limite de crédito cadastrado nesta base).</p>
          <Formula>Exposição = 1 − saldo_total ÷ maior_acúmulo_histórico</Formula>
        </div>

        <div>
          <div className="font-semibold text-gray-100">Sinais negativos — peso {pct(pX)}</div>
          <p>Penaliza apenas sinais de risco de <b>crédito</b>. Começa em 1,0 e desconta:</p>
          <ul className="list-disc list-inside text-gray-400 ml-1">
            <li>−0,40 se tem valor em <b>cartório</b></li>
            <li>−0,30 se tem <b>cheque devolvido</b></li>
            <li>−0,05 por <b>bloqueio financeiro</b> disparado (até o limite de −0,30)</li>
          </ul>
          <p className="text-gray-500 text-xs">
            Bloqueio por SUFRAMA é fiscal/regulatório — <b>nunca</b> entra no score de crédito.
          </p>
        </div>
      </Secao>

      {/* 3. Exemplo real, sorteado */}
      <Secao icone={<Calculator size={16} />} titulo="3. Exemplo real, passo a passo">
        <div className="flex items-center justify-between gap-3">
          <p className="text-gray-400 text-xs">
            Cliente sorteado entre os que atendem os critérios (externo, score 200–800, com
            inadimplência real). Clique em sortear outro para ver um caso diferente.
          </p>
          <button className="btn-ghost shrink-0" onClick={sortear} disabled={busy}>
            <RefreshCw size={15} className={busy ? 'animate-spin' : ''} /> Sortear outro
          </button>
        </div>

        {erro && <div className="bg-red-900/40 text-red-200 text-sm rounded p-2">{erro}</div>}
        {busy && <div className="text-gray-500 text-sm py-4">Sorteando um cliente...</div>}
        {!busy && ex && !ex.disponivel && (
          <div className="text-gray-500 text-sm py-4">
            Nenhum cliente atende os critérios para o exemplo no momento.
          </div>
        )}

        {!busy && ex?.disponivel && (() => {
          const d = ex.dados, c = calcular(d, ex.parametros);
          return (
            <>
              <div className="font-semibold text-gray-100">
                {ex.cliente.nome} <span className="text-xs text-gray-500 font-mono">· cód {ex.cliente.agn_id}</span>
              </div>
              <div className="bg-ink-900 rounded p-3 text-xs grid sm:grid-cols-2 gap-x-6 gap-y-1 font-mono">
                <div>Saldo total: <span className="text-gray-100">{fmt(d.saldo_total)}</span></div>
                <div>Saldo vencido: <span className="text-rose-300">{fmt(d.saldo_vencido)}</span></div>
                <div>Títulos: <span className="text-gray-100">{fmtN(d.qt_tit_total)}</span> ({fmtN(d.qt_tit_vencidos)} vencidos)</div>
                <div>Maior atraso atual: <span className="text-gray-100">{fmtN(d.maior_atraso_dias)} dias</span></div>
                <div>Atraso médio (histórico): <span className="text-gray-100">{fmtN(d.atraso_medio)} dias</span></div>
                <div>Pior atraso já tido: <span className="text-gray-100">{fmtN(d.pior_atraso)} dias</span></div>
                <div>Maior acúmulo histórico: <span className="text-gray-100">{fmt(d.maior_acumulo)}</span></div>
                <div>Cartório / cheques / bloqueios: <span className="text-gray-100">{fmt(d.valor_cartorio)} / {fmt(d.cheques_devolvidos)} / {fmtN(d.qt_bloqueios)}</span></div>
                <div>Vencido 30 dias atrás: <span className="text-gray-100">{d.venc_30 == null ? 'sem histórico ainda' : fmt(d.venc_30)}</span></div>
              </div>

              <div className="space-y-2 mt-2">
                <div>
                  <b className="text-gray-100">1) Comportamento</b> — atraso médio {fmtN(d.atraso_medio)}d, pior atraso {fmtN(d.pior_atraso)}d:
                  <Formula>
                    0,70 × (1 − {fmtN(d.atraso_medio)}÷{c.nAtMed}) + 0,30 × (1 − {fmtN(d.pior_atraso)}÷{c.nMaiAt})
                    = <b className="text-prim-300">{d3(c.cComp)}</b>
                  </Formula>
                </div>
                <div>
                  <b className="text-gray-100">2) Inadimplência</b> — {Math.round(c.pctVenc * 100)}% da carteira vencida, maior atraso {fmtN(d.maior_atraso_dias)}d:
                  <Formula>
                    0,60 × (1 − {d3(c.pctVenc)}) + 0,40 × (1 − {fmtN(d.maior_atraso_dias)}÷{c.nAtAtu})
                    = <b className="text-prim-300">{d3(c.cInad)}</b>
                  </Formula>
                </div>
                <div>
                  <b className="text-gray-100">3) Tendência</b> — {d.venc_30 == null ? 'sem snapshot de 30 dias atrás' : `vencido era ${fmt(d.venc_30)}`}:
                  <Formula>= <b className="text-prim-300">{d3(c.cTend)}</b>{d.venc_30 == null ? ' (neutro)' : ''}</Formula>
                </div>
                <div>
                  <b className="text-gray-100">4) Exposição</b> — saldo atual vs. maior acúmulo histórico:
                  <Formula>
                    1 − {fmt(d.saldo_total)} ÷ {fmt(d.maior_acumulo)} = <b className="text-prim-300">{d3(c.cExpo)}</b>
                  </Formula>
                </div>
                <div>
                  <b className="text-gray-100">5) Sinais negativos</b> — {c.penal === 0 ? 'sem cartório, cheque ou bloqueio financeiro' : `penalidade total ${d3(c.penal)}`}:
                  <Formula>1 − {d3(c.penal)} = <b className="text-prim-300">{d3(c.cExt)}</b></Formula>
                </div>
                <div>
                  <b className="text-gray-100">Nota final</b> — soma ponderada × 1000:
                  <Formula>
                    1000 × ( {d3(c.pC)}×{d3(c.cComp)} + {d3(c.pI)}×{d3(c.cInad)} + {d3(c.pT)}×{d3(c.cTend)} + {d3(c.pE)}×{d3(c.cExpo)} + {d3(c.pX)}×{d3(c.cExt)} )<br/>
                    = 1000 × {d3(c.soma)} = <b className="text-amber-300 text-sm">{c.score} → classe {ex.cliente.classe}</b>
                  </Formula>
                </div>
                <div>
                  <b className="text-gray-100">Limite sugerido</b> — maior acúmulo × (0,5 + score ÷ 2000):
                  <Formula>
                    {fmt(d.maior_acumulo)} × (0,5 + {c.score}÷2000) ≈ <b className="text-prim-300">{fmt(ex.cliente.limite_sugerido)}</b>
                  </Formula>
                </div>
              </div>

              <div className="text-[11px] text-gray-600 mt-1">
                Conferência: o motor de score gravou para este cliente a nota{' '}
                <b className="text-gray-400">{ex.cliente.score}</b> — o passo a passo acima reproduz exatamente o cálculo.
              </div>
            </>
          );
        })()}
      </Secao>

      {/* 4. Limitacoes */}
      <Secao icone={<AlertCircle size={16} />} titulo="4. O que ainda não entra (e por quê)">
        <ul className="list-disc list-inside space-y-1 text-gray-400">
          <li><b>Tendência</b> vale 0,5 (neutro) para todo mundo até a série de 30 dias
            acumular — o histórico diário começou em 14/05/2026.</li>
          <li><b>Exposição</b> usa o maior acúmulo histórico como referência porque <b>não há
            limite de crédito cadastrado</b> nesta base do Mega. Quando houver limite, ele
            entra no lugar.</li>
          <li><b>Serasa / SPC</b> não entram — não há data de consulta preenchida na base.</li>
          <li><b>SUFRAMA</b> nunca pesa no crédito — é bloqueio fiscal, não risco de pagamento.</li>
          <li>Clientes <b>internos</b> (a própria empresa) e de <b>grupo de crédito isento</b>
            recebem nota, mas ficam ocultos por padrão na carteira.</li>
        </ul>
      </Secao>

      <div className="text-right text-sm text-gray-500 pt-2 pb-6">
        <div className="inline-block border-t border-ink-700 pt-2">
          <b className="text-prim-400">CCS Tecno</b> — Alexandre Carvalho
        </div>
      </div>
    </div>
  );
}
