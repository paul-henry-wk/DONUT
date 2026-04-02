# DONUT — DevOps Nabsic Unified Tool

## Tech Stack
- **Desktop**: Tauri 2 (Rust backend + TypeScript/Vite frontend)
- **CLI**: PowerShell 7 modules & scripts
- **Target**: Windows only (IIS, SQL Server, Azure DevOps)

## Build Commands

```bash
# Frontend
cd app && npm install && npm run build

# Rust / Tauri
cd src-tauri && cargo build

# Full app (from root)
node app/node_modules/@tauri-apps/cli/tauri.js build

# Dev mode
node app/node_modules/@tauri-apps/cli/tauri.js dev
```

## Test Commands

```bash
# Rust tests
cd src-tauri && cargo test

# TypeScript type check
cd app && npx tsc --noEmit

# Rust lint
cd src-tauri && cargo clippy -- -D warnings

# PowerShell Pester tests
pwsh -Command "Invoke-Pester -Path ./tests -Output Detailed"
```

## Project Structure

- `app/` — Frontend (TypeScript/Vite, vanilla DOM, no framework)
- `src-tauri/` — Rust backend (Tauri commands, Azure DevOps API, process management)
- `cli/modules/` — Reusable PowerShell modules (.psm1)
- `cli/scripts/` — Workflow scripts invoked from the UI
- `tests/` — Pester test suite
- `dev/` — Developer tools & packaging scripts
- `templates/` — Environment config templates
- `working-environments/` — Runtime user configs (.env.json)

## Key Conventions

- Frontend uses global `window` bindings for onclick handlers (Tauri webview IIFE constraint)
- State managed via global `S` object in `state.ts`
- PowerShell modules use `-ModuleName` scoping in Pester mocks
- Tauri commands defined in `src-tauri/src/commands/` with `#[tauri::command]`
- Config files are `.env.json` format in `working-environments/`
- Vite builds to IIFE format (no ES modules in output) for Tauri compatibility
