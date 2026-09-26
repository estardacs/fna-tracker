'use client';

import { useState, useRef, useEffect } from 'react';
import { Lock, Loader2 } from 'lucide-react';

/** Full gate, unlike /diet's AuthButton: without the password the panel is not rendered
 *  at all, because it exposes every network this account has connected to. */
export default function AdminLogin() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const login = async () => {
    setLoading(true);
    setError('');
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    setLoading(false);
    if (res.ok) window.location.reload();
    else setError('Contraseña incorrecta');
  };

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="bg-gray-900/50 border border-gray-800 rounded-2xl p-8 w-full max-w-sm">
        <div className="flex items-center gap-2 mb-5">
          <Lock className="w-4 h-4 text-gray-500" />
          <h2 className="text-sm font-medium text-gray-300">Acceso restringido</h2>
        </div>

        <input
          ref={inputRef}
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') login(); }}
          placeholder="••••••••"
          className="w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-700 focus:outline-none focus:border-blue-500 mb-3"
        />

        {error && <p className="text-xs text-red-400 mb-3">{error}</p>}

        <button
          onClick={login}
          disabled={loading || !password}
          className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-medium py-2.5 rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-2"
        >
          {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Entrar
        </button>

        <p className="text-[10px] text-gray-700 mt-4 text-center">La misma contraseña de Dieta</p>
      </div>
    </div>
  );
}
