
-- Schema for storing aggregated daily tracking data.
CREATE TABLE daily_summary (
    id BIGSERIAL PRIMARY KEY,
    date DATE NOT NULL UNIQUE,
    pc_total_minutes INT,
    mobile_total_minutes INT,
    reading_minutes INT,
    gaming_minutes INT,
    screentime_minutes INT, -- Deduplicated total screen time
    simultaneous_minutes INT, -- Time spent using multiple devices at once
    office_minutes INT,
    home_minutes INT,
    outside_minutes INT,
    pc_app_summary JSONB,
    mobile_app_summary JSONB,
    games_summary JSONB,
    books_summary JSONB,
    location_breakdown JSONB, -- Breakdown of location by device type
    created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE daily_summary IS 'Stores a daily summary of user activity, aggregated from the raw metrics table.';
COMMENT ON COLUMN daily_summary.screentime_minutes IS 'Total deduplicated screen time for the day in minutes.';
COMMENT ON COLUMN daily_summary.pc_app_summary IS 'JSON object containing PC application usage time.';


-- Schema for storing aggregated weekly summary data.
CREATE TABLE weekly_summary (
    id BIGSERIAL PRIMARY KEY,
    week_start_date DATE NOT NULL UNIQUE,
    total_screentime_minutes INT,
    avg_daily_screentime_minutes INT,
    total_pc_minutes INT,
    total_mobile_minutes INT,
    total_reading_minutes INT,
    total_gaming_minutes INT,
    pc_app_summary JSONB,
    mobile_app_summary JSONB,
    games_summary JSONB,
    books_summary JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE weekly_summary IS 'Stores a weekly summary of user activity, aggregated from daily_summary.';
COMMENT ON COLUMN weekly_summary.week_start_date IS 'The Monday of the summarized week.';


-- Schema for storing aggregated monthly summary data.
CREATE TABLE monthly_summary (
    id BIGSERIAL PRIMARY KEY,
    month_start_date DATE NOT NULL UNIQUE,
    total_screentime_minutes INT,
    avg_daily_screentime_minutes INT,
    total_pc_minutes INT,
    total_mobile_minutes INT,
    total_reading_minutes INT,
    total_gaming_minutes INT,
    pc_app_summary JSONB,
    mobile_app_summary JSONB,
    games_summary JSONB,
    books_summary JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE monthly_summary IS 'Stores a monthly summary of user activity, aggregated from daily_summary.';
COMMENT ON COLUMN monthly_summary.month_start_date IS 'The first day of the summarized month.';


-- Schema for storing aggregated yearly summary data.
CREATE TABLE yearly_summary (
    id BIGSERIAL PRIMARY KEY,
    year INT NOT NULL UNIQUE,
    total_screentime_minutes INT,
    avg_daily_screentime_minutes INT,
    total_pc_minutes INT,
    total_mobile_minutes INT,
    total_reading_minutes INT,
    total_gaming_minutes INT,
    pc_app_summary JSONB,
    mobile_app_summary JSONB,
    games_summary JSONB,
    books_summary JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE yearly_summary IS 'Stores a yearly summary of user activity, aggregated from daily_summary.';
