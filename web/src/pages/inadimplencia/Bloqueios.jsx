// [14/05/2026 - CRIADO POR ALEXANDRE CARVALHO] Inadimplencia > Bloqueios.
// Duas visoes por dia:
//   - Bloqueados:    clientes que o sistema bloqueou no dia (faturamento/reserva),
//                    a partir de CCS_TB_GFIN_BLOQUEIO_LOG.
//   - Desbloqueados: aprovacoes manuais do dia (AGN_BO_BLOQUEIO N->S), com hora
//                    e por quem - vem da auditoria nativa do Mega.
import React, { useEffect, useState } from 'react';
import { ShieldX, ShieldCheck, ChevronRight } from 'lucide-react';
import { api } from '../../api/client';

const hoje = () => new Date().toISOString().slice(0, 10);

export default function Bloqueios() {
  const [data, setData]   = useState(hoje());
  const [aba, setAba]     = useState('bloqueados');   // 'bloqueados' | 'desbloqueados'
  const [bloq, setBloq]   = useState(null);
  const [desb, setDesb]   = useState(null);
  const [busy, setBusy]   = useState(true);
  const [erro, setErro]   = useState('');
  const [abertos, setAbertos] = useState(() => new Set());

  async function carregar(d) {
    setBusy(true); setErro(''); setAbertos(new Set());
    try {
      const [b, x] = await Promise.all([api.inadBloqueios(d), api.inadDesbloqueios(d)]);
      setBloq(b); setDesb(x);
    } catch (e) { setErro(e.message || 'Erro ao carregar'); }
    finally { setBusy(false); }
  }
  useEffect(() => { carregar(data); }, []);  // eslint-disable-line

  function toggle(agn) {
    setAbertos(s => {
      const n = new Set(s);
      n.has(agn) ? n.delete(agn) : n.add(agn);
      return n;
    });
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-xl font-bold text-prim-400 mb-1">Inadimplência · Bloqueios</h1>
      <p className="text-sm text-gray-400 mb-4">
        Histórico diário dos clientes que o sistema bloqueou e das aprovações manuais (desbloqueios).
      </p>

      {/* filtro de data */}
      <div className="card p-3 mb-4 flex items-end gap-3">
        <label className="block">
          <span className="text-xs text-gray-300">Dia</span>
          <input type="date" className="input mt-1 py-1" value={data}
            max={hoje()} onChange={e => setData(e.target.value)} />
        </label>
        <button className="btn-prim py-1.5 text-sm" onClick={() => carregar(data)} disabled={busy}>
          {busy ? 'Carregando...' : 'Consultar'}
        </button>
      </div>

      {erro && <div className="bg-red-900/40 text-red-200 text-sm rounded p-2 mb-3">{erro}</div>}

      {/* abas */}
      <div className="flex gap-1 mb-3">
        <button onClick={() => setAba('bloqueados')}
          className={`px-3 py-2 rounded-lg text-sm flex items-center gap-1.5 transition
            ${aba === 'bloqueados' ? 'bg-ink-700 text-white' : 'text-gray-400 hover:bg-ink-800'}`}>
          <ShieldX size={15} /> Bloqueados
          {bloq && <span className="text-[11px] bg-red-900/50 text-red-200 rounded px-1.5">{bloq.total_clientes}</span>}
        </button>
        <button onClick={() => setAba('desbloqueados')}
          className={`px-3 py-2 rounded-lg text-sm flex items-center gap-1.5 transition
            ${aba === 'desbloqueados' ? 'bg-ink-700 text-white' : 'text-gray-400 hover:bg-ink-800'}`}>
          <ShieldCheck size={15} /> Desbloqueados
          {desb && <span className="text-[11px] bg-emerald-900/50 text-emerald-200 rounded px-1.5">{desb.total}</span>}
        </button>
      </div>

      {busy ? (
        <div className="text-gray-400">Carregando...</div>
      ) : aba === 'bloqueados' ? (
        <TabelaBloqueados bloq={bloq} abertos={abertos} toggle={toggle} />
      ) : (
        <TabelaDesbloqueados desb={desb} />
      )}
    </div>
  );
}

