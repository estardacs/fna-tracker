/**
 * MCP server for diet and workout logging.
 *
 * Exposed over Streamable HTTP so it works from Claude Desktop, Claude Code and — if
 * static_headers is available on the account — the mobile app. A local stdio server
 * would only ever reach the desktop.
 *
 * Authentication is a fixed bearer token (MCP_TOKEN). It is checked here rather than in
 * middleware.ts, which gates the rest of /api/* on an admin cookie that no MCP client
 * can present; /api/mcp is listed as an exception there.
 *
 * All nutrition maths lives in src/lib/diet-service.ts. Tools never accept macro values
 * for an existing food — they take an id and the server derives the numbers — so the
 * model cannot invent nutrition data, which is the whole point of having a food table.
 * Workouts follow the same rule: the caller gives activity, duration and intensity, and the
 * calories come from src/lib/workout-service.ts.
 */
import { createMcpHandler } from 'mcp-handler';
import { z } from 'zod';
import {
  MEALS,
  todayInSantiago,
  searchFoods,
  createFood,
  logFood,
  logCombo,
  listCombos,
  deleteLogEntry,
  confirmDay,
  getDaySummary,
  getProgress,
  logWeight,
  recalculateTdee,
} from '@/lib/diet-service';
import { ACTIVITY_KEYS, INTENSITIES, logWorkout, listWorkouts, deleteWorkout } from '@/lib/workout-service';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const mealSchema = z.enum(MEALS).describe('Comida del día');
const statusSchema = z
  .enum(['planned', 'confirmed'])
  .default('confirmed')
  .describe("'planned' es lo proyectado, 'confirmed' es lo que realmente comiste");
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .describe('Fecha yyyy-MM-dd. Por defecto hoy en Santiago');

function text(value: unknown) {
  return { content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] };
}

function fail(e: unknown) {
  return {
    content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
    isError: true,
  };
}

