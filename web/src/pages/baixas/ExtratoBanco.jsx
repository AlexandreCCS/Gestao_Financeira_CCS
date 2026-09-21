// [21/09/2026 - CRIADO POR ALEXANDRE CARVALHO] Fluxo > Contas a pagar > EXTRATO DO BANCO x MEGA.
// "Arrasto o arquivo da conciliacao e a tela diz o que, pelo que o banco ja movimentou, deveria estar BAIXADO e
// CONCILIADO no Mega." Pedido do Alexandre, com a Renata (Quality).
// O arquivo (.RET CNAB 240 de extrato) e LIDO AQUI NO NAVEGADOR (cnab240.js); para a API vao so os lancamentos ja lidos -
// nada e gravado. A API (/fluxo-previo/extrato/analisar) casa cada lancamento com o Mega e devolve a situacao:
//   ok (baixado e conciliado) | conciliar (baixado, falta conciliar) | baixar (o banco pagou/recebeu e nao ha baixa; vem com
//   sugestao de titulo) | lancar (tarifa/transferencia sem lancamento) | informativo (aplicacao automatica).
import React, { useMemo, useRef, useState } from 'react';
import { UploadCloud, FileCheck2, X, CheckCircle2, AlertTriangle, Link2, FilePlus2, Info, Search, FileSpreadsheet,
         ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Landmark, Sparkles } from 'lucide-react';
import * as XLSX from 'xlsx';
import { api } from '../../api/client';
import { lerExtratoCnab240 } from './cnab240';

const fmt   = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtN  = v => Number(v || 0).toLocaleString('pt-BR');
const fmtBr = iso => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');

const SIT = {
  baixar:      { l: 'Baixar no Mega',      curto: 'Falta baixar',     cor: 'rose',    icon: AlertTriangle, frase: 'o banco já movimentou e não há baixa no Mega' },
  conciliar:   { l: 'Conciliar',           curto: 'Falta conciliar',  cor: 'amber',   icon: Link2,         frase: 'está baixado no Mega, só falta conciliar com o extrato' },
  lancar:      { l: 'Lançar no Mega',      curto: 'Falta lançar',     cor: 'sky',     icon: FilePlus2,     frase: 'tarifa, transferência ou cobrança sem lançamento no Mega' },
  ok:          { l: 'Tudo certo',          curto: 'Certo',            cor: 'emerald', icon: CheckCircle2,  frase: 'baixado e conciliado' },
  informativo: { l: 'Aplicação automática', curto: 'Informativo',     cor: 'gray',    icon: Info,          frase: 'vai e volta do investimento do banco — não é título' }
};
const COR = {
  rose:    { borda: 'border-rose-500',    txt: 'text-rose-400',    chip: 'bg-rose-900/40 text-rose-300 border-rose-700/40',          barra: 'bg-rose-500' },
  amber:   { borda: 'border-amber-500',   txt: 'text-amber-400',   chip: 'bg-amber-900/40 text-amber-300 border-amber-700/40',       barra: 'bg-amber-500' },
  sky:     { borda: 'border-sky-500',     txt: 'text-sky-400',     chip: 'bg-sky-900/40 text-sky-300 border-sky-700/40',             barra: 'bg-sky-500' },
  emerald: { borda: 'border-emerald-500', txt: 'text-emerald-400', chip: 'bg-emerald-900/40 text-emerald-300 border-emerald-700/40', barra: 'bg-emerald-500' },
  gray:    { borda: 'border-gray-600',    txt: 'text-gray-300',    chip: 'bg-ink-700 text-gray-300 border-ink-600',                  barra: 'bg-gray-500' }
};
const TIPO = { pagamento: 'Pagamento', recebimento: 'Recebimento', tarifa: 'Tarifa', transferencia: 'Transferência', cobranca: 'Cobrança (lote)', aplicacao: 'Aplicação' };
const CONF = { alta: ['nome e valor conferem', 'text-emerald-300'], media: ['valor e vencimento próximos', 'text-amber-300'], baixa: ['só o valor confere', 'text-gray-400'] };

