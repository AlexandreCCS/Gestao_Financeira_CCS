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
const EFETIVAR_VISIVEL = false;   // [20/11/2026] seção "Efetivar na 27619" escondida (ver comentário no JSX)
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
    try {
      const r = await api.cbcImportar(id); setArq(a => ({ ...a, imp: { ...a.imp, [estab]: r } }));
      if (r.status === 'I' && r.tipo === 'R') { setFilialEfetivar(String(r.filial)); setTickEfetivar(t => t + 1); }   // recebimentos importados: já aponta a seção 2 para a filial
    }
    catch (e) { setArq(a => ({ ...a, imp: { ...a.imp, [estab]: { status: 'X', mensagem: e.detalhe || e.message } } })); }
  }
  const [filialEfetivar, setFilialEfetivar] = useState('');
  const [tickEfetivar, setTickEfetivar] = useState(0);

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

        {/* ------------------------------------------------ 2. efetivar na conta REDE (FIN_CONCILIACAO)
            [20/11/2026 - Alexandre Carvalho] ESCONDIDA: a baixa do cartão cai no Itaú da loja, então a 27619 nunca tem par na conciliação
            do Mega; a perna do Mega é feita no extrato do Itaú. Componente mantido para poder voltar (EFETIVAR_VISIVEL). */}
        {EFETIVAR_VISIVEL && <Efetivar filiais={filiais} filialInicial={filialEfetivar} tick={tickEfetivar} />}

        {/* ------------------------------------------------ 2. conferência */}
        <section aria-labelledby="cbc-conf" className="space-y-4">
          <h2 id="cbc-conf" className="text-lg font-semibold">2 · Conferência com o caixa e o MEGA</h2>
          <ConferenciaCredito filiais={filiais} filialInicial={filialEfetivar} tick={tickEfetivar} />
        </section>

        {/* ------------------------------------------------ 3. perna do Mega: depósitos da Rede no extrato do Itaú [20/11/2026] */}
        <section aria-labelledby="cbc-dep" className="space-y-4">
          <h2 id="cbc-dep" className="text-lg font-semibold">3 · Conciliar no extrato do Itaú (depósitos da Rede)</h2>
          <DepositosItau filiais={filiais} filialInicial={filialEfetivar} tick={tickEfetivar} />
        </section>
      </div>
    </div>
  );
}