const handler = createMcpHandler(
  server => {
    server.registerTool(
      'search_foods',
      {
        description:
          'Busca alimentos en la tabla personal por nombre o marca. Úsalo SIEMPRE antes de registrar: devuelve el id que necesita log_food y los valores nutricionales oficiales. Nunca inventes macros.',
        inputSchema: z.object({
          query: z.string().min(1).describe('Texto a buscar, por ejemplo "huevo" o "yogurt"'),
          limit: z.number().int().min(1).max(25).default(10),
        }),
      },
      async ({ query, limit }) => {
        try {
          const foods = await searchFoods(query, limit);
          if (foods.length === 0) {
            return text(`Sin resultados para "${query}". Si el alimento no existe, créalo con create_food a partir de la etiqueta.`);
          }
          return text(foods);
        } catch (e) {
          return fail(e);
        }
      },
    );

    server.registerTool(
      'log_food',
      {
        description:
          'Registra un alimento ya existente. Los macros los calcula el servidor desde la tabla; no se aceptan valores del cliente. Requiere el id devuelto por search_foods.',
        inputSchema: z.object({
          food_id: z.string().uuid().describe('id devuelto por search_foods'),
          grams: z.number().positive().describe('Gramos consumidos. Pesa carne y pollo en CRUDO'),
          meal: mealSchema,
          date: dateSchema,
          status: statusSchema,
        }),
      },
      async ({ food_id, grams, meal, date, status }) => {
        try {
          return text(await logFood({ date: date ?? todayInSantiago(), meal, foodId: food_id, grams, status }));
        } catch (e) {
          return fail(e);
        }
      },
    );

    server.registerTool(
      'list_combos',
      {
        description:
          'Lista los combos y recetas guardados con sus ingredientes y en cuántas porciones se divide cada uno.',
        inputSchema: z.object({}),
      },
      async () => {
        try {
          return text(await listCombos());
        } catch (e) {
          return fail(e);
        }
      },
    );

    server.registerTool(
      'log_combo',
      {
        description:
          'Registra porciones de un combo o receta. Si la receta rinde varias porciones, el servidor divide los ingredientes automáticamente. Crea una entrada por ingrediente.',
        inputSchema: z.object({
          combo_id: z.string().uuid().describe('id devuelto por list_combos'),
          portions: z.number().positive().default(1).describe('Porciones consumidas'),
          meal: mealSchema,
          date: dateSchema,
          status: statusSchema,
        }),
      },
      async ({ combo_id, portions, meal, date, status }) => {
        try {
          return text(await logCombo({ date: date ?? todayInSantiago(), meal, comboId: combo_id, portions, status }));
        } catch (e) {
          return fail(e);
        }
      },
    );

    server.registerTool(
      'create_food',
      {
        description:
          'Crea un alimento nuevo. Usa SIEMPRE valores por 100 g leídos de la etiqueta cuando exista. Marca source="label" solo si viste la tabla nutricional; "web" si viene de la ficha del fabricante; "estimated" si es un valor típico por confirmar.',
        inputSchema: z.object({
          name: z.string().min(1),
          brand: z.string().optional(),
          calories_per_100g: z.number().nonnegative(),
          protein_per_100g: z.number().nonnegative(),
          carbs_per_100g: z.number().nonnegative(),
          fat_per_100g: z.number().nonnegative(),
          fiber_per_100g: z.number().nonnegative().optional(),
          sodium_per_100g: z.number().nonnegative().optional(),
          sugar_per_100g: z.number().nonnegative().optional(),
          serving_size_g: z.number().positive().optional().describe('Peso de una unidad o porción de referencia'),
          serving_label: z.string().optional().describe('Etiqueta de la porción, por ejemplo "1 unidad (57 g)"'),
          source: z.enum(['label', 'web', 'estimated']),
        }),
      },
      async input => {
        try {
          return text(await createFood(input));
        } catch (e) {
          return fail(e);
        }
      },
    );

    server.registerTool(
      'day_summary',
      {
        description:
          'Resumen de un día: lo confirmado, lo solo planificado, cuánto falta para la meta, los entrenamientos y el déficit (TDEE sedentario + calorías netas de ejercicio − lo comido). Úsalo para responder "cómo voy hoy".',
        inputSchema: z.object({ date: dateSchema }),
      },
      async ({ date }) => {
        try {
          return text(await getDaySummary(date ?? todayInSantiago()));
        } catch (e) {
          return fail(e);
        }
      },
    );

    server.registerTool(
      'confirm_day',
      {
        description:
          'Marca como confirmadas todas las entradas planificadas de un día. Úsalo cuando el usuario diga que comió lo que tenía planeado.',
        inputSchema: z.object({ date: dateSchema }),
      },
      async ({ date }) => {
        try {
          return text(await confirmDay(date ?? todayInSantiago()));
        } catch (e) {
          return fail(e);
        }
      },
    );

    server.registerTool(
      'delete_entry',
      {
        description: 'Borra una entrada del registro por su id. Úsalo para corregir errores.',
        inputSchema: z.object({ entry_id: z.string().uuid().describe('id devuelto por day_summary') }),
      },
      async ({ entry_id }) => {
        try {
          return text(await deleteLogEntry(entry_id));
        } catch (e) {
          return fail(e);
        }
      },
    );

    server.registerTool(
      'progress',
      {
        description:
          'Promedio de calorías y proteína de los últimos N días, ejercicio neto, déficit acumulado y pérdida de peso proyectada. Los días sin comida registrada se excluyen, no se cuentan como cero.',
        inputSchema: z.object({ days: z.number().int().min(2).max(90).default(7) }),
      },
      async ({ days }) => {
        try {
          return text(await getProgress(days));
        } catch (e) {
          return fail(e);
        }
      },
    );

    server.registerTool(
      'log_weight',
      {
        description:
          'Registra un peso corporal en kg. Si es el pesaje más reciente, recalcula el TDEE en el acto y devuelve IMC, BMR y TDEE nuevo; las calorías de los entrenamientos siguientes usan este peso.',
        inputSchema: z.object({
          weight_kg: z.number().positive().max(300),
          date: dateSchema,
        }),
      },
      async ({ weight_kg, date }) => {
        try {
          return text(await logWeight(weight_kg, date));
        } catch (e) {
          return fail(e);
        }
      },
    );

    server.registerTool(
      'recalculate_tdee',
      {
        description:
          'Recalcula el TDEE con Mifflin-St Jeor usando el último peso registrado y lo guarda. Conviene hacerlo tras cada pesaje: el gasto baja con el peso y un TDEE viejo infla el déficit.',
        inputSchema: z.object({}),
      },
      async () => {
        try {
          return text(await recalculateTdee());
        } catch (e) {
          return fail(e);
        }
      },
    );

    server.registerTool(
      'log_workout',
      {
        description:
          'Registra UN entrenamiento (una llamada por actividad). Las calorías las calcula el servidor con MET corregido por el BMR del usuario; no se aceptan calorías del cliente. Si se da distancia en caminata, running, ciclismo o natación, el ritmo decide el MET por sobre la intensidad declarada. Antes, revisa list_workouts del día para no duplicar lo que ya registró el reloj.',
        inputSchema: z.object({
          activity: z.enum(ACTIVITY_KEYS).describe('Tipo de actividad. Usa "other" solo si ninguna calza'),
          duration_minutes: z.number().positive().describe('Duración total en minutos'),
          intensity: z.enum(INTENSITIES).describe('Intensidad percibida: low (baja), medium (media), high (alta)'),
          distance_m: z.number().positive().optional().describe('Distancia en metros, si se conoce'),
          start_time: z
            .string()
            .regex(/^\d{2}:\d{2}$/)
            .optional()
            .describe('Hora de inicio HH:mm en Santiago. Si se omite, se asume mediodía'),
          met: z.number().positive().max(25).optional().describe('Solo con activity="other": MET de la actividad'),
          notes: z.string().optional(),
          date: dateSchema,
        }),
      },
      async ({ activity, duration_minutes, intensity, distance_m, start_time, met, notes, date }) => {
        try {
          return text(
            await logWorkout({
              date,
              activity,
              durationMin: duration_minutes,
              intensity,
              distanceM: distance_m,
              startTime: start_time,
              met,
              notes,
            }),
          );
        } catch (e) {
          return fail(e);
        }
      },
    );

    server.registerTool(
      'list_workouts',
      {
        description:
          'Lista los entrenamientos de un día (manuales y de Health Connect) con su id, MET, calorías brutas y netas. Las netas son las que cuentan para el déficit.',
        inputSchema: z.object({ date: dateSchema }),
      },
      async ({ date }) => {
        try {
          return text(await listWorkouts(date ?? todayInSantiago()));
        } catch (e) {
          return fail(e);
        }
      },
    );

    server.registerTool(
      'delete_workout',
      {
        description: 'Borra un entrenamiento registrado a mano, por su id. Los de Health Connect no se pueden borrar.',
        inputSchema: z.object({ workout_id: z.number().int().positive().describe('id devuelto por list_workouts') }),
      },
      async ({ workout_id }) => {
        try {
          return text(await deleteWorkout(workout_id));
        } catch (e) {
          return fail(e);
        }
      },
    );
  },
  {
    serverInfo: { name: 'fna-tracker', version: '1.1.0' },
  },
);

/**
 * Fixed-token gate. Kept separate from the handler so replacing it with OAuth later is a
 * change to this function alone.
 */
function authorize(req: Request): Response | null {
  const expected = process.env.MCP_TOKEN;
  if (!expected) {
    return Response.json({ error: 'MCP_TOKEN no está configurado en el servidor' }, { status: 503 });
  }

  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (token !== expected) {
    return Response.json(
      { error: 'unauthorized' },
      { status: 401, headers: { 'WWW-Authenticate': 'Bearer realm="fna-tracker"' } },
    );
  }
  return null;
}

async function guarded(req: Request) {
  return authorize(req) ?? handler(req);
}

export { guarded as GET, guarded as POST, guarded as DELETE };