export default function ExtratoBanco() {
  const [arquivos, setArquivos] = useState([]);     // [{ nome, extrato }]
  const [analise,  setAnalise]  = useState(null);   // resposta da API
  const [busy,     setBusy]     = useState(false);
  const [erro,     setErro]     = useState('');
  const [sobre,    setSobre]    = useState(false);  // arrastando por cima
  const [modal,    setModal]    = useState(null);   // { titulo, filtro }
  const input = useRef(null);

  async function receber(fileList) {
    setErro('');
    const novos = [];
    for (const file of [...fileList]) {
      try {
        const buf = await file.arrayBuffer();
        const extrato = lerExtratoCnab240(new TextDecoder('latin1').decode(buf), file.name);
        novos.push({ nome: file.name, extrato });
      } catch (e) { setErro(`${file.name}: ${e.message}`); }
    }
    if (!novos.length) return;
    const todos = [...arquivos.filter(a => !novos.some(n => n.nome === a.nome)), ...novos];
    setArquivos(todos); await analisar(todos);
  }

  async function analisar(lista) {
    if (!lista.length) { setAnalise(null); return; }
    setBusy(true);
    try {
      // junta por banco+agencia+conta (dois arquivos da mesma conta viram um bloco) e tira lancamento repetido entre arquivos
      const m = new Map();
      for (const a of lista) for (const c of a.extrato.contas) {
        const k = `${a.extrato.banco}|${c.agencia}|${c.conta}`;
        const g = m.get(k) || { banco: a.extrato.banco, agencia: c.agencia, conta: c.conta, dv: c.dv, vistos: new Set(), lancamentos: [] };
        for (const l of c.lancamentos) { const id = `${l.data}|${l.dc}|${l.valor}|${l.historico}|${l.seq}`; if (!g.vistos.has(id)) { g.vistos.add(id); g.lancamentos.push(l); } }
        m.set(k, g);
      }
      const r = await api.fluxoExtratoAnalisar([...m.values()].map(({ vistos, ...c }) => c));
      setAnalise(r);
    } catch (e) { setErro(e.message || 'Erro ao analisar o extrato'); setAnalise(null); }
    finally { setBusy(false); }
  }

  const remover = nome => { const t = arquivos.filter(a => a.nome !== nome); setArquivos(t); analisar(t); };

  // ---- agregados --------------------------------------------------------------------------------------------
  const L = useMemo(() => (analise?.contas || []).flatMap(c => c.linhas.map(l => ({ ...l, conta_nome: c.agn_nome, conta_id: c.agn_id }))), [analise]);
  const R = useMemo(() => {
    const g = k => L.filter(l => l.situacao === k), s = arr => arr.reduce((a, l) => a + l.valor, 0);
    const out = {}; for (const k of Object.keys(SIT)) out[k] = { qt: g(k).length, valor: s(g(k)), linhas: g(k) };
    const relevantes = L.filter(l => l.situacao !== 'informativo');
    out.total = relevantes.length; out.feitos = out.ok.qt; out.pct = relevantes.length ? out.ok.qt / relevantes.length * 100 : 0;
    out.naoImportados = L.filter(l => !l.importado).length;
    return out;
  }, [L]);
  const naoAchadas = (analise?.contas || []).filter(c => !c.encontrada);

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-2.5 bg-ink-900 border-b border-ink-700 flex items-center gap-2 text-sm font-semibold">
        <Sparkles size={16} className="text-prim-400" /> O que o banco já fez × o que está no Mega
        <span className="ml-auto text-xs font-normal text-gray-500">arraste o extrato do banco e veja o que falta baixar e conciliar</span>
      </div>

      <div className="p-4 space-y-4">
        {/* ------------------------------------------------------------ zona de arrastar */}
        <div
          onDragOver={e => { e.preventDefault(); setSobre(true); }} onDragLeave={() => setSobre(false)}
          onDrop={e => { e.preventDefault(); setSobre(false); receber(e.dataTransfer.files); }}
          onClick={() => input.current?.click()}
          className={`rounded-lg border-2 border-dashed cursor-pointer transition-all duration-200 flex items-center gap-4 px-5
            ${arquivos.length ? 'py-3' : 'py-8 justify-center'}
            ${sobre ? 'border-prim-400 bg-prim-900/30 scale-[1.01]' : 'border-ink-600 hover:border-prim-500/60 hover:bg-ink-800/40'}`}>
          <input ref={input} type="file" multiple accept=".ret,.RET,.txt,.TXT" className="hidden" onChange={e => { receber(e.target.files); e.target.value = ''; }} />
          <UploadCloud size={arquivos.length ? 22 : 38} className={`shrink-0 transition ${sobre ? 'text-prim-300 animate-bounce' : 'text-prim-500'}`} />
          <div className={arquivos.length ? '' : 'text-center'}>
            <div className={`font-semibold text-gray-100 ${arquivos.length ? 'text-sm' : 'text-base'}`}>
              {sobre ? 'Pode soltar 👇' : arquivos.length ? 'Arraste mais extratos ou clique para escolher' : 'Arraste aqui o arquivo de conciliação do banco'}
            </div>
            <div className="text-xs text-gray-400 mt-0.5">
              Extrato CNAB 240 (.RET) — vários de uma vez, de contas e dias diferentes. O arquivo é lido aqui no seu navegador; nada é gravado.
            </div>
          </div>
        </div>

        {erro && <div className="bg-red-900/40 text-red-200 text-sm rounded p-3">{erro}</div>}

        {/* ------------------------------------------------------------ arquivos lidos (raio-x) */}
        {arquivos.length > 0 && (
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
            {arquivos.map(a => a.extrato.contas.map(c => {
              const cc = c.lotes.find(x => x.natureza !== 'APL') || c.lotes[0], apl = c.lotes.find(x => x.natureza === 'APL');
              const meg = analise?.contas.find(x => x.agencia === c.agencia && x.conta === c.conta);
              return (
                <div key={`${a.nome}-${c.agencia}-${c.conta}`} className="rounded bg-ink-800/60 border border-ink-700 p-3 text-xs">
                  <div className="flex items-start gap-2">
                    <FileCheck2 size={16} className="text-emerald-400 shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-gray-100 truncate" title={a.nome}>{a.nome}</div>
                      <div className="text-gray-400">{a.extrato.banco_nome || `Banco ${a.extrato.banco}`} · ag. {String(parseInt(c.agencia, 10))} · c/c {String(parseInt(c.conta, 10))}-{c.dv}</div>
                    </div>
                    <button className="text-gray-500 hover:text-white" title="Tirar este arquivo" onClick={e => { e.stopPropagation(); remover(a.nome); }}><X size={15} /></button>
                  </div>
                  <div className="mt-2 space-y-0.5 text-gray-300">
                    <div className="flex items-center gap-1"><Landmark size={12} className="text-sky-400" />
                      {meg ? (meg.encontrada ? <span className="text-sky-300 truncate" title={meg.agn_nome}>{meg.agn_id} · {meg.agn_nome}</span> : <span className="text-rose-300">conta não cadastrada no Mega</span>) : <span className="text-gray-500">localizando a conta…</span>}
                    </div>
                    <div>{fmtN(c.lancamentos.length)} lançamento(s) · {c.periodo.ini === c.periodo.fim ? fmtBr(c.periodo.ini) : `${fmtBr(c.periodo.ini)} a ${fmtBr(c.periodo.fim)}`}</div>
                    {cc?.saldo_final && <div>Saldo da conta no banco: <b className={cc.saldo_final.valor < 0 ? 'text-rose-300' : 'text-emerald-300'}>{fmt(cc.saldo_final.valor)}</b> <span className="text-gray-500">em {fmtBr(cc.saldo_final.data)}{cc.saldo_final.posicao === 'P' ? ' (parcial)' : ''}</span></div>}
                    {apl?.saldo_final && <div>Aplicação automática: <b className="text-emerald-300">{fmt(apl.saldo_final.valor)}</b> <span className="text-gray-500">em {fmtBr(apl.saldo_final.data)}</span></div>}
                    {cc?.saldo_final && apl?.saldo_final && cc.saldo_final.valor < 0 && <div className="text-[11px] text-gray-500">a conta aparece negativa porque o dinheiro está na aplicação</div>}
                  </div>
                </div>);
            }))}
          </div>
        )}

        {busy && <div className="text-sm text-gray-400 flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-prim-500 animate-pulse" /> cruzando o extrato com o Mega…</div>}
        {naoAchadas.length > 0 && <div className="bg-rose-900/30 border border-rose-700/40 text-rose-200 text-xs rounded p-3">Não achei no cadastro de contas do Mega: {naoAchadas.map(c => `banco ${c.banco} ag. ${parseInt(c.agencia, 10)} c/c ${parseInt(c.conta, 10)}`).join(' · ')}. Confira banco, agência e número no cadastro da conta financeira.</div>}

        {/* ------------------------------------------------------------ veredito */}
        {analise && L.length > 0 && !busy && (
          <>
            <div>
              <div className="flex items-end justify-between mb-1.5">
                <div className="text-sm text-gray-200">
                  De <b>{fmtN(R.total)}</b> movimento(s) do banco, <b className="text-emerald-400">{fmtN(R.feitos)}</b> já est{R.feitos === 1 ? 'á' : 'ão'} baixado(s) e conciliado(s) no Mega.
                  {R.baixar.qt + R.conciliar.qt + R.lancar.qt > 0 ? <> Falta trabalhar <b className="text-rose-300">{fmtN(R.baixar.qt + R.conciliar.qt + R.lancar.qt)}</b>.</> : <> <b className="text-emerald-400">Nada pendente. 🎯</b></>}
                </div>
                <div className="text-2xl font-bold text-emerald-400">{R.pct.toFixed(0)}%</div>
              </div>
              <div className="h-4 rounded overflow-hidden flex bg-ink-800">
                {['ok', 'conciliar', 'lancar', 'baixar'].map(k => R[k].qt > 0 && (
                  <button key={k} className={`${COR[SIT[k].cor].barra} h-full hover:brightness-125 transition`} style={{ width: `${R[k].qt / R.total * 100}%` }}
                          title={`${SIT[k].l}: ${fmtN(R[k].qt)} · ${fmt(R[k].valor)}`} onClick={() => setModal({ titulo: SIT[k].l, filtro: k })} />))}
              </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {['baixar', 'conciliar', 'lancar', 'ok'].map(k => { const S = SIT[k], C = COR[S.cor], I = S.icon; return (
                <button key={k} onClick={() => setModal({ titulo: S.l, filtro: k })} disabled={!R[k].qt}
                        className={`kpi border-l-4 ${C.borda} text-left transition hover:brightness-125 hover:-translate-y-0.5 disabled:opacity-40 disabled:hover:translate-y-0`}>
                  <div className="kpi-label flex items-center gap-1"><I size={15} /> {S.l}</div>
                  <div className={`kpi-value ${C.txt}`}>{fmtN(R[k].qt)}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{fmt(R[k].valor)}</div>
                  <div className="text-[11px] text-gray-500 mt-1 leading-snug">{S.frase}</div>
                </button>); })}
            </div>

            <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-gray-500">
              {R.informativo.qt > 0 && <button className="hover:text-gray-300 underline decoration-dotted" onClick={() => setModal({ titulo: SIT.informativo.l, filtro: 'informativo' })}>
                {fmtN(R.informativo.qt)} movimento(s) de aplicação automática ({fmt(R.informativo.valor)}) ficaram de fora da conta</button>}
              {R.naoImportados > 0
                ? <span className="text-amber-300">⚠ {fmtN(R.naoImportados)} lançamento(s) deste arquivo ainda NÃO foram importados na conciliação do Mega</span>
                : <span>✓ todas as linhas deste extrato já estão importadas na conciliação do Mega</span>}
            </div>

            {/* ------------------------------------------------------ a lista de trabalho */}
            {R.baixar.qt > 0 && (
              <div className="rounded border border-rose-800/40 overflow-hidden">
                <div className="px-3 py-2 bg-rose-950/40 text-sm font-semibold text-rose-200 flex items-center gap-2"><AlertTriangle size={15} /> Comece por aqui — o banco já pagou/recebeu e não há baixa no Mega
                  <button className="ml-auto text-xs font-normal text-rose-300 hover:underline" onClick={() => setModal({ titulo: SIT.baixar.l, filtro: 'baixar' })}>ver os {fmtN(R.baixar.qt)} →</button></div>
                <table className="w-full text-xs">
                  <thead className="text-gray-500 uppercase text-[10px]"><tr><th className="text-center p-2">Data</th><th className="text-left p-2">O banco diz</th><th className="text-right p-2">Valor</th><th className="text-left p-2 pl-4">Título que parece ser</th></tr></thead>
                  <tbody>{[...R.baixar.linhas].sort((a, b) => b.valor - a.valor).slice(0, 8).map((l, i) => { const s = l.sugestoes[0]; return (
                    <tr key={i} className="border-t border-ink-800">
                      <td className="p-2 text-center font-mono text-gray-300">{fmtBr(l.data)}</td>
                      <td className="p-2 text-gray-200">{l.historico} <span className="text-gray-600">{l.dc === 'D' ? 'saída' : 'entrada'}</span></td>
                      <td className={`p-2 text-right font-mono font-semibold ${l.dc === 'D' ? 'text-rose-300' : 'text-emerald-300'}`}>{fmt(l.valor)}</td>
                      <td className="p-2 pl-4">{s ? <><span className="text-gray-200">{s.nome}</span> <span className="font-mono text-gray-400">{s.doc}/{s.parcela}</span> <span className="text-gray-500">venc. {fmtBr(s.venc)} · emp. {s.fil_id}</span> <span className={`text-[10px] ${CONF[s.confianca][1]}`}>· {CONF[s.confianca][0]}</span>{l.sugestoes.length > 1 && <span className="text-[10px] text-gray-500"> · +{l.sugestoes.length - 1} candidato(s)</span>}</>
                        : <span className="text-gray-500 italic">nenhum título em aberto com esse valor</span>}</td>
                    </tr>); })}</tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {modal && <ModalLinhas titulo={modal.titulo} inicial={modal.filtro} linhas={L} onClose={() => setModal(null)} />}
    </div>
  );
}

// ================================================================================================ modal analitico
const POR_PAGINA = 100;
const ORD = { data: l => l.data, hist: l => l.historico.toLowerCase(), valor: l => l.valor, tipo: l => l.tipo, sit: l => l.situacao, conta: l => l.conta_nome || '',
              mega: l => (l.mov?.contraparte || l.sugestoes[0]?.nome || '').toLowerCase() };

function ModalLinhas({ titulo, inicial, linhas, onClose }) {
  const [sit,    setSit]    = useState(inicial || 'todas');
  const [tipo,   setTipo]   = useState('todos');
  const [busca,  setBusca]  = useState('');
  const [sort,   setSort]   = useState({ k: 'valor', asc: false });
  const [pagina, setPagina] = useState(1);
  const [aberta, setAberta] = useState(null);

  const vis0 = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const arr = linhas.filter(l => (sit === 'todas' || l.situacao === sit) && (tipo === 'todos' || l.tipo === tipo) &&
      (!q || l.historico.toLowerCase().includes(q) || String(l.valor).includes(q) || (l.mov?.contraparte || '').toLowerCase().includes(q) || l.sugestoes.some(s => s.nome.toLowerCase().includes(q) || s.doc.includes(q))));
    const ex = ORD[sort.k] || ORD.valor;
    return arr.sort((a, b) => { const va = ex(a), vb = ex(b); const r = va < vb ? -1 : va > vb ? 1 : 0; return sort.asc ? r : -r; });
  }, [linhas, sit, tipo, busca, sort]);
  const tot = Math.max(1, Math.ceil(vis0.length / POR_PAGINA)), vis = vis0.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);
  const alterna = k => { setSort(s => s.k === k ? { k, asc: !s.asc } : { k, asc: true }); setPagina(1); };
  const Th = ({ k, children, className = '' }) => (<th className={`p-2 select-none cursor-pointer whitespace-nowrap hover:text-gray-200 ${className}`} onClick={() => alterna(k)}>
    <span className="inline-flex items-center gap-0.5">{children}{sort.k === k && (sort.asc ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}</span></th>);

  function excel() {
    const ws = XLSX.utils.json_to_sheet(vis0.map(l => ({
      'Situação': SIT[l.situacao].l, Tipo: TIPO[l.tipo] || l.tipo, 'Conta (Mega)': l.conta_nome, Data: fmtBr(l.data), 'Entrada/saída': l.dc === 'D' ? 'Saída' : 'Entrada',
      'Histórico do banco': l.historico, Valor: l.valor, 'Importado no Mega': l.importado ? 'Sim' : 'Não', 'Linha conciliada no Mega': l.extrato_conciliado ? 'Sim' : 'Não',
      'Baixa no Mega em': fmtBr(l.mov?.data), 'Doc. da baixa': l.mov?.doc || '', 'Fornecedor/cliente da baixa': l.mov?.contraparte || '', 'Título da baixa': l.mov?.titulo || '',
      'Sugestão: fornecedor/cliente': l.sugestoes[0]?.nome || '', 'Sugestão: título': l.sugestoes[0] ? `${l.sugestoes[0].doc}/${l.sugestoes[0].parcela}` : '',
      'Sugestão: vencimento': fmtBr(l.sugestoes[0]?.venc), 'Sugestão: empresa': l.sugestoes[0]?.fil_id || '', 'Confiança': l.sugestoes[0] ? CONF[l.sugestoes[0].confianca][0] : '',
      'Outros candidatos': l.sugestoes.slice(1).map(s => `${s.nome} ${s.doc}/${s.parcela} (${fmtBr(s.venc)})`).join(' | ') })));
    ws['!cols'] = [18, 14, 40, 11, 12, 30, 14, 14, 18, 14, 14, 40, 14, 40, 14, 14, 10, 26, 60].map(w => ({ wch: w }));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Extrato x Mega');
    XLSX.writeFile(wb, `extrato-x-mega-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  return (
    <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-3">
      <div className="bg-ink-900 rounded-lg w-[97vw] max-w-[1500px] max-h-[94vh] flex flex-col border border-prim-700/30 shadow-2xl">
        <div className="flex items-start justify-between p-5 border-b border-ink-700">
          <div>
            {/* o titulo acompanha o filtro de situacao escolhido dentro do modal */}
            <h3 className="text-xl font-bold text-prim-400">Extrato do banco × Mega — {sit === 'todas' ? 'todos os lançamentos' : (SIT[sit]?.l || titulo)}</h3>
            <div className="text-xs text-gray-400 mt-1"><b className="text-gray-200">{fmtN(vis0.length)}</b> de {fmtN(linhas.length)} lançamento(s) · soma <b className="text-gray-200">{fmt(vis0.reduce((s, l) => s + l.valor, 0))}</b> · clique na linha para ver o que há no Mega e os candidatos</div>
          </div>
          <button className="text-gray-400 hover:text-white" onClick={onClose}><X size={22} /></button>
        </div>
        <div className="flex flex-wrap items-center gap-2 p-3 border-b border-ink-800 bg-ink-900/40">
          <div className="relative"><Search size={14} className="absolute left-2 top-2.5 text-gray-500" />
            <input className="bg-ink-800 border border-ink-700 rounded pl-7 pr-3 py-1.5 text-sm w-72" placeholder="Buscar histórico, valor, fornecedor, título..." value={busca} onChange={e => { setBusca(e.target.value); setPagina(1); }} /></div>
          <div className="flex gap-1">{[['todas', 'Todas'], ...Object.entries(SIT).map(([k, v]) => [k, v.curto])].map(([k, l]) => (
            <button key={k} onClick={() => { setSit(k); setPagina(1); }} className={`px-3 py-1 rounded text-xs transition ${sit === k ? 'bg-prim-600 text-white' : 'bg-ink-800 hover:bg-ink-700 text-gray-300'}`}>{l}</button>))}</div>
          <select className="bg-ink-800 text-xs text-gray-300 rounded px-2 py-1.5 outline-none" value={tipo} onChange={e => { setTipo(e.target.value); setPagina(1); }}>
            <option value="todos">Todos os tipos</option>{Object.entries(TIPO).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <div className="flex-1" />
          {tot > 1 && <span className="flex items-center gap-1 text-xs text-gray-400">
            <button className="p-1 rounded hover:bg-ink-700 disabled:opacity-30" disabled={pagina <= 1} onClick={() => setPagina(p => p - 1)}><ChevronLeft size={14} /></button>{pagina}/{fmtN(tot)}
            <button className="p-1 rounded hover:bg-ink-700 disabled:opacity-30" disabled={pagina >= tot} onClick={() => setPagina(p => p + 1)}><ChevronRight size={14} /></button></span>}
          <button className="btn-ghost" onClick={excel} disabled={!vis0.length}><FileSpreadsheet size={14} /> Excel</button>
        </div>
        <div className="overflow-auto flex-1">
          <table className="w-full text-xs">
            <thead className="bg-ink-900 text-gray-400 uppercase sticky top-0 z-10"><tr>
              <Th k="sit" className="text-left pl-4">Situação</Th><Th k="data" className="text-center">Data</Th><Th k="hist" className="text-left">O banco diz</Th><Th k="tipo" className="text-left">Tipo</Th>
              <Th k="valor" className="text-right">Valor</Th><Th k="mega" className="text-left pl-4">No Mega / título que parece ser</Th><Th k="conta" className="text-left pr-4">Conta</Th></tr></thead>
            <tbody>{vis.map((l, i) => { const S = SIT[l.situacao], C = COR[S.cor], s = l.sugestoes[0], k = `${l.seq}-${i}`; return (
              <React.Fragment key={k}>
                <tr className={`border-b border-ink-800 hover:bg-ink-800/40 cursor-pointer ${aberta === k ? 'bg-ink-800/60' : ''}`} onClick={() => setAberta(a => a === k ? null : k)}>
                  <td className="p-2 pl-4 whitespace-nowrap"><span className={`text-[10px] px-2 py-0.5 rounded border ${C.chip}`}>{S.curto}</span></td>
                  <td className="p-2 text-center font-mono">{fmtBr(l.data)}</td>
                  <td className="p-2 text-gray-200">{l.historico}</td>
                  <td className="p-2 text-gray-400">{TIPO[l.tipo] || l.tipo}</td>
                  <td className={`p-2 text-right font-mono font-semibold whitespace-nowrap ${l.dc === 'D' ? 'text-rose-300' : 'text-emerald-300'}`}>{l.dc === 'D' ? '−' : '+'} {fmt(l.valor)}</td>
                  <td className="p-2 pl-4">{l.mov
                    ? <><span className="text-gray-300">{l.mov.contraparte || l.mov.historico || 'lançamento na conta'}</span> {l.mov.titulo && <span className="font-mono text-gray-500">{l.mov.titulo}</span>} <span className="text-gray-500">· baixa de {fmtBr(l.mov.data)}{l.mov.dif_dias ? ` (${l.mov.dif_dias > 0 ? '+' : ''}${l.mov.dif_dias} d)` : ''}</span></>
                    : s ? <><span className="text-gray-200">{s.nome}</span> <span className="font-mono text-gray-400">{s.doc}/{s.parcela}</span> <span className="text-gray-500">venc. {fmtBr(s.venc)}</span> <span className={`text-[10px] ${CONF[s.confianca][1]}`}>· {CONF[s.confianca][0]}</span></>
                    : <span className="text-gray-600">—</span>}</td>
                  <td className="p-2 pr-4 max-w-[220px] truncate text-gray-500" title={l.conta_nome}>{l.conta_nome}</td>
                </tr>
                {aberta === k && (
                  <tr className="bg-ink-950/60 border-b border-ink-700"><td colSpan={7} className="p-4 text-xs">
                    <div className="grid md:grid-cols-2 gap-6">
                      <div className="space-y-1">
                        <div className="text-[10px] uppercase text-gray-500 mb-1">No extrato do banco</div>
                        <div><span className="text-gray-500">Lançamento: </span><span className="text-gray-200">{l.historico} · {fmtBr(l.data)} · {l.dc === 'D' ? 'saída' : 'entrada'} de {fmt(l.valor)}</span></div>
                        <div><span className="text-gray-500">Na conciliação do Mega: </span>{l.importado ? <span className="text-gray-200">importado{l.importado_em ? ` em ${fmtBr(l.importado_em)} ${l.importado_em.slice(11)}` : ''} · {l.extrato_conciliado ? <span className="text-emerald-300">conciliado</span> : <span className="text-amber-300">pendente de conciliar</span>}</span> : <span className="text-amber-300">este lançamento ainda não foi importado</span>}</div>
                        <div className="text-gray-400 pt-1">➜ {l.situacao === 'ok' ? 'Nada a fazer.' : l.situacao === 'conciliar' ? 'Conciliar este lançamento com a baixa ao lado.' : l.situacao === 'baixar' ? (s ? 'Baixar o título sugerido nesta conta, na data do banco, e conciliar.' : 'Localizar o título (ou lançar avulso), baixar nesta conta e conciliar.') : l.situacao === 'lancar' ? 'Lançar no Mega (despesa bancária, transferência entre contas ou cobrança) e conciliar.' : 'Movimento interno do banco entre a conta e a aplicação automática.'}</div>
                      </div>
                      <div className="space-y-1">
                        <div className="text-[10px] uppercase text-gray-500 mb-1">{l.mov ? 'Baixa encontrada no Mega' : 'Títulos em aberto com o mesmo valor'}</div>
                        {l.mov ? <>
                          <div><span className="text-gray-500">Data / doc.: </span><span className="text-gray-200">{fmtBr(l.mov.data)} · {l.mov.doc || '—'} · {l.mov.tpd} · ação {l.mov.acao}</span></div>
                          <div><span className="text-gray-500">{l.dc === 'D' ? 'Fornecedor' : 'Cliente'} / título: </span><span className="text-gray-200">{l.mov.contraparte ? `${l.mov.contraparte_id} - ${l.mov.contraparte} · ${l.mov.titulo}` : 'sem título vinculado (lançamento avulso)'}</span></div>
                          <div><span className="text-gray-500">Conciliado: </span>{l.mov.conciliado ? <span className="text-emerald-300">sim</span> : <span className="text-amber-300">não</span>}</div>
                        </> : l.sugestoes.length ? l.sugestoes.map((x, j) => (
                          <div key={x.id} className={j === 0 ? 'text-gray-200' : 'text-gray-400'}>{j === 0 ? '★ ' : '· '}{x.agn_id} - {x.nome} · <span className="font-mono">{x.doc}/{x.parcela}</span> {x.tpd} · venc. {fmtBr(x.venc)} · emp. {x.fil_id} · saldo {fmt(x.saldo)} <span className={`text-[10px] ${CONF[x.confianca][1]}`}>({CONF[x.confianca][0]})</span></div>))
                          : <div className="text-gray-500">Nenhum título em aberto com esse saldo entre 90 dias antes e 30 depois da data do banco.</div>}
                      </div>
                    </div>
                  </td></tr>)}
              </React.Fragment>); })}
              {vis.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-gray-500">Nada neste filtro.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
