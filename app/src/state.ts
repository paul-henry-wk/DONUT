// ═══════════════════════════════════════════════════════════════════
// state.ts — Constants, state, and shared utilities (ESM)
// ═══════════════════════════════════════════════════════════════════

import type { EnvConfig, ScriptDef, ScriptGroup, RunHistoryEntry, WorkItem } from './types';

// ── Icons (Lucide SVG) ──
export const ICO = (d: string, vb = '0 0 24 24'): string =>
  `<svg viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="s-icon">${d}</svg>`;

export const ICONS: Record<string, string> = {
  'set-master-packages': ICO('<path d="M16.5 9.4 7.55 4.24"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.29 7 12 12 20.71 7"/><line x1="12" y1="22" x2="12" y2="12"/>'),
  'pull-force':          ICO('<path d="M12 17V3"/><path d="m6 11 6 6 6-6"/><path d="M19 21H5"/>'),
  'reset':               ICO('<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>'),
  'pull':                ICO('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'),
  'commit':              ICO('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>'),
  'status':              ICO('<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>'),
  'diff':                ICO('<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><path d="M11 18H8a2 2 0 0 1-2-2V9"/>'),
  'merge':               ICO('<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>'),
  'rollback':            ICO('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>'),
  'health-check':        ICO('<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/><path d="M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27"/>'),
  'setup-local-auth':     ICO('<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'),
  'install-site':          ICO('<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>'),
  'cleanup':               ICO('<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>'),
  'compare':               ICO('<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>'),
  'log':                   ICO('<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/>'),
};

// ── Data ──
export const SCRIPT_GROUPS: ScriptGroup[] = [
  { label: 'Setup', scripts: [
    { id: 'install-site',        num: '00', name: 'Install Site',        desc: 'deploy .ENA archive to local IIS', requires: [], admin: true },
    { id: 'setup-local-auth',    num: '01', name: 'Setup Auth',          desc: 'configure admin credentials & restart IIS', requires: ['site_path'], admin: true },
    { id: 'set-master-packages', num: '02', name: 'Set Packages',        desc: 'select which packages are open for dev', requires: ['site_path'] },
  ]},
  { label: 'Synchronize', scripts: [
    { id: 'pull-force',          num: '03', name: 'Pull Force',          desc: 'full download: reset site & apply all commits', danger: true, requires: ['site_path', 'feature_branch', 'repository'] },
    { id: 'reset',               num: '04', name: 'Full Reset',          desc: 'wipe & rebuild site from scratch (no history)', danger: true, requires: ['site_path', 'feature_branch', 'repository'] },
    { id: 'pull',                num: '05', name: 'Pull',                desc: 'apply new commits without resetting site', requires: ['site_path', 'feature_branch', 'repository'] },
    { id: 'commit',              num: '06', name: 'Commit',              desc: 'push local changes & create pull request', needsMsg: true, requires: ['site_path', 'feature_branch', 'target_branch', 'repository', 'token'] },
  ]},
  { label: 'Diagnostic', scripts: [
    { id: 'status',              num: '07', name: 'Status',              desc: 'show site, branch & PR status', requires: ['repository', 'token'] },
    { id: 'diff',                num: '08', name: 'Diff',                desc: 'preview local changes before commit', requires: ['site_path', 'feature_branch'] },
    { id: 'health-check',        num: '09', name: 'Health Check',        desc: 'deep diagnostic of site, DB, git, APIs', requires: ['site_path'] },
    { id: 'compare',             num: '12', name: 'Compare',             desc: 'compare current env with other environments', requires: [] },
    { id: 'log',                 num: '13', name: 'Log',                 desc: 'view recent session logs', requires: [] },
  ]},
  { label: 'Git', scripts: [
    { id: 'merge',               num: '10', name: 'Merge',               desc: 'merge feature branch into target', requires: ['site_path', 'feature_branch', 'target_branch'] },
    { id: 'rollback',            num: '11', name: 'Rollback',            desc: 'undo commits (safe revert)', danger: true, requires: ['site_path', 'feature_branch'] },
    { id: 'cleanup',             num: '14', name: 'Cleanup',             desc: 'clean old commits, temp files & logs', requires: [], danger: true },
  ]},
];

