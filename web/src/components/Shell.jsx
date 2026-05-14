import React from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { LogOut, Wallet } from 'lucide-react';
import { api, getSession, clearSession } from '../api/client';

export default function Shell({ children }) {
  const nav = useNavigate();
  const loc = useLocation();
  const s   = getSession();
  const u   = s?.user;

  async function logout() {
    try { await api.logout(); } catch {}
    clearSession();
    nav('/login', { replace: true });
  }

  const link = (to, label) => (
    <Link to={to}
      className={`px-3 py-2 rounded-lg text-sm transition
        ${loc.pathname === to ? 'bg-prim-600 text-white' : 'text-gray-300 hover:bg-ink-800'}`}>
      {label}
    </Link>
  );

  return (
    <div className="min-h-screen flex flex-col">
      <header className="h-14 bg-ink-900 border-b border-ink-700 flex items-center px-4 gap-4">
        <Link to="/" className="flex items-center gap-2 font-bold text-prim-400">
          <Wallet size={20} /> Gestor Financeiro CCS
        </Link>
        <nav className="flex gap-1 ml-4">
          {link('/saldos-banco', 'Saldos Bancários')}
          {link('/conciliacao',  'Conciliação Bancária')}
          {link('/fluxo-caixa',  'Fluxo de Caixa')}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm text-gray-300">
          <span>{u?.nome || u?.login}</span>
          <button onClick={logout} className="btn-ghost" title="Sair">
            <LogOut size={16} />
          </button>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
