import React, { useEffect, useState, useMemo } from 'react';
import { Filter, Wallet, Banknote, FileSpreadsheet, FileText, X, Calendar } from 'lucide-react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { api } from '../api/client';
import SearchableSelect from '../components/SearchableSelect';

const fmt = v => Number(v||0).toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
const isoToday = () => new Date().toISOString().slice(0,10);
const fmtBr = iso => iso ? iso.split('-').reverse().join('/') : '';
// [07/05/2026 - Alexandre Carvalho] Inicio operacional do GFIN (saldo lancado em 30/04/2026).
// Nenhuma tela mostra dados antes dessa data; o saldo anterior reflete o lancamento.
const GFIN_DT_INICIO = '2026-05-01';

export default function SaldosBanco() {
  const [data,    setData]    = useState(isoToday());
  const [fil,     setFil]     = useState(0);
  const [agn,     setAgn]     = useState(0);
  const [filiais, setFiliais] = useState([]);
  const [contas,  setContas]  = useState([]);
  const [resp,    setResp]    = useState(null);
  const [busy,    setBusy]    = useState(false);
  const [err,     setErr]     = useState('');
  const [det,     setDet]     = useState(null);  // { conta }

  useEffect(() => {
    api.saldosBancoFiliais().then(setFiliais).catch(()=>{});
    api.saldosBancoContas().then(setContas).catch(()=>{});
  }, []);

  async function consultar() {
    setBusy(true); setErr('');
    try {
      const r = await api.saldosBanco(data, fil, agn);
      setResp(r);
    } catch (e) {
      setErr(e.message || 'Erro ao consultar saldos');
      setResp(null);
    } finally { setBusy(false); }
  }
  useEffect(() => { consultar(); /* primeira carga */ }, []); // eslint-disable-line

  // [07/05/2026 - Alexandre Carvalho] V2: lista plana por conta (sem agrupamento por organizacao).
  const linhasOrdenadas = useMemo(() => {
    if (!resp) return [];
    return [...resp.linhas].sort((a, b) => a.agn_id - b.agn_id);
  }, [resp]);

  function exportXlsx() {
    if (!resp) return;
    const linhas = linhasOrdenadas.map(l => ({
      Código:    l.agn_id,
      Conta:     l.agn_nome,
      Entradas:  l.entradas,
      Saídas:    l.saidas,
      Saldo:     l.saldo
    }));
    linhas.push({ Código: '', Conta: 'TOTAL CONSOLIDADO',
                  Entradas: linhasOrdenadas.reduce((s,r)=>s+r.entradas,0),
                  Saídas:   linhasOrdenadas.reduce((s,r)=>s+r.saidas,0),
                  Saldo:    resp.total.saldo });
    const ws = XLSX.utils.json_to_sheet(linhas);
    ws['!cols'] = [ {wch:8}, {wch:50}, {wch:18}, {wch:18}, {wch:18} ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Saldos Bancários');
    XLSX.writeFile(wb, `saldos-bancarios-${data}.xlsx`);
  }

  function exportPdf() {
    if (!resp) return;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    doc.setFontSize(14);
    doc.text(`Saldos Bancários - ${fmtBr(data)}`, 40, 36);
    doc.setFontSize(10);
    doc.text(`Saldo total consolidado: ${fmt(resp.total.saldo)}   |   ${resp.total.quantidade} contas`, 40, 52);
    autoTable(doc, {
      startY: 70,
      head: [['Cód.', 'Conta', 'Entradas', 'Saídas', 'Saldo']],
      body: linhasOrdenadas.map(l => [
        l.agn_id, l.agn_nome, fmt(l.entradas), fmt(l.saidas), fmt(l.saldo)
      ]),
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [16, 185, 129] },
      columnStyles: { 2:{halign:'right'}, 3:{halign:'right'}, 4:{halign:'right',fontStyle:'bold'} },
      foot: [[
        '', 'TOTAL',
        fmt(linhasOrdenadas.reduce((s,r)=>s+r.entradas,0)),
        fmt(linhasOrdenadas.reduce((s,r)=>s+r.saidas,0)),
        fmt(resp.total.saldo)
      ]],
      footStyles: { fillColor: [21, 32, 58], textColor: 240, fontStyle: 'bold' }
    });
    doc.save(`saldos-bancarios-${data}.pdf`);
  }

  return (
    <div className="p-6 space-y-6">
      <div className="card p-4 flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-2 text-prim-400 font-semibold">
          <Filter size={18} /> Filtros
        </div>
        <label className="block">
          <span className="text-xs text-gray-300">Saldo na data</span>
          <input type="date" className="input mt-1" value={data} onChange={e=>setData(e.target.value)} />
        </label>
        <label className="block min-w-[240px]">
          <span className="text-xs text-gray-300">Filial</span>
          <select className="input mt-1" value={fil} onChange={e=>setFil(Number(e.target.value))}>
            <option value={0}>(Todas)</option>
            {filiais.map(f => <option key={f.id} value={f.id}>{f.id} - {f.nome}</option>)}
          </select>
        </label>
        {/* [08/05/2026 - ALTERADO POR Alexandre Carvalho] Trocado <select> por busca dinamica
            (lista grande - 110 contas - escolha por digito e mais rapida) */}
        <label className="block min-w-[320px]">
          <span className="text-xs text-gray-300">Conta financeira</span>
          <SearchableSelect
            value={agn}
            onChange={setAgn}
            options={contas}
            placeholder="Digite codigo ou nome..."
            allLabel="(Todas)"
          />
        </label>
        <button className="btn-prim" onClick={consultar} disabled={busy}>
          {busy ? 'Consultando...' : 'Consultar'}
        </button>
        <div className="flex-1" />
        <button className="btn-ghost" onClick={exportXlsx} disabled={!resp} title="Exportar Excel">
          <FileSpreadsheet size={16} /> Excel
        </button>
        <button className="btn-ghost" onClick={exportPdf} disabled={!resp} title="Exportar PDF">
          <FileText size={16} /> PDF
        </button>
      </div>

      {err && <div className="bg-red-900/40 text-red-200 text-sm rounded p-3">{err}</div>}

      {resp && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="kpi border-l-4 border-prim-500">
            <div className="kpi-label flex items-center gap-1"><Wallet size={14} /> Saldo total consolidado</div>
            <div className={`kpi-value ${resp.total.saldo >= 0 ? 'text-prim-400' : 'text-rose-400'}`}>
              {fmt(resp.total.saldo)}
            </div>
          </div>
          <div className="kpi border-l-4 border-acc-500">
            <div className="kpi-label flex items-center gap-1"><Banknote size={14} /> Quantidade de contas</div>
            <div className="kpi-value text-acc-500">{resp.total.quantidade}</div>
          </div>
        </div>
      )}

      {/* [07/05/2026 - Alexandre Carvalho] V2: tabela unica sem agrupamento por organizacao */}
      {resp && linhasOrdenadas.length > 0 && (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-ink-900/70 text-gray-400 uppercase text-xs">
              <tr>
                <th className="text-left p-3 w-24">Código</th>
                <th className="text-left p-3">Conta</th>
                <th className="text-right p-3">Entradas</th>
                <th className="text-right p-3">Saídas</th>
                <th className="text-right p-3">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {linhasOrdenadas.map((c, i) => (
                <tr key={i}
                    className="border-t border-ink-700 hover:bg-ink-700/40 cursor-pointer"
                    onClick={() => setDet({ conta: c })}
                    title="Clique para ver o extrato">
                  <td className="p-3 text-gray-400">{c.agn_id}</td>
                  <td className="p-3">{c.agn_nome}</td>
                  <td className="p-3 text-right text-emerald-400">{fmt(c.entradas)}</td>
                  <td className="p-3 text-right text-rose-400">{fmt(c.saidas)}</td>
                  <td className={`p-3 text-right font-semibold ${c.saldo >= 0 ? 'text-prim-400' : 'text-acc-500'}`}>
                    {fmt(c.saldo)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {resp && linhasOrdenadas.length === 0 && (
        <div className="card p-8 text-center text-gray-500">Sem saldos nas contas para os filtros selecionados.</div>
      )}

      {det && <ModalExtrato conta={det.conta} dataRef={data} onClose={() => setDet(null)} />}
    </div>
  );
}

// ==================== EXTRATO DA CONTA ====================
function ModalExtrato({ conta, dataRef, onClose }) {
  // [07/05/2026 - Alexandre Carvalho] Default 01/05/2026: saldo anterior reflete lancamento de 30/04
  const [dataIni, setDataIni] = useState(GFIN_DT_INICIO);
  const [dataFim, setDataFim] = useState(dataRef || isoToday());
  const [ext,     setExt]     = useState(null);  // { saldo_anterior, saldo_final, total, lancamentos }
  const [busy,    setBusy]    = useState(false);
  const [err,     setErr]     = useState('');

  async function buscar() {
    setBusy(true); setErr('');
    try {
      // [07/05/2026 - Alexandre Carvalho] V2: passa fil=0 pra trazer todas as filiais (extrato completo)
      const r = await api.saldosBancoLancamentos(conta.agn_id, 0, dataIni, dataFim);
      setExt(r);
    } catch (e) {
      setErr(e.message || 'Erro ao carregar extrato');
      setExt(null);
    } finally { setBusy(false); }
  }
  useEffect(() => { buscar(); }, []); // eslint-disable-line

  // [07/05/2026] Agrupa lancamentos por filial (preserva running balance global)
  const grupos = useMemo(() => {
    if (!ext) return [];
    const m = new Map();
    for (const l of ext.lancamentos) {
      const k = l.fil_id;
      if (!m.has(k)) m.set(k, {
        fil_id: l.fil_id, fil_nome: l.fil_nome,
        lancamentos: [], total_ent: 0, total_sai: 0, total_conc: 0
      });
      const g = m.get(k);
      g.lancamentos.push(l);
      g.total_ent += l.entrada;
      g.total_sai += l.saida;
      if (l.conciliado === 'S') g.total_conc += 1;
    }
    return Array.from(m.values()).sort((a, b) => a.fil_id - b.fil_id);
  }, [ext]);

  // ESC fecha; click fora fecha
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function exportXlsx() {
    if (!ext) return;
    const lancs = ext.lancamentos;
    const linhas = [];
    linhas.push({ Filial:'', FilNome:'', Data:'', Documento:'', Lançamento:'', Histórico:`SALDO ANTERIOR EM ${fmtBr(toDateMinus1(dataIni))}`, Complemento:'', Entrada:'', Saída:'', Saldo: ext.saldo_anterior, Conciliado:'' });
    for (const l of lancs) {
      linhas.push({
        Filial:      l.fil_id,
        FilNome:     l.fil_nome,
        Data:        fmtBr(l.dt_vencto),
        Documento:   fmtBr(l.dt_docto),
        Lançamento:  l.mov_numero,
        Histórico:   l.his_desc || '',
        Complemento: l.compl,
        Entrada:     l.entrada,
        Saída:       l.saida,
        Saldo:       l.saldo,
        Conciliado:  l.conciliado === 'S' ? 'Sim' : 'Não'
      });
    }
    linhas.push({ Filial:'', FilNome:'', Data:'', Documento:'', Lançamento:'', Histórico:`SALDO FINAL EM ${fmtBr(dataFim)}`, Complemento:'', Entrada: ext.total.entradas, Saída: ext.total.saidas, Saldo: ext.saldo_final, Conciliado:'' });
    const ws = XLSX.utils.json_to_sheet(linhas);
    ws['!cols'] = [ {wch:6},{wch:30},{wch:11},{wch:11},{wch:10},{wch:30},{wch:40},{wch:14},{wch:14},{wch:16},{wch:11} ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Extrato ${conta.agn_id}`);
    XLSX.writeFile(wb, `extrato-${conta.agn_id}-${dataIni}_${dataFim}.xlsx`);
  }

  function exportPdf() {
    if (!ext) return;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    let y = 36;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
    doc.text('EXTRATO BANCÁRIO', 40, y); y += 18;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text(`Conta:  ${conta.agn_id} — ${conta.agn_nome}`, 40, y); y += 12;
    doc.text(`Período: ${fmtBr(dataIni)} a ${fmtBr(dataFim)}   |   ${grupos.length} ${grupos.length === 1 ? 'filial' : 'filiais'}`, 40, y); y += 16;

    // Body com separadores de filial
    const body = [
      ['', '', '', '', { content: `SALDO ANTERIOR EM ${fmtBr(toDateMinus1(dataIni))}`, styles:{fontStyle:'italic'} }, '', '', '', { content: fmt(ext.saldo_anterior), styles:{halign:'right',fontStyle:'bold'} }, '']
    ];
    for (const g of grupos) {
      body.push([{
        content: `FILIAL ${g.fil_id} — ${g.fil_nome}   ·   ${g.lancamentos.length} lançtos · ${g.total_conc} conc · Δ ${fmt(g.total_ent - g.total_sai)}`,
        colSpan: 10,
        styles: { fillColor: [30, 41, 59], textColor: 200, fontStyle: 'bold', halign: 'left' }
      }]);
      for (const l of g.lancamentos) {
        body.push([
          l.fil_id,
          fmtBr(l.dt_vencto), fmtBr(l.dt_docto), l.mov_numero,
          l.his_desc || '', (l.compl || '').slice(0, 60),
          l.entrada ? fmt(l.entrada) : '',
          l.saida   ? fmt(l.saida)   : '',
          fmt(l.saldo),
          l.conciliado === 'S' ? 'Sim' : 'Não'
        ]);
      }
    }

    autoTable(doc, {
      startY: y,
      head: [['Fil', 'Data', 'Doc.', 'Lançto', 'Histórico', 'Complemento', 'Entrada', 'Saída', 'Saldo', 'Conc.']],
      body,
      foot: [[
        '', '', '', '',
        { content:`SALDO FINAL EM ${fmtBr(dataFim)}`, styles:{fontStyle:'bold'} },
        '',
        { content: fmt(ext.total.entradas), styles:{halign:'right'} },
        { content: fmt(ext.total.saidas),   styles:{halign:'right'} },
        { content: fmt(ext.saldo_final),    styles:{halign:'right',fontStyle:'bold'} },
        ''
      ]],
      styles: { fontSize: 7, cellPadding: 2 },
      headStyles: { fillColor: [16, 185, 129] },
      footStyles: { fillColor: [21, 32, 58], textColor: 240 },
      columnStyles: { 6:{halign:'right'}, 7:{halign:'right'}, 8:{halign:'right'}, 9:{halign:'center'} }
    });
    doc.save(`extrato-${conta.agn_id}-${dataIni}_${dataFim}.pdf`);
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/80 flex items-start justify-center p-4 overflow-auto" onClick={onClose}>
      <div className="bg-ink-900 border border-ink-700 rounded-xl shadow-2xl w-full max-w-7xl mt-6 mb-6"
           onClick={e => e.stopPropagation()}>

        {/* Header — estilo extrato bancário */}
        <div className="bg-gradient-to-r from-ink-800 to-ink-900 px-6 py-4 border-b border-ink-700 rounded-t-xl">
          <div className="flex items-start gap-4">
            <div className="bg-prim-600/20 p-3 rounded-lg">
              <Banknote size={26} className="text-prim-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] uppercase tracking-widest text-gray-500">Extrato bancário</div>
              <div className="text-lg font-semibold text-white truncate">{conta.agn_nome}</div>
              <div className="text-sm text-gray-400 truncate">
                Conta <span className="text-gray-200 font-mono">{conta.agn_id}</span>
                {ext && grupos.length > 0 && (
                  <> {' · '}
                    <span className="text-gray-200">{grupos.length}</span> {grupos.length === 1 ? 'filial' : 'filiais'}
                  </>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button className="btn-ghost px-2" onClick={exportXlsx} disabled={!ext} title="Excel">
                <FileSpreadsheet size={16} />
              </button>
              <button className="btn-ghost px-2" onClick={exportPdf} disabled={!ext} title="PDF">
                <FileText size={16} />
              </button>
              <button className="btn-ghost px-2" onClick={onClose} title="Fechar (Esc)">
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Filtros de período */}
          <div className="flex flex-wrap items-end gap-3 mt-4 pt-3 border-t border-ink-700/60">
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <Calendar size={14} /> Período:
            </div>
            <input type="date" className="input !py-1 !px-2 !text-sm w-36" value={dataIni}
                   onChange={e=>setDataIni(e.target.value)} />
            <span className="text-gray-500 text-sm">até</span>
            <input type="date" className="input !py-1 !px-2 !text-sm w-36" value={dataFim}
                   onChange={e=>setDataFim(e.target.value)} />
            <button className="btn-prim !py-1 !px-3 !text-sm" onClick={buscar} disabled={busy}>
              {busy ? 'Buscando...' : 'Filtrar'}
            </button>
            <div className="flex-1" />
            {ext && (
              <div className="text-xs text-gray-400 flex gap-3">
                <span>{ext.total.count} lançtos</span>
                <span>· {ext.total.conciliados} conciliados</span>
                <span>· {ext.total.pendentes} pendentes</span>
              </div>
            )}
          </div>
        </div>

        {/* Saldo anterior */}
        {ext && (
          <div className="px-6 py-3 bg-ink-800/40 border-b border-ink-700 flex justify-between items-center">
            <span className="text-sm text-gray-400 italic">
              Saldo anterior em <span className="text-gray-200 font-medium">{fmtBr(toDateMinus1(dataIni))}</span>
            </span>
            <span className={`text-base font-bold font-mono ${ext.saldo_anterior >= 0 ? 'text-prim-400' : 'text-rose-400'}`}>
              {fmt(ext.saldo_anterior)}
            </span>
          </div>
        )}

        {/* Erro / loading */}
        {busy && <div className="p-12 text-center text-gray-400">Carregando extrato...</div>}
        {err  && <div className="p-4 bg-red-900/40 text-red-200 text-sm m-4 rounded">{err}</div>}

        {/* Tabela do extrato — agrupada por filial */}
        {ext && (
          <div className="overflow-auto max-h-[60vh]">
            {grupos.length === 0 && (
              <div className="p-12 text-center text-gray-500">Nenhum lançamento no período.</div>
            )}
            {grupos.map(g => (
              <div key={g.fil_id} className="border-b-2 border-ink-700">
                {/* Header da filial */}
                <div className="bg-ink-800/70 px-6 py-2 flex items-center gap-3 border-b border-ink-700 sticky top-0 z-10">
                  <span className="text-[10px] uppercase tracking-widest text-gray-500">Filial</span>
                  <span className="text-sm font-semibold text-prim-300 font-mono">{g.fil_id}</span>
                  <span className="text-sm text-gray-300 truncate flex-1">{g.fil_nome}</span>
                  <span className="text-xs text-gray-400">
                    {g.lancamentos.length} lançtos · {g.total_conc} conciliados
                  </span>
                  <span className="text-xs text-emerald-400 font-mono">+ {fmt(g.total_ent)}</span>
                  <span className="text-xs text-rose-400 font-mono">− {fmt(g.total_sai)}</span>
                  <span className={`text-sm font-bold font-mono ${(g.total_ent - g.total_sai) >= 0 ? 'text-prim-300' : 'text-acc-400'}`}>
                    Δ {fmt(g.total_ent - g.total_sai)}
                  </span>
                </div>

                <table className="w-full text-xs font-mono">
                  <thead className="bg-ink-900/70 text-gray-500 uppercase border-b border-ink-700/50">
                    <tr>
                      <th className="text-left p-2 pl-6 w-[88px]">Data</th>
                      <th className="text-left p-2 w-[88px]">Doc.</th>
                      <th className="text-right p-2 w-[80px]">Lançto</th>
                      <th className="text-left p-2">Histórico</th>
                      <th className="text-left p-2">Complemento</th>
                      <th className="text-right p-2 w-[110px]">Entrada</th>
                      <th className="text-right p-2 w-[110px]">Saída</th>
                      <th className="text-right p-2 w-[130px]">Saldo</th>
                      <th className="text-center p-2 pr-6 w-[60px]">Conc.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.lancamentos.map((l, i) => (
                      <tr key={i} className="border-b border-ink-800 hover:bg-ink-800/40 leading-relaxed">
                        <td className="p-2 pl-6 text-gray-200">{fmtBr(l.dt_vencto)}</td>
                        <td className="p-2 text-gray-500">{fmtBr(l.dt_docto)}</td>
                        <td className="p-2 text-right text-gray-500">{l.mov_numero}</td>
                        <td className="p-2 text-gray-300 font-sans">{l.his_desc || <span className="text-gray-600">—</span>}</td>
                        <td className="p-2 text-gray-300 font-sans">{l.compl}</td>
                        <td className="p-2 text-right text-emerald-400">{l.entrada ? fmt(l.entrada) : ''}</td>
                        <td className="p-2 text-right text-rose-400">{l.saida ? fmt(l.saida) : ''}</td>
                        <td className={`p-2 text-right font-semibold ${l.saldo >= 0 ? 'text-prim-300' : 'text-acc-400'}`}>
                          {fmt(l.saldo)}
                        </td>
                        <td className="p-2 pr-6 text-center">
                          {l.conciliado === 'S'
                            ? <span className="px-1.5 py-0.5 rounded bg-emerald-700/30 text-emerald-300 text-[9px] font-semibold font-sans">SIM</span>
                            : <span className="px-1.5 py-0.5 rounded bg-amber-700/30 text-amber-300 text-[9px] font-semibold font-sans">NÃO</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}

        {/* Saldo final + totais */}
        {ext && (
          <div className="bg-ink-900 border-t-2 border-prim-600/40 rounded-b-xl">
            <div className="px-6 py-4 flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-wider text-gray-500">
                  Saldo final em {fmtBr(dataFim)}
                </div>
                <div className={`text-2xl font-bold font-mono ${ext.saldo_final >= 0 ? 'text-prim-400' : 'text-rose-400'}`}>
                  {fmt(ext.saldo_final)}
                </div>
              </div>
              <div className="flex gap-6 text-right">
                <div>
                  <div className="text-xs uppercase tracking-wider text-gray-500">Total entradas</div>
                  <div className="text-base font-mono text-emerald-400">{fmt(ext.total.entradas)}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wider text-gray-500">Total saídas</div>
                  <div className="text-base font-mono text-rose-400">{fmt(ext.total.saidas)}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wider text-gray-500">Diferença</div>
                  <div className={`text-base font-mono ${(ext.total.entradas-ext.total.saidas) >= 0 ? 'text-prim-400' : 'text-acc-500'}`}>
                    {fmt(ext.total.entradas - ext.total.saidas)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// data ISO YYYY-MM-DD - 1 dia
function toDateMinus1(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}
