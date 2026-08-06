// [14/05/2026 - CRIADO POR ALEXANDRE CARVALHO] Inteligencia de Credito > Painel Executivo.
// Visao consolidada da carteira de credito: KPIs, aging, distribuicao por classe,
// evolucao (serie do snapshot), forecast de recebimento, ANALISE POR FILIAL e top
// devedores. Tudo sobre os clientes que a regra de bloqueio pega (externos).
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  TrendingDown, Users, Gauge, Clock, CalendarClock, Building2, ListChecks, Activity
} from 'lucide-react';
import { api } from '../../api/client';
import { CLASSE_COR } from './CarteiraCredito.jsx';

const fmt  = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtK = v => Number(v || 0).toLocaleString('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
const fmtN = v => Number(v || 0).toLocaleString('pt-BR');

// mini grafico de linha (SVG puro)
function Spark({ valores, cor = '#10b981', altura = 48 }) {
  const v = (valores || []).filter(x => x != null);
  if (v.length < 2) return <div className="text-xs text-gray-600 py-3">histórico insuficiente — a série acumula a partir de 14/05/2026</div>;
  const min = Math.min(...v), max = Math.max(...v), span = max - min || 1, w = 600;
  const pts = v.map((x, i) => `${(i / (v.length - 1)) * w},${altura - ((x - min) / span) * (altura - 6) - 3}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${altura}`} className="w-full" style={{ height: altura }} preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={cor} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export default function PainelExecutivo() {
  const nav = useNavigate();
  const [p,    setP]    = useState(null);
  const [busy, setBusy] = useState(true);
  const [erro, setErro] = useState('');

  useEffect(() => {
    setBusy(true); setErro('');
    api.creditoPainel()
      .then(setP)
      .catch(e => setErro(e.message || 'Erro ao carregar o painel'))
      .finally(() => setBusy(false));
  }, []);

  // maior valor de aging para escalar as barras
  const agMax = useMemo(() => p
    ? Math.max(1, p.aging.d1_30, p.aging.d31_60, p.aging.d61_90, p.aging.d90p) : 1, [p]);
  const filMax = useMemo(() => p
    ? Math.max(1, ...p.por_filial.map(f => f.vl_vencido)) : 1, [p]);

  if (busy) return <div className="p-6 text-gray-400 text-sm">Carregando painel executivo...</div>;
  if (erro) return <div className="p-6"><div className="bg-red-900/40 text-red-200 text-sm rounded p-3">{erro}</div></div>;
  if (!p) return null;

  const k = p.kpi;
  const totClasse = Object.values(p.por_classe).reduce((s, x) => s + x.qt, 0) || 1;

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-prim-400 flex items-center gap-2">
          <Activity size={20} /> Inteligência de Crédito · Painel Executivo
        </h1>
        <p className="text-sm text-gray-400">
          Visão consolidada da carteira de crédito — clientes que a regra de bloqueio realmente
          pega (internos e grupo isento ficam de fora).
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi icon={<TrendingDown size={15} />} label="Inadimplência" value={`${k.pct_inadimplencia}%`}
             sub={`${fmt(k.vl_vencido)} vencido`} color="rose" />
        <Kpi icon={<Building2 size={15} />} label="Carteira total" value={fmtK(k.vl_carteira)}
             sub={`${fmt(k.vl_avencer)} a vencer`} color="prim" />
        <Kpi icon={<Users size={15} />} label="Clientes" value={fmtN(k.qt_clientes)}
             sub={`${fmtN(k.qt_inadimplentes)} inadimplentes`} color="acc" />
        <Kpi icon={<Clock size={15} />} label="Atraso médio" value={`${fmtN(k.prazo_medio_atraso)}d`}
             sub="ponderado pelo saldo" color="rose" />
        <Kpi icon={<Gauge size={15} />} label="Score médio" value={fmtN(k.score_medio)}
             sub="0–1000" color={k.score_medio >= 600 ? 'prim' : k.score_medio >= 400 ? 'acc' : 'rose'} />
        <Kpi icon={<CalendarClock size={15} />} label="A receber 30d" value={fmtK(p.forecast.j30)}
             sub="próximos 30 dias" color="prim" />
      </div>

      {/* Aging + Classes */}
      <div className="grid md:grid-cols-2 gap-5">
        <div className="card p-4">
          <div className="text-sm font-semibold text-prim-400 mb-3">Aging do saldo vencido</div>
          <div className="space-y-2">
            {[['1 a 30 dias', p.aging.d1_30, 'bg-amber-500'],
              ['31 a 60 dias', p.aging.d31_60, 'bg-orange-500'],
              ['61 a 90 dias', p.aging.d61_90, 'bg-rose-500'],
              ['90+ dias', p.aging.d90p, 'bg-rose-700']].map(([l, v, bg]) => (
              <div key={l}>
                <div className="flex justify-between text-xs text-gray-400">
                  <span>{l}</span><span className="font-mono text-gray-300">{fmt(v)}</span>
                </div>
                <div className="h-2.5 bg-ink-700 rounded overflow-hidden mt-0.5">
                  <div className={`h-full ${bg}`} style={{ width: `${(v / agMax) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-4">
          <div className="text-sm font-semibold text-prim-400 mb-3">Distribuição por classe de risco</div>
          <div className="flex h-6 rounded overflow-hidden mb-3">
            {['A','B','C','D','E'].map(c => {
              const qt = p.por_classe[c]?.qt || 0, w = qt / totClasse * 100;
              if (!w) return null;
              const bg = { A:'bg-emerald-500', B:'bg-sky-500', C:'bg-amber-500', D:'bg-orange-500', E:'bg-rose-500' }[c];
              return <div key={c} className={bg} style={{ width: `${w}%` }} title={`${c}: ${qt}`} />;
            })}
          </div>
          <div className="space-y-1">
            {['A','B','C','D','E'].map(c => (
              <div key={c} className="flex items-center gap-2 text-xs">
                <span className={`w-6 text-center rounded font-bold ${CLASSE_COR[c] || 'bg-ink-700 text-gray-400'}`}>{c}</span>
                <span className="text-gray-300">{fmtN(p.por_classe[c]?.qt || 0)} cliente(s)</span>
                <span className="text-gray-500 ml-auto font-mono">{fmt(p.por_classe[c]?.vl_vencido || 0)} vencido</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Evolucao */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-semibold text-prim-400">Evolução da inadimplência</div>
          <div className="text-xs text-gray-500">{p.evolucao.length} dia(s) de histórico</div>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-gray-400 mb-0.5">Saldo vencido (R$)</div>
            <Spark valores={p.evolucao.map(e => e.vl_vencido)} cor="#f43f5e" />
          </div>
          <div>
            <div className="text-xs text-gray-400 mb-0.5">% inadimplência</div>
            <Spark valores={p.evolucao.map(e => e.pct_inadimplencia)} cor="#f59e0b" />
          </div>
        </div>
      </div>

      {/* Forecast */}
      <div className="card p-4">
        <div className="text-sm font-semibold text-prim-400 mb-3 flex items-center gap-1.5">
          <CalendarClock size={16} /> Forecast de recebimento (títulos a vencer)
        </div>
        <div className="grid grid-cols-3 gap-3 text-center">
          {[['Próximos 30 dias', p.forecast.j30], ['31 a 60 dias', p.forecast.j60], ['61 a 90 dias', p.forecast.j90]].map(([l, v]) => (
            <div key={l} className="bg-ink-900 rounded p-3">
              <div className="text-xs text-gray-500">{l}</div>
              <div className="text-lg font-bold font-mono text-prim-300 mt-1">{fmt(v)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ANALISE POR FILIAL */}
      <div className="card overflow-hidden">
        <div className="bg-ink-900 px-4 py-3 border-b border-ink-700 text-sm font-semibold flex items-center gap-1.5">
          <Building2 size={16} className="text-prim-400" /> Análise por filial
          <span className="ml-auto text-xs text-gray-400">{p.por_filial.length} filial(is)</span>
        </div>
        <div className="overflow-auto max-h-[50vh]">
          <table className="w-full text-sm">
            <thead className="bg-ink-900/70 text-gray-400 uppercase text-xs sticky top-0">
              <tr>
                <th className="text-left p-2 pl-4">Filial</th>
                <th className="text-right p-2">Clientes</th>
                <th className="text-right p-2">Carteira</th>
                <th className="text-right p-2">Vencido</th>
                <th className="text-center p-2 w-[180px]">% Inadimplência</th>
                <th className="text-right p-2">31-60</th>
                <th className="text-right p-2">61-90</th>
                <th className="text-right p-2 pr-4">90+</th>
              </tr>
            </thead>
            <tbody>
              {p.por_filial.map(f => (
                <tr key={f.fil_id} className="border-t border-ink-700 hover:bg-ink-800/40">
                  <td className="p-2 pl-4 font-mono text-gray-200">{f.fil_id}</td>
                  <td className="p-2 text-right font-mono text-gray-300">
                    {fmtN(f.qt_clientes)}
                    <span className="text-gray-600"> / {fmtN(f.qt_inadimplentes)}</span>
                  </td>
                  <td className="p-2 text-right font-mono text-gray-400">{fmt(f.vl_carteira)}</td>
                  <td className="p-2 text-right font-mono text-rose-300 font-semibold">{fmt(f.vl_vencido)}</td>
                  <td className="p-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-ink-700 rounded overflow-hidden">
                        <div className={`h-full ${f.pct_inadimplencia >= 50 ? 'bg-rose-500'
                                       : f.pct_inadimplencia >= 20 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                             style={{ width: `${Math.min(100, f.pct_inadimplencia)}%` }} />
                      </div>
                      <span className="text-xs font-mono text-gray-300 w-11 text-right">{f.pct_inadimplencia}%</span>
                    </div>
                  </td>
                  <td className="p-2 text-right font-mono text-xs text-amber-400">{f.aging.d31_60 ? fmtK(f.aging.d31_60) : '—'}</td>
                  <td className="p-2 text-right font-mono text-xs text-orange-400">{f.aging.d61_90 ? fmtK(f.aging.d61_90) : '—'}</td>
                  <td className="p-2 pr-4 text-right font-mono text-xs text-rose-400 font-bold">{f.aging.d90p ? fmtK(f.aging.d90p) : '—'}</td>
                </tr>
              ))}
              {p.por_filial.length === 0 && (
                <tr><td colSpan={8} className="p-6 text-center text-gray-500">Sem dados por filial.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Top devedores */}
      <div className="card overflow-hidden">
        <div className="bg-ink-900 px-4 py-3 border-b border-ink-700 text-sm font-semibold flex items-center gap-1.5">
          <ListChecks size={16} className="text-prim-400" /> Top 10 devedores
        </div>
        <table className="w-full text-sm">
          <tbody>
            {p.top_devedores.map((d, i) => (
              <tr key={d.agn_id}
                  className="border-t border-ink-700 hover:bg-ink-800/40 cursor-pointer"
                  onClick={() => nav(`/credito/cliente/${d.agn_id}`)}>
                <td className="p-2 pl-4 text-gray-600 font-mono w-8">{i + 1}</td>
                <td className="p-2">
                  <div className="text-gray-200">{d.cliente}</div>
                  <div className="text-xs text-gray-500 font-mono">cód. {d.agn_id}</div>
                </td>
                <td className="p-2 text-center">
                  <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${CLASSE_COR[d.classe] || 'bg-ink-700 text-gray-400'}`}>
                    {d.score ?? '—'}
                  </span>
                </td>
                <td className="p-2 text-right font-mono text-gray-400 text-xs">{fmtN(d.maior_atraso)}d atraso</td>
                <td className="p-2 pr-4 text-right font-mono text-rose-300 font-semibold">{fmt(d.vl_vencido)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Kpi({ icon, label, value, sub, color = 'prim' }) {
  const map = {
    prim: { border: 'border-prim-500', text: 'text-prim-400' },
    acc:  { border: 'border-acc-500',  text: 'text-acc-500'  },
    rose: { border: 'border-rose-500', text: 'text-rose-400' }
  };
  const c = map[color] || map.prim;
  return (
    <div className={`kpi border-l-4 ${c.border}`}>
      <div className="kpi-label flex items-center gap-1 text-xs">{icon} {label}</div>
      <div className={`kpi-value ${c.text}`}>{value}</div>
      {sub && <div className="text-[11px] text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}
