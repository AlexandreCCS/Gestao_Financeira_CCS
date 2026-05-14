import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './index.css';
import { getSession } from './api/client';
import Login        from './pages/Login.jsx';
import SaldosBanco  from './pages/SaldosBanco.jsx';
import Conciliacao  from './pages/Conciliacao.jsx';
import FluxoCaixa   from './pages/FluxoCaixa.jsx';
import Shell        from './components/Shell.jsx';

function Protect({ children }) {
  const s = getSession();
  if (!s?.accessToken) return <Navigate to="/login" replace />;
  return <Shell>{children}</Shell>;
}

createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/"             element={<Protect><SaldosBanco /></Protect>} />
      <Route path="/saldos-banco" element={<Protect><SaldosBanco /></Protect>} />
      <Route path="/conciliacao"  element={<Protect><Conciliacao /></Protect>} />
      <Route path="/fluxo-caixa"  element={<Protect><FluxoCaixa /></Protect>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  </BrowserRouter>
);
