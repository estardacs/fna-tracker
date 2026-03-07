'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Search, Camera, Package2, Plus, Loader2, Check, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';

// ---- Types ----
interface FoodItem {
  id: string;
  name: string;
  brand?: string;
  calories_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
  fiber_per_100g?: number;
  serving_label?: string;
  use_count?: number;
  similarity_score?: number;
}

interface ComboItem {
  id: string;
  grams_consumed: number;
  food_items: {
    id: string;
    name: string;
    calories_per_100g: number;
    protein_per_100g: number;
    carbs_per_100g: number;
    fat_per_100g: number;
  };
}

interface Combo {
  id: string;
  name: string;
  use_count: number;
  last_used: string | null;
  combo_items: ComboItem[];
}

interface ScanSuggestion {
  name: string;
  grams: number;
  calories_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
  fiber_per_100g: number;
  sodium_per_100g: number;
  matched_food: { id: string; name: string; similarity: number } | null;
  // after user decision:
  use_existing: boolean;
}

interface AddFoodModalProps {
  meal: string;
  date: string;
  onClose: () => void;
  onAdded: () => void;
}

const MEAL_LABELS: Record<string, string> = {
  desayuno: 'Desayuno',
  almuerzo: 'Almuerzo',
  once: 'Once',
  cena: 'Cena',
  snack: 'Snack',
};

type Tab = 'buscar' | 'escanear' | 'combos';

const QUICK_GRAMS = [50, 100, 150, 200, 300];

// ---- Macros preview row ----
function MacroRow({ food, grams }: { food: FoodItem; grams: number }) {
  const f = grams / 100;
  return (
    <div className="flex gap-2 flex-wrap mt-1.5 text-[10px] font-mono">
      <span className="bg-orange-500/10 text-orange-400 px-1.5 py-0.5 rounded">
        {Math.round(food.calories_per_100g * f)} kcal
      </span>
      <span className="bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded">
        P {(food.protein_per_100g * f).toFixed(1)}g
      </span>
      <span className="bg-amber-500/10 text-amber-400 px-1.5 py-0.5 rounded">
        C {(food.carbs_per_100g * f).toFixed(1)}g
      </span>
      <span className="bg-pink-500/10 text-pink-400 px-1.5 py-0.5 rounded">
        G {(food.fat_per_100g * f).toFixed(1)}g
      </span>
    </div>
  );
}

