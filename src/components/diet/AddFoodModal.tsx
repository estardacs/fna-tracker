'use client';

import { useState, useRef, useCallback } from 'react';
import { X, Search, Camera, ChefHat, Plus, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FoodItem {
  id: string;
  name: string;
  brand?: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  serving_label?: string;
}

interface Recipe {
  id: string;
  name: string;
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

type Tab = 'buscar' | 'escanear' | 'recetas';

// ---- Search Tab ----
function SearchTab({ meal, date, onAdded }: { meal: string; date: string; onAdded: () => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FoodItem[]>([]);
  const [selected, setSelected] = useState<FoodItem | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(false);
  const [logging, setLogging] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

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
    if (!selected) return;
    setLogging(true);
    try {
      await fetch('/api/diet/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, meal, food_item_id: selected.id, quantity }),
      });
      onAdded();
    } finally {
      setLogging(false);
    }
  };

  if (showCreate) {
    return <CreateFoodForm meal={meal} date={date} initialName={query} onAdded={onAdded} onBack={() => setShowCreate(false)} />;
  }

  if (selected) {
    return (
      <div className="space-y-4">
        <button onClick={() => setSelected(null)} className="text-xs text-blue-400 hover:text-blue-300 cursor-pointer">← Volver</button>
        <div className="bg-gray-900 rounded-lg p-4 border border-gray-700">
          <div className="font-medium text-white">{selected.name}</div>
          {selected.brand && <div className="text-xs text-gray-500">{selected.brand}</div>}
          <div className="flex gap-3 mt-2 text-xs text-gray-400">
            <span>{selected.calories} kcal</span>
            <span>P: {selected.protein_g}g</span>
            <span>C: {selected.carbs_g}g</span>
            <span>G: {selected.fat_g}g</span>
          </div>
          {selected.serving_label && <div className="text-[10px] text-gray-600 mt-1">Porción: {selected.serving_label}</div>}
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Porciones</label>
          <input
            type="number"
            min="0.1"
            step="0.1"
            value={quantity}
            onChange={(e) => setQuantity(parseFloat(e.target.value) || 1)}
            className="w-24 bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
          />
          <span className="text-xs text-gray-500 ml-2">= {(selected.calories * quantity).toFixed(0)} kcal</span>
        </div>
        <button
          onClick={log}
          disabled={logging}
          className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg py-2 text-sm font-medium transition-colors cursor-pointer"
        >
          {logging ? <Loader2 className="animate-spin mx-auto w-4 h-4" /> : 'Agregar al registro'}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
        <input
          type="text"
          placeholder="Buscar alimento..."
          value={query}
          onChange={(e) => { setQuery(e.target.value); search(e.target.value); }}
          className="w-full bg-gray-900 border border-gray-700 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-blue-500"
          autoFocus
        />
        {loading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 animate-spin" />}
      </div>

      {results.length > 0 && (
        <ul className="space-y-1 max-h-52 overflow-y-auto">
          {results.map((item) => (
            <li
              key={item.id}
              onClick={() => setSelected(item)}
              className="flex justify-between items-center px-3 py-2 rounded-lg hover:bg-gray-800 cursor-pointer transition-colors"
            >
              <div>
                <div className="text-sm text-white">{item.name}</div>
                {item.brand && <div className="text-[10px] text-gray-500">{item.brand}</div>}
              </div>
              <span className="text-xs text-gray-400 font-mono">{item.calories} kcal</span>
            </li>
          ))}
        </ul>
      )}

      {query.length > 0 && results.length === 0 && !loading && (
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

      {query.length === 0 && (
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" /> Crear nuevo alimento
        </button>
      )}
    </div>
  );
}

// ---- Create Food Form ----
function CreateFoodForm({ meal, date, initialName = '', onAdded, onBack }: { meal: string; date: string; initialName?: string; onAdded: () => void; onBack: () => void }) {
  const [form, setForm] = useState({
    name: initialName, brand: '', calories: '', protein_g: '', carbs_g: '', fat_g: '',
    fiber_g: '', sodium_mg: '', sugar_g: '', serving_size_g: '', serving_label: '',
  });
  const [quantity, setQuantity] = useState(1);
  const [saving, setSaving] = useState(false);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.name || !form.calories) return;
    setSaving(true);
    try {
      const res = await fetch('/api/diet/food-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          calories: parseFloat(form.calories) || 0,
          protein_g: parseFloat(form.protein_g) || 0,
          carbs_g: parseFloat(form.carbs_g) || 0,
          fat_g: parseFloat(form.fat_g) || 0,
          fiber_g: parseFloat(form.fiber_g) || 0,
          sodium_mg: parseFloat(form.sodium_mg) || 0,
          sugar_g: parseFloat(form.sugar_g) || 0,
          serving_size_g: parseFloat(form.serving_size_g) || null,
          serving_label: form.serving_label || null,
          brand: form.brand || null,
        }),
      });
      const { item } = await res.json();
      await fetch('/api/diet/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, meal, food_item_id: item.id, quantity }),
      });
      onAdded();
    } finally {
      setSaving(false);
    }
  };

  const field = (k: string, label: string, type = 'number', placeholder = '') => (
    <div>
      <label className="text-[10px] text-gray-500 uppercase tracking-wide block mb-0.5">{label}</label>
      <input
        type={type}
        placeholder={placeholder}
        value={(form as any)[k]}
        onChange={(e) => set(k, e.target.value)}
        className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
      />
    </div>
  );

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-xs text-blue-400 hover:text-blue-300 cursor-pointer">← Volver</button>
      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2">{field('name', 'Nombre', 'text')}</div>
        <div className="col-span-2">{field('brand', 'Marca (opcional)', 'text')}</div>
        {field('calories', 'Calorías (kcal)')}
        {field('protein_g', 'Proteína (g)')}
        {field('carbs_g', 'Carbos (g)')}
        {field('fat_g', 'Grasas (g)')}
        {field('fiber_g', 'Fibra (g)')}
        {field('sodium_mg', 'Sodio (mg)')}
        {field('serving_size_g', 'Tamaño porción (g)')}
        {field('serving_label', 'Descripción porción', 'text', '1 taza (240ml)')}
      </div>
      <div>
        <label className="text-[10px] text-gray-500 uppercase tracking-wide block mb-0.5">Porciones a registrar</label>
        <input
          type="number"
          min="0.1"
          step="0.1"
          value={quantity}
          onChange={(e) => setQuantity(parseFloat(e.target.value) || 1)}
          className="w-24 bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
        />
      </div>
      <button
        onClick={save}
        disabled={saving || !form.name || !form.calories}
        className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg py-2 text-sm font-medium transition-colors cursor-pointer"
      >
        {saving ? <Loader2 className="animate-spin mx-auto w-4 h-4" /> : 'Guardar y registrar'}
      </button>
    </div>
  );
}

