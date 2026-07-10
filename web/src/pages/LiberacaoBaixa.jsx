// [10/07/2026 - CRIADO POR ALEXANDRE CARVALHO] Liberação de Data de Baixa.
// Aba "Títulos em aberto": todos os títulos do CR com saldo em aberto
// (FIN_VW_CONTASRECEBER). Botão direito num título -> "Liberar data de baixa"
// abre o modal com os dados do título + data retroativa a liberar (um título
// pode ter várias datas). A liberação vale na trigger CCS_T_DATA_BAIXA
// (MEGA.CCS_TB_LIBERA_DATA_BAIXA) e cada baixa que a usa gera execução em
// CCS_TB_LIBERA_DATA_BAIXA_EXEC (quem executou, quando, lançamento).
// Aba "Histórico de liberações": tudo que foi liberado, status, quem liberou,
// execuções e revogação.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  FileSpreadsheet, Search, Wallet, AlertTriangle, CalendarClock,
  Users, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, CalendarCheck2,
  Unlock, X, History, ListChecks, Ban, CheckCircle2, Clock3
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { api, getSession } from '../api/client';

const fmt   = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtN  = v => Number(v || 0).toLocaleString('pt-BR');
const fmtBr = iso => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');
const fmtBrHr = s => (s ? `${fmtBr(s)} ${s.slice(11, 16)}` : '');

const SITUACOES = [
  { k: 'todos',    l: 'Todos' },
  { k: 'vencidos', l: 'Vencidos' },
  { k: 'hoje',     l: 'Vence hoje' },
  { k: 'avencer',  l: 'A vencer' }
];
const POR_PAGINA = 100;
const SORTS = {
  cliente:    t => (t.cliente || '').toLowerCase(),
  fil_id:     t => t.fil_id,
  documento:  t => t.documento,
  tipo:       t => t.tipo,
  forma:      t => t.forma_receb,
  emissao:    t => t.emissao || '',
  prorrogado: t => t.prorrogado || '',
  dias:       t => t.dias_atraso,
  valor:      t => t.valor,
  saldo:      t => t.saldo
};

export default function LiberacaoBaixa() {
  const [aba, setAba] = useState('titulos');   // titulos | historico
  // menu de contexto + modal de liberação (compartilhados pelas abas)
  const [ctx,   setCtx]   = useState(null);    // {x, y, titulo}
  const [modal, setModal] = useState(null);    // titulo em liberação
  const [refreshHist, setRefreshHist] = useState(0);

  // fecha o menu de contexto em qualquer clique/scroll/esc
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
          <CalendarCheck2 size={20} /> Liberação de Data de Baixa
        </h1>
        <p className="text-sm text-gray-400 mt-1 max-w-3xl">
          A baixa com data diferente da data de hoje é travada no ERP. Clique com o
          <b> botão direito</b> num título para liberar uma data específica — a liberação
          vale para uma baixa naquela data e fica auditada no histórico.
        </p>
      </div>

      {/* Abas */}
      <div className="flex gap-1 border-b border-ink-700">
        <Aba ativo={aba === 'titulos'} onClick={() => setAba('titulos')}
             icon={<ListChecks size={15} />} label="Títulos em aberto" />
        <Aba ativo={aba === 'historico'} onClick={() => setAba('historico')}
             icon={<History size={15} />} label="Histórico de liberações" />
      </div>

      {aba === 'titulos'
        ? <AbaTitulos onContexto={(e, t) => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, titulo: t }); }} />
        : <AbaHistorico refresh={refreshHist} />}

      {/* Menu de contexto */}
      {ctx && (
        <div className="fixed z-40 bg-ink-900 border border-ink-700 rounded-lg shadow-xl py-1 min-w-[220px]"
             style={{ left: Math.min(ctx.x, window.innerWidth - 240), top: Math.min(ctx.y, window.innerHeight - 60) }}>
          <button className="w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-ink-800 flex items-center gap-2"
                  onClick={() => { setModal(ctx.titulo); setCtx(null); }}>
            <Unlock size={15} className="text-prim-400" /> Liberar data de baixa…
          </button>
        </div>
      )}

      {/* Modal de liberação */}
      {modal && (
        <ModalLiberacao titulo={modal}
          onClose={(mudou) => { setModal(null); if (mudou) setRefreshHist(x => x + 1); }} />
      )}
    </div>
  );
}

