// [30/10/2026 - CRIADO POR ALEXANDRE CARVALHO] Frete › 2ª aprovação (fluxo novo do frete da Quality).
// 1ª aprovação = Portal de Dados da Indústria (gera o ADIANTAMENTO: 70% quando paga a PRO, 67% quando é MEI com nota, bloqueado no Approvo).
// Aqui, quando a carga encerra, a 2ª aprovação gera o TÍTULO FINAL já com o adiantamento vinculado e baixado:
//   adiantamento pago → abatido (DESCADI/AMORTADI); não pago → estornado e o final paga o frete inteiro menos o recibo de combustível.
//   MEI com nota → o título final nasce na entrada da NF do MEI (a 2ª aprovação só registra).
// Os títulos nascem bloqueados no Approvo (regra "Portal Fretes - Frete e Vale Combustivel": Odette ou Renata).
import React, { useEffect, useMemo, useState } from 'react';
import { Truck, CheckCircle2, AlertTriangle, X, RefreshCw, Search, Info } from 'lucide-react';
import { api } from '../../api/client';

const fmt = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtBr = s => (s ? s.slice(0, 10).split('-').reverse().join('/') : '—');
const fmtBrHr = s => (s ? `${s.slice(0, 10).split('-').reverse().join('/')} ${s.slice(11, 16)}` : '—');
const APPROVO = { E: ['em aprovação', 'bg-acc-500/15 text-acc-500'], A: ['aprovado', 'bg-prim-600/20 text-prim-400'], R: ['reprovado', 'bg-rose-500/20 text-rose-400'] };

