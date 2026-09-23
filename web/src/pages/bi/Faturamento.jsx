// [23/09/2026 - Alexandre Carvalho] BI FECHAMENTO (GRUPO) > FATURAMENTO — primeira tela do dashboard.
//
// Vem do briefing "BI Fechamento.xlsx". O que sustenta a tela: "NF" e "PRO" nao sao tipo de documento,
// sao PARES DE FILIAIS (a de CNPJ real emite nota; a espelho, com CNPJ fake, e a operacao PRO).
// [23/09/2026] REGRA DO ALEXANDRE: nunca escrever "sem nota" em lugar nenhum - o termo e sempre PRO.
// Por isso cada empresa aparece uma vez, com o valor aberto em NF e PRO.
//
// Regras fechadas com o Alexandre: faturamento = nota que gera contas a receber; o total do grupo e
// LIQUIDO (sem venda entre empresas do grupo) e o intragrupo aparece a parte; JR, Procolor e NLS vendem
// 100% para dentro e viram bloco "empresas internas"; periodo padrao = mes anterior fechado; a linha de
// produto usa a nomenclatura do Mega (prefixo do grupo: HOM, HOB, ESC, RQL...).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Calendar, ChevronRight, ChevronDown, Building2, Layers, Info, ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';
import { api } from '../../api/client';

const brl  = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const brlC = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const nf   = (v, d = 0) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct  = v => v == null ? '—' : `${(v * 100).toFixed(1).replace('.', ',')}%`;
const mesBr = iso => { const [a, m] = iso.split('-'); return `${['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'][+m - 1]}/${a}`; };

const SEGMENTOS = [
  { k: '',     label: 'Tudo' },
  { k: 'IND',  label: 'Indústria' },
  { k: 'VAR',  label: 'Varejo' },
  { k: 'CD',   label: 'CD' },
  { k: 'DIST', label: 'Distribuidora' },
];

// variacao contra o mesmo periodo do ano anterior
function Variacao({ v, className = '' }) {
  if (v == null) return <span className="text-slate-500 text-xs">sem base</span>;
  const pos = v >= 0, Icone = v > 0.0005 ? ArrowUpRight : v < -0.0005 ? ArrowDownRight : Minus;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${pos ? 'text-emerald-400' : 'text-rose-400'} ${className}`}>
      <Icone size={13} />{pct(Math.abs(v))}
    </span>
  );
}

function Kpi({ titulo, valor, hint, destaque, children }) {
  return (
    <div className={`rounded-xl border p-4 ${destaque ? 'border-sky-500/40 bg-sky-500/5' : 'border-slate-700/60 bg-slate-800/40'}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{titulo}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-50">{valor}</div>
      {hint && <div className="mt-1 text-xs text-slate-400">{hint}</div>}
      {children}
    </div>
  );
}

