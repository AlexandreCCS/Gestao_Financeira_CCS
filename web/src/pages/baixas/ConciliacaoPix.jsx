// [27/11/2026 - CRIADO POR RONALDO FAJAN] Baixas/Conciliação › CONCILIAÇÃO PIX I (Quality). Regras: sql/50_pix_conciliacao.sql.
// A conta PIX I (CAIXA PIX I (JE) JEANS.COM) nao tem extrato: o lado do banco sao comprovantes que chegam esparsos.
// A tela mostra os lancamentos do Mega nas contas do grupo (24492 PRO-FREE, 24504 PRO-QLT, 25515 ANDRAR II) desde a data de
// corte, separados em ENTRADAS e SAIDAS e somados por dia, com as colunas da planilha "EXTRATO JEANS" (valor, nome, cod, loja,
// solicitante, obs, saida/empresa). O usuario marca 1 ou N lancamentos (a barra soma os marcados), informa a DATA DO BANCO
// (obrigatoria) e concilia: cada lancamento vira uma conciliacao manual no Mega com a linha do banco nessa data.
// "Extrato do dia" refaz a planilha pela data do banco: saldo anterior por loja (abertura do corte + conciliado) + entradas -
// saidas do dia. Desfazer volta o lancamento para pendente.
// [27/11/2026] v2 (pedido): grade em FECHAMENTO DIARIO (por dia: entradas, saidas e saldo) e filtros no cabecalho das colunas,
// como o autofiltro da planilha.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Loader2, RefreshCw, Settings, Undo2, AlertTriangle, Search, X, Link2, XCircle, Info, Filter, CalendarDays } from 'lucide-react';
import { api, getSession } from '../../api/client';

const GRP = 1;
const fmt   = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtBr = s => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '');
const r2    = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const dias  = (a, b) => Math.round((Date.parse(b + 'T00:00:00') - Date.parse(a + 'T00:00:00')) / 86400000);
const parseBR = s => { const t = String(s ?? '').replace(/[R$\s]/g, ''); const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t); return Number.isFinite(n) ? n : NaN; };
const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// pode marcar: pendente, com loja configurada e sem data futura
const marcavel = (m, hoje) => !m.conciliado && !!m.loja && m.data <= hoje;

