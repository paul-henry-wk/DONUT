import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const mainTs = readFileSync(resolve(__dir, '../main.ts'), 'utf-8');

describe('Window globals', () => {
  it('should have window aliases for all critical functions', () => {
    const criticalFns = [
      'doRun', 'selectScript', 'renderScripts', 'renderRunBar',
      'showModal', 'showConfirm', 'openUrl', 'setTheme',
      'saveConfig', 'autoSave', 'loadEnv', 'renderConfig',
      'renderDevops', 'viewPrDiff', 'doStop', 'togglePanel',
      'refreshHealth', 'toast',
    ];
    for (const fn of criticalFns) {
      expect(mainTs).toContain(`window.${fn} = ${fn}`);
    }
  });

  it('should not have duplicate window assignments', () => {
    const assignments = mainTs.match(/window\.\w+ = /g) || [];
    const unique = new Set(assignments);
    expect(assignments.length).toBe(unique.size);
  });
});
