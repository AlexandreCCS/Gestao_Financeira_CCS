// [25/10/2026 - CRIADO POR ALEXANDRE CARVALHO] Baixas/Conciliação › BAIXAR E CONCILIAR (fase 2 Quality).
// Pedido do Alexandre: "tela extremamente simplificada, padrão Apple, limpa; o robô automatiza, a tela é a caixa de exceções;
// pense em redução de pessoas". A baixa nasce da linha do extrato já importada no Mega e sai conciliada na mesma transação
// (MEGA.CCS_P_GFIN_BXC). Aqui: uma conta por vez, um número grande (o que está pronto), um botão primário. O resto fica
// recolhido: Decidir (ambíguos), Lançar no Mega (movimentos reais por de-para), Lote de cobrança / Conciliar (N × M),
// Informativos (aplicação automática) e Feitas hoje (trilha com Desfazer).
// Encargos: calculados pela regra do título; "Editar" direto para quem tem o módulo LIBERA_ENCARGOS, senão vira pedido de liberação.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2, XCircle, Loader2, ChevronDown, ChevronRight, Undo2, Paperclip, PencilLine, Search, Zap, Link2,
  FilePlus2, Info, EyeOff, ShieldCheck, Clock3, Sparkles, X, RefreshCw
} from 'lucide-react';
import { api, getSession } from '../../api/client';
import { podeVerModulo } from '../../modulos';

const fmt    = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtN   = v => Number(v || 0).toLocaleString('pt-BR');
const fmtBr  = s => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—');
const fmtHr  = s => (s ? `${fmtBr(s)} ${String(s).slice(11, 16)}` : '—');
const r2     = v => Math.round((Number(v) || 0) * 100) / 100;
const isoDia = n => { const d = new Date(); d.setDate(d.getDate() - (n || 0)); return d.toISOString().slice(0, 10); };
const CONF   = { alta: ['confere', 'text-emerald-300 border-emerald-700/40 bg-emerald-900/30'], media: ['provável', 'text-amber-300 border-amber-700/40 bg-amber-900/30'], baixa: ['só o valor', 'text-gray-400 border-ink-600 bg-ink-700/60'], manual: ['escolhido', 'text-prim-400 border-prim-600/40 bg-ink-700/60'] };
const TIPO   = { P: 'pagamento', R: 'recebimento', A: 'lançamento', C: 'conciliação', I: 'informativo' };

// dinheiro que o banco movimentou para este título = principal + juros + multa (o desconto só abate o título: título quita principal + desconto)
// [25/10/2026] regra alinhada com a procedure CCS_P_GFIN_BXC_X depois da prova simulada
const parcelaBanco = t => r2(Number(t.valor || 0) + Number(t.juros || 0) + Number(t.multa || 0));

// [28/10/2026] "Achar combinação" do painel de busca: subconjunto cuja soma = alvo (centavos), mesma poda do motor (baixarConciliar.js)
function subconjunto(itens, alvo, maxQt = 6, orcamento = 150000) {
  const ord = [...itens].sort((a, b) => b.saldo - a.saldo), cents = ord.map(x => Math.round(x.saldo * 100)), alvoC = Math.round(alvo * 100);
  let nos = 0, achado = null;
  const rec = (i, resto, pick) => {
    if (achado || nos++ > orcamento) return;
    if (resto === 0) { if (pick.length) achado = [...pick]; return; }
    if (i >= cents.length || pick.length >= maxQt) return;
    let soma = 0; for (let k = i; k < cents.length && k < i + maxQt - pick.length; k++) soma += cents[k];
    if (soma < resto) return;
    if (cents[i] <= resto) { pick.push(i); rec(i + 1, resto - cents[i], pick); pick.pop(); }
    rec(i + 1, resto, pick);
  };
  rec(0, alvoC, []);
  return achado ? achado.map(i => ord[i]) : null;
}
const somaDias = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

