// [14/05/2026 - CRIADO POR ALEXANDRE CARVALHO] Inteligencia de Credito > Ficha 360.
// Visao completa do cliente: score + componentes, carteira atual, estatistica
// nativa do Mega (perfil de pagamento), tendencia, bloqueios e titulos em aberto.
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Gauge, Wallet, History, ShieldX, FileText } from 'lucide-react';
import { api } from '../../api/client';
import { ClasseBadge, ScoreBar } from './CarteiraCredito.jsx';

const fmt   = v => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const fmtN  = v => (v == null ? '—' : Number(v).toLocaleString('pt-BR'));
const fmtBr = iso => (iso ? iso.split('-').reverse().join('/') : '—');

const COMPONENTES = [
  { k: 'comportamento', l: 'Comportamento de pagamento', peso: '35%' },
  { k: 'inadimplencia', l: 'Inadimplência atual',        peso: '30%' },
  { k: 'tendencia',     l: 'Tendência',                  peso: '15%' },
  { k: 'exposicao',     l: 'Exposição',                  peso: '10%' },
  { k: 'externo',       l: 'Sinais externos / negativos', peso: '10%' }
];

export default function FichaCliente() {
  const { agn } = useParams();
  const nav = useNavigate();
  const [d, setD]       = useState(null);
  const [busy, setBusy] = useState(true);
  const [erro, setErro] = useState('');

  useEffect(() => {
    setBusy(true); setErro('');
    api.creditoCliente(agn)
      .then(setD)
      .catch(e => setErro(e.message || 'Erro ao carregar ficha'))
      .finally(() => setBusy(false));
  }, [agn]);

  if (busy) return <div className="p-6 text-gray-400">Carregando ficha do cliente...</div>;
  if (erro) return (
    <div className="p-6 max-w-4xl mx-auto">
      <button className="btn-ghost mb-3" onClick={() => nav('/credito/carteira')}>
        <ArrowLeft size={16} /> Voltar
      </button>
      <div className="bg-red-900/40 text-red-200 text-sm rounded p-3">{erro}</div>
    </div>
  );
  if (!d) return null;

  const est = d.estatistica || {};
  const car = d.carteira || {};
  const serie = d.tendencia || [];
  const maxVenc = Math.max(1, ...serie.map(s => s.saldo_vencido));

  return (
    <div className="p-6 space-y-5 max-w-5xl mx-auto">
      <button className="btn-ghost" onClick={() => nav('/credito/carteira')}>
        <ArrowLeft size={16} /> Carteira de Crédito
      </button>

      {/* Header: cliente + score */}
      <div className="card p-5 flex flex-wrap items-center gap-6">
        <div className="flex-1 min-w-[200px]">
          <div className="text-xs text-gray-500 font-mono">cód. {d.agn_id}</div>
          <h1 className="text-xl font-bold text-gray-100">{d.cliente}</h1>
          <div className="flex items-center gap-2 mt-1">
            {car.interno && <span className="text-[10px] px-1.5 py-0.5 rounded bg-ink-700 text-gray-400">INTERNO</span>}
            {car.grupo_isento && <span className="text-[10px] px-1.5 py-0.5 rounded bg-ink-700 text-gray-400">GRUPO ISENTO</span>}
            <span className="text-xs text-gray-500">
              {d.dt_calculo ? `score calculado em ${d.dt_calculo}` : 'sem score'}
            </span>
          </div>
        </div>
        <div className="text-center">
          <div className="text-4xl font-bold text-prim-400">{d.score ?? '—'}</div>
          <div className="text-xs text-gray-500">score 0–1000</div>
        </div>
        <div className="text-center">
          <ClasseBadge classe={d.classe} />
          <div className="text-xs text-gray-500 mt-1">classe</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-semibold text-gray-200">{fmt(d.limite_sugerido)}</div>
          <div className="text-xs text-gray-500">limite sugerido</div>
        </div>
      </div>

      {/* Componentes do score */}
      <div className="card p-4">
        <div className="flex items-center gap-2 text-prim-400 font-semibold mb-3">
          <Gauge size={16} /> Composição do score
        </div>
        <div className="space-y-2">
          {COMPONENTES.map(c => {
            const v = d.componentes?.[c.k] ?? 0;
            return (
              <div key={c.k} className="flex items-center gap-3 text-sm">
                <div className="w-56 text-gray-300">{c.l} <span className="text-gray-600 text-xs">({c.peso})</span></div>
                <div className="flex-1 h-2 bg-ink-700 rounded overflow-hidden">
                  <div className={`h-full ${v >= 0.66 ? 'bg-emerald-500' : v >= 0.33 ? 'bg-amber-500' : 'bg-rose-500'}`}
                       style={{ width: `${Math.round(v * 100)}%` }} />
                </div>
                <div className="w-12 text-right font-mono text-xs text-gray-400">{Math.round(v * 100)}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        {/* Carteira atual */}
        <div className="card p-4">
          <div className="flex items-center gap-2 text-prim-400 font-semibold mb-3">
            <Wallet size={16} /> Carteira atual
          </div>
          <div className="grid grid-cols-2 gap-y-2 text-sm">
            <Info l="Saldo total"    v={fmt(car.saldo_total)} />
            <Info l="Saldo vencido"  v={fmt(car.saldo_vencido)} tone="rose" />
            <Info l="A vencer"       v={fmt(car.saldo_avencer)} />
            <Info l="A vencer 30d"   v={fmt(car.avencer_30)} />
            <Info l="Títulos / vencidos" v={`${fmtN(car.qt_tit_total)} / ${fmtN(car.qt_tit_vencidos)}`} />
            <Info l="Maior atraso"   v={`${fmtN(car.maior_atraso_dias)} dias`} tone="rose" />
          </div>
          <div className="mt-3 pt-3 border-t border-ink-700">
            <div className="text-xs text-gray-500 mb-1">Aging do saldo vencido</div>
            <div className="grid grid-cols-4 gap-2 text-center text-xs">
              <Aging l="1–30"  v={car.aging?.d1_30} />
              <Aging l="31–60" v={car.aging?.d31_60} />
              <Aging l="61–90" v={car.aging?.d61_90} />
              <Aging l="90+"   v={car.aging?.d90p} alerta />
            </div>
          </div>
        </div>

        {/* Estatistica nativa Mega */}
        <div className="card p-4">
          <div className="flex items-center gap-2 text-prim-400 font-semibold mb-3">
            <History size={16} /> Perfil de pagamento <span className="text-xs text-gray-600">(estatística Mega)</span>
          </div>
          <div className="grid grid-cols-2 gap-y-2 text-sm">
            <Info l="Atraso médio"        v={est.atraso_medio != null ? `${fmtN(est.atraso_medio)} dias` : '—'} />
            <Info l="Maior atraso (hist.)" v={est.maior_atraso_dias != null ? `${fmtN(est.maior_atraso_dias)} dias` : '—'} />
            <Info l="Parc. pagas c/ atraso" v={fmtN(est.parcelas_com_atraso)} />
            <Info l="Maior acúmulo"       v={fmt(est.maior_acumulo)} />
            <Info l="Valor em cartório"   v={fmt(est.valor_cartorio)} tone={est.valor_cartorio > 0 ? 'rose' : null} />
            <Info l="Cheques devolvidos"  v={fmt(est.cheques_devolvidos)} tone={est.cheques_devolvidos > 0 ? 'rose' : null} />
            <Info l="1ª compra"           v={fmtBr(est.primeira_compra)} />
            <Info l="Última compra"       v={fmtBr(est.ultima_compra)} />
            <Info l="Maior compra"        v={fmt(est.maior_compra)} />
            <Info l="Dias inativo"        v={fmtN(est.dias_inativo)} />
          </div>
          {est.atualizado_em && (
            <div className="text-[11px] text-gray-600 mt-2">estatística atualizada em {fmtBr(est.atualizado_em)}</div>
          )}
        </div>
      </div>

      {/* Tendencia */}
      <div className="card p-4">
        <div className="flex items-center gap-2 text-prim-400 font-semibold mb-3">
          <History size={16} /> Tendência da carteira
        </div>
        {serie.length <= 1 ? (
          <p className="text-sm text-gray-500">
            Histórico ainda acumulando — a série temporal começa no primeiro snapshot.
            Volte em alguns dias para ver a evolução de saldo vencido e score.
          </p>
        ) : (
          <div className="flex items-end gap-1 h-24">
            {serie.map((s, i) => (
              <div key={i} className="flex-1 flex flex-col items-center justify-end group relative">
                <div className="w-full bg-rose-500/70 rounded-t"
                     style={{ height: `${Math.max(2, (s.saldo_vencido / maxVenc) * 100)}%` }} />
                <div className="absolute -top-7 hidden group-hover:block bg-ink-950 border border-ink-700 rounded px-1.5 py-0.5 text-[10px] whitespace-nowrap z-10">
                  {fmtBr(s.data)} · {fmt(s.saldo_vencido)} · score {s.score ?? '—'}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bloqueios + Titulos */}
      <div className="grid md:grid-cols-2 gap-5">
        <div className="card p-4">
          <div className="flex items-center gap-2 text-prim-400 font-semibold mb-3">
            <ShieldX size={16} /> Bloqueios <span className="text-xs text-gray-600">({d.bloqueios?.total || 0})</span>
          </div>
          {(d.bloqueios?.ultimos || []).length === 0 ? (
            <p className="text-sm text-gray-500">Nenhum bloqueio registrado.</p>
          ) : (
            <div className="space-y-1 text-xs">
              {d.bloqueios.ultimos.map((b, i) => (
                <div key={i} className="flex items-center gap-2 text-gray-300">
                  <span className="text-gray-500 font-mono">{b.data}</span>
                  <span className="px-1.5 py-0.5 rounded bg-ink-700">{b.origem}</span>
                  <span className="px-1.5 py-0.5 rounded bg-rose-700/30 text-rose-300">{b.motivo}</span>
                  {b.referencia && <span className="text-gray-500">{b.referencia}</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card p-4">
          <div className="flex items-center gap-2 text-prim-400 font-semibold mb-3">
            <FileText size={16} /> Títulos em aberto <span className="text-xs text-gray-600">({d.titulos?.length || 0})</span>
          </div>
          {(d.titulos || []).length === 0 ? (
            <p className="text-sm text-gray-500">Nenhum título em aberto.</p>
          ) : (
            <div className="overflow-auto max-h-52">
              <table className="w-full text-xs">
                <thead className="text-gray-500 sticky top-0 bg-ink-900">
                  <tr><th className="text-left py-1">Documento</th>
                      <th className="text-center py-1">Filial</th><th className="text-left py-1">Venc.</th>
                      <th className="text-left py-1">Forma Receb.</th>
                      <th className="text-right py-1">Atraso</th><th className="text-right py-1">Saldo</th></tr>
                </thead>
                <tbody>
                  {d.titulos.map((t, i) => (
                    <tr key={i} className="border-t border-ink-800">
                      <td className="py-1 text-gray-300 font-mono">{t.documento}{t.parcela ? `/${t.parcela}` : ''}</td>
                      <td className="py-1 text-center font-mono text-gray-400">{t.fil_id}</td>
                      <td className="py-1 text-gray-400">{fmtBr(t.prorrogado)}</td>
                      <td className="py-1 text-sky-300 max-w-[180px] truncate" title={t.forma_receb || ''}>
                        {t.forma_receb || <span className="text-gray-600">—</span>}
                      </td>
                      <td className={`py-1 text-right font-mono ${t.dias_atraso > 0 ? 'text-rose-400' : 'text-gray-500'}`}>
                        {t.dias_atraso > 0 ? `${fmtN(t.dias_atraso)}d` : 'a vencer'}
                      </td>
                      <td className="py-1 text-right font-mono text-gray-300">{fmt(t.saldo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Info({ l, v, tone }) {
  return (
    <div>
      <div className="text-xs text-gray-500">{l}</div>
      <div className={`font-mono ${tone === 'rose' ? 'text-rose-300' : 'text-gray-200'}`}>{v}</div>
    </div>
  );
}
function Aging({ l, v, alerta }) {
  return (
    <div className="bg-ink-900 rounded p-1.5">
      <div className="text-gray-500">{l}</div>
      <div className={`font-mono ${alerta && v > 0 ? 'text-rose-400 font-bold' : 'text-gray-300'}`}>
        {Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })}
      </div>
    </div>
  );
}
