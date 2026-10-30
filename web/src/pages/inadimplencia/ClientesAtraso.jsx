// [14/05/2026 - CRIADO POR ALEXANDRE CARVALHO] Inadimplencia > Clientes em Atraso.
// Lista todos os titulos em atraso usando o MESMO criterio da regra de bloqueio
// (FIN_VW_CONTASRECEBER: saldo > 0, prorrogado < SYSDATE-2, TPD <> PDV).
// Segue tambem a regra de QUEM nao e bloqueado: clientes internos (whitelist
// hardcoded) e clientes em grupo de credito isento (GCR_ST_NAOBLOQUEIA='S').
// Esses ficam ocultos por padrao - ha um toggle para inclui-los. Export Excel.
import React, { useEffect, useMemo, useState } from 'react';
import { Filter, FileSpreadsheet, Search, AlertTriangle, Users, Clock, ShieldOff, ChevronUp, ChevronDown } from 'lucide-react';
import * as XLSX from 'xlsx';
import { api } from '../../api/client';

const fmt   = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtN  = v => Number(v || 0).toLocaleString('pt-BR');
const fmtBr = iso => (iso ? iso.split('-').reverse().join('/') : '');

const FAIXAS = [
  { k: 'todas',  l: 'Todas'    },
  { k: 'd0_30',  l: 'Até 30d'  },
  { k: 'd31_60', l: '31-60d'   },
  { k: 'd61_90', l: '61-90d'   },
  { k: 'd90p',   l: '90+ dias' }
];

// rotulo do motivo de isencao (mesma regra da rotina de bloqueio)
const ISENTO_LABEL = { INTERNO: 'INTERNO', GRUPO: 'GRUPO ISENTO' };

// [01/07/2026] Segmento por codigo de acao (GLO_ACAO.ACAO_BO_CREC)
//   vendas = SO o que gera receita (ACAO_BO_CREC='S') | faturamento = nao gera | geral = todos
const SEGMENTOS = [
  { k: 'vendas',      l: 'Só o que gera receita' },
  { k: 'faturamento', l: 'Não gera receita' },
  { k: 'geral',       l: 'Todos' }
];

// [09/10/2026 - Alexandre Carvalho] Segmento da FILIAL (CCS_TB_GFIN_BI_EMPRESA, a mesma do BI Fechamento).
// Nao confundir com o "Segmento" acima (codigo de acao / receita).
const SEG_NOME = { IND: 'Indústria', VAR: 'Varejo', CD: 'CD', DIST: 'Distribuidora', SERV: 'Serviços', '(sem)': 'Sem segmento' };
const segLabel = k => (SEG_NOME[k] ? `${k} - ${SEG_NOME[k]}` : k);

// [09/10/2026 - Alexandre Carvalho] Ordenacao por coluna (pedido do financeiro: "nao consigo ordenar por
// cliente, vencimento, valor"). Mesmo padrao do LiberacaoBaixa (SORTS + Th).
const SORTS = {
  cliente:   t => (t.cliente || '').toLowerCase(),
  fil_id:    t => t.fil_id,
  segmento:  t => t.segmento,
  documento: t => t.documento,
  tipo:      t => t.tipo,
  forma:     t => (t.forma || '').toLowerCase(),
  vencto:    t => t.prorrogado || t.vencto || '',
  dias:      t => t.dias_atraso,
  saldo:     t => t.saldo
};
const SORTS_CLI = {
  cliente: c => (c.cliente || '').toLowerCase(),
  total:   c => c.total,
  qt:      c => c.qt,
  atraso:  c => Math.max(...c.formas.map(f => f.maior_atraso))
};
const ordena = (arr, ex, asc) => [...arr].sort((a, b) => {
  const va = ex(a), vb = ex(b);
  const c = va < vb ? -1 : va > vb ? 1 : 0;
  return asc ? c : -c;
});

