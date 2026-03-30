# DONUT — DevOps Nabsic Unified Tool

Standalone desktop application for managing delivery workflows: versioning, metadata, Azure DevOps integration — in a single ~12 MB executable.

## Tech Stack

| Layer | Technology | Details |
|-------|-----------|---------|
| Desktop shell | [Tauri 2](https://tauri.app/) | Lightweight native window, ~12 MB |
| Backend | Rust | Async process streaming, Azure DevOps API, error handling |
| Frontend | TypeScript / Vite | Vanilla HTML/CSS, JetBrains Mono, 6 themes |
| Scripts | PowerShell 7 | Git, .NET tools, Azure DevOps REST API |
| Database | SQL Server (local) | Package discovery via `sqlcmd` |
| API | Azure DevOps REST | Repos, branches, PRs, work items |

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

Create a PAT on your Azure DevOps organization (`https://dev.azure.com/<your-org>/_usersSettings/tokens`) with: **Code** (Read & Write) + **Work Items** (Read).

## Commands

### Workflow
| # | Command | Description |
|---|---------|-------------|
| 1 | **Set Master Packages** | Close all packages, open configured ones, regenerate metadata |
| 2 | **Pull Force** | Reset local site to parent, checkout branch, process commits |
| 3 | **Reset** | Pull Force from scratch (discards branch history) |
| 4 | **Pull** | Incremental update without reset |
| 5 | **Commit** | Push changes, create PRs (code + metadata view-diff) |

### Tools
| Key | Command | Description |
|-----|---------|-------------|
| s | **Status** | Site, branch, packages, active PRs |
| d | **Diff** | Preview local changes before commit |
| m | **Merge** | Merge feature branch into target |
| r | **Rollback** | Undo commits via safe revert |
| h | **Health Check** | Deep diagnostic: site, SQL, Git, APIs, IIS, disk |
| l | **Logs** | Browse session logs |
| i | **Init** | Create new environment interactively |

## Project Structure

```
DONUT.exe                  <- user entry point
app/                       <- frontend (TypeScript / Vite)
cli/                       <- PowerShell scripts & modules
  ├── config/              <- version.json, packages.json
  ├── modules/             <- reusable PowerShell modules
  └── scripts/             <- workflow scripts (1 per command)
src-tauri/                 <- Rust backend (Tauri 2)
tests/                     <- Pester test suite
working-environments/      <- user environment configs (.env.json)
dev/                       <- developer tools
  ├── donut.bat/ps1        <- CLI mode (dev/debug without compilation)
  └── build-cargo.cmd      <- compile DONUT.exe
```

## Building

```
dev\build-cargo.cmd
```

Requires: Rust toolchain + Visual Studio Build Tools (C++).

## CLI Mode (dev)

```
dev\donut.bat
dev\donut.bat -Script commit -Message "Fix field naming"
dev\donut.bat -Script status
```

## Configuration

Environment files in `working-environments/` as `.env.json` or `.env-{name}.json`. Manage from the GUI Config tab.

## Sharing

Zip the project folder (excluding `src-tauri/target/`, `.bin/`, `.env*.json`). Recipients unzip and double-click `DONUT.exe`.

## Contribute

Fork the repo and open a Pull Request on GitHub.