// ---- Scan Tab ----
interface SuggestionItem {
  name: string;
  brand?: string | null;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  sodium_mg: number;
  sugar_g: number;
  serving_size_g?: number | null;
  serving_label?: string | null;
}

function ScanTab({ meal, date, onAdded }: { meal: string; date: string; onAdded: () => void }) {
  const [text, setText] = useState('');
  const [imageB64, setImageB64] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [suggestions, setSuggestions] = useState<SuggestionItem[] | null>(null);
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
      if (!res.ok || data.error) {
        setError(data.error ?? `Error ${res.status}`);
        return;
      }
      if (data.suggestions?.length > 0) {
        setSuggestions(data.suggestions);
      } else {
        setError('No se encontraron alimentos en la descripción.');
      }
    } catch (e: any) {
      setError(e.message ?? 'Error de red');
    } finally {
      setScanning(false);
    }
  };

  const updateSuggestion = (idx: number, key: string, val: string) => {
    setSuggestions((prev) => prev
      ? prev.map((s, i) => i === idx ? { ...s, [key]: key === 'name' || key === 'brand' || key === 'serving_label' ? val : parseFloat(val) || 0 } : s)
      : prev
    );
  };

  const saveAll = async () => {
    if (!suggestions) return;
    setSaving(true);
    try {
      for (const s of suggestions) {
        const res = await fetch('/api/diet/food-items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...s, serving_size_g: s.serving_size_g ?? null, serving_label: s.serving_label ?? null, brand: s.brand ?? null }),
        });
        const { item } = await res.json();
        await fetch('/api/diet/log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date, meal, food_item_id: item.id, quantity: 1 }),
        });
      }
      onAdded();
    } finally {
      setSaving(false);
    }
  };

  if (suggestions) {
    return (
      <div className="space-y-4">
        <p className="text-xs text-green-400">
          {suggestions.length === 1 ? '1 alimento detectado' : `${suggestions.length} alimentos detectados`} — revisa y ajusta si es necesario:
        </p>
        <div className="space-y-4 max-h-[45vh] overflow-y-auto pr-1">
          {suggestions.map((s, idx) => (
            <div key={idx} className="bg-gray-900 border border-gray-700 rounded-lg p-3 space-y-2">
              <input
                type="text"
                value={s.name}
                onChange={(e) => updateSuggestion(idx, 'name', e.target.value)}
                className="w-full bg-transparent border-b border-gray-700 pb-1 text-sm font-medium text-white focus:outline-none focus:border-blue-500"
              />
              <div className="grid grid-cols-2 gap-2">
                {(['calories', 'protein_g', 'carbs_g', 'fat_g'] as const).map((k) => (
                  <div key={k}>
                    <label className="text-[10px] text-gray-600 block">{k === 'calories' ? 'Kcal' : k === 'protein_g' ? 'Proteína g' : k === 'carbs_g' ? 'Carbos g' : 'Grasa g'}</label>
                    <input
                      type="number"
                      value={s[k]}
                      onChange={(e) => updateSuggestion(idx, k, e.target.value)}
                      className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <button
          onClick={saveAll}
          disabled={saving}
          className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg py-2 text-sm font-medium transition-colors cursor-pointer"
        >
          {saving
            ? <Loader2 className="animate-spin mx-auto w-4 h-4" />
            : suggestions.length === 1 ? 'Guardar y registrar' : `Guardar y registrar ${suggestions.length} alimentos`}
        </button>
        <button onClick={() => { setSuggestions(null); setError(null); }} className="w-full text-xs text-gray-500 hover:text-gray-300 cursor-pointer">
          Volver a escanear
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs text-gray-400 block mb-1">
          Describe lo que comiste <span className="text-gray-600">(puedes incluir varios alimentos)</span>
        </label>
        <textarea
          placeholder="Ej: 92gr de hallulla, 64gr de huevo, 96gr de durazno"
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
        <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <button
        onClick={scan}
        disabled={scanning || (!text.trim() && !imageB64)}
        className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-lg py-2 text-sm font-medium transition-colors cursor-pointer"
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

// ---- Recipes Tab ----
function RecipesTab({ meal, date, onAdded }: { meal: string; date: string; onAdded: () => void }) {
  const [recipes] = useState<Recipe[]>([]);

  return (
    <div className="text-center py-8 text-gray-500 text-sm">
      {recipes.length === 0
        ? 'Aún no tienes recetas creadas.'
        : recipes.map((r) => <div key={r.id}>{r.name}</div>)}
    </div>
  );
}

// ---- Modal Shell ----
export default function AddFoodModal({ meal, date, onClose, onAdded }: AddFoodModalProps) {
  const [tab, setTab] = useState<Tab>('buscar');

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'buscar', label: 'Buscar', icon: <Search className="w-3.5 h-3.5" /> },
    { id: 'escanear', label: 'Escanear', icon: <Camera className="w-3.5 h-3.5" /> },
    { id: 'recetas', label: 'Recetas', icon: <ChefHat className="w-3.5 h-3.5" /> },
  ];

  const handleAdded = () => { onAdded(); onClose(); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-gray-950 border border-gray-800 rounded-2xl w-full max-w-md shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-800">
          <div>
            <h2 className="font-semibold text-white">Agregar alimento</h2>
            <p className="text-xs text-gray-500">{MEAL_LABELS[meal] ?? meal}</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-800 rounded-lg transition-colors cursor-pointer text-gray-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-800">
          {tabs.map(({ id, label, icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors cursor-pointer',
                tab === id
                  ? 'text-white border-b-2 border-blue-500'
                  : 'text-gray-500 hover:text-gray-300 border-b-2 border-transparent'
              )}
            >
              {icon} {label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="p-5 max-h-[65vh] overflow-y-auto">
          {tab === 'buscar' && <SearchTab meal={meal} date={date} onAdded={handleAdded} />}
          {tab === 'escanear' && <ScanTab meal={meal} date={date} onAdded={handleAdded} />}
          {tab === 'recetas' && <RecipesTab meal={meal} date={date} onAdded={handleAdded} />}
        </div>
      </div>
    </div>
  );
}
