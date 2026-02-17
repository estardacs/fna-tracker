# Gemini Context

This file is used to provide context for Gemini CLI.

## Project Overview
This is a personal activity tracker application (FNA Tracker) built with Next.js and Supabase.
It tracks activity from PC (Windows) and Mobile (Android via Tasker/Supabase).

## Key Features
- **Dashboard:** Visualizes daily activity, reading time, and location context.
- **Tracking:** 
    - PC: PowerShell script (`track-activity.mjs`) logs active window/idle time.
    - Mobile: Logs app usage and screen time.
    - Reading: Detects Moon+ Reader usage.

## Recent Changes
- Removed the 30-minute cap on mobile activity duration to support long reading sessions.
- Improved book detection logic to correctly attribute long reading sessions to the active book, even if the "book opened" event is delayed or happens mid-session (using a time window relative to session duration).
