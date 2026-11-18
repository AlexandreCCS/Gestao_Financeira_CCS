// [18/11/2026 - CRIADO POR ALEXANDRE CARVALHO] Baixas/Conciliação › CONCILIAÇÃO BANCÁRIA · CARTÃO (Quality).
// Pedido do Alexandre (18/11): cópia da tela da conciliação bancária, dividida por FILIAIS, importando os arquivos da Rede
// (extrato de vendas e relatório de recebimentos do portal da Rede). Esta primeira entrega é só o IMPORTADOR:
// 1) arquivo .xlsx da Rede (lido aqui no navegador, web/src/pages/baixas/rede.js) -> 2) /cbc/analisar: estabelecimento -> filial,
// já importado, repetidas, erros -> validar e importar por filial (/cbc/preparar + /cbc/arquivos/:id/importar, tudo ou nada).
// A conferência com o caixa das lojas e com o financeiro do Mega é a próxima etapa (Instruções/Quality_Conciliacao_Rede_Cartao.md).
import React, { useEffect, useRef, useState } from 'react';
import { Upload, CheckCircle2, AlertTriangle, XCircle, Loader2, ChevronDown, ChevronRight, Sun, Moon, History, X, Store, Info, FileSpreadsheet, CreditCard } from 'lucide-react';
import { api } from '../../api/client';
import { lerArquivoRede } from './rede';

const fmt = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtN = v => Number(v || 0).toLocaleString('pt-BR');
const fmtBr = s => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—');
const lerTema = () => { try { return localStorage.getItem('cb_tema') || 'escuro'; } catch { return 'escuro'; } };

// tokens da tela (mesmos da Conciliação bancária)
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
const ABA = { V: 'venda', P: 'pagamento', F: 'futuro', D: 'depósito', A: 'ajuste', C: 'cancelamento' };
const SIT = { nova: ['nova', 'var(--cb-ok)'], ja: ['já importada', 'var(--cb-muted)'], erro: ['erro', 'var(--cb-err)'], importada: ['importada', 'var(--cb-ok)'] };

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

