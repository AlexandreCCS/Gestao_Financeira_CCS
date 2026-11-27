// [26/10/2026 - CRIADO POR ALEXANDRE CARVALHO] Baixas/Conciliação › CONCILIAÇÃO BANCÁRIA (Quality).
// Pedido do Alexandre (26/10): importar o extrato e conferir com o Mega numa tela só, padrão Apple, funcional sobre o banco real.
// Fluxo: 1) arquivo .RET (CNAB 240, lido aqui no navegador) -> 2) leitura e validação (/cb/analisar: conta, tipos, já importado,
// duplicidades, saldos) -> validar e importar no Mega (/cb/preparar + /cb/arquivos/:id/importar, tudo ou nada) -> 3) conferência em
// níveis (/cb/conferencia: 1 exata, 2 forte, 3 possível; títulos a baixar e lançamentos a criar seguem para Baixar e conciliar) ->
// 4) conciliar (resumo + validação + confirmação; /cb/conciliar, tipo A nos níveis 1-2 e M no par escolhido à mão).
// Regras e diagnóstico: Instruções/Gestor_Financeiro_Conciliacao_Bancaria_Importacao.md.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Upload, CheckCircle2, AlertTriangle, XCircle, Loader2, ChevronDown, ChevronRight, Search, Link2, Sun, Moon, History,
  RefreshCw, X, Landmark, ArrowRight, Info, FileText
} from 'lucide-react';
import { api } from '../../api/client';
import { lerExtratoCnab240 } from './cnab240';

