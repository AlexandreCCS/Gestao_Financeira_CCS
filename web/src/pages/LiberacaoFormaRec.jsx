// [09/10/2026 - CRIADO POR ALEXANDRE CARVALHO] Liberação de Forma de Recebimento.
// Trocar a forma de recebimento (HCOB) de um título é travado no ERP (trigger CCS_T_LIBERA_FORMA_REC, todas as filiais).
// Aba "Títulos em aberto": botão direito num título -> liberar a troca para UMA forma nova (uso único, motivo obrigatório).
// Aba "Histórico de liberações": liberado / executado / cancelado, com quem e quando.
// Aba "Trocas registradas": tudo que a trigger registrou (livres, liberadas e BLOQUEADAS) - base de monitoramento do BI.
// Livres sem liberação (só registram): título sem forma, destino = boleto do banco do dia, rotina automática.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  FileSpreadsheet, Search, Wallet, CheckCircle2, ChevronUp, ChevronDown, ChevronLeft, ChevronRight,
  Unlock, X, History, ListChecks, Ban, Clock3, Repeat, ShieldAlert, Landmark, CircleSlash
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { api } from '../api/client';

const fmt   = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtN  = v => Number(v || 0).toLocaleString('pt-BR');
const fmtBr = iso => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');
const fmtBrHr = s => (s ? `${fmtBr(s)} ${s.slice(11, 16)}` : '');
const iso = d => d.toISOString().slice(0, 10);
const POR_PAGINA = 100;
const SORTS = {
  cliente: t => (t.cliente || '').toLowerCase(), fil_id: t => t.fil_id, documento: t => t.documento,
  tipo: t => t.tipo, forma: t => t.forma_receb, vencto: t => t.vencto || '', saldo: t => t.saldo
};

export default function LiberacaoFormaRec() {
  const [aba, setAba] = useState('titulos');
  const [ctx, setCtx] = useState(null);
  const [modal, setModal] = useState(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!ctx) return;
    const fecha = () => setCtx(null);
    const esc = e => { if (e.key === 'Escape') setCtx(null); };
    window.addEventListener('click', fecha);
    window.addEventListener('scroll', fecha, true);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('click', fecha);
      window.removeEventListener('scroll', fecha, true);
      window.removeEventListener('keydown', esc);
    };
  }, [ctx]);

  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-prim-400 flex items-center gap-2">
          <Repeat size={20} /> Liberação de Forma de Recebimento
        </h1>
        <p className="text-sm text-gray-400 mt-1 max-w-3xl">
          Trocar a <b>forma de recebimento</b> de um título é travado no ERP. Clique com o <b>botão direito</b> num
          título para liberar a troca para uma forma específica. A liberação é de <b>uso único</b>.
          <b>Boleto não entra nesta trava</b> (segue só a regra do banco do dia) e não aparece aqui. Também não precisam de
          liberação (ficam só registradas): título <b>sem forma</b> que recebe uma e rotinas automáticas.
        </p>
      </div>

      <div className="flex gap-1 border-b border-ink-700">
        <Aba ativo={aba === 'titulos'} onClick={() => setAba('titulos')} icon={<ListChecks size={15} />} label="Títulos em aberto" />
        <Aba ativo={aba === 'historico'} onClick={() => setAba('historico')} icon={<History size={15} />} label="Histórico de liberações" />
        <Aba ativo={aba === 'trocas'} onClick={() => setAba('trocas')} icon={<ShieldAlert size={15} />} label="Trocas registradas" />
      </div>

      {aba === 'titulos' && <AbaTitulos refresh={refresh}
        onContexto={(e, t) => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, titulo: t }); }} />}
      {aba === 'historico' && <AbaHistorico refresh={refresh} />}
      {aba === 'trocas' && <AbaTrocas />}

      {ctx && (
        <div className="fixed z-40 bg-ink-900 border border-ink-700 rounded-lg shadow-xl py-1 min-w-[250px]"
             style={{ left: Math.min(ctx.x, window.innerWidth - 270), top: Math.min(ctx.y, window.innerHeight - 60) }}>
          <button className="w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-ink-800 flex items-center gap-2"
                  onClick={() => { setModal(ctx.titulo); setCtx(null); }}>
            <Unlock size={15} className="text-prim-400" /> Liberar troca de forma…
          </button>
        </div>
      )}

      {modal && <ModalLiberacao titulo={modal} onClose={mudou => { setModal(null); if (mudou) setRefresh(x => x + 1); }} />}
    </div>
  );
}

