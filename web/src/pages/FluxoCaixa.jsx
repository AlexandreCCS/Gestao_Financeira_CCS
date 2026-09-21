import React, { useEffect, useMemo, useState } from 'react';
import {
  Filter, Settings, Beaker, Calendar, FileSpreadsheet, FileText, X,
  TrendingUp, TrendingDown, Wallet, Plus, Trash2, ChevronDown, Search
} from 'lucide-react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { api } from '../api/client';

const fmt   = v => Number(v||0).toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
const fmtN  = v => Number(v||0).toLocaleString('pt-BR');
const fmtBr = iso => iso ? iso.split('-').reverse().join('/') : '';
const isoToday = () => new Date().toISOString().slice(0,10);
const isoPlusDays = (n) => {
  const d = new Date(); d.setDate(d.getDate() + n);
  return d.toISOString().slice(0,10);
};

const CATEGORIAS = [
  { k:'CR_REALIZADO', label:'Recebimentos realizados', tipo:'in',  cls:'text-emerald-300' },
  { k:'CR_PREVISTO',  label:'Recebimentos previstos',  tipo:'in',  cls:'text-emerald-400/80' },
  { k:'ADIANT_C',     label:'Adiantamentos (entrada)', tipo:'in',  cls:'text-emerald-200' },
  { k:'CP_REALIZADO', label:'Pagamentos realizados',   tipo:'out', cls:'text-rose-300' },
  { k:'CP_PREVISTO',  label:'Pagamentos previstos',    tipo:'out', cls:'text-rose-400/80' },
  { k:'ADIANT_D',     label:'Adiantamentos (saída)',   tipo:'out', cls:'text-rose-200' },
  { k:'SIMULACAO',    label:'Simulações',              tipo:'sim', cls:'text-violet-300' }
];

