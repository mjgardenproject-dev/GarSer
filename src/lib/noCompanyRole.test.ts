import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Desde la cuenta de profesional única (D31, 2026-11-08) no existe un tipo de cuenta «empresa»: autónomo
// o equipo es un MODO que se lee con `useProviderMode()`. Esta prueba recorre el código de producción y
// falla si alguien vuelve a comparar un rol con 'company' (la fuente de la mitad de las ramas de la
// vieja interfaz de empresa). Comparar `provider_kind` (el reflejo del modo en la base de datos) sí vale.

const ROOT = join(process.cwd(), 'src');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'generated' ? [] : files(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

// role === 'company', accountRole !== 'company', effectiveRole == "company", case 'company':
const COMPANY_ROLE = /\b[A-Za-z]*[rR]ole\s*[!=]==?\s*['"]company['"]|case\s+['"]company['"]\s*:/;

describe('el código de producción no compara roles con «company»', () => {
  const offenders = files(ROOT).flatMap((path) =>
    readFileSync(path, 'utf8').split('\n').flatMap((line, index) => {
      const code = line.replace(/\/\/.*$/, '');
      return COMPANY_ROLE.test(code) ? [`${path.slice(ROOT.length + 1)}:${index + 1}  ${line.trim()}`] : [];
    }),
  );

  it('no queda ninguna comparación', () => {
    expect(offenders).toEqual([]);
  });

  it('la propia regla detecta las formas que importan (que la prueba no se quede ciega)', () => {
    for (const bad of ["role === 'company'", "accountRole !== 'company'", 'effectiveRole == "company"', "case 'company':", "plan?.role === 'company'"]) {
      expect(COMPANY_ROLE.test(bad)).toBe(true);
    }
    for (const fine of ["provider_kind === 'company'", "kind === 'company'", "setTab('company')", "type Tab = 'company'"]) {
      expect(COMPANY_ROLE.test(fine)).toBe(false);
    }
  });
});
