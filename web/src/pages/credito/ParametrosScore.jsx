// [14/05/2026 - CRIADO POR ALEXANDRE CARVALHO] Inteligencia de Credito > Parametros.
// Tela admin para ajustar o motor de score (CCS_TB_GFIN_SCORE_PARAM) em linguagem
// clara - cada parametro tem rotulo amigavel + explicacao do efeito pratico.
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, SlidersHorizontal, Save, Scale, Layers, Wrench } from 'lucide-react';
import { api } from '../../api/client';

// Rotulo amigavel + explicacao do efeito de cada parametro (a chave tecnica fica
// so como referencia pequena). unidade: como o numero deve ser lido.
const META = {
  PESO_COMPORTAMENTO: {
    label: 'Comportamento de pagamento',
    ajuda: 'Quanto o histórico de atraso do cliente (atraso médio e pior atraso já tido) pesa na nota.',
    unidade: 'peso (0 a 1)'
  },
  PESO_INADIMPLENCIA: {
    label: 'Inadimplência atual',
    ajuda: 'Quanto a dívida vencida hoje e o maior atraso em aberto pesam na nota.',
    unidade: 'peso (0 a 1)'
  },
  PESO_TENDENCIA: {
    label: 'Tendência',
    ajuda: 'Quanto a evolução recente pesa — se a dívida vencida vem caindo ou subindo nos últimos 30 dias.',
    unidade: 'peso (0 a 1)'
  },
  PESO_EXPOSICAO: {
    label: 'Exposição',
    ajuda: 'Quanto o tamanho da dívida atual comparado ao maior acúmulo histórico do cliente pesa na nota.',
    unidade: 'peso (0 a 1)'
  },
  PESO_EXTERNO: {
    label: 'Sinais negativos',
    ajuda: 'Quanto cartório, cheques devolvidos e bloqueios financeiros pesam na nota. (SUFRAMA não entra.)',
    unidade: 'peso (0 a 1)'
  },
  FAIXA_A: {
    label: 'Nota mínima para classe A',
    ajuda: 'Cliente com nota igual ou acima deste valor é classe A — o melhor perfil de risco.',
    unidade: 'nota (0 a 1000)'
  },
  FAIXA_B: {
    label: 'Nota mínima para classe B',
    ajuda: 'A partir desta nota o cliente é classe B (e abaixo de A).',
    unidade: 'nota (0 a 1000)'
  },
  FAIXA_C: {
    label: 'Nota mínima para classe C',
    ajuda: 'A partir desta nota o cliente é classe C (e abaixo de B).',
    unidade: 'nota (0 a 1000)'
  },
  FAIXA_D: {
    label: 'Nota mínima para classe D',
    ajuda: 'A partir desta nota o cliente é classe D. Abaixo deste valor, classe E — o pior perfil.',
    unidade: 'nota (0 a 1000)'
  },
  NORM_ATRASO_ATUAL: {
    label: 'Atraso atual que zera a nota de inadimplência',
    ajuda: 'Se o maior atraso em aberto do cliente chegar a este número de dias, a parte de "inadimplência atual" da nota vai a zero. Quanto menor, mais rígido o sistema fica.',
    unidade: 'dias'
  },
  NORM_ATRASO_MEDIO: {
    label: 'Atraso médio que zera a nota de comportamento',
    ajuda: 'Se o atraso médio histórico do cliente chegar a este número de dias, a parte de "comportamento de pagamento" da nota vai a zero.',
    unidade: 'dias'
  },
  NORM_MAIOR_ATRASO: {
    label: 'Pior atraso histórico que zera o sub-fator',
    ajuda: 'Se o pior atraso que o cliente já teve na vida chegar a este número de dias, esse pedaço da nota de comportamento vai a zero.',
    unidade: 'dias'
  }
};

// Secoes da tela, na ordem de exibicao
const GRUPOS = [
  {
    titulo: 'Pesos dos 5 fatores da nota',
    icone: <Scale size={16} />,
    desc: 'A nota de risco (0 a 1000) é a soma de 5 fatores. Estes números dizem o quanto cada fator vale no total — devem somar 1,00.',
    chaves: ['PESO_COMPORTAMENTO', 'PESO_INADIMPLENCIA', 'PESO_TENDENCIA', 'PESO_EXPOSICAO', 'PESO_EXTERNO']
  },
  {
    titulo: 'Faixas das classes A a E',
    icone: <Layers size={16} />,
    desc: 'A partir de que nota o cliente entra em cada classe. Acima da faixa A é classe A (melhor); abaixo da faixa D é classe E (pior).',
    chaves: ['FAIXA_A', 'FAIXA_B', 'FAIXA_C', 'FAIXA_D']
  },
  {
    titulo: 'Ajustes de sensibilidade',
    icone: <Wrench size={16} />,
    desc: 'Limites que controlam quão rígido o cálculo da nota é.',
    chaves: ['NORM_ATRASO_ATUAL', 'NORM_ATRASO_MEDIO', 'NORM_MAIOR_ATRASO']
  }
];