// Bloqueados: 1 linha por cliente, expansivel para ver as ocorrencias do dia.
function TabelaBloqueados({ bloq, abertos, toggle }) {
  if (!bloq || bloq.total_clientes === 0) {
    return <div className="card p-6 text-center text-gray-500">
      Nenhum cliente foi bloqueado pelo sistema neste dia.
    </div>;
  }
  return (
    <div className="card overflow-auto">
      <table className="w-full text-sm">
        <thead className="bg-ink-900 text-gray-300">
          <tr>
            <th className="w-8"></th>
            <th className="text-left px-3 py-2">Cliente</th>
            <th className="text-center px-3 py-2">Bloqueios</th>
            <th className="text-left px-3 py-2">Origem</th>
            <th className="text-left px-3 py-2">Motivo</th>
            <th className="text-center px-3 py-2">1ª hora</th>
          </tr>
        </thead>
        <tbody>
          {bloq.clientes.map(c => {
            const aberto = abertos.has(c.agn_id);
            return (
              <React.Fragment key={c.agn_id}>
                <tr className="border-t border-ink-700 hover:bg-ink-800/50 cursor-pointer"
                    onClick={() => toggle(c.agn_id)}>
                  <td className="text-center text-gray-500">
                    <ChevronRight size={15} className={`inline transition ${aberto ? 'rotate-90' : ''}`} />
                  </td>
                  <td className="px-3 py-2">
                    <div className="text-gray-200">{c.cliente}</div>
                    <div className="text-[11px] text-gray-500">cód {c.agn_id}</div>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span className="text-[11px] bg-red-900/50 text-red-200 rounded px-1.5 py-0.5">{c.total}</span>
                  </td>
                  <td className="px-3 py-2 text-gray-300">{c.origens.map(rotuloOrigem).join(', ')}</td>
                  <td className="px-3 py-2 text-gray-300">{c.motivos.map(rotuloMotivo).join(', ')}</td>
                  <td className="px-3 py-2 text-center text-gray-400">{c.primeira_hora}</td>
                </tr>
                {aberto && (
                  <tr className="bg-ink-950/60">
                    <td></td>
                    <td colSpan={5} className="px-3 pb-3 pt-1">
                      <table className="w-full text-[12px]">
                        <thead className="text-gray-500">
                          <tr>
                            <th className="text-left py-1 w-20">Hora</th>
                            <th className="text-left py-1 w-24">Origem</th>
                            <th className="text-left py-1 w-28">Motivo</th>
                            <th className="text-left py-1 w-32">Referência</th>
                            <th className="text-left py-1">Títulos em atraso</th>
                          </tr>
                        </thead>
                        <tbody>
                          {c.ocorrencias.map((o, i) => (
                            <tr key={i} className="border-t border-ink-800">
                              <td className="py-1 text-gray-400">{o.hora}</td>
                              <td className="py-1 text-gray-300">{rotuloOrigem(o.origem)}</td>
                              <td className="py-1 text-gray-300">{rotuloMotivo(o.motivo)}</td>
                              <td className="py-1 text-gray-400">{o.referencia || '—'}</td>
                              <td className="py-1 text-gray-500">{o.titulos || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Desbloqueados: 1 linha por aprovacao manual (data/hora/cliente/quem).
function TabelaDesbloqueados({ desb }) {
  if (!desb || desb.total === 0) {
    return <div className="card p-6 text-center text-gray-500">
      Nenhum desbloqueio (aprovação manual) registrado neste dia.
    </div>;
  }
  return (
    <div className="card overflow-auto">
      <table className="w-full text-sm">
        <thead className="bg-ink-900 text-gray-300">
          <tr>
            <th className="text-center px-3 py-2 w-24">Hora</th>
            <th className="text-left px-3 py-2">Cliente</th>
            <th className="text-left px-3 py-2">Desbloqueado por</th>
          </tr>
        </thead>
        <tbody>
          {desb.itens.map((it, i) => (
            <tr key={i} className="border-t border-ink-700">
              <td className="px-3 py-2 text-center text-gray-400">{it.hora}</td>
              <td className="px-3 py-2">
                <div className="text-gray-200">{it.cliente}</div>
                <div className="text-[11px] text-gray-500">cód {it.agn_id}</div>
              </td>
              <td className="px-3 py-2">
                <span className="text-emerald-300">{it.usuario}</span>
                <span className="text-[11px] text-gray-500"> · usuário Mega {it.usu_id}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const rotuloOrigem = o => o === 'NF' ? 'Faturamento (NF)' : o === 'RESERVA' ? 'Reserva (romaneio)' : o;
const rotuloMotivo = m => m === 'FINANCEIRO' ? 'Título em atraso'
                       : m === 'SUFRAMA'    ? 'SUFRAMA bloqueado' : m;
