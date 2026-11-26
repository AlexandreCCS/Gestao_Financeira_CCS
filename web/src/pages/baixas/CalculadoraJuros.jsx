// [26/11/2026 - CRIADO POR ALEXANDRE CARVALHO] Baixas/Conciliação › CALCULADORA DE JUROS E MULTA (Quality, baixa parcial no Mega).
// O cliente paga um valor que nao fecha o titulo e a usuaria precisa saber quanto digitar no "Valor da Baixa" da tela de
// baixa do contas a receber do Mega para que Baixa + Juros + Multa = valor pago.
// Regra do Mega (conferida no print de 26/11): os juros sao PROPORCIONAIS ao valor baixado e a multa entra CHEIA mesmo na
// baixa parcial (e de novo na proxima parcial). Por isso nao reproduzimos a formula de juros do Mega: a usuaria informa o que
// o proprio Mega mostra para o SALDO INTEIRO (saldo, juros, multa) e a tela tira a taxa: k = juros / saldo.
//   Valor da Baixa = (recebido - multa) / (1 + k)      juros = recebido - multa - baixa (fecha no centavo)
// Exemplo do print: saldo 3.030,88, juros 1.565,96, multa 60,62, pago 1.000,00 -> baixa 619,37 + juros 320,01 + multa 60,62.
// Tela so de calculo: nao grava nada no Mega nem no banco.
import React, { useMemo, useState } from 'react';
import { Calculator, Copy, Check, RotateCcw, Info } from 'lucide-react';

const fmt = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const r2 = v => Math.round((v + Number.EPSILON) * 100) / 100;
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

function Campo({ label, dica, value, onChange, autoFocus }) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-wider text-gray-400">{label}</span>
      <input className="input mt-1 text-right font-mono text-base" inputMode="decimal" placeholder="0,00" autoFocus={autoFocus}
             value={value} onChange={e => onChange(e.target.value)} />
      {dica && <span className="text-[11px] text-gray-500">{dica}</span>}
    </label>
  );
}

function Copiar({ valor }) {
  const [ok, setOk] = useState(false);
  async function copiar() {
    const t = paraMega(valor);
    try { await navigator.clipboard.writeText(t); }
    catch {   // navegador sem clipboard API (http): copia por um textarea escondido
      const el = document.createElement('textarea'); el.value = t; document.body.appendChild(el); el.select();
      document.execCommand('copy'); document.body.removeChild(el);
    }
    setOk(true); setTimeout(() => setOk(false), 1500);
  }
  return (
    <button type="button" className={ok ? 'btn bg-emerald-600 text-white' : 'btn-prim'} onClick={copiar} title={`Copia ${paraMega(valor)} para colar no Mega`}>
      {ok ? <><Check size={15} /> Copiado</> : <><Copy size={15} /> Copiar</>}
    </button>
  );
}

