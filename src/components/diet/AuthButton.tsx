'use client';

import { useState, useRef, useEffect } from 'react';
import { Lock, LockOpen, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function AuthButton({ isOwner }: { isOwner: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const login = async () => {
    setLoading(true);
    setError('');
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    setLoading(false);
    if (res.ok) {
      setOpen(false);
      setPassword('');
      router.refresh();
    } else {
      setError('Contraseña incorrecta');
    }
  };

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.refresh();
  };

  if (isOwner) {
    return (
      <button
        onClick={logout}
        title="Cerrar sesión"
        className="flex items-center gap-1.5 text-xs text-emerald-400/70 hover:text-emerald-400 transition-colors cursor-pointer"
      >
        <LockOpen className="w-4 h-4" />
        <span className="hidden sm:inline">Tuyo</span>
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Iniciar sesión"
        className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-400 transition-colors cursor-pointer"
      >
        <Lock className="w-4 h-4" />
        <span className="hidden sm:inline">Solo lectura</span>
      </button>

      {open && (
        <div className="absolute right-0 top-8 z-50 bg-gray-950 border border-gray-700 rounded-xl p-4 shadow-xl w-64">
          <p className="text-xs text-gray-400 mb-3 font-medium">Contraseña</p>
          <input
            ref={inputRef}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') login(); if (e.key === 'Escape') setOpen(false); }}
            placeholder="••••••••"
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-700 focus:outline-none focus:border-blue-500 mb-3"
          />
          {error && <p className="text-xs text-red-400 mb-2">{error}</p>}
          <button
            onClick={login}
            disabled={loading || !password}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-medium py-2 rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-2"
          >
            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Entrar
          </button>
        </div>
      )}
    </div>
  );
}