export default function AprovacaoFrete() {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState('');
  const [busca, setBusca] = useState('');
  const [dias, setDias] = useState(30);
  const [confirmar, setConfirmar] = useState(null);
  const [gravando, setGravando] = useState(false);

  const carrega = () => {
    setDados(d => (d ? { ...d, carregando: true } : d));
    api.freteAprovacao(dias).then(setDados).catch(e => { setErro(e?.message || 'Falha ao carregar.'); setDados({ cargas: [] }); });
  };
  useEffect(carrega, [dias]);

  const filtra = c => {
    const q = busca.trim().toUpperCase();
    if (!q) return true;
    return `${c.rom} ${c.descricao} ${c.transp} ${c.transp_nome} ${c.motorista} ${c.placa}`.toUpperCase().includes(q);
  };
  const pendentes = useMemo(() => (dados?.cargas || []).filter(c => c.status === 'ADTO').filter(filtra), [dados, busca]);
  const feitos = useMemo(() => (dados?.cargas || []).filter(c => c.status !== 'ADTO').filter(filtra), [dados, busca]);

  const aprovar = async () => {
    const c = confirmar;
    setGravando(true); setErro(''); setOk('');
    try {
      const r = await api.freteAprovar(c.efe);
      setOk(`Romaneio ${c.rom}: ${r.mensagem}`);
      setConfirmar(null);
      carrega();
    } catch (e) {
      setErro(e?.message || 'Falha na 2ª aprovação.');
    } finally { setGravando(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-100 flex items-center gap-2"><Truck size={20} className="text-prim-400" /> Frete › 2ª aprovação</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Cargas com o adiantamento gerado na 1ª aprovação (portal). Ao aprovar, nasce o título final já com o adiantamento baixado,
            bloqueado no Approvo para a Odette ou a Renata.
          </p>
        </div>
        <button className="btn-ghost !py-1.5" onClick={carrega}><RefreshCw size={14} /> Atualizar</button>
      </div>

      {dados && dados.fluxo_ligado === false && (
        <div className="flex items-start gap-2 bg-acc-500/10 border border-acc-500/40 text-amber-200 text-sm rounded px-3 py-2">
          <Info size={15} className="mt-0.5 shrink-0" />
          <span>O fluxo novo do frete ainda está <b>desligado</b>: a 1ª aprovação continua gerando os títulos no formato antigo e nenhuma carga
            chega aqui. Ele é ligado no parâmetro do frete (FLUXO_ADTO) quando a virada for combinada.</span>
        </div>
      )}
      {erro && (
        <div className="flex items-center gap-2 bg-rose-500/10 border border-rose-500/40 text-rose-300 text-sm rounded px-3 py-2">
          <AlertTriangle size={15} /> {erro}<button className="ml-auto" onClick={() => setErro('')}><X size={14} /></button>
        </div>
      )}
      {ok && (
        <div className="flex items-center gap-2 bg-prim-600/15 border border-prim-600/40 text-prim-300 text-sm rounded px-3 py-2">
          <CheckCircle2 size={15} /> {ok}<button className="ml-auto" onClick={() => setOk('')}><X size={14} /></button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Aguardando 2ª aprovação" value={dados ? pendentes.length : '…'} />
        <Kpi label="Frete pendente" value={dados ? fmt(pendentes.reduce((s, c) => s + c.frete, 0)) : '…'} />
        <Kpi label="Adiantamento gerado" value={dados ? fmt(pendentes.reduce((s, c) => s + c.adto, 0)) : '…'} sub={dados ? `pago: ${fmt(pendentes.reduce((s, c) => s + c.adto_pago, 0))}` : ''} />
        <Kpi label="Percentual do adiantamento" value={dados ? `${dados.pct_pro || 70}% / ${dados.pct_mei || 67}%` : '…'} sub="PRO / MEI com nota" />
      </div>

      <div className="card overflow-hidden">
        <div className="bg-ink-900 px-4 py-3 border-b border-ink-700 flex flex-wrap gap-2 items-center">
          <div className="flex items-center gap-2 bg-ink-800 px-2 rounded grow max-w-md">
            <Search size={14} className="text-gray-500" />
            <input className="bg-transparent outline-none py-1.5 text-sm w-full" placeholder="Romaneio, transportadora, motorista ou placa…"
                   value={busca} onChange={e => setBusca(e.target.value)} />
          </div>
          <span className="text-xs text-gray-500 ml-auto">{pendentes.length} aguardando</span>
        </div>
        <Tabela cargas={pendentes} vazio={dados ? 'Nenhuma carga aguardando a 2ª aprovação.' : 'Carregando…'} acao={c => (
          <button className="btn-prim !py-1 !px-2 text-xs" onClick={() => { setErro(''); setConfirmar(c); }}>Aprovar</button>
        )} />
      </div>

      <div className="card overflow-hidden">
        <div className="bg-ink-900 px-4 py-3 border-b border-ink-700 flex flex-wrap gap-2 items-center">
          <span className="text-sm text-gray-300 font-semibold">Aprovadas</span>
          <select className="bg-ink-800 text-xs text-gray-300 rounded px-2 py-1.5 outline-none" value={dias} onChange={e => setDias(Number(e.target.value))}>
            <option value={7}>últimos 7 dias</option><option value={30}>últimos 30 dias</option><option value={90}>últimos 90 dias</option>
          </select>
        </div>
        <Tabela cargas={feitos} vazio="Nenhuma 2ª aprovação no período." feitos />
      </div>

      {confirmar && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => !gravando && setConfirmar(null)}>
          <div className="card w-full max-w-lg shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-ink-700 flex items-center justify-between bg-ink-900 rounded-t-lg">
              <h2 className="font-semibold text-prim-400">2ª aprovação · romaneio {confirmar.rom}</h2>
              <button className="text-gray-500 hover:text-gray-200" disabled={gravando} onClick={() => setConfirmar(null)}><X size={18} /></button>
            </div>
            <div className="p-5 space-y-2 text-sm">
              <div className="text-gray-400">{confirmar.transp} · {confirmar.transp_nome} — {confirmar.motorista || 'sem motorista'} {confirmar.placa}</div>
              {confirmar.mei_nota ? (
                <p className="text-gray-300">MEI com nota (filial {confirmar.fil_pag}): o título final nasce na <b>entrada da NF do MEI</b>. Esta aprovação só
                  registra; o adiantamento {confirmar.adto_aps} é vinculado na entrada da nota.</p>
              ) : (
                <>
                  <Linha k="Frete" v={fmt(confirmar.frete)} />
                  <Linha k="(−) Recibo de combustível" v={fmt(confirmar.vale)} />
                  <Linha k="(−) Adiantamento pago (abatido)" v={fmt(confirmar.adto_pago)} />
                  {confirmar.adto_aberto > 0 && <Linha k="Adiantamento não pago (estornado)" v={fmt(confirmar.adto_aberto)} cinza />}
                  <Linha k="Saldo do título final" v={fmt(confirmar.saldo_previsto)} forte />
                  <p className="text-xs text-gray-500 pt-1">O título final nasce bloqueado no Approvo. Adiantamento: {confirmar.adto_aps || '—'}.</p>
                </>
              )}
              {erro && <div className="text-rose-300 text-xs bg-rose-900/30 rounded p-2">{erro}</div>}
              <div className="flex justify-end gap-2 pt-2">
                <button className="btn-ghost" disabled={gravando} onClick={() => setConfirmar(null)}>Cancelar</button>
                <button className="btn-prim" disabled={gravando} onClick={aprovar}>{gravando ? 'Aprovando…' : 'Confirmar 2ª aprovação'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Tabela({ cargas, vazio, acao, feitos }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-ink-900/70 text-gray-400 uppercase text-xs">
          <tr>
            <th className="p-2 text-left">Romaneio</th>
            <th className="p-2 text-left">Transportadora / motorista</th>
            <th className="p-2 text-left">Paga</th>
            <th className="p-2 text-right">Frete</th>
            <th className="p-2 text-right">Recibo</th>
            <th className="p-2 text-right">Adiantamento</th>
            <th className="p-2 text-right">{feitos ? 'Situação' : 'Saldo final'}</th>
            <th className="p-2"></th>
          </tr>
        </thead>
        <tbody>
          {cargas.length === 0 && <tr><td colSpan={8} className="p-4 text-center text-gray-500">{vazio}</td></tr>}
          {cargas.map(c => {
            const ap = APPROVO[c.adto_approvo];
            return (
              <tr key={c.efe} className="border-t border-ink-800 hover:bg-ink-800/40 align-top">
                <td className="p-2"><div className="font-mono text-gray-100">{c.rom}</div><div className="text-[11px] text-gray-500">{fmtBr(c.dt_exp)} · {c.descricao}</div></td>
                <td className="p-2"><div className="text-gray-200">{c.transp_nome || c.transp}</div><div className="text-[11px] text-gray-500">{c.motorista || '—'} {c.placa}</div></td>
                <td className="p-2 text-xs">{c.mei_nota ? <span className="px-1.5 py-0.5 rounded bg-acc-500/15 text-acc-500">MEI {c.fil_pag}</span> : <span className="px-1.5 py-0.5 rounded bg-ink-700 text-gray-300">PRO</span>}</td>
                <td className="p-2 text-right font-mono">{fmt(c.frete)}</td>
                <td className="p-2 text-right font-mono text-gray-400">{c.vale ? fmt(c.vale) : '—'}</td>
                <td className="p-2 text-right">
                  <div className="font-mono">{fmt(c.adto)}</div>
                  <div className="text-[10px] text-gray-500">{c.adto_pago > 0 ? `pago ${fmt(c.adto_pago)}` : 'não pago'}{ap ? ' · ' : ''}{ap && <span className={`px-1 rounded ${ap[1]}`}>{ap[0]}</span>}</div>
                </td>
                <td className="p-2 text-right">
                  {feitos
                    ? <div className="text-xs text-gray-300" title={c.msg}>{c.status === 'FINAL' ? 'título final gerado' : 'MEI: final na NF'}<div className="text-[10px] text-gray-500">{fmtBrHr(c.aprov2_dt)} · {c.aprov2_por}</div></div>
                    : <span className="font-mono text-gray-100">{c.mei_nota ? 'na NF' : fmt(c.saldo_previsto)}</span>}
                </td>
                <td className="p-2 text-right">{acao ? acao(c) : null}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Linha({ k, v, forte, cinza }) {
  return (
    <div className={`flex justify-between border-b border-ink-800/60 py-1 ${forte ? 'text-gray-100 font-semibold' : cinza ? 'text-gray-500' : 'text-gray-300'}`}>
      <span>{k}</span><span className="font-mono">{v}</span>
    </div>
  );
}

function Kpi({ label, value, sub }) {
  return (
    <div className="kpi border-l-4 border-prim-500">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value text-prim-400">{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}