// [27/11/2026] POR CONTA (pedido: "a conciliacao e por conta, mesmo que aconteca em varias filiais - baixas da mesma conta").
// Uma linha por conta do grupo; clicar na linha abre a conta na grade.
function Extrato({ dados, dia, setDia, conta, setConta }) {
  const linhas = useMemo(() => {
    const out = dados.grupo.contas.map(c => {
      const s = dados.serie.filter(x => x.conta === c.agn);
      const ant = c.saldo_ini + s.filter(x => x.data < dia).reduce((t, x) => t + x.ent - x.sai, 0);
      const ent = s.filter(x => x.data === dia).reduce((t, x) => t + x.ent, 0);
      const sai = s.filter(x => x.data === dia).reduce((t, x) => t + x.sai, 0);
      // "a conciliar" segue o dia escolhido: lancamentos do Mega com essa data ainda sem comprovante
      const pend = dados.lancamentos.filter(m => !m.conciliado && m.conta === c.agn && m.data === dia);
      return { ...c, ant: r2(ant), ent: r2(ent), sai: r2(sai), saldo: r2(ant + ent - sai),
               pendE: r2(pend.filter(m => m.nat === 'D').reduce((t, m) => t + m.valor, 0)), pendS: r2(pend.filter(m => m.nat === 'C').reduce((t, m) => t + m.valor, 0)) };
    });
    const tot = k => r2(out.reduce((t, l) => t + l[k], 0));
    return { out, tot: { ant: tot('ant'), ent: tot('ent'), sai: tot('sai'), saldo: tot('saldo'), pendE: tot('pendE'), pendS: tot('pendS') } };
  }, [dados, dia]);
  const foraDoPeriodo = dia < dados.de || dia > dados.ate;

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-ink-700 flex flex-wrap items-center gap-3">
        <div>
          <div className="text-sm font-semibold text-gray-100">Extrato do dia por conta <span className="text-gray-500 font-normal">· pela data do banco · clique na conta para abri-la</span></div>
          <div className="text-xs text-gray-500">
            <b className="text-gray-400">Conciliado</b>: saldo de abertura de {fmtBr(dados.grupo.corte)} + o que já foi conciliado no Mega (por aqui ou fora), pela data do banco.{' '}
            <b className="text-gray-400">A conciliar</b>: lançamentos do Mega com data {fmtBr(dia)} ainda sem comprovante.
          </div>
          {foraDoPeriodo && <div className="text-xs text-amber-300 mt-1">O dia está fora do período carregado ({fmtBr(dados.de)} a {fmtBr(dados.ate)}): ajuste "De/Até" e clique em Buscar para ver o que falta conciliar nele.</div>}
        </div>
        <label className="ml-auto text-xs text-gray-400 flex items-center gap-2">Dia
          <input type="date" className="input !w-auto !py-1.5" value={dia} min={dados.grupo.corte} max={dados.hoje} onChange={e => e.target.value && setDia(e.target.value)} />
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wider text-gray-400 bg-ink-900/60">
            <tr className="text-[10px]">
              <th></th>
              <th colSpan={4} className="px-3 pt-2 text-center text-emerald-500/80 border-b border-ink-700">Conciliado · data do banco {fmtBr(dia)}</th>
              <th colSpan={2} className="px-3 pt-2 text-center text-amber-500/80 border-b border-ink-700">A conciliar · lançado no Mega em {fmtBr(dia)}</th>
            </tr>
            <tr>
              <th className="text-left px-4 py-2">Conta</th>
              <th className="text-right px-3 py-2">Saldo do dia anterior</th>
              <th className="text-right px-3 py-2">Entradas do dia</th>
              <th className="text-right px-3 py-2">Saídas do dia</th>
              <th className="text-right px-3 py-2">Saldo do dia</th>
              <th className="text-right px-3 py-2">Entradas</th>
              <th className="text-right px-4 py-2">Saídas</th>
            </tr>
          </thead>
          <tbody>
            {linhas.out.map(l => (
              <tr key={l.agn} onClick={() => setConta(l.agn)} title="Abrir esta conta na grade"
                  className={`border-t border-ink-700/60 cursor-pointer ${conta === l.agn ? 'bg-prim-600/15' : 'hover:bg-ink-700/40'}`}>
                <td className="px-4 py-1.5">
                  <div className={`font-semibold ${conta === l.agn ? 'text-prim-400' : 'text-gray-100'}`}>{l.agn} · {l.empresa}</div>
                  <div className="text-xs text-gray-500">{l.nome}</div>
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-gray-300">{fmt(l.ant)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-emerald-400">{l.ent ? fmt(l.ent) : '—'}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-rose-400">{l.sai ? `-${fmt(l.sai)}` : '—'}</td>
                <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-gray-100">{fmt(l.saldo)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-amber-200/80">{l.pendE ? fmt(l.pendE) : '—'}</td>
                <td className="px-4 py-1.5 text-right tabular-nums text-amber-200/80">{l.pendS ? `-${fmt(l.pendS)}` : '—'}</td>
              </tr>
            ))}
            <tr onClick={() => setConta(0)} title="Ver as contas juntas na grade"
                className={`border-t-2 border-ink-700 font-semibold cursor-pointer ${conta === 0 ? 'bg-prim-600/15' : 'bg-ink-900/40 hover:bg-ink-700/40'}`}>
              <td className="px-4 py-2 text-gray-100">TOTAL · PIX I</td>
              <td className="px-3 py-2 text-right tabular-nums text-gray-200">{fmt(linhas.tot.ant)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-emerald-400">{fmt(linhas.tot.ent)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-rose-400">-{fmt(linhas.tot.sai)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-prim-400 text-base">{fmt(linhas.tot.saldo)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-amber-200">{fmt(linhas.tot.pendE)}</td>
              <td className="px-4 py-2 text-right tabular-nums text-amber-200">-{fmt(linhas.tot.pendS)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Situacao({ m, onDesfazer, ocupado }) {
  const [conf, setConf] = useState(false);
  if (m.apt) return (
    <div className="flex items-center gap-2 whitespace-nowrap">
      <span className="text-emerald-400 flex items-center gap-1" title={`Conciliado por ${m.apt.login} em ${m.apt.quando}`}>
        <CheckCircle2 size={14} /> banco {fmtBr(m.apt.data_banco)}
      </span>
      {conf ? (
        <>
          <button className="text-xs px-2 py-0.5 rounded bg-rose-700 hover:bg-rose-600 text-white disabled:opacity-40" disabled={ocupado} onClick={() => { setConf(false); onDesfazer(m); }}>desfazer</button>
          <button className="text-xs text-gray-400 hover:text-white" onClick={() => setConf(false)}>não</button>
        </>
      ) : (
        <button className="text-gray-500 hover:text-rose-400 disabled:opacity-30" title="Desfazer a conciliação deste lançamento" disabled={ocupado} onClick={() => setConf(true)}><Undo2 size={14} /></button>
      )}
    </div>
  );
  if (m.conciliado) return (
    <span className="text-sky-400/80 whitespace-nowrap flex items-center gap-1"
          title={`Conciliado fora desta tela (Mega, Solicitações Financeiras ou Baixar e conciliar)${m.banco?.tipo ? ` · tipo ${({ M: 'manual', A: 'automática', G: 'gera mov. banc.' })[m.banco.tipo] || m.banco.tipo}` : ''}. Para desfazer, use o Mega.`}>
      <CheckCircle2 size={14} /> {m.banco?.data ? `banco ${fmtBr(m.banco.data)}` : 'conciliado'} · Mega
    </span>
  );
  if (!m.loja) return <span className="text-amber-400 whitespace-nowrap" title={`Filial ${m.fil} sem loja na configuração da conciliação PIX`}>filial {m.fil} sem loja</span>;
  return <span className="text-gray-400">pendente</span>;
}

// [27/11/2026] situacao em texto (coluna Situacao e filtro dela)
const situacaoDe = m => (m.apt ? 'Conciliado (tela)' : m.conciliado ? 'Conciliado (Mega)' : !m.loja ? 'Sem loja' : 'Pendente');
const num0 = v => Number(v || 0);

// [27/11/2026] colunas da grade com filtro no cabecalho, como o autofiltro da planilha
const COLUNAS = [
  { k: 'valor',       t: 'Valor',       v: m => fmt(m.valor), ord: m => m.valor, dir: 'right' },
  { k: 'nome',        t: 'Nome',        v: m => m.nome || '(vazio)' },
  { k: 'cod',         t: 'Cód',         v: m => (m.contra_tau === 'N' || !m.contra_agn ? '(vazio)' : String(m.contra_agn)), ord: m => (m.contra_tau === 'N' ? 0 : num0(m.contra_agn)) },
  { k: 'loja',        t: 'Loja',        v: m => m.loja || '(sem loja)' },
  { k: 'empresa',     t: 'Empresa',     v: m => m.empresa || '(vazio)' },
  { k: 'tipo',        t: 'Tipo',        v: m => m.tipo },
  { k: 'solicitante', t: 'Solicitante', v: m => m.solicitante || '(vazio)' },
  { k: 'obs',         t: 'Obs',         v: m => m.obs || '(vazio)' },
  { k: 'situacao',    t: 'Situação',    v: situacaoDe, dir: 'right' },
];
const passa = (m, filtros, exceto) => COLUNAS.every(c => c.k === exceto || !filtros[c.k] || filtros[c.k].has(c.v(m)));

// filtro estilo Excel: lista de valores com contagem, pesquisa e (Selecionar tudo). Popover fixo para nao ser cortado pela rolagem.
function FiltroColuna({ col, valores, sel, onAplicar }) {
  const [pos, setPos] = useState(null);
  const [q, setQ] = useState('');
  const [tmp, setTmp] = useState(() => new Set());
  const ref = useRef(null), btn = useRef(null);
  useEffect(() => {
    if (!pos) return;
    const fora = e => { if (ref.current && !ref.current.contains(e.target) && !btn.current.contains(e.target)) setPos(null); };
    const fecha = e => { if (!ref.current?.contains(e.target)) setPos(null); };
    document.addEventListener('mousedown', fora); window.addEventListener('scroll', fecha, true); window.addEventListener('resize', fecha);
    return () => { document.removeEventListener('mousedown', fora); window.removeEventListener('scroll', fecha, true); window.removeEventListener('resize', fecha); };
  }, [pos]);
  function abrir() {
    if (pos) return setPos(null);
    const r = btn.current.getBoundingClientRect();
    setTmp(new Set(sel || valores.map(v => v.valor))); setQ('');
    setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left - 8, window.innerWidth - 300)) });
  }
  const vis = valores.filter(v => semAcento(v.valor).includes(semAcento(q.trim())));
  const todosVis = vis.length > 0 && vis.every(v => tmp.has(v.valor));
  const marca = (lista, on) => setTmp(s => { const n = new Set(s); lista.forEach(v => (on ? n.add(v.valor) : n.delete(v.valor))); return n; });
  function ok() {
    // com pesquisa, vale o que esta visivel e marcado (como no Excel)
    const fim = q.trim() ? new Set(vis.filter(v => tmp.has(v.valor)).map(v => v.valor)) : tmp;
    onAplicar(valores.every(v => fim.has(v.valor)) ? null : fim);
    setPos(null);
  }
  return (
    <>
      <button ref={btn} type="button" onClick={abrir} title={`Filtrar ${col.t}`}
              className={`ml-1 p-0.5 rounded align-middle ${sel ? 'text-prim-400 bg-prim-600/25' : 'text-gray-500 hover:text-gray-200'}`}>
        <Filter size={12} />
      </button>
      {pos && (
        <div ref={ref} style={{ position: 'fixed', top: pos.top, left: pos.left }}
             className="z-50 w-72 bg-ink-900 border border-ink-700 rounded-lg shadow-2xl p-2 normal-case tracking-normal font-normal text-left text-sm text-gray-200">
          <input className="input !py-1 text-xs mb-2" placeholder={`Pesquisar em ${col.t}`} autoFocus value={q} onChange={e => setQ(e.target.value)}
                 onKeyDown={e => e.key === 'Enter' && ok()} />
          <label className="flex items-center gap-2 px-1 py-1 text-xs border-b border-ink-700 mb-1 cursor-pointer">
            <input type="checkbox" className="accent-emerald-500" checked={todosVis} onChange={e => marca(vis, e.target.checked)} />
            <span className="font-semibold">(Selecionar tudo{q.trim() ? ' da pesquisa' : ''})</span>
          </label>
          <div className="max-h-64 overflow-auto">
            {vis.slice(0, 500).map(v => (
              <label key={v.valor} className="flex items-center gap-2 px-1 py-0.5 text-xs hover:bg-ink-800 rounded cursor-pointer">
                <input type="checkbox" className="accent-emerald-500" checked={tmp.has(v.valor)} onChange={e => marca([v], e.target.checked)} />
                <span className="truncate flex-1" title={v.valor}>{v.valor}</span>
                <span className="text-gray-500 tabular-nums">{v.n}</span>
              </label>
            ))}
            {!vis.length && <div className="text-xs text-gray-500 px-1 py-2">Nada encontrado.</div>}
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-ink-700 mt-1">
            <button className="text-xs px-2 py-1 rounded bg-ink-800 hover:bg-ink-700" onClick={() => { onAplicar(null); setPos(null); }}>Limpar</button>
            <button className="text-xs px-3 py-1 rounded bg-prim-600 hover:bg-prim-500 text-white" onClick={ok}>OK</button>
          </div>
        </div>
      )}
    </>
  );
}

