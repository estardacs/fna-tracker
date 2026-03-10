'use client';

import { useEffect, useRef, useState } from 'react';
import { Pencil, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CalorieRingProps {
  consumed: number;
  goal: number;
  onGoalSave?: (kcal: number) => Promise<void>;
}

export default function CalorieRing({ consumed, goal, onGoalSave }: CalorieRingProps) {
  const [mounted, setMounted] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(goal));
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 80);
    return () => clearTimeout(t);
  }, []);

  const openEdit = () => {
    setDraft(String(goal));
    setEditing(true);
    setTimeout(() => { inputRef.current?.select(); }, 0);
  };

  const commit = async () => {
    const kcal = parseInt(draft, 10);
    if (!kcal || kcal === goal || !onGoalSave) { setEditing(false); return; }
    setSaving(true);
    await onGoalSave(kcal);
    setEditing(false);
    setSaving(false);
  };

  const pct = goal > 0 ? Math.min(consumed / goal, 1.2) : 0;
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const dash = mounted ? Math.min(pct, 1) * circumference : 0;
  const remaining = goal - consumed;

  const color =
    consumed > goal          ? '#ef4444'
    : consumed >= goal * 0.9 ? '#f97316'
    : '#22c55e';

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative w-40 h-40">
        <svg className="rotate-[-90deg]" viewBox="0 0 120 120" width="160" height="160">
          <circle cx="60" cy="60" r={radius} fill="none" stroke="#1f2937" strokeWidth="10" />
          <circle
            cx="60" cy="60" r={radius}
            fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference}`}
            style={{ transition: 'stroke-dasharray 1s cubic-bezier(0.34, 1.56, 0.64, 1), stroke 0.4s ease' }}
          />
        </svg>
        <div
          className="absolute inset-0 flex flex-col items-center justify-center"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'scale(1)' : 'scale(0.85)',
            transition: 'opacity 0.4s ease 0.3s, transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) 0.3s',
          }}
        >
          <span className={cn('text-2xl font-bold font-mono', consumed > goal ? 'text-red-400' : 'text-white')}>
            {remaining > 0 ? remaining.toFixed(0) : `+${Math.abs(remaining).toFixed(0)}`}
          </span>
          <span className="text-[10px] text-gray-500 uppercase tracking-wide">
            {remaining > 0 ? 'restantes' : 'extra'}
          </span>
        </div>
      </div>

      {/* Consumed / goal — goal is editable */}
      <div
        className="text-center"
        style={{
          opacity: mounted ? 1 : 0,
          transform: mounted ? 'translateY(0)' : 'translateY(4px)',
          transition: 'opacity 0.4s ease 0.5s, transform 0.4s ease 0.5s',
        }}
      >
        <div className="flex items-center justify-center gap-1 text-sm text-gray-400">
          <span className="text-white font-semibold font-mono">{consumed.toFixed(0)}</span>
          <span>/</span>

          {editing ? (
            <form onSubmit={(e) => { e.preventDefault(); commit(); }} className="flex items-center gap-1">
              <input
                ref={inputRef}
                type="number"
                min="500"
                max="5000"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                className="w-16 bg-gray-800 border border-blue-500 rounded px-1.5 py-0.5 text-sm text-white font-mono text-center focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <button type="submit" disabled={saving} className="text-blue-400 hover:text-blue-300 cursor-pointer">
                <Check className="w-3.5 h-3.5" />
              </button>
            </form>
          ) : (
            <button
              onClick={openEdit}
              className="group/goal flex items-center gap-1 cursor-pointer"
              title="Cambiar objetivo calórico"
            >
              <span className="font-mono">{goal}</span>
              <Pencil className="w-3 h-3 text-gray-700 [@media(hover:none)]:opacity-100 opacity-0 group-hover/goal:opacity-100 transition-opacity" />
            </button>
          )}

          <span>kcal</span>
        </div>
      </div>
    </div>
  );
}
