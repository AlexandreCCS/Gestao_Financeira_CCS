// [21/09/2026 - CRIADO POR ALEXANDRE CARVALHO] Baixas/Conciliacao > Extrato do banco x Mega > CONCILIAR NO MEGA.
// Pedido do Alexandre (com a Renata/Quality): botao para conciliar automaticamente no Mega; o que nao existe, so alertar.
// O QUE ENTRA: linha do banco que JA TEM lancamento no Mega (mesma conta, mesmo valor, natureza espelhada, ate 5 dias) ainda nao
//              conciliado E que ja foi IMPORTADA na conciliacao do Mega (FIN_CONCILIACAO) - o par e 1 x 1.
// O QUE SO ALERTA: linha com lancamento mas NAO importada no Mega (a importacao do extrato continua sendo feita no Mega).
// A REGRA FINAL E DO BANCO (MEGA.CCS_P_GFIN_CONCILIA, espelho do pacote nativo FIN_PCK_CONCILIACAOBANC). "Validar antes" nao grava.
import React, { useEffect, useMemo, useState } from 'react';
import { X, ShieldCheck, Link2, CheckCircle2, XCircle, Loader2, AlertTriangle, Undo2, Info, History } from 'lucide-react';
import { api } from '../../api/client';

const fmt   = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtN  = v => Number(v || 0).toLocaleString('pt-BR');
const fmtBr = iso => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');
const chave = l => `${l.conta_id}|${l.data}|${l.dc}|${l.valor}|${l.historico}|${l.seq}`;

// par "seguro" = ja vem marcado: ate 2 dias entre banco e Mega E nao e tarifa/transferencia/cobranca do banco casada com pagamento de TITULO
// (coincidencia de valor: ex. tarifa de 300,00 x pagamento de 300,00 a um fornecedor dias depois). O resto o usuario decide.
const estranho = l => ['tarifa', 'transferencia', 'cobranca'].includes(l.tipo) && !!l.mov?.titulo;
const seguro   = l => Math.abs(l.mov.dif_dias) <= 2 && !estranho(l);

export function separarConciliaveis(linhas) {
  const c = linhas.filter(l => l.situacao === 'conciliar' && l.mov);
  return { prontos: c.filter(l => l.ext_id && !l.extrato_conciliado), naoImportados: c.filter(l => !l.ext_id), extratoJaUsado: c.filter(l => l.ext_id && l.extrato_conciliado) };
}