// linhas de um lado (entradas ou saidas) de um dia
function BlocoDia({ ms, nat, marc, toggle, hoje, onDesfazer, ocupado }) {
  const itens = ms.filter(m => m.nat === nat);
  if (!itens.length) return null;
  const saida = nat === 'C';
  const livres = itens.filter(m => marcavel(m, hoje));
  const total = r2(itens.reduce((t, m) => t + m.valor, 0));
  const pend = r2(itens.filter(m => !m.conciliado).reduce((t, m) => t + m.valor, 0));
  return (
    <>
      <tr className={saida ? 'bg-rose-950/20' : 'bg-emerald-950/20'}>
        <td className="px-3 py-1">
          <input type="checkbox" className="accent-emerald-500" disabled={!livres.length || ocupado} checked={livres.length > 0 && livres.every(m => marc.has(m.key))}
                 title={`Marcar as ${saida ? 'saídas' : 'entradas'} pendentes do dia`} onChange={e => toggle(livres, e.target.checked)} />
        </td>
        <td colSpan={9} className="px-3 py-1 text-xs">
          <span className={`font-semibold tracking-wider ${saida ? 'text-rose-400' : 'text-emerald-400'}`}>{saida ? 'SAÍDAS' : 'ENTRADAS'}</span>
          <span className="text-gray-500"> · {itens.length} · </span>
          <span className={`tabular-nums font-semibold ${saida ? 'text-rose-300' : 'text-emerald-300'}`}>{saida ? '-' : ''}{fmt(total)}</span>
          {pend > 0 && <span className="text-amber-300/80"> · a conciliar {fmt(pend)}</span>}
        </td>
      </tr>
      {itens.map(m => (
        <tr key={m.key} className={`border-t border-ink-700/40 ${marc.has(m.key) ? 'bg-prim-600/10' : 'hover:bg-ink-700/30'} ${m.conciliado ? 'opacity-70' : ''}`}>
          <td className="px-3 py-1.5">
            <input type="checkbox" className="accent-emerald-500" disabled={!marcavel(m, hoje) || ocupado} checked={marc.has(m.key)} onChange={e => toggle([m], e.target.checked)} />
          </td>
          <td className={`px-3 py-1.5 text-right tabular-nums whitespace-nowrap ${saida ? 'text-rose-300' : 'text-emerald-300'}`}>{saida ? '-' : ''}{fmt(m.valor)}</td>
          <td className="px-3 py-1.5 text-gray-100 max-w-[280px] truncate" title={`${m.nome}${m.contra_qtd > 1 ? ` (+${m.contra_qtd - 1} na mesma operação)` : ''}`}>{m.nome || '—'}</td>
          <td className="px-3 py-1.5 text-gray-400 tabular-nums">{m.contra_tau === 'N' ? '' : (m.contra_agn || '')}</td>
          <td className="px-3 py-1.5 text-gray-300 whitespace-nowrap">{m.loja || '—'}</td>
          <td className="px-3 py-1.5 text-gray-400 whitespace-nowrap">{m.empresa}</td>
          <td className="px-3 py-1.5 text-gray-300 whitespace-nowrap" title={`Ação ${m.acao} · ${m.tpd} ${m.doc} · lançamento ${m.lanc} · filial ${m.fil} · conta ${m.conta}`}>{m.tipo}</td>
          <td className="px-3 py-1.5 text-gray-400 whitespace-nowrap">{m.solicitante}</td>
          <td className="px-3 py-1.5 text-gray-400 max-w-[320px] truncate" title={m.obs}>{m.obs}</td>
          <td className="px-3 py-1.5 text-xs"><div className="flex justify-end"><Situacao m={m} onDesfazer={onDesfazer} ocupado={ocupado} /></div></td>
        </tr>
      ))}
    </>
  );
}