export default function CalculadoraJuros() {
  const [saldo, setSaldo] = useState('');
  const [juros, setJuros] = useState('');
  const [multa, setMulta] = useState('');
  const [pago, setPago]   = useState('');

  const calc = useMemo(() => {
    const S = num(saldo), J = num(juros), M = num(multa) || 0, R = num(pago);
    if (!(S > 0) || !(J >= 0) || !(R > 0)) return null;
    const k = J / S;
    const totalCheio = r2(S + J + M);
    if (R >= totalCheio) return { aviso: `O valor pago cobre o título inteiro (${fmt(totalCheio)}). Faça a baixa total no Mega.`, k };
    if (R <= M) return { aviso: `O valor pago não cobre nem a multa (${fmt(M)}).`, k };
    const baixa = r2((R - M) / (1 + k));
    const jurosP = r2(R - M - baixa);
    return { k, baixa, juros: jurosP, multa: M, total: r2(baixa + jurosP + M), restante: r2(S - baixa), totalCheio };
  }, [saldo, juros, multa, pago]);

  const limpar = () => { setSaldo(''); setJuros(''); setMulta(''); setPago(''); };

  return (
    <div className="p-6 space-y-6 max-w-[980px] mx-auto">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-100 tracking-tight flex items-center gap-2"><Calculator size={22} /> Calculadora de juros e multa</h1>
          <p className="text-sm text-gray-500">Baixa parcial no Mega: o cliente pagou um valor e você precisa saber quanto digitar no <b className="text-gray-300">Valor da Baixa</b>.</p>
        </div>
        <button className="btn-ghost text-xs ml-auto" onClick={limpar}><RotateCcw size={14} /> Limpar</button>
      </div>

      <div className="card p-4 text-sm text-gray-300 flex gap-3">
        <Info size={18} className="text-sky-300 shrink-0 mt-0.5" />
        <ol className="list-decimal pl-4 space-y-1">
          <li>No Mega, abra a baixa do título com o <b>saldo inteiro</b> no Valor da Baixa e copie para cá o <b>Saldo</b>, os <b>Juros</b> e a <b>Multa</b> que ele calcular.</li>
          <li>Digite o <b>valor que o cliente pagou</b>.</li>
          <li>Clique em <b>Copiar</b> e cole no <b>Valor da Baixa</b> do Mega. Confira se o Total a Receber ficou igual ao valor pago.</li>
        </ol>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="card p-5 space-y-4">
          <div className="text-sm font-semibold text-gray-200">Valores do Mega (baixa do saldo inteiro)</div>
          <Campo label="Saldo do título" value={saldo} onChange={setSaldo} autoFocus />
          <Campo label="Juros" value={juros} onChange={setJuros} />
          <Campo label="Multa" value={multa} onChange={setMulta} dica="A multa entra cheia na baixa parcial." />
          <div className="border-t border-ink-700 pt-4">
            <Campo label="Valor pago pelo cliente" value={pago} onChange={setPago} />
          </div>
        </div>

        <div className="card p-5 space-y-4">
          <div className="text-sm font-semibold text-gray-200">Resultado</div>
          {!calc && <div className="text-sm text-gray-500 py-10 text-center">Preencha saldo, juros e o valor pago.</div>}
          {calc?.aviso && <div className="bg-amber-900/40 text-amber-200 text-sm rounded-lg p-3">{calc.aviso}</div>}
          {calc && !calc.aviso && (
            <>
              <div className="rounded-lg bg-prim-600/15 border border-prim-600/40 p-4">
                <div className="kpi-label">Valor da Baixa (digitar no Mega)</div>
                <div className="flex items-center gap-3 mt-1">
                  <div className="text-3xl font-bold text-white font-mono">{fmt(calc.baixa)}</div>
                  <div className="ml-auto"><Copiar valor={calc.baixa} /></div>
                </div>
              </div>
              <table className="w-full text-sm">
                <tbody className="[&_td]:py-1.5">
                  <tr><td className="text-gray-400">Percentual de juros sobre o valor baixado</td><td className="text-right font-mono text-gray-100">{(calc.k * 100).toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}%</td></tr>
                  <tr><td className="text-gray-400">Juros</td><td className="text-right font-mono text-gray-100">{fmt(calc.juros)}</td><td className="w-24 text-right"><Copiar valor={calc.juros} /></td></tr>
                  <tr><td className="text-gray-400">Multa</td><td className="text-right font-mono text-gray-100">{fmt(calc.multa)}</td></tr>
                  <tr className="border-t border-ink-700"><td className="text-gray-200 font-semibold">Total a receber</td><td className="text-right font-mono font-semibold text-emerald-300">{fmt(calc.total)}</td></tr>
                  <tr><td className="text-gray-500 text-xs pt-3">Saldo que fica em aberto no título</td><td className="text-right font-mono text-gray-400 text-xs pt-3">{fmt(calc.restante)}</td></tr>
                </tbody>
              </table>
              <p className="text-[11px] text-gray-500">Se os juros do Mega vierem 1 centavo diferente, copie os juros daqui e cole no campo Juros do Mega.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
