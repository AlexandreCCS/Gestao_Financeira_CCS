import React from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { LogOut, Wallet, Users } from 'lucide-react';
import { api, getSession, clearSession } from '../api/client';
import { modulosDoUsuario } from '../modulos';

export default function Shell({ children }) {
  const nav = useNavigate();
  const loc = useLocation();
  const s   = getSession();
  const u   = s?.user;
  // [14/05/2026 - Alexandre Carvalho] menu agora vem da permissao por modulo:
  // admin ve tudo + Administracao; usuario ve so o que foi liberado.
  const mods = modulosDoUsuario(u);

  async function logout() {
    try { await api.logout(); } catch {}
    clearSession();
    nav('/login', { replace: true });
  }

  const link = (to, label, icon) => (
    <Link key={to} to={to}
      className={`px-3 py-2 rounded-lg text-sm transition flex items-center gap-1.5
        ${loc.pathname === to ? 'bg-prim-600 text-white' : 'text-gray-300 hover:bg-ink-800'}`}>
      {icon}{label}
    </Link>
  );

  return (
    <div className="min-h-screen flex flex-col">
      <header className="h-14 bg-ink-900 border-b border-ink-700 flex items-center px-4 gap-4">
        <Link to="/" className="flex items-center gap-2 font-bold text-prim-400">
          <Wallet size={20} /> Gestor Financeiro CCS
        </Link>
        <nav className="flex gap-1 ml-4">
          {mods.map(m => link(m.rota, m.label))}
          {u?.perm === 'A' && link('/admin', 'Administração', <Users size={15} />)}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm text-gray-300">
          <span>{u?.nome || u?.login}</span>
          {u?.perm === 'A' && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-prim-700/40 text-prim-300">ADMIN</span>
          )}
          <button onClick={logout} className="btn-ghost" title="Sair">
            <LogOut size={16} />
          </button>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
