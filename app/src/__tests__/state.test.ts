import { describe, it, expect, vi } from 'vitest';

// jsdom provides window, document, localStorage, and Notification
// but we need to mock __TAURI__ since state.ts doesn't use it at import time
// (invoke/listen are lazy functions that access it only when called)

import { esc, pickRandom, THEME_MSGS, ICO, SCRIPTS, WF_TRANSITIONS, WF_RECOMMEND } from '../state';

describe('esc', () => {
  it('escapes HTML special characters', () => {
    expect(esc('<script>alert("xss")</script>')).not.toContain('<script>');
    expect(esc('<b>bold</b>')).toBe('&lt;b&gt;bold&lt;/b&gt;');
  });

  it('escapes single quotes to &#39;', () => {
    expect(esc("it's")).toBe("it&#39;s");
  });

  it('escapes ampersands', () => {
    expect(esc('a & b')).toBe('a &amp; b');
  });

  it('returns empty string for empty input', () => {
    expect(esc('')).toBe('');
  });

  it('passes through safe strings unchanged', () => {
    expect(esc('hello world')).toBe('hello world');
  });
});

describe('pickRandom', () => {
  it('returns an element from the array', () => {
    const arr = [1, 2, 3, 4, 5];
    const result = pickRandom(arr);
    expect(arr).toContain(result);
  });

  it('returns the only element from a single-element array', () => {
    expect(pickRandom(['only'])).toBe('only');
  });

  it('works with different types', () => {
    const arr = [true, false];
    expect(typeof pickRandom(arr)).toBe('boolean');
  });
});

describe('ICO', () => {
  it('generates an SVG string with the given path', () => {
    const svg = ICO('<path d="M0 0"/>');
    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain('<path d="M0 0"/>');
    expect(svg).toContain('class="s-icon"');
  });

  it('accepts a custom viewBox', () => {
    const svg = ICO('<circle/>', '0 0 16 16');
    expect(svg).toContain('viewBox="0 0 16 16"');
  });
});

describe('THEME_MSGS', () => {
  it('has entries for all expected themes', () => {
    const themes = ['dark', 'light', 'dark-choco', 'chocolate', 'strawberry', 'rainbow', 'win95', 'winxp', 'aqua'];
    for (const theme of themes) {
      expect(THEME_MSGS).toHaveProperty(theme);
      expect(THEME_MSGS[theme].success.length).toBeGreaterThan(0);
      expect(THEME_MSGS[theme].fail.length).toBeGreaterThan(0);
      expect(THEME_MSGS[theme].run.length).toBeGreaterThan(0);
    }
  });
});

describe('SCRIPTS', () => {
  it('contains all expected script ids', () => {
    const ids = SCRIPTS.map(s => s.id);
    expect(ids).toContain('install-site');
    expect(ids).toContain('commit');
    expect(ids).toContain('merge');
    expect(ids).toContain('health-check');
  });

  it('each script has id, num, name, and desc', () => {
    for (const s of SCRIPTS) {
      expect(s.id).toBeTruthy();
      expect(s.num).toBeTruthy();
      expect(s.name).toBeTruthy();
      expect(s.desc).toBeTruthy();
    }
  });
});

describe('WF_TRANSITIONS', () => {
  it('maps script ids to workflow states', () => {
    expect(WF_TRANSITIONS['install-site'].to).toBe('site_installed');
    expect(WF_TRANSITIONS['commit'].to).toBe('committed');
    expect(WF_TRANSITIONS['merge'].to).toBe('merged');
  });
});

describe('WF_RECOMMEND', () => {
  it('recommends install-site from idle state', () => {
    expect(WF_RECOMMEND['idle']).toContain('install-site');
  });

  it('recommends commit from site_ready state', () => {
    expect(WF_RECOMMEND['site_ready']).toContain('commit');
  });
});