export default function FluxoCaixa() {
  const [dataIni, setDataIni] = useState(isoToday());
  const [dataFim, setDataFim] = useState(isoPlusDays(60));
  const [filiais, setFiliais] = useState([]);             // chips selecionados
  const [filiaisOpcoes, setFiliaisOpcoes] = useState([]);  // todas disponíveis
  const [incluiSim,  setIncluiSim]  = useState(true);
  const [incluiPrev, setIncluiPrev] = useState(false);     // [06/05/2026] PDV/PREVPDC default OFF
  const [resp, setResp] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState('');

  // modais
  const [showConfig, setShowConfig] = useState(false);
  const [showSim,    setShowSim]    = useState(false);
  const [docsModal,  setDocsModal]  = useState(null);  // { data, tipo, filiais }

  useEffect(() => { api.saldosBancoFiliais().then(setFiliaisOpcoes).catch(()=>{}); }, []);

  async function consultar() {
    setBusy(true); setErr('');
    try {
      const filsParam = filiais.length === 0 ? '0' : filiais.join(',');
      const r = await api.fluxoPrevio(dataIni, dataFim, filsParam, incluiSim ? 'S':'N', incluiPrev ? 'S':'N');
      setResp(r);
    } catch (e) {
      setErr(e.message || 'Erro ao consultar fluxo'); setResp(null);
    } finally { setBusy(false); }
  }
  useEffect(() => { consultar(); }, []); // eslint-disable-line

  function toggleFil(id) {
    setFiliais(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  }

  function exportXlsx() {
    if (!resp) return;
    const linhas = [];
    linhas.push({ Data:'', Categoria:'SALDO INICIAL', Entrada:'', Saída:'', Líquido:'', Saldo: resp.saldo_inicial });
    for (const d of resp.dias) {
      for (const cat of CATEGORIAS) {
        const v = d.detalhes[cat.k];
        if (!v || (v.ent === 0 && v.sai === 0)) continue;
        linhas.push({
          Data: fmtBr(d.dt), Categoria: cat.label,
          Entrada: v.ent, Saída: v.sai, Líquido: v.ent - v.sai, Saldo: ''
        });
      }
      linhas.push({
        Data: fmtBr(d.dt), Categoria: '** TOTAL DO DIA **',
        Entrada: d.entrada, Saída: d.saida, Líquido: d.liquido, Saldo: d.saldo_acum
      });
    }
    linhas.push({ Data:'', Categoria:'SALDO FINAL', Entrada:'', Saída:'', Líquido:'', Saldo: resp.saldo_final });
    const ws = XLSX.utils.json_to_sheet(linhas);
    ws['!cols'] = [ {wch:11},{wch:32},{wch:14},{wch:14},{wch:14},{wch:16} ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Fluxo de Caixa');
    XLSX.writeFile(wb, `fluxo-caixa-${dataIni}_${dataFim}.xlsx`);
  }

  function exportPdf() {
    if (!resp) return;
    const doc = new jsPDF({ orientation:'landscape', unit:'pt', format:'a4' });
    let y = 32;
    doc.setFont('helvetica','bold'); doc.setFontSize(13);
    doc.text('Fluxo de Caixa Previsional', 40, y); y += 14;
    doc.setFontSize(9); doc.setFont('helvetica','normal');
    doc.text(`Período: ${fmtBr(dataIni)} a ${fmtBr(dataFim)}    |    Filiais: ${filiais.length === 0 ? 'Todas' : filiais.join(', ')}`, 40, y); y += 12;
    doc.text(`Saldo inicial: ${fmt(resp.saldo_inicial)}    |    Saldo final: ${fmt(resp.saldo_final)}`, 40, y); y += 6;

    autoTable(doc, {
      startY: y + 8,
      head: [['Data','Recebto','Adto+','Pagto','Adto-','Simulação','Líquido','Saldo Acum.']],
      body: resp.dias.map(d => [
        fmtBr(d.dt),
        fmt((d.detalhes.CR_REALIZADO?.ent || 0) + (d.detalhes.CR_PREVISTO?.ent || 0)),
        fmt(d.detalhes.ADIANT_C?.ent || 0),
        fmt((d.detalhes.CP_REALIZADO?.sai || 0) + (d.detalhes.CP_PREVISTO?.sai || 0)),
        fmt(d.detalhes.ADIANT_D?.sai || 0),
        fmt((d.detalhes.SIMULACAO?.ent || 0) - (d.detalhes.SIMULACAO?.sai || 0)),
        fmt(d.liquido),
        fmt(d.saldo_acum)
      ]),
      foot: [['', '', '', '', '', 'Saldo final →', '', fmt(resp.saldo_final)]],
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [16, 185, 129] },
      footStyles: { fillColor: [21, 32, 58], textColor: 240, fontStyle: 'bold' },
      columnStyles: { 1:{halign:'right'},2:{halign:'right'},3:{halign:'right'},4:{halign:'right'},5:{halign:'right'},6:{halign:'right'},7:{halign:'right',fontStyle:'bold'} }
    });
    doc.save(`fluxo-caixa-${dataIni}_${dataFim}.pdf`);
  }

  // KPIs
  const kpi = useMemo(() => {
    if (!resp) return null;
    const totEnt = resp.dias.reduce((s,d)=>s+d.entrada,0);
    const totSai = resp.dias.reduce((s,d)=>s+d.saida,0);
    return {
      saldo_ini: resp.saldo_inicial,
      saldo_fim: resp.saldo_final,
      total_ent: totEnt,
      total_sai: totSai
    };
  }, [resp]);

  return (
    <div className="p-6 space-y-6">
      {/* Filtros */}
      <div className="card p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
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
          <label className="flex items-center gap-2 text-sm text-gray-300 mt-5 cursor-pointer">
            <input type="checkbox" checked={incluiSim} onChange={e=>setIncluiSim(e.target.checked)} />
            Incluir simulações
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-300 mt-5 cursor-pointer" title="Inclui TPDs PDV (recebimento previsto) e PREVPDC (pagamento previsto)">
            <input type="checkbox" checked={incluiPrev} onChange={e=>setIncluiPrev(e.target.checked)} />
            Considerar previsão
          </label>
          <button className="btn-prim" onClick={consultar} disabled={busy}>
            {busy ? 'Calculando...' : 'Consultar'}
          </button>
          <div className="flex-1" />
          <button className="btn-ghost" onClick={()=>setShowConfig(true)} title="Selecionar contas que compõem o saldo inicial">
            <Settings size={16} /> Contas
          </button>
          <button className="btn-ghost" onClick={()=>setShowSim(true)} title="Adicionar simulações">
            <Beaker size={16} /> Simulações
          </button>
          <button className="btn-ghost" onClick={exportXlsx} disabled={!resp}>
            <FileSpreadsheet size={16} /> Excel
          </button>
          <button className="btn-ghost" onClick={exportPdf} disabled={!resp}>
            <FileText size={16} /> PDF
          </button>
        </div>

        {/* Filiais como chips */}
        <div className="flex flex-wrap gap-2 items-center pt-1">
          <span className="text-xs uppercase text-gray-400">Filiais:</span>
          <button
            className={`px-3 py-1 rounded text-xs transition
              ${filiais.length === 0 ? 'bg-prim-600 text-white' : 'bg-ink-800 hover:bg-ink-700 text-gray-300'}`}
            onClick={()=>setFiliais([])}>
            Todas
          </button>
          {filiaisOpcoes.map(f => (
            <button key={f.id}
              className={`px-3 py-1 rounded text-xs transition
                ${filiais.includes(f.id) ? 'bg-prim-600 text-white' : 'bg-ink-800 hover:bg-ink-700 text-gray-300'}`}
              onClick={()=>toggleFil(f.id)}>
              {f.id} - {f.nome.split(' ').slice(0,2).join(' ')}
            </button>
          ))}
          {filiais.length > 0 && (
            <span className="text-xs text-gray-500 ml-2">({filiais.length} consolidada{filiais.length>1?'s':''})</span>
          )}
        </div>

        {/* [21/09/2026 - Alexandre Carvalho] V2 (pedido Renata/Quality): deixa visivel a regra que a matriz aplica */}
        <div className="text-[11px] text-gray-400 leading-relaxed border-t border-ink-800 pt-2">
          <b className="text-gray-300">Como a matriz soma:</b> de hoje em diante entram só títulos <b className="text-gray-300">em aberto</b>, pelo saldo
          (o que já foi recebido ou pago está no saldo bancário) · a data é o <b className="text-gray-300">vencimento prorrogado</b> ·
          vencimentos em <b className="text-gray-300">sábado, domingo e feriado</b> são somados no próximo dia útil · dias já passados mostram o valor cheio dos títulos.
        </div>
      </div>

      {err && <div className="bg-red-900/40 text-red-200 text-sm rounded p-3">{err}</div>}

      {/* KPIs */}
      {kpi && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard icon={<Wallet size={16}/>} label="Saldo inicial" value={fmt(kpi.saldo_ini)} color={kpi.saldo_ini>=0?'prim':'rose'} />
          <KpiCard icon={<TrendingUp size={16}/>} label="Total entradas" value={fmt(kpi.total_ent)} color="prim" />
          <KpiCard icon={<TrendingDown size={16}/>} label="Total saídas" value={fmt(kpi.total_sai)} color="rose" />
          <KpiCard icon={<Wallet size={16}/>} label="Saldo final projetado" value={fmt(kpi.saldo_fim)} color={kpi.saldo_fim>=0?'prim':'rose'} highlight />
        </div>
      )}

      {/* Tabela do Fluxo */}
      {resp && resp.dias.length > 0 && (
        <div className="card overflow-hidden">
          <div className="overflow-auto max-h-[70vh]">
            <table className="w-full text-sm">
              <thead className="bg-ink-900 text-gray-400 uppercase text-xs sticky top-0">
                <tr>
                  <th className="text-left p-3 pl-5 sticky left-0 bg-ink-900 z-10 w-[120px]">Data</th>
                  <th className="text-right p-3 text-emerald-400">Recebimento</th>
                  <th className="text-right p-3 text-rose-400">Pagamento</th>
                  <th className="text-right p-3 text-violet-300">Simulações</th>
                  <th className="text-right p-3">Líquido do dia</th>
                  <th className="text-right p-3 pr-5">Saldo acumulado</th>
                </tr>
              </thead>
              <tbody>
                <tr className="bg-ink-800 border-b-2 border-prim-600/40">
                  <td className="p-3 pl-5 italic text-gray-400 sticky left-0 bg-ink-800">Saldo anterior</td>
                  <td colSpan={4} className="p-3"></td>
                  <td className={`p-3 pr-5 text-right font-mono font-bold ${resp.saldo_inicial >= 0 ? 'text-prim-400' : 'text-rose-400'}`}>
                    {fmt(resp.saldo_inicial)}
                  </td>
                </tr>
                {resp.dias.map((d, i) => {
                  const recebto = (d.detalhes.CR_REALIZADO?.ent || 0) + (d.detalhes.CR_PREVISTO?.ent || 0);
                  const pagto   = (d.detalhes.CP_REALIZADO?.sai || 0) + (d.detalhes.CP_PREVISTO?.sai || 0);
                  const simNet  = (d.detalhes.SIMULACAO?.ent || 0) - (d.detalhes.SIMULACAO?.sai || 0);
                  const filsParam = filiais.length === 0 ? '0' : filiais.join(',');
                  const prevParam = incluiPrev ? 'S' : 'N';
                  return (
                    <tr key={i} className="border-b border-ink-700 hover:bg-ink-800/40">
                      <td className="p-3 pl-5 font-mono sticky left-0 bg-ink-900/95">
                        <div>{fmtBr(d.dt)}</div>
                        <div className="text-[10px] text-gray-500 uppercase">{['dom','seg','ter','qua','qui','sex','sáb'][new Date(d.dt+'T12:00:00').getDay()]}</div>
                      </td>
                      <td className="p-3 text-right font-mono">
                        {recebto ? (
                          <button
                            onClick={() => setDocsModal({ data: d.dt, tipo: 'CR', filiais: filsParam, prev: prevParam })}
                            className="text-emerald-400 hover:text-emerald-300 hover:underline transition cursor-pointer"
                            title="Clique para ver os documentos">
                            {fmt(recebto)}
                          </button>
                        ) : <span className="text-gray-700">—</span>}
                      </td>
                      <td className="p-3 text-right font-mono">
                        {pagto ? (
                          <button
                            onClick={() => setDocsModal({ data: d.dt, tipo: 'CP', filiais: filsParam, prev: prevParam })}
                            className="text-rose-400 hover:text-rose-300 hover:underline transition cursor-pointer"
                            title="Clique para ver os documentos">
                            {fmt(pagto)}
                          </button>
                        ) : <span className="text-gray-700">—</span>}
                      </td>
                      <td className="p-3 text-right font-mono">{simNet  ? <span className={simNet>=0 ? 'text-violet-300' : 'text-violet-400'}>{fmt(simNet)}</span> : <span className="text-gray-700">—</span>}</td>
                      <td className={`p-3 text-right font-mono font-semibold ${d.liquido >= 0 ? 'text-prim-400' : 'text-rose-400'}`}>
                        {fmt(d.liquido)}
                      </td>
                      <td className={`p-3 pr-5 text-right font-mono font-bold ${d.saldo_acum >= 0 ? 'text-prim-400' : 'text-rose-400'}`}>
                        {fmt(d.saldo_acum)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-ink-900 border-t-2 border-prim-600/40">
                  <td className="p-3 pl-5 font-bold sticky left-0 bg-ink-900">Saldo final projetado</td>
                  <td colSpan={4}></td>
                  <td className={`p-3 pr-5 text-right font-mono text-lg font-bold ${resp.saldo_final >= 0 ? 'text-prim-400' : 'text-rose-400'}`}>
                    {fmt(resp.saldo_final)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {resp && resp.dias.length === 0 && (
        <div className="card p-8 text-center text-gray-500">Sem lançamentos no período selecionado.</div>
      )}

      {showConfig && <ModalContas onClose={()=>{ setShowConfig(false); consultar(); }} />}
      {showSim    && <ModalSimulacoes filiais={filiaisOpcoes} onClose={()=>{ setShowSim(false); consultar(); }} />}
      {docsModal  && <ModalDocumentos {...docsModal} onClose={()=>setDocsModal(null)} />}
    </div>
  );
}

// ============================================================================
function KpiCard({ icon, label, value, color = 'prim', highlight }) {
  const map = {
    prim: 'border-prim-500 text-prim-400',
    rose: 'border-rose-500 text-rose-400'
  };
  const cls = map[color] || map.prim;
  const [border, text] = cls.split(' ');
  return (
    <div className={`kpi border-l-4 ${border} ${highlight ? 'ring-1 ring-prim-500/30' : ''}`}>
      <div className="kpi-label flex items-center gap-1">{icon} {label}</div>
      <div className={`kpi-value ${text}`}>{value}</div>
    </div>
  );
}

// ============================================================================
function ModalContas({ onClose }) {
  const [contas, setContas] = useState([]);
  const [busy,   setBusy]   = useState(false);
  const [filtro, setFiltro] = useState('');

  useEffect(() => { (async () => {
    try { setContas(await api.fluxoContasConfig()); } catch {}
  })(); }, []);

  function toggle(id) {
    setContas(p => p.map(c => c.id === id ? { ...c, ativo: !c.ativo } : c));
  }
  function todos(b) { setContas(p => p.map(c => ({ ...c, ativo: b }))); }

  async function salvar() {
    setBusy(true);
    try {
      await api.fluxoContasConfigSet(contas.filter(c => c.ativo).map(c => c.id));
      onClose();
    } catch (e) { alert(e.message || 'Erro'); setBusy(false); }
  }

  const list = contas.filter(c => {
    if (!filtro) return true;
    const q = filtro.toLowerCase();
    return String(c.id).includes(q) || (c.nome || '').toLowerCase().includes(q);
  });
  const ativos = contas.filter(c => c.ativo).length;

  return (
    <div className="fixed inset-0 z-40 bg-black/70 flex items-start justify-center p-4 overflow-auto" onClick={onClose}>
      <div className="card w-full max-w-3xl mt-8" onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-ink-700">
          <div>
            <div className="font-semibold flex items-center gap-2"><Settings size={18}/> Contas que compõem o saldo</div>
            <div className="text-xs text-gray-400 mt-0.5">{ativos} de {contas.length} ativas. Caso nenhuma marcada, considera todas.</div>
          </div>
          <button className="btn-ghost" onClick={onClose}><X size={18}/></button>
        </div>
        <div className="p-4 flex gap-2 border-b border-ink-700">
          <input className="input flex-1" placeholder="Buscar por código ou nome..." value={filtro} onChange={e=>setFiltro(e.target.value)} />
          <button className="btn-ghost text-xs" onClick={()=>todos(true)}>Marcar todas</button>
          <button className="btn-ghost text-xs" onClick={()=>todos(false)}>Desmarcar</button>
        </div>
        <div className="overflow-auto max-h-[55vh]">
          <table className="w-full text-sm">
            <thead className="bg-ink-900/50 text-xs text-gray-400 uppercase">
              <tr><th className="p-2 w-10"></th><th className="text-left p-2 w-20">Código</th><th className="text-left p-2">Conta</th></tr>
            </thead>
            <tbody>
              {list.map(c => (
                <tr key={c.id} className="border-t border-ink-700 hover:bg-ink-800/40 cursor-pointer" onClick={()=>toggle(c.id)}>
                  <td className="p-2 text-center">
                    <input type="checkbox" checked={c.ativo} readOnly />
                  </td>
                  <td className="p-2 font-mono text-gray-400">{c.id}</td>
                  <td className="p-2">{c.nome}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-3 border-t border-ink-700 flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn-prim" onClick={salvar} disabled={busy}>{busy ? 'Salvando...' : 'Salvar'}</button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
function ModalSimulacoes({ filiais, onClose }) {
  const [list, setList] = useState([]);
  const [form, setForm] = useState({ data: isoToday(), fil: 0, tipo: 'C', valor: '', descricao: '' });
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState('');

  async function carregar() {
    try { setList(await api.fluxoSimulacoes()); } catch {}
  }
  useEffect(() => { carregar(); }, []);

  async function adicionar(e) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      await api.fluxoSimulacaoCriar({
        data: form.data, fil: parseInt(form.fil, 10),
        tipo: form.tipo, valor: parseFloat(form.valor),
        descricao: form.descricao
      });
      setForm({ ...form, valor: '', descricao: '' });
      await carregar();
    } catch (e) { setErr(e.message || 'Erro'); }
    finally { setBusy(false); }
  }
  async function remover(id) {
    if (!confirm('Remover esta simulação?')) return;
    try { await api.fluxoSimulacaoApagar(id); await carregar(); } catch {}
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/70 flex items-start justify-center p-4 overflow-auto" onClick={onClose}>
      <div className="card w-full max-w-4xl mt-8" onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-ink-700">
          <div className="font-semibold flex items-center gap-2"><Beaker size={18}/> Simulações de fluxo</div>
          <button className="btn-ghost" onClick={onClose}><X size={18}/></button>
        </div>

        <form onSubmit={adicionar} className="p-4 grid grid-cols-1 md:grid-cols-6 gap-3 border-b border-ink-700 items-end">
          <label className="block">
            <span className="text-xs text-gray-300">Data</span>
            <input type="date" className="input mt-1" required value={form.data} onChange={e=>setForm({...form,data:e.target.value})} />
          </label>
          <label className="block">
            <span className="text-xs text-gray-300">Filial</span>
            <select className="input mt-1" required value={form.fil} onChange={e=>setForm({...form,fil:Number(e.target.value)})}>
              <option value={0} disabled>Selecione</option>
              {filiais.map(f => <option key={f.id} value={f.id}>{f.id}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-gray-300">Tipo</span>
            <select className="input mt-1" value={form.tipo} onChange={e=>setForm({...form,tipo:e.target.value})}>
              <option value="C">Entrada</option>
              <option value="D">Saída</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-gray-300">Valor</span>
            <input type="number" step="0.01" className="input mt-1" required value={form.valor}
                   onChange={e=>setForm({...form,valor:e.target.value})} />
          </label>
          <label className="block md:col-span-2">
            <span className="text-xs text-gray-300">Descrição</span>
            <input className="input mt-1" maxLength={200} value={form.descricao}
                   onChange={e=>setForm({...form,descricao:e.target.value})} />
          </label>
          <div className="md:col-span-6 flex justify-end gap-2">
            {err && <span className="text-rose-400 text-sm self-center">{err}</span>}
            <button type="submit" className="btn-prim" disabled={busy || !form.fil || !form.valor}>
              <Plus size={16}/> {busy ? 'Salvando...' : 'Adicionar'}
            </button>
          </div>
        </form>

        <div className="overflow-auto max-h-[50vh]">
          <table className="w-full text-sm">
            <thead className="bg-ink-900/50 text-xs text-gray-400 uppercase">
              <tr>
                <th className="text-left p-2 pl-5">Data</th>
                <th className="text-left p-2">Filial</th>
                <th className="text-left p-2">Tipo</th>
                <th className="text-right p-2">Valor</th>
                <th className="text-left p-2">Descrição</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {list.map(s => (
                <tr key={s.id} className="border-t border-ink-700 hover:bg-ink-800/40">
                  <td className="p-2 pl-5 font-mono">{fmtBr(s.data)}</td>
                  <td className="p-2 text-gray-400">{s.fil}</td>
                  <td className="p-2">
                    {s.tipo === 'C'
                      ? <span className="px-2 py-0.5 bg-emerald-700/30 text-emerald-300 text-[10px] font-semibold rounded">ENTRADA</span>
                      : <span className="px-2 py-0.5 bg-rose-700/30 text-rose-300 text-[10px] font-semibold rounded">SAÍDA</span>}
                  </td>
                  <td className={`p-2 text-right font-mono ${s.tipo==='C'?'text-emerald-400':'text-rose-400'}`}>
                    {fmt(s.valor)}
                  </td>
                  <td className="p-2 text-gray-300">{s.descricao}</td>
                  <td className="p-2 text-center">
                    <button className="text-rose-400 hover:text-rose-300" onClick={()=>remover(s.id)} title="Remover">
                      <Trash2 size={14}/>
                    </button>
                  </td>
                </tr>
              ))}
              {list.length === 0 && (
                <tr><td colSpan={6} className="p-8 text-center text-gray-500">Nenhuma simulação cadastrada ainda.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// [06/05/2026 - Alexandre Carvalho] Modal de drilldown de documentos.
// Abre quando o usuario clica num valor de Recebimento ou Pagamento na tabela.
// ============================================================================
function ModalDocumentos({ data, tipo, filiais, prev = 'N', onClose }) {
  const [docs,   setDocs]   = useState([]);
  const [totais, setTotais] = useState({ total:0, qtd:0, realizado:0, previsto:0, qtd_realizado:0, qtd_previsto:0 });
  const [busy,   setBusy]   = useState(false);
  const [err,    setErr]    = useState('');
  const [busca,  setBusca]  = useState('');
  const [statusFiltro, setStatusFiltro] = useState('TODOS');
  // [21/09/2026 - Alexandre Carvalho] V2 do fluxo: de hoje em diante o dia soma so o SALDO EM ABERTO
  const [soAberto, setSoAberto] = useState(false);

  const isCR = tipo === 'CR';
  const titulo = isCR ? 'Recebimentos' : 'Pagamentos';
  const corHeader = isCR ? 'text-emerald-400' : 'text-rose-400';

  useEffect(() => {
    setBusy(true); setErr('');
    api.fluxoDocs(data, tipo, filiais, prev)
      .then(r => { setDocs(r.docs || []); setTotais(r.totais || { total:0, qtd:0 }); setSoAberto(!!r.filtro?.so_aberto); })
      .catch(e => setErr(e.message || 'Erro ao carregar documentos'))
      .finally(() => setBusy(false));
  }, [data, tipo, filiais, prev]);

  const docsFiltrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return docs.filter(d => {
      if (statusFiltro !== 'TODOS' && d.status !== statusFiltro) return false;
      if (!q) return true;
      return (
        String(d.documento).toLowerCase().includes(q) ||
        String(d.parcela).toLowerCase().includes(q) ||
        d.nome_agente.toLowerCase().includes(q) ||
        d.cgc.toLowerCase().includes(q) ||
        String(d.cod_agente).includes(q) ||
        d.tipo_doc.toLowerCase().includes(q) ||
        d.historico.toLowerCase().includes(q) ||
        (d.caixa_nome || '').toLowerCase().includes(q) ||
        String(d.caixa_id || '').includes(q)
      );
    });
  }, [docs, busca, statusFiltro]);

  function exportXlsx() {
    const linhas = docsFiltrados.map(d => ({
      Documento:    d.documento,
      Parcela:      d.parcela,
      Vencimento:   fmtBr(d.vencimento),
      'Vcto Prorr': fmtBr(d.venc_pror),
      Emissao:      fmtBr(d.emissao),
      Entrada:      fmtBr(d.entrada),
      Filial:       d.filial,
      'Cod Agt':    d.cod_agente,
      Agente:       d.nome_agente,
      'CNPJ/CPF':   d.cgc,
      Valor:        d.valor,
      // [21/09/2026 - Alexandre Carvalho] V2: valor cheio + observacao (parcial / prorrogado / dia nao util)
      'Valor Titulo': d.valor_titulo,
      'Tipo Doc':   d.tipo_doc,
      'Tipo Fat':   d.tipo_fatura,
      Status:       d.status,
      Caixa:        d.caixa_nome ? `${d.caixa_id} - ${d.caixa_nome}` : '',
      Acao:         d.acao,
      Historico:    d.historico,
      Obs:          [d.parcial && 'baixa parcial', d.prorrogado && 'prorrogado', d.rolado && 'veio de dia nao util'].filter(Boolean).join('; ')
    }));
    linhas.push({});
    linhas.push({ Documento:'TOTAL', Valor: totais.total, Status:`${totais.qtd} doc` });

    const ws = XLSX.utils.json_to_sheet(linhas);
    ws['!cols'] = [
      {wch:14},{wch:8},{wch:11},{wch:11},{wch:11},{wch:11},{wch:7},{wch:9},
      {wch:35},{wch:18},{wch:14},{wch:14},{wch:9},{wch:9},{wch:11},{wch:35},{wch:8},{wch:40},{wch:32}
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, titulo);
    XLSX.writeFile(wb, `${tipo === 'CR' ? 'recebimentos' : 'pagamentos'}-${data}.xlsx`);
  }

  function exportPdf() {
    const doc = new jsPDF({ orientation:'landscape', unit:'pt', format:'a4' });
    let y = 32;
    doc.setFont('helvetica','bold'); doc.setFontSize(13);
    doc.text(`${titulo} - ${fmtBr(data)}`, 40, y); y += 14;
    doc.setFontSize(9); doc.setFont('helvetica','normal');
    doc.text(`Filial(is): ${filiais === '0' ? 'Todas' : filiais}    |    Total: ${fmt(totais.total)}    |    ${totais.qtd} documentos    (Realizado ${fmt(totais.realizado)} | Previsto ${fmt(totais.previsto)})`, 40, y); y += 6;

    autoTable(doc, {
      startY: y + 8,
      head: [['Documento','Parc','Vcto','Filial','Agente','Valor','Status','Caixa','Tipo Doc','Historico']],
      body: docsFiltrados.map(d => [
        d.documento,
        d.parcela,
        fmtBr(d.vencimento),
        String(d.filial),
        `${d.cod_agente} - ${d.nome_agente}`,
        fmt(d.valor),
        d.status,
        d.caixa_nome ? `${d.caixa_id} - ${d.caixa_nome}` : '',
        d.tipo_doc,
        d.historico.slice(0,60)
      ]),
      foot: [['', '', '', '', 'TOTAL =', fmt(totais.total), '', '', '', '']],
      styles: { fontSize: 7, cellPadding: 2.5, overflow:'linebreak' },
      headStyles: { fillColor: isCR ? [16, 185, 129] : [225, 29, 72] },
      footStyles: { fillColor: [21, 32, 58], textColor: 240, fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 58 },
        1: { cellWidth: 28, halign:'center' },
        2: { cellWidth: 52 },
        3: { cellWidth: 32, halign:'center' },
        4: { cellWidth: 165 },
        5: { cellWidth: 65, halign:'right' },
        6: { cellWidth: 52, halign:'center' },
        7: { cellWidth: 130 },
        8: { cellWidth: 50 },
        9: { cellWidth: 140 }
      }
    });
    doc.save(`${tipo === 'CR' ? 'recebimentos' : 'pagamentos'}-${data}.pdf`);
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-3">
      <div className="bg-ink-900 rounded-lg w-[95vw] max-w-[1400px] max-h-[92vh] flex flex-col border border-prim-700/30 shadow-2xl">
        <div className="flex items-start justify-between p-5 border-b border-ink-700">
          <div>
            <h3 className={`text-xl font-bold ${corHeader}`}>{titulo} - {fmtBr(data)}</h3>
            <div className="text-xs text-gray-400 mt-1">
              Filial(is): <b className="text-gray-200">{filiais === '0' ? 'Todas' : filiais}</b>
              <span className="mx-2">·</span>
              Total: <b className={corHeader}>{fmt(totais.total)}</b>
              <span className="mx-2">·</span>
              <b className="text-gray-200">{totais.qtd}</b> documento{totais.qtd === 1 ? '' : 's'}
              <span className="mx-2">·</span>
              <span className="text-emerald-400">Realizado {fmt(totais.realizado)} ({totais.qtd_realizado})</span>
              <span className="mx-2">|</span>
              <span className="text-amber-400">Previsto {fmt(totais.previsto)} ({totais.qtd_previsto})</span>
            </div>
            {/* [21/09/2026 - Alexandre Carvalho] V2: explica o que entra no dia (pedido Renata/Quality) */}
            <div className="text-[11px] text-gray-400 mt-1.5 leading-relaxed">
              {soAberto
                ? <>Só títulos <b className="text-gray-200">em aberto</b>, pelo <b className="text-gray-200">saldo a {isCR ? 'receber' : 'pagar'}</b> — o que já foi {isCR ? 'recebido' : 'pago'} está no saldo bancário.</>
                : <>Dia já passado: mostra os títulos pelo valor cheio, {isCR ? 'recebidos' : 'pagos'} ou não.</>}
              {' '}A data considerada é o <b className="text-gray-200">vencimento prorrogado</b>; sábado, domingo e feriado somam no próximo dia útil.
              {(totais.qtd_rolados > 0 || totais.qtd_prorrogados > 0 || totais.qtd_parciais > 0) && (
                <span className="ml-1 text-sky-300">
                  ({[
                    totais.qtd_rolados     > 0 && `${totais.qtd_rolados} trazido${totais.qtd_rolados === 1 ? '' : 's'} de dia não útil`,
                    totais.qtd_prorrogados > 0 && `${totais.qtd_prorrogados} prorrogado${totais.qtd_prorrogados === 1 ? '' : 's'}`,
                    totais.qtd_parciais    > 0 && `${totais.qtd_parciais} com baixa parcial`
                  ].filter(Boolean).join(' · ')})
                </span>
              )}
            </div>
          </div>
          <button className="text-gray-400 hover:text-white" onClick={onClose}><X size={22}/></button>
        </div>

        <div className="flex flex-wrap items-center gap-3 p-3 border-b border-ink-800 bg-ink-900/40">
          <div className="relative">
            <Search size={14} className="absolute left-2 top-2.5 text-gray-500"/>
            <input
              className="bg-ink-800 border border-ink-700 rounded pl-7 pr-3 py-1.5 text-sm w-72"
              placeholder={`Buscar titulo, ${isCR ? 'cliente' : 'fornecedor'}, caixa, CNPJ, historico...`}
              value={busca} onChange={e=>setBusca(e.target.value)} />
          </div>
          <div className="flex gap-1">
            {['TODOS','REALIZADO','PREVISTO'].map(s => (
              <button key={s}
                className={`px-3 py-1 rounded text-xs transition ${statusFiltro === s ? 'bg-prim-600 text-white' : 'bg-ink-800 hover:bg-ink-700 text-gray-300'}`}
                onClick={()=>setStatusFiltro(s)}>{s}</button>
            ))}
          </div>
          <div className="flex-1"/>
          <span className="text-xs text-gray-400">{docsFiltrados.length} de {docs.length}</span>
          <button className="btn-ghost" onClick={exportXlsx} disabled={busy || docs.length === 0}>
            <FileSpreadsheet size={14}/> Excel
          </button>
          <button className="btn-ghost" onClick={exportPdf} disabled={busy || docs.length === 0}>
            <FileText size={14}/> PDF
          </button>
        </div>

        <div className="overflow-auto flex-1">
          {busy ? (
            <div className="p-8 text-center text-gray-400">Carregando documentos...</div>
          ) : err ? (
            <div className="p-4 m-3 bg-red-900/40 text-red-200 text-sm rounded">{err}</div>
          ) : docsFiltrados.length === 0 ? (
            <div className="p-8 text-center text-gray-500">Nenhum documento encontrado.</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-ink-900 text-gray-400 uppercase sticky top-0 z-10">
                <tr>
                  <th className="text-left  p-2 pl-4">Documento</th>
                  <th className="text-center p-2">Parc</th>
                  <th className="text-center p-2">Vcto</th>
                  <th className="text-center p-2">Vcto Prorr</th>
                  <th className="text-center p-2">Emissão</th>
                  <th className="text-center p-2">Entrada</th>
                  <th className="text-center p-2">Fil</th>
                  <th className="text-left  p-2">Agente</th>
                  <th className="text-left  p-2">CNPJ/CPF</th>
                  <th className="text-right p-2">Valor</th>
                  <th className="text-center p-2">Status</th>
                  <th className="text-left  p-2">Caixa</th>
                  <th className="text-center p-2">Tipo Doc</th>
                  <th className="text-center p-2">Tipo Fat</th>
                  <th className="text-center p-2">Ação</th>
                  <th className="text-left  p-2 pr-4">Histórico</th>
                </tr>
              </thead>
              <tbody>
                {docsFiltrados.map((d, i) => (
                  <tr key={i} className="border-b border-ink-800 hover:bg-ink-800/40">
                    <td className="p-2 pl-4 font-mono">{d.documento}</td>
                    <td className="p-2 text-center font-mono text-gray-400">{d.parcela}</td>
                    <td className="p-2 text-center font-mono">{fmtBr(d.vencimento)}</td>
                    {/* [21/09/2026 - Alexandre Carvalho] V2: prorrogado em destaque; marca quando veio de dia nao util */}
                    <td className={`p-2 text-center font-mono ${d.prorrogado ? 'text-amber-300' : 'text-gray-400'}`}
                        title={d.prorrogado ? 'Título prorrogado: entra no fluxo pela data nova' : ''}>
                      {fmtBr(d.venc_pror)}
                      {d.rolado && (
                        <span className="ml-1 text-[9px] px-1 py-0.5 rounded bg-sky-900/50 text-sky-300 border border-sky-700/40 font-sans"
                              title={`Vence em ${fmtBr(d.data_base)} (dia não útil) — somado em ${fmtBr(data)}`}>dia útil</span>
                      )}
                    </td>
                    <td className="p-2 text-center font-mono text-gray-500">{fmtBr(d.emissao)}</td>
                    <td className="p-2 text-center font-mono text-gray-500">{fmtBr(d.entrada)}</td>
                    <td className="p-2 text-center font-mono text-gray-300">{d.filial}</td>
                    <td className="p-2 max-w-[280px] truncate" title={`${d.cod_agente} - ${d.nome_agente}`}>
                      <span className="text-gray-500">{d.cod_agente}</span> {d.nome_agente}
                    </td>
                    <td className="p-2 font-mono text-gray-400">{d.cgc}</td>
                    <td className={`p-2 text-right font-mono font-semibold ${isCR ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {fmt(d.valor)}
                      {/* [21/09/2026 - Alexandre Carvalho] V2: baixa parcial - conta o saldo, mostra o valor cheio embaixo */}
                      {d.parcial && (
                        <div className="text-[10px] font-normal text-gray-500" title="Título com baixa parcial: o fluxo soma só o saldo em aberto">
                          de {fmt(d.valor_titulo)}
                        </div>
                      )}
                    </td>
                    <td className="p-2 text-center">
                      <span className={`text-[10px] px-2 py-0.5 rounded ${
                        d.status === 'REALIZADO'
                          ? 'bg-emerald-900/40 text-emerald-300 border border-emerald-700/40'
                          : 'bg-amber-900/40 text-amber-300 border border-amber-700/40'
                      }`}>{d.status}</span>
                    </td>
                    <td className="p-2 max-w-[220px] truncate" title={d.caixa_nome ? `${d.caixa_id} - ${d.caixa_nome}` : 'Sem baixa (em aberto)'}>
                      {d.caixa_nome
                        ? (<><span className="text-gray-500">{d.caixa_id}</span> <span className="text-sky-300">{d.caixa_nome}</span></>)
                        : <span className="text-gray-600">—</span>}
                    </td>
                    <td className="p-2 text-center font-mono text-gray-300">{d.tipo_doc}</td>
                    <td className="p-2 text-center font-mono text-gray-400">{d.tipo_fatura}</td>
                    <td className="p-2 text-center font-mono text-gray-400">{d.acao}</td>
                    <td className="p-2 pr-4 max-w-[280px] truncate text-gray-300" title={d.historico}>{d.historico}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-ink-900 border-t-2 border-prim-600/40 font-bold">
                  <td className="p-3 pl-4 text-gray-300" colSpan={9}>TOTAL ({docsFiltrados.length} documento{docsFiltrados.length===1?'':'s'})</td>
                  <td className={`p-3 text-right font-mono ${isCR ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {fmt(docsFiltrados.reduce((s,d)=>s+d.valor,0))}
                  </td>
                  <td colSpan={6}></td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
