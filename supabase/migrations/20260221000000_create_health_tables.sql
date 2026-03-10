-- Migration: Create robust health tracking schema for Health Connect / MacroDroid
-- Date: 2026-02-21

-- 1. TABLA: Métricas Diarias (Resúmenes)
-- Almacena los totales del día y series temporales de baja frecuencia (ej. peso, estrés promedio)
CREATE TABLE health_daily_metrics (
    id BIGSERIAL PRIMARY KEY,
    date DATE NOT NULL UNIQUE, -- Un registro por día
    
    -- Métricas Base
    step_count INT DEFAULT 0,
    calories_burned INT DEFAULT 0,
    distance_meters NUMERIC(10, 2),
    floors_climbed INT DEFAULT 0,
    active_minutes INT DEFAULT 0,
    
    -- Datos Fisiológicos (Resúmenes)
    resting_heart_rate INT,
    avg_stress_level INT,
    min_spo2 NUMERIC(5, 2),
    
    -- Arrays de Datos (JSONB)
    -- Estructura esperada: [{"time": "10:00", "bpm": 72}, ...]
    heart_rate_timeline JSONB, 
    -- Estructura esperada: [{"time": "10:00", "level": 45}, ...]
    stress_timeline JSONB,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE health_daily_metrics IS 'Resúmenes diarios de actividad y biometría desde Health Connect';

-- 2. TABLA: Sesiones de Entrenamiento
-- Almacena actividades deportivas específicas con alta resolución de datos
CREATE TABLE health_workouts (
    id BIGSERIAL PRIMARY KEY,
    activity_type TEXT NOT NULL, -- ej: 'Running', 'Cycling', 'Yoga'
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ,
    
    -- Métricas de la sesión
    duration_seconds INT,
    calories_burned INT,
    distance_meters NUMERIC(10, 2),
    avg_heart_rate INT,
    max_heart_rate INT,
    
    -- Telemetría Compleja (JSONB)
    -- Estructura: [{"time": "T+00:05", "bpm": 140}, ...]
    heart_rate_series JSONB,
    -- Estructura: [{"lat": -33.123, "lng": -70.123, "time": "..."}]
    route_path JSONB,
    -- Metadatos extra (fuente, dispositivo)
    metadata JSONB DEFAULT '{}',
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. TABLA: Sesiones de Sueño
-- Almacena detalles profundos del sueño (fases, interrupciones)
CREATE TABLE health_sleep_sessions (
    id BIGSERIAL PRIMARY KEY,
    date DATE NOT NULL, -- Fecha "lógica" del sueño (la mañana en que despiertas)
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    duration_minutes INT,
    
    -- Calidad
    efficiency_score INT, -- 0-100
    waso_minutes INT,     -- Wake After Sleep Onset
    
    -- Fases (Resumen en minutos)
    minutes_deep INT DEFAULT 0,
    minutes_light INT DEFAULT 0,
    minutes_rem INT DEFAULT 0,
    minutes_awake INT DEFAULT 0,
    
    -- Hipnograma (Gráfico de fases)
    -- Estructura: [{"stage": "deep", "start": "...", "end": "..."}]
    sleep_stages_timeline JSONB,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. SEGURIDAD: Row Level Security (RLS)
ALTER TABLE health_daily_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE health_workouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE health_sleep_sessions ENABLE ROW LEVEL SECURITY;

-- Política para permitir INSERTS públicos (usando anon_key desde MacroDroid)
-- NOTA: Si usas 'service_role' en MacroDroid, esto se salta automáticamente, 
-- pero esta política permite usar la 'anon_key' que es más segura de guardar en un móvil.
CREATE POLICY "Permitir Insert Anonimo" ON health_daily_metrics FOR INSERT WITH CHECK (true);
CREATE POLICY "Permitir Insert Anonimo" ON health_workouts FOR INSERT WITH CHECK (true);
CREATE POLICY "Permitir Insert Anonimo" ON health_sleep_sessions FOR INSERT WITH CHECK (true);

-- Política para permitir SELECT solo a usuarios autenticados (tu Dashboard)
CREATE POLICY "Permitir Select Autenticado" ON health_daily_metrics FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Permitir Select Autenticado" ON health_workouts FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Permitir Select Autenticado" ON health_sleep_sessions FOR SELECT USING (auth.role() = 'authenticated');