// [27/11/2026] pedido: "fechamento diario: 03/11 entradas, saidas, saldo; 04/11 entradas, saidas, saldo". A grade vira um bloco por dia
// (data do lancamento no Mega): ENTRADAS, SAIDAS e a linha de FECHAMENTO com o saldo do dia = abertura do corte + todo o movimento do
// Mega ate o dia (conciliado ou nao) das lojas do filtro de Loja. Os outros filtros so escondem linhas; nao mudam o saldo.
function Grade({ dados, base, conta, filtros, setFiltros, marc, setMarc, hoje, onDesfazer, ocupado }) {
  const rows = useMemo(() => base.filter(m => passa(m, filtros)), [base, filtros]);
  const valores = useMemo(() => Object.fromEntries(COLUNAS.map(c => {
    const cont = new Map(), ord = new Map();
    for (const m of base) if (passa(m, filtros, c.k)) { const v = c.v(m); cont.set(v, (cont.get(v) || 0) + 1); if (c.ord) ord.set(v, c.ord(m)); }
    const lista = [...cont.entries()].map(([valor, n]) => ({ valor, n, o: ord.get(valor) }));
    lista.sort((a, b) => (c.ord ? a.o - b.o : a.valor.localeCompare(b.valor, 'pt-BR')));
    return [c.k, lista];
  })), [base, filtros]);

  // saldo do fechamento: lojas do filtro de Loja (sem filtro = todas)
  // [27/11/2026] saldo POR CONTA: abertura da conta + movimento do Mega da conta ate o dia (aba Todas = soma das contas)
  const saldoAte = useMemo(() => {
    const ctas = new Set(dados.grupo.contas.map(c => c.agn).filter(a => !conta || a === conta.agn));
    const abertura = dados.grupo.contas.filter(c => ctas.has(c.agn)).reduce((t, c) => t + c.saldo_ini, 0);
    const mov = new Map();
    for (const x of dados.movdia) if (ctas.has(x.conta)) mov.set(x.data, (mov.get(x.data) || 0) + x.ent - x.sai);
    const datas = [...mov.keys()].sort();
    return d => r2(abertura + datas.filter(x => x <= d).reduce((t, x) => t + mov.get(x), 0));
  }, [dados, conta]);

  const porDia = useMemo(() => {
    const g = new Map();
    for (const m of rows) { if (!g.has(m.data)) g.set(m.data, []); g.get(m.data).push(m); }
    return [...g.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);
  const toggle = (lista, v) => setMarc(s => { const n = new Set(s); lista.forEach(m => (v ? n.add(m.key) : n.delete(m.key))); return n; });
  const nFiltros = Object.values(filtros).filter(Boolean).length;
  const soma = (l, nat) => r2(l.filter(m => m.nat === nat).reduce((t, m) => t + m.valor, 0));
  const props = { marc, toggle, hoje, onDesfazer, ocupado };

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-ink-700 flex flex-wrap items-center gap-3">
        <CalendarDays size={18} className="text-prim-400" />
        <span className="font-semibold text-gray-100">Fechamento diário · {conta ? `conta ${conta.agn} ${conta.empresa}` : 'todas as contas'}</span>
        <span className="text-xs text-gray-500">por data do lançamento no Mega · {rows.length} de {base.length} lançamento(s) · filtre pelo funil de cada coluna</span>
        {nFiltros > 0 && (
          <button className="ml-auto text-xs px-2 py-1 rounded bg-prim-600/20 text-prim-400 hover:bg-prim-600/30 flex items-center gap-1" onClick={() => setFiltros({})}>
            <X size={12} /> Limpar {nFiltros} filtro(s) de coluna
          </button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wider text-gray-400 bg-ink-900/60">
            <tr>
              <th className="w-8 px-3 py-2"></th>
              {COLUNAS.map(c => (
                <th key={c.k} className={`px-3 py-2 whitespace-nowrap ${c.dir === 'right' ? 'text-right' : 'text-left'} ${filtros[c.k] ? 'text-prim-400' : ''}`}>
                  {c.t}
                  <FiltroColuna col={c} valores={valores[c.k]} sel={filtros[c.k] || null} onAplicar={s => setFiltros(f => ({ ...f, [c.k]: s }))} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!porDia.length && <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-500">Nada no filtro.</td></tr>}
            {porDia.map(([data, ms]) => {
              const livres = ms.filter(m => marcavel(m, hoje));
              const ent = soma(ms, 'D'), sai = soma(ms, 'C');
              const sem = new Date(data + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long' });
              return (
                <React.Fragment key={data}>
                  <tr className="bg-ink-950 border-t-4 border-ink-900">
                    <td className="px-3 py-2">
                      <input type="checkbox" className="accent-emerald-500" disabled={!livres.length || ocupado} checked={livres.length > 0 && livres.every(m => marc.has(m.key))}
                             title="Marcar todos os pendentes do dia" onChange={e => toggle(livres, e.target.checked)} />
                    </td>
                    <td colSpan={9} className="px-3 py-2">
                      <span className="text-base font-bold text-gray-100">{fmtBr(data)}</span>
                      <span className="text-xs text-gray-500 ml-2">{sem}</span>
                    </td>
                  </tr>
                  <BlocoDia ms={ms} nat="D" {...props} />
                  <BlocoDia ms={ms} nat="C" {...props} />
                  <tr className="bg-ink-900/80 border-t border-ink-700">
                    <td></td>
                    <td colSpan={9} className="px-3 py-2">
                      <div className="flex flex-wrap items-baseline gap-x-8 gap-y-1 text-sm">
                        <span className="text-xs uppercase tracking-wider text-gray-400">Fechamento {fmtBr(data)}</span>
                        <span className="tabular-nums"><span className="text-xs text-gray-500 mr-1">Entradas</span><span className="text-emerald-400 font-semibold">{fmt(ent)}</span></span>
                        <span className="tabular-nums"><span className="text-xs text-gray-500 mr-1">Saídas</span><span className="text-rose-400 font-semibold">-{fmt(sai)}</span></span>
                        <span className="tabular-nums"><span className="text-xs text-gray-500 mr-1">Resultado</span><span className={`font-semibold ${ent - sai >= 0 ? 'text-gray-200' : 'text-rose-300'}`}>{fmt(r2(ent - sai))}</span></span>
                        <span className="tabular-nums ml-auto" title={`Abertura de ${fmtBr(dados.grupo.corte)} + todo o movimento do Mega até ${fmtBr(data)} (conciliado ou não) ${conta ? `da conta ${conta.agn}` : 'das contas do PIX I'}. Os filtros de coluna não mudam o saldo.`}>
                          <span className="text-xs text-gray-500 mr-2">Saldo do dia · {conta ? `conta ${conta.agn}` : 'PIX I'}</span>
                          <span className="text-prim-400 font-bold text-base">{fmt(saldoAte(data))}</span>
                        </span>
                      </div>
                    </td>
                  </tr>
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Config({ dados, onClose, onSalvo }) {
  const [corte, setCorte] = useState(dados.grupo.corte);
  // [27/11/2026] saldo de abertura POR CONTA
  const [saldos, setSaldos] = useState(() => Object.fromEntries(dados.grupo.contas.map(c => [c.agn, c.saldo_ini.toLocaleString('pt-BR', { minimumFractionDigits: 2 })])));
  const [erro, setErro] = useState(''); const [salvando, setSalvando] = useState(false);
  const total = r2(dados.grupo.contas.reduce((t, c) => t + (parseBR(saldos[c.agn]) || 0), 0));
  async function salvar() {
    const contas = dados.grupo.contas.map(c => ({ agn: c.agn, saldo_ini: parseBR(saldos[c.agn]) }));
    if (contas.some(c => !Number.isFinite(c.saldo_ini))) return setErro('Saldo inválido.');
    setSalvando(true); setErro('');
    try { await api.pixConfig({ grp: GRP, corte, contas }); onSalvo(); }
    catch (e) { setErro(e.detalhe || e.message); setSalvando(false); }
  }
  return (
    <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-3">
      <div className="bg-ink-900 rounded-lg w-full max-w-lg border border-prim-700/30 shadow-2xl">
        <div className="flex items-start justify-between p-5 border-b border-ink-700">
          <div>
            <h3 className="text-lg font-bold text-prim-400 flex items-center gap-2"><Settings size={18} /> Data de corte e saldo de abertura</h3>
            <p className="text-xs text-gray-400 mt-1">O saldo de abertura é o saldo de cada CONTA no INÍCIO do dia de corte (o "saldo do dia anterior"). Lançamentos do Mega antes do corte não aparecem na tela.</p>
          </div>
          <button className="text-gray-400 hover:text-white" onClick={onClose}><X size={20} /></button>
        </div>
        <div className="p-5 space-y-3">
          <label className="block text-sm text-gray-300">Data de corte
            <input type="date" className="input mt-1" value={corte} max={dados.hoje} onChange={e => setCorte(e.target.value)} />
          </label>
          {dados.grupo.contas.map(c => (
            <label key={c.agn} className="flex items-center gap-3 text-sm text-gray-300">
              <span className="w-40">{c.agn} · {c.empresa}</span>
              <input className="input text-right tabular-nums" value={saldos[c.agn]} onChange={e => setSaldos(s => ({ ...s, [c.agn]: e.target.value }))} />
            </label>
          ))}
          <div className="flex justify-between text-sm border-t border-ink-700 pt-2"><span className="text-gray-400">Total</span><span className="font-semibold tabular-nums text-gray-100">{fmt(total)}</span></div>
          {erro && <div className="text-sm text-rose-400">{erro}</div>}
        </div>
        <div className="p-4 border-t border-ink-700 flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn-prim" disabled={salvando} onClick={salvar}>{salvando ? <Loader2 size={15} className="animate-spin" /> : null} Salvar</button>
        </div>
      </div>
    </div>
  );
}

export default function ConciliacaoPix() {
  const admin = getSession()?.user?.perm === 'A';
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [filtros, setFiltros] = useState({});   // { coluna: Set de valores aceitos } (ausente = todos)
  const [conta, setConta] = useState(null);      // [27/11] conta aberta (a conciliacao e por conta): null = ainda nao carregou, 0 = todas
  const [busca, setBusca] = useState('');
  const [marc, setMarc] = useState(() => new Set());
  const [dataBanco, setDataBanco] = useState('');
  const [confirma, setConfirma] = useState(false);
  const [rodando, setRodando] = useState(null);
  const [res, setRes] = useState(null);
  const [dia, setDia] = useState('');
  const [config, setConfig] = useState(false);

  async function carregar(d = de, a = ate) {
    setCarregando(true); setErro('');
    try {
      const r = await api.pixPainel(GRP, d, a);
      setDados(r);
      if (!d) setDe(r.de);
      if (!a) setAte(r.ate);
      setDia(x => x || r.hoje);
      setConta(c => (c === null ? (r.grupo.contas[0]?.agn || 0) : c));   // abre na primeira conta
      setMarc(s => new Set([...s].filter(k => r.lancamentos.some(m => m.key === k && marcavel(m, r.hoje)))));
    } catch (e) { setErro(e.detalhe || e.message); }
    setCarregando(false);
  }
  useEffect(() => { carregar(); }, []);

  // busca livre (antes dos filtros de coluna, que ficam na grade)
  const base = useMemo(() => {
    if (!dados) return [];
    const q = semAcento(busca.trim());
    const qn = parseBR(busca);
    return dados.lancamentos.filter(m =>
      !q || semAcento(`${m.nome} ${m.obs} ${m.doc} ${m.contra_doc} ${m.lanc} ${m.solicitante} ${m.tipo}`).includes(q) || (Number.isFinite(qn) && Math.abs(m.valor - qn) < 0.005));
  }, [dados, busca]);

  const marcados = useMemo(() => (dados ? dados.lancamentos.filter(m => marc.has(m.key)) : []), [dados, marc]);
  const somaE = r2(marcados.filter(m => m.nat === 'D').reduce((t, m) => t + m.valor, 0));
  const somaS = r2(marcados.filter(m => m.nat === 'C').reduce((t, m) => t + m.valor, 0));
  const longe = dataBanco ? marcados.filter(m => Math.abs(dias(m.data, dataBanco)) > 3) : [];
  const ocupado = !!rodando;

  async function conciliar(simular) {
    setConfirma(false); setRodando(simular ? 'simular' : 'gravar'); setRes(null);
    try {
      const r = await api.pixConciliar({ grp: GRP, data_banco: dataBanco, simular, movs: marcados.map(m => ({ org: m.org, seq: m.seq, lanc: m.lanc })) });
      setRes({ ...r, acao: simular ? 'simular' : 'conciliar' });
      if (r.status === 'B') { setMarc(new Set()); await carregar(); }
    } catch (e) { setRes({ status: 'X', mensagem: e.detalhe || e.message }); }
    setRodando(null);
  }
  async function desfazer(m) {
    setRodando('desfazer'); setRes(null);
    try {
      const r = await api.pixDesfazer({ grp: GRP, apts: [m.apt.id] });
      setRes({ ...r, acao: 'desfazer' });
      if (r.status === 'B') await carregar();
    } catch (e) { setRes({ status: 'X', mensagem: e.detalhe || e.message }); }
    setRodando(null);
  }

  if (!dados) return (
    <div className="p-6">
      {erro ? <div className="card p-4 text-rose-400 flex items-center gap-2"><XCircle size={18} /> {erro}</div>
            : <div className="text-gray-400 flex items-center gap-2"><Loader2 size={18} className="animate-spin" /> Carregando lançamentos do PIX…</div>}
    </div>
  );

  return (
    <div className="p-6 space-y-5 max-w-[1600px] mx-auto pb-32">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-100 tracking-tight flex items-center gap-2"><Link2 size={22} /> Conciliação PIX I</h1>
          <p className="text-sm text-gray-500">
            {dados.grupo.nome} · contas {dados.grupo.contas.map(c => `${c.agn} ${c.empresa}`).join(' · ')} · corte {fmtBr(dados.grupo.corte)}
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          {admin && <button className="btn-ghost text-xs" onClick={() => setConfig(true)}><Settings size={14} /> Corte e saldo inicial</button>}
          <button className="btn-ghost text-xs" disabled={carregando} onClick={() => carregar()}>{carregando ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Atualizar</button>
        </div>
      </div>

      {dados.futuros.qtd > 0 && (
        <div className="card px-4 py-2 text-sm text-amber-300 flex items-center gap-2 border-amber-700/50">
          <AlertTriangle size={16} /> {dados.futuros.qtd} lançamento(s) com data futura nessas contas ({fmt(dados.futuros.valor)}). Eles só aparecem aqui depois que a data no Mega for corrigida.
        </div>
      )}
      {dados.limite && <div className="card px-4 py-2 text-sm text-amber-300 flex items-center gap-2"><AlertTriangle size={16} /> Mais de 3.000 lançamentos no período: reduza as datas.</div>}

      {/* [27/11/2026] navegacao pelas contas do grupo (antes so pelo funil da coluna Empresa) */}
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${dados.grupo.contas.length + 1}, minmax(0, 1fr))` }}>
        {[{ agn: 0, empresa: 'Todas as contas', nome: 'visão consolidada do PIX I' }, ...dados.grupo.contas].map(c => {
          const ls = base.filter(m => !c.agn || m.conta === c.agn);
          const pend = ls.filter(m => !m.conciliado);
          const ativo = conta === c.agn;
          return (
            <button key={c.agn} onClick={() => setConta(c.agn)}
                    className={`text-left rounded-lg border px-4 py-3 transition ${ativo ? 'border-prim-500 bg-prim-600/15' : 'border-ink-700 bg-ink-800 hover:bg-ink-700'}`}>
              <div className={`font-semibold ${ativo ? 'text-prim-400' : 'text-gray-100'}`}>{c.agn ? `${c.agn} · ${c.empresa}` : c.empresa}</div>
              <div className="text-xs text-gray-500 truncate" title={c.nome}>{c.nome}</div>
              <div className="text-xs mt-1">
                <span className="text-gray-300">{ls.length} lançamento(s)</span>
                <span className={pend.length ? 'text-amber-300' : 'text-emerald-400'}> · {pend.length} a conciliar</span>
                {pend.length > 0 && <span className="text-gray-500"> ({fmt(pend.reduce((t, m) => t + (m.nat === 'D' ? m.valor : -m.valor), 0))})</span>}
              </div>
            </button>
          );
        })}
      </div>

      <Extrato dados={dados} dia={dia || dados.hoje} setDia={setDia} conta={conta || 0} setConta={setConta} />

      <div className="card p-3 flex flex-wrap items-end gap-3">
        <label className="text-xs text-gray-400">De
          <input type="date" className="input mt-1 !py-1.5" value={de} min={dados.grupo.corte} max={dados.hoje} onChange={e => setDe(e.target.value)} />
        </label>
        <label className="text-xs text-gray-400">Até
          <input type="date" className="input mt-1 !py-1.5" value={ate} min={dados.grupo.corte} onChange={e => setAte(e.target.value)} />
        </label>
        <button className="btn-ghost !py-1.5 text-xs" disabled={carregando} onClick={() => carregar(de, ate)}>Buscar</button>
        <div className="flex rounded-lg overflow-hidden border border-ink-700 text-xs" title="Atalho do filtro da coluna Situação">
          {[['', 'Todos'], ['Pendente', 'Pendentes'], ['Conciliado', 'Conciliados']].map(([k, t]) => {
            const ativo = k === '' ? !filtros.situacao : !!filtros.situacao && [...filtros.situacao].every(v => v.startsWith(k));
            return (
              <button key={t} className={`px-3 py-2 ${ativo ? 'bg-prim-600 text-white' : 'bg-ink-900 text-gray-300 hover:bg-ink-700'}`}
                      onClick={() => setFiltros(f => ({ ...f, situacao: k === '' ? null : new Set(k === 'Pendente' ? ['Pendente'] : ['Conciliado (tela)', 'Conciliado (Mega)']) }))}>{t}</button>
            );
          })}
        </div>
        <div className="relative flex-1 min-w-[220px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input className="input !pl-9 !py-1.5" placeholder="Nome, valor (ex.: 1.250,00), documento, obs…" value={busca} onChange={e => setBusca(e.target.value)} />
        </div>
      </div>

      {res && (
        <div className={`card px-4 py-3 text-sm flex items-start gap-2 ${res.status === 'X' ? 'text-rose-300 border-rose-700/50' : 'text-emerald-300 border-emerald-700/50'}`}>
          {res.status === 'X' ? <XCircle size={18} className="shrink-0" /> : <CheckCircle2 size={18} className="shrink-0" />}
          <div className="flex-1">
            {res.status === 'B' && res.acao === 'conciliar' && <>Conciliado: {res.qtd} lançamento(s){res.entradas ? ` · entradas ${fmt(res.entradas)}` : ''}{res.saidas ? ` · saídas ${fmt(res.saidas)}` : ''} (lote {res.lote}).</>}
            {res.status === 'B' && res.acao === 'desfazer' && <>Conciliação desfeita: o lançamento voltou para pendente (lote {res.lote}).</>}
            {res.status === 'S' && <>Simulação sem erro: dá para conciliar. Nada foi gravado.</>}
            {res.status === 'X' && <>Não foi feito. {res.mensagem}</>}
          </div>
          <button className="text-gray-500 hover:text-white" onClick={() => setRes(null)}><X size={16} /></button>
        </div>
      )}

      <Grade dados={dados} base={conta ? base.filter(m => m.conta === conta) : base} conta={dados.grupo.contas.find(c => c.agn === conta) || null}
             filtros={filtros} setFiltros={setFiltros}
             marc={marc} setMarc={setMarc} hoje={dados.hoje} onDesfazer={desfazer} ocupado={ocupado} />

      {marcados.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-ink-900/95 border-t border-prim-700/40 backdrop-blur">
          <div className="max-w-[1600px] mx-auto px-6 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
            <div className="text-sm">
              <div className="text-gray-100 font-semibold">{marcados.length} marcado(s)</div>
              <button className="text-xs text-gray-500 hover:text-white" disabled={ocupado} onClick={() => { setMarc(new Set()); setConfirma(false); }}>limpar</button>
            </div>
            <div className="text-sm tabular-nums">
              <div className="text-xs text-gray-500">Entradas</div><div className="text-emerald-400 font-semibold">{fmt(somaE)}</div>
            </div>
            <div className="text-sm tabular-nums">
              <div className="text-xs text-gray-500">Saídas</div><div className="text-rose-400 font-semibold">-{fmt(somaS)}</div>
            </div>
            <div className="text-sm tabular-nums">
              <div className="text-xs text-gray-500">Soma dos marcados</div><div className="text-gray-100 font-bold text-lg">{fmt(r2(somaE - somaS))}</div>
            </div>
            <label className="text-xs text-gray-400">Data do banco <span className="text-rose-400">*</span>
              <input type="date" className={`input mt-1 !py-1.5 ${!dataBanco ? 'border-amber-600' : ''}`} value={dataBanco} min={dados.grupo.corte} max={dados.hoje}
                     disabled={ocupado} onChange={e => { setDataBanco(e.target.value); setConfirma(false); }} />
            </label>
            {longe.length > 0 && (
              <div className="text-xs text-amber-300 flex items-center gap-1 max-w-[260px]"><Info size={14} className="shrink-0" /> {longe.length} marcado(s) com data no Mega a mais de 3 dias da data do banco.</div>
            )}
            <div className="ml-auto flex items-center gap-2">
              {confirma ? (
                <>
                  <span className="text-sm text-gray-300">Conciliar {marcados.length} lançamento(s) com data do banco {fmtBr(dataBanco)}?</span>
                  <button className="btn-prim" disabled={ocupado} onClick={() => conciliar(false)}>Confirmar</button>
                  <button className="btn-ghost" disabled={ocupado} onClick={() => setConfirma(false)}>Voltar</button>
                </>
              ) : (
                <>
                  <button className="btn-ghost" disabled={!dataBanco || ocupado} onClick={() => conciliar(true)}>
                    {rodando === 'simular' ? <Loader2 size={15} className="animate-spin" /> : null} Simular
                  </button>
                  <button className="btn-prim" disabled={!dataBanco || ocupado} title={!dataBanco ? 'Informe a data do banco' : ''} onClick={() => setConfirma(true)}>
                    {rodando === 'gravar' ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />} Conciliar
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {config && <Config dados={dados} onClose={() => setConfig(false)} onSalvo={() => { setConfig(false); carregar(); }} />}
    </div>
  );
}
