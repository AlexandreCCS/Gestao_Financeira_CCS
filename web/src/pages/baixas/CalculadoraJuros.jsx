// [26/11/2026 - CRIADO POR ALEXANDRE CARVALHO] Baixas/Conciliação › CALCULADORA DE JUROS E MULTA (Quality, baixa parcial no Mega).
// O cliente paga um valor que nao fecha o titulo e a usuaria precisa saber quanto digitar no "Valor da Baixa" da tela de baixa do
// contas a receber do Mega para que Baixa + Juros + Multa = valor pago.
// [26/11/2026 - v2, pedido do Alexandre] "O juros e multa pega na variacao do contas a receber" + "coloca o numero do titulo, coloca o
// valor do saldo, traz cliente": a usuaria digita o NUMERO DO TITULO, a tela traz as parcelas em aberto (cliente, saldo, vencimento)
// e calcula juros e multa pelos encargos gravados no titulo (FIN_CONTASRECEBER, rota GET /calculadora-juros/titulos):
//   dias  = data do pagamento - vencimento prorrogado
//   juros = mora/dia (CRE_RE_VRMORAEFET; sem ela, valor x %juros/30) x dias x saldo/valor   (truncado no centavo, como o Mega)
//   multa = multa do titulo (CRE_RE_VRMULTAEFET; sem ela, valor x %multa) x saldo/valor, se pago depois da data base da multa
// Conferido no 68703/001 (fil 200): 5,0515 x 310 dias = 1.565,96 e multa 60,62, iguais ao Mega.
// Regra da baixa parcial (print de 26/11): juros PROPORCIONAIS ao valor baixado e multa CHEIA. Com k = juros/saldo:
//   Valor da Baixa = (pago - multa) / (1 + k)      juros = pago - multa - baixa (fecha no centavo)
// Juros e multa podem ser ajustados a mao (botao Ajustar) se o Mega mostrar outro valor. Tela so de calculo: nao grava nada.
import React, { useMemo, useRef, useState } from 'react';
import { Calculator, Copy, Check, Search, Loader2, User, CalendarDays, AlertTriangle, Pencil, RotateCcw, ArrowRight, Info } from 'lucide-react';
import { api } from '../../api/client';

