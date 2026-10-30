// [25/10/2026 - CRIADO POR ALEXANDRE CARVALHO] Baixas/Conciliação › CONFIGURAR (só administrador).
// Parâmetros do Baixar e conciliar (CCS_TB_GFIN_PARAM BXC_*), contas no escopo (CCS_TB_GFIN_BXC_CONTA: ativa, robô, teto,
// agente banco para tarifas) e o de-para dos movimentos reais (CCS_TB_GFIN_BXC_DEPARA). Botão para rodar o robô agora.
import React, { useEffect, useState } from 'react';
import { Save, Plus, Trash2, Bot, Loader2, CheckCircle2 } from 'lucide-react';
import { api } from '../../api/client';

const fmtN = v => Number(v || 0).toLocaleString('pt-BR');
const PARAMS = [
  ['BXC_ROBO_ATIVO',      'Robô ligado',                      'bool', 'Quando ligado, o robô baixa e concilia sozinho os itens de alta confiança das contas marcadas.'],
  ['BXC_USU_ROBO',        'Usuário do Mega do robô',          'int',  'Código do usuário em nome de quem o robô grava (precisa ter hierarquia no Financeiro, Contas a Pagar e Receber).'],
  ['BXC_TETO_ROBO',       'Teto por baixa do robô (R$)',      'num',  'Acima disso o robô não grava sozinho: o item vai para a tela.'],
  ['BXC_TOLERANCIA',      'Diferença absorvida (R$)',         'num',  'Diferença residual entre banco e título absorvida como juros ou desconto, sem perguntar.'],
  ['BXC_JANELA_DIAS',     'Janela de dias',                   'int',  'Distância máxima entre a data do banco e o lançamento ou vencimento para casar.'],
  ['BXC_TIT_DIAS_ANTES',  'Títulos: vencimento até N dias antes', 'int', 'Títulos candidatos com vencimento até N dias antes da data do banco.'],
  ['BXC_TIT_DIAS_DEPOIS', 'Títulos: vencimento até N dias depois', 'int', 'Títulos candidatos com vencimento até N dias depois da data do banco.'],
  ['BXC_MAX_TITULOS',     'Máximo de títulos por pagamento',  'int',  'Um pagamento pode quitar até N títulos do mesmo agente (soma).'],
  ['BXC_EXIGE_COMPROV',   'Exigir comprovante em PIX/TED',    'bool', 'Quando ligado, PIX e TED acima do valor abaixo só baixam com comprovante conferido.'],
  ['BXC_COMPROV_ACIMA',   'Comprovante exigido a partir de (R$)', 'num', 'Valor a partir do qual o comprovante é exigido.'],
  ['BXC_AUTO_COB',        'Cobrança automática ligada',       'bool', 'Quando ligado, o dia de cobrança das contas marcadas (baixas do retorno = linhas de cobrança + PIX QRS do extrato, no centavo) é conciliado sozinho a cada 5 minutos e logo após importar o extrato.'],
  ['BXC_USU_COB',         'Usuário do Mega da cobrança automática', 'int', 'Código do usuário em nome de quem a conciliação automática da cobrança é gravada (1 = MEGA).'],
  ['BXC_CLA_CP_JUROS',    'Classe: juros pagos',              'int',  'Classe financeira dos juros nas baixas a pagar (627 na Quality).'],
  ['BXC_CLA_CP_DESC',     'Classe: descontos obtidos',        'int',  'Classe financeira do desconto nas baixas a pagar (566).'],
  ['BXC_CLA_CR_JUROS',    'Classe: juros recebidos',          'int',  'Classe financeira dos juros nas baixas a receber (68).'],
  ['BXC_CLA_CR_MULTA',    'Classe: multas recebidas',         'int',  'Classe financeira da multa nas baixas a receber (68).'],
  ['BXC_CLA_CR_DESC',     'Classe: descontos concedidos',     'int',  'Classe financeira do desconto nas baixas a receber (468 na indústria).'],
];
const DEP_VAZIO = { id: null, banco: '', conta: '', tpd: '', hist_like: '', natureza: 'D', acao: 710, agente: '', tpd_fin: '', classe: '', classe_ide: '1', ccusto: '', ccusto_ide: '1', projeto: 2, historico: '', auto: 'N', teto: '', ativo: 'S' };

