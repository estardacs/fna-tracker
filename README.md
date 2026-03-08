# Fña Tracker

Dashboard personal de hábitos diarios. Agrega métricas de múltiples dispositivos y las muestra en una interfaz oscura y limpia, con datos en tiempo real y un historial semanal/mensual/anual.

---

## Qué registra

| Área | Qué mide |
|---|---|
| **Tiempo de pantalla** | PC + celular combinados, deduplicado (sin doble conteo de uso simultáneo) |
| **PC** | Apps activas por minuto en Lenovo Yoga 7 Slim y PC Escritorio |
| **Celular** | Apps y tiempo de pantalla del Oppo A5 Lite |
| **Lectura** | Libros leídos en Moon+ Reader con % de avance y tiempo por libro |
| **Juegos** | Tiempo en League of Legends, Arknights: Endfield y otros |
| **Ubicación** | Oficina / Casa / Fuera según red WiFi conectada |
| **Sueño** | Horas dormidas, fases (profundo/ligero/REM), siestas, score de eficiencia |
| **Salud** | Pasos, calorías quemadas, frecuencia cardíaca (promedio, reposo, timeline) |
| **Peso** | Registro manual desde el dashboard, con carry-forward si no se actualiza |
| **Dieta** | Calorías, proteína, carbohidratos, grasas, fibra y sodio por comida del día |

---

## Vistas

### Dashboard (`/`)
Vista principal del día. Muestra KPIs de tiempo de pantalla, sueño, lectura y juegos, gráfico de actividad por hora, historial de apps, ubicación, sección de salud y registro de dieta. Se actualiza automáticamente cada 30 segundos (polling del servidor).

### Dieta (`/diet`)
Registro nutricional del día dividido en 5 comidas (desayuno, almuerzo, once, cena, snack). Incluye anillo de calorías (meta editable), barras de macros (proteína, carbos, grasa) y fibra/sodio como stats secundarias. Secciones colapsables por comida. Para agregar alimentos:

- **Buscar** — librería personal con búsqueda fuzzy (pg_trgm), ordenada por frecuencia de uso
- **Escanear texto** — describe en lenguaje natural lo que comiste; IA con `claude-sonnet-4-6` en dos fases: (1) parsea nombres y gramos, busca coincidencias en la librería (evita duplicados), (2) estima macros por 100g solo para items sin match. Si el texto ya incluye datos de etiqueta, los usa directamente sin estimación
- **Escanear foto** — foto de etiqueta nutricional → IA extrae macros en una sola llamada
- **Combos** — grupos de alimentos predefinidos (tappers, desayunos habituales) que registran varios items de una vez, ordenados por frecuencia de uso

Al seleccionar un alimento, `claude-haiku-4-5` sugiere el peso típico de una unidad ("1 hallulla ≈ 90g", "1 huevo mediano ≈ 55g", etc.).

Los alimentos se almacenan normalizados por 100g; al registrar se especifican los gramos consumidos.

### Historial (`/history`)
Resumen semanal, mensual y anual usando la tabla `daily_summary`. Incluye totales de tiempo de pantalla, calorías consumidas, top apps y libros del período. La vista anual agrupa por semana en memoria (no usa `weekly_summary`).

---

## Stack

- **Frontend** — Next.js 15 App Router, React Server Components + Client Islands, Tailwind CSS v4
- **Backend** — Supabase (PostgreSQL + Realtime + Edge Functions)
- **IA** — `claude-sonnet-4-6` para escaneo de alimentos (texto e imagen); `claude-haiku-4-5` para sugerencias de porciones
- **Timezone** — America/Santiago (CLST) en toda la lógica de fechas
- **Deploy** — Vercel + Supabase Edge Functions (la resumificación se dispara al cargar `/history`; cron nocturno opcional vía Supabase Cron)

---

## Fuentes de datos

Los datos llegan desde distintos dispositivos automáticamente:

- **PC** — script de Windows que envía `usage_summary_1min` por minuto a Supabase
- **Celular** — MacroDroid/Tasker reporta cambios de app y tiempo de pantalla acumulado
- **Moon+ Reader** — sync de metadatos de libro (título, % leído) vía nube
- **Smartband Xiaomi** — datos de salud vía endpoint `POST /api/track/wearable`
- **Peso / Dieta** — registro manual desde la UI

---

## Arquitectura de datos

```
Dispositivos → metrics (raw) → [dashboard en vivo]
                     ↓
              summarize-daily (Edge Function, on /history load + cron opcional)
                     ↓
              daily_summary → [historial semanal/mensual/anual]
              (métricas raw se eliminan tras resumir)
```

---

## Variables de entorno

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUMMARIZER_SECRET
ANTHROPIC_API_KEY
```