export default function ClientesAtraso() {
  const [resp,     setResp]     = useState(null);
  const [busy,     setBusy]     = useState(true);
  const [erro,     setErro]     = useState('');
  const [busca,    setBusca]    = useState('');
  const [faixa,    setFaixa]    = useState('todas');
  const [receita,  setReceita]  = useState('geral');            // [01/07/2026] segmento por codigo de acao
  const [incluirIsentos, setIncluirIsentos] = useState(false);  // incluir quem a regra nao bloqueia?
  // [21/09/2026 - Alexandre Carvalho] Pedido Renata/Quality (doc "BI Financeiro - Melhorias"):
  // filtros por PERIODO (vencimento), FILIAL e FORMA DE RECEBIMENTO + visao agrupada CLIENTE x FORMA.
  // Tudo sobre a lista ja carregada (mesmo modelo de faixa/busca/isentos) - sem nova ida ao banco.
  const [dtIni,  setDtIni]  = useState('');         // vencimento de  ('' = sem limite)
  const [dtFim,  setDtFim]  = useState('');         // vencimento ate ('' = sem limite)
  const [filial, setFilial] = useState('todas');
  const [forma,  setForma]  = useState('todas');
  const [visao,  setVisao]  = useState('titulos');  // 'titulos' | 'clientes' | 'segmentos'
  const [seg,    setSeg]    = useState('todos');    // [09/10/2026] IND x VAR (segmento da filial)
  const [sort,    setSort]    = useState({ k: 'saldo', asc: false });   // grade de titulos
  const [sortCli, setSortCli] = useState({ k: 'total', asc: false });   // grade cliente x forma
  const alternaSort    = k => setSort(s => s.k === k ? { k, asc: !s.asc } : { k, asc: k === 'cliente' || k === 'documento' });
  const alternaSortCli = k => setSortCli(s => s.k === k ? { k, asc: !s.asc } : { k, asc: k === 'cliente' });

  async function carregar() {
    setBusy(true); setErro('');
    try { setResp(await api.inadClientesAtraso(receita)); }
    catch (e) { setErro(e.message || 'Erro ao carregar títulos em atraso'); setResp(null); }
    finally { setBusy(false); }
  }
  useEffect(() => { carregar(); }, [receita]);  // re-busca ao trocar o segmento

  // [21/09/2026 - Alexandre Carvalho] opcoes dos selects saem dos proprios titulos (com contagem)
  const opcoes = useMemo(() => {
    const fil = new Map(), frm = new Map(), sgs = new Map();
    for (const t of resp?.titulos || []) {
      sgs.set(t.segmento, (sgs.get(t.segmento) || 0) + 1);
      const f = fil.get(t.fil_id) || { id: t.fil_id, nome: t.fil_nome, qt: 0 }; f.qt++; fil.set(t.fil_id, f);
      const m = frm.get(t.forma)  || { nome: t.forma, qt: 0 };                  m.qt++; frm.set(t.forma, m);
    }
    return {
      filiais: [...fil.values()].sort((a, b) => a.id - b.id),
      formas:  [...frm.values()].sort((a, b) => b.qt - a.qt),
      segmentos: [...sgs.entries()].map(([k, qt]) => ({ k, qt })).sort((a, b) => b.qt - a.qt)
    };
  }, [resp]);

  // UNIVERSO = periodo + filial + forma. Os cards (KPIs) acompanham o universo; faixa, busca e
  // "incluir isentos" continuam sendo recortes DENTRO dele (como ja era).
  // Periodo pelo VENCIMENTO PRORROGADO (o mesmo que define o atraso e que a coluna mostra).
  const universo = useMemo(() => {
    if (!resp) return [];
    return resp.titulos.filter(t => {
      const venc = t.prorrogado || t.vencto || '';
      if (dtIni && venc < dtIni) return false;
      if (dtFim && venc > dtFim) return false;
      if (seg !== 'todos' && t.segmento !== seg) return false;
      if (filial !== 'todas' && String(t.fil_id) !== filial) return false;
      if (forma  !== 'todas' && t.forma !== forma) return false;
      return true;
    });
  }, [resp, dtIni, dtFim, filial, forma, seg]);

  const filtroAtivo = !!(dtIni || dtFim || filial !== 'todas' || forma !== 'todas' || seg !== 'todos');

  const linhas = useMemo(() => {
    if (!resp) return [];
    let arr = universo;
    if (!incluirIsentos) arr = arr.filter(t => !t.isento);
    if (faixa !== 'todas') arr = arr.filter(t => t.faixa === faixa);
    if (busca.trim()) {
      const q = busca.toLowerCase();
      arr = arr.filter(t =>
        String(t.agn_id).includes(q) ||
        (t.cliente || '').toLowerCase().includes(q) ||
        (t.documento || '').toLowerCase().includes(q)
      );
    }
    return ordena(arr, SORTS[sort.k] || SORTS.saldo, sort.asc);
  }, [resp, universo, incluirIsentos, faixa, busca, sort]);

  const totalFiltrado = useMemo(() => linhas.reduce((s, t) => s + t.saldo, 0), [linhas]);

  // [21/09/2026 - Alexandre Carvalho] Visao CLIENTE x FORMA: uma linha por (cliente, forma de recebimento)
  // com o total do cliente ao lado. Ordenado pelo total do cliente (maior primeiro).
  const grupos = useMemo(() => {
    const cli = new Map();
    for (const t of linhas) {
      const c = cli.get(t.agn_id) || { agn_id: t.agn_id, cliente: t.cliente, isento: t.isento, isento_motivo: t.isento_motivo, total: 0, qt: 0, formas: new Map() };
      c.total += t.saldo; c.qt++;
      const f = c.formas.get(t.forma) || { forma: t.forma, qt: 0, saldo: 0, maior_atraso: 0 };
      f.qt++; f.saldo += t.saldo; f.maior_atraso = Math.max(f.maior_atraso, t.dias_atraso);
      c.formas.set(t.forma, f); cli.set(t.agn_id, c);
    }
    const arr = [...cli.values()].map(c => ({ ...c, formas: [...c.formas.values()].sort((a, b) => b.saldo - a.saldo) }));
    return ordena(arr, SORTS_CLI[sortCli.k] || SORTS_CLI.total, sortCli.asc);
  }, [linhas, sortCli]);

  // [09/10/2026 - Alexandre Carvalho] Visao SEGMENTO x FILIAL: subtotal por segmento (IND/VAR/...) com as filiais dentro
  const porSegmento = useMemo(() => {
    const sm = new Map();
    for (const t of linhas) {
      const s = sm.get(t.segmento) || { seg: t.segmento, total: 0, qt: 0, clientes: new Set(), filiais: new Map() };
      s.total += t.saldo; s.qt++; s.clientes.add(t.agn_id);
      const f = s.filiais.get(t.fil_id) || { fil_id: t.fil_id, fil_nome: t.fil_nome, total: 0, qt: 0, clientes: new Set(), v90: 0 };
      f.total += t.saldo; f.qt++; f.clientes.add(t.agn_id); if (t.faixa === 'd90p') f.v90 += t.saldo;
      s.filiais.set(t.fil_id, f); sm.set(t.segmento, s);
    }
    return [...sm.values()].sort((a, b) => b.total - a.total)
      .map(s => ({ ...s, filiais: [...s.filiais.values()].sort((a, b) => b.total - a.total) }));
  }, [linhas]);

  // KPIs sobre o UNIVERSO (mesma regra do servidor: so quem a regra bloqueia; isentos a parte).
  // Sem filtro ativo o resultado e identico ao kpi que a API devolve.
  const kpi = useMemo(() => {
    if (!resp) return null;
    const bloq = universo.filter(t => !t.isento), isen = universo.filter(t => t.isento);
    const soma = arr => arr.reduce((s, t) => s + t.saldo, 0);
    return {
      qt_titulos: bloq.length, qt_clientes: new Set(bloq.map(t => t.agn_id)).size, vl_total: soma(bloq),
      vl_90p: soma(bloq.filter(t => t.faixa === 'd90p')),
      qt_titulos_isentos: isen.length, vl_isentos: soma(isen)
    };
  }, [resp, universo]);

  function exportXlsx() {
    const wb = XLSX.utils.book_new();
    // [21/09/2026 - Alexandre Carvalho] exporta a visao que esta na tela; a aba de titulos ganhou Filial (nome) e Forma
    if (visao === 'segmentos') {
      const dados = porSegmento.flatMap(sg => [
        { Segmento: segLabel(sg.seg), Filial: 'TOTAL', 'Nome da filial': '', Clientes: sg.clientes.size, 'Títulos': sg.qt,
          'Vencidos 90+': sg.filiais.reduce((s, f) => s + f.v90, 0), 'Saldo em atraso': sg.total },
        ...sg.filiais.map(f => ({ Segmento: segLabel(sg.seg), Filial: f.fil_id, 'Nome da filial': f.fil_nome, Clientes: f.clientes.size,
          'Títulos': f.qt, 'Vencidos 90+': f.v90, 'Saldo em atraso': f.total }))
      ]);
      const ws = XLSX.utils.json_to_sheet(dados);
      ws['!cols'] = [ {wch:22},{wch:8},{wch:30},{wch:10},{wch:9},{wch:16},{wch:16} ];
      XLSX.utils.book_append_sheet(wb, ws, 'Segmento x Filial');
    } else if (visao === 'clientes') {
      const dados = grupos.flatMap(c => c.formas.map(f => ({
        'Cód. Cliente':        c.agn_id,
        Cliente:               c.cliente,
        'Forma de recebimento': f.forma,
        'Títulos':             f.qt,
        'Maior atraso (dias)': f.maior_atraso,
        'Saldo na forma':      f.saldo,
        'Total do cliente':    c.total,
        'Isento do bloqueio':  c.isento ? (ISENTO_LABEL[c.isento_motivo] || 'Sim') : 'Não'
      })));
      const ws = XLSX.utils.json_to_sheet(dados);
      ws['!cols'] = [ {wch:12},{wch:48},{wch:30},{wch:9},{wch:18},{wch:16},{wch:16},{wch:18} ];
      XLSX.utils.book_append_sheet(wb, ws, 'Cliente x Forma');
    } else {
      const dados = linhas.map(t => ({
        'Cód. Cliente':   t.agn_id,
        Cliente:          t.cliente,
        Filial:           t.fil_id,
        'Nome da filial': t.fil_nome,
        Segmento:         segLabel(t.segmento),
        Documento:        t.documento,
        Parcela:          t.parcela,
        Tipo:             t.tipo,
        'Forma de recebimento': t.forma,
        Vencimento:       fmtBr(t.vencto),
        'Venc. prorrogado': fmtBr(t.prorrogado),
        'Dias em atraso': t.dias_atraso,
        'Saldo em aberto': t.saldo,
        'Isento do bloqueio': t.isento ? (ISENTO_LABEL[t.isento_motivo] || 'Sim') : 'Não'
      }));
      const ws = XLSX.utils.json_to_sheet(dados);
      ws['!cols'] = [ {wch:12},{wch:48},{wch:8},{wch:28},{wch:20},{wch:14},{wch:8},{wch:10},{wch:30},{wch:12},{wch:16},{wch:14},{wch:16},{wch:18} ];
      XLSX.utils.book_append_sheet(wb, ws, 'Clientes em Atraso');
    }
    XLSX.writeFile(wb, `clientes-em-atraso-${visao === 'clientes' ? 'por-cliente-' : visao === 'segmentos' ? 'por-segmento-' : ''}${new Date().toISOString().slice(0,10)}.xlsx`);
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-prim-400">Inadimplência · Clientes em Atraso</h1>
        <p className="text-sm text-gray-400">
          Títulos em atraso pelo critério da regra de bloqueio: saldo em aberto, vencimento
          prorrogado há mais de 2 dias, exceto previstos (PDV). Clientes que a regra <b>não
          bloqueia</b> (internos e grupo de crédito isento) ficam ocultos por padrão.
        </p>
      </div>

      {/* [01/07/2026] Segmento por codigo de acao (GLO_ACAO.ACAO_BO_CREC) */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs uppercase text-gray-400 mr-1">Segmento:</span>
        {SEGMENTOS.map(s => (
          <button key={s.k}
            className={`px-3 py-1.5 rounded text-sm transition
              ${receita === s.k ? 'bg-prim-600 text-white' : 'bg-ink-800 hover:bg-ink-700 text-gray-300'}`}
            onClick={() => setReceita(s.k)}>
            {s.l}
          </button>
        ))}
        {busy && <span className="text-xs text-gray-500 ml-1">carregando…</span>}
      </div>

      {/* [21/09/2026 - Alexandre Carvalho] Filtros pedidos pela Renata: periodo (vencimento), filial e forma de recebimento */}
      {resp && (
        <div className="card p-3 flex flex-wrap items-end gap-3">
          <div className="flex items-center gap-2 text-prim-400 font-semibold text-sm pb-1.5">
            <Filter size={16} /> Filtros
          </div>
          <label className="block">
            <span className="text-xs text-gray-300">Vencimento de</span>
            <input type="date" className="input mt-1" value={dtIni} max={dtFim || undefined} onChange={e => setDtIni(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-xs text-gray-300">até</span>
            <input type="date" className="input mt-1" value={dtFim} min={dtIni || undefined} onChange={e => setDtFim(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-xs text-gray-300">Indústria × Varejo</span>
            <select className="input mt-1" value={seg} onChange={e => { setSeg(e.target.value); setFilial('todas'); }}>
              <option value="todos">Todos os segmentos</option>
              {opcoes.segmentos.map(s => (
                <option key={s.k} value={s.k}>{segLabel(s.k)} ({fmtN(s.qt)})</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-gray-300">Filial</span>
            <select className="input mt-1" value={filial} onChange={e => setFilial(e.target.value)}>
              <option value="todas">Todas</option>
              {opcoes.filiais.filter(f => seg === 'todos' || (resp.titulos.find(t => t.fil_id === f.id) || {}).segmento === seg).map(f => (
                <option key={f.id} value={String(f.id)}>{f.id}{f.nome ? ` - ${f.nome}` : ''} ({fmtN(f.qt)})</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-gray-300">Forma de recebimento</span>
            <select className="input mt-1" value={forma} onChange={e => setForma(e.target.value)}>
              <option value="todas">Todas</option>
              {opcoes.formas.map(f => (
                <option key={f.nome} value={f.nome}>{f.nome} ({fmtN(f.qt)})</option>
              ))}
            </select>
          </label>
          {filtroAtivo && (
            <button className="btn-ghost mb-0.5" onClick={() => { setDtIni(''); setDtFim(''); setFilial('todas'); setForma('todas'); setSeg('todos'); }}>
              Limpar filtros
            </button>
          )}
          <span className="text-[11px] text-gray-500 pb-2 ml-auto">
            O período usa o <b className="text-gray-400">vencimento prorrogado</b>, o mesmo que define o atraso. Os cards acompanham estes filtros.
          </span>
        </div>
      )}

      {erro &&<div className="bg-red-900/40 text-red-200 text-sm rounded p-3">{erro}</div>}

      {/* KPIs */}
      {kpi && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Kpi icon={<AlertTriangle size={16} />} label="Títulos em atraso" value={fmtN(kpi.qt_titulos)}
               sub={`${fmtN(kpi.qt_clientes)} cliente(s) bloqueável(is)`} color="acc" />
          <Kpi icon={<Users size={16} />} label="Valor total em atraso" value={fmt(kpi.vl_total)}
               sub="clientes que a regra bloqueia" color="rose" />
          <Kpi icon={<Clock size={16} />} label="Vencidos há 90+ dias" value={fmt(kpi.vl_90p)}
               sub={`${kpi.vl_total > 0 ? Math.round(kpi.vl_90p / kpi.vl_total * 100) : 0}% do total`} color="rose" />
          <Kpi icon={<ShieldOff size={16} />} label="Não bloqueados pela regra" value={fmtN(kpi.qt_titulos_isentos)}
               sub={`${fmt(kpi.vl_isentos)} — internos + grupo isento`} color="prim" />
        </div>
      )}

      {/* Filtros + tabela */}
      {resp && (
        <div className="card overflow-hidden">
          <div className="bg-ink-900 px-4 py-3 border-b border-ink-700 flex flex-wrap gap-2 items-center">
            {/* [21/09/2026 - Alexandre Carvalho] visao por titulo ou agrupada cliente x forma de recebimento */}
            <div className="flex gap-1 mr-2">
              {[{ k: 'titulos', l: 'Títulos' }, { k: 'clientes', l: 'Por cliente × forma' }, { k: 'segmentos', l: 'Por segmento × filial' }].map(v => (
                <button key={v.k}
                  className={`px-3 py-1 rounded text-sm font-semibold transition
                    ${visao === v.k ? 'bg-prim-600 text-white' : 'bg-ink-800 hover:bg-ink-700 text-gray-300'}`}
                  onClick={() => setVisao(v.k)}>
                  {v.l}
                </button>
              ))}
            </div>
            <div className="flex gap-1">
              {FAIXAS.map(f => (
                <button key={f.k}
                  className={`px-3 py-1 rounded text-xs transition
                    ${faixa === f.k ? 'bg-prim-600 text-white' : 'bg-ink-800 hover:bg-ink-700 text-gray-300'}`}
                  onClick={() => setFaixa(f.k)}>
                  {f.l}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-1.5 text-xs text-gray-300 ml-2 cursor-pointer">
              <input type="checkbox" checked={incluirIsentos}
                     onChange={e => setIncluirIsentos(e.target.checked)} />
              incluir clientes que a regra não bloqueia
            </label>
            <div className="ml-auto flex items-center gap-2 bg-ink-800 px-2 rounded">
              <Search size={14} className="text-gray-500" />
              <input className="bg-transparent outline-none py-1 text-sm w-56"
                     placeholder="Buscar cliente, código ou documento..."
                     value={busca} onChange={e => setBusca(e.target.value)} />
            </div>
            <button className="btn-ghost" onClick={exportXlsx} disabled={linhas.length === 0}>
              <FileSpreadsheet size={16} /> Excel
            </button>
          </div>

          <div className="px-4 py-2 bg-ink-900/50 border-b border-ink-700 text-xs text-gray-400 flex gap-4">
            <span>{fmtN(linhas.length)} título(s) no filtro</span>
            {visao === 'clientes' && <span>{fmtN(grupos.length)} cliente(s)</span>}
            <span>Soma: <span className="text-rose-300 font-mono">{fmt(totalFiltrado)}</span></span>
          </div>

          {/* [21/09/2026 - Alexandre Carvalho] Visao CLIENTE x FORMA: total do cliente + quebra por forma de recebimento */}
          {visao === 'clientes' && (
            <div className="overflow-auto max-h-[58vh]">
              <table className="w-full text-sm">
                <thead className="bg-ink-900/70 text-gray-400 uppercase text-xs sticky top-0">
                  <tr>
                    <Th k="cliente" sort={sortCli} onSort={alternaSortCli} className="text-left pl-4">Cliente</Th>
                    <Th k="total" sort={sortCli} onSort={alternaSortCli} className="text-right">Total do cliente</Th>
                    <th className="text-left p-2 pl-6">Forma de recebimento</th>
                    <Th k="qt" sort={sortCli} onSort={alternaSortCli} className="text-right">Títulos</Th>
                    <Th k="atraso" sort={sortCli} onSort={alternaSortCli} className="text-right">Maior atraso</Th>
                    <th className="text-right p-2 pr-4">Saldo na forma</th>
                  </tr>
                </thead>
                <tbody>
                  {grupos.map(c => c.formas.map((f, j) => (
                    <tr key={`${c.agn_id}-${f.forma}`} className={`hover:bg-ink-800/40 ${j === 0 ? 'border-t border-ink-700' : ''}`}>
                      {j === 0 && (
                        <>
                          <td className="p-2 pl-4 align-top" rowSpan={c.formas.length}>
                            <div className="text-gray-200 flex items-center gap-1.5">
                              {c.cliente}
                              {c.isento && (
                                <span className="text-[9px] px-1 py-0.5 rounded bg-ink-700 text-gray-400">
                                  {ISENTO_LABEL[c.isento_motivo] || 'ISENTO'}
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-gray-500 font-mono">cód. {c.agn_id} · {fmtN(c.qt)} título(s)</div>
                          </td>
                          <td className="p-2 text-right font-mono font-bold text-rose-300 align-top" rowSpan={c.formas.length}>{fmt(c.total)}</td>
                        </>
                      )}
                      <td className="p-2 pl-6 text-xs text-gray-300">{f.forma}</td>
                      <td className="p-2 text-right font-mono text-xs text-gray-400">{fmtN(f.qt)}</td>
                      <td className="p-2 text-right font-mono text-xs">
                        <span className={f.maior_atraso > 90 ? 'text-rose-400 font-bold'
                                        : f.maior_atraso > 60 ? 'text-orange-400'
                                        : f.maior_atraso > 30 ? 'text-amber-400' : 'text-gray-300'}>
                          {fmtN(f.maior_atraso)} d
                        </span>
                      </td>
                      <td className="p-2 pr-4 text-right font-mono text-rose-300">{fmt(f.saldo)}</td>
                    </tr>
                  )))}
                  {grupos.length === 0 && (
                    <tr><td colSpan={6} className="p-8 text-center text-gray-500">
                      {busy ? 'Carregando...' : 'Nenhum cliente no filtro selecionado.'}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* [09/10/2026 - Alexandre Carvalho] Visao SEGMENTO x FILIAL (IND x VAR) com subtotais */}
          {visao === 'segmentos' && (
            <div className="overflow-auto max-h-[58vh]">
              <table className="w-full text-sm">
                <thead className="bg-ink-900/70 text-gray-400 uppercase text-xs sticky top-0">
                  <tr>
                    <th className="text-left p-2 pl-4">Segmento / Filial</th>
                    <th className="text-right p-2">Clientes</th>
                    <th className="text-right p-2">Títulos</th>
                    <th className="text-right p-2">Vencidos 90+</th>
                    <th className="text-right p-2">% do total</th>
                    <th className="text-right p-2 pr-4">Saldo em atraso</th>
                  </tr>
                </thead>
                <tbody>
                  {porSegmento.map(sg => (
                    <React.Fragment key={sg.seg}>
                      <tr className="border-t-2 border-ink-600 bg-ink-800/60">
                        <td className="p-2 pl-4 font-semibold text-prim-300">{segLabel(sg.seg)}</td>
                        <td className="p-2 text-right font-mono text-gray-300">{fmtN(sg.clientes.size)}</td>
                        <td className="p-2 text-right font-mono text-gray-300">{fmtN(sg.qt)}</td>
                        <td className="p-2 text-right font-mono text-gray-300">{fmt(sg.filiais.reduce((s, f) => s + f.v90, 0))}</td>
                        <td className="p-2 text-right font-mono text-gray-300">{totalFiltrado > 0 ? (sg.total / totalFiltrado * 100).toFixed(1) : '0.0'}%</td>
                        <td className="p-2 pr-4 text-right font-mono font-bold text-rose-300">{fmt(sg.total)}</td>
                      </tr>
                      {sg.filiais.map(f => (
                        <tr key={`${sg.seg}-${f.fil_id}`} className="border-t border-ink-700 hover:bg-ink-800/40">
                          <td className="p-2 pl-10 text-xs text-gray-300"><span className="font-mono text-gray-400">{f.fil_id}</span>{f.fil_nome ? ` - ${f.fil_nome}` : ''}</td>
                          <td className="p-2 text-right font-mono text-xs text-gray-400">{fmtN(f.clientes.size)}</td>
                          <td className="p-2 text-right font-mono text-xs text-gray-400">{fmtN(f.qt)}</td>
                          <td className="p-2 text-right font-mono text-xs text-gray-400">{fmt(f.v90)}</td>
                          <td className="p-2 text-right font-mono text-xs text-gray-400">{totalFiltrado > 0 ? (f.total / totalFiltrado * 100).toFixed(1) : '0.0'}%</td>
                          <td className="p-2 pr-4 text-right font-mono text-rose-300">{fmt(f.total)}</td>
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                  {porSegmento.length === 0 && (
                    <tr><td colSpan={6} className="p-8 text-center text-gray-500">
                      {busy ? 'Carregando...' : 'Nenhum título no filtro selecionado.'}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {visao === 'titulos' && (
          <div className="overflow-auto max-h-[58vh]">
            <table className="w-full text-sm">
              <thead className="bg-ink-900/70 text-gray-400 uppercase text-xs sticky top-0">
                <tr>
                  <Th k="cliente"   sort={sort} onSort={alternaSort} className="text-left pl-4">Cliente</Th>
                  <Th k="fil_id"    sort={sort} onSort={alternaSort} className="text-center">Filial</Th>
                  <Th k="segmento"  sort={sort} onSort={alternaSort} className="text-center">Seg.</Th>
                  <Th k="documento" sort={sort} onSort={alternaSort} className="text-left">Documento</Th>
                  <Th k="tipo"      sort={sort} onSort={alternaSort} className="text-left">Tipo</Th>
                  <Th k="forma"     sort={sort} onSort={alternaSort} className="text-left">Forma receb.</Th>
                  <Th k="vencto"    sort={sort} onSort={alternaSort} className="text-center">Vencimento</Th>
                  <Th k="dias"      sort={sort} onSort={alternaSort} className="text-right">Dias atraso</Th>
                  <Th k="saldo"     sort={sort} onSort={alternaSort} className="text-right pr-4">Saldo em aberto</Th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((t, i) => (
                  <tr key={i} className="border-t border-ink-700 hover:bg-ink-800/40">
                    <td className="p-2 pl-4">
                      <div className="text-gray-200 flex items-center gap-1.5">
                        {t.cliente}
                        {t.isento && (
                          <span className="text-[9px] px-1 py-0.5 rounded bg-ink-700 text-gray-400">
                            {ISENTO_LABEL[t.isento_motivo] || 'ISENTO'}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 font-mono">cód. {t.agn_id}</div>
                    </td>
                    <td className="p-2 text-center font-mono text-xs text-gray-400" title={t.fil_nome || ''}>{t.fil_id}</td>
                    <td className="p-2 text-center text-[11px] text-gray-400" title={SEG_NOME[t.segmento] || ''}>{t.segmento}</td>
                    <td className="p-2 font-mono text-xs text-gray-300">
                      {t.documento}{t.parcela ? <span className="text-gray-500">/{t.parcela}</span> : ''}
                    </td>
                    <td className="p-2 text-xs text-gray-400">{t.tipo}</td>
                    <td className="p-2 text-xs text-gray-300">{t.forma}</td>
                    <td className="p-2 text-center text-xs text-gray-300">
                      {fmtBr(t.prorrogado || t.vencto)}
                    </td>
                    <td className="p-2 text-right font-mono">
                      <span className={t.dias_atraso > 90 ? 'text-rose-400 font-bold'
                                      : t.dias_atraso > 60 ? 'text-orange-400'
                                      : t.dias_atraso > 30 ? 'text-amber-400' : 'text-gray-300'}>
                        {fmtN(t.dias_atraso)}
                      </span>
                    </td>
                    <td className="p-2 pr-4 text-right font-mono font-semibold text-rose-300">{fmt(t.saldo)}</td>
                  </tr>
                ))}
                {linhas.length === 0 && (
                  <tr><td colSpan={9} className="p-8 text-center text-gray-500">
                    {busy ? 'Carregando...' : 'Nenhum título no filtro selecionado.'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          )}
        </div>
      )}

      {busy && !resp && <div className="text-gray-400 text-sm">Carregando títulos em atraso...</div>}
    </div>
  );
}

function Kpi({ icon, label, value, sub, color = 'prim' }) {
  const map = {
    prim: { border: 'border-prim-500', text: 'text-prim-400' },
    acc:  { border: 'border-acc-500',  text: 'text-acc-500'  },
    rose: { border: 'border-rose-500', text: 'text-rose-400' }
  };
  const c = map[color] || map.prim;
  return (
    <div className={`kpi border-l-4 ${c.border}`}>
      <div className="kpi-label flex items-center gap-1">{icon} {label}</div>
      <div className={`kpi-value ${c.text}`}>{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}

// [09/10/2026 - Alexandre Carvalho] cabecalho clicavel (mesmo do LiberacaoBaixa)
function Th({ k, sort, onSort, className = '', children }) {
  const ativo = sort.k === k;
  return (
    <th className={`p-2 select-none cursor-pointer whitespace-nowrap hover:text-gray-200 ${className}`}
        onClick={() => onSort(k)} title="Clique para ordenar">
      <span className="inline-flex items-center gap-0.5">
        {children}
        {ativo && (sort.asc ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
      </span>
    </th>
  );
}