// barra NF x PRO
function BarraNfPro({ nfv, prov }) {
  const t = nfv + prov;
  const p = t > 0 ? (nfv / t) * 100 : 100;
  return (
    <div className="mt-2">
      <div className="flex h-1.5 overflow-hidden rounded-full bg-slate-700">
        <div className="bg-sky-400" style={{ width: `${p}%` }} />
        <div className="bg-amber-400" style={{ width: `${100 - p}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-slate-400">
        <span><b className="text-sky-300">NF</b> {brl(nfv)}</span>
        <span><b className="text-amber-300">PRÓ</b> {brl(prov)}</span>
      </div>
    </div>
  );
}

export default function BiFaturamento() {
  const [ini, setIni]       = useState('');
  const [fim, setFim]       = useState('');
  const [seg, setSeg]       = useState('');
  const [dados, setDados]   = useState(null);
  const [linhas, setLinhas] = useState(null);
  const [aberta, setAberta] = useState(null);      // linha de produto expandida
  const [detalhe, setDetalhe] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro]     = useState('');

  const carregar = useCallback(async (di, df, sg) => {
    setCarregando(true); setErro('');
    try {
      const [f, l] = await Promise.all([api.biFaturamento(di || '', df || '', sg), api.biFaturamentoLinha(di || '', df || '', '', sg)]);
      setDados(f); setLinhas(l.linhas); setAberta(null); setDetalhe([]);
      setIni(f.filtro.ini); setFim(f.filtro.fim);
    } catch (e) { setErro(e?.message || 'Falha ao carregar o faturamento'); }
    finally { setCarregando(false); }
  }, []);
  useEffect(() => { carregar('', '', ''); }, [carregar]);

  async function abrirLinha(nome) {
    if (aberta === nome) { setAberta(null); setDetalhe([]); return; }
    setAberta(nome); setDetalhe([]);
    try { const r = await api.biFaturamentoLinha(ini, fim, nome, seg); setDetalhe(r.linhas); }
    catch { setDetalhe([]); }
  }

  const g = dados?.grupo;
  const maiorLinha = useMemo(() => (linhas || []).reduce((m, l) => Math.max(m, l.total), 0), [linhas]);

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 text-slate-200">
      <header className="mb-5">
        <div className="text-xs font-semibold uppercase tracking-widest text-sky-400">BI Fechamento · Grupo</div>
        <h1 className="mt-1 text-2xl font-semibold text-slate-50">Faturamento</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-400">
          Venda que gera contas a receber, consolidada por empresa. Cada empresa soma a filial que emite nota e a
          filial PRÓ. O total do grupo é líquido: a venda entre empresas do grupo aparece separada.
        </p>
      </header>

      {/* filtros */}
      <div className="mb-5 flex flex-wrap items-end gap-3 rounded-xl border border-slate-700/60 bg-slate-800/40 p-3">
        <label className="text-xs text-slate-400">
          <span className="mb-1 flex items-center gap-1"><Calendar size={13} /> Início</span>
          <input type="date" value={ini} onChange={e => setIni(e.target.value)}
                 className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm text-slate-100" />
        </label>
        <label className="text-xs text-slate-400">
          <span className="mb-1 block">Fim</span>
          <input type="date" value={fim} onChange={e => setFim(e.target.value)}
                 className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm text-slate-100" />
        </label>
        <div className="flex gap-1 rounded-lg border border-slate-600 bg-slate-900 p-1">
          {SEGMENTOS.map(s => (
            <button key={s.k} onClick={() => { setSeg(s.k); carregar(ini, fim, s.k); }}
                    className={`rounded-md px-3 py-1 text-xs font-medium transition ${seg === s.k ? 'bg-sky-500 text-white' : 'text-slate-300 hover:bg-slate-800'}`}>
              {s.label}
            </button>
          ))}
        </div>
        <button onClick={() => carregar(ini, fim, seg)} disabled={carregando}
                className="rounded-lg bg-sky-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-400 disabled:opacity-50">
          {carregando ? 'Carregando…' : 'Aplicar'}
        </button>
        {dados && (
          <button onClick={() => carregar('', '', seg)}
                  className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800">
            Mês fechado ({mesBr(dados.filtro.padrao.ini)})
          </button>
        )}
      </div>

      {erro && <div className="mb-4 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-300">{erro}</div>}

      {carregando && !dados ? (
        <div className="py-20 text-center text-slate-400">Consolidando o faturamento do grupo…</div>
      ) : g && (
        <>
          {/* topo */}
          <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi destaque titulo="Faturamento líquido do grupo" valor={brl(g.liquido)}
                 hint={`sem a venda entre empresas do grupo · ${nf(g.notas)} notas`}>
              <div className="mt-2"><Variacao v={g.variacaoLiq} /> <span className="text-xs text-slate-500">vs. mesmo período do ano anterior</span></div>
            </Kpi>
            <Kpi titulo="Faturamento bruto" valor={brl(g.total)} hint="tudo que foi faturado no período">
              <BarraNfPro nfv={g.nf} prov={g.pro} />
            </Kpi>
            <Kpi titulo="Intragrupo" valor={brl(g.intra)}
                 hint={`${pct(g.total > 0 ? g.intra / g.total : 0)} do bruto · venda de uma empresa para outra`} />
            <Kpi titulo="PRÓ" valor={brl(g.pro)} hint={`${pct(g.percPro)} do faturamento bruto`} />
          </div>

          {/* empresas */}
          <section className="mb-6 overflow-hidden rounded-xl border border-slate-700/60">
            <div className="flex items-center gap-2 border-b border-slate-700/60 bg-slate-800/60 px-4 py-2.5">
              <Building2 size={15} className="text-sky-400" />
              <h2 className="text-sm font-semibold text-slate-100">Por empresa</h2>
              <span className="text-xs text-slate-400">NF + PRÓ consolidados</span>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-slate-800/40 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Empresa</th>
                  <th className="px-3 py-2 text-left font-medium">Filiais</th>
                  <th className="px-3 py-2 text-right font-medium">Bruto</th>
                  <th className="px-3 py-2 text-right font-medium">NF</th>
                  <th className="px-3 py-2 text-right font-medium">PRÓ</th>
                  <th className="px-3 py-2 text-right font-medium">Intragrupo</th>
                  <th className="px-3 py-2 text-right font-medium">Líquido</th>
                  <th className="px-3 py-2 text-right font-medium">Notas</th>
                  <th className="px-4 py-2 text-right font-medium">vs. ano ant.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {dados.empresas.map(e => (
                  <tr key={e.sigla} className="hover:bg-slate-800/30">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-slate-100">{e.nome}</div>
                      <div className="text-[11px] text-slate-500">{e.sigla} · {e.segmento}</div>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-400">
                      <span className="text-sky-300">{e.filiaisNf || '—'}</span>
                      {e.filiaisPro && <span className="text-amber-300"> · {e.filiaisPro}</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{brl(e.total)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-sky-300">{brl(e.nf)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-amber-300">{e.pro ? brl(e.pro) : <span className="text-slate-600">—</span>}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-400">{e.intra ? brl(e.intra) : <span className="text-slate-600">—</span>}</td>
                    <td className="px-3 py-2.5 text-right font-medium tabular-nums text-slate-50">{brl(e.liquido)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-400">{nf(e.notas)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <Variacao v={e.anterior > 0 ? e.total / e.anterior - 1 : null} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-slate-700 bg-slate-800/60 text-sm font-semibold">
                <tr>
                  <td className="px-4 py-2.5" colSpan={2}>Total do grupo</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{brl(g.total)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-sky-300">{brl(g.nf)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-amber-300">{brl(g.pro)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-300">{brl(g.intra)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-50">{brl(g.liquido)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-300">{nf(g.notas)}</td>
                  <td className="px-4 py-2.5 text-right"><Variacao v={g.variacao} /></td>
                </tr>
              </tfoot>
            </table>
          </section>

          {/* empresas internas */}
          {dados.internas.linhas.length > 0 && (
            <section className="mb-6 rounded-xl border border-slate-700/60 bg-slate-800/20 p-4">
              <div className="mb-2 flex items-center gap-2">
                <Info size={14} className="text-slate-400" />
                <h2 className="text-sm font-semibold text-slate-200">Empresas internas</h2>
                <span className="text-xs text-slate-400">vendem para dentro do grupo, ficam fora do total</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {dados.internas.linhas.map(e => (
                  <div key={e.sigla} className="rounded-lg border border-slate-700/60 bg-slate-900/40 p-3">
                    <div className="text-sm font-medium text-slate-100">{e.nome}</div>
                    <div className="mt-1 text-lg font-semibold tabular-nums text-slate-50">{brl(e.total)}</div>
                    <div className="mt-0.5 text-[11px] text-slate-400">
                      {pct(e.total > 0 ? e.intra / e.total : 0)} para o grupo · {nf(e.notas)} notas ·{' '}
                      <Variacao v={e.anterior > 0 ? e.total / e.anterior - 1 : null} />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* linhas de produto */}
          <section className="overflow-hidden rounded-xl border border-slate-700/60">
            <div className="flex items-center gap-2 border-b border-slate-700/60 bg-slate-800/60 px-4 py-2.5">
              <Layers size={15} className="text-sky-400" />
              <h2 className="text-sm font-semibold text-slate-100">Por linha de produto</h2>
              <span className="text-xs text-slate-400">nomenclatura do Mega · clique para abrir os grupos</span>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-slate-800/40 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Linha</th>
                  <th className="px-3 py-2 text-left font-medium">Participação</th>
                  <th className="px-3 py-2 text-right font-medium">Valor</th>
                  <th className="px-3 py-2 text-right font-medium">NF</th>
                  <th className="px-3 py-2 text-right font-medium">PRÓ</th>
                  <th className="px-3 py-2 text-right font-medium">Quantidade</th>
                  <th className="px-4 py-2 text-right font-medium">vs. ano ant.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {(linhas || []).map(l => (
                  <React.Fragment key={l.linha}>
                    <tr onClick={() => abrirLinha(l.linha)} className="cursor-pointer hover:bg-slate-800/30">
                      <td className="px-4 py-2.5">
                        <span className="inline-flex items-center gap-1.5 font-medium text-slate-100">
                          {aberta === l.linha ? <ChevronDown size={14} className="text-sky-400" /> : <ChevronRight size={14} className="text-slate-500" />}
                          {l.linha}
                        </span>
                        <span className="ml-5 text-[11px] text-slate-500">{l.grupos} grupo{l.grupos === 1 ? '' : 's'}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="h-1.5 w-32 overflow-hidden rounded-full bg-slate-700">
                          <div className="h-full bg-sky-400" style={{ width: `${maiorLinha > 0 ? (l.total / maiorLinha) * 100 : 0}%` }} />
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right font-medium tabular-nums">{brl(l.total)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-sky-300">{brl(l.nf)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-amber-300">{l.pro ? brl(l.pro) : <span className="text-slate-600">—</span>}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-400">{nf(l.qtde)}</td>
                      <td className="px-4 py-2.5 text-right"><Variacao v={l.anterior > 0 ? l.total / l.anterior - 1 : null} /></td>
                    </tr>
                    {aberta === l.linha && detalhe.map(d => (
                      <tr key={d.detalhe} className="bg-slate-900/50 text-[13px]">
                        <td className="py-2 pl-12 pr-4 text-slate-300" colSpan={2}>{d.detalhe}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-200">{brlC(d.total)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-sky-300/80">{brl(d.nf)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-amber-300/80">{d.pro ? brl(d.pro) : '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-400">{nf(d.qtde)}</td>
                        <td className="px-4 py-2 text-right"><Variacao v={d.anterior > 0 ? d.total / d.anterior - 1 : null} /></td>
                      </tr>
                    ))}
                    {aberta === l.linha && detalhe.length === 0 && (
                      <tr className="bg-slate-900/50"><td colSpan={7} className="py-2 pl-12 text-xs text-slate-500">abrindo os grupos…</td></tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
            <div className="border-t border-slate-700/60 bg-slate-800/30 px-4 py-2 text-[11px] text-slate-500">
              O valor por linha soma os itens da nota, por isso fica um pouco abaixo do total por empresa, que inclui frete e impostos da capa.
            </div>
          </section>
        </>
      )}
    </div>
  );
}
