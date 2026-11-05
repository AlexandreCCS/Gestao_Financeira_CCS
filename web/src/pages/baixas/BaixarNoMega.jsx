// [21/09/2026 - CRIADO POR ALEXANDRE CARVALHO] Baixas/Conciliacao > Extrato do banco x Mega > BAIXAR NO MEGA.
// Pedido do Alexandre (com a Renata/Quality): "botoes para baixar automaticamente no MEGA ... apenas o que nao existe nao
// vamos fazer nada, apenas alertar".
// O QUE ENTRA: saida do banco (pagamento) sem baixa no Mega E com titulo a pagar em aberto do MESMO valor (sugestao da analise).
// O QUE SO ALERTA: pagamento sem titulo em aberto desse valor; entrada (recebimento) - a baixa de recebimento segue no Mega.
// A REGRA FINAL E DO BANCO DE DADOS (MEGA.CCS_P_GFIN_BAIXA_CPA): "Validar antes" roda a mesma procedure e desfaz tudo.
// Uma baixa por chamada -> progresso linha a linha; cada baixa e uma transacao propria no Mega e pode ser desfeita no painel.
import React, { useEffect, useMemo, useState } from 'react';
import { X, ShieldCheck, Zap, CheckCircle2, XCircle, Loader2, AlertTriangle, Undo2, Info, History } from 'lucide-react';
import { api } from '../../api/client';

const fmt   = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtN  = v => Number(v || 0).toLocaleString('pt-BR');
const fmtBr = iso => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');
const CONF  = { alta: ['nome e valor conferem', 'bg-emerald-900/50 text-emerald-300 border-emerald-700/40'], media: ['valor e vencimento próximos', 'bg-amber-900/40 text-amber-300 border-amber-700/40'], baixa: ['só o valor confere', 'bg-ink-700 text-gray-300 border-ink-600'] };
const chave = l => `${l.conta_id}|${l.data}|${l.dc}|${l.valor}|${l.historico}|${l.seq}`;

// separa as linhas "falta baixar" no que da para baixar por aqui e no que so alerta
export function separarBaixaveis(linhas) {
  const baixar = linhas.filter(l => l.situacao === 'baixar');
  return {
    prontos:   baixar.filter(l => l.dc === 'D' && l.sugestoes.length > 0),
    semTitulo: baixar.filter(l => l.dc === 'D' && l.sugestoes.length === 0),
    entradas:  baixar.filter(l => l.dc === 'C')
  };
}