export const SCRIPTS: ScriptDef[] = SCRIPT_GROUPS.flatMap(g => g.scripts);

// ── Workflow tracking (state machine) ──
export const WF_ICO: Record<string, string> = {
  idle:             ICO('<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>'),
  site_installed:   ICO('<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>'),
  auth_set:         ICO('<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'),
  packages_set:     ICO('<path d="M16.5 9.4 7.55 4.24"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>'),
  site_ready:       ICO('<path d="M12 17V3"/><path d="m6 11 6 6 6-6"/><path d="M19 21H5"/>'),
  changes_reviewed: ICO('<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>'),
  committed:        ICO('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>'),
  merged:           ICO('<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>'),
};

export const WF_STATES: Array<{ id: string; label: string }> = [
  { id: 'idle',             label: 'Start' },
  { id: 'site_installed',   label: 'Install' },
  { id: 'auth_set',         label: 'Auth' },
  { id: 'packages_set',     label: 'Packages' },
  { id: 'site_ready',       label: 'Site' },
  { id: 'changes_reviewed', label: 'Review' },
  { id: 'committed',        label: 'Commit' },
  { id: 'merged',           label: 'Merge' },
];

export const WF_TRANSITIONS: Record<string, { to: string; minState?: string }> = {
  'install-site':        { to: 'site_installed' },
  'setup-local-auth':    { to: 'auth_set' },
  'set-master-packages': { to: 'packages_set',     minState: 'idle' },
  'pull-force':          { to: 'site_ready',       minState: 'idle' },
  'reset':               { to: 'site_ready',       minState: 'idle' },
  'pull':                { to: 'site_ready',       minState: 'idle' },
  'diff':                { to: 'changes_reviewed', minState: 'site_ready' },
  'commit':              { to: 'committed',        minState: 'site_ready' },
  'merge':               { to: 'merged',           minState: 'committed' },
  'rollback':            { to: 'site_ready' },
};

export const WF_RECOMMEND: Record<string, string[]> = {
  idle:              ['install-site'],
  site_installed:    ['setup-local-auth'],
  auth_set:          ['set-master-packages'],
  packages_set:      ['pull-force', 'pull', 'reset'],
  site_ready:        ['diff', 'commit'],
  changes_reviewed:  ['commit'],
  committed:         ['merge', 'status'],
  merged:            ['set-master-packages'],
};

export const WF_ALWAYS: string[] = ['status', 'health-check', 'cleanup', 'compare', 'log'];

// ── Shared mutable state ──
export const S = {
  currentEnv: '',
  envConfig: {} as EnvConfig,
  selectedScript: null as string | null,
  isRunning: false,
  runStartTime: 0,
  runTimerInterval: null as ReturnType<typeof setInterval> | null,
  runHistory: JSON.parse(localStorage.getItem('donut-history') || '[]') as RunHistoryEntry[],
  termFontSize: parseInt(localStorage.getItem('donut-term-fontsize') || '12'),
  termWordWrap: localStorage.getItem('donut-term-wrap') !== 'false',
  termRelativeTime: localStorage.getItem('donut-term-reltime') === 'true',
  termFilterType: 'all',
  _termFirstLogTime: null as number | null,
  _lastRunScript: null as string | null,
  lastRunResult: null as { ok: boolean; script: string; duration: string } | null,
  cachedProjects: [] as string[],
  cachedRepos: [] as string[],
  cachedBranches: [] as string[],
  cachedPackages: [] as string[],
  cachedWorkItems: [] as WorkItem[],
  isWatching: false,
  _pendingInstallSitePath: null as string | null,
  pipeline: [] as string[],
  pipelineRunning: false,
  pipelineIdx: 0,
};

