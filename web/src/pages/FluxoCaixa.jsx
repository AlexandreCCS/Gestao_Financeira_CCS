import React, { useEffect, useMemo, useState } from 'react';
import {
  Filter, Settings, Beaker, Calendar, FileSpreadsheet, FileText, X,
  TrendingUp, TrendingDown, Wallet, Plus, Trash2, ChevronDown, Search,
  ChevronUp, ChevronLeft, ChevronRight
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
  // [21/09/2026 - Alexandre Carvalho] V3 (pedido Renata/Quality, bloco Fluxo de Caixa):
  const [d1,          setD1]          = useState(true);    // recebimento pela data do CREDITO em conta (prazo da forma)
  const [incluiGrupo, setIncluiGrupo] = useState(true);    // empresas do grupo entram no CR/CP?
  const [classesFora, setClassesFora] = useState([]);      // classes de credito desconsideradas no CR (C, D, E)
  const [showPrazos,  setShowPrazos]  = useState(false);
  const [showResumo,  setShowResumo]  = useState(false);   // tela sintetica do PERIODO consultado
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
      const r = await api.fluxoPrevio(dataIni, dataFim, filsParam, incluiSim ? 'S':'N', incluiPrev ? 'S':'N',
        { grupo: incluiGrupo ? 'S' : 'N', classes: classesFora.join(','), d1: d1 ? 'S' : 'N' });
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
          {/* [21/09/2026 - Alexandre Carvalho] V3: D+1, empresas do grupo e clientes com historico de atraso */}
          <label className="flex items-center gap-2 text-sm text-gray-300 mt-5 cursor-pointer"
                 title="Recebimento pela data em que o dinheiro entra na conta: boleto e cartão de débito D+1, cartão de crédito 30+1. Os prazos por forma ficam no botão Prazos.">
            <input type="checkbox" checked={d1} onChange={e=>setD1(e.target.checked)} />
            Considerar D+1 (crédito em conta)
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-300 mt-5 cursor-pointer"
                 title="Desmarque para tirar recebimentos e pagamentos entre empresas do grupo">
            <input type="checkbox" checked={incluiGrupo} onChange={e=>setIncluiGrupo(e.target.checked)} />
            Empresas do grupo
          </label>
          <div className="mt-5 flex items-center gap-1.5 text-sm text-gray-300"
               title="Simula o recebimento SEM os clientes das classes marcadas (classe da Inteligência de Crédito, recalculada toda noite). Não afeta pagamentos.">
            <span>Desconsiderar clientes classe</span>
            {['C','D','E'].map(c => (
              <button key={c} type="button"
                className={`w-7 h-7 rounded text-xs font-bold transition
                  ${classesFora.includes(c) ? 'bg-rose-600 text-white' : 'bg-ink-800 hover:bg-ink-700 text-gray-400'}`}
                onClick={() => setClassesFora(p => p.includes(c) ? p.filter(x => x !== c) : [...p, c].sort())}>
                {c}
              </button>
            ))}
          </div>
          <button className="btn-prim" onClick={consultar} disabled={busy}>
            {busy ? 'Calculando...' : 'Consultar'}
          </button>
          <div className="flex-1" />
          <button className="btn-ghost" onClick={()=>setShowConfig(true)} title="Selecionar contas que compõem o saldo inicial">
            <Settings size={16} /> Contas
          </button>
          <button className="btn-ghost" onClick={()=>setShowResumo(true)} disabled={!resp}
                  title="Tela sintética do período consultado: total por tipo de cobrança e por cliente/fornecedor">
            <TrendingUp size={16} /> Resumo
          </button>
          <button className="btn-ghost" onClick={()=>setShowPrazos(true)} title="Prazo de crédito por forma de recebimento (D+1)">
            <Calendar size={16} /> Prazos
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
          {resp?.filtro && (
            <div className="mt-1">
              <b className="text-gray-300">Nesta consulta:</b>{' '}
              {resp.filtro.d1 === 'S' ? 'recebimentos pela data do crédito em conta (D+1 por forma)' : 'recebimentos na data do vencimento (sem D+1)'} ·{' '}
              {resp.filtro.grupo === 'N' ? <span className="text-amber-300">sem empresas do grupo</span> : 'com empresas do grupo'} ·{' '}
              {resp.filtro.classes ? <span className="text-amber-300">sem clientes classe {resp.filtro.classes.split(',').join(', ')}</span> : 'todos os clientes'}
            </div>
          )}
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
                  // [21/09/2026 - Alexandre Carvalho] o modal abre com os parametros DA CONSULTA que gerou a
                  // matriz (resp.filtro), nao com o estado atual dos controles - senao bastava marcar um
                  // checkbox sem clicar em Consultar para a celula e o modal divergirem.
                  const filsParam = resp.filtro?.filiais ?? (filiais.length === 0 ? '0' : filiais.join(','));
                  const prevParam = resp.filtro?.previsao ?? (incluiPrev ? 'S' : 'N');
                  const v3Param   = { grupo: resp.filtro?.grupo || 'S', classes: resp.filtro?.classes || '', d1: resp.filtro?.d1 || 'N' };
                  return (
                    <tr key={i} className="border-b border-ink-700 hover:bg-ink-800/40">
                      <td className="p-3 pl-5 font-mono sticky left-0 bg-ink-900/95">
                        <div>{fmtBr(d.dt)}</div>
                        <div className="text-[10px] text-gray-500 uppercase">{['dom','seg','ter','qua','qui','sex','sáb'][new Date(d.dt+'T12:00:00').getDay()]}</div>
                      </td>
                      <td className="p-3 text-right font-mono">
                        {recebto ? (
                          <button
                            onClick={() => setDocsModal({ data: d.dt, tipo: 'CR', filiais: filsParam, prev: prevParam, v3: v3Param })}
                            className="text-emerald-400 hover:text-emerald-300 hover:underline transition cursor-pointer"
                            title="Clique para ver os documentos">
                            {fmt(recebto)}
                          </button>
                        ) : <span className="text-gray-700">—</span>}
                      </td>
                      <td className="p-3 text-right font-mono">
                        {pagto ? (
                          <button
                            onClick={() => setDocsModal({ data: d.dt, tipo: 'CP', filiais: filsParam, prev: prevParam, v3: v3Param })}
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
      {showPrazos && <ModalPrazos onClose={(mudou)=>{ setShowPrazos(false); if (mudou) consultar(); }} />}
      {showResumo && resp && (
        <ModalResumo dataIni={resp.filtro.data_ini} dataFim={resp.filtro.data_fim} tipo="CR"
                     filiais={resp.filtro.filiais} prev={resp.filtro.previsao}
                     v3={{ grupo: resp.filtro.grupo || 'S', classes: resp.filtro.classes || '', d1: resp.filtro.d1 || 'N' }}
                     onClose={()=>setShowResumo(false)} />
      )}
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
// [21/09/2026 - Alexandre Carvalho] Prazo de credito por forma de recebimento ("D+1") - pedido Renata/Quality.
// Boleto e cartao de debito = 0 corridos + 1 util; cartao de credito = 30 corridos + 1 util; demais no dia.
// Qualquer usuario ve; so administrador altera (a API tambem barra).
function ModalPrazos({ onClose }) {
  const [itens, setItens] = useState([]);
  const [orig,  setOrig]  = useState({});
  const [pode,  setPode]  = useState(false);
  const [busy,  setBusy]  = useState(true);
  const [erro,  setErro]  = useState('');
  const [mudou, setMudou] = useState(false);

  async function carregar() {
    setBusy(true); setErro('');
    try {
      const r = await api.fluxoPrazos();
      setItens(r.itens || []); setPode(!!r.pode_editar);
      setOrig(Object.fromEntries((r.itens || []).map(i => [i.id, `${i.corridos}|${i.uteis}`])));
    } catch (e) { setErro(e.message || 'Erro ao carregar prazos'); }
    finally { setBusy(false); }
  }
  useEffect(() => { carregar(); }, []);

  const alterados = itens.filter(i => orig[i.id] !== `${i.corridos}|${i.uteis}`);
  const set = (id, campo, v) => setItens(p => p.map(i => i.id === id ? { ...i, [campo]: Math.max(0, Math.min(campo === 'corridos' ? 120 : 10, parseInt(v, 10) || 0)) } : i));

  async function salvar() {
    setBusy(true); setErro('');
    try {
      await api.fluxoPrazosSet(alterados.map(i => ({ id: i.id, corridos: i.corridos, uteis: i.uteis })));
      setMudou(true); await carregar();
    } catch (e) { setErro(e.message || 'Erro ao salvar'); setBusy(false); }
  }

  const rotulo = i => (i.corridos === 0 && i.uteis === 0) ? 'no dia' : i.corridos === 0 ? `D+${i.uteis}` : `${i.corridos}+${i.uteis}`;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-3">
      <div className="bg-ink-900 rounded-lg w-full max-w-3xl max-h-[88vh] flex flex-col border border-prim-700/30 shadow-2xl">
        <div className="flex items-start justify-between p-5 border-b border-ink-700">
          <div>
            <div className="font-semibold flex items-center gap-2"><Calendar size={18}/> Prazo de crédito por forma de recebimento</div>
            <div className="text-xs text-gray-400 mt-1 leading-relaxed">
              Usado quando <b className="text-gray-200">"Considerar D+1"</b> está marcado. Data do crédito = dia útil do pagamento
              + dias corridos + dias úteis. Ex.: boleto <b className="text-gray-200">0 + 1</b> (vence sexta, credita segunda);
              cartão de crédito <b className="text-gray-200">30 + 1</b>.
              {!pode && <span className="text-amber-300"> Somente administradores alteram.</span>}
            </div>
          </div>
          <button className="text-gray-400 hover:text-white" onClick={() => onClose(mudou)}><X size={22}/></button>
        </div>
        {erro && <div className="m-3 bg-red-900/40 text-red-200 text-sm rounded p-3">{erro}</div>}
        <div className="overflow-auto flex-1">
          <table className="w-full text-sm">
            <thead className="bg-ink-900/70 text-xs text-gray-400 uppercase sticky top-0">
              <tr>
                <th className="text-left p-2 pl-5">Forma de recebimento</th>
                <th className="text-right p-2">Títulos em aberto</th>
                <th className="text-center p-2">Dias corridos</th>
                <th className="text-center p-2">Dias úteis</th>
                <th className="text-center p-2">Regra</th>
                <th className="text-left p-2 pr-5">Última alteração</th>
              </tr>
            </thead>
            <tbody>
              {itens.map(i => {
                const alt = orig[i.id] !== `${i.corridos}|${i.uteis}`;
                return (
                  <tr key={i.id} className={`border-t border-ink-800 ${alt ? 'bg-prim-900/20' : ''}`}>
                    <td className="p-2 pl-5 text-gray-200">{i.forma}</td>
                    <td className="p-2 text-right font-mono text-xs text-gray-400">{fmtN(i.qt_abertos)}</td>
                    <td className="p-2 text-center">
                      <input type="number" min="0" max="120" disabled={!pode || busy} value={i.corridos}
                             onChange={e => set(i.id, 'corridos', e.target.value)}
                             className="bg-ink-800 border border-ink-700 rounded w-16 text-center py-1 disabled:opacity-60" />
                    </td>
                    <td className="p-2 text-center">
                      <input type="number" min="0" max="10" disabled={!pode || busy} value={i.uteis}
                             onChange={e => set(i.id, 'uteis', e.target.value)}
                             className="bg-ink-800 border border-ink-700 rounded w-16 text-center py-1 disabled:opacity-60" />
                    </td>
                    <td className="p-2 text-center text-xs font-mono text-violet-300">{rotulo(i)}</td>
                    <td className="p-2 pr-5 text-xs text-gray-500">{i.dt_alteracao ? `${fmtBr(i.dt_alteracao.slice(0,10))} · ${i.usuario}` : ''}</td>
                  </tr>
                );
              })}
              {itens.length === 0 && (
                <tr><td colSpan={6} className="p-8 text-center text-gray-500">{busy ? 'Carregando...' : 'Nenhuma forma cadastrada.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-end gap-2 p-4 border-t border-ink-700">
          <span className="text-xs text-gray-500 mr-auto">{alterados.length > 0 ? `${alterados.length} alteração(ões) não salva(s)` : ''}</span>
          <button className="btn-ghost" onClick={() => onClose(mudou)}>Fechar</button>
          {pode && <button className="btn-prim" onClick={salvar} disabled={busy || alterados.length === 0}>{busy ? 'Salvando...' : 'Salvar'}</button>}
        </div>
      </div>
    </div>
  );
}

// [21/09/2026 - Alexandre Carvalho] TELA SINTETICA do fluxo - "Receita por tipo de cobranca e agente" e
// "Pagamentos por agente" (pedido Renata/Quality; fechado com o Alexandre como "um botao que abra essa tela
// mais sintetica"). Abre pelo botao Resumo da tela (periodo consultado) e pelo botao Resumo do modal (o dia).
// Usa as MESMAS regras da matriz: o total daqui = soma das celulas do periodo.
function ModalResumo({ dataIni, dataFim, tipo: tipoIni = 'CR', filiais, prev = 'N', v3 = {}, onClose }) {
  const [tipo, setTipo] = useState(tipoIni);
  const [r,    setR]    = useState(null);
  const [busy, setBusy] = useState(true);
  const [erro, setErro] = useState('');
  const [busca, setBusca] = useState('');

  useEffect(() => {
    setBusy(true); setErro('');
    api.fluxoResumo(dataIni, dataFim, tipo, filiais, prev, v3)
      .then(setR).catch(e => { setErro(e.message || 'Erro ao carregar o resumo'); setR(null); })
      .finally(() => setBusy(false));
  }, [dataIni, dataFim, tipo, filiais, prev, v3.grupo, v3.classes, v3.d1]);

  const isCR = tipo === 'CR';
  const cor  = isCR ? 'text-emerald-400' : 'text-rose-400';
  const barra = isCR ? 'bg-emerald-600/60' : 'bg-rose-600/60';
  const total = r?.total?.valor || 0;
  const pct = v => total > 0 ? (v / total * 100) : 0;
  const agentes = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return (r?.por_agente || []).filter(a => !q || a.nome.toLowerCase().includes(q) || String(a.agn_id).includes(q));
  }, [r, busca]);
  const periodo = dataIni === dataFim ? fmtBr(dataIni) : `${fmtBr(dataIni)} a ${fmtBr(dataFim)}`;

  function exportXlsx() {
    if (!r) return;
    const wb = XLSX.utils.book_new();
    if (isCR) {
      const w1 = XLSX.utils.json_to_sheet(r.por_forma.map(f => ({ 'Tipo de cobrança': f.forma, 'Títulos': f.qt, Clientes: f.agentes, Valor: f.valor, '% do total': Number(pct(f.valor).toFixed(2)) })));
      w1['!cols'] = [{wch:34},{wch:9},{wch:9},{wch:16},{wch:11}];
      XLSX.utils.book_append_sheet(wb, w1, 'Por tipo de cobrança');
    }
    const w2 = XLSX.utils.json_to_sheet(r.por_agente.map(a => ({ 'Código': a.agn_id, [isCR ? 'Cliente' : 'Fornecedor']: a.nome, ...(isCR ? { Classe: a.classe } : {}), 'Títulos': a.qt, Valor: a.valor, '% do total': Number(pct(a.valor).toFixed(2)) })));
    w2['!cols'] = [{wch:10},{wch:52},...(isCR ? [{wch:8}] : []),{wch:9},{wch:16},{wch:11}];
    XLSX.utils.book_append_sheet(wb, w2, 'Por agente');
    XLSX.writeFile(wb, `fluxo-resumo-${isCR ? 'recebimentos' : 'pagamentos'}-${dataIni}${dataIni === dataFim ? '' : '_a_' + dataFim}.xlsx`);
  }

  return (
    <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-[60] p-3">
      <div className="bg-ink-900 rounded-lg w-[95vw] max-w-[1200px] max-h-[92vh] flex flex-col border border-prim-700/30 shadow-2xl">
        <div className="flex items-start justify-between p-5 border-b border-ink-700">
          <div>
            <h3 className={`text-xl font-bold ${cor}`}>Resumo de {isCR ? 'Recebimentos' : 'Pagamentos'} · {periodo}</h3>
            <div className="text-xs text-gray-400 mt-1">
              Filial(is): <b className="text-gray-200">{filiais === '0' ? 'Todas' : filiais}</b>
              <span className="mx-2">·</span>Total: <b className={cor}>{fmt(total)}</b>
              <span className="mx-2">·</span><b className="text-gray-200">{fmtN(r?.total?.qt)}</b> título(s)
              <span className="mx-2">·</span><b className="text-gray-200">{fmtN(r?.total?.agentes)}</b> {isCR ? 'cliente(s)' : 'fornecedor(es)'}
            </div>
            <div className="text-[11px] text-gray-500 mt-1">
              Mesmas regras da matriz{isCR && v3.d1 === 'S' ? ' (com D+1)' : ''}{v3.grupo === 'N' ? ' · sem empresas do grupo' : ''}{isCR && v3.classes ? ` · sem clientes classe ${v3.classes}` : ''} — o total é a soma das células de {isCR ? 'Recebimento' : 'Pagamento'} do período.
            </div>
          </div>
          <button className="text-gray-400 hover:text-white" onClick={onClose}><X size={22}/></button>
        </div>

        <div className="flex flex-wrap items-center gap-2 p-3 border-b border-ink-800 bg-ink-900/40">
          {[{ k: 'CR', l: 'Recebimentos' }, { k: 'CP', l: 'Pagamentos' }].map(t => (
            <button key={t.k} onClick={() => setTipo(t.k)}
              className={`px-3 py-1 rounded text-sm font-semibold transition ${tipo === t.k ? 'bg-prim-600 text-white' : 'bg-ink-800 hover:bg-ink-700 text-gray-300'}`}>{t.l}</button>
          ))}
          {busy && <span className="text-xs text-gray-500 ml-1">calculando…</span>}
          <div className="flex-1" />
          <button className="btn-ghost" onClick={exportXlsx} disabled={busy || !r}><FileSpreadsheet size={14}/> Excel</button>
        </div>

        {erro && <div className="m-3 bg-red-900/40 text-red-200 text-sm rounded p-3">{erro}</div>}

        <div className={`flex-1 overflow-hidden grid gap-0 ${isCR ? 'md:grid-cols-5' : 'grid-cols-1'}`}>
          {isCR && (
            <div className="md:col-span-2 overflow-auto border-r border-ink-800">
              <div className="px-4 py-2 text-xs uppercase text-gray-400 bg-ink-900/70 sticky top-0">Por tipo de cobrança</div>
              <table className="w-full text-sm">
                <thead className="text-gray-500 uppercase text-[10px]">
                  <tr><th className="text-left p-2 pl-4">Tipo de cobrança</th><th className="text-right p-2">Títulos</th><th className="text-right p-2">Clientes</th><th className="text-right p-2 pr-4">Valor</th></tr>
                </thead>
                <tbody>
                  {(r?.por_forma || []).map(f => (
                    <tr key={f.forma} className="border-t border-ink-800">
                      <td className="p-2 pl-4">
                        <div className="text-gray-200 text-xs">{f.forma}</div>
                        <div className="h-1.5 mt-1 rounded bg-ink-800 overflow-hidden"><div className={`h-full ${barra}`} style={{ width: `${Math.min(100, pct(f.valor))}%` }} /></div>
                      </td>
                      <td className="p-2 text-right font-mono text-xs text-gray-400">{fmtN(f.qt)}</td>
                      <td className="p-2 text-right font-mono text-xs text-gray-400">{fmtN(f.agentes)}</td>
                      <td className="p-2 pr-4 text-right font-mono">
                        <div className={cor}>{fmt(f.valor)}</div>
                        <div className="text-[10px] text-gray-500">{pct(f.valor).toFixed(1)}%</div>
                      </td>
                    </tr>
                  ))}
                  {!busy && (r?.por_forma || []).length === 0 && <tr><td colSpan={4} className="p-6 text-center text-gray-500 text-xs">Sem títulos no período.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
          <div className={`${isCR ? 'md:col-span-3' : ''} overflow-auto`}>
            <div className="px-4 py-2 text-xs uppercase text-gray-400 bg-ink-900/70 sticky top-0 flex items-center gap-3 z-10">
              <span>Por {isCR ? 'cliente' : 'fornecedor'} {!isCR && <span className="normal-case text-gray-500">(o Mega não guarda modalidade no contas a pagar)</span>}</span>
              <div className="ml-auto flex items-center gap-2 bg-ink-800 px-2 rounded normal-case">
                <Search size={13} className="text-gray-500" />
                <input className="bg-transparent outline-none py-1 text-xs w-52" placeholder="Buscar nome ou código..." value={busca} onChange={e => setBusca(e.target.value)} />
              </div>
            </div>
            <table className="w-full text-sm">
              <thead className="text-gray-500 uppercase text-[10px]">
                <tr><th className="text-left p-2 pl-4">{isCR ? 'Cliente' : 'Fornecedor'}</th><th className="text-right p-2">Títulos</th><th className="text-right p-2 pr-4">Valor</th></tr>
              </thead>
              <tbody>
                {agentes.map(a => (
                  <tr key={a.agn_id} className="border-t border-ink-800 hover:bg-ink-800/40">
                    <td className="p-2 pl-4">
                      <div className="text-xs"><span className="text-gray-500">{a.agn_id}</span> <span className="text-gray-200">{a.nome}</span>
                        {isCR && a.classe && <span className={`ml-1 text-[9px] px-1 py-0.5 rounded font-bold ${'DE'.includes(a.classe) ? 'bg-rose-900/50 text-rose-300' : a.classe === 'C' ? 'bg-amber-900/40 text-amber-300' : 'bg-ink-700 text-gray-400'}`}>{a.classe}</span>}
                      </div>
                      <div className="h-1 mt-1 rounded bg-ink-800 overflow-hidden"><div className={`h-full ${barra}`} style={{ width: `${Math.min(100, pct(a.valor))}%` }} /></div>
                    </td>
                    <td className="p-2 text-right font-mono text-xs text-gray-400">{fmtN(a.qt)}</td>
                    <td className="p-2 pr-4 text-right font-mono">
                      <div className={cor}>{fmt(a.valor)}</div>
                      <div className="text-[10px] text-gray-500">{pct(a.valor).toFixed(1)}%</div>
                    </td>
                  </tr>
                ))}
                {!busy && agentes.length === 0 && <tr><td colSpan={3} className="p-6 text-center text-gray-500 text-xs">Nada encontrado.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

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
// [21/09/2026 - Alexandre Carvalho] Grid do modal de documentos no MESMO padrao da Liberacao de Data de
// Baixa (pedido do Alexandre com a Renata/Quality): cabecalho clicavel ordena, filtros por select,
// resumo com contagem/soma e paginacao. Mapa coluna -> valor usado na ordenacao:
const DOCS_POR_PAGINA = 100;
const DOCS_SORTS = {
  documento:  d => String(d.documento || ''),
  parcela:    d => String(d.parcela || ''),
  vencimento: d => d.vencimento || '',
  venc_pror:  d => d.venc_pror || '',
  emissao:    d => d.emissao || '',
  entrada:    d => d.entrada || '',
  filial:     d => d.filial,
  agente:     d => (d.nome_agente || '').toLowerCase(),
  cgc:        d => d.cgc || '',
  valor:      d => d.valor,
  forma:      d => (d.forma || '').toLowerCase(),
  status:     d => d.status || '',
  caixa:      d => (d.caixa_nome || '').toLowerCase(),
  tipo_doc:   d => d.tipo_doc || '',
  tipo_fat:   d => d.tipo_fatura || '',
  acao:       d => d.acao,
  historico:  d => (d.historico || '').toLowerCase()
};

function ThDoc({ k, sort, onSort, className = '', children }) {
  const ativo = sort.k === k;
  return (
    <th className={`p-2 select-none cursor-pointer whitespace-nowrap hover:text-gray-200 ${className}`}
        onClick={() => onSort(k)} title="Clique para ordenar">
      <span className="inline-flex items-center gap-0.5">
        {children}
        {ativo && (sort.asc ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
      </span>
    </th>
  );
}

function PagerDoc({ pagina, total, onChange }) {
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

function ModalDocumentos({ data, tipo, filiais, prev = 'N', v3 = {}, onClose }) {
  const [docs,   setDocs]   = useState([]);
  const [totais, setTotais] = useState({ total:0, qtd:0, realizado:0, previsto:0, qtd_realizado:0, qtd_previsto:0 });
  const [busy,   setBusy]   = useState(false);
  const [err,    setErr]    = useState('');
  const [busca,  setBusca]  = useState('');
  const [statusFiltro, setStatusFiltro] = useState('TODOS');
  // [21/09/2026 - Alexandre Carvalho] V2 do fluxo: de hoje em diante o dia soma so o SALDO EM ABERTO
  const [soAberto, setSoAberto] = useState(false);
  // [21/09/2026 - Alexandre Carvalho] grid com filtros + ordenacao + paginacao (padrao Liberacao de Data de Baixa)
  const [filFiltro,   setFilFiltro]   = useState('todas');
  const [formaFiltro, setFormaFiltro] = useState('todas');
  const [tpdFiltro,   setTpdFiltro]   = useState('todos');
  const [sort,        setSort]        = useState({ k: 'valor', asc: false });   // maior valor primeiro
  const [pagina,      setPagina]      = useState(1);
  const [verResumo,   setVerResumo]   = useState(false);   // tela sintetica DESTE dia

  const isCR = tipo === 'CR';
  const titulo = isCR ? 'Recebimentos' : 'Pagamentos';
  const corHeader = isCR ? 'text-emerald-400' : 'text-rose-400';

  useEffect(() => {
    setBusy(true); setErr('');
    api.fluxoDocs(data, tipo, filiais, prev, v3)
      .then(r => { setDocs(r.docs || []); setTotais(r.totais || { total:0, qtd:0 }); setSoAberto(!!r.filtro?.so_aberto); })
      .catch(e => setErr(e.message || 'Erro ao carregar documentos'))
      .finally(() => setBusy(false));
  }, [data, tipo, filiais, prev, v3.grupo, v3.classes, v3.d1]);

  // opcoes dos selects saem dos proprios documentos do dia (com contagem)
  const opcoes = useMemo(() => {
    const conta = (key) => {
      const m = new Map();
      for (const d of docs) { const k = key(d); if (k === '' || k == null) continue; m.set(k, (m.get(k) || 0) + 1); }
      return [...m.entries()];
    };
    return {
      filiais: conta(d => d.filial).sort((a, b) => a[0] - b[0]),
      formas:  conta(d => d.forma).sort((a, b) => b[1] - a[1]),
      tpds:    conta(d => d.tipo_doc).sort((a, b) => b[1] - a[1])
    };
  }, [docs]);

  function alternaSort(k) { setSort(s => s.k === k ? { k, asc: !s.asc } : { k, asc: true }); }

  const docsFiltrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const arr = docs.filter(d => {
      if (statusFiltro !== 'TODOS' && d.status !== statusFiltro) return false;
      if (filFiltro   !== 'todas' && String(d.filial) !== filFiltro) return false;
      if (formaFiltro !== 'todas' && d.forma !== formaFiltro) return false;
      if (tpdFiltro   !== 'todos' && d.tipo_doc !== tpdFiltro) return false;
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
        String(d.caixa_id || '').includes(q) ||
        (d.forma || '').toLowerCase().includes(q)
      );
    });
    const ex = DOCS_SORTS[sort.k] || DOCS_SORTS.valor;
    return arr.sort((a, b) => {
      const va = ex(a), vb = ex(b);
      const c = va < vb ? -1 : va > vb ? 1 : 0;
      return sort.asc ? c : -c;
    });
  }, [docs, busca, statusFiltro, filFiltro, formaFiltro, tpdFiltro, sort]);

  useEffect(() => { setPagina(1); }, [busca, statusFiltro, filFiltro, formaFiltro, tpdFiltro, sort]);
  const totPaginas = Math.max(1, Math.ceil(docsFiltrados.length / DOCS_POR_PAGINA));
  const visiveis   = docsFiltrados.slice((pagina - 1) * DOCS_POR_PAGINA, pagina * DOCS_POR_PAGINA);
  const somaFiltro = useMemo(() => docsFiltrados.reduce((s, d) => s + d.valor, 0), [docsFiltrados]);
  const filtroAtivo = !!(busca.trim() || statusFiltro !== 'TODOS' || filFiltro !== 'todas' || formaFiltro !== 'todas' || tpdFiltro !== 'todos');

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
      ...(isCR ? { 'Forma Receb.': d.forma } : {}),
      'Tipo Doc':   d.tipo_doc,
      'Tipo Fat':   d.tipo_fatura,
      Status:       d.status,
      Caixa:        d.caixa_nome ? `${d.caixa_id} - ${d.caixa_nome}` : '',
      Acao:         d.acao,
      Historico:    d.historico,
      Obs:          [d.parcial && 'baixa parcial', d.prorrogado && 'prorrogado', d.rolado && 'veio de dia nao util'].filter(Boolean).join('; ')
    }));
    linhas.push({});
    // [21/09/2026 - Alexandre Carvalho] o Excel sai com o que esta na grid (filtro + ordem); total = soma do filtro
    linhas.push({ Documento:'TOTAL', Valor: somaFiltro, Status:`${docsFiltrados.length} doc` });

    const ws = XLSX.utils.json_to_sheet(linhas);
    ws['!cols'] = [
      {wch:14},{wch:8},{wch:11},{wch:11},{wch:11},{wch:11},{wch:7},{wch:9},
      {wch:35},{wch:18},{wch:14},{wch:14},...(isCR ? [{wch:28}] : []),{wch:9},{wch:9},{wch:11},{wch:35},{wch:8},{wch:40},{wch:32}
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
      foot: [['', '', '', '', 'TOTAL =', fmt(somaFiltro), '', '', '', '']],
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
              {isCR && v3.d1 === 'S' && <> Com <b className="text-violet-300">D+1</b> ligado, o dia é o do <b className="text-gray-200">crédito em conta</b> pelo prazo da forma de recebimento.</>}
              {v3.grupo === 'N' && <> <span className="text-amber-300">Sem empresas do grupo.</span></>}
              {isCR && v3.classes && <> <span className="text-amber-300">Sem clientes classe {v3.classes.split(',').join(', ')}.</span></>}
              {(totais.qtd_rolados > 0 || totais.qtd_prorrogados > 0 || totais.qtd_parciais > 0) && (
                <span className="ml-1 text-sky-300">
                  ({[
                    totais.qtd_rolados     > 0 && `${totais.qtd_rolados} trazido${totais.qtd_rolados === 1 ? '' : 's'} de dia não útil`,
                    totais.qtd_prorrogados > 0 && `${totais.qtd_prorrogados} prorrogado${totais.qtd_prorrogados === 1 ? '' : 's'}`,
                    totais.qtd_parciais    > 0 && `${totais.qtd_parciais} com baixa parcial`,
                    totais.qtd_d1          > 0 && `${totais.qtd_d1} com prazo de crédito`
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
          {/* [21/09/2026 - Alexandre Carvalho] filtros por select (padrao Liberacao de Data de Baixa) */}
          <select className="bg-ink-800 text-xs text-gray-300 rounded px-2 py-1.5 outline-none"
                  value={filFiltro} onChange={e => setFilFiltro(e.target.value)}>
            <option value="todas">Todas as filiais</option>
            {opcoes.filiais.map(([f, n]) => <option key={f} value={String(f)}>Filial {f} ({fmtN(n)})</option>)}
          </select>
          {isCR && (
            <select className="bg-ink-800 text-xs text-gray-300 rounded px-2 py-1.5 outline-none max-w-[240px]"
                    value={formaFiltro} onChange={e => setFormaFiltro(e.target.value)}>
              <option value="todas">Todas as formas de receb.</option>
              {opcoes.formas.map(([f, n]) => <option key={f} value={f}>{f} ({fmtN(n)})</option>)}
            </select>
          )}
          <select className="bg-ink-800 text-xs text-gray-300 rounded px-2 py-1.5 outline-none"
                  value={tpdFiltro} onChange={e => setTpdFiltro(e.target.value)}>
            <option value="todos">Todos os tipos de doc.</option>
            {opcoes.tpds.map(([t, n]) => <option key={t} value={t}>{t} ({fmtN(n)})</option>)}
          </select>
          {filtroAtivo && (
            <button className="text-xs text-gray-400 hover:text-white underline"
                    onClick={() => { setBusca(''); setStatusFiltro('TODOS'); setFilFiltro('todas'); setFormaFiltro('todas'); setTpdFiltro('todos'); }}>
              limpar
            </button>
          )}
          <div className="flex-1"/>
          <button className="btn-ghost" onClick={() => setVerResumo(true)} disabled={busy || docs.length === 0}
                  title={`Tela sintética deste dia: total por ${isCR ? 'tipo de cobrança e por cliente' : 'fornecedor'}`}>
            <TrendingUp size={14}/> Resumo
          </button>
          <button className="btn-ghost" onClick={exportXlsx} disabled={busy || docs.length === 0}>
            <FileSpreadsheet size={14}/> Excel
          </button>
          <button className="btn-ghost" onClick={exportPdf} disabled={busy || docs.length === 0}>
            <FileText size={14}/> PDF
          </button>
        </div>

        {/* resumo do filtro + paginacao */}
        <div className="px-4 py-2 bg-ink-900/50 border-b border-ink-800 text-xs text-gray-400 flex flex-wrap gap-4 items-center">
          <span>{fmtN(docsFiltrados.length)} de {fmtN(docs.length)} documento(s) no filtro</span>
          <span>Soma: <span className={`font-mono ${corHeader}`}>{fmt(somaFiltro)}</span></span>
          <span className="text-gray-500 hidden md:inline">clique no título da coluna para ordenar</span>
          <PagerDoc pagina={pagina} total={totPaginas} onChange={setPagina} />
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
                  <ThDoc k="documento"  sort={sort} onSort={alternaSort} className="text-left pl-4">Documento</ThDoc>
                  <ThDoc k="parcela"    sort={sort} onSort={alternaSort} className="text-center">Parc</ThDoc>
                  <ThDoc k="vencimento" sort={sort} onSort={alternaSort} className="text-center">Vcto</ThDoc>
                  <ThDoc k="venc_pror"  sort={sort} onSort={alternaSort} className="text-center">Vcto Prorr</ThDoc>
                  <ThDoc k="emissao"    sort={sort} onSort={alternaSort} className="text-center">Emissão</ThDoc>
                  <ThDoc k="entrada"    sort={sort} onSort={alternaSort} className="text-center">Entrada</ThDoc>
                  <ThDoc k="filial"     sort={sort} onSort={alternaSort} className="text-center">Fil</ThDoc>
                  <ThDoc k="agente"     sort={sort} onSort={alternaSort} className="text-left">Agente</ThDoc>
                  <ThDoc k="cgc"        sort={sort} onSort={alternaSort} className="text-left">CNPJ/CPF</ThDoc>
                  <ThDoc k="valor"      sort={sort} onSort={alternaSort} className="text-right">Valor</ThDoc>
                  {isCR && <ThDoc k="forma" sort={sort} onSort={alternaSort} className="text-left">Forma Receb.</ThDoc>}
                  <ThDoc k="status"     sort={sort} onSort={alternaSort} className="text-center">Status</ThDoc>
                  <ThDoc k="caixa"      sort={sort} onSort={alternaSort} className="text-left">Caixa</ThDoc>
                  <ThDoc k="tipo_doc"   sort={sort} onSort={alternaSort} className="text-center">Tipo Doc</ThDoc>
                  <ThDoc k="tipo_fat"   sort={sort} onSort={alternaSort} className="text-center">Tipo Fat</ThDoc>
                  <ThDoc k="acao"       sort={sort} onSort={alternaSort} className="text-center">Ação</ThDoc>
                  <ThDoc k="historico"  sort={sort} onSort={alternaSort} className="text-left pr-4">Histórico</ThDoc>
                </tr>
              </thead>
              <tbody>
                {visiveis.map((d, i) => (
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
                              title={`Vence em ${fmtBr(d.data_base)} (dia não útil) — pagamento em ${fmtBr(d.dt_pagto || data)}`}>dia útil</span>
                      )}
                      {/* [21/09/2026 - Alexandre Carvalho] V3: o dia da celula e o do CREDITO em conta (prazo da forma) */}
                      {d.d1 && (
                        <span className="ml-1 text-[9px] px-1 py-0.5 rounded bg-violet-900/50 text-violet-300 border border-violet-700/40 font-sans"
                              title={`Pagamento em ${fmtBr(d.dt_pagto)} · crédito em conta em ${fmtBr(data)} (prazo da forma: ${d.prazo_cor} dia(s) corrido(s) + ${d.prazo_ute} útil(eis))`}>
                          {d.prazo_cor ? `${d.prazo_cor}+${d.prazo_ute}` : `D+${d.prazo_ute}`}
                        </span>
                      )}
                    </td>
                    <td className="p-2 text-center font-mono text-gray-500">{fmtBr(d.emissao)}</td>
                    <td className="p-2 text-center font-mono text-gray-500">{fmtBr(d.entrada)}</td>
                    <td className="p-2 text-center font-mono text-gray-300">{d.filial}</td>
                    <td className="p-2 max-w-[280px] truncate" title={`${d.cod_agente} - ${d.nome_agente}`}>
                      <span className="text-gray-500">{d.cod_agente}</span> {d.nome_agente}
                      {isCR && d.classe && (
                        <span className={`ml-1 text-[9px] px-1 py-0.5 rounded font-bold
                          ${'DE'.includes(d.classe) ? 'bg-rose-900/50 text-rose-300' : d.classe === 'C' ? 'bg-amber-900/40 text-amber-300' : 'bg-ink-700 text-gray-400'}`}
                          title="Classe do cliente na Inteligência de Crédito">{d.classe}</span>
                      )}
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
                    {isCR && <td className="p-2 text-gray-300 max-w-[180px] truncate" title={d.forma}>{d.forma}</td>}
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
                    {fmt(somaFiltro)}
                  </td>
                  <td colSpan={isCR ? 7 : 6}></td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
      {verResumo && <ModalResumo dataIni={data} dataFim={data} tipo={tipo} filiais={filiais} prev={prev} v3={v3} onClose={() => setVerResumo(false)} />}
    </div>
  );
}
