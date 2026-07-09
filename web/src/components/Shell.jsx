import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { LogOut, Wallet, Users, ChevronDown, HelpCircle } from 'lucide-react';
import { api, getSession, clearSession } from '../api/client';
import { modulosDoUsuario } from '../modulos';

export default function Shell({ children }) {
  const nav = useNavigate();
  const loc = useLocation();
  const s   = getSession();
  const u   = s?.user;
  // [14/05/2026 - Alexandre Carvalho] menu agora vem da permissao por modulo:
  // admin ve tudo + Administracao; usuario ve so o que foi liberado.
  // [14/05/2026 - Alexandre Carvalho] modulo com `submenus` vira dropdown.
  const mods = modulosDoUsuario(u);

  async function logout() {
    try { await api.logout(); } catch {}
    clearSession();
    nav('/login', { replace: true });
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="h-14 bg-ink-900 border-b border-ink-700 flex items-center px-4 gap-4">
        <Link to="/" className="flex items-center gap-2 font-bold text-prim-400">
          <Wallet size={20} /> Gestor Financeiro CCS
        </Link>
        <nav className="flex gap-1 ml-4">
          {mods.map(m => m.submenus
            ? <MenuDropdown key={m.codigo} mod={m} loc={loc} />
            : <MenuLink key={m.codigo} to={m.rota} label={m.label} loc={loc} />)}
          {u?.perm === 'A' && (
            <MenuLink to="/admin" label="Administração" icon={<Users size={15} />} loc={loc} />
          )}
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

      {/* [14/05/2026 - Alexandre Carvalho] botao flutuante de ajuda do modulo
          Inteligencia de Credito - aparece nas telas /credito/* (menos na propria
          ajuda) e abre a explicacao de como o score e calculado. */}
      {loc.pathname.startsWith('/credito') && loc.pathname !== '/credito/ajuda' && (
        <Link to="/credito/ajuda" title="Como funciona o score de crédito"
          className="fixed bottom-6 right-6 z-30 w-12 h-12 rounded-full bg-prim-600
                     hover:bg-prim-500 text-white flex items-center justify-center
                     shadow-lg shadow-black/40 transition hover:scale-105">
          <HelpCircle size={24} />
        </Link>
      )}
    </div>
  );
}

// Link simples do menu.
function MenuLink({ to, label, icon, loc }) {
  const ativo = loc.pathname === to;
  return (
    <Link to={to}
      className={`px-3 py-2 rounded-lg text-sm transition flex items-center gap-1.5
        ${ativo ? 'bg-prim-600 text-white' : 'text-gray-300 hover:bg-ink-800'}`}>
      {icon}{label}
    </Link>
  );
}

// Item de menu com submenus: abre um dropdown ao passar o mouse.
function MenuDropdown({ mod, loc }) {
  const [open, setOpen] = useState(false);
  const ativo = mod.submenus.some(sm => sm.rota === loc.pathname);
  return (
    <div className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}>
      <button type="button"
        className={`px-3 py-2 rounded-lg text-sm transition flex items-center gap-1.5
          ${ativo ? 'bg-prim-600 text-white' : 'text-gray-300 hover:bg-ink-800'}`}>
        {mod.label}
        <ChevronDown size={14} className={`transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        // pt-1 mantem uma "ponte" sob o mouse pra o dropdown nao fechar no vao
        <div className="absolute left-0 top-full pt-1 z-20 min-w-[210px]">
          <div className="bg-ink-900 border border-ink-700 rounded-lg shadow-xl py-1">
            {mod.submenus.map(sm => (
              <Link key={sm.rota} to={sm.rota}
                className={`block px-3 py-2 text-sm transition
                  ${loc.pathname === sm.rota
                    ? 'bg-prim-600 text-white'
                    : 'text-gray-300 hover:bg-ink-800'}`}>
                {sm.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