export default function ConciliacaoCartao() {
  const [tema, setTema] = useState(lerTema);
  const [arq, setArq] = useState(null);         // { file, meta, ex, analise, escolhas, fil: {estab: fil}, prep: {}, imp: {} }
  const [lendo, setLendo] = useState(false);
  const [erroArq, setErroArq] = useState('');
  const [verHist, setVerHist] = useState(false);
  const [filHist, setFilHist] = useState('');
  const [filiais, setFiliais] = useState([]);
  const temaVars = TEMAS[tema];

  useEffect(() => { try { localStorage.setItem('cb_tema', tema); } catch { /* sem storage */ } }, [tema]);
  useEffect(() => { api.cbcFiliais().then(r => setFiliais(r.filiais || [])).catch(() => setFiliais([])); }, []);

  async function abrirArquivo(file, escolhas = {}) {
    setErroArq(''); setLendo(true);
    try {
      const buf = await file.arrayBuffer();
      const ex = lerArquivoRede(new Uint8Array(buf), file.name);
      const hashBuf = await crypto.subtle.digest('SHA-256', buf);
      const hash = [...new Uint8Array(hashBuf)].map(b => b.toString(16).padStart(2, '0')).join('');
      const meta = { nome: file.name, hash, tipo: ex.tipo, emissao: ex.emissao, periodo: ex.periodo };
      const analise = await api.cbcAnalisar({ arquivo: meta, estabs: ex.estabs, escolhas });
      const fil = {};
      analise.estabelecimentos.forEach(e => { fil[e.estab] = e.filial?.fil ? String(e.filial.fil) : ''; });
      setArq({ file, meta, ex, analise, escolhas, fil, prep: {}, imp: {} });
    } catch (e) { setArq(null); setErroArq(e.detalhe || e.message || 'Não foi possível ler o arquivo.'); }
    finally { setLendo(false); }
  }
  const escolherFilial = (estab, fil) => { setArq(a => ({ ...a, fil: { ...a.fil, [estab]: fil } })); };

  async function validar(estab) {
    const bloco = arq.ex.estabs.find(e => e.estab === estab), fil = Number(arq.fil[estab]);
    const cadastrada = arq.analise.estabelecimentos.find(e => e.estab === estab)?.filial;
    setArq(a => ({ ...a, prep: { ...a.prep, [estab]: { rodando: true } } }));
    try {
      let confirma = false;
      if (cadastrada?.origem === 'cadastro' && cadastrada.fil !== fil) {
        confirma = window.confirm(`O estabelecimento ${estab} está cadastrado na filial ${cadastrada.fil}. Trocar para a filial ${fil} daqui em diante?`);
        if (!confirma) { setArq(a => ({ ...a, prep: { ...a.prep, [estab]: null } })); return; }
      }
      const r = await api.cbcPreparar({ arquivo: arq.meta, estabs: [bloco], fil, confirma_filial_diferente: confirma });
      setArq(a => ({ ...a, prep: { ...a.prep, [estab]: r } }));
    } catch (e) { setArq(a => ({ ...a, prep: { ...a.prep, [estab]: { status: 'X', mensagem: e.detalhe || e.message } } })); }
  }
  async function importar(estab) {
    const id = arq.prep[estab]?.id;
    setArq(a => ({ ...a, imp: { ...a.imp, [estab]: { rodando: true } } }));
    try { const r = await api.cbcImportar(id); setArq(a => ({ ...a, imp: { ...a.imp, [estab]: r } })); }
    catch (e) { setArq(a => ({ ...a, imp: { ...a.imp, [estab]: { status: 'X', mensagem: e.detalhe || e.message } } })); }
  }

  const T = arq?.ex.totais;
  return (
    <div style={temaVars} className="bg-[var(--cb-bg)] text-[var(--cb-text)] px-4 py-6 sm:px-8 sm:py-8 min-h-[calc(100vh-3.5rem)]">
      <div className="max-w-[1400px] mx-auto space-y-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight flex items-center gap-3"><CreditCard size={28} style={{ color: 'var(--cb-prim)' }} /> Conciliação Bancária · Cartão</h1>
            <p className={`text-[15px] ${muted} mt-1`}>Importe os arquivos da Rede (vendas e recebimentos) por filial e confira com o caixa e o financeiro.</p>
          </div>
          <div className="flex items-center gap-2">
            <button className={btnSec} onClick={() => setVerHist(v => !v)} aria-expanded={verHist}><History size={15} /> Importações</button>
            <button className={btnSec} onClick={() => setTema(t => (t === 'escuro' ? 'claro' : 'escuro'))} aria-label="Alternar tema claro/escuro">{tema === 'escuro' ? <Sun size={15} /> : <Moon size={15} />}</button>
          </div>
        </header>

        {verHist && <HistoricoImportacoes filial={filHist} filiais={filiais} setFilial={setFilHist} onFechar={() => setVerHist(false)} />}

        {/* ------------------------------------------------ 1. arquivo */}
        <section aria-labelledby="cbc-imp" className="space-y-4">
          <h2 id="cbc-imp" className="text-lg font-semibold">1 · Arquivo da Rede</h2>
          {!arq && <ZonaArquivo lendo={lendo} onArquivo={f => abrirArquivo(f)} />}
          {erroArq && <Aviso tipo="err">{erroArq}</Aviso>}
          {arq && (
            <div className="space-y-4">
              <div className={`${card} px-5 py-3 flex flex-wrap items-center justify-between gap-3`}>
                <div className="flex items-center gap-3 min-w-0">
                  <FileSpreadsheet size={18} className={muted} />
                  <div className="min-w-0">
                    <div className="font-medium truncate">{arq.meta.nome}</div>
                    <div className={`text-xs ${muted}`}>{arq.ex.tipo_nome} · período {fmtBr(arq.ex.periodo?.ini)} a {fmtBr(arq.ex.periodo?.fim)} · emitido pela Rede em {fmtBr(arq.ex.emissao)} · {fmtN(arq.ex.linhas)} linha(s) em {arq.ex.abas.length} aba(s) · {fmtN(arq.analise.estabelecimentos.length)} estabelecimento(s)</div>
                  </div>
                </div>
                <button className={btnSec} onClick={() => setArq(null)}><X size={14} /> Outro arquivo</button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Numero rotulo={arq.ex.tipo === 'V' ? 'Vendas aprovadas / pagas' : 'Parcelas pagas'} valor={fmtN(T.aprovadas)} sub={`de ${fmtN(arq.ex.linhas)} linha(s) no arquivo`} />
                <Numero rotulo="Bruto" valor={fmt(T.bruto)} />
                <Numero rotulo={arq.ex.tipo === 'V' ? 'Taxas (MDR + antecipação)' : 'MDR descontado'} valor={fmt(T.taxas)} cor="var(--cb-err)" />
                <Numero rotulo="Líquido" valor={fmt(T.liquido)} cor="var(--cb-ok)" />
              </div>
              {arq.ex.invalidas > 0 && <Aviso tipo="warn">{fmtN(arq.ex.invalidas)} linha(s) sem data, valor ou estabelecimento válidos não serão importadas.</Aviso>}
              {arq.analise.estabelecimentos.map(e => (
                <BlocoFilial key={e.estab} e={e} tipo={arq.ex.tipo} filiais={arq.analise.filiais} fil={arq.fil[e.estab]} setFil={v => escolherFilial(e.estab, v)}
                  prep={arq.prep[e.estab]} imp={arq.imp[e.estab]} onValidar={() => validar(e.estab)} onImportar={() => importar(e.estab)} />
              ))}
            </div>
          )}
        </section>

        {/* ------------------------------------------------ 2. conferência (próxima etapa) */}
        <section aria-labelledby="cbc-conf" className="space-y-4">
          <h2 id="cbc-conf" className="text-lg font-semibold">2 · Conferência com o caixa e o MEGA</h2>
          <div className={`${card} p-8 text-center ${muted}`}>Próxima etapa: cruzar as vendas da Rede com os cartões lançados no caixa das lojas e os recebimentos com a baixa automática do financeiro, por filial.</div>
        </section>
      </div>
    </div>
  );
}

