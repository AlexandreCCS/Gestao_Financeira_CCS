// [25/10/2026 - CRIADO POR ALEXANDRE CARVALHO] Frete › Motoristas.
// Cadastro de todos os motoristas do Mega (VEN_CONDUTOR + campos específicos) com a marcação
// MEI sim/não por motorista (tabela própria do Gestor, com log de quem mudou) e o botão
// Parâmetros, onde fica o limite mensal de faturamento do MEI (R$ 20.966,00 na origem).
// Regra vinda da reunião de frete/numerário da Quality: quando o transportador é MEI, há um
// limite mensal de faturamento — o sistema precisa saber quem é MEI para controlar isso.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Truck, Users, BadgeCheck, CalendarDays, Search, Settings2, History, X, CheckCircle2,
  AlertTriangle, ChevronLeft, ChevronRight, Download, Wallet
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { api } from '../../api/client';

const fmt     = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtN    = v => Number(v || 0).toLocaleString('pt-BR');
const fmtBr   = s => (s ? s.slice(0, 10).split('-').reverse().join('/') : '—');
const fmtBrHr = s => (s ? `${s.slice(0, 10).split('-').reverse().join('/')} ${s.slice(11, 16)}` : '—');
// CPF no Mega vem sem máscara e às vezes sem os zeros à esquerda (8 a 11 dígitos)
const fmtCpf  = c => {
  const d = String(c || '').replace(/\D/g, '');
  if (!d) return '—';
  const p = d.padStart(11, '0');
  return `${p.slice(0, 3)}.${p.slice(3, 6)}.${p.slice(6, 9)}-${p.slice(9)}`;
};
const POR_PAG = 50;

