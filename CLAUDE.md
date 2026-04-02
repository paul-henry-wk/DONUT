# DONUT — DevOps Nabsic Unified Tool

## Tech Stack
- **Desktop**: Tauri 2 (Rust backend + TypeScript/Vite frontend)
- **CLI**: PowerShell 7 modules & scripts
- **Target**: Windows only (IIS, SQL Server, Azure DevOps)

## Build Commands

```bash
# Frontend
cd app && npm install && npm run build

# Rust / Tauri (release, optimized ~5.5 MB)
cd src-tauri && cargo build --release

# Copy exe to project root (required for testing — the exe needs cli/, templates/, etc. next to it)
cp src-tauri/target/release/donut.exe ./DONUT.exe

# Full app
node app/node_modules/@tauri-apps/cli/tauri.js build

# Dev mode (hot-reload, debug build)
node app/node_modules/@tauri-apps/cli/tauri.js dev
```

**After any code change, always rebuild and copy the exe to root before asking the user to test:**
```bash
cd app && npm run build && cd ../src-tauri && cargo build --release && cp target/release/donut.exe ../DONUT.exe
```

## Test Commands

```bash
# Frontend (Vitest — 34 tests)
cd app && npm test

# TypeScript type check
cd app && npx tsc --noEmit

# Rust tests (65 tests)
cd src-tauri && cargo test

# Rust lint
cd src-tauri && cargo clippy -- -D warnings

# PowerShell Pester tests (46 tests)
pwsh -Command "Invoke-Pester -Path ./tests -Output Detailed"
```

## Project Structure

```
app/src/                   Frontend TypeScript
  ├── main.ts              Entry point, window.* aliases
  ├── state.ts             Global state, constants, utilities
  ├── types.ts             TypeScript interfaces
  ├── scripts.ts           Script grid, run bar, install wizard
  ├── terminal.ts          Terminal output, logging, search
  │   └── terminal/        Sub-modules: syntax.ts, diff-nav.ts, controls.ts
  ├── config.ts            Config tab, wizard, cascade
  │   └── config/          Sub-modules: form-fields.ts
  ├── devops.ts            DevOps tab, dashboard, panels
  │   └── devops/          Sub-modules: diff-viewer.ts
  ├── app.ts               Init, events, updates, prerequisites
  │   └── app/             Sub-modules: themes.ts, modals.ts
  ├── workflow.ts          Workflow state machine
  ├── health.ts            Health polling (adaptive intervals)
  └── __tests__/           Vitest test suite

app/public/css/            CSS (split by responsibility)
  ├── base.css             Fonts, reset, transitions
  ├── components.css       Topbar, terminal, toasts
  ├── scripts.css          Script grid, workflow bar, run bar
  ├── config.css           Wizard, forms, packages
  ├── devops.css           Dashboard, panels, timeline
  ├── extras.css           Diff viewer, loading, health, easter eggs
  └── themes/              Theme overrides
      ├── variables.css    CSS variables for all 9 themes
      ├── win95.css        Windows 95 retro theme
      ├── winxp.css        Windows XP Luna theme
      └── aqua.css         Mac OS X Aqua theme

src-tauri/src/             Rust backend
  ├── main.rs              Entry point, AppState, cleanup
  ├── error.rs             AppError enum, HTTP status mapping
  ├── helpers.rs           Utilities, azdo_get_json (retry with backoff)
  └── commands/
      ├── azdo.rs          Azure DevOps API (PRs, builds, branches, work items)
      ├── config.rs        Environment file I/O, version
      ├── scripts.rs       PowerShell script execution with streaming
      ├── system.rs        Browse, scan, self-update, open URL/file
      ├── health.rs        Quick health check (IIS, SQL, site, VPN)
      └── watch.rs         File system watcher

cli/modules/               PowerShell reusable modules
cli/scripts/                Workflow scripts (1 per UI command)
tests/                      Pester test suite
```

## Key Conventions

- Frontend uses `window.*` globals for onclick handlers (Tauri IIFE constraint)
- Sub-modules export functions, main module re-exports — `main.ts` only imports from top-level modules
- State managed via global `S` object in `state.ts`
- CSS split into files under `public/css/`, loaded via `@import` in `style.css`
- Themes defined as CSS variable overrides in `themes/variables.css`, component overrides in individual theme files
- PowerShell modules use `-ModuleName` scoping in Pester mocks
- Tauri commands defined in `src-tauri/src/commands/` with `#[tauri::command]`
- Config files are `.env.json` format in `working-environments/`
- Vite builds to IIFE format (no ES modules) for Tauri compatibility
- Release builds use `lto = "thin"`, `strip = true`, `opt-level = "s"` for small binary (~5.5 MB)

## Architecture Decisions

- **No frontend framework**: Vanilla TS + DOM manipulation. Keeps bundle tiny (~149 KB) and avoids framework churn.
- **CSS @import (not bundled)**: CSS source lives split in `public/css/` for maintainability. The Vite plugin `concatCss()` merges them into a single `dist/style.css` at build time (Tauri cannot resolve CSS @import chains at runtime).
- **Azure DevOps retry**: `azdo_get_json()` in helpers.rs retries on 429/5xx with exponential backoff (0ms, 500ms, 1.5s). No retry on 401/403/404.
- **Adaptive health polling**: 6s when failing, 30s when stable.
- **PowerShell -File mode**: Scripts run via `pwsh -File` (not `-Command`), so `$`, `()`, `{}` are safe in arguments.

## Known Pitfalls — DO NOT break these

These are lessons learned from past regressions. Read before making changes:

1. **DO NOT enable CSP** (`tauri.conf.json` → `security.csp`). The app uses `onclick="..."` inline handlers everywhere (70+ in HTML, hundreds generated in JS). Any CSP that restricts `script-src` will silently break ALL buttons. Fixing this requires migrating every handler to `addEventListener`, which is a major refactoring.

2. **DO NOT use CSS `@import` in the final `dist/style.css`**. Tauri's custom protocol (`tauri://`) does not resolve `@import url(...)` chains. The source CSS is split into files in `public/css/` but the Vite `concatCss()` plugin merges them into one file for dist. If you modify the CSS build pipeline, verify the output is a single concatenated file.

3. **DO NOT edit `dist/style.css` directly** — it is overwritten by `npm run build`. Always edit the source files in `app/public/css/`.

4. **DO NOT import CSS from TypeScript** (`import './style.css'`). This causes Vite to process the CSS and duplicate font files into `dist/assets/`. CSS is loaded via `<link>` in `index.html` instead.

5. **The exe MUST be launched from the project root**, not from `src-tauri/target/release/`. It looks for `cli/`, `templates/`, `working-environments/` relative to its location. Always copy to root after building.

6. **Every `window.functionName` in `main.ts` must match an exported function**. If you add a new onclick handler in generated HTML, you must also add the window alias in `main.ts`. The Vitest `globals.test.ts` checks critical ones.

7. **Pester mocks with `-ModuleName`**: When mocking cmdlets that may or may not exist on the runner (like `Invoke-Sqlcmd`), use `-RemoveParameterValidation` to bypass parameter validation that runs before the mock intercepts.