export default function ConfigBaixarConciliar() {
  const [cfg, setCfg]       = useState(null);
  const [depara, setDepara] = useState(null);
  const [erro, setErro]     = useState('');
  const [ok, setOk]         = useState('');
  const [rodando, setRodando] = useState(false);
  const [robo, setRobo]     = useState(null);
  const [editDep, setEditDep] = useState(null);

  const carregar = () => {
    api.bxcConfig().then(setCfg).catch(e => setErro(e.message || 'Falha ao carregar os parâmetros.'));
    api.bxcDepara().then(r => setDepara(r.itens || [])).catch(() => setDepara([]));
  };
  useEffect(() => { carregar(); }, []);
  const aviso = m => { setOk(m); setTimeout(() => setOk(''), 4000); };

  async function salvar() {
    setRodando(true); setErro('');
    try { await api.bxcConfigSalvar({ params: cfg.params, contas: cfg.contas }); aviso('Parâmetros e contas gravados.'); carregar(); }
    catch (e) { setErro(e.message || 'Não consegui gravar.'); }
    setRodando(false);
  }
  async function salvarDep() {
    setRodando(true); setErro('');
    try { await api.bxcDeparaSalvar(editDep); setEditDep(null); aviso('De-para gravado.'); carregar(); }
    catch (e) { setErro(e.message || 'Não consegui gravar o de-para.'); }
    setRodando(false);
  }
  async function excluirDep(id) {
    setRodando(true);
    try { await api.bxcDeparaExcluir(id); carregar(); } catch (e) { setErro(e.message); }
    setRodando(false);
  }
  async function rodarRobo() {
    setRodando(true); setRobo(null);
    try { setRobo(await api.bxcRoboRodar()); } catch (e) { setErro(e.message || 'O robô não rodou.'); }
    setRodando(false);
  }
  const setParam = (k, v) => setCfg(c => ({ ...c, params: { ...c.params, [k]: v } }));
  const setConta = (agn, patch) => setCfg(c => ({ ...c, contas: c.contas.map(x => x.agn_id === agn ? { ...x, ...patch } : x) }));

  if (!cfg) return <div className="p-6 text-sm text-gray-400 flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> carregando…</div>;
  return (
    <div className="p-6 space-y-8 max-w-[1300px] mx-auto">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-100 tracking-tight">Baixar e conciliar · Configurar</h1>
          <p className="text-sm text-gray-500">Regras do robô, contas no escopo e o de-para dos movimentos reais. Só administradores.</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button className="btn-ghost" disabled={rodando} onClick={rodarRobo}><Bot size={15} /> Rodar robô agora</button>
          <button className="btn-prim" disabled={rodando} onClick={salvar}>{rodando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Gravar</button>
        </div>
      </div>
      {erro && <div className="bg-rose-900/40 text-rose-200 text-sm rounded-lg p-3">{erro}</div>}
      {ok && <div className="bg-emerald-900/30 text-emerald-200 text-sm rounded-lg p-3 flex items-center gap-2"><CheckCircle2 size={15} /> {ok}</div>}
      {robo && <div className="card p-4 text-sm text-gray-300">
        <div className="font-semibold text-gray-100 flex items-center gap-2"><Bot size={15} /> Robô rodou</div>
        <div className="text-gray-400 mt-1">{robo.motivo || `${fmtN(robo.contas || 0)} conta(s): ${fmtN(robo.executados || 0)} gravado(s), ${fmtN(robo.recusados || 0)} recusado(s), ${fmtN(robo.pulados || 0)} deixado(s) para a tela`}</div>
        {robo.cobranca && <div className="text-gray-400 mt-1">Cobrança: {robo.cobranca.motivo || `${fmtN(robo.cobranca.executados || 0)} dia(s) conciliado(s), ${fmtN(robo.cobranca.recusados || 0)} recusado(s)`}</div>}
        {Array.isArray(robo.itens) && robo.itens.length > 0 && <ul className="mt-2 text-xs text-gray-500 space-y-0.5">{robo.itens.slice(0, 30).map((x, i) => <li key={i}>• {x.conta ? `conta ${x.conta} · ` : ''}{x.mensagem || x.status}</li>)}</ul>}
      </div>}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-200 uppercase tracking-wider">Parâmetros</h2>
        <div className="grid md:grid-cols-2 gap-3">
          {PARAMS.map(([k, l, tp, d]) => (
            <label key={k} className="card p-4 flex items-start gap-4">
              <div className="flex-1">
                <div className="text-sm text-gray-100">{l}</div>
                <div className="text-xs text-gray-500 mt-0.5">{d}</div>
              </div>
              {tp === 'bool'
                ? <button type="button" onClick={() => setParam(k, Number(cfg.params[k]) ? 0 : 1)} className={`w-12 h-7 rounded-full transition relative ${Number(cfg.params[k]) ? 'bg-prim-600' : 'bg-ink-700'}`}><span className={`absolute top-1 w-5 h-5 rounded-full bg-white transition ${Number(cfg.params[k]) ? 'left-6' : 'left-1'}`} /></button>
                : <input type="number" step={tp === 'num' ? '0.01' : '1'} className="input w-36 text-right" value={cfg.params[k] ?? ''} onChange={e => setParam(k, e.target.value)} />}
            </label>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-200 uppercase tracking-wider">Contas no escopo</h2>
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase text-gray-500 bg-ink-900"><tr><th className="text-left p-3">Conta</th><th className="text-left p-3">Filial</th><th className="p-3">Ativa</th><th className="p-3">Robô</th><th className="p-3" title="Concilia sozinho o dia de cobrança (retorno x extrato) fechado no centavo">Cobrança auto.</th><th className="text-right p-3">Teto do robô (R$)</th><th className="text-right p-3">Agente banco (tarifas)</th><th className="text-right p-3">Pendentes</th></tr></thead>
            <tbody>{(cfg.contas || []).map(c => (
              <tr key={c.agn_id} className="border-t border-ink-700">
                <td className="p-3 text-gray-200">{c.agn_id} · {c.nome}</td>
                <td className="p-3 text-gray-400">{c.fil_id}</td>
                <td className="p-3 text-center"><input type="checkbox" className="accent-prim-500 w-4 h-4" checked={c.ativa === 'S' || c.ativa === true} onChange={e => setConta(c.agn_id, { ativa: e.target.checked })} /></td>
                <td className="p-3 text-center"><input type="checkbox" className="accent-prim-500 w-4 h-4" checked={c.robo === 'S' || c.robo === true} onChange={e => setConta(c.agn_id, { robo: e.target.checked })} /></td>
                <td className="p-3 text-center"><input type="checkbox" className="accent-prim-500 w-4 h-4" checked={c.auto_cob === true} onChange={e => setConta(c.agn_id, { auto_cob: e.target.checked })} /></td>
                <td className="p-3 text-right"><input type="number" step="0.01" className="input w-32 text-right py-1" value={c.teto_robo ?? ''} placeholder="geral" onChange={e => setConta(c.agn_id, { teto_robo: e.target.value })} /></td>
                <td className="p-3 text-right"><input type="number" className="input w-28 text-right py-1" value={c.agn_banco ?? ''} onChange={e => setConta(c.agn_id, { agn_banco: e.target.value })} /></td>
                <td className="p-3 text-right text-gray-400">{fmtN(c.pendentes)}</td>
              </tr>))}</tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-gray-200 uppercase tracking-wider">Movimentos reais · de-para</h2>
          <span className="text-xs text-gray-500">linha do extrato sem título vira lançamento avulso (710 saída / 711 entrada) com esta classe</span>
          <button className="btn-ghost text-xs ml-auto" onClick={() => setEditDep({ ...DEP_VAZIO })}><Plus size={13} /> Novo</button>
        </div>
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase text-gray-500 bg-ink-900"><tr><th className="text-left p-3">Tipo doc.</th><th className="text-left p-3">Histórico contém</th><th className="p-3">Nat.</th><th className="p-3">Ação</th><th className="text-left p-3">Agente</th><th className="text-left p-3">Classe</th><th className="text-left p-3">C. custo</th><th className="p-3">Robô</th><th className="text-right p-3">Teto</th><th className="p-3">Ativo</th><th className="p-3"></th></tr></thead>
            <tbody>{(depara || []).map(d => (
              <tr key={d.id} className="border-t border-ink-700 hover:bg-ink-900/40 cursor-pointer" onClick={() => setEditDep({ ...DEP_VAZIO, ...d })}>
                <td className="p-3 text-gray-200 font-mono">{d.tpd}{d.banco ? <span className="text-gray-500"> · bco {d.banco}</span> : ''}{d.conta ? <span className="text-gray-500"> · cta {d.conta}</span> : ''}</td>
                <td className="p-3 text-gray-400">{d.hist_like || '—'}</td>
                <td className="p-3 text-center text-gray-400">{d.natureza === 'D' ? 'saída' : 'entrada'}</td>
                <td className="p-3 text-center text-gray-400">{d.acao}</td>
                <td className="p-3 text-gray-400">{d.agente || <span className="text-gray-600">banco da conta</span>}</td>
                <td className="p-3">{d.classe ? <span className="text-gray-200">{d.classe_ide}/{d.classe}</span> : <span className="text-amber-300">configurar</span>}</td>
                <td className="p-3 text-gray-400">{d.ccusto ? `${d.ccusto_ide}/${d.ccusto}` : '—'}</td>
                <td className="p-3 text-center">{d.auto === 'S' ? <span className="text-emerald-300">sim</span> : <span className="text-gray-500">não</span>}</td>
                <td className="p-3 text-right text-gray-400">{d.teto ? fmtN(d.teto) : '—'}</td>
                <td className="p-3 text-center">{d.ativo === 'S' ? <span className="text-emerald-300">●</span> : <span className="text-gray-600">○</span>}</td>
                <td className="p-3 text-right"><button className="text-gray-500 hover:text-rose-300" onClick={e => { e.stopPropagation(); excluirDep(d.id); }} title="excluir"><Trash2 size={14} /></button></td>
              </tr>))}
              {depara && depara.length === 0 && <tr><td colSpan={11} className="p-6 text-center text-gray-500">Nenhum de-para. Crie um para TARBANC, IOF, IR e REND.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {editDep && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setEditDep(null)}>
          <div className="bg-ink-900 border border-ink-700 rounded-2xl shadow-2xl w-full max-w-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-6 pt-5 pb-3 text-lg font-semibold text-gray-100">{editDep.id ? 'Editar de-para' : 'Novo de-para'}</div>
            <div className="px-6 pb-4 grid md:grid-cols-3 gap-3 text-xs text-gray-400">
              {[['tpd', 'Tipo de documento do extrato (ex.: TARBANC)', 'text'], ['hist_like', 'Histórico contém (opcional)', 'text'], ['banco', 'Banco (vazio = todos)', 'number'],
                ['conta', 'Conta (vazio = todas)', 'number'], ['agente', 'Agente contraparte (vazio = banco da conta)', 'number'], ['tpd_fin', 'Tipo doc. do lançamento (vazio = o do extrato)', 'text'],
                ['classe_ide', 'Classe · identificador', 'text'], ['classe', 'Classe · reduzido', 'number'], ['ccusto_ide', 'Centro de custo · identificador', 'text'], ['ccusto', 'Centro de custo · reduzido', 'number'],
                ['projeto', 'Projeto · reduzido', 'number'], ['historico', 'Histórico do lançamento', 'text'], ['teto', 'Teto do robô (R$)', 'number']].map(([k, l, t]) => (
                <label key={k} className="space-y-1"><span>{l}</span><input type={t} className="input py-1.5" value={editDep[k] ?? ''} onChange={e => setEditDep({ ...editDep, [k]: e.target.value })} /></label>))}
              <label className="space-y-1"><span>Natureza no banco</span><select className="input py-1.5" value={editDep.natureza} onChange={e => setEditDep({ ...editDep, natureza: e.target.value, acao: e.target.value === 'D' ? 710 : 711 })}><option value="D">saída (débito)</option><option value="C">entrada (crédito)</option></select></label>
              <label className="space-y-1"><span>Ação do Mega</span><select className="input py-1.5" value={editDep.acao} onChange={e => setEditDep({ ...editDep, acao: Number(e.target.value) })}><option value={710}>710 · Pagamentos avulsos</option><option value={711}>711 · Recebimentos avulsos</option></select></label>
              <div className="flex items-center gap-4 pt-5">
                <label className="flex items-center gap-2"><input type="checkbox" className="accent-prim-500" checked={editDep.auto === 'S'} onChange={e => setEditDep({ ...editDep, auto: e.target.checked ? 'S' : 'N' })} /> robô pode lançar</label>
                <label className="flex items-center gap-2"><input type="checkbox" className="accent-prim-500" checked={editDep.ativo === 'S'} onChange={e => setEditDep({ ...editDep, ativo: e.target.checked ? 'S' : 'N' })} /> ativo</label>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-ink-700 flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setEditDep(null)}>Cancelar</button>
              <button className="btn-prim" disabled={rodando || !editDep.tpd} onClick={salvarDep}><Save size={15} /> Gravar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