export default function Motoristas() {
  const [lista, setLista]       = useState(null);   // null = carregando
  const [param, setParam]       = useState(null);   // { limite_mei_mes, ... }
  const [busca, setBusca]       = useState('');
  const [fMei, setFMei]         = useState('');     // '' | S | N
  const [fUso, setFUso]         = useState('12m');  // '' | 12m | nunca
  const [fTipo, setFTipo]       = useState('');     // '' | INTERNO | EXTERNO
  const [fSit, setFSit]         = useState('');     // '' | ativo | inativo | bloqueado
  const [pag, setPag]           = useState(1);
  const [modalParam, setModalParam] = useState(false);
  const [histDe, setHistDe]     = useState(null);   // motorista com modal de histórico aberto
  const [gravando, setGravando] = useState(null);   // cdt em gravação
  const [erro, setErro]         = useState('');

  const carrega = () =>
    api.motoristas().then(r => setLista(r.motoristas)).catch(() => { setLista([]); setErro('Falha ao carregar os motoristas.'); });
  const carregaParam = () => api.motoristasParametros().then(setParam).catch(() => setParam(null));

  useEffect(() => { carrega(); carregaParam(); }, []);
  useEffect(() => { setPag(1); }, [busca, fMei, fUso, fTipo, fSit]);

  const filtrados = useMemo(() => {
    if (!lista) return [];
    const q = busca.trim().toUpperCase();
    const qDig = q.replace(/\D/g, '');
    return lista.filter(m => {
      if (fMei && (m.mei ? 'S' : 'N') !== fMei) return false;
      if (fUso === '12m' && m.rom_12m === 0) return false;
      if (fUso === 'nunca' && m.rom_total > 0) return false;
      if (fTipo && m.tipo !== fTipo) return false;
      if (fSit === 'ativo'     && !(m.ativo && !m.bloqueado)) return false;
      if (fSit === 'inativo'   && (m.ativo || m.sem_cadastro_esp)) return false;
      if (fSit === 'bloqueado' && !m.bloqueado) return false;
      if (q) {
        const porNome = m.nome.toUpperCase().includes(q);
        const porCod  = String(m.cdt) === q;
        const porCpf  = qDig.length >= 3 && m.cpf.padStart(11, '0').includes(qDig);
        if (!porNome && !porCod && !porCpf) return false;
      }
      return true;
    });
  }, [lista, busca, fMei, fUso, fTipo, fSit]);

  const totalPag = Math.max(1, Math.ceil(filtrados.length / POR_PAG));
  const pagAtual = Math.min(pag, totalPag);
  const visiveis = filtrados.slice((pagAtual - 1) * POR_PAG, pagAtual * POR_PAG);

  const kpiMei   = lista ? lista.filter(m => m.mei).length : null;
  const kpi12m   = lista ? lista.filter(m => m.rom_12m > 0).length : null;

  // Troca a flag MEI do motorista: grava no servidor e reflete na lista sem recarregar tudo
  const mudaMei = (m, novo) => {
    if (m.mei === novo || gravando) return;
    setGravando(m.cdt); setErro('');
    api.motoristasMei(m.cdt, { mei: novo })
      .then(r => {
        const agora = new Date();
        const em = `${agora.toISOString().slice(0, 10)} ${agora.toTimeString().slice(0, 5)}`;
        setLista(l => l.map(x => x.cdt === m.cdt ? { ...x, mei: r.mei, mei_em: em, mei_por: 'você' } : x));
      })
      .catch(e => setErro(e?.message || 'Falha ao gravar.'))
      .finally(() => setGravando(null));
  };

  const exportar = () => {
    const linhas = filtrados.map(m => ({
      'Código': m.cdt, 'Nome': m.nome, 'CPF': fmtCpf(m.cpf), 'Tipo': m.tipo || '',
      'Situação': situacao(m).rotulo, 'Telefone': m.fone,
      'Romaneios 12 meses': m.rom_12m, 'Romaneios (total)': m.rom_total, 'Último romaneio': fmtBr(m.ult_rom),
      'MEI': m.mei ? 'Sim' : 'Não', 'MEI alterado em': fmtBrHr(m.mei_em), 'MEI alterado por': m.mei_por
    }));
    const ws = XLSX.utils.json_to_sheet(linhas);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Motoristas');
    XLSX.writeFile(wb, `motoristas_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-100 flex items-center gap-2">
            <Truck size={20} className="text-prim-400" /> Motoristas
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Todos os motoristas cadastrados no Mega. Marque quem é <b>MEI</b> — o limite mensal de faturamento
            do MEI fica em <b>Parâmetros</b>.
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost !py-1.5" onClick={exportar} disabled={!lista || filtrados.length === 0}>
            <Download size={14} /> Excel
          </button>
          <button className="btn-ghost !py-1.5" onClick={() => setModalParam(true)}>
            <Settings2 size={14} /> Parâmetros
          </button>
        </div>
      </div>

      {erro && (
        <div className="flex items-center gap-2 bg-rose-500/10 border border-rose-500/40 text-rose-300 text-sm rounded px-3 py-2">
          <AlertTriangle size={15} /> {erro}
          <button className="ml-auto" onClick={() => setErro('')}><X size={14} /></button>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={<Users size={16} />}        label="Motoristas cadastrados" value={lista ? fmtN(lista.length) : '…'} color="prim" />
        <Kpi icon={<BadgeCheck size={16} />}   label="Marcados como MEI"      value={kpiMei == null ? '…' : fmtN(kpiMei)} color="acc" />
        <Kpi icon={<CalendarDays size={16} />} label="Com romaneio em 12 meses" value={kpi12m == null ? '…' : fmtN(kpi12m)} sub="motoristas em uso" color="prim" />
        <Kpi icon={<Wallet size={16} />}       label="Limite mensal MEI"      value={param ? fmt(param.limite_mei_mes) : '…'} sub="parâmetro" color="acc" />
      </div>

      {/* Filtros + tabela */}
      <div className="card overflow-hidden">
        <div className="bg-ink-900 px-4 py-3 border-b border-ink-700 flex flex-wrap gap-2 items-center">
          <div className="flex items-center gap-2 bg-ink-800 px-2 rounded grow max-w-md">
            <Search size={14} className="text-gray-500" />
            <input className="bg-transparent outline-none py-1.5 text-sm w-full"
                   placeholder="Buscar por nome, CPF ou código…"
                   value={busca} onChange={e => setBusca(e.target.value)} />
          </div>
          <select className="bg-ink-800 text-xs text-gray-300 rounded px-2 py-1.5 outline-none" value={fUso} onChange={e => setFUso(e.target.value)}>
            <option value="12m">Com romaneio nos últimos 12 meses</option>
            <option value="">Todos os motoristas</option>
            <option value="nunca">Nunca usados em romaneio</option>
          </select>
          <select className="bg-ink-800 text-xs text-gray-300 rounded px-2 py-1.5 outline-none" value={fMei} onChange={e => setFMei(e.target.value)}>
            <option value="">MEI: todos</option>
            <option value="S">MEI: sim</option>
            <option value="N">MEI: não</option>
          </select>
          <select className="bg-ink-800 text-xs text-gray-300 rounded px-2 py-1.5 outline-none" value={fTipo} onChange={e => setFTipo(e.target.value)}>
            <option value="">Tipo: todos</option>
            <option value="INTERNO">Interno</option>
            <option value="EXTERNO">Externo</option>
          </select>
          <select className="bg-ink-800 text-xs text-gray-300 rounded px-2 py-1.5 outline-none" value={fSit} onChange={e => setFSit(e.target.value)}>
            <option value="">Situação: todas</option>
            <option value="ativo">Ativos</option>
            <option value="inativo">Inativos</option>
            <option value="bloqueado">Bloqueados</option>
          </select>
          <span className="text-xs text-gray-500 ml-auto">{lista ? `${fmtN(filtrados.length)} de ${fmtN(lista.length)}` : ''}</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-ink-900/70 text-gray-400 uppercase text-xs">
              <tr>
                <th className="p-2 text-left">Código</th>
                <th className="p-2 text-left">Motorista</th>
                <th className="p-2 text-left">CPF</th>
                <th className="p-2 text-left">Tipo</th>
                <th className="p-2 text-center">Situação</th>
                <th className="p-2 text-left">Telefone</th>
                <th className="p-2 text-right" title="Romaneios de expedição nos últimos 12 meses">Rom. 12 m</th>
                <th className="p-2 text-left">Último romaneio</th>
                <th className="p-2 text-center">MEI</th>
                <th className="p-2 text-center"></th>
              </tr>
            </thead>
            <tbody>
              {!lista && <tr><td colSpan={10} className="p-4 text-center text-gray-500">Carregando motoristas…</td></tr>}
              {lista && visiveis.length === 0 && (
                <tr><td colSpan={10} className="p-4 text-center text-gray-500">Nenhum motorista com esses filtros.</td></tr>
              )}
              {visiveis.map(m => {
                const sit = situacao(m);
                return (
                  <tr key={m.cdt} className="border-t border-ink-800 hover:bg-ink-800/40">
                    <td className="p-2 font-mono text-gray-400">{m.cdt}</td>
                    <td className="p-2">{m.nome}</td>
                    <td className="p-2 font-mono text-gray-300">{fmtCpf(m.cpf)}</td>
                    <td className="p-2 text-gray-300">{m.tipo ? m.tipo.charAt(0) + m.tipo.slice(1).toLowerCase() : '—'}</td>
                    <td className="p-2 text-center">
                      <span className={`text-[11px] px-1.5 py-0.5 rounded font-semibold ${sit.classe}`} title={m.motivo_bloq || ''}>{sit.rotulo}</span>
                    </td>
                    <td className="p-2 text-gray-300">{m.fone || '—'}</td>
                    <td className={`p-2 text-right ${m.rom_12m > 0 ? 'text-gray-200' : 'text-gray-500'}`}>{fmtN(m.rom_12m)}</td>
                    <td className="p-2 text-gray-300">{fmtBr(m.ult_rom)}</td>
                    <td className="p-2 text-center">
                      <SimNao valor={m.mei} ocupado={gravando === m.cdt} onChange={v => mudaMei(m, v)} />
                      {m.mei_em && (
                        <div className="text-[10px] text-gray-500 mt-0.5" title={`alterado por ${m.mei_por} em ${fmtBrHr(m.mei_em)}`}>
                          {fmtBr(m.mei_em)} · {m.mei_por}
                        </div>
                      )}
                    </td>
                    <td className="p-2 text-center">
                      <button className="text-gray-500 hover:text-prim-400" title="Histórico de alterações" onClick={() => setHistDe(m)}>
                        <History size={15} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {totalPag > 1 && (
          <div className="flex items-center justify-end gap-2 px-4 py-2 border-t border-ink-700 text-xs text-gray-400">
            <button className="p-1 rounded hover:bg-ink-800 disabled:opacity-30" disabled={pagAtual <= 1} onClick={() => setPag(pagAtual - 1)}>
              <ChevronLeft size={14} />
            </button>
            página {pagAtual} de {totalPag}
            <button className="p-1 rounded hover:bg-ink-800 disabled:opacity-30" disabled={pagAtual >= totalPag} onClick={() => setPag(pagAtual + 1)}>
              <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>

      {modalParam && <ModalParametros onClose={(mudou) => { setModalParam(false); if (mudou) carregaParam(); }} />}
      {histDe && <ModalHistorico motorista={histDe} onClose={() => setHistDe(null)} />}
    </div>
  );
}

// Situação do motorista pelos campos específicos do Mega (VEN_CONDUTORCMPESP)
function situacao(m) {
  if (m.bloqueado)        return { rotulo: 'Bloqueado', classe: 'bg-rose-500/20 text-rose-400' };
  if (m.sem_cadastro_esp) return { rotulo: 'Sem cadastro esp.', classe: 'bg-ink-700 text-gray-400' };
  if (m.ativo)            return { rotulo: 'Ativo', classe: 'bg-prim-600/20 text-prim-400' };
  return { rotulo: 'Inativo', classe: 'bg-ink-700 text-gray-400' };
}

// Botão duplo Sim | Não
function SimNao({ valor, ocupado, onChange }) {
  const base = 'px-2.5 py-0.5 text-xs font-semibold transition';
  return (
    <div className={`inline-flex rounded overflow-hidden border border-ink-700 ${ocupado ? 'opacity-50' : ''}`}>
      <button className={`${base} ${valor ? 'bg-acc-500 text-ink-900' : 'bg-ink-800 text-gray-400 hover:bg-ink-700'}`}
              disabled={ocupado} onClick={() => onChange(true)}>Sim</button>
      <button className={`${base} ${!valor ? 'bg-ink-600 text-gray-100' : 'bg-ink-800 text-gray-400 hover:bg-ink-700'}`}
              disabled={ocupado} onClick={() => onChange(false)}>Não</button>
    </div>
  );
}

// Histórico de alterações de um motorista (log do Gestor)
function ModalHistorico({ motorista, onClose }) {
  const [hist, setHist] = useState(null);
  useEffect(() => {
    api.motoristasHistorico(motorista.cdt).then(r => setHist(r.historico)).catch(() => setHist([]));
  }, [motorista.cdt]);
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="card w-full max-w-lg shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-ink-700 flex items-center justify-between bg-ink-900 rounded-t-lg">
          <h2 className="font-semibold text-prim-400 flex items-center gap-2">
            <History size={16} /> {motorista.nome}
          </h2>
          <button className="text-gray-500 hover:text-gray-200" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="p-5 space-y-1.5">
          <p className="text-xs text-gray-500 mb-2">Código {motorista.cdt} · CPF {fmtCpf(motorista.cpf)}</p>
          {!hist && <div className="text-xs text-gray-500">carregando…</div>}
          {hist && hist.length === 0 && <div className="text-xs text-gray-500">Nenhuma alteração registrada.</div>}
          {hist && hist.map(h => (
            <div key={h.id} className="bg-ink-900/60 rounded-lg px-3 py-2 text-xs flex items-center gap-3">
              <span className="text-[10px] uppercase tracking-wider text-gray-500">{h.campo}</span>
              <span className="font-mono text-gray-200 whitespace-nowrap">
                {h.de} <span className="text-gray-500">→</span> <span className="text-prim-400 font-semibold">{h.para}</span>
              </span>
              <span className="text-gray-500 truncate flex-1" title={h.motivo}>por {h.usuario}{h.motivo ? ` · ${h.motivo}` : ''}</span>
              <span className="text-gray-500 whitespace-nowrap">{fmtBrHr(h.quando)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Parâmetros do módulo (CCS_TB_GFIN_PARAM). Hoje: limite mensal de faturamento do MEI.
// Salvar é restrito a administradores (o servidor devolve 403 para os demais).
function ModalParametros({ onClose }) {
  const [valor, setValor] = useState('');
  const [info,  setInfo]  = useState(null);
  const [hist,  setHist]  = useState(null);
  const [pagHist, setPagHist] = useState(1);
  const [busy,  setBusy]  = useState(false);
  const [erro,  setErro]  = useState('');
  const [okMsg, setOkMsg] = useState('');
  const mudou = useRef(false);
  const HIST_POR_PAG = 8;

  async function carregaHist() {
    try { const r = await api.motoristasParametrosHistorico(); setHist(r.historico); setPagHist(1); }
    catch { setHist([]); }
  }
  useEffect(() => {
    (async () => {
      try {
        const r = await api.motoristasParametros();
        setValor(Number(r.limite_mei_mes).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
        setInfo(r);
      } catch { setErro('Não foi possível carregar os parâmetros.'); }
    })();
    carregaHist();
  }, []);

  // aceita "20.966,00", "20966,00" e "20966"
  const parse = s => {
    const t = String(s).trim().replace(/\./g, '').replace(',', '.');
    const n = Number(t);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
  };

  async function salvar() {
    setErro(''); setOkMsg('');
    const n = parse(valor);
    if (!Number.isFinite(n) || n < 0) { setErro('Informe um valor em reais (ex.: 20.966,00).'); return; }
    setBusy(true);
    try {
      await api.motoristasSalvarParametros({ limite_mei_mes: n });
      mudou.current = true;
      setValor(n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
      setOkMsg('Parâmetros salvos.');
      carregaHist();
    } catch (e) {
      setErro(e.message === 'admin_only' ? 'Somente administradores podem alterar os parâmetros.' : (e.message || 'Erro ao salvar'));
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => onClose(mudou.current)}>
      <div className="card w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-ink-700 flex items-center justify-between bg-ink-900 rounded-t-lg">
          <h2 className="font-semibold text-prim-400 flex items-center gap-2"><Settings2 size={16} /> Parâmetros</h2>
          <button className="text-gray-500 hover:text-gray-200" onClick={() => onClose(mudou.current)}><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-wider text-gray-400">Limite mensal de faturamento do MEI (R$)</label>
            <div className="flex items-center bg-ink-900 border border-ink-700 rounded-lg px-3 focus-within:border-prim-500">
              <span className="text-sm text-gray-500 mr-2">R$</span>
              <input value={valor} onChange={e => setValor(e.target.value)} inputMode="decimal"
                     className="w-full bg-transparent py-2 text-sm outline-none font-mono text-right" />
            </div>
            <p className="text-xs text-gray-500">
              Valor máximo que um motorista MEI pode faturar no mês. Usado no controle do frete pago a motoristas marcados como MEI.
            </p>
            {info?.alterado_em && (
              <p className="text-[11px] text-gray-500">
                Última alteração: {fmtBrHr(info.alterado_em)}{info.alterado_por ? ` por ${info.alterado_por}` : ''}
              </p>
            )}
            {erro  && <div className="text-rose-300 text-xs bg-rose-900/30 rounded p-2">{erro}</div>}
            {okMsg && <div className="text-prim-300 text-xs bg-prim-600/15 rounded p-2 flex items-center gap-1.5"><CheckCircle2 size={14} /> {okMsg}</div>}
            <button className="btn-prim w-full justify-center" disabled={busy || valor === ''} onClick={salvar}>
              {busy ? 'Salvando…' : 'Salvar'}
            </button>
          </div>

          <div>
            <div className="text-xs uppercase tracking-wider text-gray-400 mb-1.5 flex items-center gap-1.5">
              <History size={13} /> Histórico de alterações {hist && hist.length > 0 && `(${hist.length})`}
            </div>
            {!hist && <div className="text-xs text-gray-500">carregando…</div>}
            {hist && hist.length === 0 && <div className="text-xs text-gray-500">Nenhuma alteração registrada — valor inicial em vigor.</div>}
            {hist && hist.length > 0 && (() => {
              const totalPag = Math.max(1, Math.ceil(hist.length / HIST_POR_PAG));
              const p = Math.min(pagHist, totalPag);
              const visiveis = hist.slice((p - 1) * HIST_POR_PAG, p * HIST_POR_PAG);
              return (
                <>
                  <div className="space-y-1.5">
                    {visiveis.map((h, i) => (
                      <div key={i} className="bg-ink-900/60 rounded-lg px-3 py-2 text-xs flex items-center gap-3">
                        <span className="font-mono text-gray-200 whitespace-nowrap">
                          {h.de == null ? '—' : fmt(h.de)} <span className="text-gray-500">→</span>{' '}
                          <span className="text-prim-400 font-semibold">{fmt(h.para)}</span>
                        </span>
                        <span className="text-gray-500 truncate flex-1">por {h.usuario}</span>
                        <span className="text-gray-500 whitespace-nowrap">{fmtBrHr(h.quando)}</span>
                      </div>
                    ))}
                  </div>
                  {totalPag > 1 && (
                    <div className="flex items-center justify-end gap-2 mt-2 text-xs text-gray-400">
                      <button className="p-1 rounded hover:bg-ink-800 disabled:opacity-30" disabled={p <= 1} onClick={() => setPagHist(p - 1)}><ChevronLeft size={14} /></button>
                      página {p} de {totalPag}
                      <button className="p-1 rounded hover:bg-ink-800 disabled:opacity-30" disabled={p >= totalPag} onClick={() => setPagHist(p + 1)}><ChevronRight size={14} /></button>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
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
