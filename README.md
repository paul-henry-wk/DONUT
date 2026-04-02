# DONUT — DevOps Nabsic Unified Tool

Standalone desktop application for managing delivery workflows: versioning, metadata, Azure DevOps integration — in a single ~5.5 MB executable.

## Tech Stack

| Layer | Technology | Details |
|-------|-----------|---------|
| Desktop shell | [Tauri 2](https://tauri.app/) | Lightweight native window, ~5.5 MB |
| Backend | Rust | Async process streaming, Azure DevOps API with retry, error handling |
| Frontend | TypeScript / Vite | Vanilla HTML/CSS, JetBrains Mono, 9 themes |
| Scripts | PowerShell 7 | Git, .NET tools, Azure DevOps REST API |
| Database | SQL Server (local) | Package discovery via `sqlcmd` |
| API | Azure DevOps REST | Repos, branches, PRs, builds, work items |
| Tests | Vitest + Cargo test + Pester | Frontend, backend, and CLI test suites |

## Quick Start

1. Double-click `DONUT.exe`
2. **Config** tab: set site path, Azure DevOps PAT, select repo
3. **Scripts** tab: select a script, click **RUN**

### Prerequisites

- **PowerShell 7+** — `winget install Microsoft.Powershell`
- **.NET SDK 8+** — `winget install Microsoft.DotNet.SDK.8`
- **Git** — `winget install Git.Git`
- **SQL Server** (local) — for package discovery

Missing prerequisites show as red dots in the header — click for install command.

### Azure DevOps PAT

Create a PAT on your Azure DevOps organization (`https://dev.azure.com/<your-org>/_usersSettings/tokens`) with: **Code** (Read & Write) + **Work Items** (Read & Write).

## Commands

### Setup
| # | Command | Description |
|---|---------|-------------|
| 1 | **Install Site** | Deploy .ENA archive to local IIS |
| 2 | **Setup Auth** | Configure admin credentials & restart IIS |
| 3 | **Set Packages** | Select which packages are open for dev |

### Synchronize
| # | Command | Description |
|---|---------|-------------|
| 4 | **Pull Force** | Full download: reset site & apply all commits |
| 5 | **Full Reset** | Wipe & rebuild site from scratch (no history) |
| 6 | **Pull** | Apply new commits without resetting site |
| 7 | **Commit** | Push local changes & create pull request |

### Diagnostic
| Key | Command | Description |
|-----|---------|-------------|
| s | **Status** | Show site, branch & PR status |
| d | **Diff** | Preview local changes before commit |
| h | **Health Check** | Deep diagnostic of site, DB, git, APIs |

### Git
| Key | Command | Description |
|-----|---------|-------------|
| m | **Merge** | Merge feature branch into target |
| r | **Rollback** | Undo commits (safe revert) |

## Features

- **9 themes**: Dark, Light, Dark Choco, Chocolate, Strawberry, Rainbow, Windows 95, Windows XP, Mac OS X
- **DevOps dashboard**: Build status, PRs, branch diff, merge conflicts, quick links, activity timeline
- **Workflow state machine**: Tracks your progress through setup → synchronize → commit → merge
- **Adaptive health check**: Polls fast when issues detected, slow when stable
- **Azure DevOps API retry**: Automatic retry with backoff on network errors and rate limits
- **PR diff viewer**: Side-by-side and unified diff with Enablon metadata support

## Project Structure

```
DONUT.exe                  <- user entry point (~5.5 MB)
app/                       <- frontend (TypeScript / Vite)
  ├── src/                 <- TypeScript modules
  │   ├── app/             <- themes, modals
  │   ├── config/          <- form field helpers
  │   ├── devops/          <- PR diff viewer
  │   ├── terminal/        <- syntax HL, diff nav, controls
  │   └── __tests__/       <- Vitest test suite
  └── public/
      ├── css/             <- split CSS (base, components, themes)
      └── fonts/           <- JetBrains Mono
cli/                       <- PowerShell scripts & modules
  ├── config/              <- version.json, packages.json
  ├── modules/             <- reusable PowerShell modules
  └── scripts/             <- workflow scripts (1 per command)
src-tauri/                 <- Rust backend (Tauri 2)
tests/                     <- Pester test suite
templates/                 <- environment config templates
working-environments/      <- user environment configs (.env.json)
dev/                       <- developer tools
```

## Building

```bash
# Frontend
cd app && npm install && npm run build

# Full app (release, optimized ~5.5 MB)
cd src-tauri && cargo build --release

# Dev mode (hot-reload)
node app/node_modules/@tauri-apps/cli/tauri.js dev
```

Requires: Rust toolchain + Visual Studio Build Tools (C++).

## Testing

```bash
# Frontend (Vitest)
cd app && npm test

# TypeScript type check
cd app && npx tsc --noEmit

# Rust tests
cd src-tauri && cargo test

# Rust lint
cd src-tauri && cargo clippy -- -D warnings

# PowerShell Pester tests
pwsh -Command "Invoke-Pester -Path ./tests -Output Detailed"
```

## CLI Mode (dev)

```
dev\donut.bat
dev\donut.bat -Script commit -Message "Fix field naming"
dev\donut.bat -Script status
```

## Configuration

Environment files in `working-environments/` as `.env.json` or `.env-{name}.json`. Manage from the GUI Config tab.

## Sharing

Download the latest release from [GitHub Releases](../../releases). Or zip the project folder (excluding `src-tauri/target/`, `.bin/`, `.env*.json`). Recipients unzip and double-click `DONUT.exe`.

## Contribute

Fork the repo and open a Pull Request on GitHub.
