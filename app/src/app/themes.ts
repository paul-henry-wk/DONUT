// =====================================================================
// app/themes.ts -- Theme system (definitions, welcome art, theme switching)
// =====================================================================

import { esc } from '../state';

// ── Theme constants ──
export interface ThemeDef {
  id: string;
  label: string;
}

export const THEMES: ThemeDef[] = [
  { id: 'dark',       label: 'Dark' },
  { id: 'light',      label: 'Light' },
  { id: 'dark-choco', label: 'Dark Choco' },
  { id: 'chocolate',  label: 'Chocolate' },
  { id: 'strawberry', label: 'Strawberry' },
  { id: 'rainbow',    label: 'Rainbow' },
  { id: 'win95',      label: 'Windows 95' },
  { id: 'winxp',      label: 'Windows XP' },
  { id: 'aqua',       label: 'Mac OS X' },
];

export const THEME_WELCOME: Record<string, string[]> = {
  dark: [
    '      .:::::.          ',
    '   .::       ::.       ',
    '  ::   .:::.   ::   ',
    '  ::   :   :   ::   ',
    '  ::   \':::\'   ::      ',
    '   \'::       ::\'       ',
    '      \':::::\' ',
  ],
  light: [
    '       .-"""-.         ',
    '      /       \\        ',
    '     |  O   O  |    ',
    '     |    (_)   |    ',
    '     |  \\___/  |       ',
    '      \\_______/        ',
    '         |||  ',
  ],
  'dark-choco': [
    '      ________         ',
    '    /%%%%%%%%%%\\       ',
    '   |%%%%%.%%%%%|    ',
    '   |%%%%.%%..%%|    ',
    '   |%%%%%.%%%%%|       ',
    '    \\%%%%%%%%%%/       ',
    '      --------  ',
  ],
  chocolate: [
    '    ~~~~~~~~~~~~~~     ',
    '   ~~~  CHOCO  ~~~     ',
    '  {  .-\"\"\"\"\"-.   }  ',
    '  { /  ,._,.  \\  }  ',
    '  { |  (o)(o) |  }     ',
    '   {  \\_____/   }      ',
    '    ~~~~~~~~~~~~ ',
  ],
  strawberry: [
    '        \\\\|//          ',
    '         .--.          ',
    '    .--./    \\.--. ',
    '   /   \'.*  *.\'   \\ ',
    '   |  .*  \\/  *.  |    ',
    '    \\  \'*.  .*\'  /     ',
    '     \'--\'----\'--\' ',
  ],
  rainbow: [
    '   *  .  *  .  *  .   ',
    '  .  * . PARTY . *    ',
    '    .o0O DONUT O0o. ',
    '   0  *  MODE  *  0 ',
    '    \'o0O  !!! O0o\'     ',
    '  *  .  *  .  *  .    ',
    '   .  *  .  *  .  * ',
  ],
  win95: [
    ' _________________________ ',
    '|  _   _ _           ___  |',
    '| | \\ / (_)_ __  ___/ _ \\ |',
    '| |  V  | | \'_ \\(_-<\\_, / |',
    '| |_/ \\_|_|_||_/__/ /_/  |',
    '|     DONUT for Win95     |',
    '|_________________________|',
  ],
  winxp: [
    '  \\\\    //  ____           ',
    '   \\\\  //  |  _ \\          ',
    '    \\\\//   | |_) |         ',
    '    //\\\\   |  __/          ',
    '   //  \\\\  | |             ',
    '  //    \\\\ |_|   DONUT     ',
    '  ~ experience the donut ~',
  ],
  aqua: [
    '       .\'\'\'\'\'\'\'\'\'.',
    '     .\'           \'.',
    '    :   .\'\'\'\'\'\'-.   :',
    '    :  : DONUT  :  :',
    '    :   \'......\'   :',
    '     \'.           .\'',
    '       \'.........\' ',
  ],
};

export const THEME_TAGLINES: Record<string, string> = {
  dark:        'DevOps Nabsic Unified Tool',
  light:       'DevOps Nabsic Unified Tool',
  'dark-choco': '90% cacao, no compromise',
  chocolate:   'Fueled by cocoa & caramel',
  strawberry:  'Freshly picked, berry sweet',
  rainbow:     'Sprinkles included, fun guaranteed',
  win95:       'Where do you want to go today?',
  winxp:       'It just works. Like your donut.',
  aqua:        'Think different. Think donut.',
};

// ── Theme functions ──
export function updateWelcomeArt(themeId: string): void {
  const out = document.getElementById('termOutput');
  if (!out) return;
  // Only update if terminal still has the initial welcome (not cleared or has script output)
  const lines = out.querySelectorAll('.line');
  if (lines.length > 15) return; // terminal has real output, don't touch
  const art = THEME_WELCOME[themeId] || THEME_WELCOME.dark;
  const tag = THEME_TAGLINES[themeId] || THEME_TAGLINES.dark;
  const verStr = document.getElementById('ver')?.textContent || '';
  out.innerHTML = art.map((line: string, i: number) => {
    if (i === 2) return `<div class="line dim">${esc(line)}<span class="sys" id="termVer">DONUT ${verStr}</span></div>`;
    if (i === 3) return `<div class="line dim">${esc(line)}<span class="sys">${esc(tag)}</span></div>`;
    return `<div class="line dim">${esc(line)}</div>`;
  }).join('') + '<div class="line sys"> </div><div class="line sys">Ready. Select a script and click RUN.</div>';
}

export function renderThemeList(): void {
  const current = document.body.getAttribute('data-theme') || 'dark';
  const el = document.getElementById('themeList');
  if (!el) return;
  el.innerHTML = THEMES.map((t: ThemeDef) =>
    `<div class="theme-opt${t.id === current ? ' active' : ''}" onclick="setTheme('${t.id}');closeThemeList()">
      <span class="theme-dot dot-${t.id}"></span>${esc(t.label)}
    </div>`
  ).join('');
}

export function setTheme(id: string): void {
  const t = THEMES.find((th: ThemeDef) => th.id === id) || THEMES[0];
  // Smooth transition between themes
  document.body.classList.add('theme-transitioning');
  document.body.setAttribute('data-theme', t.id);
  localStorage.setItem('donut-theme', t.id);
  const label = document.getElementById('themeLabel');
  if (label) label.textContent = t.label;
  const dot = document.getElementById('themeDot');
  if (dot) dot.className = 'theme-dot dot-' + t.id;
  renderThemeList();
  updateWelcomeArt(t.id);
  // Remove transition class after animation completes
  setTimeout(() => document.body.classList.remove('theme-transitioning'), 450);
}

export function toggleThemeList(): void {
  document.getElementById('themeList')?.classList.toggle('open');
}

export function closeThemeList(): void {
  document.getElementById('themeList')?.classList.remove('open');
}