function Aba({ ativo, onClick, icon, label }) {
  return (
    <button onClick={onClick}
      className={`px-4 py-2 text-sm rounded-t-lg flex items-center gap-1.5 transition border-b-2 -mb-px
        ${ativo ? 'border-prim-500 text-prim-400 bg-ink-800/60'
                : 'border-transparent text-gray-400 hover:text-gray-200'}`}>
      {icon}{label}
    </button>
  );
}

/* ---------------------------------------------------------------- títulos */
function AbaTitulos({ onContexto }) {
  const [resp,   setResp]   = useState(null);
  const [busy,   setBusy]   = useState(true);
  const [erro,   setErro]   = useState('');
  const [sit,    setSit]    = useState('todos');
  const [fil,    setFil]    = useState('todas');
  const [forma,  setForma]  = useState('todas');
  const [busca,  setBusca]  = useState('');
  const [sort,   setSort]   = useState({ k: 'prorrogado', asc: true });
  const [pagina, setPagina] = useState(1);

  async function carregar() {
    setBusy(true); setErro('');
    try { setResp(await api.liberacaoBaixaTitulos()); }
    catch (e) { setErro(e.message || 'Erro ao carregar títulos em aberto'); setResp(null); }
    finally { setBusy(false); }
  }
  useEffect(() => { carregar(); }, []);

  const filiais = useMemo(() =>
    resp ? [...new Set(resp.titulos.map(t => t.fil_id))].sort((a, b) => a - b) : [], [resp]);
  const formas = useMemo(() =>
    resp ? [...new Set(resp.titulos.map(t => t.forma_receb).filter(Boolean))].sort() : [], [resp]);

  const linhas = useMemo(() => {
    if (!resp) return [];
    let arr = resp.titulos;
    if (sit === 'vencidos') arr = arr.filter(t => t.dias_atraso > 0);
    if (sit === 'hoje')     arr = arr.filter(t => t.dias_atraso === 0);
    if (sit === 'avencer')  arr = arr.filter(t => t.dias_atraso < 0);
    if (fil   !== 'todas')  arr = arr.filter(t => String(t.fil_id) === fil);
    if (forma !== 'todas')  arr = arr.filter(t => t.forma_receb === forma);
    if (busca.trim()) {
      const q = busca.toLowerCase();
      arr = arr.filter(t =>
        String(t.agn_id).includes(q) ||
        (t.cliente   || '').toLowerCase().includes(q) ||
        (t.documento || '').toLowerCase().includes(q));
    }
    const ex = SORTS[sort.k] || SORTS.prorrogado;
    arr = [...arr].sort((a, b) => {
      const va = ex(a), vb = ex(b);
      const c = va < vb ? -1 : va > vb ? 1 : 0;
      return sort.asc ? c : -c;
    });
    return arr;
  }, [resp, sit, fil, forma, busca, sort]);

  useEffect(() => { setPagina(1); }, [sit, fil, forma, busca, sort]);

  const totPaginas = Math.max(1, Math.ceil(linhas.length / POR_PAGINA));
  const visiveis   = linhas.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);
  const somaFiltro = useMemo(() => linhas.reduce((s, t) => s + t.saldo, 0), [linhas]);

  function alternaSort(k) { setSort(s => s.k === k ? { k, asc: !s.asc } : { k, asc: true }); }

  function exportXlsx() {
    const dados = linhas.map(t => ({
      'Cód. Cliente': t.agn_id, Cliente: t.cliente, Filial: t.fil_id,
      Documento: t.documento, Parcela: t.parcela, Tipo: t.tipo,
      'Forma Receb.': t.forma_receb, 'Emissão': fmtBr(t.emissao),
      Vencimento: fmtBr(t.vencto), 'Venc. prorrogado': fmtBr(t.prorrogado),
      Dias: t.dias_atraso, 'Valor original': t.valor, 'Saldo em aberto': t.saldo
    }));
    const ws = XLSX.utils.json_to_sheet(dados);
    ws['!cols'] = [{wch:12},{wch:48},{wch:7},{wch:14},{wch:8},{wch:10},{wch:24},
                   {wch:11},{wch:11},{wch:14},{wch:9},{wch:14},{wch:15}];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Títulos em aberto');
    XLSX.writeFile(wb, `liberacao-data-baixa-titulos-${new Date().toISOString().slice(0,10)}.xlsx`);
  }

  const kpi = resp?.kpi;
  const pctVencido = kpi && kpi.saldo_total > 0
    ? Math.round(kpi.saldo_vencido / kpi.saldo_total * 100) : 0;

  return (
    <div className="space-y-5">
      {erro && <div className="bg-red-900/40 text-red-200 text-sm rounded p-3">{erro}</div>}

      {kpi && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Kpi icon={<Wallet size={16} />} label="Saldo em aberto" value={fmt(kpi.saldo_total)}
               sub={`${fmtN(kpi.qt_titulos)} título(s)`} color="prim" />
          <Kpi icon={<AlertTriangle size={16} />} label="Vencido" value={fmt(kpi.saldo_vencido)}
               sub={`${fmtN(kpi.qt_vencidos)} título(s) · ${pctVencido}% do saldo`} color="rose" />
          <Kpi icon={<CalendarClock size={16} />} label="A vencer" value={fmt(kpi.saldo_avencer)}
               sub={`${fmtN(kpi.qt_avencer)} título(s)`} color="acc" />
          <Kpi icon={<Users size={16} />} label="Clientes com saldo" value={fmtN(kpi.qt_clientes)}
               sub={kpi.maior_atraso > 0 ? `maior atraso: ${fmtN(kpi.maior_atraso)} dia(s)` : 'sem títulos vencidos'}
               color="prim" />
        </div>
      )}

      {resp && (
        <div className="card overflow-hidden">
          <div className="bg-ink-900 px-4 py-3 border-b border-ink-700 flex flex-wrap gap-2 items-center">
            <div className="flex gap-1">
              {SITUACOES.map(s => (
                <button key={s.k}
                  className={`px-3 py-1 rounded text-xs transition
                    ${sit === s.k ? 'bg-prim-600 text-white' : 'bg-ink-800 hover:bg-ink-700 text-gray-300'}`}
                  onClick={() => setSit(s.k)}>
                  {s.l}
                </button>
              ))}
            </div>
            <select className="bg-ink-800 text-xs text-gray-300 rounded px-2 py-1.5 outline-none"
                    value={fil} onChange={e => setFil(e.target.value)}>
              <option value="todas">Todas as filiais</option>
              {filiais.map(f => <option key={f} value={String(f)}>Filial {f}</option>)}
            </select>
            <select className="bg-ink-800 text-xs text-gray-300 rounded px-2 py-1.5 outline-none max-w-[220px]"
                    value={forma} onChange={e => setForma(e.target.value)}>
              <option value="todas">Todas as formas de receb.</option>
              {formas.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
            <div className="ml-auto flex items-center gap-2 bg-ink-800 px-2 rounded">
              <Search size={14} className="text-gray-500" />
              <input className="bg-transparent outline-none py-1 text-sm w-56"
                     placeholder="Buscar cliente, código ou documento..."
                     value={busca} onChange={e => setBusca(e.target.value)} />
            </div>
            <button className="btn-ghost" onClick={exportXlsx} disabled={linhas.length === 0}>
              <FileSpreadsheet size={16} /> Excel
            </button>
          </div>

          <div className="px-4 py-2 bg-ink-900/50 border-b border-ink-700 text-xs text-gray-400 flex flex-wrap gap-4 items-center">
            <span>{fmtN(linhas.length)} título(s) no filtro</span>
            <span>Soma: <span className="text-prim-400 font-mono">{fmt(somaFiltro)}</span></span>
            <span className="text-gray-500 hidden md:inline">botão direito num título → liberar data de baixa</span>
            {busy && <span className="text-gray-500">atualizando…</span>}
            <Pager pagina={pagina} total={totPaginas} onChange={setPagina} />
          </div>

          <div className="overflow-auto max-h-[52vh]">
            <table className="w-full text-sm">
              <thead className="bg-ink-900/70 text-gray-400 uppercase text-xs sticky top-0 z-10">
                <tr>
                  <Th k="cliente"    sort={sort} onSort={alternaSort} className="text-left pl-4">Cliente</Th>
                  <Th k="fil_id"     sort={sort} onSort={alternaSort} className="text-center">Filial</Th>
                  <Th k="documento"  sort={sort} onSort={alternaSort} className="text-left">Documento</Th>
                  <Th k="tipo"       sort={sort} onSort={alternaSort} className="text-left">Tipo</Th>
                  <Th k="forma"      sort={sort} onSort={alternaSort} className="text-left">Forma Receb.</Th>
                  <Th k="emissao"    sort={sort} onSort={alternaSort} className="text-center">Emissão</Th>
                  <Th k="prorrogado" sort={sort} onSort={alternaSort} className="text-center">Vencimento</Th>
                  <Th k="dias"       sort={sort} onSort={alternaSort} className="text-right">Situação</Th>
                  <Th k="valor"      sort={sort} onSort={alternaSort} className="text-right">Valor</Th>
                  <Th k="saldo"      sort={sort} onSort={alternaSort} className="text-right pr-4">Saldo em aberto</Th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map((t, i) => (
                  <tr key={i}
                      className="border-t border-ink-700 hover:bg-ink-800/40 cursor-context-menu"
                      onContextMenu={e => onContexto(e, t)}>
                    <td className="p-2 pl-4">
                      <div className="text-gray-200">{t.cliente}</div>
                      <div className="text-xs text-gray-500 font-mono">cód. {t.agn_id}</div>
                    </td>
                    <td className="p-2 text-center font-mono text-xs text-gray-400">{t.fil_id}</td>
                    <td className="p-2 font-mono text-xs text-gray-300">
                      {t.documento}{t.parcela ? <span className="text-gray-500">/{t.parcela}</span> : ''}
                    </td>
                    <td className="p-2 text-xs text-gray-400">{t.tipo}</td>
                    <td className="p-2 text-xs text-gray-400 max-w-[180px] truncate" title={t.forma_receb}>
                      {t.forma_receb || '—'}
                    </td>
                    <td className="p-2 text-center text-xs text-gray-400">{fmtBr(t.emissao)}</td>
                    <td className="p-2 text-center text-xs text-gray-300">
                      {fmtBr(t.prorrogado)}
                      {t.prorrogado !== t.vencto && (
                        <div className="text-[10px] text-gray-500" title="Vencimento original">
                          orig. {fmtBr(t.vencto)}
                        </div>
                      )}
                    </td>
                    <td className="p-2 text-right"><BadgeDias dias={t.dias_atraso} /></td>
                    <td className="p-2 text-right font-mono text-xs text-gray-400">{fmt(t.valor)}</td>
                    <td className="p-2 pr-4 text-right font-mono font-semibold text-gray-100">{fmt(t.saldo)}</td>
                  </tr>
                ))}
                {visiveis.length === 0 && (
                  <tr><td colSpan={10} className="p-8 text-center text-gray-500">
                    {busy ? 'Carregando...' : 'Nenhum título no filtro selecionado.'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="px-4 py-2 bg-ink-900/50 border-t border-ink-700 flex justify-end">
            <Pager pagina={pagina} total={totPaginas} onChange={setPagina} />
          </div>
        </div>
      )}

      {busy && !resp && <div className="text-gray-400 text-sm">Carregando títulos em aberto...</div>}
    </div>
  );
}

/* ------------------------------------------------------- modal liberação */
function ModalLiberacao({ titulo, onClose }) {
  const ontem = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const [data,   setData]   = useState('');
  const [motivo, setMotivo] = useState('');
  const [libs,   setLibs]   = useState(null);   // liberações já existentes do título
  const [busy,   setBusy]   = useState(false);
  const [erro,   setErro]   = useState('');
  const [okMsg,  setOkMsg]  = useState('');
  const mudou = useRef(false);

  async function carregaLibs() {
    try {
      const r = await api.liberacaoBaixaLiberacoes(titulo.agn_id, titulo.documento);
      setLibs(r.liberacoes.filter(l =>
        (l.parcela || '') === (titulo.parcela || '') && l.fil_id === titulo.fil_id));
    } catch { setLibs([]); }
  }
  useEffect(() => { carregaLibs(); }, []);

  async function liberar() {
    setErro(''); setOkMsg('');
    if (!data) { setErro('Informe a data a liberar.'); return; }
    setBusy(true);
    try {
      await api.liberacaoBaixaLiberar({
        fil: titulo.fil_id, agn: titulo.agn_id,
        documento: titulo.documento, parcela: titulo.parcela || '',
        data, motivo: motivo.trim()
      });
      mudou.current = true;
      setOkMsg(`Data ${fmtBr(data)} liberada para a baixa deste título.`);
      setData(''); setMotivo('');
      carregaLibs();
    } catch (e) {
      setErro(e.message === 'ja_liberado'
        ? 'Este título já tem uma liberação ativa para esta data.'
        : (e.message || 'Erro ao liberar'));
    } finally { setBusy(false); }
  }

  async function revogar(id) {
    setBusy(true); setErro(''); setOkMsg('');
    try { await api.liberacaoBaixaRevogar(id); mudou.current = true; carregaLibs(); }
    catch (e) { setErro(e.message || 'Erro ao revogar'); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
         onClick={() => onClose(mudou.current)}>
      <div className="card w-full max-w-lg shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-ink-700 flex items-center justify-between bg-ink-900 rounded-t-lg">
          <h2 className="font-semibold text-prim-400 flex items-center gap-2">
            <Unlock size={16} /> Liberar data de baixa
          </h2>
          <button className="text-gray-500 hover:text-gray-200" onClick={() => onClose(mudou.current)}>
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* dados do título */}
          <div className="bg-ink-900/60 rounded-lg p-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
            <Info rotulo="Cliente" valor={`${titulo.cliente}`} span2 />
            <Info rotulo="Cód. cliente" valor={titulo.agn_id} mono />
            <Info rotulo="Filial" valor={titulo.fil_id} mono />
            <Info rotulo="Documento" valor={`${titulo.documento}${titulo.parcela ? '/' + titulo.parcela : ''}`} mono />
            <Info rotulo="Tipo" valor={titulo.tipo} />
            <Info rotulo="Vencimento" valor={fmtBr(titulo.prorrogado)} />
            <Info rotulo="Saldo em aberto" valor={fmt(titulo.saldo)} destaque />
          </div>

          {/* nova liberação */}
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-wider text-gray-400">
              Data liberada para a baixa (retroativa)
            </label>
            <input type="date" max={ontem} value={data}
                   onChange={e => setData(e.target.value)}
                   className="w-full bg-ink-900 border border-ink-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-prim-500" />
            <textarea rows={2} placeholder="Motivo (opcional)"
                      value={motivo} onChange={e => setMotivo(e.target.value)} maxLength={200}
                      className="w-full bg-ink-900 border border-ink-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-prim-500 resize-none" />
            {erro  && <div className="text-rose-300 text-xs bg-rose-900/30 rounded p-2">{erro}</div>}
            {okMsg && <div className="text-prim-300 text-xs bg-prim-600/15 rounded p-2 flex items-center gap-1.5">
              <CheckCircle2 size={14} /> {okMsg}</div>}
            <button className="btn-prim w-full justify-center" disabled={busy || !data} onClick={liberar}>
              <Unlock size={15} /> {busy ? 'Liberando…' : 'Liberar esta data'}
            </button>
          </div>

          {/* liberações existentes deste título */}
          <div>
            <div className="text-xs uppercase tracking-wider text-gray-400 mb-1.5">
              Liberações deste título {libs && libs.length > 0 && `(${libs.length})`}
            </div>
            {!libs && <div className="text-xs text-gray-500">carregando…</div>}
            {libs && libs.length === 0 && (
              <div className="text-xs text-gray-500">Nenhuma liberação registrada para este título.</div>
            )}
            {libs && libs.length > 0 && (
              <div className="space-y-1.5 max-h-44 overflow-auto pr-1">
                {libs.map(l => (
                  <div key={l.id} className="bg-ink-900/60 rounded-lg px-3 py-2 text-xs flex items-center gap-3">
                    <span className="font-mono text-gray-200">{fmtBr(l.data_liberada)}</span>
                    <StatusLib lib={l} />
                    <span className="text-gray-500 truncate flex-1" title={`por ${l.usu_liberou_nome} em ${fmtBrHr(l.liberado_em)}`}>
                      por {l.usu_liberou_nome} · {fmtBrHr(l.liberado_em)}
                    </span>
                    {l.status === 'A' && l.execucoes.length === 0 && (
                      <button className="text-rose-400 hover:text-rose-300 flex items-center gap-1"
                              title="Revogar liberação" disabled={busy} onClick={() => revogar(l.id)}>
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

function Info({ rotulo, valor, mono, destaque, span2 }) {
  return (
    <div className={span2 ? 'col-span-2' : ''}>
      <div className="text-[10px] uppercase tracking-wider text-gray-500">{rotulo}</div>
      <div className={`${mono ? 'font-mono' : ''} ${destaque ? 'text-prim-400 font-semibold' : 'text-gray-200'} text-sm`}>
        {valor}
      </div>
    </div>
  );
}

/* --------------------------------------------------------- histórico */
const FILTROS_HIST = [
  { k: 'todas',      l: 'Todas' },
  { k: 'ativas',     l: 'Ativas' },
  { k: 'executadas', l: 'Executadas' },
  { k: 'canceladas', l: 'Canceladas' }
];

function AbaHistorico({ refresh }) {
  const [resp,  setResp]  = useState(null);
  const [busy,  setBusy]  = useState(true);
  const [erro,  setErro]  = useState('');
  const [filtro, setFiltro] = useState('todas');
  const [busca, setBusca] = useState('');

  async function carregar() {
    setBusy(true); setErro('');
    try { setResp(await api.liberacaoBaixaLiberacoes()); }
    catch (e) { setErro(e.message || 'Erro ao carregar histórico'); setResp(null); }
    finally { setBusy(false); }
  }
  useEffect(() => { carregar(); }, [refresh]);

  async function revogar(id) {
    if (!window.confirm('Revogar esta liberação? Ela deixa de valer imediatamente.')) return;
    try { await api.liberacaoBaixaRevogar(id); carregar(); }
    catch (e) { setErro(e.message || 'Erro ao revogar'); }
  }

  const linhas = useMemo(() => {
    if (!resp) return [];
    let arr = resp.liberacoes;
    if (filtro === 'ativas')     arr = arr.filter(l => l.status === 'A' && l.execucoes.length === 0);
    if (filtro === 'executadas') arr = arr.filter(l => l.execucoes.length > 0);
    if (filtro === 'canceladas') arr = arr.filter(l => l.status === 'C');
    if (busca.trim()) {
      const q = busca.toLowerCase();
      arr = arr.filter(l =>
        String(l.agn_id).includes(q) ||
        (l.cliente   || '').toLowerCase().includes(q) ||
        (l.documento || '').toLowerCase().includes(q) ||
        (l.usu_liberou_nome || '').toLowerCase().includes(q));
    }
    return arr;
  }, [resp, filtro, busca]);

  function exportXlsx() {
    const dados = [];
    for (const l of linhas) {
      const base = {
        'Liberado em': fmtBrHr(l.liberado_em), 'Quem liberou': l.usu_liberou_nome,
        'Cód. Cliente': l.agn_id, Cliente: l.cliente, Filial: l.fil_id,
        Documento: l.documento, Parcela: l.parcela,
        'Data liberada': fmtBr(l.data_liberada), Motivo: l.motivo,
        Status: l.status === 'C' ? 'Cancelada' : l.execucoes.length ? 'Executada' : 'Ativa'
      };
      if (l.execucoes.length === 0) dados.push({ ...base, 'Executado em': '', 'Quem executou': '', 'Lançamento': '', 'Valor baixado': '' });
      for (const e of l.execucoes) dados.push({
        ...base, 'Executado em': fmtBrHr(e.executado_em),
        'Quem executou': e.usu_exec_nome, 'Lançamento': e.lancamento, 'Valor baixado': e.valor
      });
    }
    const ws = XLSX.utils.json_to_sheet(dados);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Histórico de liberações');
    XLSX.writeFile(wb, `liberacao-data-baixa-historico-${new Date().toISOString().slice(0,10)}.xlsx`);
  }

  const kpi = useMemo(() => {
    const ls = resp?.liberacoes || [];
    return {
      total:      ls.length,
      ativas:     ls.filter(l => l.status === 'A' && l.execucoes.length === 0).length,
      executadas: ls.filter(l => l.execucoes.length > 0).length,
      canceladas: ls.filter(l => l.status === 'C').length
    };
  }, [resp]);

  return (
    <div className="space-y-5">
      {erro && <div className="bg-red-900/40 text-red-200 text-sm rounded p-3">{erro}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Kpi icon={<History size={16} />}      label="Liberações"  value={fmtN(kpi.total)}      color="prim" />
        <Kpi icon={<Clock3 size={16} />}       label="Ativas (aguardando baixa)" value={fmtN(kpi.ativas)} color="acc" />
        <Kpi icon={<CheckCircle2 size={16} />} label="Executadas"  value={fmtN(kpi.executadas)} color="prim" />
        <Kpi icon={<Ban size={16} />}          label="Canceladas"  value={fmtN(kpi.canceladas)} color="rose" />
      </div>

      <div className="card overflow-hidden">
        <div className="bg-ink-900 px-4 py-3 border-b border-ink-700 flex flex-wrap gap-2 items-center">
          <div className="flex gap-1">
            {FILTROS_HIST.map(f => (
              <button key={f.k}
                className={`px-3 py-1 rounded text-xs transition
                  ${filtro === f.k ? 'bg-prim-600 text-white' : 'bg-ink-800 hover:bg-ink-700 text-gray-300'}`}
                onClick={() => setFiltro(f.k)}>
                {f.l}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2 bg-ink-800 px-2 rounded">
            <Search size={14} className="text-gray-500" />
            <input className="bg-transparent outline-none py-1 text-sm w-56"
                   placeholder="Buscar cliente, documento ou usuário..."
                   value={busca} onChange={e => setBusca(e.target.value)} />
          </div>
          <button className="btn-ghost" onClick={exportXlsx} disabled={linhas.length === 0}>
            <FileSpreadsheet size={16} /> Excel
          </button>
        </div>

        <div className="overflow-auto max-h-[56vh]">
          <table className="w-full text-sm">
            <thead className="bg-ink-900/70 text-gray-400 uppercase text-xs sticky top-0 z-10">
              <tr>
                <th className="text-left p-2 pl-4">Liberado em / por</th>
                <th className="text-left p-2">Título</th>
                <th className="text-center p-2">Data liberada</th>
                <th className="text-left p-2">Motivo</th>
                <th className="text-center p-2">Status</th>
                <th className="text-left p-2">Execução (baixa)</th>
                <th className="text-right p-2 pr-4"></th>
              </tr>
            </thead>
            <tbody>
              {linhas.map(l => (
                <tr key={l.id} className="border-t border-ink-700 hover:bg-ink-800/40 align-top">
                  <td className="p-2 pl-4">
                    <div className="text-gray-200 text-xs">{fmtBrHr(l.liberado_em)}</div>
                    <div className="text-xs text-gray-500">{l.usu_liberou_nome}</div>
                  </td>
                  <td className="p-2">
                    <div className="text-gray-200 text-xs">{l.cliente}</div>
                    <div className="text-xs text-gray-500 font-mono">
                      fil {l.fil_id} · {l.documento}{l.parcela ? `/${l.parcela}` : ''} · cód. {l.agn_id}
                    </div>
                  </td>
                  <td className="p-2 text-center font-mono text-xs text-gray-200">{fmtBr(l.data_liberada)}</td>
                  <td className="p-2 text-xs text-gray-400 max-w-[180px]">
                    <span className="line-clamp-2" title={l.motivo}>{l.motivo || '—'}</span>
                  </td>
                  <td className="p-2 text-center"><StatusLib lib={l} /></td>
                  <td className="p-2">
                    {l.execucoes.length === 0
                      ? <span className="text-xs text-gray-500">— não executada</span>
                      : l.execucoes.map((e, i) => (
                          <div key={i} className="text-xs text-gray-300">
                            <span className="text-prim-300">{fmtBrHr(e.executado_em)}</span>
                            {' · '}{e.usu_exec_nome}
                            {' · '}<span className="font-mono text-gray-400">lançto {e.lancamento}</span>
                            {' · '}<span className="font-mono">{fmt(e.valor)}</span>
                          </div>
                        ))}
                    {l.status === 'C' && l.cancelado_em && (
                      <div className="text-[11px] text-gray-500 mt-0.5">
                        cancelada em {fmtBrHr(l.cancelado_em)}{l.usu_cancelou_nome ? ` por ${l.usu_cancelou_nome}` : ''}
                      </div>
                    )}
                  </td>
                  <td className="p-2 pr-4 text-right">
                    {l.status === 'A' && l.execucoes.length === 0 && (
                      <button className="text-rose-400 hover:text-rose-300 text-xs flex items-center gap-1 ml-auto"
                              onClick={() => revogar(l.id)}>
                        <Ban size={13} /> revogar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {linhas.length === 0 && (
                <tr><td colSpan={7} className="p-8 text-center text-gray-500">
                  {busy ? 'Carregando...' : 'Nenhuma liberação no filtro selecionado.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatusLib({ lib }) {
  if (lib.status === 'C')
    return <span className="text-[10px] px-1.5 py-0.5 rounded bg-ink-700 text-gray-400 uppercase">Cancelada</span>;
  if (lib.execucoes.length > 0)
    return <span className="text-[10px] px-1.5 py-0.5 rounded bg-prim-600/25 text-prim-300 uppercase">Executada</span>;
  return <span className="text-[10px] px-1.5 py-0.5 rounded bg-acc-500/20 text-acc-500 uppercase">Ativa</span>;
}

/* ------------------------------------------------------------ genéricos */
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

function Th({ k, sort, onSort, className = '', children }) {
  const ativo = sort.k === k;
  return (
    <th className={`p-2 select-none cursor-pointer whitespace-nowrap hover:text-gray-200 ${className}`}
        onClick={() => onSort(k)}>
      <span className="inline-flex items-center gap-0.5">
        {children}
        {ativo && (sort.asc ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
      </span>
    </th>
  );
}

function BadgeDias({ dias }) {
  if (dias === 0)
    return <span className="text-[11px] px-1.5 py-0.5 rounded bg-acc-500/20 text-acc-500 font-semibold">vence hoje</span>;
  if (dias < 0)
    return <span className="text-xs text-gray-400 font-mono">em {fmtN(-dias)}d</span>;
  const cor = dias > 90 ? 'text-rose-400 font-bold'
            : dias > 60 ? 'text-orange-400'
            : dias > 30 ? 'text-amber-400' : 'text-amber-300';
  return <span className={`text-xs font-mono ${cor}`}>{fmtN(dias)}d atraso</span>;
}

function Pager({ pagina, total, onChange }) {
  if (total <= 1) return null;
  return (
    <span className="ml-auto flex items-center gap-2 text-xs text-gray-400">
      <button className="p-1 rounded hover:bg-ink-700 disabled:opacity-30"
              disabled={pagina <= 1} onClick={() => onChange(pagina - 1)}>
        <ChevronLeft size={14} />
      </button>
      página {pagina} de {fmtN(total)}
      <button className="p-1 rounded hover:bg-ink-700 disabled:opacity-30"
              disabled={pagina >= total} onClick={() => onChange(pagina + 1)}>
        <ChevronRight size={14} />
      </button>
    </span>
  );
}
