// [14/05/2026 - ALTERADO POR ALEXANDRE CARVALHO] Tela de login no layout CCS
// (padrao DataVision): fundo navy, card branco centralizado, logo CCS Tecno,
// campos claros e botao azul. Funcao de login inalterada (usuario Mega).
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setSession } from '../api/client';

export default function Login() {
  const nav = useNavigate();
  const [login, setLogin] = useState('');
  const [senha, setSenha] = useState('');
  const [busy, setBusy]   = useState(false);
  const [err,  setErr]    = useState('');
  const [info, setInfo]   = useState('');

  async function submit(e) {
    e.preventDefault(); setBusy(true); setErr(''); setInfo('');
    try {
      const r = await api.login(login.trim(), senha);
      setSession(r);
      nav('/', { replace: true });
    } catch (e) { setErr(e.message || e.error || 'Erro no login'); }
    finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4
                    bg-gradient-to-br from-[#0c1c3a] via-[#11264a] to-[#0a1733]">
      <form onSubmit={submit}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8 sm:p-10">
        <div className="flex justify-center mb-6">
          <img src="/logo-ccstecno.png" alt="CCS Tecno" className="h-20 object-contain" />
        </div>
        <h1 className="text-3xl font-bold text-slate-800 text-center">Gestor Financeiro CCS</h1>
        <p className="text-sm text-slate-500 mt-1 mb-7 text-center">Faça login para continuar</p>

        <label className="block mb-4">
          <span className="text-sm font-semibold text-slate-700">Usuário Mega</span>
          <input
            className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-4 py-3
                       text-slate-800 placeholder-slate-400 outline-none transition
                       focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
            placeholder="seu usuário"
            autoFocus value={login} onChange={e => setLogin(e.target.value)} required />
        </label>

        <label className="block mb-5">
          <span className="text-sm font-semibold text-slate-700">Senha</span>
          <input type="password"
            className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-4 py-3
                       text-slate-800 placeholder-slate-400 outline-none transition
                       focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
            placeholder="••••••••"
            value={senha} onChange={e => setSenha(e.target.value)} required />
        </label>

        {err && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-2.5 mb-4">
            {err}
          </div>
        )}
        {info && (
          <div className="bg-blue-50 border border-blue-200 text-blue-700 text-sm rounded-lg p-2.5 mb-4">
            {info}
          </div>
        )}

        <button
          className="w-full rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold
                     py-3 transition disabled:opacity-60 disabled:cursor-not-allowed"
          disabled={busy}>
          {busy ? 'Entrando...' : 'Entrar'}
        </button>

        <div className="text-center mt-4">
          <button type="button"
            className="text-sm text-blue-600 hover:text-blue-700 hover:underline"
            onClick={() => setInfo('Para redefinir sua senha, procure o administrador do portal ou troque pelo Mega.')}>
            Esqueci minha senha
          </button>
        </div>
      </form>
    </div>
  );
}
