import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './index.css';
import { getSession } from './api/client';
import { modulosDoUsuario, podeVerModulo } from './modulos';
import Login         from './pages/Login.jsx';
import SaldosBanco   from './pages/SaldosBanco.jsx';
import Conciliacao   from './pages/Conciliacao.jsx';
import FluxoCaixa    from './pages/FluxoCaixa.jsx';
import AdminUsuarios from './pages/AdminUsuarios.jsx';
import Shell         from './components/Shell.jsx';

// [14/05/2026 - Alexandre Carvalho] Tela exibida quando o usuario logou mas nao
// tem permissao para o recurso/modulo acessado.
function SemAcesso({ msg }) {
  return (
    <div className="flex items-center justify-center h-[70vh]">
      <div className="card p-8 max-w-md text-center">
        <h2 className="text-lg font-bold text-prim-400 mb-2">Sem acesso</h2>
        <p className="text-sm text-gray-300">{msg || 'Você não tem permissão para este recurso.'}</p>
        <p className="text-xs text-gray-500 mt-3">
          Solicite a um administrador do Gestor Financeiro CCS.
        </p>
      </div>
    </div>
  );
}

// Protege rota: exige login; opcionalmente exige modulo liberado ou ser admin.
function Protect({ children, modulo, adminOnly }) {
  const s = getSession();
  if (!s?.accessToken) return <Navigate to="/login" replace />;
  const u = s.user;
  if (adminOnly && u?.perm !== 'A')
    return <Shell><SemAcesso msg="Esta área é restrita a administradores." /></Shell>;
  if (modulo && !podeVerModulo(u, modulo))
    return <Shell><SemAcesso msg="Você não tem acesso a este módulo do portal." /></Shell>;
  return <Shell>{children}</Shell>;
}

// Landing: vai pro primeiro modulo disponivel; admin sem modulo vai pra /admin;
// usuario sem nada ve a tela de "sem modulos liberados".
function Home() {
  const s = getSession();
  if (!s?.accessToken) return <Navigate to="/login" replace />;
  const u = s.user;
  const mods = modulosDoUsuario(u);
  if (mods.length > 0) return <Navigate to={mods[0].rota} replace />;
  if (u?.perm === 'A')  return <Navigate to="/admin" replace />;
  return <Shell><SemAcesso msg="Nenhum módulo liberado para o seu usuário ainda." /></Shell>;
}

createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/"             element={<Home />} />
      <Route path="/saldos-banco" element={<Protect modulo="SALDOS"><SaldosBanco /></Protect>} />
      <Route path="/conciliacao"  element={<Protect modulo="CONCILIACAO"><Conciliacao /></Protect>} />
      <Route path="/fluxo-caixa"  element={<Protect modulo="FLUXO"><FluxoCaixa /></Protect>} />
      <Route path="/admin"        element={<Protect adminOnly><AdminUsuarios /></Protect>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  </BrowserRouter>
);