// ── Tauri bindings (lazy access to avoid crash if __TAURI__ not yet injected) ──
export function invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return window.__TAURI__.core.invoke<T>(cmd, args);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function listen(event: string, handler: (event: { payload: any }) => void): Promise<() => void> {
  return window.__TAURI__.event.listen(event, handler);
}

// ── DOM helper ──
export function $<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

// ── Utilities ──
export const esc = (s: string): string => {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML.replace(/'/g, '&#39;');
};

export const time = (): string =>
  new Date().toLocaleTimeString('fr', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

// ── Toasts ──
const TOAST_ICONS: Record<string, string> = {
  success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  error:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>',
  warn:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
  info:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
};

const TOAST_TITLES: Record<string, string> = {
  success: 'Success', error: 'Error', warn: 'Warning', info: 'Info',
};

export function toast(msg: string, type: string = 'info'): void {
  const container = document.getElementById('toasts');
  if (!container) return;

  // Duration scales with message length and severity
  const baseDuration = type === 'error' ? 8000 : type === 'warn' ? 6000 : 3500;
  const duration = Math.min(baseDuration + msg.length * 20, 15000);

  const dismiss = (el: HTMLElement) => { el.classList.add('out'); setTimeout(() => el.remove(), 300); };

  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.setAttribute('role', 'alert');
  el.style.setProperty('--toast-duration', duration + 'ms');
  el.innerHTML =
    `<span class="toast-icon">${TOAST_ICONS[type] || TOAST_ICONS.info}</span>` +
    `<div class="toast-body">` +
      `<span class="toast-title">${TOAST_TITLES[type] || 'Info'}</span>` +
      `<span class="toast-msg">${esc(msg)}</span>` +
    `</div>` +
    `<button class="toast-close" aria-label="Close">&times;</button>` +
    `<span class="toast-progress"></span>`;

  el.querySelector('.toast-close')!
    .addEventListener('click', (e: Event) => { e.stopPropagation(); dismiss(el); });

  // Pause timer on hover
  let timer = setTimeout(() => dismiss(el), duration);
  el.addEventListener('mouseenter', () => { clearTimeout(timer); el.classList.add('paused'); });
  el.addEventListener('mouseleave', () => {
    el.classList.remove('paused');
    timer = setTimeout(() => dismiss(el), 2000);
  });

  // Limit to 5 toasts visible
  while (container.children.length >= 5) container.removeChild(container.children[0]);

  container.appendChild(el);
}

// ── Global error handlers ──
window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
  console.error('Unhandled promise rejection:', e.reason);
});

// ── Notifications ──
if ('Notification' in window && Notification.permission === 'default') {
  Notification.requestPermission();
}

