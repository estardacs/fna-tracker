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
Vista principal del día. Muestra KPIs de tiempo de pantalla, sueño, lectura y juegos, gráfico de actividad por hora, historial de apps, ubicación, sección de salud y registro de dieta. Se actualiza automáticamente vía Supabase Realtime (fallback: polling cada 5 min).

### Dieta (`/diet`)
Registro nutricional del día dividido en 5 comidas (desayuno, almuerzo, once, cena, snack). Incluye anillo de calorías, barras de macros y secciones colapsables por comida. Para agregar alimentos:
- **Buscar** — librería personal con búsqueda fuzzy (pg_trgm), muestra recientes
- **Escanear** — descripción en texto o foto de etiqueta → IA en dos fases (parsea cantidades, estima macros por 100g, busca coincidencias en la librería antes de crear duplicados)
- **Combos** — tappers o desayunos habituales que registran varios alimentos de una vez

Los alimentos se almacenan normalizados por 100g; al registrar se especifican los gramos consumidos.

### Historial (`/history`)
Resumen semanal, mensual y anual usando la tabla `daily_summary`. Incluye totales de tiempo de pantalla, calorías consumidas, top apps y libros del período. La vista anual agrupa por semana en memoria (no usa `weekly_summary`).

---

## Stack

- **Frontend** — Next.js 15 App Router, React Server Components + Client Islands, Tailwind CSS v4
- **Backend** — Supabase (PostgreSQL + Realtime + Edge Functions)
- **IA** — Anthropic claude-sonnet-4-6 para escaneo de alimentos en dos fases
- **Timezone** — America/Santiago (CLST) en toda la lógica de fechas
- **Deploy** — Vercel + GitHub Actions (cron diario 03:00 Chile para resumir métricas)

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
              summarize-daily (Edge Function, cron 03:00)
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
