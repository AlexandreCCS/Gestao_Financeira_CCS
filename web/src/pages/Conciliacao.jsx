import React, { useEffect, useMemo, useState } from 'react';
import {
  Filter, FileSpreadsheet, FileText, AlertTriangle,
  TrendingUp, Activity, Clock, Search, X, ListChecks
} from 'lucide-react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { api } from '../api/client';

const fmt   = v => Number(v||0).toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
const fmtN  = v => Number(v||0).toLocaleString('pt-BR');
const fmtBr = iso => iso ? iso.split('-').reverse().join('/') : '';
const isoToday = () => new Date().toISOString().slice(0,10);
// [07/05/2026 - Alexandre Carvalho] Inicio operacional do GFIN
const GFIN_DT_INICIO = '2026-05-01';

// Critério de saúde da taxa de conciliação
function statusByPct(pct) {
  if (pct >= 95) return { label: 'Excelente',  classes: 'bg-emerald-700/30 text-emerald-300' };
  if (pct >= 80) return { label: 'Bom',        classes: 'bg-prim-700/30   text-prim-300' };
  if (pct >= 50) return { label: 'Atenção',    classes: 'bg-amber-700/30  text-amber-300' };
  return            { label: 'Crítico',     classes: 'bg-rose-700/30   text-rose-300' };
}

