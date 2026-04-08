// ═══════════════════════════════════════════════════════════════════
// types.ts — TypeScript interfaces for the DONUT app
// ═══════════════════════════════════════════════════════════════════

export interface EnvConfig {
  local?: {
    site_path?: string;
    ena_path?: string;
    parent_site?: string;
    user?: string;
    password?: string;
    developer_password?: string;
    db_user?: string;
    db_password?: string;
  };
  azdo?: {
    organization?: string;
    project?: string;
    token?: string;
    repository?: string;
    repository_metadata?: string;
  };
  git?: {
    username?: string;
    email?: string;
  };
  feature_branch?: string;
  target_branch?: string;
  packages?: string[];
  workitem_id?: string;
  deactivate_metadata_conversion?: boolean;
}

export interface ScriptDef {
  id: string;
  num: string;
  name: string;
  desc: string;
  danger?: boolean;
  needsMsg?: boolean;
  requires?: string[];
  admin?: boolean;
}

export interface ScriptGroup {
  label: string;
  scripts: ScriptDef[];
}

export interface WfStep {
  script: string;
  date: string;
  ok: boolean;
}

export interface Workflow {
  state: string;
  steps: WfStep[];
}

export interface RunHistoryEntry {
  script: string;
  ok: boolean;
  duration: string;
  date: string;
}

export interface HealthStatus {
  iis?: boolean;
  sql?: boolean;
  site?: boolean;
  vpn?: boolean;
  iis_detail?: string;
  sql_detail?: string;
  site_detail?: string;
  vpn_detail?: string;
}

export interface PrereqCheck {
  name: string;
  ok: boolean;
  version?: string;
}

export interface PullRequest {
  id?: number;
  title?: string;
  status?: string;
  source_branch?: string;
  target_branch?: string;
  created_by?: string;
  url?: string;
}

export interface BuildStatus {
  id?: number;
  status?: string;
  result?: string;
  definition_name?: string;
  source_branch?: string;
  url?: string;
  finish_time?: string | null;
}

export interface WorkItem {
  id?: number;
  title?: string;
  state?: string;
  type?: string;
}

export interface ScriptEvent {
  type: string;
  text?: string;
  script?: string;
  code?: number;
}

export interface VersionInfo {
  name?: string;
  fullname?: string;
  version?: string;
  dependencies?: Record<string, string>;
}

export interface UpdateInfo {
  available: boolean;
  current_version: string;
  latest_version: string;
  download_url: string;
  release_notes: string;
}

export interface ModalOptions {
  title?: string;
  message?: string;
  inputPlaceholder?: string;
  inputValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

declare global {
  interface Window {
    __TAURI__: {
      core: { invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T> };
      event: { listen: (event: string, handler: (event: { payload: ScriptEvent }) => void) => Promise<() => void> };
      window: { getCurrentWindow: () => { requestUserAttention: (type: number | null) => Promise<void>; setFocus: () => Promise<void> } };
    };
    _prereqs?: PrereqCheck[];
    _installCmds?: Record<string, string>;
    // All window function aliases for onclick handlers
    [key: string]: unknown;
  }
}
export {};