const fmt = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = (v, d = 2) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }) + '%';
const fmtBr = s => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—');
const r2 = v => Math.round((v + Number.EPSILON) * 100) / 100;
const t2 = v => Math.floor(v * 100 + 1e-6) / 100;   // truncado no centavo (Mega: 5,0515 x 310 = 1.565,965 -> 1.565,96)
const diasEntre = (a, b) => (a && b ? Math.round((Date.parse(b + 'T00:00:00') - Date.parse(a + 'T00:00:00')) / 86400000) : 0);
// aceita "3.030,88", "3030,88", "3030.88", "R$ 3.030,88"
function num(s) {
  let t = String(s ?? '').replace(/[R$\s]/g, '');
  if (!t) return NaN;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if ((t.match(/\./g) || []).length > 1) t = t.replace(/\./g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}
const paraMega = v => r2(v).toFixed(2).replace('.', ',');   // formato que o campo do Mega aceita: 619,37
const brInput = v => r2(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Copiar({ valor, grande }) {
  const [ok, setOk] = useState(false);
  async function copiar() {
    const t = paraMega(valor);
    try { await navigator.clipboard.writeText(t); }
    catch {   // navegador sem clipboard API: copia por um textarea escondido
      const el = document.createElement('textarea'); el.value = t; document.body.appendChild(el); el.select();
      document.execCommand('copy'); document.body.removeChild(el);
    }
    setOk(true); setTimeout(() => setOk(false), 1600);
  }
  const base = grande ? 'px-5 py-3 text-base' : '';
  return (
    <button type="button" onClick={copiar} title={`Copia ${paraMega(valor)} para colar no Mega`}
            className={`${ok ? 'btn bg-emerald-600 text-white' : 'btn-prim'} ${base}`}>
      {ok ? <><Check size={grande ? 18 : 15} /> Copiado</> : <><Copy size={grande ? 18 : 15} /> Copiar</>}
    </button>
  );
}

// encargos do titulo na data do pagamento (antes da baixa parcial)
function encargos(t, dataPag) {
  if (!t) return null;
  const base = t.prorrogado || t.vencto;
  const dias = Math.max(0, diasEntre(base, dataPag));
  const prop = t.valor > 0 ? t.saldo / t.valor : 1;
  const moraDia = t.moraDia > 0 ? t.moraDia : (t.valor * t.percJuros / 100 / 30);
  const juros = dias > 0 ? t2(moraDia * dias * prop) : 0;
  const dtMulta = t.dtMulta || base;
  const temMulta = dias > 0 && dataPag > dtMulta;
  const multaTit = t.vrMulta > 0 ? t.vrMulta : (t.valor * t.percMulta / 100);
  const multa = temMulta ? r2(multaTit * prop) : 0;
  return { dias, moraDia, juros, multa, temMulta, dtMulta };
}

export default function CalculadoraJuros() {
  const [doc, setDoc]         = useState('');
  const [busca, setBusca]     = useState(null);      // null | 'carregando' | { titulos }
  const [erro, setErro]       = useState('');
  const [sel, setSel]         = useState(null);      // parcela escolhida
  const [dataPag, setDataPag] = useState('');
  const [pago, setPago]       = useState('');
  const [ajuste, setAjuste]   = useState(null);      // { juros, multa } digitados a mao
  const pagoRef = useRef(null);

  async function buscar(e) {
    e?.preventDefault();
    const d = doc.trim();
    if (!d) return;
    setErro(''); setBusca('carregando'); setSel(null); setPago(''); setAjuste(null);
    try {
      const r = await api.calcJurosTitulos(d);
      setBusca(r);
      if ((r.titulos || []).length === 1) escolher(r.titulos[0]);
    } catch (e2) { setBusca(null); setErro(e2.message || 'Não consegui buscar o título.'); }
  }
  function escolher(t) {
    setSel(t); setDataPag(t.hoje); setPago(''); setAjuste(null);
    setTimeout(() => pagoRef.current?.focus(), 50);
  }
  function limpar() { setDoc(''); setBusca(null); setSel(null); setPago(''); setAjuste(null); setErro(''); }

  const enc = useMemo(() => encargos(sel, dataPag), [sel, dataPag]);
  const jurosCheio = ajuste ? num(ajuste.juros) : enc?.juros;
  const multaCheia = ajuste ? num(ajuste.multa) : enc?.multa;
  const totalCheio = sel && enc ? r2(sel.saldo + (jurosCheio || 0) + (multaCheia || 0)) : 0;

  const calc = useMemo(() => {
    if (!sel || !enc) return null;
    const S = sel.saldo, J = jurosCheio, M = multaCheia || 0, R = num(pago);
    if (!(J >= 0) || !(M >= 0)) return { aviso: 'Juros ou multa ajustados estão inválidos.' };
    if (!(R > 0)) return null;
    if (R >= totalCheio) return { total: true, aviso: `O valor pago cobre o título inteiro (${fmt(totalCheio)}). Faça a baixa total no Mega.` };
    if (R <= M) return { aviso: `O valor pago não cobre nem a multa (${fmt(M)}).` };
    const k = S > 0 ? J / S : 0;
    const baixa = r2((R - M) / (1 + k));
    const juros = r2(R - M - baixa);
    return { k, baixa, juros, multa: M, total: r2(baixa + juros + M), restante: r2(S - baixa) };
  }, [sel, enc, jurosCheio, multaCheia, pago, totalCheio]);

  const lista = busca && busca !== 'carregando' ? busca.titulos || [] : [];

  return (
    <div className="p-6 space-y-6 max-w-[1100px] mx-auto">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-100 tracking-tight flex items-center gap-2"><Calculator size={22} /> Calculadora de juros e multa</h1>
          <p className="text-sm text-gray-500">Baixa parcial no Mega: digite o título e o valor pago. A tela diz quanto digitar no <b className="text-gray-300">Valor da Baixa</b>.</p>
        </div>
        {(busca || sel) && <button className="btn-ghost text-xs ml-auto" onClick={limpar}><RotateCcw size={14} /> Novo cálculo</button>}
      </div>

      {/* 1. busca do titulo */}
      <form onSubmit={buscar} className="card p-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[260px]">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input className="input !pl-10 !py-3 text-lg font-mono" placeholder="Número do título (ex.: 68703)" autoFocus
                 value={doc} onChange={e => setDoc(e.target.value)} />
        </div>
        <button className="btn-prim !py-3 px-6" disabled={!doc.trim() || busca === 'carregando'}>
          {busca === 'carregando' ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} Buscar
        </button>
      </form>
      {erro && <div className="bg-rose-900/40 text-rose-200 text-sm rounded-lg p-3">{erro}</div>}
      {busca && busca !== 'carregando' && lista.length === 0 && (
        <div className="card p-8 text-center text-gray-400">Nenhuma parcela com saldo em aberto para o título <b className="text-gray-200 font-mono">{doc}</b>.</div>
      )}

      {/* 2. parcelas do titulo (quando ha mais de uma) */}
      {lista.length > 1 && (
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-wider text-gray-400">{lista.length} parcelas em aberto · escolha uma</div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {lista.map(t => {
              const atraso = Math.max(0, diasEntre(t.prorrogado || t.vencto, t.hoje));
              const ativo = sel && sel.lanc === t.lanc && sel.org === t.org;
              return (
                <button key={`${t.org}-${t.lanc}`} type="button" onClick={() => escolher(t)}
                        className={`card p-4 text-left transition hover:border-prim-500 ${ativo ? '!border-prim-500 ring-1 ring-prim-500/50' : ''}`}>
                  <div className="flex items-center gap-2 text-sm"><span className="font-mono text-gray-100">{t.doc}/{t.parcela}</span><span className="text-gray-500">fil {t.fil}</span>
                    {atraso > 0 ? <span className="ml-auto text-xs text-rose-300">{atraso} dias</span> : <span className="ml-auto text-xs text-emerald-300">em dia</span>}</div>
                  <div className="text-xs text-gray-400 truncate mt-1">{t.cliente}</div>
                  <div className="flex items-end mt-2"><span className="text-xs text-gray-500">venc. {fmtBr(t.prorrogado || t.vencto)}</span><span className="ml-auto font-mono text-gray-100">{fmt(t.saldo)}</span></div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 3. titulo escolhido + calculo */}
      {sel && enc && (
        <>
          <div className="card p-5 grid md:grid-cols-[1fr_auto] gap-4 items-center">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-11 h-11 rounded-full bg-prim-600/20 text-prim-300 flex items-center justify-center shrink-0"><User size={20} /></div>
              <div className="min-w-0">
                <div className="text-lg text-gray-100 font-semibold truncate">{sel.cliente || 'Cliente não encontrado'}</div>
                <div className="text-xs text-gray-400">
                  Cód. {sel.agn}{sel.fantasia && sel.fantasia !== sel.cliente ? ` · ${sel.fantasia}` : ''} · título <span className="font-mono text-gray-300">{sel.doc}/{sel.parcela}</span> · filial {sel.fil} · {sel.tpd}{sel.forma ? ` · ${sel.forma}` : ''}
                </div>
                <div className="text-xs text-gray-400 mt-1">
                  Emissão {fmtBr(sel.emissao)} · vencimento {fmtBr(sel.vencto)}{sel.prorrogado && sel.prorrogado !== sel.vencto ? ` · prorrogado ${fmtBr(sel.prorrogado)}` : ''} · valor original {fmt(sel.valor)}
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="kpi-label">Saldo em aberto</div>
              <div className="text-3xl font-bold text-white font-mono">{fmt(sel.saldo)}</div>
              {enc.dias > 0 ? <div className="text-xs text-rose-300 mt-1 inline-flex items-center gap-1"><AlertTriangle size={12} /> {enc.dias} dias de atraso</div>
                            : <div className="text-xs text-emerald-300 mt-1">sem atraso nesta data</div>}
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {/* encargos e valor pago */}
            <div className="card p-5 space-y-4">
              <div className="flex items-center gap-2">
                <div className="text-sm font-semibold text-gray-200">Encargos do título</div>
                {!ajuste
                  ? <button type="button" className="ml-auto text-xs text-gray-400 hover:text-gray-200 inline-flex items-center gap-1" onClick={() => setAjuste({ juros: brInput(enc.juros), multa: brInput(enc.multa) })}><Pencil size={12} /> Ajustar</button>
                  : <button type="button" className="ml-auto text-xs text-amber-300 hover:text-amber-200 inline-flex items-center gap-1" onClick={() => setAjuste(null)}><RotateCcw size={12} /> Voltar ao calculado</button>}
              </div>
              <label className="block">
                <span className="text-xs uppercase tracking-wider text-gray-400 inline-flex items-center gap-1"><CalendarDays size={12} /> Data do pagamento</span>
                <input type="date" className="input mt-1" value={dataPag} onChange={e => { setDataPag(e.target.value); setAjuste(null); }} />
              </label>
              <table className="w-full text-sm">
                <tbody className="[&_td]:py-1.5">
                  <tr><td className="text-gray-400">Juros</td><td className="text-right text-xs text-gray-500">{pct(sel.percJuros)} a.m. · {fmt(enc.moraDia)}/dia × {enc.dias} dias{sel.saldo !== sel.valor ? ' × saldo' : ''}</td>
                    <td className="text-right w-36">{ajuste ? <input className="input !py-1 text-right font-mono" value={ajuste.juros} onChange={e => setAjuste({ ...ajuste, juros: e.target.value })} /> : <span className="font-mono text-gray-100">{fmt(enc.juros)}</span>}</td></tr>
                  <tr><td className="text-gray-400">Multa</td><td className="text-right text-xs text-gray-500">{pct(sel.percMulta)}{enc.temMulta ? '' : ' · não se aplica'}</td>
                    <td className="text-right">{ajuste ? <input className="input !py-1 text-right font-mono" value={ajuste.multa} onChange={e => setAjuste({ ...ajuste, multa: e.target.value })} /> : <span className="font-mono text-gray-100">{fmt(enc.multa)}</span>}</td></tr>
                  <tr className="border-t border-ink-700"><td className="text-gray-200 font-semibold">Total para quitar</td><td /><td className="text-right font-mono font-semibold text-gray-100">{fmt(totalCheio)}</td></tr>
                </tbody>
              </table>
              <div className="border-t border-ink-700 pt-4">
                <span className="text-xs uppercase tracking-wider text-gray-400">Valor pago pelo cliente</span>
                <div className="flex gap-2 mt-1">
                  <input ref={pagoRef} className="input !py-3 text-right font-mono text-xl" inputMode="decimal" placeholder="0,00" value={pago} onChange={e => setPago(e.target.value)} />
                  <button type="button" className="btn-ghost text-xs whitespace-nowrap" title="Preenche com o total para quitar" onClick={() => setPago(brInput(totalCheio))}>Quitar tudo</button>
                </div>
              </div>
            </div>

            {/* resultado */}
            <div className="card p-5 space-y-4">
              <div className="text-sm font-semibold text-gray-200">Resultado</div>
              {!calc && <div className="text-sm text-gray-500 py-12 text-center">Digite o valor que o cliente pagou.</div>}
              {calc?.aviso && <div className={`${calc.total ? 'bg-sky-900/40 text-sky-200' : 'bg-amber-900/40 text-amber-200'} text-sm rounded-lg p-3`}>{calc.aviso}</div>}
              {calc && !calc.aviso && (
                <>
                  <div className="rounded-xl bg-prim-600/15 border border-prim-600/40 p-5">
                    <div className="kpi-label">Valor da Baixa · cole no Mega</div>
                    <div className="flex flex-wrap items-center gap-3 mt-2">
                      <div className="text-4xl font-bold text-white font-mono">{fmt(calc.baixa)}</div>
                      <div className="ml-auto"><Copiar valor={calc.baixa} grande /></div>
                    </div>
                  </div>
                  <table className="w-full text-sm">
                    <tbody className="[&_td]:py-1.5">
                      <tr><td className="text-gray-400">Juros sobre o valor baixado</td><td className="text-right text-xs text-gray-500">{pct(calc.k * 100, 4)}</td><td className="text-right font-mono text-gray-100 w-32">{fmt(calc.juros)}</td><td className="w-28 text-right"><Copiar valor={calc.juros} /></td></tr>
                      <tr><td className="text-gray-400">Multa (cheia)</td><td /><td className="text-right font-mono text-gray-100">{fmt(calc.multa)}</td><td /></tr>
                      <tr className="border-t border-ink-700"><td className="text-gray-200 font-semibold">Total a receber</td><td /><td className="text-right font-mono font-semibold text-emerald-300">{fmt(calc.total)}</td><td /></tr>
                    </tbody>
                  </table>
                  <div className="rounded-lg bg-ink-900 border border-ink-700 p-3 text-xs text-gray-400 flex items-center gap-2">
                    <ArrowRight size={14} className="text-gray-500" /> Depois da baixa fica em aberto no título: <span className="ml-auto font-mono text-gray-200">{fmt(calc.restante)}</span>
                  </div>
                  <p className="text-[11px] text-gray-500 flex gap-1.5"><Info size={12} className="shrink-0 mt-0.5" /> No Mega, cole no Valor da Baixa e confira se o Total a Receber ficou {fmt(calc.total)}. Se os juros vierem 1 centavo diferentes, copie os juros daqui.</p>
                </>
              )}
            </div>
          </div>
        </>
      )}

      {!busca && !sel && (
        <div className="card p-5 text-sm text-gray-400 grid sm:grid-cols-3 gap-4">
          <div><div className="text-gray-200 font-semibold mb-1">1. Título</div>Digite o número do título. A tela traz o cliente, as parcelas em aberto e o saldo.</div>
          <div><div className="text-gray-200 font-semibold mb-1">2. Valor pago</div>Juros e multa vêm dos encargos do título no Mega. Informe quanto o cliente pagou.</div>
          <div><div className="text-gray-200 font-semibold mb-1">3. Copiar</div>Copie o Valor da Baixa e cole na baixa do contas a receber do Mega.</div>
        </div>
      )}
    </div>
  );
}
