import { describe, it, expect, beforeEach } from 'vitest';
import { S } from '../state';
import { getToken, getRepo, validatePath } from '../config';

beforeEach(() => {
  document.body.innerHTML = '';
  S.envConfig = {} as any;
});

describe('getToken', () => {
  it('returns empty when no DOM element and no config', () => {
    expect(getToken()).toBe('');
  });

  it('reads from DOM input if present', () => {
    const input = document.createElement('input');
    input.id = 'c-pat';
    input.value = 'my-pat-token';
    document.body.appendChild(input);
    expect(getToken()).toBe('my-pat-token');
  });

  it('falls back to envConfig when DOM is empty', () => {
    const input = document.createElement('input');
    input.id = 'c-pat';
    input.value = '';
    document.body.appendChild(input);
    S.envConfig = { azdo: { token: 'config-token', repository: '' } } as any;
    expect(getToken()).toBe('config-token');
  });

  it('DOM value takes priority over config', () => {
    const input = document.createElement('input');
    input.id = 'c-pat';
    input.value = 'dom-token';
    document.body.appendChild(input);
    S.envConfig = { azdo: { token: 'config-token', repository: '' } } as any;
    expect(getToken()).toBe('dom-token');
  });
});

describe('getRepo', () => {
  it('returns empty when no DOM element and no config', () => {
    expect(getRepo()).toBe('');
  });

  it('reads from DOM input if present', () => {
    const input = document.createElement('input');
    input.id = 'c-repo';
    input.value = 'MyRepo';
    document.body.appendChild(input);
    expect(getRepo()).toBe('MyRepo');
  });

  it('falls back to envConfig when DOM is empty', () => {
    const input = document.createElement('input');
    input.id = 'c-repo';
    input.value = '';
    document.body.appendChild(input);
    S.envConfig = { azdo: { token: '', repository: 'ConfigRepo' } } as any;
    expect(getRepo()).toBe('ConfigRepo');
  });
});

describe('validatePath', () => {
  it('does nothing if element not found', () => {
    validatePath('nonexistent');
    // No error thrown
  });

  it('clears badge for empty path', () => {
    const input = document.createElement('input');
    input.id = 'test-path';
    input.value = '';
    const badge = document.createElement('span');
    badge.id = 'test-path-valid';
    badge.innerHTML = 'old';
    document.body.appendChild(input);
    document.body.appendChild(badge);

    validatePath('test-path');
    expect(badge.innerHTML).toBe('');
  });

  it('shows valid badge for Windows path', () => {
    const input = document.createElement('input');
    input.id = 'test-path';
    input.value = 'C:\\inetpub\\sites\\MySite';
    const badge = document.createElement('span');
    badge.id = 'test-path-valid';
    document.body.appendChild(input);
    document.body.appendChild(badge);

    validatePath('test-path');
    expect(badge.innerHTML).toContain('cfg-valid-ok');
  });

  it('shows invalid badge for bad path', () => {
    const input = document.createElement('input');
    input.id = 'test-path';
    input.value = 'not-a-path';
    const badge = document.createElement('span');
    badge.id = 'test-path-valid';
    document.body.appendChild(input);
    document.body.appendChild(badge);

    validatePath('test-path');
    expect(badge.innerHTML).toContain('cfg-valid-err');
  });

  it('shows invalid for too-short path', () => {
    const input = document.createElement('input');
    input.id = 'test-path';
    input.value = 'C:\\a';
    const badge = document.createElement('span');
    badge.id = 'test-path-valid';
    document.body.appendChild(input);
    document.body.appendChild(badge);

    validatePath('test-path');
    expect(badge.innerHTML).toContain('cfg-valid-err');
  });

  it('accepts forward slash paths', () => {
    const input = document.createElement('input');
    input.id = 'test-path';
    input.value = 'D:/inetpub/wwwroot';
    const badge = document.createElement('span');
    badge.id = 'test-path-valid';
    document.body.appendChild(input);
    document.body.appendChild(badge);

    validatePath('test-path');
    expect(badge.innerHTML).toContain('cfg-valid-ok');
  });
});
