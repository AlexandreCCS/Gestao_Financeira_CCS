// [25/10/2026 - CRIADO POR ALEXANDRE CARVALHO] Frete › Veículos.
// Frota cadastrada no Mega: identificação, tipo (classificação do Mega e a da CCS usada no frete), propriedade,
// controle de combustível e abastecimento em posto próprio. Combustível e posto próprio NÃO existem no Mega da
// Quality: são informação do Gestor (CCS_TB_GFIN_VEICULO), marcada Sim/Não na própria linha; a propriedade vem do
// cadastro do Mega e, quando ele não diz, pode ser informada no Gestor (painel de detalhe). O cadastro do ERP não muda.
// Etiquetas: PRÓPRIO / TERCEIRO / NÃO IDENTIFICADO · CONTROLADO: SIM/NÃO/NI · POSTO PRÓPRIO: SIM/NÃO/NI.
import React, { useEffect, useMemo, useState } from 'react';
import {
  Truck, Search, Download, Info, AlertTriangle, X, ChevronLeft, ChevronRight, Building2, Users, Fuel, Droplets, Ban, HelpCircle
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { api } from '../../api/client';

const fmtN  = v => Number(v || 0).toLocaleString('pt-BR');
const fmtBr = s => (s ? s.slice(0, 10).split('-').reverse().join('/') : '—');
const POR_PAG = 50;

// valor de etiqueta: 'S' | 'N' | 'NI' (não identificado)
const sn = v => (v === true ? 'S' : v === false ? 'N' : 'NI');

export default function Veiculos() {
  const [dados, setDados]   = useState(null);     // { veiculos, limitacoes }
  const [erro, setErro]     = useState('');
  const [busca, setBusca]   = useState('');
  const [fTipoCcs, setFTipoCcs] = useState('');   // '' | 3/4 | TOCO | TRUCK | CARRETA | (vazio)
  const [fTipoMega, setFTipoMega] = useState(''); // '' | Truck | Toco | ... | (vazio)
  const [fTpveic, setFTpveic] = useState('');     // '' | T | R
  const [fProp, setFProp]   = useState('');       // '' | PROPRIO | TERCEIRO | NI
  const [fComb, setFComb]   = useState('');       // '' | S | N | NI
  const [fPosto, setFPosto] = useState('');       // '' | S | N | NI
  const [fUso, setFUso]     = useState('');       // '' | 12m | nunca
  const [pag, setPag]       = useState(1);
  const [verLimites, setVerLimites] = useState(true);
  const [detalhe, setDetalhe] = useState(null);   // veículo com o painel de detalhes aberto
  const [gravando, setGravando] = useState('');   // `${seq}:${campo}` em gravação

  useEffect(() => {
    api.veiculos().then(setDados).catch(() => { setDados({ veiculos: [], limitacoes: {} }); setErro('Falha ao carregar os veículos.'); });
  }, []);

  // Grava uma informação do Gestor (combustível, posto próprio, propriedade) e reflete na lista sem recarregar tudo.
  // valor: 'S' | 'N' | 'P' | 'T' | null (limpa)
  const gravaCampo = (v, campo, valor) => {
    const chave = `${v.seq}:${campo}`;
    if (gravando) return;
    setGravando(chave); setErro('');
    return api.veiculosCampo(v.seq, { campo, valor })
      .then(() => {
        const agora = new Date();
        const em = `${agora.toISOString().slice(0, 10)} ${agora.toTimeString().slice(0, 5)}`;
        setDados(d => ({ ...d, veiculos: d.veiculos.map(x => {
          if (x.seq !== v.seq) return x;
          const n = { ...x, gestor: { ...x.gestor, em, por: 'você' } };
          if (campo === 'COMBUSTIVEL')   n.combustivel   = valor === 'S' ? true : valor === 'N' ? false : null;
          if (campo === 'POSTO_PROPRIO') n.posto_proprio = valor === 'S' ? true : valor === 'N' ? false : null;
          if (campo === 'PROPRIEDADE') {
            n.gestor.propriedade = valor || '';
            if (x.propriedade_fonte !== 'MEGA') {
              n.propriedade = valor === 'P' ? 'PROPRIO' : valor === 'T' ? 'TERCEIRO' : 'NI';
              n.propriedade_fonte = valor ? 'GESTOR' : '';
              n.propriedade_motivo = valor ? `Informado no Gestor por você em ${em}` : 'Mega não informa e o Gestor não tem marcação';
            }
          }
          if (detalhe && detalhe.seq === x.seq) setDetalhe(n);
          return n;
        }) }));
      })
      .catch(e => setErro(e?.message || 'Falha ao gravar.'))
      .finally(() => setGravando(''));
  };
  useEffect(() => { setPag(1); }, [busca, fTipoCcs, fTipoMega, fTpveic, fProp, fComb, fPosto, fUso]);

  const lista = dados?.veiculos || null;

  // opções dos filtros de tipo vêm dos valores realmente cadastrados
  const tiposCcs  = useMemo(() => [...new Set((lista || []).map(v => v.tipo_ccs).filter(Boolean))].sort(), [lista]);
  const tiposMega = useMemo(() => [...new Set((lista || []).map(v => v.tipo_mega).filter(Boolean))].sort(), [lista]);

  const filtrados = useMemo(() => {
    if (!lista) return [];
    const q = busca.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    return lista.filter(v => {
      if (fTipoCcs  && (fTipoCcs  === '(vazio)' ? v.tipo_ccs  !== '' : v.tipo_ccs  !== fTipoCcs))  return false;
      if (fTipoMega && (fTipoMega === '(vazio)' ? v.tipo_mega !== '' : v.tipo_mega !== fTipoMega)) return false;
      if (fTpveic && v.tpveic !== fTpveic) return false;
      if (fProp   && v.propriedade !== fProp) return false;
      if (fComb   && sn(v.combustivel) !== fComb) return false;
      if (fPosto  && sn(v.posto_proprio) !== fPosto) return false;
      if (fUso === '12m'   && v.rom_12m === 0) return false;
      if (fUso === 'nunca' && v.rom_total > 0) return false;
      if (q) {
        const alvo = `${v.placa}${v.cint}${v.seq}${v.renavam}`.toUpperCase().replace(/[^A-Z0-9]/g, '');
        const desc = `${v.tpveic_desc} ${v.tipo_mega} ${v.carroceria} ${v.tipo_ccs}`.toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (!alvo.includes(q) && !desc.includes(q)) return false;
      }
      return true;
    });
  }, [lista, busca, fTipoCcs, fTipoMega, fTpveic, fProp, fComb, fPosto, fUso]);

  // indicadores respeitam os filtros; NI contado à parte, nunca como SIM ou NÃO
  const tot = useMemo(() => {
    const c = { total: filtrados.length, proprio: 0, terceiro: 0, propNi: 0, combS: 0, combN: 0, combNi: 0, postoS: 0, postoN: 0, postoNi: 0 };
    for (const v of filtrados) {
      if (v.propriedade === 'PROPRIO') c.proprio++; else if (v.propriedade === 'TERCEIRO') c.terceiro++; else c.propNi++;
      const cb = sn(v.combustivel);  if (cb === 'S') c.combS++;  else if (cb === 'N') c.combN++;  else c.combNi++;
      const po = sn(v.posto_proprio); if (po === 'S') c.postoS++; else if (po === 'N') c.postoN++; else c.postoNi++;
    }
    return c;
  }, [filtrados]);

  const totalPag = Math.max(1, Math.ceil(filtrados.length / POR_PAG));
  const pagAtual = Math.min(pag, totalPag);
  const visiveis = filtrados.slice((pagAtual - 1) * POR_PAG, pagAtual * POR_PAG);
  const limpar = () => { setBusca(''); setFTipoCcs(''); setFTipoMega(''); setFTpveic(''); setFProp(''); setFComb(''); setFPosto(''); setFUso(''); };
  const temFiltro = busca || fTipoCcs || fTipoMega || fTpveic || fProp || fComb || fPosto || fUso;

  const exportar = () => {
    const linhas = filtrados.map(v => ({
      'Código': v.seq, 'Placa': v.placa, 'Tração/Reboque': v.tpveic_desc, 'Tipo (Mega)': v.tipo_mega || '',
      'Tipo (CCS/frete)': v.tipo_ccs || '', 'Carroceria': v.carroceria || '', 'UF': v.uf,
      'Propriedade': rotProp(v.propriedade), 'Motivo da propriedade': v.propriedade_motivo,
      'Combustível controlado': rotSn(sn(v.combustivel)), 'Posto próprio': rotSn(sn(v.posto_proprio)),
      'Romaneios 12 meses': v.rom_12m, 'Romaneios (total)': v.rom_total, 'Último romaneio': fmtBr(v.ult_rom),
      'Tara': v.tara ?? '', 'Cap. kg': v.capkg ?? '', 'Cap. m³': v.capm3 ?? '', 'RENAVAM': v.renavam
    }));
    const ws = XLSX.utils.json_to_sheet(linhas);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Veículos');
    XLSX.writeFile(wb, `veiculos_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const sel = 'bg-ink-800 text-xs text-gray-300 rounded px-2 py-1.5 outline-none';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-100 flex items-center gap-2">
            <Truck size={20} className="text-prim-400" /> Veículos
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Frota cadastrada no Mega (VEN_VEICULO + campos específicos). Combustível e posto próprio são marcados aqui, no Gestor;
            nada é alterado no ERP.
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost !py-1.5" onClick={() => setVerLimites(x => !x)} title="O que o Mega não tem">
            <Info size={14} /> Limitações
          </button>
          <button className="btn-ghost !py-1.5" onClick={exportar} disabled={!lista || filtrados.length === 0}>
            <Download size={14} /> Excel
          </button>
        </div>
      </div>

      {erro && (
        <div className="flex items-center gap-2 bg-rose-500/10 border border-rose-500/40 text-rose-300 text-sm rounded px-3 py-2">
          <AlertTriangle size={15} /> {erro}
          <button className="ml-auto" onClick={() => setErro('')}><X size={14} /></button>
        </div>
      )}

      {verLimites && dados?.limitacoes && (
        <div className="bg-acc-500/10 border border-acc-500/40 text-amber-200 text-xs rounded px-3 py-2 space-y-1">
          <div className="flex items-center gap-2 font-semibold"><Info size={14} /> O que o Mega da Quality não tem (aparece NÃO IDENTIFICADO até ser informado aqui)
            <button className="ml-auto text-amber-300/70 hover:text-amber-100" onClick={() => setVerLimites(false)}><X size={14} /></button>
          </div>
          <div><b>Controle de combustível:</b> {dados.limitacoes.combustivel_controlado}</div>
          <div><b>Posto próprio:</b> {dados.limitacoes.posto_proprio}</div>
          {dados.limitacoes.propriedade && <div><b>Propriedade:</b> {dados.limitacoes.propriedade}</div>}
          <div><b>Situação cadastral:</b> {dados.limitacoes.situacao_cadastral}</div>
        </div>
      )}

      {/* indicadores (respeitam os filtros) */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi icon={<Truck size={16} />}     label="Veículos"            value={lista ? fmtN(tot.total) : '…'} sub={temFiltro ? 'com os filtros' : 'cadastrados no Mega'} color="prim" />
        <Kpi icon={<Building2 size={16} />} label="Próprios"            value={lista ? fmtN(tot.proprio) : '…'} sub={`não identificados: ${fmtN(tot.propNi)}`} color="prim" />
        <Kpi icon={<Users size={16} />}     label="Terceiros"           value={lista ? fmtN(tot.terceiro) : '…'} color="acc" />
        <Kpi icon={<Fuel size={16} />}      label="Combustível controlado" value={lista ? fmtN(tot.combS) : '…'} sub={`não identificados: ${fmtN(tot.combNi)}`} color="prim" />
        <Kpi icon={<Ban size={16} />}       label="Sem controle de combustível" value={lista ? fmtN(tot.combN) : '…'} color="rose" />
        <Kpi icon={<Droplets size={16} />}  label="Posto próprio"       value={lista ? fmtN(tot.postoS) : '…'} sub={`não identificados: ${fmtN(tot.postoNi)}`} color="acc" />
      </div>

      <div className="card overflow-hidden">
        <div className="bg-ink-900 px-4 py-3 border-b border-ink-700 flex flex-wrap gap-2 items-center">
          <div className="flex items-center gap-2 bg-ink-800 px-2 rounded grow max-w-xs">
            <Search size={14} className="text-gray-500" />
            <input className="bg-transparent outline-none py-1.5 text-sm w-full" placeholder="Placa, código, RENAVAM ou descrição…"
                   value={busca} onChange={e => setBusca(e.target.value)} />
          </div>
          <select className={sel} value={fTpveic} onChange={e => setFTpveic(e.target.value)}>
            <option value="">Tração e reboque</option>
            <option value="T">Só tração</option>
            <option value="R">Só reboque</option>
          </select>
          <select className={sel} value={fTipoMega} onChange={e => setFTipoMega(e.target.value)}>
            <option value="">Tipo (Mega): todos</option>
            {tiposMega.map(t => <option key={t} value={t}>{t}</option>)}
            <option value="(vazio)">Sem tipo (Mega)</option>
          </select>
          <select className={sel} value={fTipoCcs} onChange={e => setFTipoCcs(e.target.value)}>
            <option value="">Tipo (CCS/frete): todos</option>
            {tiposCcs.map(t => <option key={t} value={t}>{t}</option>)}
            <option value="(vazio)">Sem tipo (CCS)</option>
          </select>
          <select className={sel} value={fProp} onChange={e => setFProp(e.target.value)}>
            <option value="">Propriedade: todas</option>
            <option value="PROPRIO">Próprio</option>
            <option value="TERCEIRO">Terceiro</option>
            <option value="NI">Não identificado</option>
          </select>
          <select className={sel} value={fComb} onChange={e => setFComb(e.target.value)}>
            <option value="">Combustível: todos</option>
            <option value="S">Controlado: sim</option>
            <option value="N">Controlado: não</option>
            <option value="NI">Não identificado</option>
          </select>
          <select className={sel} value={fPosto} onChange={e => setFPosto(e.target.value)}>
            <option value="">Posto próprio: todos</option>
            <option value="S">Posto próprio: sim</option>
            <option value="N">Posto próprio: não</option>
            <option value="NI">Não identificado</option>
          </select>
          <select className={sel} value={fUso} onChange={e => setFUso(e.target.value)}>
            <option value="">Uso: todos</option>
            <option value="12m">Com romaneio em 12 meses</option>
            <option value="nunca">Nunca usados em romaneio</option>
          </select>
          {temFiltro && <button className="text-xs text-gray-400 hover:text-gray-200 underline" onClick={limpar}>limpar</button>}
          <span className="text-xs text-gray-500 ml-auto">{lista ? `${fmtN(filtrados.length)} de ${fmtN(lista.length)}` : ''}</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-ink-900/70 text-gray-400 uppercase text-xs">
              <tr>
                <th className="p-2 text-left">Veículo</th>
                <th className="p-2 text-left">Placa</th>
                <th className="p-2 text-left" title="VEN_VEICULO.VCL_CH_TPROD (tipo de rodado) — vazio nos reboques">Tipo (Mega)</th>
                <th className="p-2 text-left" title="VEN_VEICULOCMPESP.VCL_TIPO_CAMINHAO — classificação usada pela tabela de frete">Tipo (CCS)</th>
                <th className="p-2 text-left">Propriedade</th>
                <th className="p-2 text-left">Combustível</th>
                <th className="p-2 text-left">Posto próprio</th>
                <th className="p-2 text-left" title="Não há situação cadastral no Mega; mostra o uso em romaneios de expedição">Uso</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {!lista && <tr><td colSpan={9} className="p-4 text-center text-gray-500">Carregando veículos…</td></tr>}
              {lista && visiveis.length === 0 && <tr><td colSpan={9} className="p-4 text-center text-gray-500">Nenhum veículo com esses filtros.</td></tr>}
              {visiveis.map(v => (
                <tr key={v.seq} className="border-t border-ink-800 hover:bg-ink-800/40">
                  <td className="p-2">
                    <div className="text-gray-200">{v.tpveic_desc || 'Veículo'}{v.carroceria ? ` · ${v.carroceria}` : ''}</div>
                    <div className="text-[11px] text-gray-500">cód. {v.seq}{v.cint ? ` · ${v.cint}` : ''}{v.uf ? ` · ${v.uf}` : ''}</div>
                  </td>
                  <td className="p-2 font-mono text-gray-100">{v.placa}</td>
                  <td className="p-2 text-gray-300">{v.tipo_mega || <span className="text-gray-600">—</span>}</td>
                  <td className="p-2">{v.tipo_ccs ? <span className="text-[11px] px-1.5 py-0.5 rounded bg-ink-700 text-gray-200 font-semibold">{v.tipo_ccs}</span> : <span className="text-gray-600">—</span>}</td>
                  <td className="p-2">
                    <EtqProp valor={v.propriedade} motivo={v.propriedade_motivo} />
                    {v.propriedade_fonte === 'GESTOR' && <div className="text-[10px] text-gray-500 mt-0.5">informado no Gestor</div>}
                  </td>
                  <td className="p-2">
                    <EtqSn prefixo="CONTROLADO" valor={sn(v.combustivel)} />
                    <SimNao valor={v.combustivel} ocupado={gravando === `${v.seq}:COMBUSTIVEL`} onChange={val => gravaCampo(v, 'COMBUSTIVEL', val)} />
                  </td>
                  <td className="p-2">
                    <EtqSn prefixo="POSTO PRÓPRIO" valor={sn(v.posto_proprio)} />
                    <SimNao valor={v.posto_proprio} ocupado={gravando === `${v.seq}:POSTO_PROPRIO`} onChange={val => gravaCampo(v, 'POSTO_PROPRIO', val)} />
                  </td>
                  <td className="p-2 text-xs text-gray-300">
                    {v.rom_total > 0
                      ? <>{fmtN(v.rom_12m)} em 12 m · último {fmtBr(v.ult_rom)}</>
                      : <span className="text-gray-500">sem romaneio</span>}
                  </td>
                  <td className="p-2 text-center">
                    <button className="text-gray-500 hover:text-prim-400" title="Detalhes do cadastro" onClick={() => setDetalhe(v)}><HelpCircle size={15} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {totalPag > 1 && (
          <div className="flex items-center justify-end gap-2 px-4 py-2 border-t border-ink-700 text-xs text-gray-400">
            <button className="p-1 rounded hover:bg-ink-800 disabled:opacity-30" disabled={pagAtual <= 1} onClick={() => setPag(pagAtual - 1)}><ChevronLeft size={14} /></button>
            página {pagAtual} de {totalPag}
            <button className="p-1 rounded hover:bg-ink-800 disabled:opacity-30" disabled={pagAtual >= totalPag} onClick={() => setPag(pagAtual + 1)}><ChevronRight size={14} /></button>
          </div>
        )}
      </div>

      {detalhe && <ModalDetalhe v={detalhe} onClose={() => setDetalhe(null)} gravando={gravando} gravaCampo={gravaCampo} />}
    </div>
  );
}

// Marcação do Gestor: Sim | Não | limpar (volta a NÃO IDENTIFICADO). valor: true | false | null
function SimNao({ valor, ocupado, onChange }) {
  const base = 'px-2 py-0.5 text-[11px] font-semibold transition';
  return (
    <div className={`inline-flex rounded overflow-hidden border border-ink-700 mt-1 ${ocupado ? 'opacity-50' : ''}`}>
      <button className={`${base} ${valor === true ? 'bg-prim-600 text-white' : 'bg-ink-800 text-gray-400 hover:bg-ink-700'}`}
              disabled={ocupado || valor === true} onClick={() => onChange('S')} title="Marcar Sim">Sim</button>
      <button className={`${base} ${valor === false ? 'bg-rose-600 text-white' : 'bg-ink-800 text-gray-400 hover:bg-ink-700'}`}
              disabled={ocupado || valor === false} onClick={() => onChange('N')} title="Marcar Não">Não</button>
      {valor !== null && (
        <button className={`${base} bg-ink-800 text-gray-500 hover:text-gray-200`} disabled={ocupado} onClick={() => onChange(null)} title="Limpar (volta a não identificado)">×</button>
      )}
    </div>
  );
}

const rotProp = p => (p === 'PROPRIO' ? 'PRÓPRIO' : p === 'TERCEIRO' ? 'TERCEIRO' : 'NÃO IDENTIFICADO');
const rotSn   = v => (v === 'S' ? 'SIM' : v === 'N' ? 'NÃO' : 'NÃO IDENTIFICADO');

// Etiqueta 1 — propriedade
function EtqProp({ valor, motivo }) {
  const cls = valor === 'PROPRIO' ? 'bg-prim-600/20 text-prim-400 border-prim-600/40'
            : valor === 'TERCEIRO' ? 'bg-acc-500/15 text-acc-500 border-acc-500/40'
            : 'bg-ink-700 text-gray-400 border-ink-600';
  return <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded border font-semibold tracking-wide whitespace-nowrap ${cls}`} title={motivo}>{rotProp(valor)}</span>;
}

// Etiquetas 2 e 3 — sim / não / não identificado
function EtqSn({ prefixo, valor }) {
  const cls = valor === 'S' ? 'bg-prim-600/20 text-prim-400 border-prim-600/40'
            : valor === 'N' ? 'bg-rose-500/15 text-rose-400 border-rose-500/40'
            : 'bg-ink-700 text-gray-400 border-ink-600';
  const txt = valor === 'NI' ? 'NÃO IDENTIFICADO' : `${prefixo}: ${rotSn(valor)}`;
  return <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded border font-semibold tracking-wide whitespace-nowrap ${cls}`}
               title={valor === 'NI' ? 'Não existe no Mega; ainda não informado no Gestor' : 'Informado no Gestor'}>{txt}</span>;
}

// Painel com os campos reais do cadastro, a origem de cada etiqueta, as marcações do Gestor e o histórico
function ModalDetalhe({ v, onClose, gravando, gravaCampo }) {
  const [hist, setHist] = useState(null);
  useEffect(() => {
    setHist(null);
    api.veiculosHistorico(v.seq).then(r => setHist(r.historico)).catch(() => setHist([]));
  }, [v.seq, v.gestor?.em]);
  const megaDiz = v.propriedade_fonte === 'MEGA';
  const fmtBrHr = s => (s ? `${s.slice(0, 10).split('-').reverse().join('/')} ${s.slice(11, 16)}` : '—');
  const L = ({ k, c }) => (
    <div className="flex gap-3 text-xs py-1 border-b border-ink-800/60">
      <span className="text-gray-500 w-44 shrink-0">{k}</span>
      <span className="text-gray-200">{c == null || c === '' ? <span className="text-gray-600">—</span> : c}</span>
    </div>
  );
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="card w-full max-w-xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-ink-700 flex items-center justify-between bg-ink-900 rounded-t-lg">
          <h2 className="font-semibold text-prim-400 flex items-center gap-2"><Truck size={16} /> {v.placa} <span className="text-gray-500 text-xs font-normal">cód. {v.seq}</span></h2>
          <button className="text-gray-500 hover:text-gray-200" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-gray-400 mb-1">Cadastro padrão do Mega (VEN_VEICULO)</div>
            <L k="Tração / reboque" c={v.tpveic_desc} />
            <L k="Tipo de rodado (tipo Mega)" c={v.tipo_mega || (v.tpveic === 'R' ? 'não se aplica a reboque' : '')} />
            <L k="Carroceria" c={v.carroceria} />
            <L k="UF · RENAVAM" c={`${v.uf || '—'} · ${v.renavam || '—'}`} />
            <L k="Tara · cap. kg · cap. m³" c={`${v.tara ?? '—'} · ${v.capkg ?? '—'} · ${v.capm3 ?? '—'}`} />
            <L k="Código interno" c={v.cint} />
            <L k="Proprietário (padrão Mega)" c={v.prop_mega ? `${v.prop_mega.nome} (${v.prop_mega.tipo})` : 'não vinculado'} />
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-gray-400 mb-1">Campos específicos CCS (VEN_VEICULOCMPESP)</div>
            {!v.tem_cmpesp && <div className="text-xs text-gray-500">Este veículo não tem campos específicos preenchidos.</div>}
            <L k="Tipo (CCS / tabela de frete)" c={v.tipo_ccs} />
            <L k="Veículo externo" c={v.externo === 'S' ? 'S (sim)' : v.externo === 'N' ? 'N (não)' : ''} />
            <L k="Raiz do CNPJ do dono" c={v.cgc_raiz ? `${v.cgc_raiz}${v.filial_cgc ? ` → filial ${v.filial_cgc}` : ' (não é de nenhuma filial)'}` : ''} />
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-gray-400 mb-1">Informações do Gestor (não alteram o Mega)</div>
            <L k="Propriedade" c={
              megaDiz
                ? <span className="text-gray-400">definida pelo cadastro do Mega — não é editada aqui</span>
                : <span className="inline-flex rounded overflow-hidden border border-ink-700">
                    {[['P', 'Próprio'], ['T', 'Terceiro']].map(([val, rot]) => (
                      <button key={val} disabled={!!gravando || v.gestor?.propriedade === val}
                              className={`px-2 py-0.5 text-[11px] font-semibold ${v.gestor?.propriedade === val ? 'bg-prim-600 text-white' : 'bg-ink-800 text-gray-400 hover:bg-ink-700'}`}
                              onClick={() => gravaCampo(v, 'PROPRIEDADE', val)}>{rot}</button>
                    ))}
                    {v.gestor?.propriedade && <button className="px-2 py-0.5 text-[11px] bg-ink-800 text-gray-500 hover:text-gray-200" disabled={!!gravando} onClick={() => gravaCampo(v, 'PROPRIEDADE', null)} title="Limpar">×</button>}
                  </span>} />
            <L k="Combustível controlado" c={<SimNao valor={v.combustivel} ocupado={gravando === `${v.seq}:COMBUSTIVEL`} onChange={val => gravaCampo(v, 'COMBUSTIVEL', val)} />} />
            <L k="Posto próprio" c={<SimNao valor={v.posto_proprio} ocupado={gravando === `${v.seq}:POSTO_PROPRIO`} onChange={val => gravaCampo(v, 'POSTO_PROPRIO', val)} />} />
            {v.gestor?.em && <L k="Última marcação" c={`${fmtBrHr(v.gestor.em)} por ${v.gestor.por}`} />}
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-gray-400 mb-1">Etiquetas</div>
            <L k="Propriedade" c={<><EtqProp valor={v.propriedade} motivo={v.propriedade_motivo} /> <span className="text-gray-400 ml-2">{v.propriedade_motivo}</span></>} />
            <L k="Combustível" c={<><EtqSn prefixo="CONTROLADO" valor={sn(v.combustivel)} /> <span className="text-gray-400 ml-2">{v.combustivel == null ? 'não informado no Gestor' : 'informado no Gestor'}</span></>} />
            <L k="Posto próprio" c={<><EtqSn prefixo="POSTO PRÓPRIO" valor={sn(v.posto_proprio)} /> <span className="text-gray-400 ml-2">{v.posto_proprio == null ? 'não informado no Gestor' : 'informado no Gestor'}</span></>} />
            <L k="Uso em romaneios" c={v.rom_total > 0 ? `${fmtN(v.rom_12m)} nos últimos 12 meses · ${fmtN(v.rom_total)} no total · último em ${fmtBr(v.ult_rom)}` : 'nunca usado em romaneio de expedição'} />
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-gray-400 mb-1">Histórico das marcações {hist && hist.length > 0 && `(${hist.length})`}</div>
            {!hist && <div className="text-xs text-gray-500">carregando…</div>}
            {hist && hist.length === 0 && <div className="text-xs text-gray-500">Nenhuma marcação registrada.</div>}
            {hist && hist.map(h => (
              <div key={h.id} className="bg-ink-900/60 rounded-lg px-3 py-1.5 text-xs flex items-center gap-3 mb-1">
                <span className="text-[10px] uppercase tracking-wider text-gray-500 whitespace-nowrap">{h.campo}</span>
                <span className="font-mono text-gray-200 whitespace-nowrap">{h.de} <span className="text-gray-500">→</span> <span className="text-prim-400 font-semibold">{h.para}</span></span>
                <span className="text-gray-500 truncate flex-1">por {h.usuario}</span>
                <span className="text-gray-500 whitespace-nowrap">{fmtBrHr(h.quando)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
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
