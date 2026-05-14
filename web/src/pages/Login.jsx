import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setSession } from '../api/client';

export default function Login() {
  const nav = useNavigate();
  const [login, setLogin] = useState('');
  const [senha, setSenha] = useState('');
  const [busy, setBusy]   = useState(false);
  const [err,  setErr]    = useState('');

  async function submit(e) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const r = await api.login(login.trim(), senha);
      setSession(r);
      nav('/', { replace: true });
    } catch (e) { setErr(e.message || e.error || 'Erro no login'); }
    finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-ink-950 via-ink-900 to-ink-800">
      <form onSubmit={submit} className="card p-8 w-full max-w-sm">
        <div className="flex justify-center mb-4">
          <img src="/logo-ccs.jpg" alt="CCS Tecno" className="h-16 object-contain"/>
        </div>
        <h1 className="text-2xl font-bold text-prim-400 mb-1 text-center">Gestor Financeiro CCS</h1>
        <p className="text-sm text-gray-400 mb-6 text-center">Entrar com seu usuário Mega</p>
        <label className="block mb-3">
          <span className="text-xs text-gray-300">Usuário Mega</span>
          <input className="input mt-1" autoFocus value={login} onChange={e=>setLogin(e.target.value)} required/>
        </label>
        <label className="block mb-4">
          <span className="text-xs text-gray-300">Senha</span>
          <input type="password" className="input mt-1" value={senha} onChange={e=>setSenha(e.target.value)} required/>
        </label>
        {err && <div className="bg-red-900/40 text-red-200 text-sm rounded p-2 mb-3">{err}</div>}
        <button className="btn-prim w-full justify-center" disabled={busy}>{busy ? 'Entrando...' : 'Entrar'}</button>
      </form>
    </div>
  );
}