export default function ParametrosScore() {
  const nav = useNavigate();
  const [params, setParams] = useState([]);
  const [busy, setBusy]     = useState(true);
  const [erro, setErro]     = useState('');
  const [msg,  setMsg]      = useState('');
  const [salvando, setSalvando] = useState(false);

  async function carregar() {
    setBusy(true); setErro('');
    try { setParams(await api.creditoParametros()); }
    catch (e) { setErro(e.message || 'Erro ao carregar parâmetros'); }
    finally { setBusy(false); }
  }
  useEffect(() => { carregar(); }, []);

  function setValor(chave, valor) {
    setParams(ps => ps.map(p => p.chave === chave ? { ...p, valor } : p));
  }

  async function salvar() {
    setSalvando(true); setErro(''); setMsg('');
    try {
      const payload = params.map(p => ({ chave: p.chave, valor: Number(p.valor) || 0 }));
      const r = await api.creditoSalvarParametros(payload);
      setMsg(`${r.atualizados} parâmetro(s) salvo(s). Valem no próximo recálculo da nota (job das 03:30).`);
    } catch (e) { setErro(e.message || 'Erro ao salvar'); }
    finally { setSalvando(false); }
  }

  const valOf = ch => Number(params.find(p => p.chave === ch)?.valor) || 0;
  const somaPesos = ['PESO_COMPORTAMENTO','PESO_INADIMPLENCIA','PESO_TENDENCIA','PESO_EXPOSICAO','PESO_EXTERNO']
    .reduce((s, ch) => s + valOf(ch), 0);
  // chaves nao mapeadas (defensivo: se surgir parametro novo no banco)
  const mapeadas = new Set(GRUPOS.flatMap(g => g.chaves));
  const outras = params.filter(p => !mapeadas.has(p.chave));

  return (
    <div className="p-6 space-y-5 max-w-3xl mx-auto">
      <button className="btn-ghost" onClick={() => nav('/credito/carteira')}>
        <ArrowLeft size={16} /> Carteira de Crédito
      </button>

      <div>
        <h1 className="text-xl font-bold text-prim-400 flex items-center gap-2">
          <SlidersHorizontal size={20} /> Parâmetros do Score
        </h1>
        <p className="text-sm text-gray-400 mt-1">
          Aqui você ajusta como a nota de risco de cada cliente é calculada. Toda mudança
          passa a valer no próximo recálculo automático (todo dia às 03:30).
        </p>
      </div>

      {erro && <div className="bg-red-900/40 text-red-200 text-sm rounded p-3">{erro}</div>}
      {msg  && <div className="bg-emerald-900/40 text-emerald-200 text-sm rounded p-3">{msg}</div>}

      {busy ? (
        <div className="text-gray-400">Carregando...</div>
      ) : (
        <>
          {GRUPOS.map(g => (
            <div key={g.titulo} className="card p-4">
              <div className="text-sm font-semibold text-gray-100 flex items-center gap-1.5">
                {g.icone} {g.titulo}
              </div>
              <p className="text-xs text-gray-500 mt-1 mb-3">{g.desc}</p>

              <div className="divide-y divide-ink-700">
                {g.chaves.map(ch => {
                  const p = params.find(x => x.chave === ch);
                  if (!p) return null;
                  const m = META[ch] || { label: ch, ajuda: p.descricao || '', unidade: '' };
                  return (
                    <div key={ch} className="flex items-start gap-4 py-2.5">
                      <div className="flex-1">
                        <div className="text-sm text-gray-200 font-medium">{m.label}</div>
                        <div className="text-xs text-gray-500 mt-0.5">{m.ajuda}</div>
                        <div className="text-[10px] text-gray-600 font-mono mt-0.5">{ch}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <input type="number" step="any"
                          className="input py-1 w-28 text-right font-mono"
                          value={p.valor}
                          onChange={e => setValor(ch, e.target.value)} />
                        {m.unidade && <div className="text-[10px] text-gray-600 mt-0.5">{m.unidade}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>

              {g.chaves[0]?.startsWith('PESO_') && (
                <div className={`text-xs mt-3 flex items-center gap-1.5
                  ${Math.abs(somaPesos - 1) < 0.001 ? 'text-emerald-400' : 'text-amber-400'}`}>
                  <Scale size={13} />
                  Soma dos pesos: <b>{somaPesos.toFixed(2)}</b>
                  {Math.abs(somaPesos - 1) < 0.001
                    ? ' — ok, fecha em 1,00'
                    : ' — o recomendado é somar exatamente 1,00 para a nota usar a escala cheia.'}
                </div>
              )}
            </div>
          ))}

          {outras.length > 0 && (
            <div className="card p-4">
              <div className="text-sm font-semibold text-gray-100 mb-2">Outros parâmetros</div>
              <div className="divide-y divide-ink-700">
                {outras.map(p => (
                  <div key={p.chave} className="flex items-center gap-4 py-2.5">
                    <div className="flex-1">
                      <div className="text-sm text-gray-200 font-mono">{p.chave}</div>
                      <div className="text-xs text-gray-500">{p.descricao}</div>
                    </div>
                    <input type="number" step="any"
                      className="input py-1 w-28 text-right font-mono"
                      value={p.valor}
                      onChange={e => setValor(p.chave, e.target.value)} />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button className="btn-prim" onClick={salvar} disabled={salvando}>
              <Save size={16} /> {salvando ? 'Salvando...' : 'Salvar parâmetros'}
            </button>
            <span className="text-xs text-gray-500">
              As mudanças não recalculam a nota na hora — valem no próximo ciclo das 03:30.
            </span>
          </div>
        </>
      )}
    </div>
  );
}