export default function Conciliacao() {
  // [07/05/2026 - Alexandre Carvalho] Default 01/05/2026 (inicio operacional do GFIN)
  const [dataIni, setDataIni] = useState(GFIN_DT_INICIO);
  const [dataFim, setDataFim] = useState(isoToday());
  const [fil,     setFil]     = useState(0);
  const [filtroStatus, setFiltroStatus] = useState('todos');  // todos | pendentes | conciliados | criticos
  const [busca,   setBusca]   = useState('');
  const [filiais, setFiliais] = useState([]);
  const [resp,    setResp]    = useState(null);
  const [busy,    setBusy]    = useState(false);
  const [err,     setErr]     = useState('');

  // [01/07/2026] Modal de pendencias por conta
  const [modalConta, setModalConta] = useState(null);   // linha da conta clicada
  const [modalResp,  setModalResp]  = useState(null);
  const [modalBusy,  setModalBusy]  = useState(false);
  const [modalErr,   setModalErr]   = useState('');
  const [modalBusca, setModalBusca] = useState('');

  useEffect(() => { api.saldosBancoFiliais().then(setFiliais).catch(()=>{}); }, []);

  async function abrirPendentes(l) {
    if (!l || l.qt_pend <= 0) return;
    setModalConta(l); setModalResp(null); setModalErr(''); setModalBusca(''); setModalBusy(true);
    try {
      setModalResp(await api.conciliacaoPendentes(l.agn_id, l.fil_id, dataIni, dataFim));
    } catch (e) {
      setModalErr(e.message || 'Erro ao carregar lançamentos pendentes');
    } finally { setModalBusy(false); }
  }
  function fecharModal() { setModalConta(null); setModalResp(null); setModalErr(''); }

  async function consultar() {
    setBusy(true); setErr('');
    try {
      const r = await api.conciliacao(dataIni, dataFim, fil);
      setResp(r);
    } catch (e) {
      setErr(e.message || 'Erro ao consultar conciliação');
      setResp(null);
    } finally { setBusy(false); }
  }
  useEffect(() => { consultar(); }, []); // eslint-disable-line

  // Aplica filtros locais (status + busca)
  const linhasFiltradas = useMemo(() => {
    if (!resp) return [];
    let arr = [...resp.linhas];
    if (filtroStatus === 'pendentes')   arr = arr.filter(l => l.qt_pend > 0);
    if (filtroStatus === 'conciliados') arr = arr.filter(l => l.qt_pend === 0 && l.qt_mov > 0);
    if (filtroStatus === 'criticos')    arr = arr.filter(l => l.aging.d90p > 0);
    if (busca.trim()) {
      const q = busca.toLowerCase();
      arr = arr.filter(l =>
        String(l.agn_id).includes(q) ||
        (l.agn_nome || '').toLowerCase().includes(q) ||
        (l.fil_nome || '').toLowerCase().includes(q)
      );
    }
    arr.sort((a, b) => a.fil_id - b.fil_id || a.agn_id - b.agn_id);
    return arr;
  }, [resp, filtroStatus, busca]);

  function exportXlsx() {
    if (!resp) return;
    const linhas = linhasFiltradas.map(l => ({
      Filial:             `${l.fil_id} - ${l.fil_nome || ''}`,
      'Cód. Conta':       l.agn_id,
      Conta:              l.agn_nome,
      'Qtd Movimentos':   l.qt_mov,
      'Qtd Conciliados':  l.qt_conc,
      'Qtd Pendentes':    l.qt_pend,
      '% Conciliação':    l.pct_conc,
      'Valor Pendente':   l.vl_pend,
      'Aging 0-30':       l.aging.d0_30,
      'Aging 31-60':      l.aging.d31_60,
      'Aging 61-90':      l.aging.d61_90,
      'Aging 90+':        l.aging.d90p,
      'Pend. mais antigo':fmtBr(l.dt_ult_pend) || '',
      'Última conc.':     fmtBr(l.dt_ult_conc) || ''
    }));
    const ws = XLSX.utils.json_to_sheet(linhas);
    ws['!cols'] = [ {wch:42},{wch:10},{wch:50}, {wch:10},{wch:10},{wch:10},{wch:10},{wch:16}, {wch:9},{wch:9},{wch:9},{wch:9}, {wch:14},{wch:14} ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Conciliação');
    XLSX.writeFile(wb, `conciliacao-${dataIni}_${dataFim}.xlsx`);
  }

  function exportPdf() {
    if (!resp) return;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    let y = 32;
    doc.setFont('helvetica','bold'); doc.setFontSize(14);
    doc.text('Painel de Conciliação Bancária', 40, y); y += 16;
    doc.setFont('helvetica','normal'); doc.setFontSize(9);
    doc.text(`Período: ${fmtBr(dataIni)} a ${fmtBr(dataFim)}    |    Filial: ${fil === 0 ? 'Todas' : fil}`, 40, y); y += 12;
    doc.text(`Movimentos: ${fmtN(resp.kpi.total_mov)}    Conciliados: ${fmtN(resp.kpi.total_conc)}    Pendentes: ${fmtN(resp.kpi.total_pend)}    Taxa: ${resp.kpi.pct_conc}%`, 40, y); y += 6;
    autoTable(doc, {
      startY: y + 8,
      head: [['Filial','Cód','Conta','Mov.','Conc.','Pend.','% Conc.','Vl. Pendente','0-30','31-60','61-90','90+']],
      body: linhasFiltradas.map(l => [
        `${l.fil_id} - ${(l.fil_nome||'').slice(0,28)}`,
        l.agn_id,
        (l.agn_nome||'').slice(0,40),
        fmtN(l.qt_mov), fmtN(l.qt_conc), fmtN(l.qt_pend),
        `${l.pct_conc}%`,
        fmt(l.vl_pend),
        fmtN(l.aging.d0_30), fmtN(l.aging.d31_60), fmtN(l.aging.d61_90), fmtN(l.aging.d90p)
      ]),
      styles: { fontSize: 7, cellPadding: 2 },
      headStyles: { fillColor: [16, 185, 129] },
      columnStyles: { 3:{halign:'right'},4:{halign:'right'},5:{halign:'right'},6:{halign:'right'},7:{halign:'right'},8:{halign:'right'},9:{halign:'right'},10:{halign:'right'},11:{halign:'right'} }
    });
    doc.save(`conciliacao-${dataIni}_${dataFim}.pdf`);
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header + filtros */}
      <div className="card p-4 flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-2 text-prim-400 font-semibold">
          <Filter size={18} /> Filtros
        </div>
        <label className="block">
          <span className="text-xs text-gray-300">De</span>
          <input type="date" className="input mt-1" value={dataIni} onChange={e=>setDataIni(e.target.value)} />
        </label>
        <label className="block">
          <span className="text-xs text-gray-300">Até</span>
          <input type="date" className="input mt-1" value={dataFim} onChange={e=>setDataFim(e.target.value)} />
        </label>
        <label className="block min-w-[220px]">
          <span className="text-xs text-gray-300">Filial</span>
          <select className="input mt-1" value={fil} onChange={e=>setFil(Number(e.target.value))}>
            <option value={0}>(Todas)</option>
            {filiais.map(f => <option key={f.id} value={f.id}>{f.id} - {f.nome}</option>)}
          </select>
        </label>
        <button className="btn-prim" onClick={consultar} disabled={busy}>
          {busy ? 'Consultando...' : 'Consultar'}
        </button>
        <div className="flex-1" />
        <button className="btn-ghost" onClick={exportXlsx} disabled={!resp}>
          <FileSpreadsheet size={16} /> Excel
        </button>
        <button className="btn-ghost" onClick={exportPdf} disabled={!resp}>
          <FileText size={16} /> PDF
        </button>
      </div>

      {err && <div className="bg-red-900/40 text-red-200 text-sm rounded p-3">{err}</div>}

      {/* KPIs */}
      {resp && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard
            icon={<Activity size={16} />}
            label="Taxa de conciliação"
            value={`${resp.kpi.pct_conc}%`}
            sub={`${fmtN(resp.kpi.total_conc)} de ${fmtN(resp.kpi.total_mov)} mov.`}
            color={resp.kpi.pct_conc >= 80 ? 'prim' : resp.kpi.pct_conc >= 50 ? 'acc' : 'rose'}
          />
          <KpiCard
            icon={<AlertTriangle size={16} />}
            label="Total pendente (qtd)"
            value={fmtN(resp.kpi.total_pend)}
            sub={`em ${fmtN(resp.kpi.contas_com_pendencia)} conta(s)`}
            color="acc"
          />
          <KpiCard
            icon={<TrendingUp size={16} />}
            label="Valor pendente"
            value={fmt(resp.kpi.valor_pend_abs)}
            sub="módulo dos lançamentos não conciliados"
            color="rose"
          />
          <KpiCard
            icon={<Clock size={16} />}
            label="Pendências críticas"
            value={fmtN(resp.kpi.total_pendentes_90p)}
            sub={`em ${fmtN(resp.kpi.contas_criticas)} conta(s) — > 90 dias`}
            color={resp.kpi.contas_criticas > 0 ? 'rose' : 'prim'}
          />
        </div>
      )}

      {/* Filtros locais e Tabela */}
      {resp && (
        <div className="card overflow-hidden">
          <div className="bg-ink-900 px-4 py-3 border-b border-ink-700 flex flex-wrap gap-2 items-center">
            <span className="text-sm font-semibold mr-3">Detalhamento por conta</span>
            <div className="flex gap-1">
              {[
                { k:'todos',       l:'Todos'              },
                { k:'pendentes',   l:'Com pendência'      },
                { k:'conciliados', l:'100% conciliadas'   },
                { k:'criticos',    l:'Críticas (>90d)'    }
              ].map(o => (
                <button key={o.k}
                  className={`px-3 py-1 rounded text-xs transition
                    ${filtroStatus === o.k ? 'bg-prim-600 text-white' : 'bg-ink-800 hover:bg-ink-700 text-gray-300'}`}
                  onClick={() => setFiltroStatus(o.k)}>
                  {o.l}
                </button>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-2 bg-ink-800 px-2 rounded">
              <Search size={14} className="text-gray-500" />
              <input className="bg-transparent outline-none py-1 text-sm w-56"
                     placeholder="Buscar conta ou filial..."
                     value={busca} onChange={e=>setBusca(e.target.value)} />
            </div>
            <span className="text-xs text-gray-400">{linhasFiltradas.length} conta(s)</span>
          </div>

          <div className="overflow-auto max-h-[60vh]">
            <table className="w-full text-sm">
              <thead className="bg-ink-900/70 text-gray-400 uppercase text-xs sticky top-0">
                <tr>
                  <th className="text-left p-2 pl-4">Filial</th>
                  <th className="text-left p-2">Conta</th>
                  <th className="text-right p-2">Mov.</th>
                  <th className="text-right p-2">Conc.</th>
                  <th className="text-right p-2">Pend.</th>
                  <th className="text-center p-2 w-[160px]">% Conciliação</th>
                  <th className="text-right p-2">Vl. Pendente</th>
                  <th className="text-center p-2" title="0-30 dias">0-30</th>
                  <th className="text-center p-2" title="31-60 dias">31-60</th>
                  <th className="text-center p-2" title="61-90 dias">61-90</th>
                  <th className="text-center p-2" title="acima de 90 dias">90+</th>
                  <th className="text-center p-2 pr-4">Status</th>
                </tr>
              </thead>
              <tbody>
                {linhasFiltradas.map((l, i) => {
                  const st = statusByPct(l.pct_conc);
                  const temPend = l.qt_pend > 0;
                  return (
                    <tr key={i}
                        className={`border-t border-ink-700 hover:bg-ink-800/40 ${temPend ? 'cursor-pointer' : ''}`}
                        onClick={temPend ? () => abrirPendentes(l) : undefined}
                        title={temPend ? 'Clique para ver os lançamentos pendentes de conciliar' : ''}>
                      <td className="p-2 pl-4 text-gray-300 text-xs">
                        <span className="text-gray-500 font-mono">{l.fil_id}</span> — {(l.fil_nome||'').slice(0, 35)}
                      </td>
                      <td className="p-2">
                        <div className="flex flex-col">
                          <span className="text-gray-200">{l.agn_nome}</span>
                          <span className="text-xs text-gray-500 font-mono">cód. {l.agn_id}</span>
                        </div>
                      </td>
                      <td className="p-2 text-right font-mono">{fmtN(l.qt_mov)}</td>
                      <td className="p-2 text-right font-mono text-emerald-400">{fmtN(l.qt_conc)}</td>
                      <td className="p-2 text-right font-mono">
                        {temPend
                          ? <span className="inline-flex items-center gap-1 text-amber-400 underline decoration-dotted underline-offset-2">
                              <ListChecks size={12} /> {fmtN(l.qt_pend)}
                            </span>
                          : <span className="text-gray-500">0</span>}
                      </td>
                      <td className="p-2">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-ink-700 rounded overflow-hidden">
                            <div className={`h-full transition-all
                                ${l.pct_conc >= 80 ? 'bg-emerald-500' : l.pct_conc >= 50 ? 'bg-amber-500' : 'bg-rose-500'}`}
                                style={{ width: `${l.pct_conc}%` }} />
                          </div>
                          <span className="text-xs font-mono text-gray-300 w-12 text-right">{l.pct_conc}%</span>
                        </div>
                      </td>
                      <td className={`p-2 text-right font-mono font-semibold ${l.vl_pend < 0 ? 'text-rose-400' : 'text-prim-400'}`}>
                        {fmt(l.vl_pend)}
                      </td>
                      <td className="p-2 text-center font-mono text-xs">{l.aging.d0_30 || ''}</td>
                      <td className="p-2 text-center font-mono text-xs text-amber-400">{l.aging.d31_60 || ''}</td>
                      <td className="p-2 text-center font-mono text-xs text-orange-400">{l.aging.d61_90 || ''}</td>
                      <td className="p-2 text-center font-mono text-xs">
                        {l.aging.d90p > 0
                          ? <span className="text-rose-400 font-bold">{l.aging.d90p}</span>
                          : ''}
                      </td>
                      <td className="p-2 pr-4 text-center">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${st.classes}`}>{st.label}</span>
                      </td>
                    </tr>
                  );
                })}
                {linhasFiltradas.length === 0 && (
                  <tr><td colSpan={12} className="p-8 text-center text-gray-500">Nenhuma conta no filtro selecionado.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* [01/07/2026] Modal: lançamentos pendentes de conciliar da conta clicada */}
      {modalConta && (
        <ModalPendentes
          conta={modalConta} resp={modalResp} busy={modalBusy} erro={modalErr}
          busca={modalBusca} setBusca={setModalBusca}
          dataIni={dataIni} dataFim={dataFim} onClose={fecharModal} />
      )}
    </div>
  );
}

// Tag do tipo de contraparte
function CpTag({ tipo }) {
  const map = {
    CLIENTE:    'bg-prim-700/30 text-prim-300',
    FORNECEDOR: 'bg-amber-700/30 text-amber-300',
    CONTA:      'bg-sky-700/30 text-sky-300',
    OUTROS:     'bg-ink-700 text-gray-400'
  };
  const cls = map[tipo] || map.OUTROS;
  const lbl = tipo === 'CLIENTE' ? 'Cliente' : tipo === 'FORNECEDOR' ? 'Fornec.'
            : tipo === 'CONTA' ? 'Conta' : 'Outros';
  return <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold shrink-0 ${cls}`}>{lbl}</span>;
}

function ModalPendentes({ conta, resp, busy, erro, busca, setBusca, dataIni, dataFim, onClose }) {
  // ESC fecha
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const linhas = useMemo(() => {
    const arr = resp?.lancamentos || [];
    if (!busca.trim()) return arr;
    const q = busca.toLowerCase();
    return arr.filter(l =>
      (l.documento || '').toLowerCase().includes(q) ||
      (l.historico || '').toLowerCase().includes(q) ||
      (l.cp_nome || '').toLowerCase().includes(q) ||
      String(l.cp_id || '').includes(q) ||
      (l.tpd || '').toLowerCase().includes(q) ||
      String(l.fil_id).includes(q)
    );
  }, [resp, busca]);

  const somaFiltro = useMemo(() => linhas.reduce((s, l) => s + l.valor, 0), [linhas]);

  function exportXlsx() {
    const dados = linhas.map(l => ({
      Filial:      `${l.fil_id} - ${l.fil_nome || ''}`,
      Vencimento:  fmtBr(l.vencto),
      'Dt. Documento': fmtBr(l.docto),
      'Agente banco': `${l.agn_banco_id} - ${l.agn_banco_nome || ''}`,
      'Contraparte (tipo)': l.cp_tipo || '',
      'Cliente/Fornecedor': l.cp_id ? `${l.cp_id} - ${l.cp_nome || ''}` : '',
      Tipo:        l.tpd,
      Documento:   l.documento,
      Histórico:   l.historico,
      Débito:      l.deb,
      Crédito:     l.cre,
      Valor:       l.valor
    }));
    const ws = XLSX.utils.json_to_sheet(dados);
    ws['!cols'] = [ {wch:30},{wch:12},{wch:12},{wch:40},{wch:12},{wch:44},{wch:10},{wch:16},{wch:50},{wch:14},{wch:14},{wch:14} ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Pendentes');
    XLSX.writeFile(wb, `pendentes-conc-${conta.agn_id}-fil${conta.fil_id}.xlsx`);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
         onClick={onClose}>
      <div className="card w-full max-w-5xl max-h-[88vh] flex flex-col overflow-hidden"
           onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="bg-ink-900 px-4 py-3 border-b border-ink-700 flex items-start gap-3">
          <ListChecks size={18} className="text-amber-400 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-gray-100 truncate">{conta.agn_nome}</div>
            <div className="text-xs text-gray-500">
              cód. {conta.agn_id} · filial <span className="font-mono">{conta.fil_id}</span> {conta.fil_nome ? `— ${conta.fil_nome}` : ''}
              {' · '}pendentes de conciliar · {fmtBr(dataIni)} a {fmtBr(dataFim)}
            </div>
          </div>
          <button className="text-gray-400 hover:text-white p-1" onClick={onClose} title="Fechar (Esc)">
            <X size={18} />
          </button>
        </div>

        {/* Toolbar */}
        <div className="px-4 py-2 bg-ink-900/50 border-b border-ink-700 flex flex-wrap items-center gap-3 text-xs">
          <div className="flex items-center gap-2 bg-ink-800 px-2 rounded">
            <Search size={13} className="text-gray-500" />
            <input className="bg-transparent outline-none py-1 w-64"
                   placeholder="Buscar por documento, histórico, tipo..."
                   value={busca} onChange={e => setBusca(e.target.value)} />
          </div>
          <span className="text-gray-400">{fmtN(linhas.length)} lançamento(s)</span>
          <span className="text-gray-400">Soma (déb-créd): <span className={`font-mono ${somaFiltro < 0 ? 'text-rose-300' : 'text-prim-300'}`}>{fmt(somaFiltro)}</span></span>
          {resp?.total?.truncado && (
            <span className="text-amber-400">⚠ lista truncada em {fmtN(resp.filtro.limit)} linhas</span>
          )}
          <button className="btn-ghost ml-auto py-1" onClick={exportXlsx} disabled={linhas.length === 0}>
            <FileSpreadsheet size={14} /> Excel
          </button>
        </div>

        {erro && <div className="m-3 bg-red-900/40 text-red-200 text-sm rounded p-3">{erro}</div>}

        {/* Lista */}
        <div className="overflow-auto flex-1">
          <table className="w-full text-sm">
            <thead className="bg-ink-900/70 text-gray-400 uppercase text-xs sticky top-0">
              <tr>
                <th className="text-left p-2 pl-4">Vencimento</th>
                <th className="text-center p-2">Filial</th>
                <th className="text-left p-2">Cliente / Fornecedor</th>
                <th className="text-left p-2">Tipo</th>
                <th className="text-left p-2">Documento</th>
                <th className="text-left p-2">Histórico</th>
                <th className="text-right p-2 pr-4">Valor</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l, i) => (
                <tr key={i} className="border-t border-ink-700 hover:bg-ink-800/40">
                  <td className="p-2 pl-4 text-gray-300 font-mono text-xs">{fmtBr(l.vencto)}</td>
                  <td className="p-2 text-center font-mono text-xs text-gray-400">{l.fil_id}</td>
                  <td className="p-2 text-xs">
                    {l.cp_id ? (
                      <div className="flex items-center gap-1.5">
                        <CpTag tipo={l.cp_tipo} />
                        <span className="text-gray-200">{l.cp_nome}</span>
                        <span className="text-gray-500 font-mono">({l.cp_id})</span>
                      </div>
                    ) : <span className="text-gray-600">—</span>}
                  </td>
                  <td className="p-2 text-xs text-gray-400">{l.tpd}</td>
                  <td className="p-2 font-mono text-xs text-gray-300">{l.documento}</td>
                  <td className="p-2 text-xs text-gray-300">{l.historico}</td>
                  <td className={`p-2 pr-4 text-right font-mono font-semibold ${l.valor < 0 ? 'text-rose-400' : 'text-prim-400'}`}>
                    {fmt(l.valor)}
                  </td>
                </tr>
              ))}
              {!busy && linhas.length === 0 && (
                <tr><td colSpan={7} className="p-8 text-center text-gray-500">
                  {resp ? 'Nenhum lançamento pendente no filtro.' : ''}
                </td></tr>
              )}
              {busy && (
                <tr><td colSpan={7} className="p-8 text-center text-gray-500">Carregando lançamentos...</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ icon, label, value, sub, color = 'prim' }) {
  const map = {
    prim: { border:'border-prim-500', text:'text-prim-400' },
    acc:  { border:'border-acc-500',  text:'text-acc-500'  },
    rose: { border:'border-rose-500', text:'text-rose-400' }
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
