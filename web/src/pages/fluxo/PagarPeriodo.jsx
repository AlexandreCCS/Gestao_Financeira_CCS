// [21/09/2026 - CRIADO POR ALEXANDRE CARVALHO] Fluxo de Caixa > CONTAS A PAGAR: PAGO x EM ABERTO.
// "Tudo que eu tinha para pagar ontem (semana / mes / trimestre): o que esta pago, o que nao esta e, se esta pago,
// de qual conta saiu" - VISAO DIRETIVA DE COBRANCA AO FINANCEIRO. Pedido do Alexandre com a Renata (Quality).
//
// A API (/fluxo-previo/pagar-periodo) devolve 1 linha por TITULO devido no periodo; TUDO aqui e agregado no navegador,
// entao o numero sintetico e o analitico (modal) sao sempre o mesmo e o clique abre na hora.
// "Ontem" = DIA UTIL ANTERIOR (na segunda e a sexta). Semana/mes/trimestre = o periodo que CONTEM esse dia, ate ele.
import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, Clock, Wallet, Building2, Landmark, Search, FileSpreadsheet, X, Users, Info,
  ChevronLeft, ChevronRight, ChevronUp, ChevronDown, PieChart, Target, CalendarDays
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { api } from '../../api/client';

const fmt   = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtK  = v => { const n = Number(v || 0), a = Math.abs(n);
  return a >= 1e6 ? `R$ ${(n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} mi`
       : a >= 1e3 ? `R$ ${(n / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil` : fmt(n); };
const fmtN  = v => Number(v || 0).toLocaleString('pt-BR');
const fmtBr = iso => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');
const pct   = (a, b) => (b > 0 ? a / b * 100 : 0);
const DIAS  = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

// ---- datas (sempre em ISO, meio-dia UTC para nao escorregar de dia) ------------------------------------------
const D   = iso => new Date(iso + 'T12:00:00Z');
const ISO = d => d.toISOString().slice(0, 10);
const add = (iso, n) => { const d = D(iso); d.setUTCDate(d.getUTCDate() + n); return ISO(d); };
const addM = (iso, n) => { const d = D(iso); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n); return ISO(d); };
const fimMes = iso => add(addM(iso, 1), -1);
const min = (a, b) => (a < b ? a : b);
function diaUtilAnt(iso)  { let x = add(iso, -1); while ([0, 6].includes(D(x).getUTCDay())) x = add(x, -1); return x; }
function diaUtilProx(iso) { let x = add(iso,  1); while ([0, 6].includes(D(x).getUTCDay())) x = add(x,  1); return x; }

// periodo que CONTEM a ancora; "teto" = ultimo dia util fechado (nada de hoje em diante entra: ainda nao venceu)
function periodo(tipo, ancora, teto) {
  if (tipo === 'ontem') return { ini: ancora, fim: ancora };
  if (tipo === 'semana') { const dow = (D(ancora).getUTCDay() + 6) % 7; const ini = add(ancora, -dow); return { ini, fim: min(add(ini, 6), teto) }; }
  if (tipo === 'mes') { const ini = ancora.slice(0, 8) + '01'; return { ini, fim: min(fimMes(ini), teto) }; }
  const m = Number(ancora.slice(5, 7)), q = Math.floor((m - 1) / 3) * 3 + 1;
  const ini = `${ancora.slice(0, 4)}-${String(q).padStart(2, '0')}-01`;
  return { ini, fim: min(fimMes(addM(ini, 2)), teto) };
}
const desloca = (tipo, ancora, dir) =>
  tipo === 'ontem' ? (dir < 0 ? diaUtilAnt(ancora) : diaUtilProx(ancora))
  : tipo === 'semana' ? add(ancora, 7 * dir) : addM(ancora, (tipo === 'mes' ? 1 : 3) * dir);

const TIPOS = [{ k: 'ontem', l: 'Ontem' }, { k: 'semana', l: 'Semana' }, { k: 'mes', l: 'Mês' }, { k: 'trimestre', l: 'Trimestre' }, { k: 'livre', l: 'Personalizado' }];
const STATUS = {
  pago:    { l: 'Pago',         cls: 'bg-emerald-900/40 text-emerald-300 border-emerald-700/40', barra: 'bg-emerald-500' },
  parcial: { l: 'Pago parcial', cls: 'bg-amber-900/40 text-amber-300 border-amber-700/40',       barra: 'bg-amber-500' },
  aberto:  { l: 'Em aberto',    cls: 'bg-rose-900/40 text-rose-300 border-rose-700/40',          barra: 'bg-rose-500' }
};
const PONT = { no_dia: 'No dia', antecipado: 'Antecipado', atraso: 'Com atraso', sem_conta: 'Sem saída de conta' };