// ---- Grams input ----
function GramsInput({ value, onChange }: { value: number; onChange: (g: number) => void }) {
  return (
    <div className="space-y-2">
      <label className="text-xs text-gray-400">Cantidad</label>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min="1"
          step="1"
          value={value}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
          className="w-20 bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white text-center focus:outline-none focus:border-blue-500 font-mono"
        />
        <span className="text-xs text-gray-500">g</span>
        <div className="flex gap-1 flex-wrap">
          {QUICK_GRAMS.map((g) => (
            <button
              key={g}
              onClick={() => onChange(g)}
              className={cn(
                'text-[10px] px-2 py-1 rounded border transition-colors cursor-pointer',
                value === g
                  ? 'bg-blue-600 border-blue-500 text-white'
                  : 'bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-300'
              )}
            >
              {g}g
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// BUSCAR TAB
// ============================================================
function SearchTab({ meal, date, onAdded }: { meal: string; date: string; onAdded: () => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FoodItem[]>([]);
  const [recientes, setRecientes] = useState<FoodItem[]>([]);
  const [selected, setSelected] = useState<FoodItem | null>(null);
  const [grams, setGrams] = useState(100);
  const [loading, setLoading] = useState(false);
  const [logging, setLogging] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    fetch('/api/diet/food-items?recientes=1')
      .then((r) => r.json())
      .then(setRecientes)
      .catch(() => {});
  }, []);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/diet/food-items?q=${encodeURIComponent(q)}`);
      setResults(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  const log = async () => {
    if (!selected || grams <= 0) return;
    setLogging(true);
    try {
      await fetch('/api/diet/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, meal, food_item_id: selected.id, grams_consumed: grams }),
      });
      onAdded();
    } finally {
      setLogging(false);
    }
  };

  if (showCreate) {
    return (
      <CreateFoodForm
        meal={meal}
        date={date}
        initialName={query}
        onAdded={onAdded}
        onBack={() => setShowCreate(false)}
      />
    );
  }

  if (selected) {
    return (
      <div className="space-y-4">
        <button onClick={() => setSelected(null)} className="text-xs text-blue-400 hover:text-blue-300 cursor-pointer">
          ← Volver
        </button>
        <div className="bg-gray-900 rounded-lg p-3 border border-gray-700">
          <div className="font-medium text-white text-sm">{selected.name}</div>
          {selected.brand && <div className="text-[10px] text-gray-500">{selected.brand}</div>}
          <div className="text-[10px] text-gray-600 mt-0.5">
            {selected.calories_per_100g.toFixed(0)} kcal / 100g
          </div>
        </div>

        <GramsInput value={grams} onChange={setGrams} />
        <MacroRow food={selected} grams={grams} />

        <button
          onClick={log}
          disabled={logging || grams <= 0}
          className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg py-2.5 text-sm font-medium transition-colors cursor-pointer mt-2"
        >
          {logging ? <Loader2 className="animate-spin mx-auto w-4 h-4" /> : 'Agregar al registro'}
        </button>
      </div>
    );
  }

  const displayList = query.trim() ? results : [];
  const showRecientes = !query.trim() && recientes.length > 0;

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
        <input
          type="text"
          placeholder="Buscar alimento..."
          value={query}
          onChange={(e) => { setQuery(e.target.value); search(e.target.value); }}
          className="w-full bg-gray-900 border border-gray-700 rounded-lg pl-9 pr-9 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-blue-500"
          autoFocus
        />
        {loading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 animate-spin" />}
      </div>

      {/* Recientes */}
      {showRecientes && (
        <div>
          <p className="text-[10px] text-gray-600 uppercase tracking-wide mb-1.5">Recientes</p>
          <ul className="space-y-1">
            {recientes.map((item) => (
              <FoodRow key={item.id} item={item} onSelect={() => setSelected(item)} />
            ))}
          </ul>
        </div>
      )}

      {/* Search results */}
      {displayList.length > 0 && (
        <ul className="space-y-1 max-h-48 overflow-y-auto">
          {displayList.map((item) => (
            <FoodRow key={item.id} item={item} onSelect={() => setSelected(item)} />
          ))}
        </ul>
      )}

      {query.trim() && displayList.length === 0 && !loading && (
        <div className="text-center py-4">
          <p className="text-sm text-gray-500 mb-3">No se encontró &ldquo;{query}&rdquo;</p>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 mx-auto text-xs text-blue-400 hover:text-blue-300 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" /> Crear nuevo alimento
          </button>
        </div>
      )}

      <button
        onClick={() => setShowCreate(true)}
        className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-400 cursor-pointer"
      >
        <Plus className="w-3.5 h-3.5" /> Crear alimento manualmente
      </button>
    </div>
  );
}

function FoodRow({ item, onSelect }: { item: FoodItem; onSelect: () => void }) {
  return (
    <li
      onClick={onSelect}
      className="flex justify-between items-center px-3 py-2.5 rounded-lg hover:bg-gray-800 cursor-pointer transition-colors"
    >
      <div className="min-w-0">
        <div className="text-sm text-white truncate">{item.name}</div>
        {item.brand && <div className="text-[10px] text-gray-500">{item.brand}</div>}
      </div>
      <span className="text-xs text-gray-500 font-mono ml-3 shrink-0">
        {item.calories_per_100g?.toFixed(0) ?? '—'} kcal/100g
      </span>
    </li>
  );
}

// ---- Create Food Form ----
function CreateFoodForm({
  meal, date, initialName = '', onAdded, onBack,
}: {
  meal: string; date: string; initialName?: string; onAdded: () => void; onBack: () => void;
}) {
  const [form, setForm] = useState({
    name: initialName, brand: '',
    calories_per_100g: '', protein_per_100g: '', carbs_per_100g: '', fat_per_100g: '',
    fiber_per_100g: '', sodium_per_100g: '', serving_label: '',
  });
  const [grams, setGrams] = useState(100);
  const [saving, setSaving] = useState(false);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.name || !form.calories_per_100g) return;
    setSaving(true);
    try {
      const res = await fetch('/api/diet/food-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          brand: form.brand || null,
          calories_per_100g: parseFloat(form.calories_per_100g) || 0,
          protein_per_100g:  parseFloat(form.protein_per_100g)  || 0,
          carbs_per_100g:    parseFloat(form.carbs_per_100g)    || 0,
          fat_per_100g:      parseFloat(form.fat_per_100g)      || 0,
          fiber_per_100g:    parseFloat(form.fiber_per_100g)    || 0,
          sodium_per_100g:   parseFloat(form.sodium_per_100g)   || 0,
          serving_label:     form.serving_label || null,
          serving_size_g:    100,
        }),
      });
      const { item } = await res.json();
      await fetch('/api/diet/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, meal, food_item_id: item.id, grams_consumed: grams }),
      });
      onAdded();
    } finally {
      setSaving(false);
    }
  };

  const field = (k: string, label: string, type = 'number') => (
    <div>
      <label className="text-[10px] text-gray-500 uppercase tracking-wide block mb-0.5">{label}</label>
      <input
        type={type}
        value={(form as any)[k]}
        onChange={(e) => set(k, e.target.value)}
        className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
      />
    </div>
  );

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-xs text-blue-400 hover:text-blue-300 cursor-pointer">
        ← Volver
      </button>
      <p className="text-xs text-gray-500">Los valores nutricionales van por 100g</p>
      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2">{field('name', 'Nombre', 'text')}</div>
        <div className="col-span-2">{field('brand', 'Marca (opcional)', 'text')}</div>
        {field('calories_per_100g', 'Calorías / 100g')}
        {field('protein_per_100g',  'Proteína / 100g')}
        {field('carbs_per_100g',    'Carbos / 100g')}
        {field('fat_per_100g',      'Grasas / 100g')}
        {field('fiber_per_100g',    'Fibra / 100g')}
        {field('sodium_per_100g',   'Sodio mg / 100g')}
      </div>
      <GramsInput value={grams} onChange={setGrams} />
      <button
        onClick={save}
        disabled={saving || !form.name || !form.calories_per_100g}
        className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg py-2 text-sm font-medium transition-colors cursor-pointer"
      >
        {saving ? <Loader2 className="animate-spin mx-auto w-4 h-4" /> : 'Guardar y registrar'}
      </button>
    </div>
  );
}

// ============================================================
// ESCANEAR TAB
// ============================================================
function ScanTab({ meal, date, onAdded }: { meal: string; date: string; onAdded: () => void }) {
  const [text, setText] = useState('');
  const [imageB64, setImageB64] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [suggestions, setSuggestions] = useState<ScanSuggestion[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImageB64((reader.result as string).replace(/^data:.+;base64,/, ''));
    reader.readAsDataURL(file);
  };

  const scan = async () => {
    setScanning(true);
    setSuggestions(null);
    setError(null);
    try {
      const res = await fetch('/api/diet/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          imageB64
            ? { type: 'image', input: imageB64 }
            : { type: 'text', input: text }
        ),
      });
      const data = await res.json();
      if (!res.ok || data.error) { setError(data.error ?? `Error ${res.status}`); return; }
      if (!data.suggestions?.length) { setError('No se detectaron alimentos.'); return; }

      setSuggestions(
        data.suggestions.map((s: any) => ({
          ...s,
          grams:        s.grams ?? 100,
          use_existing: !!s.matched_food,
        }))
      );
    } catch (e: any) {
      setError(e.message ?? 'Error de red');
    } finally {
      setScanning(false);
    }
  };

  const updateGrams = (idx: number, g: number) => {
    setSuggestions((prev) => prev ? prev.map((s, i) => i === idx ? { ...s, grams: g } : s) : prev);
  };

  const updateField = (idx: number, key: string, val: string | number) => {
    setSuggestions((prev) =>
      prev ? prev.map((s, i) => i === idx ? { ...s, [key]: typeof val === 'string' ? parseFloat(val) || 0 : val } : s) : prev
    );
  };

  const toggleUseExisting = (idx: number) => {
    setSuggestions((prev) =>
      prev ? prev.map((s, i) => i === idx ? { ...s, use_existing: !s.use_existing } : s) : prev
    );
  };

  const saveAll = async () => {
    if (!suggestions) return;
    setSaving(true);
    setError(null);
    try {
      for (const s of suggestions) {
        if (s.use_existing && s.matched_food) {
          // Use existing food item
          const logRes = await fetch('/api/diet/log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date, meal, food_item_id: s.matched_food.id, grams_consumed: s.grams }),
          });
          if (!logRes.ok) {
            const logData = await logRes.json().catch(() => ({}));
            throw new Error(logData.error ?? `Error al registrar "${s.name}"`);
          }
        } else {
          // Create new food item (per-100g) + log
          const foodRes = await fetch('/api/diet/food-items', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: s.name,
              calories_per_100g: s.calories_per_100g,
              protein_per_100g:  s.protein_per_100g,
              carbs_per_100g:    s.carbs_per_100g,
              fat_per_100g:      s.fat_per_100g,
              fiber_per_100g:    s.fiber_per_100g,
              sodium_per_100g:   s.sodium_per_100g,
              serving_size_g:    100,
            }),
          });
          const foodData = await foodRes.json().catch(() => ({}));
          if (!foodRes.ok || !foodData.item) {
            throw new Error(foodData.error ?? `Error al guardar "${s.name}"`);
          }
          const logRes = await fetch('/api/diet/log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date, meal, food_item_id: foodData.item.id, grams_consumed: s.grams }),
          });
          if (!logRes.ok) {
            const logData = await logRes.json().catch(() => ({}));
            throw new Error(logData.error ?? `Error al registrar "${s.name}"`);
          }
        }
      }
      onAdded();
    } catch (e: any) {
      setError(e.message ?? 'Error inesperado');
    } finally {
      setSaving(false);
    }
  };

  if (suggestions) {
    return (
      <div className="space-y-4">
        <p className="text-xs text-green-400">
          {suggestions.length === 1 ? '1 alimento' : `${suggestions.length} alimentos`} — revisa y ajusta:
        </p>
        <div className="space-y-3 max-h-[42vh] overflow-y-auto pr-1">
          {suggestions.map((s, idx) => (
            <ScanItemCard
              key={idx}
              s={s}
              onGramsChange={(g) => updateGrams(idx, g)}
              onFieldChange={(k, v) => updateField(idx, k, v)}
              onToggleExisting={() => toggleUseExisting(idx)}
            />
          ))}
        </div>
        {error && <p className="text-xs text-red-400 text-center">{error}</p>}
        <button
          onClick={saveAll}
          disabled={saving}
          className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg py-2.5 text-sm font-medium transition-colors cursor-pointer"
        >
          {saving
            ? <Loader2 className="animate-spin mx-auto w-4 h-4" />
            : suggestions.length === 1 ? 'Registrar' : `Registrar ${suggestions.length} alimentos`}
        </button>
        <button onClick={() => { setSuggestions(null); setError(null); }} className="w-full text-xs text-gray-600 hover:text-gray-400 cursor-pointer">
          ← Volver a escanear
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs text-gray-400 block mb-1.5">
          Describe lo que comiste
        </label>
        <textarea
          placeholder="Ej: 92g de hallulla, 2 huevos revueltos, 96g de durazno"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-blue-500 resize-none"
          autoFocus
        />
      </div>

      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-gray-800" />
        <span className="text-xs text-gray-600">o</span>
        <div className="flex-1 h-px bg-gray-800" />
      </div>

      <div>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
        <button
          onClick={() => fileRef.current?.click()}
          className="flex items-center gap-2 text-sm text-gray-400 hover:text-white border border-gray-700 hover:border-gray-600 rounded-lg px-3 py-2 transition-colors cursor-pointer w-full"
        >
          <Camera className="w-4 h-4" />
          {imageB64 ? '✓ Imagen cargada' : 'Subir foto de etiqueta nutricional'}
        </button>
      </div>

      {error && (
        <p className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {error}
        </p>
      )}

      <button
        onClick={scan}
        disabled={scanning || (!text.trim() && !imageB64)}
        className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-lg py-2.5 text-sm font-medium transition-colors cursor-pointer"
      >
        {scanning ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 className="animate-spin w-4 h-4" /> Analizando...
          </span>
        ) : 'Analizar con IA'}
      </button>
    </div>
  );
}

function ScanItemCard({
  s, onGramsChange, onFieldChange, onToggleExisting,
}: {
  s: ScanSuggestion;
  onGramsChange: (g: number) => void;
  onFieldChange: (k: string, v: string | number) => void;
  onToggleExisting: () => void;
}) {
  const [expanded, setExpanded] = useState(!s.matched_food);

  const activeMacros: FoodItem = {
    id: '', name: s.name,
    calories_per_100g: s.calories_per_100g,
    protein_per_100g:  s.protein_per_100g,
    carbs_per_100g:    s.carbs_per_100g,
    fat_per_100g:      s.fat_per_100g,
  };

  return (
    <div className="bg-gray-900 border border-gray-700/80 rounded-lg p-3 space-y-2.5">
      {/* Name + match badge */}
      <div className="flex items-start justify-between gap-2">
        <input
          type="text"
          value={s.name}
          onChange={(e) => onFieldChange('name', e.target.value)}
          className="flex-1 bg-transparent border-b border-gray-700 pb-0.5 text-sm font-medium text-white focus:outline-none focus:border-blue-500"
        />
        {s.matched_food && (
          <button
            onClick={onToggleExisting}
            className={cn(
              'shrink-0 flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border cursor-pointer transition-colors',
              s.use_existing
                ? 'border-green-600 text-green-400 bg-green-500/10'
                : 'border-gray-600 text-gray-500 bg-transparent hover:border-gray-500'
            )}
          >
            <Check className="w-3 h-3" />
            {s.use_existing ? `Usando "${s.matched_food.name}"` : 'Usar existente'}
          </button>
        )}
      </div>

      {/* Grams */}
      <div className="flex items-center gap-2">
        <input
          type="number"
          min="1"
          step="1"
          value={s.grams}
          onChange={(e) => onGramsChange(Number(e.target.value) || 0)}
          className="w-16 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white text-center focus:outline-none focus:border-blue-500 font-mono"
        />
        <span className="text-[10px] text-gray-500">g</span>
        <div className="flex gap-1">
          {QUICK_GRAMS.map((g) => (
            <button
              key={g}
              onClick={() => onGramsChange(g)}
              className={cn(
                'text-[10px] px-1.5 py-0.5 rounded border transition-colors cursor-pointer',
                s.grams === g
                  ? 'bg-blue-600/30 border-blue-600 text-blue-400'
                  : 'bg-transparent border-gray-700 text-gray-600 hover:text-gray-400'
              )}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      {/* Macros */}
      <MacroRow food={activeMacros} grams={s.grams} />

      {/* Editable per-100g fields (for new items) */}
      {!s.use_existing && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1 text-[10px] text-gray-600 hover:text-gray-400 cursor-pointer"
        >
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          Editar macros / 100g
        </button>
      )}
      {!s.use_existing && expanded && (
        <div className="grid grid-cols-2 gap-1.5 pt-1 border-t border-gray-800">
          {([
            ['calories_per_100g', 'Kcal/100g'],
            ['protein_per_100g',  'Prot/100g'],
            ['carbs_per_100g',    'Carbos/100g'],
            ['fat_per_100g',      'Grasas/100g'],
          ] as [string, string][]).map(([k, label]) => (
            <div key={k}>
              <label className="text-[10px] text-gray-600 block">{label}</label>
              <input
                type="number"
                value={(s as any)[k]}
                onChange={(e) => onFieldChange(k, e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded px-1.5 py-1 text-xs text-white focus:outline-none focus:border-blue-500"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// COMBOS TAB
// ============================================================
function CombosTab({ meal, date, onAdded }: { meal: string; date: string; onAdded: () => void }) {
  const [combos, setCombos] = useState<Combo[]>([]);
  const [loading, setLoading] = useState(true);
  const [logging, setLogging] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [comboGrams, setComboGrams] = useState<Record<string, Record<string, number>>>({});

  // Creation form state
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newItems, setNewItems] = useState<{ food: FoodItem; grams: number }[]>([]);
  const [itemQ, setItemQ] = useState('');
  const [itemResults, setItemResults] = useState<FoodItem[]>([]);
  const [searchingItems, setSearchingItems] = useState(false);
  const [savingCombo, setSavingCombo] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch('/api/diet/combos')
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setCombos(data); })
      .finally(() => setLoading(false));
  }, []);

  const getGrams = (comboId: string, itemId: string, defaultG: number) =>
    comboGrams[comboId]?.[itemId] ?? defaultG;

  const setGrams = (comboId: string, itemId: string, g: number) =>
    setComboGrams((prev) => ({
      ...prev,
      [comboId]: { ...(prev[comboId] ?? {}), [itemId]: g },
    }));

  const logCombo = async (combo: Combo) => {
    setLogging(combo.id);
    try {
      const items = combo.combo_items.map((ci) => ({
        food_item_id:   ci.food_items.id,
        grams_consumed: getGrams(combo.id, ci.id, ci.grams_consumed),
      }));
      await fetch('/api/diet/combos/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ combo_id: combo.id, date, meal, items }),
      });
      onAdded();
    } finally {
      setLogging(null);
    }
  };

  // ---- Creation helpers ----
  const handleItemSearchChange = (q: string) => {
    setItemQ(q);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!q.trim()) { setItemResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      setSearchingItems(true);
      try {
        const res = await fetch(`/api/diet/food-items?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        setItemResults(Array.isArray(data) ? data.slice(0, 6) : []);
      } finally {
        setSearchingItems(false);
      }
    }, 300);
  };

  const addItemToCombo = (food: FoodItem) => {
    setNewItems((prev) => prev.find((i) => i.food.id === food.id) ? prev : [...prev, { food, grams: 100 }]);
    setItemQ('');
    setItemResults([]);
  };

  const removeItemFromCombo = (foodId: string) =>
    setNewItems((prev) => prev.filter((i) => i.food.id !== foodId));

  const updateItemGrams = (foodId: string, g: number) =>
    setNewItems((prev) => prev.map((i) => i.food.id === foodId ? { ...i, grams: g } : i));

  const resetCreation = () => {
    setCreating(false);
    setNewName('');
    setNewItems([]);
    setItemQ('');
    setItemResults([]);
    setCreateError(null);
  };

  const saveCombo = async (andLog: boolean) => {
    if (!newName.trim() || newItems.length === 0) return;
    setSavingCombo(true);
    setCreateError(null);
    try {
      const comboRes = await fetch('/api/diet/combos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          items: newItems.map((i) => ({ food_item_id: i.food.id, grams_consumed: i.grams })),
        }),
      });
      const comboData = await comboRes.json().catch(() => ({}));
      if (!comboRes.ok || !comboData.combo) throw new Error(comboData.error ?? 'Error al guardar combo');

      if (andLog) {
        const logRes = await fetch('/api/diet/combos/log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            combo_id: comboData.combo.id,
            date, meal,
            items: newItems.map((i) => ({ food_item_id: i.food.id, grams_consumed: i.grams })),
          }),
        });
        if (!logRes.ok) {
          const ld = await logRes.json().catch(() => ({}));
          throw new Error(ld.error ?? 'Error al registrar');
        }
        onAdded();
      } else {
        // Add to list locally so user sees it immediately
        setCombos((prev) => [...prev, {
          ...comboData.combo,
          combo_items: newItems.map((i, idx) => ({
            id: `tmp-${idx}`,
            grams_consumed: i.grams,
            food_items: { id: i.food.id, name: i.food.name, calories_per_100g: i.food.calories_per_100g, protein_per_100g: i.food.protein_per_100g, carbs_per_100g: i.food.carbs_per_100g, fat_per_100g: i.food.fat_per_100g },
          })),
        }]);
        resetCreation();
      }
    } catch (e: any) {
      setCreateError(e.message ?? 'Error inesperado');
    } finally {
      setSavingCombo(false);
    }
  };

  if (loading) {
    return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 text-gray-600 animate-spin" /></div>;
  }

  // ---- Creation form ----
  if (creating) {
    const totalKcal = newItems.reduce((s, i) => s + (i.food.calories_per_100g * i.grams / 100), 0);
    const totalProt = newItems.reduce((s, i) => s + (i.food.protein_per_100g * i.grams / 100), 0);
    const canSave = newName.trim().length > 0 && newItems.length > 0;

    return (
      <div className="space-y-3">
        {/* Header */}
        <div className="flex items-center gap-2">
          <button onClick={resetCreation} className="text-gray-600 hover:text-gray-400 cursor-pointer text-xs transition-colors">←</button>
          <span className="text-sm font-medium text-gray-300">Nuevo combo</span>
        </div>

        {/* Name */}
        <input
          type="text"
          placeholder="Nombre del combo (ej: Súper Tupper)"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
        />

        {/* Item search */}
        <div className="relative">
          <div className="relative flex items-center">
            {searchingItems
              ? <Loader2 className="absolute left-3 w-3.5 h-3.5 text-gray-500 animate-spin" />
              : <Search className="absolute left-3 w-3.5 h-3.5 text-gray-600" />}
            <input
              type="text"
              placeholder="Buscar alimento para agregar..."
              value={itemQ}
              onChange={(e) => handleItemSearchChange(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg pl-8 pr-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
            />
          </div>
          {itemResults.length > 0 && (
            <div className="absolute top-full mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg z-10 overflow-hidden shadow-xl">
              {itemResults.map((food) => (
                <button
                  key={food.id}
                  onClick={() => addItemToCombo(food)}
                  className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-gray-800 cursor-pointer transition-colors"
                >
                  <span className="text-sm text-gray-200 truncate">{food.name}</span>
                  <span className="text-[10px] text-gray-500 font-mono shrink-0 ml-2">{food.calories_per_100g} kcal/100g</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Items list */}
        {newItems.length > 0 && (
          <div className="space-y-1.5 max-h-44 overflow-y-auto pr-0.5">
            {newItems.map((item) => (
              <div key={item.food.id} className="flex items-center gap-2 bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2">
                <span className="flex-1 text-xs text-gray-200 truncate">{item.food.name}</span>
                <input
                  type="number"
                  min="1"
                  value={item.grams}
                  onChange={(e) => updateItemGrams(item.food.id, Number(e.target.value) || 1)}
                  className="w-14 bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-xs text-white text-center focus:outline-none focus:border-blue-500 font-mono"
                />
                <span className="text-[10px] text-gray-600">g</span>
                <span className="text-[10px] text-gray-500 font-mono w-12 text-right">
                  {(item.food.calories_per_100g * item.grams / 100).toFixed(0)} kcal
                </span>
                <button onClick={() => removeItemFromCombo(item.food.id)} className="text-gray-700 hover:text-red-400 cursor-pointer transition-colors">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Total preview */}
        {newItems.length > 0 && (
          <div className="flex items-center gap-3 px-3 py-2 bg-gray-900/30 border border-gray-800/50 rounded-lg">
            <span className="text-xs text-gray-500">Total:</span>
            <span className="text-sm font-mono text-gray-200">{Math.round(totalKcal)} kcal</span>
            <span className="text-xs text-gray-600 font-mono">{totalProt.toFixed(1)}g prot</span>
          </div>
        )}

        {createError && <p className="text-xs text-red-400">{createError}</p>}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => saveCombo(false)}
            disabled={savingCombo || !canSave}
            className="flex-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-200 rounded-lg py-2 text-xs font-medium transition-colors cursor-pointer"
          >
            {savingCombo ? <Loader2 className="animate-spin mx-auto w-4 h-4" /> : 'Solo guardar'}
          </button>
          <button
            onClick={() => saveCombo(true)}
            disabled={savingCombo || !canSave}
            className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-lg py-2 text-xs font-medium transition-colors cursor-pointer"
          >
            {savingCombo ? <Loader2 className="animate-spin mx-auto w-4 h-4" /> : 'Guardar y registrar'}
          </button>
        </div>
      </div>
    );
  }

  // ---- Empty state ----
  if (combos.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500 text-sm space-y-3">
        <Package2 className="w-8 h-8 mx-auto text-gray-700" />
        <p>Aún no tienes combos guardados.</p>
        <p className="text-xs text-gray-600">
          Los combos (tappers, desayunos habituales) permiten<br />registrar varios alimentos de una vez.
        </p>
        <button
          onClick={() => setCreating(true)}
          className="mx-auto flex items-center gap-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-2 rounded-lg cursor-pointer transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Crear primer combo
        </button>
      </div>
    );
  }

  // ---- Combo list ----
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1 text-[10px] text-gray-600 hover:text-gray-400 cursor-pointer transition-colors"
        >
          <Plus className="w-3 h-3" /> Nuevo combo
        </button>
      </div>
      {combos.map((combo) => {
        const isOpen = expandedId === combo.id;
        const totalKcal = combo.combo_items.reduce((sum, ci) => {
          const g = getGrams(combo.id, ci.id, ci.grams_consumed);
          return sum + (ci.food_items.calories_per_100g * g / 100);
        }, 0);

        return (
          <div key={combo.id} className="border border-gray-800 rounded-xl overflow-hidden">
            <div
              className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-900/40 transition-colors"
              onClick={() => setExpandedId(isOpen ? null : combo.id)}
            >
              <div>
                <div className="text-sm font-medium text-gray-200">{combo.name}</div>
                <div className="text-[10px] text-gray-500 font-mono mt-0.5">
                  {Math.round(totalKcal)} kcal · {combo.combo_items.length} items
                  {combo.use_count > 0 && ` · usado ${combo.use_count}×`}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={(e) => { e.stopPropagation(); logCombo(combo); }}
                  disabled={logging === combo.id}
                  className="flex items-center gap-1 text-[10px] bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors"
                >
                  {logging === combo.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                  Agregar
                </button>
                <ChevronDown className={cn('w-4 h-4 text-gray-600 transition-transform duration-200', isOpen && 'rotate-180')} />
              </div>
            </div>

            <div
              className={cn(
                'grid transition-[grid-template-rows] duration-300 ease-in-out',
                isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
              )}
            >
              <div className="overflow-hidden">
                <div className="border-t border-gray-800/40 px-4 py-3 space-y-2">
                  {combo.combo_items.map((ci) => {
                    const g = getGrams(combo.id, ci.id, ci.grams_consumed);
                    const kcal = (ci.food_items.calories_per_100g * g / 100).toFixed(0);
                    return (
                      <div key={ci.id} className="flex items-center gap-3">
                        <span className="text-xs text-gray-300 flex-1 truncate">{ci.food_items.name}</span>
                        <input
                          type="number"
                          min="1"
                          value={g}
                          onChange={(e) => setGrams(combo.id, ci.id, Number(e.target.value) || ci.grams_consumed)}
                          className="w-14 bg-gray-900 border border-gray-700 rounded px-1.5 py-0.5 text-xs text-white text-center focus:outline-none focus:border-blue-500 font-mono"
                          onClick={(e) => e.stopPropagation()}
                        />
                        <span className="text-[10px] text-gray-600">g</span>
                        <span className="text-[10px] text-gray-500 font-mono w-14 text-right">{kcal} kcal</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// MODAL SHELL
// ============================================================
export default function AddFoodModal({ meal, date, onClose, onAdded }: AddFoodModalProps) {
  const [tab, setTab] = useState<Tab>('buscar');
  const [activeTab, setActiveTab] = useState<Tab>('buscar');
  const [tabVisible, setTabVisible] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 10);
    return () => clearTimeout(t);
  }, []);

  const switchTab = (next: Tab) => {
    if (next === tab) return;
    setTabVisible(false);
    setTimeout(() => {
      setTab(next);
      setActiveTab(next);
      setTabVisible(true);
    }, 120);
  };

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'buscar',   label: 'Buscar',   icon: <Search className="w-3.5 h-3.5" /> },
    { id: 'escanear', label: 'Escanear', icon: <Camera className="w-3.5 h-3.5" /> },
    { id: 'combos',   label: 'Combos',   icon: <Package2 className="w-3.5 h-3.5" /> },
  ];

  const handleAdded = () => { onAdded(); onClose(); };

  // Portal: render outside all stacking contexts so z-index works correctly
  // (parent divs with transform create stacking contexts that trap z-index)
  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 backdrop-blur-sm"
        style={{
          background: 'rgba(0,0,0,0.75)',
          opacity: mounted ? 1 : 0,
          transition: 'opacity 0.25s ease',
        }}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className="relative bg-gray-950 border border-gray-800 rounded-2xl w-full max-w-md shadow-2xl"
        style={{
          opacity: mounted ? 1 : 0,
          transform: mounted ? 'translateY(0) scale(1)' : 'translateY(12px) scale(0.97)',
          transition: 'opacity 0.3s ease, transform 0.3s cubic-bezier(0.34, 1.4, 0.64, 1)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-800">
          <div>
            <h2 className="font-semibold text-white">Agregar alimento</h2>
            <p className="text-xs text-gray-500">{MEAL_LABELS[meal] ?? meal}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-gray-800 rounded-lg transition-colors cursor-pointer text-gray-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-800">
          {tabs.map(({ id, label, icon }) => (
            <button
              key={id}
              onClick={() => switchTab(id)}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-all duration-200 cursor-pointer border-b-2',
                activeTab === id
                  ? 'text-white border-blue-500'
                  : 'text-gray-500 hover:text-gray-300 border-transparent'
              )}
            >
              {icon} {label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div
          className="p-5 max-h-[65vh] overflow-y-auto"
          style={{
            opacity: tabVisible ? 1 : 0,
            transform: tabVisible ? 'translateY(0)' : 'translateY(4px)',
            transition: 'opacity 0.15s ease, transform 0.15s ease',
          }}
        >
          {tab === 'buscar'   && <SearchTab meal={meal} date={date} onAdded={handleAdded} />}
          {tab === 'escanear' && <ScanTab   meal={meal} date={date} onAdded={handleAdded} />}
          {tab === 'combos'   && <CombosTab meal={meal} date={date} onAdded={handleAdded} />}
        </div>
      </div>
    </div>,
    document.body
  );
}
