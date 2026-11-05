// [25/10/2026 - CRIADO POR ALEXANDRE CARVALHO] Liberação › LIBERAÇÃO DE ENCARGOS (fase 2 Quality, módulo LIBERA_ENCARGOS).
// Quem não tem o módulo pede, na tela Baixar e conciliar, para isentar ou alterar juros/multa/desconto de um título.
// Aqui a administradora (Odette, a princípio) libera (podendo ajustar os valores) ou nega, com parecer. Tudo fica no histórico.
import React, { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, Loader2, Clock3, History, RefreshCw } from 'lucide-react';
import { api } from '../../api/client';

const fmt   = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtN  = v => Number(v || 0).toLocaleString('pt-BR');
const fmtBr = s => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—');
const fmtHr = s => (s ? `${fmtBr(s)} ${String(s).slice(11, 16)}` : '—');
const ST    = { P: ['pendente', 'text-amber-300'], L: ['liberado', 'text-emerald-300'], N: ['negado', 'text-rose-300'], U: ['usado na baixa', 'text-sky-300'], C: ['cancelado', 'text-gray-400'] };

export default function LiberacaoEncargos() {
  const [aba, setAba]       = useState('P');          // P pendentes | H histórico
  const [itens, setItens]   = useState(null);
  const [erro, setErro]     = useState('');
  const [aberto, setAberto] = useState(null);         // { id, acao: 'L'|'N', parecer, v }
  const [rodando, setRodando] = useState(false);

  const carregar = () => { setItens(null); api.bxcPedidos(aba === 'P' ? 'P' : 'H').then(r => setItens(r.itens || [])).catch(e => { setItens([]); setErro(e.message || 'Falha ao carregar.'); }); };
  useEffect(() => { carregar(); }, [aba]);

  async function decidir() {
    if (!aberto) return;
    setRodando(true);
    try {
      if (aberto.acao === 'L') await api.bxcPedidoLiberar(aberto.id, { parecer: aberto.parecer, pedido: { juros: Number(aberto.v.juros || 0), multa: Number(aberto.v.multa || 0), desconto: Number(aberto.v.desconto || 0) } });
      else await api.bxcPedidoNegar(aberto.id, { parecer: aberto.parecer });
      setAberto(null); carregar();
    } catch (e) { setErro(e.message || 'Não consegui gravar a decisão.'); }
    setRodando(false);
  }

  return (
    <div className="p-6 space-y-6 max-w-[1100px] mx-auto">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-100 tracking-tight">Liberação de encargos</h1>
          <p className="text-sm text-gray-500">Pedidos para isentar ou alterar juros, multa e desconto nas baixas feitas pelo Gestor.</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="inline-flex rounded-lg bg-ink-800 border border-ink-700 p-0.5">
            {[['P', 'Pendentes'], ['H', 'Histórico']].map(([k, l]) => <button key={k} onClick={() => setAba(k)} className={`px-3 py-1.5 rounded-md text-xs ${aba === k ? 'bg-ink-700 text-white' : 'text-gray-400 hover:text-gray-200'}`}>{l}</button>)}
          </div>
          <button className="btn-ghost text-xs" onClick={carregar}><RefreshCw size={14} /> Atualizar</button>
        </div>
      </div>
      {erro && <div className="bg-rose-900/40 text-rose-200 text-sm rounded-lg p-3">{erro}</div>}
      {itens === null && <div className="text-sm text-gray-400 flex items-center gap-2 py-10 justify-center"><Loader2 size={16} className="animate-spin" /> carregando…</div>}
      {itens && itens.length === 0 && <div className="py-16 text-center"><div className="text-3xl font-semibold text-gray-200">{aba === 'P' ? 'Nenhum pedido pendente' : 'Sem histórico no período'}</div></div>}
      <div className="space-y-3">
        {(itens || []).map(p => {
          const ped = p.pedido || {}, calc = p.calc || {};
          const ab = aberto?.id === p.id ? aberto : null;
          return (
            <div key={p.id} className="card p-5 space-y-3">
              <div className="flex flex-wrap items-start gap-4">
                <div className="flex-1 min-w-[260px]">
                  <div className="text-gray-100">{p.titulo?.agn_nome} <span className="font-mono text-gray-400">{p.titulo?.doc}/{p.titulo?.parcela}</span></div>
                  <div className="text-xs text-gray-500 mt-0.5">{p.tipo === 'P' ? 'a pagar' : 'a receber'} · venc. {fmtBr(p.titulo?.venc)} · saldo {fmt(p.titulo?.saldo)} · o banco movimentou {fmt(p.valor_banco)}</div>
                </div>
                <div className="text-sm">
                  <div className="text-[11px] uppercase tracking-wider text-gray-500">pela regra</div>
                  <div className="text-gray-400">juros {fmt(calc.juros)} · multa {fmt(calc.multa)} · desconto {fmt(calc.desconto)}</div>
                </div>
                <div className="text-sm">
                  <div className="text-[11px] uppercase tracking-wider text-gray-500">pedido</div>
                  <div className="text-gray-100">juros {fmt(ped.juros)} · multa {fmt(ped.multa)} · desconto {fmt(ped.desconto)}</div>
                </div>
                <div className={`text-xs ${ST[p.status]?.[1] || 'text-gray-400'} flex items-center gap-1`}>{p.status === 'P' ? <Clock3 size={13} /> : p.status === 'L' ? <CheckCircle2 size={13} /> : p.status === 'N' ? <XCircle size={13} /> : <History size={13} />} {ST[p.status]?.[0] || p.status}</div>
              </div>
              <div className="text-sm text-gray-300"><span className="text-gray-500">motivo:</span> {p.motivo || '—'} <span className="text-gray-600 text-xs">· {p.solicitante} · {fmtHr(p.em)}</span></div>
              {p.status !== 'P' && (p.liberador || p.parecer) && <div className="text-xs text-gray-500">{p.liberador} em {fmtHr(p.lib_em)}{p.parecer ? ` · ${p.parecer}` : ''}</div>}
              {p.status === 'P' && !ab && (
                <div className="flex gap-2">
                  <button className="btn-prim text-xs py-1.5" onClick={() => setAberto({ id: p.id, acao: 'L', parecer: '', v: { juros: ped.juros ?? 0, multa: ped.multa ?? 0, desconto: ped.desconto ?? 0 } })}><CheckCircle2 size={13} /> Liberar</button>
                  <button className="btn-ghost text-xs py-1.5" onClick={() => setAberto({ id: p.id, acao: 'N', parecer: '', v: {} })}><XCircle size={13} /> Negar</button>
                </div>
              )}
              {ab && (
                <div className="rounded-lg bg-ink-900 border border-ink-700 p-4 space-y-3">
                  {ab.acao === 'L' && <div className="grid grid-cols-3 gap-3">
                    {[['juros', 'Juros'], ['multa', 'Multa'], ['desconto', 'Desconto']].map(([k, l]) => (
                      <label key={k} className="text-xs text-gray-400 space-y-1"><span>{l} liberado</span>
                        <input type="number" step="0.01" min="0" className="input" value={ab.v[k]} onChange={e => setAberto({ ...ab, v: { ...ab.v, [k]: e.target.value } })} /></label>))}
                  </div>}
                  <input className="input" placeholder={ab.acao === 'L' ? 'parecer (opcional)' : 'parecer (obrigatório)'} value={ab.parecer} onChange={e => setAberto({ ...ab, parecer: e.target.value })} />
                  <div className="flex gap-2 justify-end">
                    <button className="btn-ghost text-xs" disabled={rodando} onClick={() => setAberto(null)}>Cancelar</button>
                    <button className="btn-prim text-xs" disabled={rodando || (ab.acao === 'N' && !ab.parecer.trim())} onClick={decidir}>{rodando ? <Loader2 size={13} className="animate-spin" /> : null} {ab.acao === 'L' ? 'Confirmar liberação' : 'Confirmar negativa'}</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {itens && itens.length > 0 && <div className="text-xs text-gray-600">{fmtN(itens.length)} pedido(s)</div>}
    </div>
  );
}