export default function BaixarNoMega({ linhas, arquivo, onClose, onFeito }) {
  const { prontos, semTitulo, entradas } = useMemo(() => separarBaixaveis(linhas), [linhas]);
  // escolha do usuario por linha: marcado? qual sugestao? | so a confianca ALTA ja vem marcada
  const [esc, setEsc] = useState(() => Object.fromEntries(prontos.map(l => [chave(l), { on: l.sugestoes[0].confianca === 'alta', i: 0 }])));
  const [res, setRes] = useState({});            // chave -> { fase:'rodando'|'fim', simular, status, mensagem, lancto_fin, log_id }
  const [rodando, setRodando]   = useState(null); // null | 'simular' | 'baixar'
  const [confirma, setConfirma] = useState(false);
  const [feitos, setFeitos]     = useState(0);
  const [total,  setTotal]      = useState(0);

  const marcados = prontos.filter(l => esc[chave(l)]?.on && !(res[chave(l)]?.status === 'B'));
  const somaMarcados = marcados.reduce((s, l) => s + l.valor, 0);
  const baixados = prontos.filter(l => res[chave(l)]?.status === 'B');
  // o mesmo titulo nao pode ser escolhido em duas linhas
  const repetidos = useMemo(() => { const v = new Map(); for (const l of marcados) { const id = l.sugestoes[esc[chave(l)].i].id; v.set(id, (v.get(id) || 0) + 1); } return new Set([...v].filter(([, n]) => n > 1).map(([id]) => id)); }, [marcados, esc]);

  const setLinha = (l, patch) => setEsc(e => ({ ...e, [chave(l)]: { ...e[chave(l)], ...patch } }));
  const marcarTodos = on => setEsc(e => Object.fromEntries(prontos.map(l => [chave(l), { ...e[chave(l)], on: on === 'alta' ? l.sugestoes[e[chave(l)].i].confianca === 'alta' : on }])));

  async function executar(simular) {
    setConfirma(false); setRodando(simular ? 'simular' : 'baixar'); setFeitos(0);
    const fila = [...marcados]; setTotal(fila.length);
    for (const l of fila) {
      const k = chave(l), s = l.sugestoes[esc[k].i];
      setRes(r => ({ ...r, [k]: { fase: 'rodando', simular } }));
      try {
        const out = await api.baixasBaixar({ simular, arquivo, itens: [{ ref: k.slice(0, 40), titulo_id: s.id, conta_id: l.conta_id, data: l.data, valor: l.valor, historico: l.historico, documento: l.documento || '' }] });
        setRes(r => ({ ...r, [k]: { fase: 'fim', simular, ...out.resultados[0] } }));
      } catch (e) {
        setRes(r => ({ ...r, [k]: { fase: 'fim', simular, status: 'X', mensagem: e.message || 'Falha ao falar com o servidor. Confira o título no Mega antes de tentar de novo.' } }));
      }
      setFeitos(n => n + 1);
    }
    setRodando(null);
    if (!simular) onFeito?.();
  }

  const okSim  = prontos.filter(l => res[chave(l)]?.status === 'S').length;
  const recus  = prontos.filter(l => res[chave(l)]?.fase === 'fim' && res[chave(l)]?.status === 'X').length;

  return (
    <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-3">
      <div className="bg-ink-900 rounded-lg w-[97vw] max-w-[1400px] max-h-[94vh] flex flex-col border border-prim-700/30 shadow-2xl">
        <div className="flex items-start justify-between p-5 border-b border-ink-700">
          <div>
            <h3 className="text-xl font-bold text-prim-400 flex items-center gap-2"><Zap size={20} /> Baixar no Mega — contas a pagar</h3>
            <div className="text-xs text-gray-400 mt-1 max-w-4xl">
              Para cada pagamento que o banco já fez e que tem um título em aberto do <b className="text-gray-200">mesmo valor</b>, gravo a baixa no Mega:
              na <b className="text-gray-200">conta do extrato</b>, na <b className="text-gray-200">data do banco</b>, igual à baixa feita na tela do Mega. O que não tem título eu só aviso.
            </div>
          </div>
          <button className="text-gray-400 hover:text-white disabled:opacity-30" disabled={!!rodando} onClick={onClose}><X size={22} /></button>
        </div>

        <div className="overflow-auto flex-1 p-4 space-y-4">
          {/* ---------------------------------------------------------------- prontos */}
          <div className="rounded border border-ink-700 overflow-hidden">
            <div className="px-3 py-2 bg-ink-800/70 text-sm font-semibold text-gray-100 flex flex-wrap items-center gap-3">
              <span>Dá para baixar por aqui <span className="text-gray-400 font-normal">· {fmtN(prontos.length)} pagamento(s) · {fmt(prontos.reduce((s, l) => s + l.valor, 0))}</span></span>
              <span className="ml-auto flex gap-1 text-xs font-normal">
                <button className="px-2 py-1 rounded bg-ink-700 hover:bg-ink-600 disabled:opacity-40" disabled={!!rodando} onClick={() => marcarTodos('alta')}>só os que o nome confere</button>
                <button className="px-2 py-1 rounded bg-ink-700 hover:bg-ink-600 disabled:opacity-40" disabled={!!rodando} onClick={() => marcarTodos(true)}>todos</button>
                <button className="px-2 py-1 rounded bg-ink-700 hover:bg-ink-600 disabled:opacity-40" disabled={!!rodando} onClick={() => marcarTodos(false)}>nenhum</button>
              </span>
            </div>
            {prontos.length === 0
              ? <div className="p-6 text-center text-sm text-gray-500">Nenhum pagamento deste extrato tem título em aberto do mesmo valor.</div>
              : <table className="w-full text-xs">
                  <thead className="text-gray-500 uppercase text-[10px] bg-ink-900"><tr>
                    <th className="p-2 w-8"></th><th className="p-2 text-center">Data do banco</th><th className="p-2 text-left">O banco diz</th><th className="p-2 text-right">Valor</th>
                    <th className="p-2 text-left pl-4">Título que vou baixar</th><th className="p-2 text-left">Conta</th><th className="p-2 text-left w-[26%]">Resultado</th></tr></thead>
                  <tbody>{prontos.map(l => { const k = chave(l), e = esc[k], s = l.sugestoes[e.i], r = res[k], feito = r?.status === 'B'; return (
                    <tr key={k} className={`border-t border-ink-800 ${feito ? 'bg-emerald-950/30' : e.on ? 'bg-prim-900/10' : ''}`}>
                      <td className="p-2 text-center"><input type="checkbox" className="accent-prim-500 w-4 h-4" checked={feito || e.on} disabled={feito || !!rodando} onChange={ev => setLinha(l, { on: ev.target.checked })} /></td>
                      <td className="p-2 text-center font-mono text-gray-300">{fmtBr(l.data)}</td>
                      <td className="p-2 text-gray-200 whitespace-nowrap">{l.historico}</td>
                      <td className="p-2 text-right font-mono font-semibold text-rose-300">{fmt(l.valor)}</td>
                      <td className="p-2 pl-4">
                        {l.sugestoes.length > 1 && !feito
                          ? <select className="bg-ink-800 border border-ink-700 rounded px-1.5 py-1 text-xs text-gray-200 max-w-full" value={e.i} disabled={!!rodando} onChange={ev => setLinha(l, { i: Number(ev.target.value) })}>
                              {l.sugestoes.map((o, i) => <option key={o.id} value={i}>{o.nome} · {o.doc}/{o.parcela} · venc. {fmtBr(o.venc)} · emp. {o.fil_id}</option>)}</select>
                          : <><span className="text-gray-200">{s.nome}</span> <span className="font-mono text-gray-400">{s.doc}/{s.parcela}</span> <span className="text-gray-500">venc. {fmtBr(s.venc)} · emp. {s.fil_id}</span></>}
                        <span className={`ml-1.5 inline-block px-1.5 py-0.5 rounded border text-[10px] ${CONF[s.confianca][1]}`}>{CONF[s.confianca][0]}</span>
                        {repetidos.has(s.id) && <div className="text-[11px] text-rose-300 mt-0.5">este título está escolhido em mais de uma linha</div>}
                      </td>
                      <td className="p-2 text-gray-400 truncate max-w-[180px]" title={l.conta_nome}>{l.conta_id} · {l.conta_nome}</td>
                      <td className="p-2">
                        {!r ? <span className="text-gray-600">—</span>
                          : r.fase === 'rodando' ? <span className="text-prim-300 flex items-center gap-1"><Loader2 size={13} className="animate-spin" /> {r.simular ? 'validando…' : 'gravando no Mega…'}</span>
                          : r.status === 'B' ? <span className="text-emerald-300 flex items-center gap-1"><CheckCircle2 size={14} /> Baixado · lançamento {r.lancto_fin}</span>
                          : r.status === 'S' ? <span className="text-sky-300 flex items-center gap-1"><ShieldCheck size={14} /> Pode baixar (validado, nada gravado)</span>
                          : <span className="text-rose-300 flex items-start gap-1"><XCircle size={14} className="shrink-0 mt-0.5" /> <span>{r.simular ? 'Não vai baixar: ' : 'Não baixou: '}{r.mensagem}</span></span>}
                      </td>
                    </tr>); })}</tbody>
                </table>}
          </div>

          {/* ---------------------------------------------------------------- so alerta */}
          {(semTitulo.length > 0 || entradas.length > 0) && (
            <div className="rounded border border-amber-800/40 overflow-hidden">
              <div className="px-3 py-2 bg-amber-950/30 text-sm font-semibold text-amber-200 flex items-center gap-2"><AlertTriangle size={15} /> Só aviso — aqui eu não gravo nada</div>
              <div className="p-3 grid md:grid-cols-2 gap-4 text-xs">
                {semTitulo.length > 0 && <div>
                  <div className="text-gray-200 font-semibold mb-1">{fmtN(semTitulo.length)} pagamento(s) sem título em aberto desse valor · {fmt(semTitulo.reduce((s, l) => s + l.valor, 0))}</div>
                  <div className="text-gray-500 mb-1.5">O banco pagou e não existe título a pagar com esse saldo. Pode ser título não lançado, pago com juros/desconto, ou vários títulos num pagamento só.</div>
                  <ul className="space-y-0.5 max-h-40 overflow-auto">{[...semTitulo].sort((a, b) => b.valor - a.valor).map(l => <li key={chave(l)} className="flex gap-2"><span className="font-mono text-gray-500">{fmtBr(l.data)}</span><span className="text-gray-300 flex-1 truncate">{l.historico}</span><span className="font-mono text-rose-300">{fmt(l.valor)}</span></li>)}</ul>
                </div>}
                {entradas.length > 0 && <div>
                  <div className="text-gray-200 font-semibold mb-1">{fmtN(entradas.length)} entrada(s) sem baixa · {fmt(entradas.reduce((s, l) => s + l.valor, 0))}</div>
                  <div className="text-gray-500 mb-1.5">Recebimento de cliente tem juros, desconto e trava de data: nesta versão a baixa de recebimento continua sendo feita no Mega.</div>
                  <ul className="space-y-0.5 max-h-40 overflow-auto">{[...entradas].sort((a, b) => b.valor - a.valor).map(l => <li key={chave(l)} className="flex gap-2"><span className="font-mono text-gray-500">{fmtBr(l.data)}</span><span className="text-gray-300 flex-1 truncate">{l.historico}{l.sugestoes[0] ? ` → ${l.sugestoes[0].nome} ${l.sugestoes[0].doc}/${l.sugestoes[0].parcela}` : ''}</span><span className="font-mono text-emerald-300">{fmt(l.valor)}</span></li>)}</ul>
                </div>}
              </div>
            </div>)}

          <div className="text-[11px] text-gray-500 flex items-start gap-1.5"><Info size={13} className="shrink-0 mt-0.5" />
            <span>Só baixo título aprovado, fora de remessa de pagamento eletrônico, sem rateio de classe/centro de custo e com <b>saldo igual ao valor do banco</b> (baixa integral). Juros, desconto, baixa parcial e rateio continuam no Mega.
            A baixa entra no Mega <b>pendente de contabilização</b>, como qualquer baixa ainda não contabilizada. Seu usuário precisa poder baixar no Mega (Contas a Pagar e Movimento Financeiro).</span></div>
        </div>

        {/* ------------------------------------------------------------------ rodape / acao */}
        <div className="border-t border-ink-700 p-4 flex flex-wrap items-center gap-3 bg-ink-900">
          {rodando
            ? <div className="flex-1"><div className="text-sm text-gray-200 mb-1">{rodando === 'simular' ? 'Validando sem gravar' : 'Gravando no Mega'} — {feitos} de {total}</div>
                <div className="h-2 rounded bg-ink-800 overflow-hidden"><div className="h-full bg-prim-500 transition-all" style={{ width: `${Math.min(100, feitos / Math.max(1, total) * 100)}%` }} /></div></div>
            : confirma
              ? <><div className="flex-1 text-sm text-amber-200 flex items-center gap-2"><AlertTriangle size={16} /> Vou gravar <b>{fmtN(marcados.length)}</b> baixa(s) no Mega, somando <b>{fmt(somaMarcados)}</b>. Confirma?</div>
                  <button className="btn-ghost" onClick={() => setConfirma(false)}>Voltar</button>
                  <button className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold flex items-center gap-1.5" onClick={() => executar(false)}><Zap size={15} /> Sim, baixar agora</button></>
              : <><div className="flex-1 text-sm text-gray-300">
                    <b className="text-gray-100">{fmtN(marcados.length)}</b> marcado(s) · <b className="text-gray-100">{fmt(somaMarcados)}</b>
                    {baixados.length > 0 && <span className="text-emerald-300"> · {fmtN(baixados.length)} baixado(s) agora ({fmt(baixados.reduce((s, l) => s + l.valor, 0))})</span>}
                    {okSim > 0 && <span className="text-sky-300"> · {fmtN(okSim)} validado(s)</span>}{recus > 0 && <span className="text-rose-300"> · {fmtN(recus)} recusado(s)</span>}
                  </div>
                  <button className="btn-ghost" onClick={onClose}>{baixados.length ? 'Fechar e reanalisar o extrato' : 'Fechar'}</button>
                  <button className="px-3 py-2 rounded bg-ink-700 hover:bg-ink-600 text-gray-100 text-sm flex items-center gap-1.5 disabled:opacity-40" disabled={!marcados.length || repetidos.size > 0} onClick={() => executar(true)} title="Roda a mesma regra da baixa e desfaz tudo: mostra o que passaria e o que seria recusado">
                    <ShieldCheck size={15} /> Validar antes (não grava)</button>
                  <button className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold flex items-center gap-1.5 disabled:opacity-40" disabled={!marcados.length || repetidos.size > 0} onClick={() => setConfirma(true)}>
                    <Zap size={15} /> Baixar {fmtN(marcados.length)} no Mega</button></>}
        </div>
      </div>
    </div>
  );
}

