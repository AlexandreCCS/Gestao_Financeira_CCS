// [14/05/2026 - CRIADO POR ALEXANDRE CARVALHO] Tela de Administracao de Usuarios
// do Gestor Financeiro CCS. Visivel apenas para admin (perm='A').
// Define quem e admin e quais modulos cada usuario enxerga no portal.
import React, { useEffect, useState } from 'react';
import { api, getSession } from '../api/client';

export default function AdminUsuarios() {
  const meGru = Number(getSession()?.user?.sub || 0);
  const [modulos, setModulos]     = useState([]);
  const [usuarios, setUsuarios]   = useState([]);
  const [draft, setDraft]         = useState({});   // gru -> { perm, modulos:Set }
  const [busy, setBusy]           = useState(true);
  const [savingGru, setSavingGru] = useState(null);
  const [erro, setErro]           = useState('');
  const [msg, setMsg]             = useState('');

  async function carregar() {
    setBusy(true); setErro('');
    try {
      const [m, u] = await Promise.all([api.adminModulos(), api.adminUsuarios()]);
      setModulos(m.filter(x => x.ativo));
      setUsuarios(u);
      const d = {};
      for (const x of u) d[x.gru] = { perm: x.perm, modulos: new Set(x.modulos) };
      setDraft(d);
    } catch (e) { setErro(e.message || 'Erro ao carregar'); }
    finally { setBusy(false); }
  }
  useEffect(() => { carregar(); }, []);

  function setPerm(gru, perm) {
    setDraft(d => ({ ...d, [gru]: { ...d[gru], perm } }));
  }
  function toggleMod(gru, cod) {
    setDraft(d => {
      const cur = new Set(d[gru].modulos);
      cur.has(cod) ? cur.delete(cod) : cur.add(cod);
      return { ...d, [gru]: { ...d[gru], modulos: cur } };
    });
  }
  async function salvar(gru) {
    setSavingGru(gru); setErro(''); setMsg('');
    try {
      const dr = draft[gru];
      await api.adminSalvarUsuario(gru, dr.perm, [...dr.modulos]);
      setMsg('Permissões salvas.');
      await carregar();
    } catch (e) { setErro(e.message || 'Erro ao salvar'); }
    finally { setSavingGru(null); }
  }

  // tem alteracao nao salva nessa linha?
  function sujo(gru) {
    const orig = usuarios.find(u => u.gru === gru);
    const dr = draft[gru];
    if (!orig || !dr) return false;
    if (orig.perm !== dr.perm) return true;
    const a = new Set(orig.modulos), b = dr.modulos;
    if (a.size !== b.size) return true;
    for (const x of a) if (!b.has(x)) return true;
    return false;
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-xl font-bold text-prim-400 mb-1">Administração de Usuários</h1>
      <p className="text-sm text-gray-400 mb-4">
        Defina quem é administrador e quais módulos cada usuário enxerga no portal.
      </p>

      {erro && <div className="bg-red-900/40 text-red-200 text-sm rounded p-2 mb-3">{erro}</div>}
      {msg  && <div className="bg-emerald-900/40 text-emerald-200 text-sm rounded p-2 mb-3">{msg}</div>}

      {busy ? (
        <div className="text-gray-400">Carregando...</div>
      ) : (
        <div className="card overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-ink-900 text-gray-300">
              <tr>
                <th className="text-left px-3 py-2">Usuário</th>
                <th className="text-left px-3 py-2">Perfil</th>
                {modulos.map(m => (
                  <th key={m.codigo} className="px-3 py-2 text-center">{m.nome}</th>
                ))}
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {usuarios.map(u => {
                const dr = draft[u.gru] || { perm: u.perm, modulos: new Set() };
                const isAdmin = dr.perm === 'A';
                const euMesmo = u.gru === meGru;
                return (
                  <tr key={u.gru} className="border-t border-ink-700">
                    <td className="px-3 py-2">
                      <div className="text-gray-200">{u.nome || u.login}</div>
                      <div className="text-[11px] text-gray-500">
                        {u.login} · cód {u.gru}{!u.ativo && ' · inativo no Mega'}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <select className="input py-1" value={dr.perm}
                        onChange={e => setPerm(u.gru, e.target.value)}
                        disabled={euMesmo}
                        title={euMesmo ? 'Você não pode alterar o próprio perfil' : ''}>
                        <option value="U">Usuário</option>
                        <option value="A">Administrador</option>
                      </select>
                    </td>
                    {modulos.map(m => (
                      <td key={m.codigo} className="px-3 py-2 text-center">
                        {isAdmin ? (
                          <span className="text-[11px] text-prim-300">tudo</span>
                        ) : (
                          <input type="checkbox" checked={dr.modulos.has(m.codigo)}
                            onChange={() => toggleMod(u.gru, m.codigo)} />
                        )}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right">
                      <button className="btn-prim py-1 text-xs disabled:opacity-40"
                        disabled={!sujo(u.gru) || savingGru === u.gru}
                        onClick={() => salvar(u.gru)}>
                        {savingGru === u.gru ? '...' : 'Salvar'}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {usuarios.length === 0 && (
                <tr>
                  <td colSpan={modulos.length + 3} className="px-3 py-6 text-center text-gray-500">
                    Nenhum usuário com acesso ao portal.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-500 mt-3">
        O administrador enxerga todos os módulos automaticamente. Liberar um usuário novo
        (que ainda não tem acesso ao portal) entra numa próxima fase.
      </p>
    </div>
  );
}