const fmt = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtN = v => Number(v || 0).toLocaleString('pt-BR');
const fmtBr = s => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—');
const r2 = v => Math.round((Number(v) || 0) * 100) / 100;
const isoDia = n => { const d = new Date(); d.setDate(d.getDate() - (n || 0)); return d.toISOString().slice(0, 10); };
const localIso = ms => { const d = new Date(ms); const p = x => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
const lerTema = () => { try { return localStorage.getItem('cb_tema') || 'escuro'; } catch { return 'escuro'; } };

// tokens da tela (o resto do Gestor é escuro; a variante clara é desta tela)
const TEMAS = {
  escuro: { '--cb-bg': 'transparent', '--cb-card': '#111827', '--cb-card2': '#0f172a', '--cb-line': 'rgba(148,163,184,.14)', '--cb-text': '#e5e7eb', '--cb-muted': '#94a3b8',
            '--cb-soft': 'rgba(148,163,184,.08)', '--cb-ok': '#34d399', '--cb-warn': '#fbbf24', '--cb-err': '#f87171', '--cb-info': '#93c5fd', '--cb-prim': '#10b981' },
  claro:  { '--cb-bg': '#f5f5f7', '--cb-card': '#ffffff', '--cb-card2': '#fafafa', '--cb-line': 'rgba(0,0,0,.08)', '--cb-text': '#1d1d1f', '--cb-muted': '#6e6e73',
            '--cb-soft': 'rgba(0,0,0,.04)', '--cb-ok': '#15803d', '--cb-warn': '#b45309', '--cb-err': '#dc2626', '--cb-info': '#1d4ed8', '--cb-prim': '#059669' },
};
const card = 'bg-[var(--cb-card)] border border-[var(--cb-line)] rounded-2xl';
const muted = 'text-[var(--cb-muted)]';
const btnPrim = 'inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium bg-[var(--cb-prim)] text-white hover:opacity-90 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cb-prim)] focus-visible:ring-offset-2';
const btnSec = 'inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm border border-[var(--cb-line)] text-[var(--cb-text)] hover:bg-[var(--cb-soft)] disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cb-prim)]';
const campo = 'bg-[var(--cb-card2)] border border-[var(--cb-line)] rounded-lg px-2.5 py-1.5 text-sm text-[var(--cb-text)] outline-none focus:border-[var(--cb-prim)]';

// categorias da conferência (a partir do motor: situação + nível)
const CATS = [
  { k: 'auto', c: 'Automática', t: 'Conciliação automática', d: 'Nível 1: valor, data, tipo e nome conferem, sem outro candidato', cor: 'var(--cb-ok)' },
  { k: 'confirmar', c: 'Confirmar', t: 'Prontos para confirmação', d: 'Nível 2: par único e tipo compatível, falta uma prova a mais', cor: 'var(--cb-ok)' },
  { k: 'divergente', c: 'Divergente', t: 'Divergentes', d: 'Nível 3 ou candidatos aproximados: escolha o lançamento', cor: 'var(--cb-warn)' },
  { k: 'baixa', c: 'Baixar título', t: 'Exigem baixa de título', d: 'O banco pagou/recebeu e o título ainda está em aberto no Mega', cor: 'var(--cb-info)' },
  { k: 'lancar', c: 'Lançar', t: 'Exigem lançamento', d: 'Tarifa, IOF e outros movimentos sem título: lançamento por de-para', cor: 'var(--cb-info)' },
  { k: 'sem', c: 'Sem par', t: 'Sem correspondência', d: 'Nada compatível no Mega: analise ou deixe pendente', cor: 'var(--cb-err)' },
  { k: 'info', c: 'Informativo', t: 'Informativos', d: 'Aplicação automática e rendimentos', cor: 'var(--cb-muted)' },
];
const catDe = i => {
  if (i.situacao === 'conciliar') return i.nivel === 1 ? 'auto' : i.nivel === 2 ? 'confirmar' : 'divergente';
  if (i.situacao === 'lote') return i.nivel === 2 ? 'confirmar' : 'divergente';
  if (i.situacao === 'pronto') return 'baixa';
  if (i.situacao === 'real') return 'lancar';
  if (i.situacao === 'informativo') return 'info';
  return (i.candidatos || []).length ? 'divergente' : 'sem';
};
const conciliavel = i => ['conciliar', 'lote'].includes(i.situacao);

function Chip({ cor, children, title }) {
  return <span title={title} className="inline-flex items-center gap-1.5 text-[11px] font-medium whitespace-nowrap" style={{ color: cor }}><span className="w-1.5 h-1.5 rounded-full" style={{ background: cor }} />{children}</span>;
}
function Numero({ rotulo, valor, sub, cor }) {
  return (
    <div className={`${card} px-5 py-4`}>
      <div className={`text-xs ${muted}`}>{rotulo}</div>
      <div className="text-xl font-semibold tracking-tight mt-1 whitespace-nowrap overflow-hidden text-ellipsis tabular-nums" title={String(valor)} style={cor ? { color: cor } : undefined}>{valor}</div>
      {sub != null && <div className={`text-xs ${muted} mt-0.5`}>{sub}</div>}
    </div>
  );
}
function Aviso({ tipo = 'warn', children }) {
  const cor = tipo === 'err' ? 'var(--cb-err)' : tipo === 'ok' ? 'var(--cb-ok)' : tipo === 'info' ? 'var(--cb-info)' : 'var(--cb-warn)';
  const Ic = tipo === 'err' ? XCircle : tipo === 'ok' ? CheckCircle2 : tipo === 'info' ? Info : AlertTriangle;
  return <div className="flex gap-2 items-start text-sm rounded-xl px-3 py-2 bg-[var(--cb-soft)]" style={{ color: cor }}><Ic size={16} className="mt-0.5 shrink-0" /><div>{children}</div></div>;
}

export default function ConciliacaoBancaria() {
  const [tema, setTema] = useState(lerTema);
  const [contas, setContas] = useState([]);
  const [conta, setConta] = useState('');
  const [periodo, setPeriodo] = useState({ ini: isoDia(30), fim: isoDia(0) });
  const [arq, setArq] = useState(null);         // { file, nome, hash, ex, analise, escolhas, fil: {}, prep: {}, imp: {} }
  const [lendo, setLendo] = useState(false);
  const [erroArq, setErroArq] = useState('');
  const [conf, setConf] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erroConf, setErroConf] = useState('');
  const [verHist, setVerHist] = useState(false);
  const temaVars = TEMAS[tema];

  useEffect(() => { try { localStorage.setItem('cb_tema', tema); } catch { /* sem storage */ } }, [tema]);
  useEffect(() => { api.bxcContas().then(r => setContas((r.contas || []).filter(c => c.ativa))).catch(() => setContas([])); }, []);

  const carregarConf = useCallback(async (agn = conta, p = periodo) => {
    if (!agn) return;
    setCarregando(true); setErroConf('');
    try { setConf(await api.cbConferencia({ conta: agn, ini: p.ini, fim: p.fim })); }
    catch (e) { setConf(null); setErroConf(e.message || 'Não foi possível conferir esta conta.'); }
    finally { setCarregando(false); }
  }, [conta, periodo]);
  useEffect(() => { if (conta) carregarConf(conta, periodo); }, [conta]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- etapa 1/2: arquivo
  async function abrirArquivo(file, escolhas = {}) {
    setErroArq(''); setLendo(true);
    try {
      const buf = await file.arrayBuffer();
      const texto = new TextDecoder('latin1').decode(buf);
      const ex = lerExtratoCnab240(texto, file.name);
      const hashBuf = await crypto.subtle.digest('SHA-256', buf);
      const hash = [...new Uint8Array(hashBuf)].map(b => b.toString(16).padStart(2, '0')).join('');
      const meta = { nome: file.name, hash, banco: ex.banco, banco_nome: ex.banco_nome, gerado_em: ex.gerado_em, data_arquivo: localIso(file.lastModified || Date.now()) };
      const analise = await api.cbAnalisar({ arquivo: meta, contas: ex.contas, escolhas });
      const fil = {};
      analise.contas.forEach((c, k) => { fil[k] = c.filiais?.sugerida || ''; });
      setArq({ file, meta, ex, analise, escolhas, fil, prep: {}, imp: {} });
    } catch (e) { setArq(null); setErroArq(e.message || 'Não foi possível ler o arquivo.'); }
    finally { setLendo(false); }
  }
  const escolherConta = (bloco, agn) => abrirArquivo(arq.file, { ...arq.escolhas, [`${bloco.agencia}|${bloco.conta}`]: agn });

  async function validar(k) {
    const c = arq.analise.contas[k], bloco = arq.ex.contas[k];
    setArq(a => ({ ...a, prep: { ...a.prep, [k]: { rodando: true } } }));
    try {
      const r = await api.cbPreparar({ arquivo: arq.meta, contas: [bloco], agn: c.escolhida.agn, fil: Number(arq.fil[k]) });
      setArq(a => ({ ...a, prep: { ...a.prep, [k]: r } }));
    } catch (e) { setArq(a => ({ ...a, prep: { ...a.prep, [k]: { status: 'X', mensagem: e.message } } })); }
  }
  async function importar(k) {
    const id = arq.prep[k]?.id;
    setArq(a => ({ ...a, imp: { ...a.imp, [k]: { rodando: true } } }));
    try {
      const r = await api.cbImportar(id);
      setArq(a => ({ ...a, imp: { ...a.imp, [k]: r } }));
      if (r.status === 'I') {
        const c = arq.analise.contas[k];
        const p = { ini: c.resumo.periodo.ini || periodo.ini, fim: c.resumo.periodo.fim || periodo.fim };
        setPeriodo(p); setConta(String(c.escolhida.agn)); carregarConf(c.escolhida.agn, p);
      }
    } catch (e) { setArq(a => ({ ...a, imp: { ...a.imp, [k]: { status: 'X', mensagem: e.message } } })); }
  }

  return (
    <div style={temaVars} className="bg-[var(--cb-bg)] text-[var(--cb-text)] px-4 py-6 sm:px-8 sm:py-8 min-h-[calc(100vh-3.5rem)]">
      <div className="max-w-[1400px] mx-auto space-y-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Conciliação Bancária</h1>
            <p className={`text-[15px] ${muted} mt-1`}>Importe seu extrato e confira os movimentos com o MEGA.</p>
          </div>
          <div className="flex items-center gap-2">
            <button className={btnSec} onClick={() => setVerHist(v => !v)} aria-expanded={verHist}><History size={15} /> Importações</button>
            <button className={btnSec} onClick={() => setTema(t => (t === 'escuro' ? 'claro' : 'escuro'))} aria-label="Alternar tema claro/escuro">
              {tema === 'escuro' ? <Sun size={15} /> : <Moon size={15} />}
            </button>
          </div>
        </header>

        {verHist && <HistoricoImportacoes conta={conta} onFechar={() => setVerHist(false)} />}

        {/* ------------------------------------------------ 1. arquivo */}
        <section aria-labelledby="cb-imp" className="space-y-4">
          <h2 id="cb-imp" className="text-lg font-semibold">1 · Extrato</h2>
          {!arq && <ZonaArquivo lendo={lendo} onArquivo={f => abrirArquivo(f)} />}
          {erroArq && <Aviso tipo="err">{erroArq}</Aviso>}
          {arq && (
            <div className="space-y-4">
              <div className={`${card} px-5 py-3 flex flex-wrap items-center justify-between gap-3`}>
                <div className="flex items-center gap-3 min-w-0">
                  <FileText size={18} className={muted} />
                  <div className="min-w-0">
                    <div className="font-medium truncate">{arq.meta.nome}</div>
                    <div className={`text-xs ${muted}`}>Banco {arq.meta.banco} · {arq.meta.banco_nome || '—'} · gerado em {fmtBr(arq.ex.gerado_em)} · {fmtN(arq.ex.linhas)} registros CNAB 240</div>
                  </div>
                </div>
                <button className={btnSec} onClick={() => setArq(null)}><X size={14} /> Outro arquivo</button>
              </div>
              {arq.ex.invalidos > 0 && <Aviso tipo="warn">{fmtN(arq.ex.invalidos)} registro(s) de lançamento sem data ou sem débito/crédito foram ignorados na leitura.</Aviso>}
              {arq.analise.contas.map((c, k) => (
                <BlocoConta key={k} c={c} filiais={arq.analise.filiais} fil={arq.fil[k]} setFil={v => setArq(a => ({ ...a, fil: { ...a.fil, [k]: v } }))}
                  prep={arq.prep[k]} imp={arq.imp[k]} onEscolher={agn => escolherConta(arq.ex.contas[k], agn)} onValidar={() => validar(k)} onImportar={() => importar(k)} />
              ))}
            </div>
          )}
        </section>

        {/* ------------------------------------------------ 2. conferência */}
        <section aria-labelledby="cb-conf" className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 id="cb-conf" className="text-lg font-semibold">2 · Conferência com o MEGA</h2>
            <div className="flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor="cb-conta">Conta</label>
              <select id="cb-conta" className={`${campo} w-full sm:w-auto sm:max-w-[440px]`} value={conta} onChange={e => setConta(e.target.value)}>
                <option value="">Escolha a conta…</option>
                {contas.map(c => <option key={c.agn_id} value={c.agn_id}>{c.agn_id} · {c.nome}{c.pendentes ? ` (${fmtN(c.pendentes)} pendentes)` : ''}</option>)}
              </select>
              <input aria-label="Data inicial" type="date" className={campo} value={periodo.ini} onChange={e => setPeriodo(p => ({ ...p, ini: e.target.value }))} />
              <span className={muted}>a</span>
              <input aria-label="Data final" type="date" className={campo} value={periodo.fim} onChange={e => setPeriodo(p => ({ ...p, fim: e.target.value }))} />
              <button className={btnSec} disabled={!conta || carregando} onClick={() => carregarConf()}>{carregando ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Conferir</button>
            </div>
          </div>
          {erroConf && <Aviso tipo="err">{erroConf}</Aviso>}
          {!conta && <div className={`${card} p-8 text-center ${muted}`}>Escolha a conta, ou importe um extrato acima, para ver o que falta conciliar.</div>}
          {conta && carregando && !conf && <div className={`${card} p-8 text-center ${muted}`}><Loader2 className="inline animate-spin mr-2" size={16} />Conferindo com o MEGA…</div>}
          {conf && <Conferencia conf={conf} recarregar={() => carregarConf()} />}
        </section>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ arquivo
function ZonaArquivo({ lendo, onArquivo }) {
  const [sobre, setSobre] = useState(false);
  const inp = useRef(null);
  const pegar = f => { if (f) onArquivo(f); };
  return (
    <div role="button" tabIndex={0} aria-label="Selecionar arquivo de extrato"
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.current?.click(); } }}
      onClick={() => inp.current?.click()}
      onDragOver={e => { e.preventDefault(); setSobre(true); }} onDragLeave={() => setSobre(false)}
      onDrop={e => { e.preventDefault(); setSobre(false); pegar(e.dataTransfer.files?.[0]); }}
      className={`${card} cursor-pointer px-6 py-12 text-center transition border-dashed ${sobre ? 'border-[var(--cb-prim)] bg-[var(--cb-soft)]' : ''} focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cb-prim)]`}>
      <input ref={inp} type="file" accept=".ret,.RET,.txt" className="hidden" onChange={e => pegar(e.target.files?.[0])} />
      {lendo ? <Loader2 className="mx-auto animate-spin" size={28} /> : <Upload className="mx-auto" size={28} style={{ color: 'var(--cb-prim)' }} />}
      <div className="mt-3 font-medium">{lendo ? 'Lendo e conferindo o arquivo…' : 'Arraste o arquivo do extrato ou clique para selecionar'}</div>
      <div className={`text-sm ${muted} mt-1`}>Extrato de conciliação CNAB 240 (.RET), segmento E — Itaú e demais bancos no padrão FEBRABAN.</div>
      <div className={`text-xs ${muted} mt-1`}>O arquivo é lido no seu navegador; nada é gravado sem a sua confirmação.</div>
    </div>
  );
}

const SIT = { nova: ['nova', 'var(--cb-ok)'], ja: ['já está no Mega', 'var(--cb-muted)'], erro: ['erro', 'var(--cb-err)'], fora: ['não importa', 'var(--cb-muted)'], importada: ['importada', 'var(--cb-ok)'] };

function BlocoConta({ c, filiais, fil, setFil, prep, imp, onEscolher, onValidar, onImportar }) {
  const [verLinhas, setVerLinhas] = useState(false);
  const [filtroSit, setFiltroSit] = useState('todas');
  const R = c.resumo;
  const linhas = c.linhas.filter(l => filtroSit === 'todas' || l.situacao === filtroSit);
  const contaOk = !!c.escolhida;
  const podeValidar = contaOk && fil && R.novas > 0 && !prep?.rodando && imp?.status !== 'I';
  const podeImportar = prep?.status === 'P' && /Nada foi gravado/.test(prep.mensagem || '') && !imp?.rodando && imp?.status !== 'I';
  return (
    <div className={`${card} p-5 space-y-5`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Landmark size={20} className="mt-0.5" style={{ color: 'var(--cb-prim)' }} />
          <div>
            <div className={`text-xs ${muted}`}>Agência {c.agencia} · Conta {String(c.conta).replace(/^0+/, '')}-{c.dv} · {c.titular}</div>
            {contaOk && <div className="font-medium">{c.escolhida.agn} · {c.escolhida.nome}</div>}
            {!contaOk && c.candidatas.length > 1 && (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="text-sm" style={{ color: 'var(--cb-warn)' }}>Mais de uma conta do Mega tem esta agência e conta. Confirme:</span>
                <select className={`${campo} max-w-full`} defaultValue="" onChange={e => e.target.value && onEscolher(Number(e.target.value))}>
                  <option value="">Escolha…</option>
                  {c.candidatas.map(x => <option key={x.agn} value={x.agn}>{x.agn} · {x.nome}</option>)}
                </select>
              </div>
            )}
            {!contaOk && c.candidatas.length === 0 && <div className="text-sm mt-1" style={{ color: 'var(--cb-err)' }}>Conta não encontrada no cadastro de contas financeiras ativas do Mega para este banco.</div>}
          </div>
        </div>
        {contaOk && (
          <div className="flex items-center gap-2">
            <label className={`text-xs ${muted}`} htmlFor={`fil-${c.agencia}-${c.conta}`}>Filial</label>
            <select id={`fil-${c.agencia}-${c.conta}`} className={`${campo} max-w-[calc(100vw-7rem)] sm:max-w-md`} value={fil} onChange={e => setFil(e.target.value)}>
              <option value="">Escolha…</option>
              {filiais.map(f => <option key={f.fil} value={f.fil}>{f.fil} · {f.nome}{c.filiais?.sugerida === f.fil ? ' (usada nesta conta)' : ''}</option>)}
            </select>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 2xl:grid-cols-7 gap-3">
        <Numero rotulo="Movimentos" valor={fmtN(R.lancamentos)} sub={`${fmtBr(R.periodo.ini)} a ${fmtBr(R.periodo.fim)}`} />
        <Numero rotulo="Créditos" valor={fmt(R.creditos)} cor="var(--cb-ok)" />
        <Numero rotulo="Débitos" valor={fmt(R.debitos)} cor="var(--cb-err)" />
        <Numero rotulo="Saldo inicial" valor={R.saldo_inicial ? fmt(R.saldo_inicial.valor) : '—'} sub={R.saldo_inicial ? fmtBr(R.saldo_inicial.data) : null} />
        <Numero rotulo="Saldo final" valor={R.saldo_final ? fmt(R.saldo_final.valor) : '—'} sub={R.saldo_final ? fmtBr(R.saldo_final.data) : null} />
        <Numero rotulo="Novas" valor={fmtN(R.novas)} sub={`${fmtN(R.ja_importadas)} já no Mega`} cor="var(--cb-ok)" />
        <Numero rotulo="Atenção" valor={fmtN(R.erros + R.repetidas)} sub={`${fmtN(R.erros)} erro(s) · ${fmtN(R.repetidas)} repetida(s)`} cor={R.erros ? 'var(--cb-err)' : undefined} />
      </div>

      <div className="space-y-2">
        {c.arquivo_ja_importado.map((x, i) => (
          <Aviso key={i} tipo="warn">{x.origem === 'gestor'
            ? `Este mesmo arquivo já foi importado nesta conta pelo Gestor em ${fmtBr(x.em)} ${String(x.em).slice(11)} (${x.por}).`
            : `Um arquivo com este nome já foi importado nesta conta pelo Mega em ${fmtBr(x.em)} (${fmtN(x.linhas)} linha(s)). As linhas que aparecem como novas não estão no Mega hoje: podem ter sido apagadas de propósito — confira antes de importar.`}</Aviso>
        ))}
        {!R.lotes_fecham && <Aviso tipo="warn">Saldo inicial + créditos − débitos não fecha com o saldo final em algum lote do arquivo. O arquivo pode estar incompleto.</Aviso>}
        {R.erros > 0 && <Aviso tipo="err">{fmtN(R.erros)} linha(s) com erro não serão importadas (tipo de documento sem cadastro no Mega, data ou valor inválido).</Aviso>}
        {R.repetidas > 0 && <Aviso tipo="info">{fmtN(R.repetidas)} linha(s) se repetem dentro do próprio arquivo (mesma data, valor e histórico). Elas são importadas na quantidade que o banco enviou.</Aviso>}
      </div>

      <div>
        <button className={`text-sm ${muted} inline-flex items-center gap-1 hover:text-[var(--cb-text)]`} onClick={() => setVerLinhas(v => !v)} aria-expanded={verLinhas}>
          {verLinhas ? <ChevronDown size={15} /> : <ChevronRight size={15} />} Ver as {fmtN(c.linhas.length)} linhas do arquivo
        </button>
        {verLinhas && (
          <div className="mt-3 space-y-2">
            <div className="flex flex-wrap gap-1" role="tablist" aria-label="Filtrar linhas do arquivo">
              {['todas', 'nova', 'ja', 'erro', 'fora'].map(s => (
                <button key={s} role="tab" aria-selected={filtroSit === s} className={`px-3 py-1 rounded-full text-xs border ${filtroSit === s ? 'bg-[var(--cb-soft)] border-[var(--cb-prim)]' : 'border-[var(--cb-line)]'}`} onClick={() => setFiltroSit(s)}>
                  {s === 'todas' ? 'Todas' : SIT[s][0]} · {fmtN(s === 'todas' ? c.linhas.length : c.linhas.filter(l => l.situacao === s).length)}
                </button>
              ))}
            </div>
            <div className="overflow-x-auto rounded-xl border border-[var(--cb-line)]">
              <table className="w-full text-sm min-w-[860px]">
                <thead className={`text-xs ${muted} bg-[var(--cb-soft)]`}><tr>
                  <th className="text-left px-3 py-2">Situação</th><th className="text-left px-3 py-2">Data</th><th className="text-left px-3 py-2">Histórico</th>
                  <th className="text-left px-3 py-2">Documento</th><th className="text-left px-3 py-2">Tipo</th><th className="text-right px-3 py-2">Valor</th><th className="text-left px-3 py-2">Observação</th>
                </tr></thead>
                <tbody>{linhas.map(l => (
                  <tr key={l.ordem} className="border-t border-[var(--cb-line)]">
                    <td className="px-3 py-2"><Chip cor={SIT[l.situacao]?.[1]}>{SIT[l.situacao]?.[0] || l.situacao}</Chip></td>
                    <td className="px-3 py-2 tabular-nums">{fmtBr(l.data)}</td>
                    <td className="px-3 py-2">{l.historico}</td>
                    <td className={`px-3 py-2 font-mono text-xs ${muted}`}>{String(l.documento || '').trim() || '—'}</td>
                    <td className="px-3 py-2 text-xs">{l.tpd || '—'} <span className={muted}>({l.categoria})</span></td>
                    <td className="px-3 py-2 text-right tabular-nums" style={{ color: l.natureza === 'C' ? 'var(--cb-ok)' : 'var(--cb-err)' }}>{l.natureza === 'C' ? '+' : '−'} {fmt(l.valor)}</td>
                    <td className={`px-3 py-2 text-xs ${muted}`}>{l.motivo}{l.repetida_no_arquivo ? ` · repete ${l.repetida_no_arquivo}× no arquivo` : ''}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-[var(--cb-line)]">
        <div className="pt-4 flex flex-wrap items-center gap-3">
          <button className={btnSec} disabled={!podeValidar} onClick={onValidar}>{prep?.rodando ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Validar no Mega</button>
          <button className={btnPrim} disabled={!podeImportar} onClick={() => { if (window.confirm(`Importar ${fmtN(prep.novas)} linha(s) no Mega na conta ${c.escolhida.agn}, filial ${fil}? A gravação é tudo ou nada.`)) onImportar(); }}>
            {imp?.rodando ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} Importar {podeImportar ? `${fmtN(prep.novas)} linha(s)` : ''}
          </button>
          {!R.novas && contaOk && <span className={`text-sm ${muted}`}>Nada novo para importar: todas as linhas já estão no Mega.</span>}
        </div>
        <div className="w-full space-y-2">
          {prep && !prep.rodando && <Aviso tipo={prep.status === 'X' ? 'err' : 'ok'}>{prep.mensagem}</Aviso>}
          {imp && !imp.rodando && <Aviso tipo={imp.status === 'I' ? 'ok' : 'err'}>{imp.mensagem}{imp.status === 'I' ? ' A conferência abaixo já mostra a conta e o período do arquivo.' : ''}</Aviso>}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ conferência
const megaDe = i => {
  if (i.movs?.length) { const m = i.movs; return { doc: m.length > 1 ? `${m.length} lançamentos` : `Lanç. ${m[0].lancto} · ${m[0].tpd}`, quem: m.length > 1 ? 'lote do retorno' : m[0].contraparte, valor: r2(m.reduce((s, x) => s + Number(x.vl || 0), 0)), data: m[0].data }; }
  if (i.titulos?.length) { const t = i.titulos; return { doc: t.map(x => `${x.doc}/${x.parcela}`).join(', '), quem: t[0].agn_nome, valor: r2(t.reduce((s, x) => s + Number(x.valor || 0) + Number(x.juros || 0) + Number(x.multa || 0), 0)), data: t[0].venc }; }
  if (i.candidatos_mov?.length) { const m = i.candidatos_mov[0]; return { doc: `${i.candidatos_mov.length} candidato(s)`, quem: m.contraparte, valor: m.vl, data: m.data }; }
  if (i.candidatos?.length) { const t = i.candidatos[0]; return { doc: `${i.candidatos.length} título(s) próximo(s)`, quem: t.agn_nome, valor: t.saldo, data: t.venc }; }
  if (i.depara) return { doc: i.depara.historico || i.depara.tpd, quem: i.depara.agn_nome || '', valor: null, data: null };
  return { doc: '—', quem: '', valor: null, data: null };
};

function Conferencia({ conf, recarregar }) {
  const itens = conf.itens || [];
  const [cat, setCat] = useState('todas');
  const [busca, setBusca] = useState('');
  const [tpd, setTpd] = useState('');
  const [dc, setDc] = useState('');
  const [vmin, setVmin] = useState(''); const [vmax, setVmax] = useState('');
  const [aberto, setAberto] = useState(null);
  const [sel, setSel] = useState(() => new Set(itens.filter(i => conciliavel(i) && i.selecionado).map(i => i.id)));
  const [manual, setManual] = useState({});     // item.id -> { movs:[{seq,lancto,vl}], tipo:'M' }
  const [painel, setPainel] = useState(null);   // item para conciliação manual
  const [modal, setModal] = useState(false);
  useEffect(() => { setSel(new Set(itens.filter(i => conciliavel(i) && i.selecionado).map(i => i.id))); setManual({}); }, [conf]); // eslint-disable-line react-hooks/exhaustive-deps

  const porCat = useMemo(() => { const m = {}; itens.forEach(i => { const k = catDe(i); m[k] = (m[k] || 0) + 1; }); return m; }, [itens]);
  const tpds = useMemo(() => [...new Set(itens.map(i => i.linhas[0]?.tpd).filter(Boolean))].sort(), [itens]);
  const filtrados = useMemo(() => {
    const q = busca.trim().toUpperCase(), mn = vmin === '' ? null : Number(vmin), mx = vmax === '' ? null : Number(vmax);
    const lista = itens.filter(i => (cat === 'todas' || catDe(i) === cat) && (!tpd || i.linhas[0]?.tpd === tpd) && (!dc || i.linhas[0]?.natureza === dc)
      && (mn == null || i.valor_banco >= mn) && (mx == null || i.valor_banco <= mx)
      && (!q || JSON.stringify([i.linhas.map(l => [l.historico, l.documento]), megaDe(i)]).toUpperCase().includes(q)));
    // ordem: categoria (automatica primeiro), depois data e valor
    const ord = Object.fromEntries(CATS.map((c, k) => [c.k, k]));
    return lista.sort((a, b) => (ord[catDe(a)] - ord[catDe(b)]) || String(a.data).localeCompare(String(b.data)) || (b.valor_banco - a.valor_banco));
  }, [itens, cat, busca, tpd, dc, vmin, vmax]);
  const pendTotal = itens.filter(i => i.situacao !== 'informativo');
  const prontos = itens.filter(i => ['auto', 'confirmar'].includes(catDe(i)));
  const diverg = itens.filter(i => catDe(i) === 'divergente');
  const selecionaveis = id => { const i = itens.find(x => x.id === id); return i && (conciliavel(i) && ((i.movs || []).length || manual[i.id])); };
  const pares = [...sel].filter(selecionaveis).map(id => { const i = itens.find(x => x.id === id); const m = manual[id];
    return { ref: id, tipo: m ? 'M' : 'A', cbas: i.linhas.map(l => l.cba), movs: (m ? m.movs : i.movs).map(x => ({ seq: x.seq, lancto: x.lancto })), valor: i.valor_banco, item: i }; });
  const somaSel = r2(pares.reduce((s, p) => s + p.valor, 0));
  const somaFiltro = r2(filtrados.reduce((s, i) => s + i.valor_banco, 0));
  const alternar = i => setSel(s => { const n = new Set(s); n.has(i.id) ? n.delete(i.id) : n.add(i.id); return n; });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Numero rotulo="Movimentos pendentes" valor={fmtN(pendTotal.length)} sub={fmt(pendTotal.reduce((s, i) => s + i.valor_banco, 0))} />
        <Numero rotulo="Já conciliados no período" valor={fmtN(conf.ja_conciliadas?.linhas)} sub={fmt(conf.ja_conciliadas?.valor)} cor="var(--cb-ok)" />
        <Numero rotulo="Prontos para conciliar" valor={fmtN(prontos.length)} sub={`${fmtN(porCat.auto || 0)} automáticos · ${fmtN(porCat.confirmar || 0)} a confirmar`} cor="var(--cb-ok)" />
        <Numero rotulo="Divergências" valor={fmtN(diverg.length)} sub={`${fmtN(porCat.sem || 0)} sem correspondência`} cor={diverg.length ? 'var(--cb-warn)' : undefined} />
      </div>
      {conf.mega_sem_extrato?.qt > 0 && <Aviso tipo="info">{fmtN(conf.mega_sem_extrato.qt)} lançamento(s) do Mega nesta conta e período ({fmt(conf.mega_sem_extrato.valor)}) ainda não têm linha do extrato correspondente. Se o banco já movimentou, falta importar o extrato daquele dia.</Aviso>}

      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Categorias">
        {[{ k: 'todas', t: 'Todas' }, ...CATS].map(c => (
          <button key={c.k} role="tab" aria-selected={cat === c.k} title={c.d} onClick={() => setCat(c.k)}
            className={`shrink-0 px-3.5 py-1.5 rounded-full text-sm border transition ${cat === c.k ? 'bg-[var(--cb-soft)] border-[var(--cb-prim)]' : 'border-[var(--cb-line)] hover:bg-[var(--cb-soft)]'}`}>
            {c.cor && <span className="inline-block w-1.5 h-1.5 rounded-full mr-2 align-middle" style={{ background: c.cor }} />}{c.t} <span className={muted}>{fmtN(c.k === 'todas' ? itens.length : porCat[c.k] || 0)}</span>
          </button>
        ))}
      </div>

      <div className={`${card} p-3 flex flex-wrap items-center gap-2`}>
        <div className="flex items-center gap-2 flex-1 min-w-[220px]">
          <Search size={15} className={muted} />
          <input aria-label="Buscar no histórico, documento ou cliente/fornecedor" className="bg-transparent outline-none text-sm w-full" placeholder="Histórico, documento, cliente ou fornecedor…" value={busca} onChange={e => setBusca(e.target.value)} />
        </div>
        <select aria-label="Tipo de documento" className={campo} value={tpd} onChange={e => setTpd(e.target.value)}><option value="">Todos os tipos</option>{tpds.map(t => <option key={t}>{t}</option>)}</select>
        <select aria-label="Débito ou crédito" className={campo} value={dc} onChange={e => setDc(e.target.value)}><option value="">Débito e crédito</option><option value="D">Saídas</option><option value="C">Entradas</option></select>
        <input aria-label="Valor mínimo" className={`${campo} w-28`} inputMode="decimal" placeholder="Valor de" value={vmin} onChange={e => setVmin(e.target.value.replace(',', '.'))} />
        <input aria-label="Valor máximo" className={`${campo} w-28`} inputMode="decimal" placeholder="até" value={vmax} onChange={e => setVmax(e.target.value.replace(',', '.'))} />
        <button className={btnSec} onClick={recarregar}><RefreshCw size={14} /></button>
      </div>
      <div className={`text-xs ${muted}`}>Mostrando {fmtN(filtrados.length)} de {fmtN(itens.length)} · {fmt(somaFiltro)} nos filtros (total geral do período: {fmt(itens.reduce((s, i) => s + i.valor_banco, 0))})</div>

      <div className={`${card} overflow-x-auto`}>
        <table className="w-full text-sm min-w-[1080px]">
          <thead className={`text-xs ${muted}`}><tr className="border-b border-[var(--cb-line)]">
            <th className="w-10 px-2 py-3" aria-label="Selecionar" /><th className="text-left px-2 py-3">Status</th><th className="text-left px-2 py-3">Data</th>
            <th className="text-left px-2 py-3 min-w-[200px]">Histórico do banco</th><th className="text-left px-2 py-3">Tipo</th><th className="text-right px-2 py-3">Valor banco</th>
            <th className="text-left px-2 py-3">Documento / título no MEGA</th><th className="text-left px-2 py-3">Cliente / fornecedor</th>
            <th className="text-right px-2 py-3">Valor MEGA</th><th className="text-right px-2 py-3">Diferença</th><th className="text-left px-2 py-3">Ação</th>
          </tr></thead>
          <tbody>
            {filtrados.length === 0 && <tr><td colSpan={11} className={`text-center py-10 ${muted}`}>Nada nesta categoria.</td></tr>}
            {filtrados.map(i => {
              const c = CATS.find(x => x.k === catDe(i)), l = i.linhas[0], mg = megaDe(i), m = manual[i.id];
              const vMega = m ? r2(m.movs.reduce((s, x) => s + x.vl, 0)) : mg.valor;
              const dif = vMega == null ? null : r2(i.valor_banco - vMega);
              const podeSel = conciliavel(i) && ((i.movs || []).length || m);
              return (
                <React.Fragment key={i.id}>
                  <tr className="border-t border-[var(--cb-line)] hover:bg-[var(--cb-soft)]">
                    <td className="px-2 py-2.5 text-center">
                      {podeSel ? <input type="checkbox" aria-label="Selecionar para conciliar" checked={sel.has(i.id)} onChange={() => alternar(i)} className="accent-[var(--cb-prim)] w-4 h-4" /> : null}
                    </td>
                    <td className="px-2 py-2.5"><Chip cor={c?.cor} title={c?.d}>{m ? 'Par escolhido' : c?.c}</Chip></td>
                    <td className="px-2 py-2.5 tabular-nums">{fmtBr(l.data)}</td>
                    <td className="px-2 py-2.5">
                      <button className="text-left inline-flex items-start gap-1 hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--cb-prim)] rounded" onClick={() => setAberto(a => (a === i.id ? null : i.id))} aria-expanded={aberto === i.id}>
                        {aberto === i.id ? <ChevronDown size={14} className="mt-0.5 shrink-0" /> : <ChevronRight size={14} className="mt-0.5 shrink-0" />}
                        <span>{l.historico}{i.linhas.length > 1 ? ` (+${i.linhas.length - 1})` : ''}<span className={`block text-xs ${muted} font-mono`}>{String(l.documento || '').trim() || ''}</span></span>
                      </button>
                    </td>
                    <td className="px-2 py-2.5 text-xs">{l.tpd || '—'}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums whitespace-nowrap" style={{ color: l.natureza === 'C' ? 'var(--cb-ok)' : 'var(--cb-err)' }}>{l.natureza === 'C' ? '+' : '−'} {fmt(i.valor_banco)}</td>
                    <td className="px-2 py-2.5 text-xs">{m ? `${m.movs.length} lançamento(s) escolhido(s)` : mg.doc}</td>
                    <td className="px-2 py-2.5 text-xs max-w-[170px] truncate" title={mg.quem}>{m ? '' : mg.quem}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums">{vMega == null ? '—' : fmt(vMega)}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums" style={{ color: dif ? 'var(--cb-err)' : 'var(--cb-muted)' }}>{dif == null ? '—' : dif ? fmt(dif) : 'zero'}</td>
                    <td className="px-2 py-2.5 whitespace-nowrap"><AcaoItem item={i} cat={catDe(i)} manual={m} onManual={() => setPainel(i)} /></td>
                  </tr>
                  {aberto === i.id && (
                    <tr className="bg-[var(--cb-soft)]"><td colSpan={11} className="px-6 py-4"><DetalheItem item={i} /></td></tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {pares.length > 0 && (
        <div className="sticky bottom-4 z-20">
          <div className={`${card} shadow-xl px-5 py-3 flex flex-wrap items-center justify-between gap-3`}>
            <div className="text-sm"><b>{fmtN(pares.length)}</b> selecionado(s) · {fmt(somaSel)} <span className={muted}>· {fmtN(pares.filter(p => p.tipo === 'M').length)} escolhido(s) à mão</span></div>
            <div className="flex gap-2">
              <button className={btnSec} onClick={() => setSel(new Set())}>Limpar</button>
              <button className={btnPrim} onClick={() => setModal(true)}><Link2 size={15} /> Conciliar selecionados</button>
            </div>
          </div>
        </div>
      )}

      {painel && <PainelManual item={painel} conta={conf.conta.agn_id} onFechar={() => setPainel(null)}
        onEscolher={movs => { setManual(x => ({ ...x, [painel.id]: { movs, tipo: 'M' } })); setSel(s => new Set(s).add(painel.id)); setPainel(null); }} />}
      {modal && <ModalConciliar pares={pares} pendentes={pendTotal.length} divergencias={diverg.length} jaConciliadas={conf.ja_conciliadas?.linhas || 0}
        onFechar={feito => { setModal(false); if (feito) recarregar(); }} />}
    </div>
  );
}

function AcaoItem({ item, cat, manual, onManual }) {
  const link = 'text-xs inline-flex items-center gap-1 hover:underline';
  if (cat === 'auto' || cat === 'confirmar') return <span className={`text-xs ${muted}`}>{cat === 'auto' ? 'Conciliar' : 'Confirmar e conciliar'}</span>;
  if (cat === 'baixa') return <Link className={link} style={{ color: 'var(--cb-info)' }} to="/baixas-conciliacao/baixar">Baixar e conciliar <ArrowRight size={12} /></Link>;
  if (cat === 'lancar') return <Link className={link} style={{ color: 'var(--cb-info)' }} to="/baixas-conciliacao/baixar">Lançar no Mega <ArrowRight size={12} /></Link>;
  if (cat === 'info') return <span className={`text-xs ${muted}`}>Só informativo</span>;
  if (!conciliavel(item) && cat === 'divergente') return <Link className={link} style={{ color: 'var(--cb-warn)' }} to="/baixas-conciliacao/baixar">Escolher o título <ArrowRight size={12} /></Link>;
  return <button className={link} style={{ color: 'var(--cb-warn)' }} onClick={onManual}>{manual ? 'Trocar o lançamento' : conciliavel(item) ? 'Escolher o lançamento' : 'Conciliar à mão'}</button>;
}

function DetalheItem({ item }) {
  const l = item.linhas;
  return (
    <div className="grid md:grid-cols-2 gap-6 text-sm">
      <div>
        <div className={`text-xs uppercase tracking-wide ${muted} mb-2`}>No extrato do banco</div>
        {l.map(x => (
          <div key={x.cba} className="mb-1.5">{fmtBr(x.data)} · {x.historico} · <span className="tabular-nums">{fmt(x.valor)}</span> {x.natureza === 'C' ? 'crédito' : 'débito'}
            <span className={`block text-xs ${muted}`}>linha {x.cba} · tipo {x.tpd || '—'} · documento {String(x.documento || '').trim() || '—'} · arquivo {x.arquivo || '—'}</span></div>
        ))}
      </div>
      <div>
        <div className={`text-xs uppercase tracking-wide ${muted} mb-2`}>No MEGA</div>
        {(item.movs || []).map(m => <div key={m.lancto} className="mb-1.5">Lançamento {m.lancto} · {fmtBr(m.data)} · {m.tpd} · <span className="tabular-nums">{fmt(m.vl)}</span>
          <span className={`block text-xs ${muted}`}>{m.contraparte || 'sem cliente/fornecedor ligado'} · documento {m.doc || '—'}</span></div>)}
        {(item.titulos || []).map(t => <div key={t.id} className="mb-1.5">Título {t.doc}/{t.parcela} · {t.agn_nome} · venc. {fmtBr(t.venc)} · saldo <span className="tabular-nums">{fmt(t.saldo)}</span>
          {(t.juros || t.multa || t.desconto) ? <span className={`block text-xs ${muted}`}>juros {fmt(t.juros)} · multa {fmt(t.multa)} · desconto {fmt(t.desconto)}</span> : null}</div>)}
        {(item.candidatos_mov || []).map(m => <div key={m.lancto} className={`mb-1 text-xs ${muted}`}>Candidato: lançamento {m.lancto} · {fmtBr(m.data)} · {m.tpd} · {fmt(m.vl)} · {m.contraparte || '—'}</div>)}
        {(item.candidatos || []).map(t => <div key={t.id} className={`mb-1 text-xs ${muted}`}>Título próximo: {t.doc}/{t.parcela} · {t.agn_nome} · saldo {fmt(t.saldo)} · venc. {fmtBr(t.venc)}</div>)}
        {item.depara && <div className={`text-xs ${muted}`}>De-para: {item.depara.historico || item.depara.tpd} · classe {item.depara.classe || '—'} · ação {item.depara.acao}</div>}
        <div className="mt-3 text-xs" style={{ color: 'var(--cb-muted)' }}>Por quê: {item.motivo}</div>
      </div>
    </div>
  );
}

// conciliação manual: a linha do banco à esquerda, os lançamentos do Mega à direita; só confirma com diferença zero
function PainelManual({ item, conta, onFechar, onEscolher }) {
  const [dados, setDados] = useState(null); const [erro, setErro] = useState(''); const [dias, setDias] = useState(10);
  const [marc, setMarc] = useState({}); const [q, setQ] = useState('');
  useEffect(() => { setDados(null); api.cbCandidatos({ conta, cba: item.linhas[0].cba, dias }).then(setDados).catch(e => setErro(e.message)); }, [item, conta, dias]);
  useEffect(() => { const f = e => { if (e.key === 'Escape') onFechar(); }; window.addEventListener('keydown', f); return () => window.removeEventListener('keydown', f); }, [onFechar]);
  const movs = (dados?.movs || []).filter(m => !q || JSON.stringify(m).toUpperCase().includes(q.toUpperCase()));
  const escolhidos = (dados?.movs || []).filter(m => marc[`${m.seq}.${m.lancto}`]);
  const soma = r2(escolhidos.reduce((s, m) => s + m.valor, 0)), alvo = r2(item.valor_banco), dif = r2(alvo - soma);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onFechar}>
      <aside role="dialog" aria-modal="true" aria-label="Conciliar à mão" onClick={e => e.stopPropagation()} className="w-full max-w-3xl h-full overflow-y-auto bg-[var(--cb-card)] text-[var(--cb-text)] border-l border-[var(--cb-line)] p-6 space-y-5">
        <div className="flex items-start justify-between">
          <div><h3 className="text-xl font-semibold">Conciliar à mão</h3><p className={`text-sm ${muted}`}>Escolha o(s) lançamento(s) do MEGA que correspondem a esta linha do banco.</p></div>
          <button className={btnSec} onClick={onFechar} aria-label="Fechar"><X size={15} /></button>
        </div>
        <div className={`${card} p-4 text-sm`}>
          <div className={`text-xs ${muted}`}>Linha do banco</div>
          <div className="font-medium mt-1">{fmtBr(item.linhas[0].data)} · {item.linhas[0].historico}</div>
          <div className="tabular-nums mt-1" style={{ color: item.linhas[0].natureza === 'C' ? 'var(--cb-ok)' : 'var(--cb-err)' }}>{item.linhas[0].natureza === 'C' ? 'Crédito' : 'Débito'} de {fmt(alvo)} · tipo {item.linhas[0].tpd}</div>
        </div>
        {erro && <Aviso tipo="err">{erro}</Aviso>}
        <div className="flex flex-wrap items-center gap-2">
          <input className={`${campo} flex-1 min-w-[200px]`} placeholder="Filtrar candidatos…" value={q} onChange={e => setQ(e.target.value)} aria-label="Filtrar candidatos" />
          <label className={`text-xs ${muted}`} htmlFor="cb-dias">Janela</label>
          <select id="cb-dias" className={campo} value={dias} onChange={e => setDias(Number(e.target.value))}>{[3, 5, 10, 20, 45].map(d => <option key={d} value={d}>± {d} dias</option>)}</select>
        </div>
        {!dados && !erro && <div className={muted}><Loader2 className="inline animate-spin mr-2" size={14} />Buscando lançamentos…</div>}
        {dados && (
          <div className="rounded-xl border border-[var(--cb-line)] overflow-hidden">
            <table className="w-full text-sm">
              <thead className={`text-xs ${muted} bg-[var(--cb-soft)]`}><tr><th className="w-8" /><th className="text-left px-2 py-2">Data</th><th className="text-left px-2 py-2">Lançamento</th><th className="text-left px-2 py-2">Cliente / fornecedor</th><th className="text-right px-2 py-2">Valor</th><th className="text-right px-2 py-2">Dif.</th></tr></thead>
              <tbody>{movs.map(m => { const k = `${m.seq}.${m.lancto}`; return (
                <tr key={k} className="border-t border-[var(--cb-line)] hover:bg-[var(--cb-soft)] cursor-pointer" onClick={() => setMarc(x => ({ ...x, [k]: !x[k] }))}>
                  <td className="px-2 py-2 text-center"><input type="checkbox" aria-label={`Lançamento ${m.lancto}`} checked={!!marc[k]} readOnly className="accent-[var(--cb-prim)]" /></td>
                  <td className="px-2 py-2 tabular-nums">{fmtBr(m.data)} <span className={`text-xs ${muted}`}>{m.dif_dias ? `${m.dif_dias > 0 ? '+' : ''}${m.dif_dias}d` : ''}</span></td>
                  <td className="px-2 py-2 text-xs">{m.lancto} · {m.tpd}{m.tipo_compativel ? '' : <span style={{ color: 'var(--cb-warn)' }}> · tipo fora do padrão</span>}<span className={`block ${muted}`}>{m.documento}</span></td>
                  <td className="px-2 py-2 text-xs max-w-[220px] truncate" title={m.contraparte}>{m.contraparte || '—'}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmt(m.valor)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-xs whitespace-nowrap" style={{ color: m.dif_valor ? 'var(--cb-muted)' : 'var(--cb-ok)' }}>{m.dif_valor ? fmt(m.dif_valor) : 'igual'}</td>
                </tr>); })}</tbody>
            </table>
          </div>
        )}
        <div className={`${card} p-4 flex flex-wrap items-center justify-between gap-3 sticky bottom-0`}>
          <div className="text-sm">Escolhidos {fmt(soma)} · banco {fmt(alvo)} · <b style={{ color: dif ? 'var(--cb-err)' : 'var(--cb-ok)' }}>{dif ? `diferença de ${fmt(dif)}` : 'sem diferença'}</b>
            {dif !== 0 && escolhidos.length > 0 && <div className={`text-xs ${muted}`}>O MEGA só concilia somas iguais. Diferença de juros, desconto ou baixa parcial é resolvida em Baixar e conciliar.</div>}</div>
          <button className={btnPrim} disabled={!escolhidos.length || dif !== 0} onClick={() => onEscolher(escolhidos.map(m => ({ seq: m.seq, lancto: m.lancto, vl: m.valor })))}><CheckCircle2 size={15} /> Usar este par</button>
        </div>
      </aside>
    </div>
  );
}

// resumo -> validar (simula tudo) -> confirmar -> gravar, com progresso e resultado por par
function ModalConciliar({ pares: paresIniciais, pendentes, divergencias, jaConciliadas, onFechar }) {
  const [pares, setPares] = useState(paresIniciais);   // copia propria: depois da validacao so os aprovados seguem
  const [fase, setFase] = useState('resumo');   // resumo | validando | validado | gravando | fim
  const [res, setRes] = useState({});
  const [ciente, setCiente] = useState(false);
  const total = r2(pares.reduce((s, p) => s + p.valor, 0));
  const rodar = async (simular, lista = pares) => {
    setFase(simular ? 'validando' : 'gravando'); const out = {};
    for (let k = 0; k < lista.length; k += 10) {
      const lote = lista.slice(k, k + 10);
      try { const r = await api.cbConciliar({ simular, pares: lote.map(({ ref, tipo, cbas, movs }) => ({ ref, tipo, cbas, movs })) }); r.resultados.forEach(x => { out[x.ref] = x; }); }
      catch (e) { lote.forEach(p => { out[p.ref] = { status: 'X', mensagem: e.message || 'Falha de comunicação. Confira no Mega antes de repetir.' }; }); }
      setRes({ ...out });
    }
    setFase(simular ? 'validado' : 'fim');
  };
  const ok = Object.values(res).filter(r => r.status === (fase === 'fim' ? 'B' : 'S')).length, falhas = Object.values(res).filter(r => r.status === 'X');
  useEffect(() => { const f = e => { if (e.key === 'Escape' && !['validando', 'gravando'].includes(fase)) onFechar(fase === 'fim'); }; window.addEventListener('keydown', f); return () => window.removeEventListener('keydown', f); }, [fase, onFechar]);
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div role="dialog" aria-modal="true" aria-label="Conciliar selecionados" className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-[var(--cb-card)] text-[var(--cb-text)] rounded-2xl border border-[var(--cb-line)] p-6 space-y-5">
        <div className="flex items-start justify-between"><h3 className="text-xl font-semibold">Conciliar no MEGA</h3>
          <button className={btnSec} disabled={['validando', 'gravando'].includes(fase)} onClick={() => onFechar(fase === 'fim')} aria-label="Fechar"><X size={15} /></button></div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Numero rotulo="Serão conciliados" valor={fmtN(pares.length)} sub={fmt(total)} cor="var(--cb-ok)" />
          <Numero rotulo="Ficam pendentes" valor={fmtN(Math.max(0, pendentes - pares.length))} />
          <Numero rotulo="Divergências" valor={fmtN(divergencias)} cor={divergencias ? 'var(--cb-warn)' : undefined} />
          <Numero rotulo="Já processados (ignorados)" valor={fmtN(jaConciliadas)} sub="já conciliados no período" />
          <Numero rotulo="Escolhidos à mão" valor={fmtN(pares.filter(p => p.tipo === 'M').length)} sub="gravados como manuais" />
          <Numero rotulo="Automáticos" valor={fmtN(pares.filter(p => p.tipo === 'A').length)} sub="níveis 1 e 2" />
        </div>
        {fase === 'resumo' && <Aviso tipo="info">Primeiro eu valido cada par no MEGA sem gravar (conta, natureza, soma, período encerrado, se já foi conciliado). Depois você confirma.</Aviso>}
        {Object.keys(res).length > 0 && (
          <div className="space-y-1 max-h-56 overflow-y-auto text-sm">
            {pares.map(p => { const r = res[p.ref]; if (!r) return null; const bom = r.status === 'S' || r.status === 'B'; return (
              <div key={p.ref} className="flex items-start gap-2">{bom ? <CheckCircle2 size={15} style={{ color: 'var(--cb-ok)' }} className="mt-0.5" /> : <XCircle size={15} style={{ color: 'var(--cb-err)' }} className="mt-0.5" />}
                <span>{fmtBr(p.item.linhas[0].data)} · {p.item.linhas[0].historico} · {fmt(p.valor)} <span className={muted}>{bom ? (r.status === 'B' ? 'conciliado' : 'pode conciliar') : r.mensagem}</span></span></div>); })}
          </div>
        )}
        {fase === 'validado' && <>
          <Aviso tipo={falhas.length ? 'warn' : 'ok'}>{ok} par(es) passaram na validação{falhas.length ? `; ${falhas.length} foram recusados e ficam de fora` : ''}. Nada foi gravado ainda.</Aviso>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ciente} onChange={e => setCiente(e.target.checked)} className="accent-[var(--cb-prim)]" /> Confirmo a conciliação de {ok} par(es) no MEGA.</label>
        </>}
        {fase === 'fim' && <Aviso tipo={falhas.length ? 'warn' : 'ok'}>{ok} par(es) conciliado(s) no MEGA{falhas.length ? `; ${falhas.length} recusado(s) — veja o motivo acima` : ''}. A conciliação aparece na tela nativa do Mega e pode ser desfeita em Baixar e conciliar › Feitas.</Aviso>}
        <div className="flex justify-end gap-2">
          {fase === 'resumo' && <button className={btnPrim} onClick={() => rodar(true)}><CheckCircle2 size={15} /> Validar</button>}
          {['validando', 'gravando'].includes(fase) && <span className={`text-sm ${muted}`}><Loader2 className="inline animate-spin mr-2" size={14} />{fase === 'validando' ? 'Validando' : 'Gravando'} {Object.keys(res).length} de {pares.length}…</span>}
          {fase === 'validado' && <button className={btnPrim} disabled={!ciente || !ok} onClick={() => { const bons = pares.filter(p => res[p.ref]?.status === 'S'); setPares(bons); setRes({}); rodar(false, bons); }}><Link2 size={15} /> Conciliar {ok}</button>}
          {fase === 'fim' && <button className={btnPrim} onClick={() => onFechar(true)}>Concluir</button>}
        </div>
      </div>
    </div>
  );
}

function HistoricoImportacoes({ conta, onFechar }) {
  const [lista, setLista] = useState(null); const [erro, setErro] = useState('');
  useEffect(() => { api.cbArquivos(conta || '').then(r => setLista(r.arquivos)).catch(e => setErro(e.message)); }, [conta]);
  return (
    <div className={`${card} p-5 space-y-3`}>
      <div className="flex items-center justify-between"><h3 className="font-semibold">Importações feitas pelo Gestor{conta ? ` · conta ${conta}` : ''}</h3><button className={btnSec} onClick={onFechar} aria-label="Fechar"><X size={14} /></button></div>
      {erro && <Aviso tipo="err">{erro}</Aviso>}
      {!lista && !erro && <div className={muted}><Loader2 className="inline animate-spin mr-2" size={14} />Carregando…</div>}
      {lista && lista.length === 0 && <div className={`text-sm ${muted}`}>Nenhuma importação ainda.</div>}
      {lista && lista.length > 0 && (
        <div className="overflow-x-auto"><table className="w-full text-sm min-w-[760px]">
          <thead className={`text-xs ${muted}`}><tr><th className="text-left py-2">Quando</th><th className="text-left">Arquivo</th><th className="text-left">Conta</th><th className="text-left">Período</th><th className="text-right">Novas</th><th className="text-right">Já havia</th><th className="text-left pl-4">Situação</th></tr></thead>
          <tbody>{lista.map(a => (
            <tr key={a.id} className="border-t border-[var(--cb-line)]">
              <td className="py-2 tabular-nums">{fmtBr(a.em)} {String(a.em || '').slice(11)}<span className={`block text-xs ${muted}`}>{a.usuario}</span></td>
              <td>{a.nome}</td><td className="text-xs">{a.conta} · {a.conta_nome}<span className={`block ${muted}`}>filial {a.filial}</span></td>
              <td className="tabular-nums text-xs">{fmtBr(a.periodo.ini)} a {fmtBr(a.periodo.fim)}</td><td className="text-right">{fmtN(a.novas)}</td><td className="text-right">{fmtN(a.ja)}</td>
              <td className="pl-4 text-xs">{a.status === 'I' ? <Chip cor="var(--cb-ok)">importado</Chip> : <Chip cor="var(--cb-err)">recusado</Chip>}<span className={`block ${muted}`}>{a.mensagem}</span></td>
            </tr>))}</tbody>
        </table></div>
      )}
    </div>
  );
}