// ================================================================================================ trilha + desfazer
export function BaixasFeitas({ versao, onMudou }) {
  const [dados, setDados] = useState(null);
  const [aberto, setAberto] = useState(false);
  const [pedindo, setPedindo] = useState(null);   // log_id aguardando confirmacao
  const [busy, setBusy] = useState(null);
  const [aviso, setAviso] = useState('');

  const carregar = () => api.baixasListar(7).then(setDados).catch(() => setDados({ itens: [] }));
  useEffect(() => { carregar(); }, [versao]);

  async function desfazer(id) {
    setBusy(id); setAviso('');
    try { const r = await api.baixasEstornar(id); if (!r.ok) setAviso(r.mensagem || 'O Mega recusou o estorno.'); await carregar(); onMudou?.(); }
    catch (e) { setAviso(e.message || 'Falha ao desfazer.'); }
    finally { setBusy(null); setPedindo(null); }
  }

  if (!dados || !dados.itens.length) return null;
  return (
    <div className="rounded border border-ink-700 overflow-hidden">
      <button className="w-full px-3 py-2 bg-ink-800/70 text-sm text-gray-200 flex items-center gap-2 hover:bg-ink-800" onClick={() => setAberto(a => !a)}>
        <History size={15} className="text-prim-400" /> Baixado por aqui nos últimos 7 dias: <b>{fmtN(dados.qt_baixado)}</b> título(s) · <b>{fmt(dados.total_baixado)}</b>
        <span className="ml-auto text-xs text-gray-500">{aberto ? 'recolher' : 'ver e desfazer'}</span></button>
      {aberto && <>
        {aviso && <div className="bg-rose-900/40 text-rose-200 text-xs p-2">{aviso}</div>}
        <table className="w-full text-xs">
          <thead className="text-gray-500 uppercase text-[10px]"><tr><th className="p-2 text-left">Quando · quem</th><th className="p-2 text-left">Fornecedor · título</th><th className="p-2 text-left">Conta</th><th className="p-2 text-center">Data da baixa</th><th className="p-2 text-right">Valor</th><th className="p-2 text-left">Lançamento</th><th className="p-2 text-right">Situação</th></tr></thead>
          <tbody>{dados.itens.map(i => (
            <tr key={i.log_id} className={`border-t border-ink-800 ${i.status === 'E' ? 'opacity-50' : ''}`}>
              <td className="p-2 text-gray-400">{fmtBr(i.em)} {i.em.slice(11)} · {i.usuario}</td>
              <td className="p-2"><span className="text-gray-200">{i.forn_nome}</span> <span className="font-mono text-gray-400">{i.doc}/{i.parcela}</span> <span className="text-gray-600">emp. {i.fil_id}</span></td>
              <td className="p-2 text-gray-400 truncate max-w-[200px]" title={i.conta_nome}>{i.conta_id} · {i.conta_nome}</td>
              <td className="p-2 text-center font-mono text-gray-300">{fmtBr(i.data)}</td>
              <td className="p-2 text-right font-mono text-gray-100">{fmt(i.valor)}</td>
              <td className="p-2 font-mono text-gray-400">{i.lancto_fin || '—'}</td>
              <td className="p-2 text-right whitespace-nowrap">
                {i.status === 'E' ? <span className="text-gray-400">desfeita por {i.estornado_por} em {fmtBr(i.estornado_em)}</span>
                  : i.conciliado ? <span className="text-emerald-300">baixado e conciliado</span>
                  : i.contabilizado ? <span className="text-emerald-300">baixado e contabilizado</span>
                  : pedindo === i.log_id
                    ? <span className="inline-flex items-center gap-1.5 text-amber-200">Desfazer esta baixa?
                        <button className="px-2 py-0.5 rounded bg-rose-700 hover:bg-rose-600 text-white disabled:opacity-40" disabled={busy === i.log_id} onClick={() => desfazer(i.log_id)}>{busy === i.log_id ? 'desfazendo…' : 'sim'}</button>
                        <button className="px-2 py-0.5 rounded bg-ink-700 hover:bg-ink-600" onClick={() => setPedindo(null)}>não</button></span>
                    : <button className="inline-flex items-center gap-1 text-gray-300 hover:text-white underline decoration-dotted" onClick={() => setPedindo(i.log_id)}><Undo2 size={12} /> desfazer</button>}
              </td>
            </tr>))}</tbody>
        </table></>}
    </div>
  );
}
