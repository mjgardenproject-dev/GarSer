import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * These modules are imported by Supabase Edge Functions (Deno), which REQUIRES
 * explicit file extensions on relative imports. An extensionless import here
 * makes the function fail to boot (HTTP 503 on every request). This test guards
 * against that regression.
 */
const DENO_IMPORTED_MODULES = ['manualEntrySchema.ts', 'manualEntryValidation.ts', 'legalCopy.ts'];

const RELATIVE_IMPORT = /from\s+['"](\.\.?\/[^'"]+)['"]/g;

describe('Deno-imported shared modules use explicit .ts extensions', () => {
  DENO_IMPORTED_MODULES.forEach((file) => {
    it(`${file} has no extensionless relative imports`, () => {
      const source = readFileSync(join(here, file), 'utf8');
      const offenders: string[] = [];
      let match: RegExpExecArray | null;
      while ((match = RELATIVE_IMPORT.exec(source)) !== null) {
        const spec = match[1];
        if (!/\.(ts|tsx|js|mjs|json)$/.test(spec)) offenders.push(spec);
      }
      expect(offenders).toEqual([]);
    });
  });
});