// ── Theme-aware messages ──
export const THEME_MSGS: Record<string, { success: string[]; fail: string[]; run: string[] }> = {
  dark: {
    success: ['Done! Enjoy your donut.', 'All good! Have a donut break.', 'The donut is ready.', 'Another batch well done.'],
    fail:    ['The donut burned.', 'Something went wrong in the bakery.', 'The oven malfunctioned.'],
    run:     ['Glazing the donut...', 'Sprinkling some magic...', 'Warming up the oven...', 'Rolling the dough...', 'Adding extra frosting...', 'Quality check: tastes great.', 'Fresh batch incoming...'],
  },
  light: {
    success: ['Done! Enjoy your donut.', 'All good! Take a break.', 'Clean and crispy.', 'Nicely baked.'],
    fail:    ['The donut crumbled.', 'Oops, something spilled.', 'The recipe went wrong.'],
    run:     ['Preparing the dough...', 'Setting the temperature...', 'Mixing ingredients...', 'Almost ready...'],
  },
  'dark-choco': {
    success: ['90% cacao perfection.', 'Dark and intense.', 'Bitter-sweet success.', 'Noir excellence.'],
    fail:    ['The dark batch burned.', 'Too bitter.', 'Cocoa overload.', 'The ganache cracked.'],
    run:     ['Roasting cacao nibs...', 'Grinding dark cocoa...', 'Conching the chocolate...', 'Adjusting bitterness...', 'Pouring dark ganache...'],
  },
  chocolate: {
    success: ['Chocolate glazing complete!', 'Dark ganache applied.', 'Cocoa perfection achieved.', 'Caramel drizzle: flawless.'],
    fail:    ['The chocolate seized up.', 'Ganache too thick.', 'Cocoa disaster.', 'The caramel burned.'],
    run:     ['Melting the chocolate...', 'Tempering the ganache...', 'Drizzling caramel...', 'Dusting with cocoa powder...', 'Infusing dark chocolate...', 'Adding hazelnut praline...'],
  },
  strawberry: {
    success: ['Berry good! Freshly picked.', 'Strawberry cream: magnifique!', 'Pink frosting applied!', 'Fresh from the berry patch.'],
    fail:    ['The berries went sour.', 'Cream curdled.', 'Strawberry jam... literally.', 'Too many seeds.'],
    run:     ['Picking fresh strawberries...', 'Whipping the cream...', 'Folding in berry coulis...', 'Piping pink frosting...', 'Drizzling strawberry glaze...', 'Adding a fresh berry on top...'],
  },
  rainbow: {
    success: ['Rainbow sprinkles applied!', 'Taste the rainbow!', 'Party donut ready!', 'Unicorn approved!'],
    fail:    ['Colors clashed.', 'The sprinkles exploded.', 'Rainbow malfunction.', 'Too much glitter.'],
    run:     ['Applying rainbow sprinkles...', 'Charging the color cannons...', 'Mixing all the flavors...', 'Adding extra sparkle...', 'Calibrating the fun-o-meter...', 'Confetti ready...'],
  },
  win95: {
    success: ['This operation completed successfully.', 'The program has finished.', 'Task completed. You may now close this window.', 'Done. Have a nice day.'],
    fail:    ['This program has performed an illegal operation.', 'A fatal exception has occurred.', 'An error has occurred. Press any key to continue.', 'General Protection Fault.'],
    run:     ['Please wait...', 'Loading...', 'Initializing system components...', 'Scanning for plug and play devices...', 'Windows is starting your program...', 'Contacting server...'],
  },
  winxp: {
    success: ['Task completed! Your donut experience is ready.', 'All systems go! Bliss achieved.', 'Operation successful. Welcome back.', 'Done! That was a smooth ride.'],
    fail:    ['Windows has encountered a problem.', 'This donut has stopped unexpectedly.', 'A problem caused the program to stop working.', 'Send error report? Just kidding.'],
    run:     ['Getting things ready...', 'Preparing your experience...', 'Connecting to resources...', 'Almost there, hang tight...', 'Loading your profile...', 'Applying your settings...'],
  },
  aqua: {
    success: ['Insanely great donut.', 'One more thing... it worked!', 'Boom. Done.', 'Your donut is ready. Enjoy.'],
    fail:    ['An unexpected error occurred.', 'The application quit unexpectedly.', 'Kernel panic: donut not found.', 'Force Quit required.'],
    run:     ['Loading...', 'Preparing your donut...', 'Starting up...', 'Initializing Aqua interface...', 'Checking for updates...', 'Mounting volumes...'],
  },
};

export function getThemeMsgs(): { success: string[]; fail: string[]; run: string[] } {
  return THEME_MSGS[document.body.getAttribute('data-theme') || 'dark'] || THEME_MSGS.dark;
}

export function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── Azure DevOps state ──
export function getOrg(): string {
  return S.envConfig.azdo?.organization || '';
}

export function getProject(): string {
  return S.envConfig.azdo?.project || '';
}

/// Invoke an Azure DevOps Tauri command with common fields (organization) pre-filled.
export function azdoInvoke<T = unknown>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  return invoke<T>(cmd, { organization: getOrg(), ...args });
}