function ZonaArquivo({ lendo, onArquivo }) {
  const [sobre, setSobre] = useState(false);
  const inp = useRef(null);
  const pegar = f => { if (f) onArquivo(f); };
  return (
    <div role="button" tabIndex={0} aria-label="Selecionar arquivo da Rede"
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.current?.click(); } }}
      onClick={() => inp.current?.click()}
      onDragOver={e => { e.preventDefault(); setSobre(true); }} onDragLeave={() => setSobre(false)}
      onDrop={e => { e.preventDefault(); setSobre(false); pegar(e.dataTransfer.files?.[0]); }}
      className={`${card} cursor-pointer px-6 py-12 text-center transition border-dashed ${sobre ? 'border-[var(--cb-prim)] bg-[var(--cb-soft)]' : ''} focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cb-prim)]`}>
      <input ref={inp} type="file" accept=".xlsx,.xls" className="hidden" onChange={e => pegar(e.target.files?.[0])} />
      {lendo ? <Loader2 className="mx-auto animate-spin" size={28} /> : <Upload className="mx-auto" size={28} style={{ color: 'var(--cb-prim)' }} />}
      <div className="mt-3 font-medium">{lendo ? 'Lendo e conferindo o arquivo…' : 'Arraste o arquivo da Rede ou clique para selecionar'}</div>
      <div className={`text-sm ${muted} mt-1`}>Extrato de vendas (aba "vendas") ou relatório de recebimentos (abas pagamentos, recebidos, ajustes…) exportados do portal da Rede em .xlsx.</div>
      <div className={`text-xs ${muted} mt-1`}>O arquivo é lido no seu navegador; nada é gravado sem a sua confirmação. Cada estabelecimento vira uma importação na sua filial.</div>
    </div>
  );
}

