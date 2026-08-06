// [06/08/2026 - CRIADO POR ALEXANDRE CARVALHO] Liberação de Agentes.
// A liberação manual do bloqueio por atraso (usada da reserva/romaneio até o
// faturamento) era feita no campo específico do cadastro do agente no Mega XT.
// Passou a ser feita aqui, com controle de acesso próprio (módulo
// LIBERACAO_AGENTES) e log de quem liberou/revogou. O motor de bloqueio não
// mudou; a liberação vale até o reset diário das 03:00.
import React, { useEffect, useState } from 'react';
import {
  Search, Unlock, Ban, History, Users, Clock3, CheckCircle2, X, AlertTriangle
} from 'lucide-react';
import { api } from '../api/client';

const fmt   = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtN  = v => Number(v || 0).toLocaleString('pt-BR');
const fmtBrHr = s => (s ? `${s.slice(0, 10).split('-').reverse().join('/')} ${s.slice(11, 16)}` : '—');

export default function LiberacaoAgentes() {
  const [liberados, setLiberados] = useState(null);
  const [busca, setBusca]         = useState('');
  const [resultado, setResultado] = useState(null);   // null = sem busca feita
  const [buscando, setBuscando]   = useState(false);
  const [modal, setModal]         = useState(null);   // { agente, acao: 'liberar'|'revogar' }
  const [hist, setHist]           = useState(null);
  const [histDias, setHistDias]   = useState(30);
  const [aba, setAba]             = useState('liberados');  // liberados | historico
  const [erro, setErro]           = useState('');

  const carregaLiberados = () =>
    api.liberacaoAgnLiberados().then(r => setLiberados(r.liberados)).catch(() => setLiberados([]));
  const carregaHist = (d) =>
    api.liberacaoAgnHistorico(d).then(r => setHist(r.eventos)).catch(() => setHist([]));

  useEffect(() => { carregaLiberados(); }, []);
  useEffect(() => { if (aba === 'historico') carregaHist(histDias); }, [aba, histDias]);

  const buscar = () => {
    const q = busca.trim();
    if (q.length < 2) return;
    setBuscando(true);
    setErro('');
    api.liberacaoAgnBusca(q)
      .then(r => setResultado(r.agentes))
      .catch(() => { setResultado([]); setErro('Falha na busca — tente novamente.'); })
      .finally(() => setBuscando(false));
  };

  const confirmar = (motivo) => {
    const { agente, acao } = modal;
    const chamada = acao === 'liberar' ? api.liberacaoAgnLiberar : api.liberacaoAgnRevogar;
    chamada({ agn: agente.agn, motivo })
      .then(() => {
        setModal(null);
        setErro('');
        carregaLiberados();
        if (resultado) buscar();
        if (aba === 'historico') carregaHist(histDias);
      })
      .catch((e) => {
        setModal(null);
        setErro(e?.message || 'Falha ao gravar.');
      });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-100 flex items-center gap-2">
            <Unlock size={20} className="text-prim-400" /> Liberação de Agentes
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Libera o agente bloqueado por pendência financeira (reserva, romaneio e faturamento).
            A liberação vale <b>até as 03:00 do dia seguinte</b> — depois o bloqueio volta sozinho.
          </p>
        </div>
      </div>

      {erro && (
        <div className="flex items-center gap-2 bg-rose-500/10 border border-rose-500/40 text-rose-300 text-sm rounded px-3 py-2">
          <AlertTriangle size={15} /> {erro}
          <button className="ml-auto" onClick={() => setErro('')}><X size={14} /></button>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Kpi icon={<Users size={16} />} label="Liberados agora" value={liberados ? fmtN(liberados.length) : '…'} color="prim" />
        <Kpi icon={<Clock3 size={16} />} label="Validade da liberação" value="até 03:00" sub="reset automático diário" color="acc" />
      </div>

      {/* Busca / liberar */}
      <div className="card overflow-hidden">
        <div className="bg-ink-900 px-4 py-3 border-b border-ink-700 flex flex-wrap gap-2 items-center">
          <div className="flex items-center gap-2 bg-ink-800 px-2 rounded grow max-w-md">
            <Search size={14} className="text-gray-500" />
            <input className="bg-transparent outline-none py-1.5 text-sm w-full"
                   placeholder="Buscar agente por código ou nome (Enter)…"
                   value={busca}
                   onChange={e => setBusca(e.target.value)}
                   onKeyDown={e => { if (e.key === 'Enter') buscar(); }} />
          </div>
          <button className="btn-prim" onClick={buscar} disabled={buscando || busca.trim().length < 2}>
            {buscando ? 'Buscando…' : 'Buscar'}
          </button>
        </div>
        {resultado && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-ink-900/70 text-gray-400 uppercase text-xs sticky top-0 z-10">
                <tr>
                  <th className="p-2 text-left">Código</th>
                  <th className="p-2 text-left">Agente</th>
                  <th className="p-2 text-right">Títulos em atraso</th>
                  <th className="p-2 text-right">Valor em atraso</th>
                  <th className="p-2 text-center">Situação</th>
                  <th className="p-2 text-center">Ação</th>
                </tr>
              </thead>
              <tbody>
                {resultado.length === 0 && (
                  <tr><td colSpan={6} className="p-4 text-center text-gray-500">Nenhum agente encontrado.</td></tr>
                )}
                {resultado.map(a => (
                  <tr key={a.agn} className="border-t border-ink-800 hover:bg-ink-800/40">
                    <td className="p-2">{a.agn}</td>
                    <td className="p-2">{a.nome}</td>
                    <td className="p-2 text-right">{fmtN(a.qt_atraso)}</td>
                    <td className={`p-2 text-right ${a.vl_atraso > 0 ? 'text-rose-400' : 'text-gray-400'}`}>{fmt(a.vl_atraso)}</td>
                    <td className="p-2 text-center">
                      {a.liberado
                        ? <span className="text-[11px] px-1.5 py-0.5 rounded bg-prim-600/20 text-prim-400 font-semibold">Liberado</span>
                        : a.qt_atraso > 0
                          ? <span className="text-[11px] px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-400 font-semibold">Bloqueável</span>
                          : <span className="text-[11px] px-1.5 py-0.5 rounded bg-ink-700 text-gray-400 font-semibold">Sem pendência</span>}
                    </td>
                    <td className="p-2 text-center">
                      {a.liberado
                        ? <button className="btn-ghost text-rose-400" onClick={() => setModal({ agente: a, acao: 'revogar' })}>
                            <Ban size={14} /> Revogar
                          </button>
                        : <button className="btn-ghost text-prim-400" onClick={() => setModal({ agente: a, acao: 'liberar' })}>
                            <Unlock size={14} /> Liberar
                          </button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Abas: liberados hoje / histórico */}
      <div className="card overflow-hidden">
        <div className="bg-ink-900 px-4 py-3 border-b border-ink-700 flex flex-wrap gap-2 items-center">
          <div className="flex gap-1">
            <button className={`px-3 py-1 rounded text-xs transition ${aba === 'liberados' ? 'bg-prim-600 text-white' : 'bg-ink-800 hover:bg-ink-700 text-gray-300'}`}
                    onClick={() => setAba('liberados')}>
              <CheckCircle2 size={12} className="inline mr-1" />Liberados agora
            </button>
            <button className={`px-3 py-1 rounded text-xs transition ${aba === 'historico' ? 'bg-prim-600 text-white' : 'bg-ink-800 hover:bg-ink-700 text-gray-300'}`}
                    onClick={() => setAba('historico')}>
              <History size={12} className="inline mr-1" />Histórico
            </button>
          </div>
          {aba === 'historico' && (
            <select className="bg-ink-800 text-xs text-gray-300 rounded px-2 py-1.5 outline-none ml-auto"
                    value={histDias} onChange={e => setHistDias(Number(e.target.value))}>
              <option value={7}>Últimos 7 dias</option>
              <option value={30}>Últimos 30 dias</option>
              <option value={90}>Últimos 90 dias</option>
              <option value={365}>Último ano</option>
            </select>
          )}
        </div>

        {aba === 'liberados' && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-ink-900/70 text-gray-400 uppercase text-xs">
                <tr>
                  <th className="p-2 text-left">Código</th>
                  <th className="p-2 text-left">Agente</th>
                  <th className="p-2 text-left">Liberado por</th>
                  <th className="p-2 text-left">Quando</th>
                  <th className="p-2 text-left">Motivo</th>
                  <th className="p-2 text-center">Ação</th>
                </tr>
              </thead>
              <tbody>
                {(liberados || []).length === 0 && (
                  <tr><td colSpan={6} className="p-4 text-center text-gray-500">
                    Nenhum agente com liberação ativa agora.
                  </td></tr>
                )}
                {(liberados || []).map(a => (
                  <tr key={a.agn} className="border-t border-ink-800 hover:bg-ink-800/40">
                    <td className="p-2">{a.agn}</td>
                    <td className="p-2">{a.nome}</td>
                    <td className="p-2">{a.liberado_por || <span className="text-gray-500">fora do portal</span>}</td>
                    <td className="p-2">{fmtBrHr(a.liberado_em)}</td>
                    <td className="p-2 text-gray-400">{a.motivo || '—'}</td>
                    <td className="p-2 text-center">
                      <button className="btn-ghost text-rose-400"
                              onClick={() => setModal({ agente: { agn: a.agn, nome: a.nome }, acao: 'revogar' })}>
                        <Ban size={14} /> Revogar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {aba === 'historico' && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-ink-900/70 text-gray-400 uppercase text-xs">
                <tr>
                  <th className="p-2 text-left">Data</th>
                  <th className="p-2 text-left">Ação</th>
                  <th className="p-2 text-left">Código</th>
                  <th className="p-2 text-left">Agente</th>
                  <th className="p-2 text-left">Usuário</th>
                  <th className="p-2 text-left">Motivo</th>
                </tr>
              </thead>
              <tbody>
                {(hist || []).length === 0 && (
                  <tr><td colSpan={6} className="p-4 text-center text-gray-500">
                    {hist === null ? 'Carregando…' : 'Nenhum evento no período.'}
                  </td></tr>
                )}
                {(hist || []).map(ev => (
                  <tr key={ev.id} className="border-t border-ink-800 hover:bg-ink-800/40">
                    <td className="p-2 whitespace-nowrap">{fmtBrHr(ev.data)}</td>
                    <td className="p-2">
                      {ev.acao === 'LIBEROU'
                        ? <span className="text-[11px] px-1.5 py-0.5 rounded bg-prim-600/20 text-prim-400 font-semibold">Liberou</span>
                        : <span className="text-[11px] px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-400 font-semibold">Revogou</span>}
                    </td>
                    <td className="p-2">{ev.agn}</td>
                    <td className="p-2">{ev.nome}</td>
                    <td className="p-2">{ev.usuario}</td>
                    <td className="p-2 text-gray-400">{ev.motivo || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal && <ModalConfirma modal={modal} onFecha={() => setModal(null)} onConfirma={confirmar} />}
    </div>
  );
}

/* ------------------------------------------------- componentes locais */
function ModalConfirma({ modal, onFecha, onConfirma }) {
  const [motivo, setMotivo] = useState('');
  const liberando = modal.acao === 'liberar';
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onFecha}>
      <div className="bg-ink-900 border border-ink-700 rounded-xl w-full max-w-md p-5 space-y-4"
           onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-gray-100 flex items-center gap-2">
            {liberando
              ? <><Unlock size={16} className="text-prim-400" /> Liberar agente</>
              : <><Ban size={16} className="text-rose-400" /> Revogar liberação</>}
          </h2>
          <button onClick={onFecha}><X size={16} className="text-gray-500 hover:text-gray-300" /></button>
        </div>
        <div className="text-sm text-gray-300">
          <b>{modal.agente.agn}</b> — {modal.agente.nome}
        </div>
        {liberando && (
          <p className="text-xs text-gray-500">
            O agente passa a reservar, gerar romaneio e faturar normalmente <b>até as 03:00</b>,
            quando o bloqueio por atraso volta a valer.
          </p>
        )}
        <div>
          <label className="text-xs text-gray-400 block mb-1">Motivo (opcional)</label>
          <input className="w-full bg-ink-800 rounded px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-prim-500"
                 maxLength={200} value={motivo} onChange={e => setMotivo(e.target.value)}
                 placeholder="Ex.: autorizado pelo financeiro — pagamento confirmado" />
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onFecha}>Cancelar</button>
          <button className={liberando ? 'btn-prim' : 'btn-prim bg-rose-600 hover:bg-rose-500'}
                  onClick={() => onConfirma(motivo.trim())}>
            {liberando ? 'Confirmar liberação' : 'Confirmar revogação'}
          </button>
        </div>
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
      <div className="kpi-label flex items-center gap-1">{icon} {label}</div>
      <div className={`kpi-value ${c.text}`}>{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}