export default function ConciliarNoMega({ linhas, arquivo, onClose, onFeito }) {
  const { prontos, naoImportados, extratoJaUsado } = useMemo(() => separarConciliaveis(linhas), [linhas]);
  const [on, setOn] = useState(() => Object.fromEntries(prontos.map(l => [chave(l), seguro(l)])));
  const [res, setRes] = useState({});
  const [rodando, setRodando]   = useState(null);
  const [confirma, setConfirma] = useState(false);
  const [feitos, setFeitos]     = useState(0);
  const [total,  setTotal]      = useState(0);

  const marcados = prontos.filter(l => on[chave(l)] && res[chave(l)]?.status !== 'C');
  const soma = marcados.reduce((s, l) => s + l.valor, 0);
  const conciliados = prontos.filter(l => res[chave(l)]?.status === 'C');
  const marcar = v => setOn(Object.fromEntries(prontos.map(l => [chave(l), v === 'perto' ? seguro(l) : v])));

  async function executar(simular) {
    setConfirma(false); setRodando(simular ? 'simular' : 'gravar'); setFeitos(0);
    const fila = [...marcados]; setTotal(fila.length);
    for (const l of fila) {
      const k = chave(l);
      setRes(r => ({ ...r, [k]: { fase: 'rodando', simular } }));
      try {
        const out = await api.baixasConciliar({ simular, arquivo, itens: [{ ref: k.slice(0, 40), mov_id: l.mov.id, ext_id: l.ext_id, historico: l.historico }] });
        setRes(r => ({ ...r, [k]: { fase: 'fim', simular, ...out.resultados[0] } }));
      } catch (e) {
        setRes(r => ({ ...r, [k]: { fase: 'fim', simular, status: 'X', mensagem: e.message || 'Falha ao falar com o servidor. Confira no Mega antes de tentar de novo.' } }));
      }
      setFeitos(n => n + 1);
    }
    setRodando(null);
    if (!simular) onFeito?.();
  }
  const okSim = prontos.filter(l => res[chave(l)]?.status === 'S').length, recus = prontos.filter(l => res[chave(l)]?.fase === 'fim' && res[chave(l)]?.status === 'X').length;

  return (
    <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-3">
      <div className="bg-ink-900 rounded-lg w-[97vw] max-w-[1400px] max-h-[94vh] flex flex-col border border-prim-700/30 shadow-2xl">
        <div className="flex items-start justify-between p-5 border-b border-ink-700">
          <div>
            <h3 className="text-xl font-bold text-prim-400 flex items-center gap-2"><Link2 size={20} /> Conciliar no Mega</h3>
            <div className="text-xs text-gray-400 mt-1 max-w-4xl">
              Cada linha do banco que já tem o lançamento correspondente no Mega — <b className="text-gray-200">mesma conta, mesmo valor</b> — é conciliada com ele, uma a uma,
              do mesmo jeito que a tela de conciliação do Mega grava. Fica marcada como conciliação <b className="text-gray-200">automática</b>, com o seu usuário.
            </div>
          </div>
          <button className="text-gray-400 hover:text-white disabled:opacity-30" disabled={!!rodando} onClick={onClose}><X size={22} /></button>
        </div>

        <div className="overflow-auto flex-1 p-4 space-y-4">
          <div className="rounded border border-ink-700 overflow-hidden">
            <div className="px-3 py-2 bg-ink-800/70 text-sm font-semibold text-gray-100 flex flex-wrap items-center gap-3">
              <span>Dá para conciliar por aqui <span className="text-gray-400 font-normal">· {fmtN(prontos.length)} par(es) · {fmt(prontos.reduce((s, l) => s + l.valor, 0))}</span></span>
              <span className="ml-auto flex gap-1 text-xs font-normal">
                <button className="px-2 py-1 rounded bg-ink-700 hover:bg-ink-600 disabled:opacity-40" disabled={!!rodando} onClick={() => marcar('perto')}>só os pares seguros</button>
                <button className="px-2 py-1 rounded bg-ink-700 hover:bg-ink-600 disabled:opacity-40" disabled={!!rodando} onClick={() => marcar(true)}>todos</button>
                <button className="px-2 py-1 rounded bg-ink-700 hover:bg-ink-600 disabled:opacity-40" disabled={!!rodando} onClick={() => marcar(false)}>nenhum</button>
              </span>
            </div>
            {prontos.length === 0
              ? <div className="p-6 text-center text-sm text-gray-500">Nenhum par pronto para conciliar neste extrato.</div>
              : <table className="w-full text-xs">
                  <thead className="text-gray-500 uppercase text-[10px] bg-ink-900"><tr>
                    <th className="p-2 w-8"></th><th className="p-2 text-center">Data do banco</th><th className="p-2 text-left">O banco diz</th><th className="p-2 text-right">Valor</th>
                    <th className="p-2 text-left pl-4">Lançamento do Mega</th><th className="p-2 text-center">Data no Mega</th><th className="p-2 text-left w-[26%]">Resultado</th></tr></thead>
                  <tbody>{[...prontos].sort((a, b) => b.valor - a.valor).map(l => { const k = chave(l), r = res[k], feito = r?.status === 'C', d = l.mov.dif_dias; return (
                    <tr key={k} className={`border-t border-ink-800 ${feito ? 'bg-emerald-950/30' : on[k] ? 'bg-prim-900/10' : ''}`}>
                      <td className="p-2 text-center"><input type="checkbox" className="accent-prim-500 w-4 h-4" checked={feito || !!on[k]} disabled={feito || !!rodando} onChange={ev => setOn(o => ({ ...o, [k]: ev.target.checked }))} /></td>
                      <td className="p-2 text-center font-mono text-gray-300">{fmtBr(l.data)}</td>
                      <td className="p-2 text-gray-200 whitespace-nowrap">{l.historico} <span className="text-gray-600">{l.dc === 'D' ? 'saída' : 'entrada'}</span></td>
                      <td className={`p-2 text-right font-mono font-semibold ${l.dc === 'D' ? 'text-rose-300' : 'text-emerald-300'}`}>{fmt(l.valor)}</td>
                      <td className="p-2 pl-4"><span className="text-gray-200">{l.mov.contraparte || l.mov.historico || `ação ${l.mov.acao}`}</span> {l.mov.titulo && <span className="font-mono text-gray-400">{l.mov.titulo}</span>} <span className="text-gray-500">· doc. {l.mov.doc} · {l.mov.tpd}</span>
                        {estranho(l) && <div className="text-[11px] text-rose-300 mt-0.5">o banco diz {l.tipo === 'tarifa' ? 'tarifa' : l.tipo === 'cobranca' ? 'cobrança' : 'transferência'} e o lançamento é pagamento de título — pode ser só coincidência de valor, confira</div>}</td>
                      <td className="p-2 text-center font-mono text-gray-300">{fmtBr(l.mov.data)}{d !== 0 && <span className={`ml-1 text-[10px] ${Math.abs(d) <= 2 ? 'text-amber-300' : 'text-rose-300'}`}>{d > 0 ? '+' : ''}{d}d</span>}</td>
                      <td className="p-2">
                        {!r ? <span className="text-gray-600">—</span>
                          : r.fase === 'rodando' ? <span className="text-prim-300 flex items-center gap-1"><Loader2 size={13} className="animate-spin" /> {r.simular ? 'validando…' : 'conciliando no Mega…'}</span>
                          : r.status === 'C' ? <span className="text-emerald-300 flex items-center gap-1"><CheckCircle2 size={14} /> Conciliado · nº {r.con_id}</span>
                          : r.status === 'S' ? <span className="text-sky-300 flex items-center gap-1"><ShieldCheck size={14} /> Pode conciliar (validado, nada gravado)</span>
                          : <span className="text-rose-300 flex items-start gap-1"><XCircle size={14} className="shrink-0 mt-0.5" /> <span>{r.simular ? 'Não vai conciliar: ' : 'Não conciliou: '}{r.mensagem}</span></span>}
                      </td>
                    </tr>); })}</tbody>
                </table>}
          </div>

          {(naoImportados.length > 0 || extratoJaUsado.length > 0) && (
            <div className="rounded border border-amber-800/40 overflow-hidden">
              <div className="px-3 py-2 bg-amber-950/30 text-sm font-semibold text-amber-200 flex items-center gap-2"><AlertTriangle size={15} /> Só aviso — aqui eu não gravo nada</div>
              <div className="p-3 grid md:grid-cols-2 gap-4 text-xs">
                {naoImportados.length > 0 && <div>
                  <div className="text-gray-200 font-semibold mb-1">{fmtN(naoImportados.length)} linha(s) ainda não importada(s) na conciliação do Mega · {fmt(naoImportados.reduce((s, l) => s + l.valor, 0))}</div>
                  <div className="text-gray-500 mb-1.5">O lançamento existe, mas a linha do extrato não está no Mega. Importe o arquivo do banco na conciliação do Mega e arraste-o aqui de novo.</div>
                  <ul className="space-y-0.5 max-h-40 overflow-auto">{naoImportados.map(l => <li key={chave(l)} className="flex gap-2"><span className="font-mono text-gray-500">{fmtBr(l.data)}</span><span className="text-gray-300 flex-1 truncate">{l.historico}</span><span className="font-mono text-gray-200">{fmt(l.valor)}</span></li>)}</ul>
                </div>}
                {extratoJaUsado.length > 0 && <div>
                  <div className="text-gray-200 font-semibold mb-1">{fmtN(extratoJaUsado.length)} linha(s) do extrato já conciliada(s) com OUTRO lançamento · {fmt(extratoJaUsado.reduce((s, l) => s + l.valor, 0))}</div>
                  <div className="text-gray-500 mb-1.5">No Mega a linha do banco já está conciliada, mas o lançamento que casa com ela aqui não. Confira na tela de conciliação do Mega.</div>
                  <ul className="space-y-0.5 max-h-40 overflow-auto">{extratoJaUsado.map(l => <li key={chave(l)} className="flex gap-2"><span className="font-mono text-gray-500">{fmtBr(l.data)}</span><span className="text-gray-300 flex-1 truncate">{l.historico} → {l.mov.contraparte}</span><span className="font-mono text-gray-200">{fmt(l.valor)}</span></li>)}</ul>
                </div>}
              </div>
            </div>)}

          <div className="text-[11px] text-gray-500 flex items-start gap-1.5"><Info size={13} className="shrink-0 mt-0.5" />
            <span>Só concilio par <b>um para um</b>: valor igual, saída com saída e entrada com entrada, até 5 dias de distância, nenhum dos dois já conciliado e período financeiro aberto no Mega.
            Um pagamento do banco que cobre vários lançamentos (ou o contrário) continua sendo conciliado na tela do Mega. Com valores repetidos no mesmo dia, o par é escolhido pela data mais próxima.</span></div>
        </div>

        <div className="border-t border-ink-700 p-4 flex flex-wrap items-center gap-3 bg-ink-900">
          {rodando
            ? <div className="flex-1"><div className="text-sm text-gray-200 mb-1">{rodando === 'simular' ? 'Validando sem gravar' : 'Conciliando no Mega'} — {feitos} de {total}</div>
                <div className="h-2 rounded bg-ink-800 overflow-hidden"><div className="h-full bg-prim-500 transition-all" style={{ width: `${Math.min(100, feitos / Math.max(1, total) * 100)}%` }} /></div></div>
            : confirma
              ? <><div className="flex-1 text-sm text-amber-200 flex items-center gap-2"><AlertTriangle size={16} /> Vou conciliar <b>{fmtN(marcados.length)}</b> lançamento(s) no Mega, somando <b>{fmt(soma)}</b>. Confirma?</div>
                  <button className="btn-ghost" onClick={() => setConfirma(false)}>Voltar</button>
                  <button className="px-4 py-2 rounded bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold flex items-center gap-1.5" onClick={() => executar(false)}><Link2 size={15} /> Sim, conciliar agora</button></>
              : <><div className="flex-1 text-sm text-gray-300"><b className="text-gray-100">{fmtN(marcados.length)}</b> marcado(s) · <b className="text-gray-100">{fmt(soma)}</b>
                    {conciliados.length > 0 && <span className="text-emerald-300"> · {fmtN(conciliados.length)} conciliado(s) agora ({fmt(conciliados.reduce((s, l) => s + l.valor, 0))})</span>}
                    {okSim > 0 && <span className="text-sky-300"> · {fmtN(okSim)} validado(s)</span>}{recus > 0 && <span className="text-rose-300"> · {fmtN(recus)} recusado(s)</span>}</div>
                  <button className="btn-ghost" onClick={onClose}>{conciliados.length ? 'Fechar e reanalisar o extrato' : 'Fechar'}</button>
                  <button className="px-3 py-2 rounded bg-ink-700 hover:bg-ink-600 text-gray-100 text-sm flex items-center gap-1.5 disabled:opacity-40" disabled={!marcados.length} onClick={() => executar(true)} title="Roda a mesma regra da conciliação e desfaz tudo">
                    <ShieldCheck size={15} /> Validar antes (não grava)</button>
                  <button className="px-4 py-2 rounded bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold flex items-center gap-1.5 disabled:opacity-40" disabled={!marcados.length} onClick={() => setConfirma(true)}>
                    <Link2 size={15} /> Conciliar {fmtN(marcados.length)} no Mega</button></>}
        </div>
      </div>
    </div>
  );
}