function BlocoFilial({ e, tipo, filiais, fil, setFil, prep, imp, onValidar, onImportar }) {
  const [verLinhas, setVerLinhas] = useState(false);
  const [filtroSit, setFiltroSit] = useState('todas');
  const R = e.resumo;
  const linhas = e.linhas.filter(l => filtroSit === 'todas' || l.situacao === filtroSit);
  const podeValidar = !!fil && R.novas > 0 && !prep?.rodando && imp?.status !== 'I';
  const podeImportar = prep?.status === 'P' && /Nada foi gravado/.test(prep.mensagem || '') && !imp?.rodando && imp?.status !== 'I';
  const origem = e.filial?.origem === 'cadastro' ? 'pelo cadastro de estabelecimentos' : e.filial?.origem === 'cnpj' ? 'pelo CNPJ da planilha' : e.filial?.origem === 'escolhida' ? 'escolhida por você' : '';
  const statusTxt = Object.entries(R.por_status || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${fmtN(v)} ${k}`).join(' · ');
  return (
    <div className={`${card} p-5 space-y-5`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Store size={20} className="mt-0.5" style={{ color: 'var(--cb-prim)' }} />
          <div>
            <div className={`text-xs ${muted}`}>Estabelecimento Rede {e.estab}{e.cnpj ? ` · CNPJ ${e.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')}` : ''} · {e.nome}</div>
            {e.filial && <div className="font-medium">Filial {e.filial.fil} · {e.filial.nome} <span className={`text-xs ${muted}`}>({origem})</span></div>}
            {!e.filial && <div className="text-sm mt-1" style={{ color: 'var(--cb-warn)' }}>Estabelecimento sem filial cadastrada. Escolha a filial ao lado: fica gravada para as próximas importações.</div>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className={`text-xs ${muted}`} htmlFor={`fil-${e.estab}`}>Filial</label>
          <select id={`fil-${e.estab}`} className={`${campo} max-w-[calc(100vw-7rem)] sm:max-w-md`} value={fil} onChange={ev => setFil(ev.target.value)} disabled={imp?.status === 'I'}>
            <option value="">Escolha…</option>
            {filiais.map(f => <option key={f.fil} value={f.fil}>{f.fil} · {f.nome}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 2xl:grid-cols-6 gap-3">
        <Numero rotulo="Linhas" valor={fmtN(R.linhas)} sub={`${fmtBr(R.periodo.ini)} a ${fmtBr(R.periodo.fim)}`} />
        <Numero rotulo={tipo === 'V' ? 'Bruto (aprovadas/pagas)' : 'Bruto (parcelas pagas)'} valor={fmt(R.bruto)} sub={tipo === 'V' ? statusTxt : Object.entries(R.por_aba || {}).map(([k, v]) => `${fmtN(v)} ${k}`).join(' · ')} />
        <Numero rotulo="Taxas" valor={fmt(R.taxas)} cor="var(--cb-err)" />
        <Numero rotulo="Líquido" valor={fmt(R.liquido)} cor="var(--cb-ok)" sub={tipo === 'R' ? `depósitos ${fmt(R.depositos)} · futuros ${fmt(R.futuros)}` : null} />
        <Numero rotulo="Novas" valor={fmtN(R.novas)} sub={`${fmtN(R.ja_importadas)} já importada(s)`} cor="var(--cb-ok)" />
        <Numero rotulo="Atenção" valor={fmtN(R.erros + R.repetidas)} sub={`${fmtN(R.erros)} erro(s) · ${fmtN(R.repetidas)} repetida(s)`} cor={R.erros ? 'var(--cb-err)' : undefined} />
      </div>

      <div className="space-y-2">
        {e.arquivo_ja_importado.map((x, i) => <Aviso key={i} tipo="warn">Este mesmo arquivo já foi importado nesta filial pelo Gestor em {fmtBr(x.em)} {String(x.em).slice(11)} ({x.por}).</Aviso>)}
        {R.erros > 0 && <Aviso tipo="err">{fmtN(R.erros)} linha(s) com erro não serão importadas.</Aviso>}
        {R.repetidas > 0 && <Aviso tipo="info">{fmtN(R.repetidas)} linha(s) se repetem dentro do arquivo (mesma chave). São importadas na quantidade que a Rede enviou.</Aviso>}
      </div>

      <div>
        <button className={`text-sm ${muted} inline-flex items-center gap-1 hover:text-[var(--cb-text)]`} onClick={() => setVerLinhas(v => !v)} aria-expanded={verLinhas}>
          {verLinhas ? <ChevronDown size={15} /> : <ChevronRight size={15} />} Ver as {fmtN(e.linhas.length)} linhas
        </button>
        {verLinhas && (
          <div className="mt-3 space-y-2">
            <div className="flex flex-wrap gap-1" role="tablist" aria-label="Filtrar linhas">
              {['todas', 'nova', 'ja', 'erro'].map(s => (
                <button key={s} role="tab" aria-selected={filtroSit === s} className={`px-3 py-1 rounded-full text-xs border ${filtroSit === s ? 'bg-[var(--cb-soft)] border-[var(--cb-prim)]' : 'border-[var(--cb-line)]'}`} onClick={() => setFiltroSit(s)}>
                  {s === 'todas' ? 'Todas' : SIT[s][0]} · {fmtN(s === 'todas' ? e.linhas.length : e.linhas.filter(l => l.situacao === s).length)}
                </button>
              ))}
            </div>
            <div className="overflow-x-auto rounded-xl border border-[var(--cb-line)]">
              <table className="w-full text-sm min-w-[980px]">
                <thead className={`text-xs ${muted} bg-[var(--cb-soft)]`}><tr>
                  <th className="text-left px-3 py-2">Situação</th><th className="text-left px-3 py-2">Aba</th><th className="text-left px-3 py-2">Data</th><th className="text-left px-3 py-2">Status</th>
                  <th className="text-left px-3 py-2">Modalidade</th><th className="text-left px-3 py-2">Bandeira</th><th className="text-left px-3 py-2">NSU / autorização</th>
                  <th className="text-right px-3 py-2">Bruto</th><th className="text-right px-3 py-2">Taxas</th><th className="text-right px-3 py-2">Líquido</th><th className="text-left px-3 py-2">Observação</th>
                </tr></thead>
                <tbody>{linhas.map(l => (
                  <tr key={l.ordem} className="border-t border-[var(--cb-line)]">
                    <td className="px-3 py-2"><Chip cor={SIT[l.situacao]?.[1]}>{SIT[l.situacao]?.[0] || l.situacao}</Chip></td>
                    <td className="px-3 py-2 text-xs">{ABA[l.aba] || l.aba}</td>
                    <td className="px-3 py-2 tabular-nums">{fmtBr(l.data)}{l.hora ? <span className={`text-xs ${muted}`}> {l.hora}</span> : ''}</td>
                    <td className="px-3 py-2 text-xs">{l.status || '—'}</td>
                    <td className="px-3 py-2 text-xs">{l.modalidade || '—'}{l.parcelas > 1 ? ` ${l.parcela ? `${l.parcela}/` : ''}${l.parcelas}x` : ''}</td>
                    <td className="px-3 py-2 text-xs">{l.bandeira || '—'}</td>
                    <td className={`px-3 py-2 font-mono text-xs ${muted}`}>{l.nsu || l.id_transacao || '—'}{l.autorizacao ? ` · ${l.autorizacao}` : ''}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{l.bruto == null ? '—' : fmt(l.bruto)}</td>
                    <td className="px-3 py-2 text-right tabular-nums" style={{ color: 'var(--cb-err)' }}>{l.taxas == null ? '—' : fmt(l.taxas)}</td>
                    <td className="px-3 py-2 text-right tabular-nums" style={{ color: 'var(--cb-ok)' }}>{l.liquido == null ? '—' : fmt(l.liquido)}</td>
                    <td className={`px-3 py-2 text-xs ${muted}`}>{l.descricao ? `${l.descricao} ` : ''}{l.motivo}{l.repetida_no_arquivo ? ` · repete ${l.repetida_no_arquivo}× no arquivo` : ''}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-[var(--cb-line)]">
        <div className="pt-4 flex flex-wrap items-center gap-3">
          <button className={btnSec} disabled={!podeValidar} onClick={onValidar}>{prep?.rodando ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Validar</button>
          <button className={btnPrim} disabled={!podeImportar} onClick={() => { if (window.confirm(`Importar ${fmtN(prep.novas)} linha(s) do estabelecimento ${e.estab} na filial ${fil}? A gravação é tudo ou nada.`)) onImportar(); }}>
            {imp?.rodando ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} Importar {podeImportar ? `${fmtN(prep.novas)} linha(s)` : ''}
          </button>
          {!R.novas && <span className={`text-sm ${muted}`}>Nada novo para importar: todas as linhas já estão importadas nesta filial.</span>}
        </div>
        <div className="w-full space-y-2">
          {prep && !prep.rodando && <Aviso tipo={prep.status === 'X' ? 'err' : 'ok'}>{prep.mensagem}</Aviso>}
          {imp && !imp.rodando && <Aviso tipo={imp.status === 'I' ? 'ok' : 'err'}>{imp.mensagem}</Aviso>}
        </div>
      </div>
    </div>
  );
}

function HistoricoImportacoes({ filial, filiais, setFilial, onFechar }) {
  const [lista, setLista] = useState(null); const [erro, setErro] = useState('');
  useEffect(() => { setLista(null); api.cbcArquivos(filial || '').then(r => setLista(r.arquivos)).catch(e => setErro(e.detalhe || e.message)); }, [filial]);
  return (
    <div className={`${card} p-5 space-y-3`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Importações da Rede feitas pelo Gestor</h3>
        <div className="flex items-center gap-2">
          <select aria-label="Filial" className={campo} value={filial} onChange={e => setFilial(e.target.value)}><option value="">Todas as filiais</option>{filiais.map(f => <option key={f.fil} value={f.fil}>{f.fil} · {f.nome}</option>)}</select>
          <button className={btnSec} onClick={onFechar} aria-label="Fechar"><X size={14} /></button>
        </div>
      </div>
      {erro && <Aviso tipo="err">{erro}</Aviso>}
      {!lista && !erro && <div className={muted}><Loader2 className="inline animate-spin mr-2" size={14} />Carregando…</div>}
      {lista && lista.length === 0 && <div className={`text-sm ${muted}`}>Nenhuma importação ainda.</div>}
      {lista && lista.length > 0 && (
        <div className="overflow-x-auto"><table className="w-full text-sm min-w-[860px]">
          <thead className={`text-xs ${muted}`}><tr><th className="text-left py-2">Quando</th><th className="text-left">Arquivo</th><th className="text-left">Filial · estabelecimento</th><th className="text-left">Período</th><th className="text-right">Novas</th><th className="text-right">Já havia</th><th className="text-right">Bruto</th><th className="text-left pl-4">Situação</th></tr></thead>
          <tbody>{lista.map(a => (
            <tr key={a.id} className="border-t border-[var(--cb-line)]">
              <td className="py-2 tabular-nums">{fmtBr(a.em)} {String(a.em || '').slice(11)}<span className={`block text-xs ${muted}`}>{a.usuario}</span></td>
              <td>{a.nome}<span className={`block text-xs ${muted}`}>{a.tipo === 'V' ? 'vendas' : 'recebimentos'}</span></td>
              <td className="text-xs">{a.filial}<span className={`block ${muted}`}>{a.estab} · {a.estab_nome}</span></td>
              <td className="tabular-nums text-xs">{fmtBr(a.periodo.ini)} a {fmtBr(a.periodo.fim)}</td><td className="text-right">{fmtN(a.novas)}</td><td className="text-right">{fmtN(a.ja)}</td><td className="text-right tabular-nums">{fmt(a.bruto)}</td>
              <td className="pl-4 text-xs">{a.status === 'I' ? <Chip cor="var(--cb-ok)">importado</Chip> : <Chip cor="var(--cb-err)">recusado</Chip>}<span className={`block ${muted}`}>{a.mensagem}</span></td>
            </tr>))}</tbody>
        </table></div>
      )}
    </div>
  );
}
