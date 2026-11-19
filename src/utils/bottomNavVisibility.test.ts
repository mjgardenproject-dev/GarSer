import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { shouldShowBottomNav } from './bottomNavVisibility';

describe('barra inferior del móvil (QA-187)', () => {
  it('no se pinta sobre la incidencia, que tiene su propio botón «Enviar incidencia» fijo abajo', () => {
    expect(shouldShowBottomNav('/incidencias/0b1a-reserva', true)).toBe(false);
  });

  it('sigue igual en el resto de pantallas', () => {
    for (const p of ['/dashboard', '/bookings', '/chat', '/account', '/mi-trabajo']) {
      expect(shouldShowBottomNav(p, true)).toBe(true);
    }
    for (const p of ['/auth', '/reservar', '/reserva/confirmacion', '/apply', '/admin', '/', '/para-jardineros', '/activar', '/mi-trabajo/bienvenida']) {
      expect(shouldShowBottomNav(p, true)).toBe(false);
    }
    expect(shouldShowBottomNav('/dashboard', false)).toBe(false);
  });

  // Guardia: un botón fijo abajo (`fixed … bottom-0`) en una página con barra inferior queda tapado por
  // ella (QA-187). Fuera de la reserva (que no tiene barra) no debe haber ninguno: los botones van en
  // el flujo de la página. Si de verdad hace falta uno, su ruta tiene que ocultar la barra.
  it('ninguna página fuera de la reserva pone un botón fijo abajo', () => {
    // Páginas con botón fijo cuya ruta YA oculta la barra (se comprueba en el test de arriba).
    const hidesBar = new Set(['empleado/EmployeeWelcomePage.tsx']);
    const root = path.resolve(__dirname, '..', 'pages');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) {
          if (name !== 'reserva') walk(full);
        } else if (/\.tsx$/.test(name) && !/\.test\./.test(name) && /fixed[^"'`]*bottom-0/.test(readFileSync(full, 'utf8')) && !hidesBar.has(path.relative(root, full))) {
          offenders.push(path.relative(root, full));
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