// [19/11/2026 - Alexandre Carvalho] 3 · Conferência do CARTÃO DE CRÉDITO por filial: cada parcela da Rede (paga ou futura) × a parcela baixada
// pela baixa automática do Mega (data da venda + nº da parcela + valor; 2ª passada sem a parcela; 3ª por soma de dois). Só leitura (api cbcCredito.js).
const SITC = {
  CONCILIADA: ['conciliada', 'var(--cb-ok)'], AGRUPADA: ['conciliada por soma', 'var(--cb-ok)'], DIF_CENTAVO: ['diferença de centavo', 'var(--cb-info)'],
  DIF_DATA: ['diferença de data', 'var(--cb-warn)'], DIF_PARCELA: ['parcela diferente', 'var(--cb-warn)'], SO_REDE: ['só na Rede', 'var(--cb-err)'],
  SO_MEGA: ['só no Mega', 'var(--cb-err)'], FUTURA: ['futura (prevista)', 'var(--cb-muted)'], FUTURA_SO_REDE: ['futura sem parcela no Mega', 'var(--cb-warn)'],
};
function ConferenciaCredito({ filiais, filialInicial, tick }) {
  const [fil, setFil] = useState(filialInicial || '');
  const [dados, setDados] = useState(null); const [erro, setErro] = useState(''); const [carregando, setCarregando] = useState(false);
  const [filtro, setFiltro] = useState('pendencias');
  useEffect(() => { if (filialInicial) setFil(filialInicial); }, [filialInicial, tick]);
  const carregar = async (f = fil) => {
    if (!f) { setDados(null); return; }
    setCarregando(true); setErro('');
    try { setDados(await api.cbcConfCredito(f)); } catch (e) { setDados(null); setErro(e.detalhe || e.message); } finally { setCarregando(false); }
  };
  useEffect(() => { carregar(fil); }, [fil, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const R = dados?.resumo || {};
  const n = k => R[k]?.parcelas || 0, v = k => R[k]?.valor || 0;
  const ok = n('CONCILIADA') + n('AGRUPADA'), pend = n('DIF_DATA') + n('DIF_PARCELA') + n('SO_REDE') + n('SO_MEGA') + n('FUTURA_SO_REDE');
  const linhas = (dados?.linhas || []).filter(l => filtro === 'todas' ? true : filtro === 'pendencias' ? !['CONCILIADA', 'AGRUPADA', 'FUTURA', 'DIF_CENTAVO'].includes(l.situacao) : l.situacao === filtro);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className={`text-sm ${muted}`}>Cartão de <b>crédito</b>: cada parcela da Rede × a parcela baixada pela baixa automática do Mega.</div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="cbc-fil-conf">Filial</label>
          <select id="cbc-fil-conf" className={`${campo} w-full sm:w-auto sm:max-w-[440px]`} value={fil} onChange={e => setFil(e.target.value)}>
            <option value="">Escolha a filial…</option>
            {filiais.map(f => <option key={f.fil} value={f.fil}>{f.fil} · {f.nome}</option>)}
          </select>
          <button className={btnSec} disabled={!fil || carregando} onClick={() => carregar()}>{carregando ? <Loader2 size={14} className="animate-spin" /> : <History size={14} />} Conferir</button>
        </div>
      </div>
      {erro && <Aviso tipo="err">{erro}</Aviso>}
      {!fil && <div className={`${card} p-8 text-center ${muted}`}>Escolha a filial para conferir as parcelas de crédito da Rede com o Mega.</div>}
      {fil && carregando && !dados && <div className={`${card} p-8 text-center ${muted}`}><Loader2 className="inline animate-spin mr-2" size={16} />Conferindo as parcelas…</div>}
      {dados?.aviso && <Aviso tipo="info">{dados.aviso}</Aviso>}
      {dados && !dados.aviso && (
        <div className={`${card} p-5 space-y-5`}>
          <div className="grid grid-cols-2 md:grid-cols-3 2xl:grid-cols-6 gap-3">
            <Numero rotulo="Parcelas pagas pela Rede" valor={fmtN(dados.totais.rede_pagas.parcelas)} sub={`${fmt(dados.totais.rede_pagas.bruto)} · ${fmtBr(dados.periodo?.ini)} a ${fmtBr(dados.periodo?.fim)}`} />
            <Numero rotulo="Conciliadas" valor={fmtN(ok)} sub={`${fmt(v('CONCILIADA') + v('AGRUPADA'))}${n('AGRUPADA') ? ` · ${fmtN(n('AGRUPADA'))} por soma` : ''}`} cor="var(--cb-ok)" />
            <Numero rotulo="Diferença de centavo" valor={fmtN(n('DIF_CENTAVO'))} sub="arredondamento da parcela" cor={n('DIF_CENTAVO') ? 'var(--cb-info)' : undefined} />
            <Numero rotulo="Pendências" valor={fmtN(pend)} sub={`só Rede ${fmtN(n('SO_REDE') + n('FUTURA_SO_REDE'))} · só Mega ${fmtN(n('SO_MEGA'))} · data/parcela ${fmtN(n('DIF_DATA') + n('DIF_PARCELA'))}`} cor={pend ? 'var(--cb-err)' : 'var(--cb-ok)'} />
            <Numero rotulo="Futuras (a receber)" valor={fmtN(dados.totais.rede_futuras.parcelas)} sub={fmt(dados.totais.rede_futuras.bruto)} />
            <Numero rotulo="Taxa Rede × tarifa 956" valor={fmt(dados.totais.taxa_casadas.rede)} sub={`Mega 956: ${fmt(dados.totais.taxa_casadas.mega_956)} (parcelas casadas)`} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {[['pendencias', `Pendências (${pend})`], ['todas', `Todas (${dados.linhas.length})`], ...Object.keys(SITC).filter(k => n(k)).map(k => [k, `${SITC[k][0]} (${n(k)})`])].map(([k, t]) => (
              <button key={k} className={`${btnSec} ${filtro === k ? 'bg-[var(--cb-soft)] font-semibold' : ''}`} onClick={() => setFiltro(k)}>{t}</button>
            ))}
          </div>
          <div className="overflow-x-auto rounded-xl border border-[var(--cb-line)]">
            <table className="w-full text-sm min-w-[1100px]">
              <thead className={`text-xs ${muted} bg-[var(--cb-soft)]`}><tr>
                <th className="text-left px-3 py-2">Situação</th>
                <th className="text-left px-3 py-2">Rede: pagamento</th><th className="text-left px-3 py-2">venda · parcela</th><th className="text-left px-3 py-2">bandeira · NSU</th>
                <th className="text-right px-3 py-2">bruto</th><th className="text-right px-3 py-2">taxa</th>
                <th className="text-left px-3 py-2">Mega: doc · parcela</th><th className="text-left px-3 py-2">venda · baixa</th><th className="text-right px-3 py-2">valor</th><th className="text-right px-3 py-2">tarifa 956</th>
                <th className="text-left px-3 py-2">Observação</th>
              </tr></thead>
              <tbody>{linhas.map((l, i) => {
                const r = l.rede, m = l.mega, [rot, cor] = SITC[l.situacao] || [l.situacao, 'var(--cb-muted)'];
                const obs = l.dica || (l.dif ? [l.dif.valor ? `dif. ${fmt(l.dif.valor)}` : '', l.dif.dias ? `${l.dif.dias > 0 ? '+' : ''}${l.dif.dias} dia(s)` : '', m && !m.tarifa && r?.mdr ? 'sem tarifa 956' : ''].filter(Boolean).join(' · ') : '');
                return (
                  <tr key={i} className="border-t border-[var(--cb-line)] align-top">
                    <td className="px-3 py-2"><Chip cor={cor}>{rot}</Chip></td>
                    <td className="px-3 py-2 tabular-nums">{r ? <>{fmtBr(r.pagto)}{r.aba === 'F' ? <span className={`text-xs ${muted}`}> (prevista)</span> : null}</> : '—'}</td>
                    <td className="px-3 py-2 tabular-nums text-xs">{r ? `${fmtBr(r.venda)} · ${r.parcela}/${r.parcelas}` : '—'}</td>
                    <td className="px-3 py-2 text-xs">{r ? <>{r.bandeira}<span className={`font-mono ${muted}`}> {r.nsu}</span></> : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r ? fmt(r.bruto) : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-xs">{r ? fmt(r.mdr) : '—'}</td>
                    <td className="px-3 py-2 text-xs">{m ? `${m.doc} · ${m.parcela}` : '—'}<div className={muted}>{m?.forma || ''}</div></td>
                    <td className="px-3 py-2 tabular-nums text-xs">{m ? `${fmtBr(m.venda)} · ${fmtBr(m.baixa)}` : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{m ? fmt(m.valor) : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-xs">{m ? fmt(m.tarifa) : '—'}</td>
                    <td className="px-3 py-2 text-xs" style={{ color: l.dica ? 'var(--cb-info)' : undefined }}>{obs || ''}</td>
                  </tr>
                );
              })}
              {!linhas.length && <tr><td colSpan={11} className={`px-3 py-6 text-center ${muted}`}>Nada nesta situação.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className={`text-xs ${muted}`}>Casamento: data da venda (±1 dia) + nº da parcela + valor (±R$ 0,02); depois sem a parcela; depois por soma de dois (uma maquininha para dois pedidos, ou dois cartões para um pedido). O caixa não grava NSU.</div>
        </div>
      )}
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

// ------------------------------------------------------------------------------------------------ 3. Perna do Mega no extrato do Itaú
// [20/11/2026 - Alexandre Carvalho] Cada linha "REDE ..." do extrato do Itaú da loja = um depósito da Rede (data + bandeira + crédito/débito) =
// as parcelas pagas naquele depósito = os movimentos da baixa automática no banco (ação 706). Conciliar só o que fecha no centavo (motor do Gestor).
// Tarifa não lançada e ajuste da Rede (aluguel) ficam SÓ SINALIZADOS (decisão 20/11): nada é lançado por aqui. Api: cbcDeposito.js.
const SITD = {
  PRONTO: ['pronto para conciliar', 'var(--cb-ok)'], DECIDIR: ['escolher o título', 'var(--cb-warn)'], DIFERENCA: ['diferença (sinalizada)', 'var(--cb-warn)'], PENDENTE: ['pendente', 'var(--cb-err)'],
  CONCILIADO: ['já conciliado', 'var(--cb-muted)'], SEM_EXTRATO: ['aguardando extrato do Itaú', 'var(--cb-info)'], SO_EXTRATO: ['só no extrato', 'var(--cb-warn)'],
};
// [27/11/2026 - Alexandre Carvalho] "Buscar no contas a receber" na parcela da Rede sem titulo achado (ou com varios): mesma rota da conciliacao
// normal (GET /bxc/titulos), filtrada pela filial e saldo >= liquido. Saldo maior que o bruto = baixa PARCIAL (parte no cartao, parte em dinheiro;
// o restante fica em aberto - a baixa do dinheiro por esta tela esta no plano, Gestor_Financeiro_Conciliacao_Cartao.md §15).
function BuscaTituloCartao({ alvo, fil, onEscolher, onClose }) {
  const [nome, setNome] = useState(''); const [doc, setDoc] = useState('');
  const [lista, setLista] = useState(null); const [erro, setErro] = useState(''); const [busy, setBusy] = useState(false);
  const pode = doc.trim().length >= 2 || nome.trim().length >= 3;
  const buscar = async () => {
    if (!pode) return;
    setBusy(true); setErro('');
    try {
      const r = await api.bxcTitulos({ tipo: 'R', org: alvo.org, fil, nome: nome.trim(), doc: doc.trim(), venc_ini: '2000-01-01', venc_fim: '2035-12-31', vmin: (alvo.liquido - 0.02).toFixed(2) });
      setLista(r.titulos || []);
    } catch (e) { setLista(null); setErro(e.detalhe || e.message); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Buscar no contas a receber">
      <div className={`${card} w-full max-w-4xl p-5 space-y-4 max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-semibold">Buscar no contas a receber</div>
            <div className={`text-xs ${muted}`}>Parcela da Rede NSU {alvo.nsu} · venda {fmtBr(alvo.venda)} · bruto {fmt(alvo.bruto)} · taxa {fmt(alvo.mdr)} · líquido {fmt(alvo.liquido)} · filial {fil}</div>
          </div>
          <button className={btnSec} onClick={onClose} aria-label="Fechar"><X size={14} /></button>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs">Cliente (nome, fantasia ou CNPJ)<input className={`${campo} block w-72`} value={nome} onChange={e => setNome(e.target.value)} onKeyDown={e => e.key === 'Enter' && buscar()} autoFocus /></label>
          <label className="text-xs">Documento<input className={`${campo} block w-40`} value={doc} onChange={e => setDoc(e.target.value)} onKeyDown={e => e.key === 'Enter' && buscar()} /></label>
          <button className={btnPrim} disabled={!pode || busy} onClick={buscar}>{busy ? <Loader2 size={14} className="animate-spin" /> : null} Buscar</button>
          {!pode && <span className={`text-xs ${muted}`}>Informe 3 letras do cliente ou 2 do documento.</span>}
        </div>
        {erro && <Aviso tipo="err">{erro}</Aviso>}
        {lista && (lista.length === 0
          ? <div className={`text-sm ${muted}`}>Nenhum título em aberto da filial {fil} com saldo a partir de {fmt(alvo.liquido)}.</div>
          : <div className="overflow-x-auto rounded-xl border border-[var(--cb-line)]">
              <table className="w-full text-sm">
                <thead className={`text-xs ${muted} bg-[var(--cb-soft)]`}><tr>
                  <th className="text-left px-3 py-2">Cliente</th><th className="text-left px-3 py-2">Documento</th><th className="text-left px-3 py-2">Vencimento</th>
                  <th className="text-right px-3 py-2">Saldo</th><th className="text-left px-3 py-2">Baixa</th><th></th>
                </tr></thead>
                <tbody>{lista.map(t => {
                  const parcial = t.saldo > alvo.bruto + 0.02, exato = Math.abs(t.saldo - alvo.bruto) <= 0.02 || Math.abs(t.saldo - alvo.liquido) <= 0.02;
                  return (
                    <tr key={t.id} className="border-t border-[var(--cb-line)]">
                      <td className="px-3 py-2">{t.agn_nome}</td><td className="px-3 py-2">{t.doc}-{t.parcela} <span className={`text-xs ${muted}`}>{t.tpd}</span></td>
                      <td className="px-3 py-2 tabular-nums">{fmtBr(t.venc)}</td><td className="px-3 py-2 text-right tabular-nums">{fmt(t.saldo)}</td>
                      <td className="px-3 py-2 text-xs">{exato ? 'total' : parcial ? <span style={{ color: 'var(--cb-warn)' }}>parcial · ficam {fmt(t.saldo - alvo.bruto)} em aberto</span> : 'total (saldo entre líquido e bruto)'}</td>
                      <td className="px-3 py-2 text-right"><button className={btnSec} onClick={() => onEscolher(`${t.seq}:${t.lancto}`)}>Usar este título</button></td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>)}
      </div>
    </div>
  );
}

function DepositosItau({ filiais, filialInicial, tick }) {
  const [fil, setFil] = useState(filialInicial || '');
  const [dados, setDados] = useState(null); const [erro, setErro] = useState(''); const [carregando, setCarregando] = useState(false);
  const [filtro, setFiltro] = useState('abertos'); const [aberto, setAberto] = useState({}); const [sel, setSel] = useState({});
  const [val, setVal] = useState(null); const [res, setRes] = useState(null); const [rodando, setRodando] = useState(false);
  // [27/11/2026] titulo escolhido nas parcelas DECIDIR (varios titulos em aberto com o mesmo valor): { nsu: 'seq:lancto' }
  const [escolhas, setEscolhas] = useState({});
  const [buscar, setBuscar] = useState(null);   // [27/11/2026] parcela em busca no contas a receber
  useEffect(() => { if (filialInicial) setFil(filialInicial); }, [filialInicial, tick]);
  useEffect(() => { setEscolhas({}); }, [fil]);
  const carregar = async (f = fil, esc = escolhas) => {
    setVal(null); setRes(null); setSel({});
    if (!f) { setDados(null); return; }
    setCarregando(true); setErro('');
    try { setDados(await api.cbcDepositos(f, esc)); } catch (e) { setDados(null); setErro(e.detalhe || e.message); } finally { setCarregando(false); }
  };
  const escolher = (nsu, id) => { const esc = { ...escolhas, [nsu]: id }; if (!id) delete esc[nsu]; setEscolhas(esc); carregar(fil, esc); };
  useEffect(() => { carregar(fil); }, [fil, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const R = dados?.resumo || {};
  const n = k => R[k]?.depositos || 0, v = k => R[k]?.valor || 0;
  const deps = (dados?.depositos || []).filter(d => filtro === 'todos' ? true : filtro === 'abertos' ? d.situacao !== 'CONCILIADO' : d.situacao === filtro);
  const prontos = (dados?.depositos || []).filter(d => d.situacao === 'PRONTO');
  const cbasSel = prontos.filter(d => sel[d.extrato.cba]).map(d => d.extrato.cba);
  const totSel = prontos.filter(d => sel[d.extrato.cba]).reduce((s, d) => s + d.extrato.valor, 0);
  const todosSel = prontos.length > 0 && cbasSel.length === prontos.length;
  const validar = async () => {
    setRodando(true); setRes(null);
    try { setVal(await api.cbcDepConciliar({ filial: Number(fil), cbas: cbasSel, simular: true, escolhas })); } catch (e) { setVal({ erro: e.detalhe || e.message }); } finally { setRodando(false); }
  };
  const valOk = val?.resultados?.length === cbasSel.length && val.resultados.every(r => r.status === 'S') && cbasSel.every(c => val.resultados.some(r => r.cba === c));
  const conciliar = async () => {
    const nb = prontos.filter(d => sel[d.extrato.cba]).reduce((s, d) => s + (d.baixas?.length || 0), 0);
    if (!window.confirm(`Conciliar ${cbasSel.length} depósito(s) da Rede no extrato do Itaú (${fmt(totSel)})?${nb ? `\n\n${nb} título(s) serão BAIXADOS pelo líquido, com a taxa da Rede na ação 956.` : ''}\n\nCada depósito é gravado sozinho (tudo ou nada por depósito).`)) return;
    setRodando(true);
    try { setRes(await api.cbcDepConciliar({ filial: Number(fil), cbas: cbasSel, simular: false, escolhas })); setVal(null); setSel({}); setDados(await api.cbcDepositos(fil, escolhas)); }
    catch (e) { setRes({ erro: e.detalhe || e.message }); } finally { setRodando(false); }
  };
  // [27/11/2026] caminho B: baixar agora (sem extrato), conciliar depois. Simula, confirma, grava; depois a parcela vira "baixada a mao".
  const baixarAgora = async d => {
    setRodando(true); setRes(null); setVal(null);
    try {
      const sim = await api.cbcDepBaixar({ filial: Number(fil), chave: d.chave, simular: true, escolhas });
      const ruins = (sim.resultados || []).filter(r => r.status !== 'S');
      if (ruins.length) { setRes({ resultados: sim.resultados.map((r, i) => ({ ...r, cba: `b${i}`, data: d.data, bandeira: d.bandeira, modalidade: d.modalidade, valor: r.valor })) }); return; }
      const txt = d.baixas.map(b => `• ${b.doc}-${b.parcela}: ${fmt(b.valor)} no banco${b.desconto ? ` + taxa ${fmt(b.desconto)} na ação 956` : ''}`).join('\n');
      if (!window.confirm(`Baixar agora, sem o extrato do Itaú (o depósito de ${fmtBr(d.data)} concilia depois, quando o extrato chegar)?\n\n${txt}\n\nCada título é baixado com a data do depósito na conta da loja.`)) return;
      const r = await api.cbcDepBaixar({ filial: Number(fil), chave: d.chave, simular: false, escolhas });
      setRes({ resultados: (r.resultados || []).map((x, i) => ({ ...x, cba: `b${i}`, data: d.data, bandeira: d.bandeira, modalidade: d.modalidade })) });
      setEscolhas({}); setDados(await api.cbcDepositos(fil, {}));
    } catch (e) { setRes({ erro: e.detalhe || e.message }); } finally { setRodando(false); }
  };
  const resultados = res?.resultados || val?.resultados || [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className={`text-sm ${muted}`}>Cada depósito da Rede no extrato do Itaú × as parcelas pagas: parcela já baixada (automática ou à mão) só concilia; parcela sem baixa acha o título e baixa com a taxa na ação 956.</div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="cbc-fil-dep">Filial</label>
          <select id="cbc-fil-dep" className={`${campo} w-full sm:w-auto sm:max-w-[440px]`} value={fil} onChange={e => setFil(e.target.value)}>
            <option value="">Escolha a filial…</option>
            {filiais.map(f => <option key={f.fil} value={f.fil}>{f.fil} · {f.nome}</option>)}
          </select>
          <button className={btnSec} disabled={!fil || carregando} onClick={() => carregar()}>{carregando ? <Loader2 size={14} className="animate-spin" /> : <History size={14} />} Atualizar</button>
        </div>
      </div>
      {erro && <Aviso tipo="err">{erro}</Aviso>}
      {buscar && <BuscaTituloCartao alvo={buscar} fil={Number(fil)} onClose={() => setBuscar(null)} onEscolher={id => { const nsu = buscar.nsu; setBuscar(null); escolher(nsu, id); }} />}
      {!fil && <div className={`${card} p-8 text-center ${muted}`}>Escolha a filial para montar os depósitos da Rede.</div>}
      {fil && carregando && !dados && <div className={`${card} p-8 text-center ${muted}`}><Loader2 className="inline animate-spin mr-2" size={16} />Montando os depósitos…</div>}
      {dados?.aviso && <Aviso tipo="info">{dados.aviso}</Aviso>}
      {dados && !dados.aviso && (
        <div className={`${card} p-5 space-y-5`}>
          <div className="grid grid-cols-2 md:grid-cols-3 2xl:grid-cols-6 gap-3">
            <Numero rotulo="Prontos para conciliar" valor={fmtN(n('PRONTO'))} sub={fmt(v('PRONTO'))} cor={n('PRONTO') ? 'var(--cb-ok)' : undefined} />
            <Numero rotulo="Diferença sinalizada" valor={fmtN(n('DIFERENCA'))} sub={`tarifa não lançada ${fmt(dados.totais.tarifa_faltante)} · ajuste Rede ${fmt(dados.totais.ajuste_rede)}`} cor={n('DIFERENCA') ? 'var(--cb-warn)' : undefined} />
            <Numero rotulo="Pendentes" valor={fmtN(n('PENDENTE') + n('SO_EXTRATO'))} sub="parcela sem baixa, já conciliado em outro lote…" cor={n('PENDENTE') + n('SO_EXTRATO') ? 'var(--cb-err)' : 'var(--cb-ok)'} />
            <Numero rotulo="Já conciliados" valor={fmtN(n('CONCILIADO'))} sub={fmt(v('CONCILIADO'))} />
            <Numero rotulo="Aguardando extrato" valor={fmtN(n('SEM_EXTRATO'))} sub={`extrato do Itaú importado até ${fmtBr(dados.extrato_ate)}`} cor={n('SEM_EXTRATO') ? 'var(--cb-info)' : undefined} />
            <Numero rotulo="Período (depósitos Rede)" valor={`${fmtBr(dados.periodo?.ini).slice(0, 5)} a ${fmtBr(dados.periodo?.fim).slice(0, 5)}`} sub={`janela de datas: ${dados.janela_dias} dias`} />
          </div>
          <Aviso tipo="info">Parcela já baixada no Mega (baixa automática ou à mão) só é conciliada. Parcela sem baixa: o título em aberto com o mesmo valor é baixado pelo líquido, com a taxa da Rede na ação 956 (se houver mais de um título possível, escolha na linha da parcela). O depósito só concilia quando o total fecha com o extrato. Tarifa não lançada e ajuste da Rede nas baixas automáticas continuam só sinalizados.</Aviso>
          <div className="flex flex-wrap items-center gap-2">
            {[['abertos', `Em aberto (${(dados.depositos || []).filter(d => d.situacao !== 'CONCILIADO').length})`], ['todos', `Todos (${dados.depositos.length})`], ...Object.keys(SITD).filter(k => n(k)).map(k => [k, `${SITD[k][0]} (${n(k)})`])].map(([k, t]) => (
              <button key={k} className={`${btnSec} ${filtro === k ? 'bg-[var(--cb-soft)] font-semibold' : ''}`} onClick={() => setFiltro(k)}>{t}</button>
            ))}
          </div>
          {prontos.length > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              <span className={`text-sm ${muted}`}>{fmtN(cbasSel.length)} de {fmtN(prontos.length)} pronto(s) selecionado(s){cbasSel.length ? ` · ${fmt(totSel)}` : ''}</span>
              <button className={btnSec} disabled={!cbasSel.length || rodando} onClick={validar}>{rodando && !valOk ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Validar</button>
              <button className={btnPrim} disabled={!valOk || rodando} onClick={conciliar}>{rodando && valOk ? <Loader2 size={15} className="animate-spin" /> : <CreditCard size={15} />} Conciliar {valOk ? `${fmtN(cbasSel.length)} depósito(s)` : ''}</button>
              {!valOk && cbasSel.length > 0 && <span className={`text-xs ${muted}`}>Valide antes de conciliar (roda tudo no Mega e desfaz).</span>}
            </div>
          )}
          {(val?.erro || res?.erro) && <Aviso tipo="err">{val?.erro || res?.erro}</Aviso>}
          {resultados.length > 0 && (
            <div className="space-y-1">
              {resultados.map(r => (
                <div key={r.cba} className="text-sm flex flex-wrap gap-2 items-center">
                  <Chip cor={r.status === 'B' ? 'var(--cb-ok)' : r.status === 'S' ? 'var(--cb-info)' : 'var(--cb-err)'}>{r.status === 'B' ? (r.titulo ? 'baixado' : 'conciliado') : r.status === 'S' ? 'validado' : 'recusado'}</Chip>
                  {r.titulo && <span className="tabular-nums">{r.titulo} · {fmt(r.valor)}{r.desconto ? ` + taxa ${fmt(r.desconto)}` : ''}</span>}
                  <span className="tabular-nums">{fmtBr(r.data)} · {r.bandeira} {r.modalidade} · {fmt(r.valor)} · {fmtN(r.movimentos)} lançamento(s){r.baixas ? ` · ${fmtN(r.baixas)} título(s) baixado(s) com 956` : ''}</span>
                  {r.mensagem && <span className={muted}>{r.mensagem}</span>}
                </div>
              ))}
            </div>
          )}
          <div className="overflow-x-auto rounded-xl border border-[var(--cb-line)]">
            <table className="w-full text-sm min-w-[1100px]">
              <thead className={`text-xs ${muted} bg-[var(--cb-soft)]`}><tr>
                <th className="px-3 py-2 w-8">{prontos.length > 0 && <input type="checkbox" aria-label="Selecionar todos os prontos" checked={todosSel} onChange={e => { setVal(null); setSel(e.target.checked ? Object.fromEntries(prontos.map(d => [d.extrato.cba, true])) : {}); }} />}</th>
                <th className="text-left px-3 py-2">Situação</th><th className="text-left px-3 py-2">Data</th><th className="text-left px-3 py-2">Bandeira · modalidade</th>
                <th className="text-right px-3 py-2">Rede (depósito)</th><th className="text-right px-3 py-2">Extrato Itaú</th><th className="text-right px-3 py-2">Mega (706)</th><th className="text-right px-3 py-2">Diferença</th>
                <th className="text-left px-3 py-2">Motivo</th>
              </tr></thead>
              <tbody>{deps.map(d => {
                const [rot, cor] = SITD[d.situacao] || [d.situacao, 'var(--cb-muted)'];
                const k = d.chave, ab = !!aberto[k], pode = d.situacao === 'PRONTO';
                return (
                  <React.Fragment key={k}>
                    <tr className="border-t border-[var(--cb-line)] align-top">
                      <td className="px-3 py-2">{pode && <input type="checkbox" aria-label={`Selecionar depósito ${fmtBr(d.data)} ${d.bandeira}`} checked={!!sel[d.extrato.cba]} onChange={e => { setVal(null); setSel(s => ({ ...s, [d.extrato.cba]: e.target.checked })); }} />}</td>
                      <td className="px-3 py-2"><Chip cor={cor}>{rot}</Chip></td>
                      <td className="px-3 py-2 tabular-nums">{fmtBr(d.data)}</td>
                      <td className="px-3 py-2">
                        {d.parcelas.length > 0
                          ? <button className="inline-flex items-center gap-1 hover:underline" aria-expanded={ab} onClick={() => setAberto(a => ({ ...a, [k]: !ab }))}>{ab ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{d.bandeira} · {d.modalidade} <span className={`text-xs ${muted}`}>({d.parcelas.length} parcela{d.parcelas.length > 1 ? 's' : ''})</span></button>
                          : <>{d.bandeira} · {d.modalidade}</>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{d.rede ? fmt(d.rede.valor) : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{d.extrato ? fmt(d.extrato.valor) : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{d.mega ? <>{fmt(d.mega.soma)} <span className={`text-xs ${muted}`}>({d.mega.movimentos})</span>{d.mega.a_baixar ? <div className="text-xs" style={{ color: 'var(--cb-info)' }}>+ {fmt(d.mega.a_baixar)} a baixar</div> : null}</> : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums" style={{ color: d.dif ? 'var(--cb-warn)' : undefined }}>{d.dif == null ? '—' : d.dif ? fmt(d.dif) : '0,00'}</td>
                      <td className={`px-3 py-2 text-xs ${muted}`}>{d.motivos.join(' · ')}
                        {d.baixas?.length > 0 && !d.extrato && d.situacao !== 'CONCILIADO' && (
                          <div className="mt-1"><button className={btnSec} disabled={rodando} onClick={() => baixarAgora(d)}>{rodando ? <Loader2 size={13} className="animate-spin" /> : <CreditCard size={13} />} Baixar agora (conciliar depois)</button></div>
                        )}
                      </td>
                    </tr>
                    {ab && (
                      <tr className="bg-[var(--cb-soft)]"><td></td><td colSpan={8} className="px-3 py-2">
                        <table className="w-full text-xs">
                          <thead className={muted}><tr>
                            <th className="text-left py-1">Venda · parcela</th><th className="text-left py-1">NSU</th><th className="text-right py-1">Bruto</th><th className="text-right py-1">Taxa Rede</th><th className="text-right py-1">Líquido</th>
                            <th className="text-left py-1 pl-4">Mega: doc · parcela</th><th className="text-left py-1">Baixa</th><th className="text-right py-1">Tarifa 956</th><th className="text-right py-1">No banco (706)</th><th className="text-right py-1">Dif.</th><th className="text-left py-1 pl-3">Obs.</th>
                          </tr></thead>
                          <tbody>{d.parcelas.map((p, i) => (
                            <tr key={i} className="border-t border-[var(--cb-line)]">
                              <td className="py-1 tabular-nums">{fmtBr(p.venda)} · {p.parcela}/{p.parcelas}</td><td className="py-1">{p.nsu || '—'}</td>
                              <td className="py-1 text-right tabular-nums">{fmt(p.bruto)}</td><td className="py-1 text-right tabular-nums">{fmt(p.mdr)}</td><td className="py-1 text-right tabular-nums">{fmt(p.liquido)}</td>
                              <td className="py-1 pl-4">
                                {p.acao === 'BAIXAR' && <span><Chip cor="var(--cb-info)">baixar</Chip> {p.titulo.doc}-{p.titulo.parcela} · {p.titulo.nome} <span className={muted}>(saldo {fmt(p.titulo.saldo)})</span>{p.titulo.escolhido && <button className="ml-2 underline" onClick={() => escolher(p.nsu, '')}>trocar</button>}</span>}
                                {p.acao === 'DECIDIR' && (
                                  <select className={`${campo} text-xs py-1`} aria-label={`Título da parcela NSU ${p.nsu}`} value="" onChange={e => escolher(p.nsu, e.target.value)}>
                                    <option value="">Escolha o título ({p.candidatos.length})…</option>
                                    {p.candidatos.map(c => <option key={c.id} value={c.id}>{c.doc}-{c.parcela} · {c.nome} · emissão {fmtBr(c.emissao)} · saldo {fmt(c.saldo)}</option>)}
                                  </select>
                                )}
                                {p.acao !== 'BAIXAR' && p.acao !== 'DECIDIR' && (p.mega ? <>{p.acao === 'MANUAL' && <Chip cor="var(--cb-muted)">baixada à mão</Chip>} {p.mega.docs} · {p.mega.parcela}</> : '—')}
                                {(!p.acao || p.acao === 'DECIDIR') && d.extrato && d.situacao !== 'CONCILIADO' && (
                                  <button className="ml-2 inline-flex items-center gap-1 underline" onClick={() => setBuscar({ ...p, org: d.extrato.org })}>Buscar no contas a receber</button>
                                )}
                              </td><td className="py-1 tabular-nums">{p.mega ? fmtBr(p.mega.baixa) : '—'}</td>
                              <td className="py-1 text-right tabular-nums">{p.mega ? fmt(p.mega.tarifa) : p.acao === 'BAIXAR' ? (p.taxa_ja_lancada ? <span className={muted}>já lançada</span> : <span style={{ color: 'var(--cb-info)' }}>{fmt(p.mdr)}</span>) : '—'}</td><td className="py-1 text-right tabular-nums">{p.mega ? fmt(p.mega.movimento) : p.acao === 'BAIXAR' ? <span style={{ color: 'var(--cb-info)' }}>{fmt(p.liquido)}</span> : '—'}</td>
                              <td className="py-1 text-right tabular-nums" style={{ color: p.dif ? 'var(--cb-warn)' : undefined }}>{p.dif == null ? '—' : p.dif ? fmt(p.dif) : '0,00'}</td>
                              <td className={`py-1 pl-3 ${muted}`}>{[p.obs, p.tarifa_faltante ? `tarifa não lançada (${fmt(p.tarifa_faltante)})` : '', p.mega?.conciliado ? 'já conciliado' : ''].filter(Boolean).join(' · ')}</td>
                            </tr>
                          ))}</tbody>
                        </table>
                      </td></tr>
                    )}
                  </React.Fragment>
                );
              })}</tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ 2. Efetivar (FIN_CONCILIACAO, conta REDE)
// [18/11/2026 - Alexandre Carvalho] Só o relatório de recebimentos entra: parcela paga = crédito pelo líquido; depósito, ajuste e cancelamento = débito.
// Linhas do dia da emissão ficam "aguardando" (a Rede ainda pode mudar o dia corrente). Validar = roda tudo e desfaz; Efetivar = grava, tudo ou nada.
function Efetivar({ filiais, filialInicial, tick }) {
  const [fil, setFil] = useState(filialInicial || '');
  const [dados, setDados] = useState(null); const [erro, setErro] = useState(''); const [carregando, setCarregando] = useState(false);
  const [verLinhas, setVerLinhas] = useState(false);
  const [val, setVal] = useState(null); const [efe, setEfe] = useState(null);
  const [verHist, setVerHist] = useState(false);
  useEffect(() => { if (filialInicial) setFil(filialInicial); }, [filialInicial, tick]);
  const carregar = async (f = fil) => {
    if (!f) { setDados(null); return; }
    setCarregando(true); setErro(''); setVal(null); setEfe(null);
    try { setDados(await api.cbcPendentes(f)); } catch (e) { setDados(null); setErro(e.detalhe || e.message); } finally { setCarregando(false); }
  };
  useEffect(() => { carregar(fil); }, [fil, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const P = dados?.prontas;
  const podeValidar = !!fil && P?.linhas > 0 && !val?.rodando && !efe?.rodando && efe?.status !== 'E';
  const podeEfetivar = val?.status === 'P' && /Nada foi gravado/.test(val.mensagem || '') && !efe?.rodando && efe?.status !== 'E';
  async function validar() { setVal({ rodando: true }); try { setVal(await api.cbcEfetivar({ filial: Number(fil), simular: true })); } catch (e) { setVal({ status: 'X', mensagem: e.detalhe || e.message }); } }
  async function efetivar() { setEfe({ rodando: true }); try { const r = await api.cbcEfetivar({ filial: Number(fil), simular: false }); setEfe(r); if (r.status === 'E') { const d = await api.cbcPendentes(fil).catch(() => null); if (d) setDados(d); } } catch (e) { setEfe({ status: 'X', mensagem: e.detalhe || e.message }); } }
  return (
    <section aria-labelledby="cbc-efe" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="cbc-efe" className="text-lg font-semibold">2 · Efetivar na conta {dados?.conta ? `${dados.conta.conta} · ${dados.conta.nome}` : 'REDE'} (FIN_CONCILIACAO)</h2>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="cbc-fil">Filial</label>
          <select id="cbc-fil" className={`${campo} w-full sm:w-auto sm:max-w-[440px]`} value={fil} onChange={e => setFil(e.target.value)}>
            <option value="">Escolha a filial…</option>
            {filiais.map(f => <option key={f.fil} value={f.fil}>{f.fil} · {f.nome}</option>)}
          </select>
          <button className={btnSec} disabled={!fil || carregando} onClick={() => carregar()}>{carregando ? <Loader2 size={14} className="animate-spin" /> : <History size={14} />} Recarregar</button>
          <button className={btnSec} onClick={() => setVerHist(v => !v)} aria-expanded={verHist}>Efetivações</button>
        </div>
      </div>
      {verHist && <HistoricoEfetivacoes filial={fil} onFechar={() => setVerHist(false)} />}
      {erro && <Aviso tipo="err">{erro}</Aviso>}
      {!fil && <div className={`${card} p-8 text-center ${muted}`}>Escolha a filial, ou importe um relatório de recebimentos acima, para ver o que está pronto para lançar na conta REDE.</div>}
      {fil && carregando && !dados && <div className={`${card} p-8 text-center ${muted}`}><Loader2 className="inline animate-spin mr-2" size={16} />Conferindo as linhas importadas…</div>}
      {dados && (
        <div className={`${card} p-5 space-y-5`}>
          <div className="grid grid-cols-2 md:grid-cols-3 2xl:grid-cols-6 gap-3">
            <Numero rotulo="Prontas para lançar" valor={fmtN(P.linhas)} sub={P.periodo.ini ? `${fmtBr(P.periodo.ini)} a ${fmtBr(P.periodo.fim)}` : 'nada pendente'} cor={P.linhas ? 'var(--cb-ok)' : undefined} />
            <Numero rotulo="Créditos (parcelas pagas)" valor={fmt(P.creditos)} sub={`${fmtN(P.por_aba?.pagamento?.linhas || 0)} parcela(s)`} cor="var(--cb-ok)" />
            <Numero rotulo="Débitos (depósitos, ajustes, cancel.)" valor={fmt(P.debitos)} sub={`${fmtN(P.por_aba?.deposito?.linhas || 0)} depósito(s) · ${fmtN((P.por_aba?.ajuste?.linhas || 0) + (P.por_aba?.cancelamento?.linhas || 0))} outro(s)`} cor="var(--cb-err)" />
            <Numero rotulo="Saldo que fica na Rede" valor={fmt(P.creditos - P.debitos)} sub="créditos − débitos" />
            <Numero rotulo="Aguardando (data de hoje)" valor={fmtN(dados.aguardando_hoje.linhas)} sub={`${fmt(dados.aguardando_hoje.creditos)} créd. · ${fmt(dados.aguardando_hoje.debitos)} déb.`} cor={dados.aguardando_hoje.linhas ? 'var(--cb-warn)' : undefined} />
            <Numero rotulo="Já na conta REDE (esta filial)" valor={fmtN(dados.ja_na_conta.linhas)} sub={fmt(dados.ja_na_conta.valor)} />
          </div>
          {dados.aguardando_hoje.linhas > 0 && <Aviso tipo="info">{fmtN(dados.aguardando_hoje.linhas)} linha(s) com a data de hoje ficam aguardando: a Rede ainda altera o dia corrente. Elas entram na próxima efetivação, a partir de amanhã.</Aviso>}
          <div>
            <button className={`text-sm ${muted} inline-flex items-center gap-1 hover:text-[var(--cb-text)]`} onClick={() => setVerLinhas(v => !v)} aria-expanded={verLinhas}>
              {verLinhas ? <ChevronDown size={15} /> : <ChevronRight size={15} />} Ver as {fmtN(dados.linhas.length)} linhas
            </button>
            {verLinhas && (
              <div className="mt-3 overflow-x-auto rounded-xl border border-[var(--cb-line)]">
                <table className="w-full text-sm min-w-[860px]">
                  <thead className={`text-xs ${muted} bg-[var(--cb-soft)]`}><tr>
                    <th className="text-left px-3 py-2">Quando</th><th className="text-left px-3 py-2">Data</th><th className="text-left px-3 py-2">Aba</th><th className="text-left px-3 py-2">Status</th>
                    <th className="text-left px-3 py-2">Bandeira · modalidade</th><th className="text-left px-3 py-2">NSU</th><th className="text-right px-3 py-2">Valor na conta REDE</th>
                  </tr></thead>
                  <tbody>{dados.linhas.map(l => (
                    <tr key={`${l.arq}-${l.ordem}`} className="border-t border-[var(--cb-line)]">
                      <td className="px-3 py-2"><Chip cor={l.hoje ? 'var(--cb-warn)' : 'var(--cb-ok)'}>{l.hoje ? 'aguarda' : 'pronta'}</Chip></td>
                      <td className="px-3 py-2 tabular-nums">{fmtBr(l.data)}</td>
                      <td className="px-3 py-2 text-xs">{ABA[l.aba] || l.aba}</td>
                      <td className="px-3 py-2 text-xs">{l.status || '—'}</td>
                      <td className="px-3 py-2 text-xs">{l.bandeira || '—'} · {l.modalidade || '—'}{l.parcelas > 1 ? ` ${l.parcela}/${l.parcelas}` : ''}{l.descricao ? ` · ${l.descricao}` : ''}</td>
                      <td className={`px-3 py-2 font-mono text-xs ${muted}`}>{l.nsu || '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums" style={{ color: l.natureza === 'C' ? 'var(--cb-ok)' : 'var(--cb-err)' }}>{l.natureza === 'C' ? '+' : '−'} {fmt(l.valor)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-[var(--cb-line)]">
            <div className="pt-4 flex flex-wrap items-center gap-3">
              <button className={btnSec} disabled={!podeValidar} onClick={validar}>{val?.rodando ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Validar</button>
              <button className={btnPrim} disabled={!podeEfetivar} onClick={() => { if (window.confirm(`Lançar ${fmtN(P.linhas)} linha(s) na FIN_CONCILIACAO da conta ${dados.conta.conta} (filial ${fil})? Créditos ${fmt(P.creditos)}, débitos ${fmt(P.debitos)}. A gravação é tudo ou nada.`)) efetivar(); }}>
                {efe?.rodando ? <Loader2 size={15} className="animate-spin" /> : <CreditCard size={15} />} Efetivar {podeEfetivar ? `${fmtN(P.linhas)} linha(s)` : ''}
              </button>
              {!P.linhas && <span className={`text-sm ${muted}`}>Nada pronto para lançar nesta filial.</span>}
            </div>
            <div className="w-full space-y-2">
              {val && !val.rodando && <Aviso tipo={val.status === 'X' ? 'err' : 'ok'}>{val.mensagem}</Aviso>}
              {efe && !efe.rodando && <Aviso tipo={efe.status === 'E' ? 'ok' : 'err'}>{efe.mensagem}{efe.status === 'E' ? ' As linhas já aparecem na Conciliação Bancária do Mega, conta REDE, com situação pendente.' : ''}</Aviso>}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function HistoricoEfetivacoes({ filial, onFechar }) {
  const [lista, setLista] = useState(null); const [erro, setErro] = useState('');
  useEffect(() => { setLista(null); api.cbcEfetivacoes(filial || '').then(r => setLista(r.efetivacoes)).catch(e => setErro(e.detalhe || e.message)); }, [filial]);
  return (
    <div className={`${card} p-5 space-y-3`}>
      <div className="flex items-center justify-between"><h3 className="font-semibold">Efetivações na conta REDE{filial ? ` · filial ${filial}` : ''}</h3><button className={btnSec} onClick={onFechar} aria-label="Fechar"><X size={14} /></button></div>
      {erro && <Aviso tipo="err">{erro}</Aviso>}
      {!lista && !erro && <div className={muted}><Loader2 className="inline animate-spin mr-2" size={14} />Carregando…</div>}
      {lista && lista.length === 0 && <div className={`text-sm ${muted}`}>Nenhuma efetivação ainda.</div>}
      {lista && lista.length > 0 && (
        <div className="overflow-x-auto"><table className="w-full text-sm min-w-[760px]">
          <thead className={`text-xs ${muted}`}><tr><th className="text-left py-2">Quando</th><th className="text-left">Filial</th><th className="text-left">Período</th><th className="text-right">Linhas</th><th className="text-right">Créditos</th><th className="text-right">Débitos</th><th className="text-left pl-4">Situação</th></tr></thead>
          <tbody>{lista.map(a => (
            <tr key={a.id} className="border-t border-[var(--cb-line)]">
              <td className="py-2 tabular-nums">{fmtBr(a.em)} {String(a.em || '').slice(11)}<span className={`block text-xs ${muted}`}>{a.usuario}</span></td>
              <td>{a.filial}<span className={`block text-xs ${muted}`}>conta {a.conta}</span></td>
              <td className="tabular-nums text-xs">{fmtBr(a.periodo.ini)} a {fmtBr(a.periodo.fim)}</td><td className="text-right">{fmtN(a.linhas)}</td><td className="text-right tabular-nums">{fmt(a.creditos)}</td><td className="text-right tabular-nums">{fmt(a.debitos)}</td>
              <td className="pl-4 text-xs">{a.status === 'E' ? <Chip cor="var(--cb-ok)">efetivada</Chip> : <Chip cor="var(--cb-err)">recusada</Chip>}<span className={`block ${muted}`}>{a.mensagem}</span></td>
            </tr>))}</tbody>
        </table></div>
      )}
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