// ================================================================================================ trilha + desfazer
export function ConciliacoesFeitas({ versao, onMudou }) {
  const [dados, setDados] = useState(null);
  const [aberto, setAberto] = useState(false);
  const [pedindo, setPedindo] = useState(null);
  const [busy, setBusy] = useState(null);
  const [aviso, setAviso] = useState('');
  const carregar = () => api.baixasConciliacoes(7).then(setDados).catch(() => setDados({ itens: [] }));
  useEffect(() => { carregar(); }, [versao]);

  async function desfazer(id) {
    setBusy(id); setAviso('');
    try { const r = await api.baixasDesconciliar(id); if (!r.ok) setAviso(r.mensagem || 'O Mega recusou desfazer.'); await carregar(); onMudou?.(); }
    catch (e) { setAviso(e.message || 'Falha ao desfazer.'); }
    finally { setBusy(null); setPedindo(null); }
  }
  if (!dados || !dados.itens.length) return null;
  return (
    <div className="rounded border border-ink-700 overflow-hidden">
      <button className="w-full px-3 py-2 bg-ink-800/70 text-sm text-gray-200 flex items-center gap-2 hover:bg-ink-800" onClick={() => setAberto(a => !a)}>
        <History size={15} className="text-amber-400" /> Conciliado por aqui nos últimos 7 dias: <b>{fmtN(dados.qt)}</b> lançamento(s) · <b>{fmt(dados.total)}</b>
        <span className="ml-auto text-xs text-gray-500">{aberto ? 'recolher' : 'ver e desfazer'}</span></button>
      {aberto && <>
        {aviso && <div className="bg-rose-900/40 text-rose-200 text-xs p-2">{aviso}</div>}
        <table className="w-full text-xs">
          <thead className="text-gray-500 uppercase text-[10px]"><tr><th className="p-2 text-left">Quando · quem</th><th className="p-2 text-left">Conta</th><th className="p-2 text-left">O banco diz</th><th className="p-2 text-center">Data do banco</th><th className="p-2 text-right">Valor</th><th className="p-2 text-left">Lançamento · conciliação</th><th className="p-2 text-right">Situação</th></tr></thead>
          <tbody>{dados.itens.map(i => (
            <tr key={i.log_id} className={`border-t border-ink-800 ${i.status === 'D' ? 'opacity-50' : ''}`}>
              <td className="p-2 text-gray-400">{fmtBr(i.em)} {i.em.slice(11)} · {i.usuario}</td>
              <td className="p-2 text-gray-400 truncate max-w-[220px]" title={i.conta_nome}>{i.conta_id} · {i.conta_nome}</td>
              <td className="p-2 text-gray-200">{i.historico}</td>
              <td className="p-2 text-center font-mono text-gray-300">{fmtBr(i.data_banco)}</td>
              <td className="p-2 text-right font-mono text-gray-100">{fmt(i.valor)}</td>
              <td className="p-2 font-mono text-gray-400">{i.lancto} · nº {i.con_id || '—'}</td>
              <td className="p-2 text-right whitespace-nowrap">
                {i.status === 'D' ? <span className="text-gray-400">desfeita por {i.desfeito_por} em {fmtBr(i.desfeito_em)}</span>
                  : pedindo === i.log_id
                    ? <span className="inline-flex items-center gap-1.5 text-amber-200">Desfazer esta conciliação?
                        <button className="px-2 py-0.5 rounded bg-rose-700 hover:bg-rose-600 text-white disabled:opacity-40" disabled={busy === i.log_id} onClick={() => desfazer(i.log_id)}>{busy === i.log_id ? 'desfazendo…' : 'sim'}</button>
                        <button className="px-2 py-0.5 rounded bg-ink-700 hover:bg-ink-600" onClick={() => setPedindo(null)}>não</button></span>
                    : <button className="inline-flex items-center gap-1 text-gray-300 hover:text-white underline decoration-dotted" onClick={() => setPedindo(i.log_id)}><Undo2 size={12} /> desfazer</button>}
              </td>
            </tr>))}</tbody>
        </table></>}
    </div>
  );
}