export default function PagarPeriodo() {
  const [base,   setBase]   = useState(null);        // { hoje, ontem_util }
  const [tipo,   setTipo]   = useState('ontem');
  const [ancora, setAncora] = useState(null);
  const [livre,  setLivre]  = useState({ ini: '', fim: '' });
  const [filial, setFilial] = useState('todas');
  const [comGrupo, setComGrupo] = useState(true);
  const [resp,   setResp]   = useState(null);
  const [busy,   setBusy]   = useState(true);
  const [erro,   setErro]   = useState('');
  const [analise, setAnalise] = useState(null);      // { titulo, filtro(fn), status? } -> abre o modal analitico

  useEffect(() => {
    api.fluxoPagarBase().then(b => { setBase(b); setAncora(b.ontem_util); setLivre({ ini: b.ontem_util, fim: b.ontem_util }); })
      .catch(e => { setErro(e.message || 'Erro ao carregar'); setBusy(false); });
  }, []);

  const per = useMemo(() => {
    if (!base || !ancora) return null;
    if (tipo === 'livre') return (livre.ini && livre.fim && livre.ini <= livre.fim) ? { ini: livre.ini, fim: min(livre.fim, base.ontem_util) } : null;
    return periodo(tipo, ancora, base.ontem_util);
  }, [base, tipo, ancora, livre]);
  const cmp = useMemo(() => (per && tipo !== 'livre') ? periodo(tipo, desloca(tipo, ancora, -1), base.ontem_util) : null, [per, tipo, ancora, base]);

  useEffect(() => {
    if (!per) return;
    let vivo = true; setBusy(true); setErro('');
    api.fluxoPagarPeriodo(per.ini, per.fim, '0', cmp)
      .then(r => { if (vivo) setResp(r); })
      .catch(e => { if (vivo) { setErro(e.message || 'Erro ao consultar'); setResp(null); } })
      .finally(() => { if (vivo) setBusy(false); });
    return () => { vivo = false; };
  }, [per?.ini, per?.fim, cmp?.ini, cmp?.fim]);

  // ---- universo (filial + empresas do grupo) e todos os agregados ------------------------------------------
  const filiais = useMemo(() => {
    const m = new Map(); for (const t of resp?.titulos || []) m.set(t.fil_id, t.fil_nome);
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [resp]);
  const T = useMemo(() => (resp?.titulos || []).filter(t =>
    (filial === 'todas' || String(t.fil_id) === filial) && (comGrupo || !t.grupo)), [resp, filial, comGrupo]);

  const A = useMemo(() => {
    const soma = (arr, k) => arr.reduce((s, t) => s + t[k], 0);
    const grp = (arr, key, nome) => {
      const m = new Map();
      for (const t of arr) { const k = key(t); const g = m.get(k) || { k, nome: nome(t), qt: 0, valor: 0, pago: 0, saldo: 0, qt_aberto: 0, dias: 0 };
        g.qt++; g.valor += t.valor; g.pago += t.pago; g.saldo += t.saldo; if (t.status !== 'pago') { g.qt_aberto++; g.dias = Math.max(g.dias, t.dias_vencido); } m.set(k, g); }
      return [...m.values()];
    };
    const abertos = T.filter(t => t.status !== 'pago'), pagos = T.filter(t => t.status !== 'aberto');
    const comConta = pagos.filter(t => t.conta_id);
    return {
      valor: soma(T, 'valor'), pago: soma(T, 'pago'), saldo: soma(T, 'saldo'), qt: T.length,
      fornecedores: new Set(T.map(t => t.forn_id)).size,
      qt_pago: T.filter(t => t.status === 'pago').length, qt_parcial: T.filter(t => t.status === 'parcial').length,
      qt_aberto: T.filter(t => t.status === 'aberto').length, saldo_parcial: soma(T.filter(t => t.status === 'parcial'), 'saldo'),
      maior_atraso: abertos.reduce((m, t) => Math.max(m, t.dias_vencido), 0),
      atraso_medio: soma(abertos, 'saldo') > 0 ? abertos.reduce((s, t) => s + t.dias_vencido * t.saldo, 0) / soma(abertos, 'saldo') : 0,
      sem_conta: { qt: pagos.filter(t => t.sem_conta).length, valor: soma(pagos.filter(t => t.sem_conta), 'pago') },
      pont: ['no_dia', 'antecipado', 'atraso', 'sem_conta'].map(k => ({ k, qt: pagos.filter(t => t.pontualidade === k).length, valor: soma(pagos.filter(t => t.pontualidade === k), 'pago') })),
      porFornAberto: grp(abertos, t => t.forn_id, t => t.forn_nome).sort((a, b) => b.saldo - a.saldo),
      porConta: grp(comConta, t => t.conta_id, t => t.conta_nome).sort((a, b) => b.pago - a.pago),
      porFilial: grp(T, t => t.fil_id, t => `${t.fil_id} - ${t.fil_nome}`).sort((a, b) => b.valor - a.valor),
      porClasse: grp(T, t => t.classe, t => t.classe).sort((a, b) => b.saldo - a.saldo || b.valor - a.valor),
      porModal: grp(comConta, t => t.modalidade, t => t.modalidade).sort((a, b) => b.pago - a.pago),
      porDia: grp(T, t => t.dt_devida, t => t.dt_devida).sort((a, b) => (a.k < b.k ? -1 : 1)),
      maioresAbertos: [...abertos].sort((a, b) => b.saldo - a.saldo).slice(0, 8)
    };
  }, [T]);

  const c = resp?.comparativo;
  const pctPagoAnt = c && c.valor > 0 ? (c.valor - c.aberto) / c.valor * 100 : null;
  const pctPago = pct(A.pago, A.valor);
  const abre = (titulo, filtro, status) => setAnalise({ titulo, filtro, status: status || 'todos' });
  const rotuloPeriodo = per ? (per.ini === per.fim ? `${fmtBr(per.ini)} (${DIAS[D(per.ini).getUTCDay()]})` : `${fmtBr(per.ini)} a ${fmtBr(per.fim)}`) : '';
  // so avanca ate o periodo que contem o ultimo dia util fechado
  const podeAvancar = !!(base && ancora && tipo !== 'livre' && periodo(tipo, desloca(tipo, ancora, 1), base.ontem_util).ini <= base.ontem_util);

  return (
    <div className="space-y-5">
      {/* ---------------------------------------------------------------- cabecalho + periodo */}
      <div className="card p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-prim-400 font-semibold"><Target size={18} /> O que havia para pagar</div>
          <div className="flex gap-1">
            {TIPOS.map(t => (
              <button key={t.k} onClick={() => { setTipo(t.k); if (base && t.k !== 'livre') setAncora(base.ontem_util); }}
                className={`px-3 py-1.5 rounded text-sm font-semibold transition ${tipo === t.k ? 'bg-prim-600 text-white' : 'bg-ink-800 hover:bg-ink-700 text-gray-300'}`}>{t.l}</button>
            ))}
          </div>
          {tipo !== 'livre' ? (
            <div className="flex items-center gap-1 bg-ink-800 rounded px-1">
              <button className="p-1.5 rounded hover:bg-ink-700" title="Período anterior" onClick={() => setAncora(a => desloca(tipo, a, -1))}><ChevronLeft size={16} /></button>
              <span className="text-sm font-mono text-gray-200 px-2 min-w-[190px] text-center">{rotuloPeriodo}</span>
              <button className="p-1.5 rounded hover:bg-ink-700 disabled:opacity-30" title="Próximo período" disabled={!podeAvancar} onClick={() => setAncora(a => desloca(tipo, a, 1))}><ChevronRight size={16} /></button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <input type="date" className="input" value={livre.ini} max={base?.ontem_util} onChange={e => setLivre(p => ({ ...p, ini: e.target.value }))} />
              <span className="text-xs text-gray-400">até</span>
              <input type="date" className="input" value={livre.fim} max={base?.ontem_util} onChange={e => setLivre(p => ({ ...p, fim: e.target.value }))} />
            </div>
          )}
          <select className="input !w-auto max-w-[320px]" value={filial} onChange={e => setFilial(e.target.value)}>
            <option value="todas">Todas as empresas</option>
            {filiais.map(([id, nome]) => <option key={id} value={String(id)}>{id} - {nome}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer" title="Desmarque para tirar os títulos devidos a empresas do próprio grupo">
            <input type="checkbox" checked={comGrupo} onChange={e => setComGrupo(e.target.checked)} /> Empresas do grupo
          </label>
          {busy && <span className="text-xs text-gray-500">consultando…</span>}
        </div>
        <div className="text-[11px] text-gray-400 leading-relaxed border-t border-ink-800 pt-2 flex gap-2">
          <Info size={13} className="text-sky-400 shrink-0 mt-0.5" />
          <span>
            Entram os títulos a pagar cujo <b className="text-gray-300">vencimento prorrogado</b> caiu no período (sábado, domingo e feriado contam no dia útil seguinte), sem previsões.
            "Ontem" é o <b className="text-gray-300">dia útil anterior</b>; nada de hoje em diante entra, porque ainda não venceu.
            {resp?.saude?.ult_lancamento && <> A última baixa foi lançada no Mega em <b className="text-gray-300">{fmtBr(resp.saude.ult_lancamento)} {resp.saude.ult_lancamento.slice(11)}</b> — título <b className="text-rose-300">em aberto</b> pode estar pago e ainda não lançado: é exatamente o que esta tela ajuda a cobrar.</>}
          </span>
        </div>
      </div>

      {erro && <div className="bg-red-900/40 text-red-200 text-sm rounded p-3">{erro}</div>}

      {resp && (
        <>
          {/* ------------------------------------------------------------ placar */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Kpi icon={<Wallet size={16} />} cor="prim" rotulo="Havia para pagar" valor={fmt(A.valor)}
                 sub={`${fmtN(A.qt)} título(s) · ${fmtN(A.fornecedores)} fornecedor(es)`} onClick={() => abre('Tudo que havia para pagar', () => true)} />
            <Kpi icon={<CheckCircle2 size={16} />} cor="emerald" rotulo="Pago" valor={fmt(A.pago)}
                 sub={<>{pctPago.toFixed(1)}% do devido · {fmtN(A.qt_pago)} quitado(s){pctPagoAnt != null && <Delta atual={pctPago} anterior={pctPagoAnt} />}</>}
                 onClick={() => abre('Pagos (total ou parcial)', t => t.status !== 'aberto')} />
            <Kpi icon={<AlertTriangle size={16} />} cor="rose" rotulo="Em aberto" valor={fmt(A.saldo)} destaque={A.saldo > 0}
                 sub={A.saldo > 0 ? `${fmtN(A.qt_aberto + A.qt_parcial)} título(s) · maior atraso ${fmtN(A.maior_atraso)} d · médio ${A.atraso_medio.toFixed(0)} d` : 'nada pendente'}
                 onClick={() => abre('Em aberto — o que cobrar', t => t.status !== 'pago')} />
            <Kpi icon={<Clock size={16} />} cor="amber" rotulo="Pago parcialmente" valor={fmtN(A.qt_parcial)}
                 sub={A.qt_parcial ? `falta pagar ${fmt(A.saldo_parcial)}` : 'nenhum'} onClick={() => abre('Pagos parcialmente', t => t.status === 'parcial')} />
          </div>

          <div className="card p-4">
            <div className="flex items-center justify-between text-xs text-gray-400 mb-2">
              <span className="uppercase">Execução do período · {rotuloPeriodo}</span>
              {c && <span>período anterior: {fmt(c.valor)} devidos · {pctPagoAnt.toFixed(1)}% pagos hoje · {fmt(c.aberto)} ainda em aberto</span>}
            </div>
            <div className="h-5 rounded overflow-hidden flex bg-ink-800">
              <Seg w={pct(A.pago, A.valor)} cls="bg-emerald-500" tip={`Pago ${fmt(A.pago)}`} onClick={() => abre('Pagos (total ou parcial)', t => t.status !== 'aberto')} />
              <Seg w={pct(A.saldo, A.valor)} cls="bg-rose-500" tip={`Em aberto ${fmt(A.saldo)}`} onClick={() => abre('Em aberto — o que cobrar', t => t.status !== 'pago')} />
            </div>
            <div className="flex flex-wrap gap-4 mt-2 text-xs">
              <Leg cls="bg-emerald-500" t={`Pago ${pctPago.toFixed(1)}%`} />
              <Leg cls="bg-rose-500" t={`Em aberto ${pct(A.saldo, A.valor).toFixed(1)}%`} />
              <span className="ml-auto text-gray-500">clique em qualquer número, barra ou linha para abrir a visão analítica</span>
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-5">
            {/* -------------------------------------------------------- onde cobrar */}
            <Painel icone={<Target size={16} className="text-rose-400" />} titulo="Onde cobrar — em aberto por fornecedor" extra={`${fmtN(A.porFornAberto.length)} fornecedor(es)`}>
              <Linhas itens={A.porFornAberto.slice(0, 12)} total={A.saldo} valor={g => g.saldo} cor="bg-rose-500/70"
                      detalhe={g => `${fmtN(g.qt_aberto)} tít. · até ${fmtN(g.dias)} d vencido`} vazio="Nada em aberto no período. 🎯"
                      onClick={g => abre(`Em aberto — ${g.nome}`, t => t.forn_id === g.k && t.status !== 'pago')} />
              {A.porFornAberto.length > 12 && <VerTodos n={A.porFornAberto.length} onClick={() => abre('Em aberto — o que cobrar', t => t.status !== 'pago')} />}
            </Painel>

            {/* -------------------------------------------------------- de qual conta saiu */}
            <Painel icone={<Landmark size={16} className="text-emerald-400" />} titulo="De qual conta saiu o pagamento" extra={`${fmtN(A.porConta.length)} conta(s)`}>
              <Linhas itens={A.porConta.slice(0, 10)} total={A.pago} valor={g => g.pago} cor="bg-emerald-500/70" detalhe={g => `${fmtN(g.qt)} título(s)`}
                      vazio="Nenhum pagamento com saída de conta no período." onClick={g => abre(`Pago pela conta ${g.nome}`, t => t.conta_id === g.k)} />
              {A.porConta.length > 10 && <VerTodos n={A.porConta.length} rotulo="contas" onClick={() => abre('Pagos com saída de conta', t => !!t.conta_id)} />}
              {A.sem_conta.qt > 0 && (
                <button className="w-full text-left mt-2 px-3 py-2 rounded bg-ink-800/60 hover:bg-ink-800 text-xs text-gray-400"
                        onClick={() => abre('Baixados sem saída de conta', t => t.sem_conta)}
                        title="Título baixado por compensação, adiantamento, devolução ou encontro de contas: não saiu dinheiro de banco/caixa">
                  <b className="text-gray-200">{fmtN(A.sem_conta.qt)}</b> título(s) baixado(s) <b className="text-gray-200">sem saída de conta</b> ({fmt(A.sem_conta.valor)}) — compensação, adiantamento ou encontro de contas
                </button>
              )}
            </Painel>

            {/* -------------------------------------------------------- por empresa */}
            <Painel icone={<Building2 size={16} className="text-prim-400" />} titulo="Por empresa — devido, pago e em aberto">
              <table className="w-full text-sm">
                <thead className="text-gray-500 uppercase text-[10px]"><tr><th className="text-left p-1.5">Empresa</th><th className="text-right p-1.5">Devido</th><th className="text-right p-1.5">Em aberto</th><th className="p-1.5 w-32">% pago</th></tr></thead>
                <tbody>{A.porFilial.map(g => (
                  <tr key={g.k} className="border-t border-ink-800 hover:bg-ink-800/40 cursor-pointer" onClick={() => abre(`Empresa ${g.nome}`, t => t.fil_id === g.k)}>
                    <td className="p-1.5 text-xs text-gray-200">{g.nome}</td>
                    <td className="p-1.5 text-right font-mono text-xs text-gray-300">{fmt(g.valor)}</td>
                    <td className={`p-1.5 text-right font-mono text-xs ${g.saldo > 0 ? 'text-rose-300' : 'text-gray-600'}`}>{fmt(g.saldo)}</td>
                    <td className="p-1.5"><div className="flex items-center gap-2"><div className="flex-1 h-1.5 rounded bg-rose-900/60 overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${pct(g.pago, g.valor)}%` }} /></div><span className="text-[10px] text-gray-400 w-9 text-right">{pct(g.pago, g.valor).toFixed(0)}%</span></div></td>
                  </tr>))}</tbody>
              </table>
            </Painel>

            {/* -------------------------------------------------------- como foi pago */}
            <Painel icone={<PieChart size={16} className="text-sky-400" />} titulo="Como e quando foi pago">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-[10px] uppercase text-gray-500 mb-1">Pontualidade (sobre o vencimento)</div>
                  {A.pont.filter(p => p.qt > 0).map(p => (
                    <button key={p.k} className="w-full flex items-center justify-between text-xs py-1.5 px-2 rounded hover:bg-ink-800"
                            onClick={() => abre(`Pagos — ${PONT[p.k]}`, t => t.status !== 'aberto' && t.pontualidade === p.k)}>
                      <span className={p.k === 'atraso' ? 'text-rose-300' : p.k === 'antecipado' ? 'text-sky-300' : 'text-gray-300'}>{PONT[p.k]}</span>
                      <span className="font-mono text-gray-400">{fmtN(p.qt)} · {fmtK(p.valor)}</span>
                    </button>))}
                  {A.pont.every(p => p.qt === 0) && <div className="text-xs text-gray-600 py-2">Nenhum pagamento no período.</div>}
                </div>
                <div>
                  <div className="text-[10px] uppercase text-gray-500 mb-1">Modalidade</div>
                  {A.porModal.map(g => (
                    <button key={g.k} className="w-full flex items-center justify-between text-xs py-1.5 px-2 rounded hover:bg-ink-800"
                            onClick={() => abre(`Pagos por ${g.nome}`, t => t.modalidade === g.k)}>
                      <span className="text-gray-300">{g.nome}</span><span className="font-mono text-gray-400">{fmtN(g.qt)} · {fmtK(g.pago)}</span>
                    </button>))}
                  {A.porModal.length === 0 && <div className="text-xs text-gray-600 py-2">—</div>}
                </div>
              </div>
            </Painel>

            {/* -------------------------------------------------------- por classe financeira */}
            <Painel icone={<Users size={16} className="text-violet-400" />} titulo="Para onde ia o dinheiro — por classe financeira">
              <Linhas itens={A.porClasse.slice(0, 10)} total={A.valor} valor={g => g.valor} cor="bg-violet-500/60"
                      detalhe={g => g.saldo > 0 ? <span className="text-rose-300">{fmtK(g.saldo)} em aberto</span> : 'tudo pago'}
                      vazio="—" onClick={g => abre(`Classe ${g.nome}`, t => t.classe === g.k)} />
            </Painel>

            {/* -------------------------------------------------------- por dia */}
            <Painel icone={<CalendarDays size={16} className="text-amber-400" />} titulo="Dia a dia — devido × em aberto">
              {A.porDia.length <= 1 ? <div className="text-xs text-gray-500 py-3">Período de um dia só. Use Semana, Mês ou Trimestre para ver a evolução.</div> : (
                <div className="flex items-end gap-1 h-36 overflow-x-auto pb-1">
                  {(() => { const mx = Math.max(...A.porDia.map(g => g.valor), 1); return A.porDia.map(g => (
                    <button key={g.k} className="flex flex-col items-center justify-end h-full min-w-[22px] flex-1 group"
                            title={`${fmtBr(g.k)} — devido ${fmt(g.valor)} · em aberto ${fmt(g.saldo)}`} onClick={() => abre(`Vencidos em ${fmtBr(g.k)}`, t => t.dt_devida === g.k)}>
                      <div className="w-full flex flex-col justify-end rounded-t overflow-hidden group-hover:opacity-80" style={{ height: `${Math.max(3, g.valor / mx * 100)}%` }}>
                        <div className="bg-rose-500" style={{ height: `${pct(g.saldo, g.valor)}%` }} /><div className="bg-emerald-500 flex-1" />
                      </div>
                      <span className="text-[9px] text-gray-500 mt-1">{g.k.slice(8)}</span>
                    </button>)); })()}
                </div>)}
            </Painel>
          </div>

          {/* ------------------------------------------------------------ maiores em aberto */}
          {A.maioresAbertos.length > 0 && (
            <Painel icone={<AlertTriangle size={16} className="text-rose-400" />} titulo="Maiores títulos em aberto — comece por aqui">
              <table className="w-full text-sm">
                <thead className="text-gray-500 uppercase text-[10px]"><tr><th className="text-left p-1.5">Fornecedor</th><th className="text-left p-1.5">Documento</th><th className="text-left p-1.5">Empresa</th><th className="text-center p-1.5">Vencimento</th><th className="text-right p-1.5">Vencido há</th><th className="text-right p-1.5">Falta pagar</th></tr></thead>
                <tbody>{A.maioresAbertos.map(t => (
                  <tr key={t.id} className="border-t border-ink-800 hover:bg-ink-800/40 cursor-pointer" onClick={() => abre(`Em aberto — ${t.forn_nome}`, x => x.forn_id === t.forn_id && x.status !== 'pago')}>
                    <td className="p-1.5 text-xs text-gray-200">{t.forn_nome}{t.grupo && <span className="ml-1 text-[9px] px-1 rounded bg-ink-700 text-gray-400">GRUPO</span>}</td>
                    <td className="p-1.5 text-xs font-mono text-gray-400">{t.documento}/{t.parcela} <span className="text-gray-600">{t.tpd}</span></td>
                    <td className="p-1.5 text-xs text-gray-400">{t.fil_id}</td>
                    <td className="p-1.5 text-xs text-center font-mono text-gray-300">{fmtBr(t.venc_pror)}</td>
                    <td className="p-1.5 text-xs text-right font-mono text-amber-300">{fmtN(t.dias_vencido)} d</td>
                    <td className="p-1.5 text-right font-mono text-rose-300 font-semibold">{fmt(t.saldo)}</td>
                  </tr>))}</tbody>
              </table>
            </Painel>
          )}
        </>
      )}

      {analise && <ModalAnalitico titulo={analise.titulo} periodo={rotuloPeriodo} titulos={T.filter(analise.filtro)} onClose={() => setAnalise(null)} />}
    </div>
  );
}

// ================================================================================================ pecas
function Kpi({ icon, rotulo, valor, sub, cor = 'prim', destaque, onClick }) {
  const m = { prim: ['border-prim-500', 'text-prim-400'], emerald: ['border-emerald-500', 'text-emerald-400'], rose: ['border-rose-500', 'text-rose-400'], amber: ['border-amber-500', 'text-amber-400'] }[cor];
  return (
    <button onClick={onClick} className={`kpi border-l-4 ${m[0]} text-left transition hover:brightness-125 hover:-translate-y-0.5 ${destaque ? 'ring-1 ring-rose-500/40' : ''}`} title="Abrir a visão analítica">
      <div className="kpi-label flex items-center gap-1">{icon} {rotulo}</div>
      <div className={`kpi-value ${m[1]}`}>{valor}</div>
      <div className="text-xs text-gray-500 mt-0.5">{sub}</div>
    </button>
  );
}
function Delta({ atual, anterior }) {
  const d = atual - anterior; if (Math.abs(d) < 0.05) return null;
  return <span className={`ml-1 ${d >= 0 ? 'text-emerald-400' : 'text-rose-400'}`} title={`Período anterior: ${anterior.toFixed(1)}% pago`}>{d >= 0 ? '▲' : '▼'} {Math.abs(d).toFixed(1)} p.p.</span>;
}
const Seg = ({ w, cls, tip, onClick }) => w > 0 ? <button className={`${cls} h-full hover:brightness-125`} style={{ width: `${w}%` }} title={tip} onClick={onClick} /> : null;
const Leg = ({ cls, t }) => <span className="flex items-center gap-1.5 text-gray-300"><span className={`w-2.5 h-2.5 rounded-sm ${cls}`} />{t}</span>;
function Painel({ icone, titulo, extra, children }) {
  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-2.5 bg-ink-900 border-b border-ink-700 flex items-center gap-2 text-sm font-semibold">{icone} {titulo}{extra && <span className="ml-auto text-xs font-normal text-gray-500">{extra}</span>}</div>
      <div className="p-3">{children}</div>
    </div>
  );
}
function Linhas({ itens, total, valor, cor, detalhe, vazio, onClick }) {
  if (!itens.length) return <div className="text-xs text-gray-500 py-3 text-center">{vazio}</div>;
  return (
    <div className="space-y-0.5">{itens.map(g => (
      <button key={g.k} onClick={() => onClick(g)} className="w-full text-left px-2 py-1.5 rounded hover:bg-ink-800/70 transition">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-xs text-gray-200 truncate">{g.nome}</span>
          <span className="text-xs font-mono text-gray-200 whitespace-nowrap">{fmt(valor(g))}</span>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <div className="flex-1 h-1 rounded bg-ink-800 overflow-hidden"><div className={`h-full ${cor}`} style={{ width: `${Math.min(100, pct(valor(g), total))}%` }} /></div>
          <span className="text-[10px] text-gray-500 whitespace-nowrap">{detalhe(g)} · {pct(valor(g), total).toFixed(1)}%</span>
        </div>
      </button>))}
    </div>
  );
}
const VerTodos = ({ n, rotulo = 'fornecedores', onClick }) => <button className="w-full text-center text-xs text-prim-400 hover:underline mt-2" onClick={onClick}>ver {fmtN(n)} {rotulo} na visão analítica →</button>;

// ================================================================================================ modal analitico
const POR_PAGINA = 100;
const ORD = {
  status: t => t.status, forn: t => t.forn_nome.toLowerCase(), doc: t => t.documento, fil: t => t.fil_id, venc: t => t.venc_pror,
  dias: t => (t.status === 'pago' ? (t.dias_pagto ?? -9999) : t.dias_vencido), valor: t => t.valor, pago: t => t.pago, saldo: t => t.saldo,
  conta: t => t.conta_nome.toLowerCase(), dtpg: t => t.dt_pagto, modal: t => t.modalidade, classe: t => t.classe.toLowerCase()
};

function ModalAnalitico({ titulo, periodo, titulos, onClose }) {
  const [status, setStatus] = useState('todos');
  const [conta,  setConta]  = useState('todas');
  const [classe, setClasse] = useState('todas');
  const [busca,  setBusca]  = useState('');
  const [sort,   setSort]   = useState({ k: 'saldo', asc: false });
  const [pagina, setPagina] = useState(1);
  const [aberto, setAberto] = useState(null);      // id do titulo "explodido"

  const op = useMemo(() => {
    const c = (key) => { const m = new Map(); for (const t of titulos) { const k = key(t); if (!k) continue; m.set(k, (m.get(k) || 0) + 1); } return [...m.entries()].sort((a, b) => b[1] - a[1]); };
    return { contas: c(t => t.conta_nome), classes: c(t => t.classe) };
  }, [titulos]);

  const linhas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const arr = titulos.filter(t =>
      (status === 'todos' || t.status === status) && (conta === 'todas' || t.conta_nome === conta) && (classe === 'todas' || t.classe === classe) &&
      (!q || t.forn_nome.toLowerCase().includes(q) || String(t.forn_id).includes(q) || t.documento.toLowerCase().includes(q) || t.conta_nome.toLowerCase().includes(q) || t.historico.toLowerCase().includes(q) || t.cgc.includes(q)));
    const ex = ORD[sort.k] || ORD.saldo;
    return arr.sort((a, b) => { const va = ex(a), vb = ex(b); const r = va < vb ? -1 : va > vb ? 1 : 0; return sort.asc ? r : -r; });
  }, [titulos, status, conta, classe, busca, sort]);
  useEffect(() => { setPagina(1); }, [status, conta, classe, busca, sort]);
  const tot = Math.max(1, Math.ceil(linhas.length / POR_PAGINA)), vis = linhas.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);
  const S = k => linhas.reduce((s, t) => s + t[k], 0);
  const alterna = k => setSort(s => s.k === k ? { k, asc: !s.asc } : { k, asc: true });
  const Th = ({ k, children, className = '' }) => (
    <th className={`p-2 select-none cursor-pointer whitespace-nowrap hover:text-gray-200 ${className}`} onClick={() => alterna(k)}>
      <span className="inline-flex items-center gap-0.5">{children}{sort.k === k && (sort.asc ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}</span></th>);

  function excel() {
    const ws = XLSX.utils.json_to_sheet(linhas.map(t => ({
      Status: STATUS[t.status].l, 'Cód. fornecedor': t.forn_id, Fornecedor: t.forn_nome, 'CNPJ/CPF': t.cgc, 'Empresa do grupo': t.grupo ? 'Sim' : 'Não',
      Documento: t.documento, Parcela: t.parcela, 'Tipo doc.': t.tpd, Empresa: t.fil_id, 'Nome da empresa': t.fil_nome,
      'Emissão': fmtBr(t.emissao), Vencimento: fmtBr(t.vencimento), 'Venc. prorrogado': fmtBr(t.venc_pror),
      'Valor do título': t.valor, Pago: t.pago, 'Falta pagar': t.saldo, 'Dias vencido (em aberto)': t.status === 'pago' ? '' : t.dias_vencido,
      'Conta que pagou': t.conta_nome, 'Data do pagamento': fmtBr(t.dt_pagto), 'Dias sobre o vencimento': t.dias_pagto ?? '', Modalidade: t.modalidade,
      'Doc. da baixa': t.doc_baixa, 'Baixa lançada em': t.dt_lancamento, 'Classe financeira': t.classe, 'Histórico': t.historico })));
    ws['!cols'] = [12, 12, 44, 18, 10, 14, 8, 9, 8, 30, 11, 11, 14, 15, 15, 15, 12, 40, 14, 12, 18, 14, 17, 34, 50].map(w => ({ wch: w }));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Contas a pagar');
    XLSX.writeFile(wb, `contas-a-pagar-pago-x-aberto-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  return (
    <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-3">
      <div className="bg-ink-900 rounded-lg w-[97vw] max-w-[1500px] max-h-[94vh] flex flex-col border border-prim-700/30 shadow-2xl">
        <div className="flex items-start justify-between p-5 border-b border-ink-700">
          <div>
            <h3 className="text-xl font-bold text-prim-400">{titulo}</h3>
            <div className="text-xs text-gray-400 mt-1">
              {periodo}<span className="mx-2">·</span><b className="text-gray-200">{fmtN(linhas.length)}</b> de {fmtN(titulos.length)} título(s)
              <span className="mx-2">·</span>devido <b className="text-gray-200">{fmt(S('valor'))}</b>
              <span className="mx-2">·</span><span className="text-emerald-400">pago {fmt(S('pago'))}</span>
              <span className="mx-2">·</span><span className="text-rose-300">falta {fmt(S('saldo'))}</span>
            </div>
          </div>
          <button className="text-gray-400 hover:text-white" onClick={onClose}><X size={22} /></button>
        </div>
        <div className="flex flex-wrap items-center gap-2 p-3 border-b border-ink-800 bg-ink-900/40">
          <div className="relative"><Search size={14} className="absolute left-2 top-2.5 text-gray-500" />
            <input className="bg-ink-800 border border-ink-700 rounded pl-7 pr-3 py-1.5 text-sm w-72" placeholder="Buscar fornecedor, documento, conta, histórico..." value={busca} onChange={e => setBusca(e.target.value)} /></div>
          <div className="flex gap-1">{[['todos', 'Todos'], ['aberto', 'Em aberto'], ['parcial', 'Parcial'], ['pago', 'Pago']].map(([k, l]) => (
            <button key={k} onClick={() => setStatus(k)} className={`px-3 py-1 rounded text-xs transition ${status === k ? 'bg-prim-600 text-white' : 'bg-ink-800 hover:bg-ink-700 text-gray-300'}`}>{l}</button>))}</div>
          <select className="bg-ink-800 text-xs text-gray-300 rounded px-2 py-1.5 outline-none max-w-[260px]" value={conta} onChange={e => setConta(e.target.value)}>
            <option value="todas">Todas as contas que pagaram</option>{op.contas.map(([k, n]) => <option key={k} value={k}>{k} ({fmtN(n)})</option>)}</select>
          <select className="bg-ink-800 text-xs text-gray-300 rounded px-2 py-1.5 outline-none max-w-[240px]" value={classe} onChange={e => setClasse(e.target.value)}>
            <option value="todas">Todas as classes</option>{op.classes.map(([k, n]) => <option key={k} value={k}>{k} ({fmtN(n)})</option>)}</select>
          <div className="flex-1" />
          <span className="text-xs text-gray-500 hidden lg:inline">clique na linha para abrir o título</span>
          {tot > 1 && <span className="flex items-center gap-1 text-xs text-gray-400">
            <button className="p-1 rounded hover:bg-ink-700 disabled:opacity-30" disabled={pagina <= 1} onClick={() => setPagina(p => p - 1)}><ChevronLeft size={14} /></button>
            {pagina}/{fmtN(tot)}<button className="p-1 rounded hover:bg-ink-700 disabled:opacity-30" disabled={pagina >= tot} onClick={() => setPagina(p => p + 1)}><ChevronRight size={14} /></button></span>}
          <button className="btn-ghost" onClick={excel} disabled={!linhas.length}><FileSpreadsheet size={14} /> Excel</button>
        </div>
        <div className="overflow-auto flex-1">
          <table className="w-full text-xs">
            <thead className="bg-ink-900 text-gray-400 uppercase sticky top-0 z-10"><tr>
              <Th k="status" className="text-left pl-4">Status</Th><Th k="forn" className="text-left">Fornecedor</Th><Th k="doc" className="text-left">Documento</Th>
              <Th k="fil" className="text-center">Emp.</Th><Th k="venc" className="text-center">Vencimento</Th><Th k="dias" className="text-right">Prazo</Th>
              <Th k="valor" className="text-right">Valor</Th><Th k="pago" className="text-right">Pago</Th><Th k="saldo" className="text-right">Falta pagar</Th>
              <Th k="conta" className="text-left">Conta que pagou</Th><Th k="dtpg" className="text-center">Pago em</Th><Th k="modal" className="text-left">Modalidade</Th><Th k="classe" className="text-left pr-4">Classe</Th>
            </tr></thead>
            <tbody>
              {vis.map(t => (
                <React.Fragment key={t.id}>
                  <tr className={`border-b border-ink-800 hover:bg-ink-800/40 cursor-pointer ${aberto === t.id ? 'bg-ink-800/60' : ''}`} onClick={() => setAberto(a => a === t.id ? null : t.id)}>
                    <td className="p-2 pl-4 whitespace-nowrap"><span className={`text-[10px] px-2 py-0.5 rounded border ${STATUS[t.status].cls}`}>{STATUS[t.status].l}</span></td>
                    <td className="p-2 max-w-[280px] truncate" title={`${t.forn_id} - ${t.forn_nome}`}><span className="text-gray-500">{t.forn_id}</span> {t.forn_nome}{t.grupo && <span className="ml-1 text-[9px] px-1 rounded bg-ink-700 text-gray-400">GRUPO</span>}</td>
                    <td className="p-2 font-mono text-gray-300">{t.documento}<span className="text-gray-500">/{t.parcela}</span> <span className="text-gray-600">{t.tpd}</span></td>
                    <td className="p-2 text-center font-mono text-gray-400" title={t.fil_nome}>{t.fil_id}</td>
                    <td className="p-2 text-center font-mono">{fmtBr(t.venc_pror)}</td>
                    <td className="p-2 text-right font-mono whitespace-nowrap">{t.status === 'pago'
                      ? (t.dias_pagto == null ? <span className="text-gray-600">—</span> : t.dias_pagto > 0 ? <span className="text-rose-300">{fmtN(t.dias_pagto)} d atraso</span> : t.dias_pagto < 0 ? <span className="text-sky-300">{fmtN(-t.dias_pagto)} d antes</span> : <span className="text-emerald-300">no dia</span>)
                      : <span className="text-amber-300">{fmtN(t.dias_vencido)} d vencido</span>}</td>
                    <td className="p-2 text-right font-mono text-gray-300">{fmt(t.valor)}</td>
                    <td className="p-2 text-right font-mono text-emerald-400">{t.pago ? fmt(t.pago) : <span className="text-gray-700">—</span>}</td>
                    <td className="p-2 text-right font-mono font-semibold text-rose-300">{t.saldo ? fmt(t.saldo) : <span className="text-gray-700">—</span>}</td>
                    <td className="p-2 max-w-[230px] truncate" title={t.conta_nome}>{t.conta_id ? <><span className="text-gray-500">{t.conta_id}</span> <span className="text-sky-300">{t.conta_nome}</span></> : t.sem_conta ? <span className="text-gray-500 italic">sem saída de conta</span> : <span className="text-gray-700">—</span>}</td>
                    <td className="p-2 text-center font-mono text-gray-300">{fmtBr(t.dt_pagto) || <span className="text-gray-700">—</span>}</td>
                    <td className="p-2 text-gray-400">{t.modalidade || <span className="text-gray-700">—</span>}</td>
                    <td className="p-2 pr-4 max-w-[200px] truncate text-gray-400" title={t.classe}>{t.classe}</td>
                  </tr>
                  {aberto === t.id && (
                    <tr className="bg-ink-950/60 border-b border-ink-700"><td colSpan={13} className="p-4">
                      <div className="grid md:grid-cols-3 gap-x-8 gap-y-1.5 text-xs">
                        <Campo r="Fornecedor" v={`${t.forn_id} - ${t.forn_nome}`} /><Campo r="CNPJ/CPF" v={t.cgc || '—'} /><Campo r="Empresa do grupo" v={t.grupo ? 'Sim' : 'Não'} />
                        <Campo r="Documento / parcela" v={`${t.documento} / ${t.parcela} (${t.tpd})`} /><Campo r="Empresa" v={`${t.fil_id} - ${t.fil_nome}`} /><Campo r="Classe financeira" v={t.classe} />
                        <Campo r="Emissão" v={fmtBr(t.emissao)} /><Campo r="Vencimento original" v={fmtBr(t.vencimento)} /><Campo r="Vencimento prorrogado" v={`${fmtBr(t.venc_pror)}${t.venc_pror !== t.dt_devida ? ` → devido em ${fmtBr(t.dt_devida)} (dia útil)` : ''}`} />
                        <Campo r="Valor do título" v={fmt(t.valor)} /><Campo r="Pago" v={fmt(t.pago)} /><Campo r="Falta pagar" v={fmt(t.saldo)} forte={t.saldo > 0} />
                        <Campo r="Conta que pagou" v={t.conta_id ? `${t.conta_id} - ${t.conta_nome}` : (t.sem_conta ? 'Baixado sem saída de conta (compensação/adiantamento)' : '—')} />
                        <Campo r="Pago em" v={t.dt_pagto ? `${fmtBr(t.dt_pagto)}${t.qt_baixas > 1 ? ` (última de ${t.qt_baixas} baixas)` : ''}` : '—'} /><Campo r="Modalidade / doc. da baixa" v={t.modalidade ? `${t.modalidade}${t.doc_baixa ? ' · ' + t.doc_baixa : ''}` : '—'} />
                        <Campo r="Baixa lançada no Mega em" v={t.dt_lancamento ? `${fmtBr(t.dt_lancamento)} ${t.dt_lancamento.slice(11)}` : '—'} /><Campo r="Saiu de conta financeira" v={t.vl_baixas_conta ? fmt(t.vl_baixas_conta) : '—'} />
                        <div className="md:col-span-3"><Campo r="Histórico" v={t.historico || '—'} /></div>
                      </div>
                    </td></tr>)}
                </React.Fragment>))}
              {vis.length === 0 && <tr><td colSpan={13} className="p-8 text-center text-gray-500">Nenhum título neste filtro.</td></tr>}
            </tbody>
            <tfoot><tr className="bg-ink-900 border-t-2 border-prim-600/40 font-bold sticky bottom-0">
              <td className="p-3 pl-4 text-gray-300" colSpan={6}>TOTAL ({fmtN(linhas.length)} título{linhas.length === 1 ? '' : 's'})</td>
              <td className="p-3 text-right font-mono text-gray-200">{fmt(S('valor'))}</td><td className="p-3 text-right font-mono text-emerald-400">{fmt(S('pago'))}</td><td className="p-3 text-right font-mono text-rose-300">{fmt(S('saldo'))}</td><td colSpan={4} />
            </tr></tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
const Campo = ({ r, v, forte }) => <div><span className="text-gray-500">{r}: </span><span className={forte ? 'text-rose-300 font-semibold' : 'text-gray-200'}>{v}</span></div>;
