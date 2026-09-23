// [14/05/2026 - CRIADO POR ALEXANDRE CARVALHO] Inteligencia de Credito > Carteira.
// Grid de todos os clientes pontuados (score 0-1000 + classe A-E), com saldo,
// aging e limite sugerido. Linha clicavel abre a Ficha 360. Export Excel.
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileSpreadsheet, Search, Gauge, AlertTriangle, TrendingDown, SlidersHorizontal } from 'lucide-react';
import * as XLSX from 'xlsx';
import { api, getSession } from '../../api/client';

const fmt   = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtN  = v => Number(v || 0).toLocaleString('pt-BR');

// cor por classe de risco
export const CLASSE_COR = {
  A: 'bg-emerald-700/30 text-emerald-300',
  B: 'bg-prim-700/30   text-prim-300',
  C: 'bg-amber-700/30  text-amber-300',
  D: 'bg-orange-700/30 text-orange-300',
  E: 'bg-rose-700/30   text-rose-300'
};
export function ClasseBadge({ classe }) {
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-bold ${CLASSE_COR[classe] || 'bg-ink-700 text-gray-400'}`}>
      {classe || '—'}
    </span>
  );
}
// barrinha de score 0-1000
export function ScoreBar({ score }) {
  const s = Number(score || 0);
  const cor = s >= 800 ? 'bg-emerald-500' : s >= 600 ? 'bg-prim-500'
            : s >= 400 ? 'bg-amber-500'   : s >= 200 ? 'bg-orange-500' : 'bg-rose-500';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-ink-700 rounded overflow-hidden min-w-[60px]">
        <div className={`h-full ${cor}`} style={{ width: `${s / 10}%` }} />
      </div>
      <span className="text-xs font-mono text-gray-300 w-9 text-right">{s || '—'}</span>
    </div>
  );
}

const FAIXAS_CLASSE = ['todas', 'A', 'B', 'C', 'D', 'E'];

export default function CarteiraCredito() {
  const nav = useNavigate();
  const isAdmin = getSession()?.user?.perm === 'A';
  const [resp,  setResp]  = useState(null);
  const [busy,  setBusy]  = useState(true);
  const [erro,  setErro]  = useState('');
  const [busca, setBusca] = useState('');
  const [classe, setClasse] = useState('todas');
  const [incluirIsentos, setIncluirIsentos] = useState(false);

  async function carregar() {
    setBusy(true); setErro('');
    try { setResp(await api.creditoCarteira()); }
    catch (e) { setErro(e.message || 'Erro ao carregar carteira'); setResp(null); }
    finally { setBusy(false); }
  }
  useEffect(() => { carregar(); }, []);

  const linhas = useMemo(() => {
    if (!resp) return [];
    let arr = resp.clientes;
    if (!incluirIsentos) arr = arr.filter(c => !c.isento);
    if (classe !== 'todas') arr = arr.filter(c => c.classe === classe);
    if (busca.trim()) {
      const q = busca.toLowerCase();
      arr = arr.filter(c => String(c.agn_id).includes(q) || (c.cliente || '').toLowerCase().includes(q));
    }
    return arr;
  }, [resp, incluirIsentos, classe, busca]);

  function exportXlsx() {
    const dados = linhas.map(c => ({
      'Cód. Cliente': c.agn_id, Cliente: c.cliente,
      Score: c.score, Classe: c.classe,
      'Saldo total': c.saldo_total, 'Saldo vencido': c.saldo_vencido,
      'Maior atraso (dias)': c.maior_atraso_dias, 'Títulos vencidos': c.qt_tit_vencidos,
      'Vencido 90+': c.vl_90p, 'Limite sugerido': c.limite_sugerido,
      Comportamento: c.componentes.comportamento, Inadimplência: c.componentes.inadimplencia,
      Tendência: c.componentes.tendencia, Exposição: c.componentes.exposicao, Externo: c.componentes.externo,
      'Isento do bloqueio': c.isento ? 'Sim' : 'Não'
    }));
    const ws = XLSX.utils.json_to_sheet(dados);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Carteira de Crédito');
    XLSX.writeFile(wb, `carteira-credito-${new Date().toISOString().slice(0,10)}.xlsx`);
  }

  const kpi = resp?.kpi;

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-prim-400">Inteligência de Crédito · Carteira</h1>
          <p className="text-sm text-gray-400">
            Score de risco (0–1000) e classe (A–E) de cada cliente, recalculado diariamente.
          </p>
        </div>
        {isAdmin && (
          <button className="btn-ghost" onClick={() => nav('/credito/parametros')}>
            <SlidersHorizontal size={16} /> Parâmetros do Score
          </button>
        )}
      </div>

      {erro && <div className="bg-red-900/40 text-red-200 text-sm rounded p-3">{erro}</div>}

      {kpi && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Kpi icon={<Gauge size={16} />} label="Clientes pontuados" value={fmtN(kpi.qt_clientes)}
               sub="que a regra de bloqueio pega" color="prim" />
          <Kpi icon={<AlertTriangle size={16} />} label="Valor vencido" value={fmt(kpi.vl_vencido)}
               sub="total da carteira bloqueável" color="rose" />
          <Kpi icon={<Gauge size={16} />} label="Score médio" value={fmtN(kpi.score_medio)}
               sub="média da carteira" color={kpi.score_medio >= 600 ? 'prim' : kpi.score_medio >= 400 ? 'acc' : 'rose'} />
          <Kpi icon={<TrendingDown size={16} />} label="Classe D + E" value={
                 fmtN((kpi.por_classe?.D?.qt || 0) + (kpi.por_classe?.E?.qt || 0))}
               sub="clientes de maior risco" color="rose" />
        </div>
      )}

      {/* distribuicao por classe */}
      {kpi && (
        <div className="card p-3 flex flex-wrap gap-2">
          {['A','B','C','D','E'].map(k => (
            <div key={k} className="flex items-center gap-1.5 text-xs">
              <ClasseBadge classe={k} />
              <span className="text-gray-300">{fmtN(kpi.por_classe?.[k]?.qt || 0)} cliente(s)</span>
              <span className="text-gray-500">· {fmt(kpi.por_classe?.[k]?.vl_vencido || 0)} vencido</span>
            </div>
          ))}
        </div>
      )}

      {resp && (
        <div className="card overflow-hidden">
          <div className="bg-ink-900 px-4 py-3 border-b border-ink-700 flex flex-wrap gap-2 items-center">
            <span className="text-sm font-semibold mr-1">Clientes</span>
            <div className="flex gap-1">
              {FAIXAS_CLASSE.map(k => (
                <button key={k}
                  className={`px-3 py-1 rounded text-xs transition
                    ${classe === k ? 'bg-prim-600 text-white' : 'bg-ink-800 hover:bg-ink-700 text-gray-300'}`}
                  onClick={() => setClasse(k)}>
                  {k === 'todas' ? 'Todas' : `Classe ${k}`}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-1.5 text-xs text-gray-300 ml-2 cursor-pointer">
              <input type="checkbox" checked={incluirIsentos}
                     onChange={e => setIncluirIsentos(e.target.checked)} />
              incluir clientes que a regra não bloqueia
            </label>
            <div className="ml-auto flex items-center gap-2 bg-ink-800 px-2 rounded">
              <Search size={14} className="text-gray-500" />
              <input className="bg-transparent outline-none py-1 text-sm w-52"
                     placeholder="Buscar cliente ou código..."
                     value={busca} onChange={e => setBusca(e.target.value)} />
            </div>
            <button className="btn-ghost" onClick={exportXlsx} disabled={linhas.length === 0}>
              <FileSpreadsheet size={16} /> Excel
            </button>
          </div>
          <div className="px-4 py-2 bg-ink-900/50 border-b border-ink-700 text-xs text-gray-400">
            {fmtN(linhas.length)} cliente(s) — clique numa linha para abrir a ficha 360°
          </div>
          <div className="overflow-auto max-h-[58vh]">
            <table className="w-full text-sm">
              <thead className="bg-ink-900/70 text-gray-400 uppercase text-xs sticky top-0">
                <tr>
                  <th className="text-left p-2 pl-4">Cliente</th>
                  <th className="text-center p-2 w-16">Classe</th>
                  <th className="text-left p-2 w-44">Score</th>
                  <th className="text-right p-2">Saldo vencido</th>
                  <th className="text-right p-2">Maior atraso</th>
                  <th className="text-right p-2 pr-4">Limite sugerido</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map(c => (
                  <tr key={c.agn_id}
                      className="border-t border-ink-700 hover:bg-ink-800/50 cursor-pointer"
                      onClick={() => nav(`/credito/cliente/${c.agn_id}`)}>
                    <td className="p-2 pl-4">
                      <div className="text-gray-200 flex items-center gap-1.5">
                        {c.cliente}
                        {c.isento && (
                          <span className="text-[9px] px-1 py-0.5 rounded bg-ink-700 text-gray-400">
                            {c.interno ? 'INTERNO' : 'GRUPO ISENTO'}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 font-mono">cód. {c.agn_id}</div>
                    </td>
                    <td className="p-2 text-center"><ClasseBadge classe={c.classe} /></td>
                    <td className="p-2"><ScoreBar score={c.score} /></td>
                    <td className="p-2 text-right font-mono text-rose-300">{fmt(c.saldo_vencido)}</td>
                    <td className="p-2 text-right font-mono">
                      <span className={c.maior_atraso_dias > 90 ? 'text-rose-400 font-bold'
                                      : c.maior_atraso_dias > 30 ? 'text-amber-400' : 'text-gray-400'}>
                        {fmtN(c.maior_atraso_dias)}d
                      </span>
                    </td>
                    <td className="p-2 pr-4 text-right font-mono text-gray-300">{fmt(c.limite_sugerido)}</td>
                  </tr>
                ))}
                {linhas.length === 0 && (
                  <tr><td colSpan={6} className="p-8 text-center text-gray-500">
                    {busy ? 'Carregando...' : 'Nenhum cliente no filtro.'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {busy && !resp && <div className="text-gray-400 text-sm">Carregando carteira...</div>}
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
      <div className="kpi-label flex items-center gap-1">{icon} {label}</div>
      <div className={`kpi-value ${c.text}`}>{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}