function Aba({ ativo, onClick, icon, label }) {
  return (
    <button onClick={onClick}
      className={`px-4 py-2 text-sm rounded-t-lg flex items-center gap-1.5 transition border-b-2 -mb-px
        ${ativo ? 'border-prim-500 text-prim-400 bg-ink-800/60' : 'border-transparent text-gray-400 hover:text-gray-200'}`}>
      {icon}{label}
    </button>
  );
}

/* ------------------------------------------------------------ títulos em aberto */
function AbaTitulos({ onContexto, refresh }) {
  const [resp, setResp] = useState(null);
  const [busy, setBusy] = useState(true);
  const [erro, setErro] = useState('');
  const [fil, setFil] = useState('todas');
  const [forma, setForma] = useState('todas');
  const [busca, setBusca] = useState('');
  const [sort, setSort] = useState({ k: 'vencto', asc: true });
  const [pagina, setPagina] = useState(1);

  async function carregar() {
    setBusy(true); setErro('');
    try { setResp(await api.liberacaoFormaTitulos()); }
    catch (e) { setErro(e.message || 'Erro ao carregar títulos'); setResp(null); }
    finally { setBusy(false); }
  }
  useEffect(() => { carregar(); }, [refresh]);

  const filiais = useMemo(() => resp ? [...new Set(resp.titulos.map(t => t.fil_id))].sort((a, b) => a - b) : [], [resp]);
  const formas = useMemo(() => resp ? [...new Set(resp.titulos.map(t => t.forma_receb || '(sem forma)'))].sort() : [], [resp]);

  const linhas = useMemo(() => {
    if (!resp) return [];
    let arr = resp.titulos;
    if (fil !== 'todas') arr = arr.filter(t => String(t.fil_id) === fil);
    if (forma !== 'todas') arr = arr.filter(t => (t.forma_receb || '(sem forma)') === forma);
    if (busca.trim()) {
      const q = busca.toLowerCase();
      arr = arr.filter(t => String(t.agn_id).includes(q) || (t.cliente || '').toLowerCase().includes(q) ||
        (t.documento || '').toLowerCase().includes(q));
    }
    const ex = SORTS[sort.k] || SORTS.vencto;
    return [...arr].sort((a, b) => { const va = ex(a), vb = ex(b); const c = va < vb ? -1 : va > vb ? 1 : 0; return sort.asc ? c : -c; });
  }, [resp, fil, forma, busca, sort]);
  useEffect(() => { setPagina(1); }, [fil, forma, busca, sort]);

  const totPaginas = Math.max(1, Math.ceil(linhas.length / POR_PAGINA));
  const visiveis = linhas.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);
  const alternaSort = k => setSort(s => s.k === k ? { k, asc: !s.asc } : { k, asc: true });

  function exportXlsx() {
    const ws = XLSX.utils.json_to_sheet(linhas.map(t => ({
      'Cód. Cliente': t.agn_id, Cliente: t.cliente, Filial: t.fil_id, Documento: t.documento, Parcela: t.parcela,
      Tipo: t.tipo, 'Forma de recebimento': t.forma_receb || '(sem forma)', Boleto: t.boleto ? 'Sim' : 'Não',
      Vencimento: fmtBr(t.vencto), 'Saldo em aberto': t.saldo, 'Liberação ativa': t.lib_ativa ? 'Sim' : 'Não'
    })));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Títulos em aberto');
    XLSX.writeFile(wb, `liberacao-forma-titulos-${iso(new Date())}.xlsx`);
  }

  const kpi = resp?.kpi;
  return (
    <div className="space-y-5">
      {erro && <div className="bg-red-900/40 text-red-200 text-sm rounded p-3">{erro}</div>}
      {kpi && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Kpi icon={<Wallet size={16} />} label="Títulos em aberto (sem boleto)" value={fmtN(kpi.qt_titulos)} sub={`saldo ${fmt(kpi.saldo_total)}`} />
          <Kpi icon={<CircleSlash size={16} />} label="Sem forma de recebimento" value={fmtN(kpi.qt_sem_forma)} color="rose" />
          <Kpi icon={<Clock3 size={16} />} label="Liberações ativas" value={fmtN(kpi.qt_lib_ativa)} color="acc" sub="aguardando a troca" />
        </div>
      )}
      {resp && (
        <div className="card overflow-hidden">
          <div className="bg-ink-900 px-4 py-3 border-b border-ink-700 flex flex-wrap gap-2 items-center">
            <select className="bg-ink-800 text-xs text-gray-300 rounded px-2 py-1.5 outline-none" value={fil} onChange={e => setFil(e.target.value)}>
              <option value="todas">Todas as filiais</option>
              {filiais.map(f => <option key={f} value={String(f)}>Filial {f}</option>)}
            </select>
            <select className="bg-ink-800 text-xs text-gray-300 rounded px-2 py-1.5 outline-none max-w-[240px]" value={forma} onChange={e => setForma(e.target.value)}>
              <option value="todas">Todas as formas</option>
              {formas.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
            <div className="ml-auto flex items-center gap-2 bg-ink-800 px-2 rounded">
              <Search size={14} className="text-gray-500" />
              <input className="bg-transparent outline-none py-1 text-sm w-56" placeholder="Buscar cliente, código ou documento..."
                     value={busca} onChange={e => setBusca(e.target.value)} />
            </div>
            <button className="btn-ghost" onClick={exportXlsx} disabled={linhas.length === 0}><FileSpreadsheet size={16} /> Excel</button>
          </div>
          <div className="px-4 py-2 bg-ink-900/50 border-b border-ink-700 text-xs text-gray-400 flex flex-wrap gap-4 items-center">
            <span>{fmtN(linhas.length)} título(s) no filtro</span>
            <span className="text-gray-500 hidden md:inline">botão direito num título → liberar troca de forma</span>
            {busy && <span className="text-gray-500">atualizando…</span>}
            <Pager pagina={pagina} total={totPaginas} onChange={setPagina} />
          </div>
          <div className="overflow-auto max-h-[52vh]">
            <table className="w-full text-sm">
              <thead className="bg-ink-900/70 text-gray-400 uppercase text-xs sticky top-0 z-10">
                <tr>
                  <Th k="cliente" sort={sort} onSort={alternaSort} className="text-left pl-4">Cliente</Th>
                  <Th k="fil_id" sort={sort} onSort={alternaSort} className="text-center">Filial</Th>
                  <Th k="documento" sort={sort} onSort={alternaSort} className="text-left">Documento</Th>
                  <Th k="tipo" sort={sort} onSort={alternaSort} className="text-left">Tipo</Th>
                  <Th k="forma" sort={sort} onSort={alternaSort} className="text-left">Forma de recebimento</Th>
                  <Th k="vencto" sort={sort} onSort={alternaSort} className="text-center">Vencimento</Th>
                  <Th k="saldo" sort={sort} onSort={alternaSort} className="text-right pr-4">Saldo</Th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map(t => (
                  <tr key={`${t.org}-${t.lanc}`} className="border-t border-ink-700 hover:bg-ink-800/40 cursor-context-menu"
                      onContextMenu={e => onContexto(e, t)}>
                    <td className="p-2 pl-4"><div className="text-gray-200">{t.cliente}</div>
                      <div className="text-xs text-gray-500 font-mono">cód. {t.agn_id}</div></td>
                    <td className="p-2 text-center font-mono text-xs text-gray-400">{t.fil_id}</td>
                    <td className="p-2 font-mono text-xs text-gray-300">{t.documento}{t.parcela ? <span className="text-gray-500">/{t.parcela}</span> : ''}</td>
                    <td className="p-2 text-xs text-gray-400">{t.tipo}</td>
                    <td className="p-2 text-xs max-w-[220px]">
                      <span className={t.forma_receb ? 'text-gray-300' : 'text-rose-300'}>{t.forma_receb || 'sem forma'}</span>
                      {t.lib_ativa && <span className="ml-1.5 text-[10px] px-1 rounded bg-acc-500/20 text-acc-500">liberação ativa</span>}
                    </td>
                    <td className="p-2 text-center text-xs text-gray-300">{fmtBr(t.vencto)}</td>
                    <td className="p-2 pr-4 text-right font-mono text-xs text-gray-200">{fmt(t.saldo)}</td>
                  </tr>
                ))}
                {visiveis.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-gray-500">{busy ? 'Carregando...' : 'Nenhum título no filtro.'}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {busy && !resp && <div className="text-gray-400 text-sm">Carregando títulos em aberto...</div>}
    </div>
  );
}

/* ------------------------------------------------------------ modal */
function ModalLiberacao({ titulo, onClose }) {
  const [formas, setFormas] = useState(null);
  const [bancoDia, setBancoDia] = useState(null);
  const [para, setPara] = useState('');
  const [motivo, setMotivo] = useState('');
  const [libs, setLibs] = useState(null);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const mudou = useRef(false);

  async function carregaLibs() {
    try { setLibs((await api.liberacaoFormaLiberacoes(titulo.org, titulo.lanc)).liberacoes); } catch { setLibs([]); }
  }
  useEffect(() => {
    api.liberacaoFormaFormas(titulo.fil_id).then(r => { setFormas(r.formas); setBancoDia(r.banco_do_dia); }).catch(() => setFormas([]));
    carregaLibs();
  }, []);

  async function liberar() {
    setErro(''); setOkMsg('');
    if (para === '') return setErro('Escolha a forma de recebimento nova.');
    if (!motivo.trim()) return setErro('Informe o motivo da troca.');
    setBusy(true);
    try {
      await api.liberacaoFormaLiberar({ org: titulo.org, lanc: titulo.lanc, para: Number(para), motivo: motivo.trim() });
      mudou.current = true; setOkMsg('Troca liberada. O usuário já pode alterar a forma deste título no ERP.');
      setMotivo(''); setPara(''); carregaLibs();
    } catch (e) {
      setErro(e.message === 'ja_liberado' ? 'Este título já tem uma liberação ativa. Revogue a anterior para liberar outra forma.' : (e.message || 'Erro ao liberar'));
    } finally { setBusy(false); }
  }
  async function revogar(id) {
    setBusy(true); setErro(''); setOkMsg('');
    try { await api.liberacaoFormaRevogar(id); mudou.current = true; carregaLibs(); }
    catch (e) { setErro(e.message || 'Erro ao revogar'); }
    finally { setBusy(false); }
  }
  const opcoes = (formas || []).filter(f => f.hcob !== titulo.hcob);
  const escolhida = opcoes.find(f => String(f.hcob) === String(para));

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => onClose(mudou.current)}>
      <div className="card w-full max-w-lg shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-ink-700 flex items-center justify-between bg-ink-900 rounded-t-lg">
          <h2 className="font-semibold text-prim-400 flex items-center gap-2"><Unlock size={16} /> Liberar troca de forma de recebimento</h2>
          <button className="text-gray-500 hover:text-gray-200" onClick={() => onClose(mudou.current)}><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="bg-ink-900/60 rounded-lg p-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
            <Info rotulo="Cliente" valor={titulo.cliente} span2 />
            <Info rotulo="Filial" valor={titulo.fil_id} mono />
            <Info rotulo="Documento" valor={`${titulo.documento}${titulo.parcela ? '/' + titulo.parcela : ''}`} mono />
            <Info rotulo="Forma atual" valor={titulo.forma_receb || 'sem forma'} span2 />
            <Info rotulo="Vencimento" valor={fmtBr(titulo.vencto)} />
            <Info rotulo="Saldo" valor={fmt(titulo.saldo)} destaque />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] uppercase tracking-wider text-gray-500 block">Nova forma de recebimento</label>
            <select value={para} onChange={e => setPara(e.target.value)}
                    className="w-full bg-ink-900 border border-ink-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-prim-500">
              <option value="">{formas ? 'Escolha…' : 'carregando…'}</option>
              {titulo.hcob && <option value="0">Remover a forma (título fica sem forma)</option>}
              {opcoes.map(f => (
                <option key={f.hcob} value={f.hcob}>
                  {f.hcob} · {f.descricao}
                </option>
              ))}
            </select>
            <textarea rows={2} placeholder="Motivo (obrigatório)" value={motivo} onChange={e => setMotivo(e.target.value)} maxLength={200}
                      className="w-full bg-ink-900 border border-ink-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-prim-500 resize-none" />
            {erro && <div className="text-rose-300 text-xs bg-rose-900/30 rounded p-2">{erro}</div>}
            {okMsg && <div className="text-prim-300 text-xs bg-prim-600/15 rounded p-2 flex items-center gap-1.5"><CheckCircle2 size={14} /> {okMsg}</div>}
            <button className="btn-prim w-full justify-center" disabled={busy} onClick={liberar}>
              <Unlock size={15} /> {busy ? 'Liberando…' : 'Liberar troca'}
            </button>
            <p className="text-[11px] text-gray-500">
              Liberação de <b>uso único</b> e só para a forma escolhida: o ERP aceita <b>uma</b> troca deste título para essa
              forma e a liberação é consumida. Fica registrado quem liberou, quem trocou e quando.
            </p>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-gray-400 mb-1.5">Liberações deste título {libs && libs.length > 0 && `(${libs.length})`}</div>
            {!libs && <div className="text-xs text-gray-500">carregando…</div>}
            {libs && libs.length === 0 && <div className="text-xs text-gray-500">Nenhuma liberação registrada para este título.</div>}
            {libs && libs.length > 0 && (
              <div className="space-y-1.5 max-h-44 overflow-auto pr-1">
                {libs.map(l => (
                  <div key={l.id} className="bg-ink-900/60 rounded-lg px-3 py-2 text-xs flex items-center gap-3">
                    <StatusLib lib={l} />
                    <span className="text-gray-400 truncate flex-1" title={`${l.de_nome} → ${l.para_nome}`}>{l.de_nome} → <b className="text-gray-200">{l.para_nome}</b></span>
                    <span className="text-gray-500">{fmtBrHr(l.liberado_em)}</span>
                    {l.status === 'A' && (
                      <button className="text-rose-400 hover:text-rose-300 flex items-center gap-1" disabled={busy} onClick={() => revogar(l.id)}>
                        <Ban size={13} /> revogar
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ histórico */
const FILTROS_HIST = [{ k: 'todas', l: 'Todas' }, { k: 'A', l: 'Ativas' }, { k: 'E', l: 'Executadas' }, { k: 'C', l: 'Canceladas' }];
function AbaHistorico({ refresh }) {
  const [resp, setResp] = useState(null);
  const [busy, setBusy] = useState(true);
  const [erro, setErro] = useState('');
  const [filtro, setFiltro] = useState('todas');
  const [busca, setBusca] = useState('');
  async function carregar() {
    setBusy(true); setErro('');
    try { setResp(await api.liberacaoFormaLiberacoes()); } catch (e) { setErro(e.message || 'Erro ao carregar histórico'); }
    finally { setBusy(false); }
  }
  useEffect(() => { carregar(); }, [refresh]);
  async function revogar(id) { try { await api.liberacaoFormaRevogar(id); carregar(); } catch (e) { setErro(e.message || 'Erro ao revogar'); } }
  const linhas = useMemo(() => {
    let ls = resp?.liberacoes || [];
    if (filtro !== 'todas') ls = ls.filter(l => l.status === filtro);
    if (busca.trim()) {
      const q = busca.toLowerCase();
      ls = ls.filter(l => (l.cliente || '').toLowerCase().includes(q) || (l.documento || '').toLowerCase().includes(q) ||
        (l.usu_liberou_nome || '').toLowerCase().includes(q) || (l.usu_executou_nome || '').toLowerCase().includes(q));
    }
    return ls;
  }, [resp, filtro, busca]);
  const kpi = useMemo(() => {
    const ls = resp?.liberacoes || [];
    return { total: ls.length, A: ls.filter(l => l.status === 'A').length, E: ls.filter(l => l.status === 'E').length, C: ls.filter(l => l.status === 'C').length };
  }, [resp]);
  function exportXlsx() {
    const ws = XLSX.utils.json_to_sheet(linhas.map(l => ({
      Cliente: l.cliente, 'Cód.': l.agn_id, Filial: l.fil_id, Documento: `${l.documento}${l.parcela ? '/' + l.parcela : ''}`,
      'Forma anterior': l.de_nome, 'Forma liberada': l.para_nome, Motivo: l.motivo, Status: { A: 'Ativa', E: 'Executada', C: 'Cancelada' }[l.status],
      'Liberado em': fmtBrHr(l.liberado_em), 'Quem liberou': l.usu_liberou_nome,
      'Trocado em': fmtBrHr(l.executado_em), 'Quem trocou': l.usu_executou_nome || '', 'Cancelado em': fmtBrHr(l.cancelado_em)
    })));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Liberações');
    XLSX.writeFile(wb, `liberacao-forma-historico-${iso(new Date())}.xlsx`);
  }
  return (
    <div className="space-y-5">
      {erro && <div className="bg-red-900/40 text-red-200 text-sm rounded p-3">{erro}</div>}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Kpi icon={<History size={16} />} label="Liberações" value={fmtN(kpi.total)} />
        <Kpi icon={<Clock3 size={16} />} label="Ativas (aguardando a troca)" value={fmtN(kpi.A)} color="acc" />
        <Kpi icon={<CheckCircle2 size={16} />} label="Executadas" value={fmtN(kpi.E)} />
        <Kpi icon={<Ban size={16} />} label="Canceladas" value={fmtN(kpi.C)} color="rose" />
      </div>
      <div className="card overflow-hidden">
        <div className="bg-ink-900 px-4 py-3 border-b border-ink-700 flex flex-wrap gap-2 items-center">
          <div className="flex gap-1">
            {FILTROS_HIST.map(f => (
              <button key={f.k} onClick={() => setFiltro(f.k)}
                className={`px-3 py-1 rounded text-xs transition ${filtro === f.k ? 'bg-prim-600 text-white' : 'bg-ink-800 hover:bg-ink-700 text-gray-300'}`}>{f.l}</button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2 bg-ink-800 px-2 rounded">
            <Search size={14} className="text-gray-500" />
            <input className="bg-transparent outline-none py-1 text-sm w-56" placeholder="Buscar cliente, documento ou usuário..." value={busca} onChange={e => setBusca(e.target.value)} />
          </div>
          <button className="btn-ghost" onClick={exportXlsx} disabled={linhas.length === 0}><FileSpreadsheet size={16} /> Excel</button>
        </div>
        <div className="overflow-auto max-h-[56vh]">
          <table className="w-full text-sm">
            <thead className="bg-ink-900/70 text-gray-400 uppercase text-xs sticky top-0 z-10">
              <tr>
                <th className="text-left p-2 pl-4">Liberado em / por</th><th className="text-left p-2">Título</th>
                <th className="text-left p-2">Troca liberada</th><th className="text-left p-2">Motivo</th>
                <th className="text-center p-2">Status</th><th className="text-left p-2">Uso</th><th className="p-2 pr-4"></th>
              </tr>
            </thead>
            <tbody>
              {linhas.map(l => (
                <tr key={l.id} className="border-t border-ink-700 hover:bg-ink-800/40 align-top">
                  <td className="p-2 pl-4"><div className="text-gray-200 text-xs">{fmtBrHr(l.liberado_em)}</div><div className="text-xs text-gray-500">{l.usu_liberou_nome}</div></td>
                  <td className="p-2"><div className="text-gray-200 text-xs">{l.cliente}</div>
                    <div className="text-xs text-gray-500 font-mono">fil {l.fil_id} · {l.documento}{l.parcela ? `/${l.parcela}` : ''} · cód. {l.agn_id}</div></td>
                  <td className="p-2 text-xs text-gray-400">{l.de_nome} → <span className="text-gray-200">{l.para_nome}</span></td>
                  <td className="p-2 text-xs text-gray-400 max-w-[180px]"><span className="line-clamp-2" title={l.motivo}>{l.motivo || '—'}</span></td>
                  <td className="p-2 text-center"><StatusLib lib={l} /></td>
                  <td className="p-2 text-xs text-gray-300">
                    {l.status === 'E' ? <>{fmtBrHr(l.executado_em)} · {l.usu_executou_nome}</> : l.status === 'C'
                      ? <span className="text-gray-500">cancelada {fmtBrHr(l.cancelado_em)}{l.usu_cancelou_nome ? ` por ${l.usu_cancelou_nome}` : ''}</span>
                      : <span className="text-gray-500">— ainda não usada</span>}
                  </td>
                  <td className="p-2 pr-4 text-right">
                    {l.status === 'A' && <button className="text-rose-400 hover:text-rose-300 text-xs flex items-center gap-1 ml-auto" onClick={() => revogar(l.id)}><Ban size={13} /> revogar</button>}
                  </td>
                </tr>
              ))}
              {linhas.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-gray-500">{busy ? 'Carregando...' : 'Nenhuma liberação no filtro.'}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ trocas registradas (monitoramento / BI) */
const COR_TIPO = { X: 'bg-rose-500/20 text-rose-300', L: 'bg-prim-600/20 text-prim-400', S: 'bg-ink-700 text-gray-300', D: 'bg-ink-700 text-gray-300', A: 'bg-ink-700 text-gray-400' };
function AbaTrocas() {
  const hoje = new Date();
  const [ini, setIni] = useState(iso(new Date(hoje.getTime() - 30 * 86400000)));
  const [fim, setFim] = useState(iso(hoje));
  const [resp, setResp] = useState(null);
  const [busy, setBusy] = useState(true);
  const [erro, setErro] = useState('');
  const [tipo, setTipo] = useState('todos');
  const [busca, setBusca] = useState('');
  async function carregar() {
    setBusy(true); setErro('');
    try { setResp(await api.liberacaoFormaTrocas(ini, fim)); } catch (e) { setErro(e.message || 'Erro ao carregar trocas'); }
    finally { setBusy(false); }
  }
  useEffect(() => { carregar(); }, []);
  const linhas = useMemo(() => {
    let ls = resp?.trocas || [];
    if (tipo !== 'todos') ls = ls.filter(t => t.tipo === tipo);
    if (busca.trim()) {
      const q = busca.toLowerCase();
      ls = ls.filter(t => (t.cliente || '').toLowerCase().includes(q) || (t.documento || '').toLowerCase().includes(q) || (t.usuario || '').toLowerCase().includes(q));
    }
    return ls;
  }, [resp, tipo, busca]);
  function exportXlsx() {
    const ws = XLSX.utils.json_to_sheet(linhas.map(t => ({
      Data: fmtBrHr(t.data), Tipo: t.tipo_nome, Filial: t.fil_id, Cliente: t.cliente, 'Cód.': t.agn_id,
      Documento: `${t.documento}${t.parcela ? '/' + t.parcela : ''}`, 'Tipo doc.': t.tpd, De: t.de_nome, Para: t.para_nome,
      'Liberação': t.liberacao || '', Usuário: t.usuario, Origem: t.origem
    })));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Trocas registradas');
    XLSX.writeFile(wb, `liberacao-forma-trocas-${ini}-${fim}.xlsx`);
  }
  const k = resp?.kpi || {};
  return (
    <div className="space-y-5">
      {erro && <div className="bg-red-900/40 text-red-200 text-sm rounded p-3">{erro}</div>}
      <div className="flex flex-wrap items-end gap-3">
        <div><label className="text-[10px] uppercase tracking-wider text-gray-500 block mb-1">De</label>
          <input type="date" value={ini} onChange={e => setIni(e.target.value)} className="bg-ink-900 border border-ink-700 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-prim-500" /></div>
        <div><label className="text-[10px] uppercase tracking-wider text-gray-500 block mb-1">até</label>
          <input type="date" value={fim} onChange={e => setFim(e.target.value)} className="bg-ink-900 border border-ink-700 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-prim-500" /></div>
        <button className="btn-prim" disabled={busy} onClick={carregar}>{busy ? 'Carregando…' : 'Aplicar período'}</button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Kpi icon={<ShieldAlert size={16} />} label="Bloqueadas" value={fmtN(k.X)} color="rose" sub="tentativas sem liberação" />
        <Kpi icon={<Unlock size={16} />} label="Com liberação" value={fmtN(k.L)} />
        <Kpi icon={<CircleSlash size={16} />} label="Sem forma → preenchida" value={fmtN(k.S)} color="acc" />
        <Kpi icon={<Landmark size={16} />} label="Boleto (banco do dia)" value={fmtN(k.D)} color="acc" sub="fora da trava" />
        <Kpi icon={<Repeat size={16} />} label="Rotina automática" value={fmtN(k.A)} color="acc" />
      </div>
      <div className="card overflow-hidden">
        <div className="bg-ink-900 px-4 py-3 border-b border-ink-700 flex flex-wrap gap-2 items-center">
          <select className="bg-ink-800 text-xs text-gray-300 rounded px-2 py-1.5 outline-none" value={tipo} onChange={e => setTipo(e.target.value)}>
            <option value="todos">Todos os tipos</option>
            <option value="X">Bloqueadas</option><option value="L">Com liberação</option><option value="S">Sem forma → preenchida</option>
            <option value="D">Boleto (banco do dia)</option><option value="A">Rotina automática</option>
          </select>
          <div className="ml-auto flex items-center gap-2 bg-ink-800 px-2 rounded">
            <Search size={14} className="text-gray-500" />
            <input className="bg-transparent outline-none py-1 text-sm w-56" placeholder="Buscar cliente, documento ou usuário..." value={busca} onChange={e => setBusca(e.target.value)} />
          </div>
          <button className="btn-ghost" onClick={exportXlsx} disabled={linhas.length === 0}><FileSpreadsheet size={16} /> Excel</button>
        </div>
        <div className="overflow-auto max-h-[52vh]">
          <table className="w-full text-sm">
            <thead className="bg-ink-900/70 text-gray-400 uppercase text-xs sticky top-0 z-10">
              <tr><th className="text-left p-2 pl-4">Data</th><th className="text-left p-2">Tipo</th><th className="text-left p-2">Título</th>
                <th className="text-left p-2">De → Para</th><th className="text-left p-2">Usuário</th><th className="text-left p-2 pr-4">Origem</th></tr>
            </thead>
            <tbody>
              {linhas.map((t, i) => (
                <tr key={i} className="border-t border-ink-700 hover:bg-ink-800/40">
                  <td className="p-2 pl-4 text-xs text-gray-300 whitespace-nowrap">{fmtBrHr(t.data)}</td>
                  <td className="p-2"><span className={`text-[10px] px-1.5 py-0.5 rounded uppercase ${COR_TIPO[t.tipo] || ''}`}>{t.tipo_nome}</span></td>
                  <td className="p-2"><div className="text-gray-200 text-xs">{t.cliente}</div>
                    <div className="text-xs text-gray-500 font-mono">fil {t.fil_id} · {t.documento}{t.parcela ? `/${t.parcela}` : ''} · {t.tpd}</div></td>
                  <td className="p-2 text-xs text-gray-400">{t.de_nome} → <span className="text-gray-200">{t.para_nome}</span></td>
                  <td className="p-2 text-xs text-gray-300">{t.usuario}</td>
                  <td className="p-2 pr-4 text-xs text-gray-500 max-w-[200px] truncate" title={t.origem}>{t.origem}</td>
                </tr>
              ))}
              {linhas.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-gray-500">{busy ? 'Carregando...' : 'Nenhuma troca registrada no período.'}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ componentes locais */
function StatusLib({ lib }) {
  if (lib.status === 'C') return <span className="text-[10px] px-1.5 py-0.5 rounded bg-ink-700 text-gray-400 uppercase">Cancelada</span>;
  if (lib.status === 'E') return <span className="text-[10px] px-1.5 py-0.5 rounded bg-prim-600/20 text-prim-400 uppercase">Executada</span>;
  return <span className="text-[10px] px-1.5 py-0.5 rounded bg-acc-500/20 text-acc-500 uppercase">Ativa</span>;
}
function Info({ rotulo, valor, mono, destaque, span2 }) {
  return (
    <div className={span2 ? 'col-span-2' : ''}>
      <div className="text-[10px] uppercase tracking-wider text-gray-500">{rotulo}</div>
      <div className={`${mono ? 'font-mono' : ''} ${destaque ? 'text-prim-400 font-semibold' : 'text-gray-200'} text-sm`}>{valor}</div>
    </div>
  );
}
function Kpi({ icon, label, value, sub, color = 'prim' }) {
  const map = { prim: { border: 'border-prim-500', text: 'text-prim-400' }, acc: { border: 'border-acc-500', text: 'text-acc-500' }, rose: { border: 'border-rose-500', text: 'text-rose-400' } };
  const c = map[color] || map.prim;
  return (
    <div className={`kpi border-l-4 ${c.border}`}>
      <div className="kpi-label flex items-center gap-1">{icon} {label}</div>
      <div className={`kpi-value ${c.text}`}>{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}
function Th({ k, sort, onSort, className = '', children }) {
  const ativo = sort.k === k;
  return (
    <th className={`p-2 select-none cursor-pointer whitespace-nowrap hover:text-gray-200 ${className}`} onClick={() => onSort(k)}>
      <span className="inline-flex items-center gap-0.5">{children}{ativo && (sort.asc ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}</span>
    </th>
  );
}
function Pager({ pagina, total, onChange }) {
  if (total <= 1) return null;
  return (
    <span className="ml-auto flex items-center gap-2 text-xs text-gray-400">
      <button className="p-1 rounded hover:bg-ink-700 disabled:opacity-30" disabled={pagina <= 1} onClick={() => onChange(pagina - 1)}><ChevronLeft size={14} /></button>
      página {pagina} de {fmtN(total)}
      <button className="p-1 rounded hover:bg-ink-700 disabled:opacity-30" disabled={pagina >= total} onClick={() => onChange(pagina + 1)}><ChevronRight size={14} /></button>
    </span>
  );
}