function Pilula({ cls = '', children, title }) {
  return <span title={title} className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] leading-4 whitespace-nowrap ${cls}`}>{children}</span>;
}
function Encargos({ t }) {
  const j = Number(t.juros || 0), m = Number(t.multa || 0), d = Number(t.desconto || 0);
  if (!j && !m && !d) return <Pilula cls="text-gray-400 border-ink-600 bg-ink-700/60">sem encargos</Pilula>;
  return <>
    {j > 0 && <Pilula cls="text-amber-300 border-amber-700/40 bg-amber-900/30">juros {fmt(j)}</Pilula>}
    {m > 0 && <Pilula cls="text-amber-300 border-amber-700/40 bg-amber-900/30">multa {fmt(m)}</Pilula>}
    {d > 0 && <Pilula cls="text-sky-300 border-sky-700/40 bg-sky-900/30">desconto {fmt(d)}</Pilula>}
  </>;
}
function Modal({ titulo, children, onClose, acoes, largura = 'max-w-xl' }) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className={`bg-ink-900 border border-ink-700 rounded-2xl shadow-2xl w-full max-h-[94vh] overflow-y-auto ${largura}`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <h3 className="text-lg font-semibold text-gray-100">{titulo}</h3>
          {onClose && <button className="text-gray-500 hover:text-white" onClick={onClose}><X size={20} /></button>}
        </div>
        <div className="px-6 pb-4 text-sm text-gray-300 space-y-3">{children}</div>
        {acoes && <div className="px-6 py-4 border-t border-ink-700 flex flex-wrap justify-end gap-2">{acoes}</div>}
      </div>
    </div>
  );
}
function Secao({ titulo, qt, aberta, onToggle, icone: I, children, nota }) {
  return (
    <section className="space-y-3">
      <button className="w-full flex items-center gap-2 text-left group" onClick={onToggle}>
        {aberta ? <ChevronDown size={16} className="text-gray-500" /> : <ChevronRight size={16} className="text-gray-500" />}
        {I && <I size={16} className="text-gray-400" />}
        <span className="text-sm font-semibold text-gray-200">{titulo}</span>
        <span className="text-xs text-gray-500">{fmtN(qt)}</span>
        {nota && <span className="text-xs text-gray-600 ml-2 hidden md:inline">{nota}</span>}
      </button>
      {aberta && <div className="space-y-2">{children}</div>}
    </section>
  );
}
function Resultado({ r }) {
  if (!r) return null;
  if (r.fase === 'rodando') return <div className="mt-3 text-sm text-prim-400 flex items-center gap-2"><Loader2 size={15} className="animate-spin" /> {r.simular ? 'validando no Mega…' : 'gravando no Mega…'}</div>;
  if (r.status === 'B') return <div className="mt-3 text-sm text-emerald-300 flex items-center gap-2"><CheckCircle2 size={15} /> Baixado e conciliado{r.lancto_fin ? ` · lançamento ${r.lancto_fin}` : ''}</div>;
  if (r.status === 'S') return <div className="mt-3 text-sm text-sky-300 flex items-center gap-2"><ShieldCheck size={15} /> Validado, nada gravado</div>;
  return <div className="mt-3 text-sm text-rose-300 flex items-start gap-2"><XCircle size={15} className="shrink-0 mt-0.5" /> <span>{r.mensagem || 'Recusado pelo Mega.'}</span></div>;
}

export default function BaixarConciliar() {
  const user = getSession()?.user;
  const liberaDireto = podeVerModulo(user, 'LIBERA_ENCARGOS');
  const [contas, setContas]   = useState(null);
  const [conta, setConta]     = useState(null);
  const [tipo, setTipo]       = useState('T');
  const [ini, setIni]         = useState(isoDia(15));
  const [fim, setFim]         = useState(isoDia(0));
  const [busca, setBusca]     = useState('');
  const [dados, setDados]     = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro]       = useState('');
  const [marcados, setMarcados] = useState(new Set());
  const [abertos, setAbertos] = useState(new Set());
  const [edits, setEdits]     = useState({});       // id -> { tit: { lancto: {juros,multa,desconto} }, comp }
  const [res, setRes]         = useState({});       // ref -> { fase, simular, status, mensagem, lancto_fin }
  const [rodando, setRodando] = useState(false);
  const [confirma, setConfirma] = useState(null);   // { payloads, fn, titulo, texto, fase, recusas, validos }
  const [secoes, setSecoes]   = useState({ decidir: true, real: true, lote: true, conciliar: true, info: false, feitas: true });
  const [feitas, setFeitas]   = useState([]);
  const [modal, setModal]     = useState(null);     // { tipo: 'encargos'|'pedido'|'ignorar'|'desfazer', ... }
  const [escolha, setEscolha] = useState({});       // id -> Set(lancto) na seção Decidir
  const [manual, setManual]   = useState({});       // [28/10/2026] id -> títulos escolhidos no painel de busca (o item vira "pronto")
  const fileRef = useRef(null);
  const alvoArquivo = useRef(null);

  useEffect(() => {
    api.bxcContas().then(r => {
      const cs = (r.contas || []).filter(c => c.ativa !== 'N' && c.ativa !== false);
      setContas(cs);
      if (!conta && cs.length) setConta([...cs].sort((a, b) => (b.pendentes || 0) - (a.pendentes || 0))[0].agn_id);
    }).catch(() => { setContas([]); setErro('Não consegui carregar as contas.'); });
  }, []);

  async function carregar() {
    if (!conta) return;
    setCarregando(true); setErro('');
    try {
      const [d, f] = await Promise.all([api.bxcPendentes({ conta, tipo, ini, fim }), api.bxcFeitas({ dias: 1, conta }).catch(() => ({ itens: [] }))]);
      setDados(d); setFeitas(f.itens || []); setRes({});
      setMarcados(new Set((d.itens || []).filter(i => i.situacao === 'pronto' && !bloqueado(i)).map(i => i.id)));
      // títulos escolhidos à mão: refaz saldo e pedido de liberação (o motor não conhece esses títulos); some o que a linha já não tem
      const vivos = new Set((d.itens || []).map(i => i.id)), novo = {};
      for (const [id, tits] of Object.entries(manual)) {
        if (!vivos.has(id) || !tits.length) continue;
        try {
          const r = await api.bxcTitulos({ tipo: tits[0].tipo_item, org: tits[0].org, lanctos: tits.map(t => t.lancto).join(',') });
          novo[id] = tits.map(t => { const x = (r.titulos || []).find(y => y.lancto === t.lancto && y.seq === t.seq); return x ? { ...t, saldo: x.saldo, pedido: x.pedido, bloqueio: x.bloqueio } : null; }).filter(Boolean);
        } catch { novo[id] = tits; }
      }
      setManual(novo);
    } catch (e) { setErro(e.message || 'Falha ao consultar o Mega.'); setDados(null); }
    finally { setCarregando(false); }
  }
  useEffect(() => { carregar(); }, [conta, tipo, ini, fim]);

  const bloqueado = item => (item.titulos || []).some(t => (t.pedido && t.pedido.status === 'P') || t.bloqueio);
  const q = busca.trim().toLowerCase();
  const itens = useMemo(() => (dados?.itens || []).map(i => manual[i.id]?.length ? { ...i, situacao: 'pronto', confianca: 'manual', titulos: manual[i.id], candidatos: [], motivo: 'Títulos escolhidos na busca' } : i).filter(i => !q || JSON.stringify([i.linhas, i.titulos?.map(t => [t.agn_nome, t.doc])]).toLowerCase().includes(q)), [dados, q, manual]);
  const por = s => itens.filter(i => i.situacao === s);
  const prontos = por('pronto'), decidir = por('decidir'), reais = por('real'), lotes = por('lote'), conciliar = por('conciliar'), infos = por('informativo');
  const selecionados = prontos.filter(i => marcados.has(i.id) && res[i.id]?.status !== 'B');
  const somaSel = selecionados.reduce((s, i) => s + Number(i.valor_banco || 0), 0);
  const contaAtual = contas?.find(c => c.agn_id === conta);

  // título com os encargos editados nesta tela (o dinheiro do banco não muda; o principal se ajusta)
  const titEditado = (item, t) => {
    const e = edits[item.id]?.tit?.[t.lancto];
    if (!e) return { ...t };
    const juros = r2(e.juros), multa = r2(e.multa), desconto = r2(e.desconto);
    return { ...t, juros, multa, desconto, valor: r2(parcelaBanco(t) - juros - multa) };
  };
  const payloadBaixa = item => ({
    ref: item.id, tipo: item.tipo, conta, data: item.data, tpd_fin: item.tpd_fin, doc_fin: item.doc_fin,
    hist: (item.linhas || []).map(l => l.historico).join(' | ').slice(0, 120),
    cbas: (item.linhas || []).map(l => l.cba),
    titulos: (item.titulos || []).map(t => { const x = titEditado(item, t); return { seq: x.seq, lancto: x.lancto, valor: x.valor, juros: x.juros, multa: x.multa, desconto: x.desconto, ped_id: x.pedido?.status === 'L' ? x.pedido.id : undefined }; }),
    comp_id: edits[item.id]?.comp?.comp_id
  });

  // executa uma lista: valida tudo (simular) -> mostra recusas -> grava os válidos
  async function rodar(payloads, fn, simular) {
    const saida = [];
    for (const p of payloads) {
      setRes(r => ({ ...r, [p.ref]: { fase: 'rodando', simular } }));
      try {
        const out = await fn({ simular, itens: [p] });
        const x = out.resultados?.[0] || { status: 'X', mensagem: 'O servidor não devolveu resultado.' };
        setRes(r => ({ ...r, [p.ref]: { fase: 'fim', simular, ...x } })); saida.push({ ...p, ...x });
      } catch (e) {
        const x = { status: 'X', mensagem: e.message || 'Falha ao falar com o servidor.' };
        setRes(r => ({ ...r, [p.ref]: { fase: 'fim', simular, ...x } })); saida.push({ ...p, ...x });
      }
    }
    return saida;
  }
  const pedirConfirmacao = (payloads, fn, titulo, texto) => setConfirma({ payloads, fn, titulo, texto, fase: 'perguntar' });
  async function confirmar() {
    const c = confirma; if (!c) return;
    setRodando(true);
    if (c.fase === 'perguntar') {
      const sim = await rodar(c.payloads, c.fn, true);
      const recusas = sim.filter(x => x.status !== 'S'), validos = c.payloads.filter(p => sim.find(x => x.ref === p.ref)?.status === 'S');
      if (recusas.length) { setConfirma({ ...c, fase: 'simulado', recusas, validos }); setRodando(false); return; }
      await rodar(validos, c.fn, false);
    } else {
      await rodar(c.validos, c.fn, false);
    }
    setConfirma(null); setRodando(false);
    await carregar();
  }

  // ações
  const baixarSelecionados = () => pedirConfirmacao(selecionados.map(payloadBaixa), api.bxcExecutar, `Baixar e conciliar ${fmtN(selecionados.length)} item(ns)?`, `${fmt(somaSel)} na conta ${contaAtual?.nome || conta}. Cada item vira baixa no Mega, na data do banco, já conciliada com a linha do extrato. Primeiro valido tudo; só gravo o que passar.`);
  const lancarReal = item => pedirConfirmacao([{ ref: item.id, cba: item.linhas[0]?.cba, dep_id: item.depara?.id, hist: item.linhas[0]?.historico }], api.bxcReal, 'Lançar no Mega?', `${fmt(item.valor_banco)} · ${item.linhas[0]?.historico} → ${item.depara?.descricao || 'de-para'}. Nasce o lançamento avulso já conciliado.`);
  const conciliarItem = item => pedirConfirmacao([{ ref: item.id, conta, movs: (item.movs || []).map(m => ({ seq: m.seq, lancto: m.lancto })), cbas: (item.linhas || []).map(l => l.cba) }], api.bxcConciliar, 'Conciliar no Mega?', `${fmtN(item.movs?.length || 0)} lançamento(s) × ${fmtN(item.linhas?.length || 0)} linha(s) do extrato · ${fmt(item.valor_banco)}.`);
  function decidirBaixar(item) {
    const sel = escolha[item.id] || new Set();
    const cands = (item.candidatos || []).filter(c => sel.has(c.lancto)).sort((a, b) => String(a.venc).localeCompare(String(b.venc)));
    let resta = r2(item.valor_banco); const tits = [];
    for (const c of cands) { const v = r2(Math.min(Number(c.saldo || 0), resta)); if (v > 0) { tits.push({ seq: c.seq, lancto: c.lancto, valor: v, juros: 0, multa: 0, desconto: 0 }); resta = r2(resta - v); } }
    if (resta > 0.005 || !tits.length) return;
    pedirConfirmacao([{ ...payloadBaixa(item), titulos: tits }], api.bxcExecutar, 'Baixar com os títulos escolhidos?', `${fmt(item.valor_banco)} em ${fmtN(tits.length)} título(s)${tits.some((t, i) => t.valor < Number(cands[i]?.saldo || 0)) ? ' · o último fica com saldo (baixa parcial)' : ''}.`);
  }
  // [28/10/2026] títulos vindos do painel de busca: soma ≥ banco → o último fica parcial; soma < banco → a diferença vira juros no último
  // (precisa de "Editar encargos" ou do pedido de liberação, como qualquer encargo fora da regra; o servidor confere de novo).
  function usarTitulos(item, sel) {
    const ord = [...sel].sort((a, b) => String(a.venc).localeCompare(String(b.venc)) || a.lancto - b.lancto);
    let resta = r2(item.valor_banco); const tits = [];
    for (const t of ord) {
      const v = r2(Math.min(Number(t.saldo || 0), resta)); if (v <= 0) break;
      tits.push({ ...t, tipo_item: item.tipo, valor: v, juros: 0, multa: 0, desconto: 0, calc: { juros: 0, multa: 0, desconto: 0 } }); resta = r2(resta - v);
    }
    if (resta > 0.005 && tits.length) { const u = tits[tits.length - 1]; u.juros = resta; }
    setManual(m => ({ ...m, [item.id]: tits }));
    setEdits(e => { const n = { ...e }; if (n[item.id]) delete n[item.id].tit; return n; });
    setMarcados(m => { const n = new Set(m); n.add(item.id); return n; });
    setAbertos(a => { const n = new Set(a); n.add(item.id); return n; });
    setModal(null);
  }
  const desfazerEscolha = item => { setManual(m => { const n = { ...m }; delete n[item.id]; return n; }); setMarcados(m => { const n = new Set(m); n.delete(item.id); return n; }); };
  async function ignorar(item, motivo) {
    setRodando(true);
    try { for (const l of item.linhas || []) await api.bxcIgnorar(l.cba, motivo); } catch (e) { setErro(e.message); }
    setModal(null); setRodando(false); await carregar();
  }
  async function desfazer(f) {
    setRodando(true);
    try { const r = await api.bxcEstornar(f.log_id); if (!r.ok) setErro(r.log?.mensagem || 'O Mega não deixou desfazer.'); } catch (e) { setErro(e.message); }
    setModal(null); setRodando(false); await carregar();
  }
  async function anexar(file) {
    const item = alvoArquivo.current; if (!item || !file) return;
    const fd = new FormData(); fd.append('arquivo', file); fd.append('cba', item.linhas[0]?.cba ?? ''); fd.append('valor_esperado', String(item.valor_banco));
    setRodando(true);
    try { const r = await api.bxcComprovante(fd); setEdits(e => ({ ...e, [item.id]: { ...e[item.id], comp: r } })); }
    catch (e) { setErro(e.message || 'Falha ao ler o comprovante.'); }
    setRodando(false);
  }
  function salvarEncargos(item, t, v) {
    const juros = r2(v.juros), multa = r2(v.multa), desconto = r2(v.desconto);
    const principal = r2(parcelaBanco(t) - juros - multa);
    if (principal <= 0) return 'O principal ficaria zero ou negativo.';
    if (principal + desconto > Number(t.saldo || 0) + 0.005) return `Principal + desconto (${fmt(principal + desconto)}) passa do saldo do título (${fmt(t.saldo)}).`;
    setEdits(e => ({ ...e, [item.id]: { ...e[item.id], tit: { ...(e[item.id]?.tit || {}), [t.lancto]: { juros, multa, desconto } } } }));
    setModal(null); return '';
  }
  async function pedirLiberacao(item, t, v, motivo) {
    setRodando(true);
    try {
      await api.bxcPedidoCriar({ tipo: item.tipo, org: t.org, seq: t.seq, lancto: t.lancto, cba: item.linhas[0]?.cba, saldo: t.saldo, valor_banco: parcelaBanco(t),
        calc: t.calc || { juros: t.juros, multa: t.multa, desconto: t.desconto }, pedido: { juros: r2(v.juros), multa: r2(v.multa), desconto: r2(v.desconto) }, motivo });
      setModal(null);
    } catch (e) { setErro(e.message || 'Não consegui registrar o pedido.'); }
    setRodando(false); await carregar();
  }
  const toggle = (set, id) => { const n = new Set(set); n.has(id) ? n.delete(id) : n.add(id); return n; };

  // ---------------------------------------------------------------------------------------------------- cartão de item
  function Titulo({ item, t, compacto }) {
    const x = titEditado(item, t);
    const ped = t.pedido;
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="text-gray-100 truncate max-w-[260px]" title={t.agn_nome}>{t.agn_nome}</span>
        <span className="font-mono text-gray-400">{t.doc}/{t.parcela}</span>
        <span className="text-gray-500 text-xs">venc. {fmtBr(t.venc)}{t.fil_id ? ` · emp. ${t.fil_id}` : ''}</span>
        {!compacto && <span className="text-gray-500 text-xs">saldo {fmt(t.saldo)}{x.valor < Number(t.saldo || 0) - 0.005 && !x.desconto ? ' · parcial' : ''}</span>}
        <Encargos t={x} />
        {edits[item.id]?.tit?.[t.lancto] && <Pilula cls="text-prim-400 border-prim-600/40 bg-ink-700/60">editado</Pilula>}
        {ped?.status === 'P' && <Pilula cls="text-amber-300 border-amber-700/40 bg-amber-900/30"><Clock3 size={11} className="mr-1" /> aguardando liberação</Pilula>}
        {ped?.status === 'L' && <Pilula cls="text-emerald-300 border-emerald-700/40 bg-emerald-900/30">liberado</Pilula>}
        {ped?.status === 'N' && <Pilula cls="text-rose-300 border-rose-700/40 bg-rose-900/30">liberação negada</Pilula>}
        {t.bloqueio && <Pilula cls="text-rose-300 border-rose-700/40 bg-rose-900/30">bloqueado: {t.bloqueio}</Pilula>}
      </div>
    );
  }
  function Linhas({ item }) {
    return (
      <div className="text-xs text-gray-400 space-y-0.5">
        {(item.linhas || []).map(l => <div key={l.cba} className="flex gap-3"><span className="font-mono text-gray-500 w-20">{fmtBr(l.data)}</span><span className="text-gray-300 flex-1 truncate">{l.historico}</span>{l.documento && <span className="font-mono text-gray-600">{l.documento}</span>}<span className={`font-mono ${l.natureza === 'D' ? 'text-rose-300' : 'text-emerald-300'}`}>{fmt(l.valor)}</span></div>)}
      </div>
    );
  }
  function Card({ item, acao }) {
    const aberto = abertos.has(item.id), r = res[item.id], feito = r?.status === 'B';
    const pronto = item.situacao === 'pronto', blq = bloqueado(item);
    const nat = item.linhas?.[0]?.natureza || (item.tipo === 'P' ? 'D' : 'C');
    return (
      <div className={`card p-4 transition ${feito ? 'opacity-60' : ''} ${pronto && marcados.has(item.id) && !feito ? 'border-prim-600/40' : ''}`}>
        <div className="flex items-start gap-4">
          {pronto && <input type="checkbox" className="accent-prim-500 w-5 h-5 mt-1 shrink-0" checked={feito || (marcados.has(item.id) && !blq)} disabled={feito || rodando || blq} onChange={() => setMarcados(m => toggle(m, item.id))} />}
          <div className="w-20 shrink-0 pt-0.5 text-sm text-gray-400 font-mono">{fmtBr(item.data)}</div>
          <div className="flex-1 min-w-0">
            <div className="text-gray-100 truncate" title={item.linhas?.map(l => l.historico).join(' | ')}>{item.linhas?.[0]?.historico || '—'}{item.linhas?.length > 1 && <span className="text-gray-500 text-xs"> +{item.linhas.length - 1} linha(s)</span>}</div>
            <div className="text-xs text-gray-500 mt-0.5">{TIPO[item.tipo] || ''}{item.linhas?.[0]?.documento ? ` · doc. ${item.linhas[0].documento}` : ''}{item.motivo && item.situacao !== 'pronto' ? ` · ${item.motivo}` : ''}</div>
            {!aberto && !feito && ['P', 'R'].includes(item.tipo) && <div className="flex flex-wrap gap-3 mt-1.5">
              <button className="inline-flex items-center gap-1 text-xs text-prim-300 hover:text-white disabled:opacity-50" disabled={rodando} onClick={() => setModal({ tipo: 'buscar', item })}><Search size={12} /> Buscar no contas a {item.tipo === 'P' ? 'pagar' : 'receber'}</button>
              {manual[item.id] && <button className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-white disabled:opacity-50" disabled={rodando} onClick={() => desfazerEscolha(item)}><Undo2 size={12} /> Desfazer escolha</button>}
            </div>}
          </div>
          <div className="text-right shrink-0">
            <div className={`text-lg font-semibold ${nat === 'D' ? 'text-rose-300' : 'text-emerald-300'}`}>{nat === 'D' ? '−' : '+'} {fmt(item.valor_banco)}</div>
            {item.confianca && item.situacao === 'pronto' && <Pilula cls={CONF[item.confianca]?.[1] || ''}>{CONF[item.confianca]?.[0]}</Pilula>}
          </div>
          <div className="w-[40%] min-w-[260px] space-y-1 hidden lg:block">
            {(item.titulos || []).length ? item.titulos.map(t => <Titulo key={t.lancto} item={item} t={t} compacto />)
              : item.depara ? <div className="text-sm text-gray-300">{item.depara.descricao}{item.depara.classe ? <span className="text-gray-500 text-xs"> · classe {item.depara.classe}</span> : <span className="text-amber-300 text-xs"> · de-para sem classe: configure</span>}</div>
              : item.movs?.length ? <div className="text-sm text-gray-300">{fmtN(item.movs.length)} lançamento(s) no Mega somam {fmt(item.movs.reduce((s, m) => s + Number(m.valor || 0), 0))}</div>
              : <div className="text-sm text-gray-500">{item.candidatos?.length ? `${fmtN(item.candidatos.length)} candidato(s)` : 'sem título correspondente'}</div>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {acao}
            <button className="text-gray-500 hover:text-white p-1" onClick={() => setAbertos(a => toggle(a, item.id))} title="detalhes">{aberto ? <ChevronDown size={18} /> : <ChevronRight size={18} />}</button>
          </div>
        </div>
        <Resultado r={r} />
        {aberto && (
          <div className="mt-4 pt-4 border-t border-ink-700 grid md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <div className="text-[11px] uppercase tracking-wider text-gray-500">No extrato do banco</div>
              <Linhas item={item} />
              {edits[item.id]?.comp && <div className="text-xs mt-2 p-2 rounded bg-ink-900 border border-ink-700">
                <div className="flex items-center gap-1 text-gray-300"><Paperclip size={12} /> comprovante lido: {fmt(edits[item.id].comp.ocr?.valor)} · {fmtBr(edits[item.id].comp.ocr?.data)} · {edits[item.id].comp.ocr?.favorecido || edits[item.id].comp.ocr?.pagador || ''}</div>
                <div className={edits[item.id].comp.confere === 'S' ? 'text-emerald-300' : edits[item.id].comp.confere === 'N' ? 'text-rose-300' : 'text-amber-300'}>{edits[item.id].comp.confere === 'S' ? 'confere com o título e o extrato' : edits[item.id].comp.confere === 'N' ? `não confere: ${edits[item.id].comp.motivo || ''}` : `não deu para conferir: ${edits[item.id].comp.motivo || ''}`}</div>
              </div>}
              <div className="flex flex-wrap gap-2 pt-1">
                {['P', 'R'].includes(item.tipo) && <button className="btn-ghost text-xs py-1.5" disabled={rodando || feito} onClick={() => { alvoArquivo.current = item; fileRef.current?.click(); }}><Paperclip size={13} /> {edits[item.id]?.comp ? 'Trocar comprovante' : 'Anexar comprovante'}</button>}
                {!feito && ['P', 'R'].includes(item.tipo) && <button className="btn-ghost text-xs py-1.5" disabled={rodando} onClick={() => setModal({ tipo: 'buscar', item })}><Search size={13} /> Buscar no contas a {item.tipo === 'P' ? 'pagar' : 'receber'}</button>}
                {!feito && manual[item.id] && <button className="btn-ghost text-xs py-1.5" disabled={rodando} onClick={() => desfazerEscolha(item)}><Undo2 size={13} /> Desfazer escolha</button>}
                {!feito && <button className="btn-ghost text-xs py-1.5" disabled={rodando} onClick={() => setModal({ tipo: 'ignorar', item, motivo: '' })}><EyeOff size={13} /> Ignorar</button>}
              </div>
            </div>
            <div className="space-y-2">
              {(item.titulos || []).length > 0 && <>
                <div className="text-[11px] uppercase tracking-wider text-gray-500">No Mega</div>
                {item.titulos.map(t => (
                  <div key={t.lancto} className="flex flex-wrap items-center gap-2">
                    <div className="flex-1 min-w-0"><Titulo item={item} t={t} /></div>
                    {!feito && ['P', 'R'].includes(item.tipo) && (t.pedido?.status === 'P'
                      ? <span className="text-xs text-amber-300">pedido em análise</span>
                      : <button className="btn-ghost text-xs py-1.5" disabled={rodando} onClick={() => setModal({ tipo: liberaDireto ? 'encargos' : 'pedido', item, t, v: { juros: titEditado(item, t).juros, multa: titEditado(item, t).multa, desconto: titEditado(item, t).desconto }, motivo: '', erro: '' })}>
                          <PencilLine size={13} /> {liberaDireto ? 'Editar encargos' : 'Pedir liberação'}</button>)}
                  </div>
                ))}
                {(item.titulos || []).some(t => t.calc) && <div className="text-[11px] text-gray-500">calculado pela regra do título: {item.titulos.map(t => `juros ${fmt(t.calc?.juros)} · multa ${fmt(t.calc?.multa)} · desconto ${fmt(t.calc?.desconto)}`).join(' | ')}</div>}
              </>}
              {(item.movs || []).length > 0 && <>
                <div className="text-[11px] uppercase tracking-wider text-gray-500">Lançamentos no Mega</div>
                <div className="text-xs text-gray-400 space-y-0.5">{item.movs.map(m => <div key={m.lancto} className="flex gap-3"><span className="font-mono text-gray-500 w-20">{fmtBr(m.data)}</span><span className="flex-1 truncate text-gray-300">{m.hist || m.tpd} {m.doc ? `· ${m.doc}` : ''}</span><span className="font-mono">{fmt(m.valor)}</span></div>)}</div>
              </>}
              {item.situacao === 'decidir' && (
                <div className="space-y-1">
                  <div className="text-[11px] uppercase tracking-wider text-gray-500">Escolha o título (ou títulos)</div>
                  {(item.candidatos || []).length === 0 && <div className="text-xs text-gray-500">Nenhum título em aberto parecido. Use “Buscar no contas a {item.tipo === 'P' ? 'pagar' : 'receber'}”, lance pelo Mega ou registre como adiantamento.</div>}
                  {(item.candidatos || []).map(c => {
                    const sel = escolha[item.id] || new Set();
                    return <label key={c.lancto} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input type="checkbox" className="accent-prim-500" checked={sel.has(c.lancto)} onChange={() => setEscolha(e => ({ ...e, [item.id]: toggle(sel, c.lancto) }))} />
                      <span className="text-gray-200 truncate max-w-[220px]">{c.agn_nome}</span><span className="font-mono text-gray-400">{c.doc}/{c.parcela}</span>
                      <span className="text-gray-500 text-xs">venc. {fmtBr(c.venc)} · saldo {fmt(c.saldo)}</span>{c.confianca && <Pilula cls={CONF[c.confianca]?.[1]}>{CONF[c.confianca]?.[0]}</Pilula>}
                    </label>; })}
                  {(() => { const sel = escolha[item.id] || new Set(); const soma = (item.candidatos || []).filter(c => sel.has(c.lancto)).reduce((s, c) => s + Number(c.saldo || 0), 0);
                    return sel.size > 0 && <div className="flex items-center gap-3 pt-1">
                      <span className={`text-xs ${soma + 0.005 >= Number(item.valor_banco) ? 'text-emerald-300' : 'text-rose-300'}`}>saldo escolhido {fmt(soma)} {soma + 0.005 >= Number(item.valor_banco) ? (soma - Number(item.valor_banco) > 0.005 ? '· sobra no título (baixa parcial)' : '· fecha com o banco') : '· ainda falta ' + fmt(Number(item.valor_banco) - soma)}</span>
                      <button className="btn-prim text-xs py-1.5" disabled={rodando || soma + 0.005 < Number(item.valor_banco)} onClick={() => decidirBaixar(item)}><Zap size={13} /> Baixar e conciliar</button>
                    </div>; })()}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------------------------------------------- tela
  const vazio = dados && itens.length === 0 && !carregando;
  return (
    <div className="p-6 space-y-6 max-w-[1500px] mx-auto">
      <input ref={fileRef} type="file" accept="image/*,.pdf" className="hidden" onChange={e => { anexar(e.target.files?.[0]); e.target.value = ''; }} />

      <div className="flex flex-wrap items-end gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-100 tracking-tight">Baixar e conciliar</h1>
          <p className="text-sm text-gray-500">O que o banco já movimentou e ainda não está no Mega. Confira e aprove; o resto o robô faz.</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button className="btn-ghost text-xs" onClick={carregar} disabled={carregando}><RefreshCw size={14} className={carregando ? 'animate-spin' : ''} /> Atualizar</button>
        </div>
      </div>

      {/* contas */}
      <div className="flex flex-wrap gap-2">
        {(contas || []).map(c => (
          <button key={c.agn_id} onClick={() => setConta(c.agn_id)} title={c.nome}
                  className={`px-4 py-2 rounded-full text-sm border transition flex items-center gap-2 ${conta === c.agn_id ? 'bg-prim-600 border-prim-600 text-white' : 'bg-ink-800 border-ink-700 text-gray-300 hover:border-prim-500/50'}`}>
            <span className="truncate max-w-[180px]">{String(c.nome || c.agn_id).replace(/\s*-\s*AG\..*$/i, '').replace(/\s+I\s+.*$/, '')}</span>
            {c.pendentes > 0 && <span className={`text-[11px] px-1.5 rounded-full ${conta === c.agn_id ? 'bg-white/20' : 'bg-ink-700 text-gray-300'}`}>{fmtN(c.pendentes)}</span>}
          </button>
        ))}
        {contas && contas.length === 0 && <span className="text-sm text-gray-500">Nenhuma conta no escopo. Configure em Baixas/Conciliação › Configurar.</span>}
      </div>

      {/* filtros discretos */}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <div className="inline-flex rounded-lg bg-ink-800 border border-ink-700 p-0.5">
          {[['T', 'Tudo'], ['P', 'Pagar'], ['R', 'Receber']].map(([k, l]) => <button key={k} onClick={() => setTipo(k)} className={`px-3 py-1.5 rounded-md text-xs ${tipo === k ? 'bg-ink-700 text-white' : 'text-gray-400 hover:text-gray-200'}`}>{l}</button>)}
        </div>
        <input type="date" className="input w-auto py-1.5 text-xs" value={ini} onChange={e => setIni(e.target.value)} />
        <span className="text-gray-600 text-xs">a</span>
        <input type="date" className="input w-auto py-1.5 text-xs" value={fim} onChange={e => setFim(e.target.value)} />
        <div className="relative ml-auto"><Search size={14} className="absolute left-2.5 top-2.5 text-gray-500" /><input className="input pl-8 py-1.5 text-xs w-64" placeholder="buscar cliente, fornecedor, documento…" value={busca} onChange={e => setBusca(e.target.value)} /></div>
      </div>

      {erro && <div className="bg-rose-900/40 text-rose-200 text-sm rounded-lg p-3">{erro}</div>}

      {/* faixa de status */}
      {dados && (
        <div className="card p-6 flex flex-wrap items-center gap-6">
          <div>
            <div className="text-5xl font-semibold text-gray-100 tracking-tight">{fmtN(prontos.length)}</div>
            <div className="text-sm text-gray-400 mt-1">pronto(s) para baixar e conciliar · <span className="text-gray-200">{fmt(prontos.reduce((s, i) => s + Number(i.valor_banco || 0), 0))}</span></div>
          </div>
          <div className="flex gap-6 text-sm text-gray-400 ml-2">
            <div><div className="text-xl text-gray-200">{fmtN(decidir.length)}</div>decidir</div>
            <div><div className="text-xl text-gray-200">{fmtN(reais.length)}</div>lançar</div>
            <div><div className="text-xl text-gray-200">{fmtN(lotes.length + conciliar.length)}</div>conciliar</div>
            <div><div className="text-xl text-gray-200">{fmtN(infos.length)}</div>informativos</div>
          </div>
          <div className="ml-auto">
            <button className="btn-prim text-base px-6 py-3 rounded-xl disabled:opacity-40" disabled={!selecionados.length || rodando} onClick={baixarSelecionados}>
              <Zap size={18} /> Baixar e conciliar {selecionados.length ? `${fmtN(selecionados.length)} selecionado(s) · ${fmt(somaSel)}` : ''}
            </button>
          </div>
        </div>
      )}

      {carregando && !dados && <div className="text-sm text-gray-400 flex items-center gap-2 py-10 justify-center"><Loader2 size={16} className="animate-spin" /> cruzando o extrato com o Mega…</div>}
      {vazio && <div className="py-16 text-center"><div className="text-3xl font-semibold text-gray-200">Nada pendente nesta conta</div><div className="text-sm text-gray-500 mt-2">Tudo o que o banco movimentou no período já está baixado e conciliado.</div></div>}

      {prontos.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-3 text-sm text-gray-400">
            <Sparkles size={15} className="text-prim-400" /><span className="font-semibold text-gray-200">Pronto</span>
            <button className="text-xs hover:text-gray-200" onClick={() => setMarcados(new Set(prontos.filter(i => !bloqueado(i)).map(i => i.id)))}>marcar todos</button>
            <button className="text-xs hover:text-gray-200" onClick={() => setMarcados(new Set())}>nenhum</button>
          </div>
          {prontos.map(i => <Card key={i.id} item={i} />)}
        </section>
      )}

      {decidir.length > 0 && <Secao titulo="Decidir" qt={decidir.length} icone={Info} aberta={secoes.decidir} onToggle={() => setSecoes(s => ({ ...s, decidir: !s.decidir }))} nota="casamento ambíguo ou parcial: escolha o título">
        {decidir.map(i => <Card key={i.id} item={i} />)}</Secao>}
      {reais.length > 0 && <Secao titulo="Lançar no Mega" qt={reais.length} icone={FilePlus2} aberta={secoes.real} onToggle={() => setSecoes(s => ({ ...s, real: !s.real }))} nota="tarifas e outros movimentos reais, sem título">
        {reais.map(i => <Card key={i.id} item={i} acao={<button className="btn-prim text-xs py-1.5" disabled={rodando || res[i.id]?.status === 'B' || !i.depara?.id || !i.depara?.classe} title={!i.depara?.id ? 'sem de-para para esta linha' : !i.depara?.classe ? 'de-para sem classe financeira: configure' : ''} onClick={() => lancarReal(i)}><FilePlus2 size={13} /> Lançar</button>} />)}</Secao>}
      {(lotes.length + conciliar.length) > 0 && <Secao titulo="Conciliar" qt={lotes.length + conciliar.length} icone={Link2} aberta={secoes.conciliar} onToggle={() => setSecoes(s => ({ ...s, conciliar: !s.conciliar }))} nota="já está no Mega, só falta ligar ao extrato (inclui lote de cobrança)">
        {[...lotes, ...conciliar].map(i => <Card key={i.id} item={i} acao={<button className="btn-prim text-xs py-1.5" disabled={rodando || res[i.id]?.status === 'B' || !(i.movs || []).length} onClick={() => conciliarItem(i)}><Link2 size={13} /> Conciliar</button>} />)}</Secao>}
      {infos.length > 0 && <Secao titulo="Informativos" qt={infos.length} icone={Info} aberta={secoes.info} onToggle={() => setSecoes(s => ({ ...s, info: !s.info }))} nota="aplicação automática e rendimentos: não são títulos">
        {infos.map(i => <Card key={i.id} item={i} />)}</Secao>}

      <Secao titulo="Feitas hoje" qt={feitas.length} icone={CheckCircle2} aberta={secoes.feitas} onToggle={() => setSecoes(s => ({ ...s, feitas: !s.feitas }))} nota="trilha do que foi gravado por aqui, pela tela ou pelo robô">
        {feitas.length === 0 && <div className="text-xs text-gray-500">Nada gravado hoje nesta conta.</div>}
        {feitas.map(f => (
          <div key={f.log_id} className={`card px-4 py-3 flex flex-wrap items-center gap-4 text-sm ${f.status === 'E' ? 'opacity-50' : ''}`}>
            <span className="font-mono text-gray-500 text-xs">{fmtHr(f.em)}</span>
            <span className="text-gray-300">{TIPO[f.tipo] || f.tipo}{f.qt_titulos ? ` · ${fmtN(f.qt_titulos)} título(s)` : ''}</span>
            <span className="text-gray-100 font-semibold">{fmt(f.valor_banco)}</span>
            {(f.juros > 0 || f.multa > 0 || f.desconto > 0) && <Encargos t={f} />}
            <span className="text-xs text-gray-500">{f.origem === 'R' ? 'robô' : f.usuario}</span>
            {f.status === 'E' && <Pilula cls="text-gray-400 border-ink-600">desfeita</Pilula>}
            {f.status === 'B' && f.mensagem && <span className="text-xs text-amber-300">{f.mensagem}</span>}
            {f.status === 'B' && <button className="btn-ghost text-xs py-1 ml-auto" disabled={rodando} onClick={() => setModal({ tipo: 'desfazer', f })}><Undo2 size={13} /> Desfazer</button>}
          </div>
        ))}
      </Secao>

      {/* ------------------------------------------------------------------ modais */}
      {confirma && (
        <Modal titulo={confirma.titulo} onClose={rodando ? null : () => setConfirma(null)} acoes={<>
          <button className="btn-ghost" disabled={rodando} onClick={() => setConfirma(null)}>Cancelar</button>
          {confirma.fase === 'perguntar'
            ? <button className="btn-prim" disabled={rodando} onClick={confirmar}>{rodando ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />} Validar e gravar</button>
            : <button className="btn-prim" disabled={rodando || !confirma.validos?.length} onClick={confirmar}>{rodando ? <Loader2 size={15} className="animate-spin" /> : <Zap size={15} />} Gravar os {fmtN(confirma.validos?.length || 0)} válidos</button>}
        </>}>
          <p>{confirma.texto}</p>
          {confirma.fase === 'simulado' && <div className="space-y-1">
            <div className="text-rose-300">{fmtN(confirma.recusas.length)} item(ns) o Mega recusou e ficam de fora:</div>
            {confirma.recusas.map(x => <div key={x.ref} className="text-xs text-gray-400 pl-3">• {x.mensagem}</div>)}
          </div>}
        </Modal>
      )}
      {modal?.tipo === 'encargos' && <EncargosModal modal={modal} setModal={setModal} onSalvar={salvarEncargos} />}
      {modal?.tipo === 'pedido' && <EncargosModal modal={modal} setModal={setModal} pedido onPedir={pedirLiberacao} rodando={rodando} />}
      {modal?.tipo === 'buscar' && <BuscaTitulos item={modal.item} usados={new Set(itens.filter(i => i.id !== modal.item.id).flatMap(i => (i.titulos || []).map(t => t.lancto)))}
        onUsar={sel => usarTitulos(modal.item, sel)} onClose={() => setModal(null)} />}
      {modal?.tipo === 'ignorar' && (
        <Modal titulo="Ignorar esta linha do extrato?" onClose={() => setModal(null)} acoes={<><button className="btn-ghost" onClick={() => setModal(null)}>Voltar</button><button className="btn-prim" disabled={rodando || !modal.motivo.trim()} onClick={() => ignorar(modal.item, modal.motivo.trim())}>Ignorar</button></>}>
          <p>Ela deixa de aparecer aqui. Não muda nada no Mega.</p>
          <input className="input" autoFocus placeholder="motivo (obrigatório)" value={modal.motivo} onChange={e => setModal({ ...modal, motivo: e.target.value })} />
        </Modal>
      )}
      {modal?.tipo === 'desfazer' && (
        <Modal titulo="Desfazer esta operação?" onClose={() => setModal(null)} acoes={<><button className="btn-ghost" onClick={() => setModal(null)}>Voltar</button><button className="btn-prim" disabled={rodando} onClick={() => desfazer(modal.f)}><Undo2 size={15} /> Desfazer</button></>}>
          <p>{fmt(modal.f.valor_banco)} de {fmtHr(modal.f.em)}. A conciliação é desfeita e os lançamentos criados são apagados, se nada mudou no Mega depois.</p>
        </Modal>
      )}
    </div>
  );
}

// edita ou pede liberação de encargos de UM título; o dinheiro do banco não muda, o principal se ajusta
function EncargosModal({ modal, setModal, onSalvar, onPedir, pedido, rodando }) {
  const { item, t, v, motivo, erro } = modal;
  const set = (k, val) => setModal({ ...modal, v: { ...v, [k]: val } });
  const principal = r2(parcelaBanco(t) - r2(v.juros) - r2(v.multa));
  const calc = t.calc || { juros: t.juros, multa: t.multa, desconto: t.desconto };
  return (
    <Modal titulo={pedido ? 'Pedir liberação de encargos' : 'Editar encargos'} onClose={() => setModal(null)} acoes={<>
      <button className="btn-ghost" onClick={() => setModal(null)}>Cancelar</button>
      {pedido
        ? <button className="btn-prim" disabled={rodando || !motivo.trim()} onClick={() => onPedir(item, t, v, motivo.trim())}>Enviar pedido</button>
        : <button className="btn-prim" onClick={() => { const e = onSalvar(item, t, v); if (e) setModal({ ...modal, erro: e }); }}>Aplicar</button>}
    </>}>
      <div className="text-gray-400 text-xs">{t.agn_nome} · {t.doc}/{t.parcela} · saldo {fmt(t.saldo)} · o banco movimentou {fmt(parcelaBanco(t))}</div>
      <div className="grid grid-cols-3 gap-3">
        {[['juros', 'Juros', item.tipo !== 'P' || true], ['multa', 'Multa', item.tipo === 'R'], ['desconto', 'Desconto', true]].map(([k, l, mostra]) => mostra && (
          <label key={k} className="text-xs text-gray-400 space-y-1"><span>{l} <span className="text-gray-600">· regra {fmt(calc?.[k])}</span></span>
            <input type="number" step="0.01" min="0" className="input" value={v[k]} onChange={e => set(k, e.target.value)} /></label>
        ))}
      </div>
      <div className="text-xs text-gray-400">Principal que fica baixado: <b className={principal > 0 ? 'text-gray-100' : 'text-rose-300'}>{fmt(principal)}</b>{principal + r2(v.desconto) < Number(t.saldo || 0) - 0.005 ? <span className="text-amber-300"> · sobra {fmt(Number(t.saldo) - principal - r2(v.desconto))} no título</span> : ''}</div>
      {pedido && <textarea className="input" rows={3} placeholder="por que isentar ou alterar? (obrigatório)" value={motivo} onChange={e => setModal({ ...modal, motivo: e.target.value })} />}
      {pedido && <div className="text-xs text-gray-500">Quem libera encargos recebe o pedido na tela Liberação de Encargos. Enquanto não decidirem, este item fica fora da baixa.</div>}
      {erro && <div className="text-xs text-rose-300">{erro}</div>}
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------------- [28/10/2026] painel de busca
// Pedido do Alexandre: "abra uma caixa permitindo filtrar por data, nome e valor o contas a pagar que consta no Mega" (banco agrupa títulos,
// nome diferente) e "títulos bloqueados aparecem mas com a informação de bloqueado e a caixa de seleção desligada até que seja aprovado".
function BuscaTitulos({ item, usados, onUsar, onClose }) {
  const pagar = item.tipo === 'P', banco = r2(item.valor_banco);
  const [f, setF] = useState({ venc_ini: somaDias(item.data, -5), venc_fim: somaDias(item.data, 5), nome: '', doc: '', modo: 'qualquer', valor: '', vmax: '' });
  const [lista, setLista] = useState(null);
  const [mais, setMais] = useState(false);
  const [sel, setSel] = useState(new Map());          // lancto -> título
  const [carregando, setCarregando] = useState(false);
  const [aviso, setAviso] = useState('');
  const num = v => Number(String(v || '').replace(/\./g, '').replace(',', '.'));
  async function filtrar() {
    setCarregando(true); setAviso('');
    const v = num(f.valor), vx = num(f.vmax);
    const faixa = f.modo === 'exato' && v > 0 ? { vmin: v, vmax: v } : f.modo === 'faixa' ? { vmin: v > 0 ? v : '', vmax: vx > 0 ? vx : '' } : {};
    try {
      const r = await api.bxcTitulos({ tipo: item.tipo, org: item.org, venc_ini: f.venc_ini, venc_fim: f.venc_fim, nome: f.nome.trim(), doc: f.doc.trim(), ...faixa });
      setLista(r.titulos || []); setMais(!!r.mais);
    } catch (e) { setAviso(e.message || 'Falha ao consultar o Mega.'); setLista([]); }
    setCarregando(false);
  }
  useEffect(() => { filtrar(); }, []);
  const marcaveis = (lista || []).filter(t => !t.bloqueio);
  const soma = r2([...sel.values()].reduce((s, t) => s + Number(t.saldo || 0), 0)), dif = r2(banco - soma);
  const alterna = t => setSel(m => { const n = new Map(m); n.has(t.lancto) ? n.delete(t.lancto) : n.set(t.lancto, t); return n; });
  function acharCombinacao() {
    const sub = subconjunto(marcaveis, banco);
    if (sub) { setSel(new Map(sub.map(t => [t.lancto, t]))); setAviso(''); }
    else setAviso(`Nenhuma combinação de até 6 títulos da lista soma ${fmt(banco)}. Ajuste os filtros ou marque à mão.`);
  }
  const enter = e => { if (e.key === 'Enter') filtrar(); };
  const txtDif = Math.abs(dif) < 0.005 ? 'fecha com o banco' : dif > 0 ? `faltam ${fmt(dif)} (vira juros no último título: edite ou peça liberação)` : `sobram ${fmt(-dif)} (o último título fica com saldo)`;
  return (
    <Modal largura="max-w-4xl" titulo={`Buscar no contas a ${pagar ? 'pagar' : 'receber'}`} onClose={onClose} acoes={<>
      <button className="btn-ghost mr-auto" disabled={carregando || !marcaveis.length} onClick={acharCombinacao}><Sparkles size={15} /> Achar combinação</button>
      <button className="btn-ghost" onClick={onClose}>Cancelar</button>
      <button className="btn-prim" disabled={!sel.size} onClick={() => onUsar([...sel.values()])}><CheckCircle2 size={15} /> Usar {sel.size > 1 ? `estes ${sel.size} títulos` : 'este título'}</button>
    </>}>
      <div className="text-xs text-gray-400 flex flex-wrap gap-x-4">
        <span>{fmtBr(item.data)} · {item.linhas?.[0]?.historico}</span>
        <span className={pagar ? 'text-rose-300' : 'text-emerald-300'}>{pagar ? '−' : '+'} {fmt(banco)}</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2 items-end">
        <label className="text-[11px] text-gray-500 col-span-1">Vencimento de<input type="date" className="input py-1.5 mt-1" value={f.venc_ini} onChange={e => setF({ ...f, venc_ini: e.target.value })} /></label>
        <label className="text-[11px] text-gray-500 col-span-1">até<input type="date" className="input py-1.5 mt-1" value={f.venc_fim} onChange={e => setF({ ...f, venc_fim: e.target.value })} /></label>
        <label className="text-[11px] text-gray-500 col-span-2">{pagar ? 'Fornecedor' : 'Cliente'} (nome, fantasia ou CNPJ)<input className="input py-1.5 mt-1" autoFocus value={f.nome} onKeyDown={enter} onChange={e => setF({ ...f, nome: e.target.value })} /></label>
        <label className="text-[11px] text-gray-500 col-span-1">Documento<input className="input py-1.5 mt-1" value={f.doc} onKeyDown={enter} onChange={e => setF({ ...f, doc: e.target.value })} /></label>
        <div className="col-span-1" />
        <label className="text-[11px] text-gray-500 col-span-1">Valor (saldo)<select className="input py-1.5 mt-1" value={f.modo} onChange={e => setF({ ...f, modo: e.target.value })}><option value="qualquer">qualquer</option><option value="exato">exato</option><option value="faixa">faixa</option></select></label>
        {f.modo !== 'qualquer' && <label className="text-[11px] text-gray-500 col-span-1">{f.modo === 'faixa' ? 'de' : 'valor'}<input className="input py-1.5 mt-1 text-right" inputMode="decimal" placeholder="0,00" value={f.valor} onKeyDown={enter} onChange={e => setF({ ...f, valor: e.target.value })} /></label>}
        {f.modo === 'faixa' && <label className="text-[11px] text-gray-500 col-span-1">até<input className="input py-1.5 mt-1 text-right" inputMode="decimal" placeholder="0,00" value={f.vmax} onKeyDown={enter} onChange={e => setF({ ...f, vmax: e.target.value })} /></label>}
        <button className="btn-prim py-1.5 col-span-1" disabled={carregando} onClick={filtrar}>{carregando ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />} Filtrar</button>
      </div>
      <div className="border border-ink-700 rounded-xl max-h-[36vh] md:max-h-[46vh] overflow-y-auto">
        {lista === null ? <div className="p-4 text-gray-500 flex items-center gap-2"><Loader2 size={15} className="animate-spin" /> consultando o Mega…</div>
          : !lista.length ? <div className="p-4 text-gray-500">Nenhum título em aberto com esses filtros.</div>
          : lista.map(t => {
              const blq = !!t.bloqueio, on = sel.has(t.lancto);
              return (
                <label key={t.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 border-b border-ink-800 last:border-0 ${blq ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:bg-ink-800/60'} ${on ? 'bg-prim-900/20' : ''}`}
                  title={blq ? `Bloqueado: ${t.bloqueio}. Só pode ser escolhido depois de liberado no Mega.` : ''}>
                  <input type="checkbox" className="accent-prim-500 w-4 h-4" checked={on} disabled={blq} onChange={() => alterna(t)} />
                  <span className="text-gray-100 truncate max-w-[260px]" title={`${t.agn_nome}${t.fantasia && t.fantasia !== t.agn_nome ? ` (${t.fantasia})` : ''} ${t.cnpj}`}>{t.agn_nome}</span>
                  <span className="font-mono text-gray-400">{t.doc}/{t.parcela}</span>
                  <span className="text-gray-500 text-xs">venc. {fmtBr(t.venc)}{t.fil_id ? ` · emp. ${t.fil_id}` : ''}</span>
                  {blq && <Pilula cls="text-rose-300 border-rose-700/40 bg-rose-900/30">bloqueado: {t.bloqueio}</Pilula>}
                  {usados.has(t.lancto) && <Pilula cls="text-amber-300 border-amber-700/40 bg-amber-900/30" title="O mesmo título está sugerido para outra linha do extrato">já sugerido em outra linha</Pilula>}
                  {t.pedido?.status === 'P' && <Pilula cls="text-amber-300 border-amber-700/40 bg-amber-900/30">liberação pendente</Pilula>}
                  <span className="ml-auto font-mono text-gray-200">{fmt(t.saldo)}</span>
                </label>);
            })}
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-gray-400">
        <span>{fmtN(lista?.length || 0)}{mais ? '+' : ''} título(s){mais ? ' · refine os filtros para ver todos' : ''}</span>
        <span>marcados <b className="text-gray-200">{fmtN(sel.size)}</b></span>
        <span>soma <b className="text-gray-200 font-mono">{fmt(soma)}</b></span>
        <span>banco <b className="text-gray-200 font-mono">{fmt(banco)}</b></span>
        {sel.size > 0 && <span className={Math.abs(dif) < 0.005 ? 'text-emerald-300' : 'text-amber-300'}>diferença {fmt(Math.abs(dif))} · {txtDif}</span>}
      </div>
      {aviso && <div className="text-xs text-amber-300">{aviso}</div>}
    </Modal>
  );
}
