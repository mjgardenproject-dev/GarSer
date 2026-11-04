import { describe, expect, it } from 'vitest';
import { parseAdminPendingCounts, pendingApplications } from './adminPendingCounts';

describe('contadores de revisión del administrador', () => {
  it('lee el resultado de la función de base de datos', () => {
    const counts = parseAdminPendingCounts({ gardenerApplications: 2, companyApplications: 1, licenses: 4, incidents: 3 });
    expect(counts).toEqual({ gardenerApplications: 2, companyApplications: 1, licenses: 4, incidents: 3 });
    expect(pendingApplications(counts!)).toBe(3);
  });

  it('lo que no es un número válido cuenta como cero y no rompe el menú', () => {
    expect(parseAdminPendingCounts({ gardenerApplications: '3', licenses: -2, incidents: 'x', companyApplications: null }))
      .toEqual({ gardenerApplications: 3, companyApplications: 0, licenses: 0, incidents: 0 });
  });

  it('un resultado que no es un objeto no vale', () => {
    expect(parseAdminPendingCounts(null)).toBeNull();
    expect(parseAdminPendingCounts([1, 2])).toBeNull();
    expect(parseAdminPendingCounts('{}')).toBeNull();
  });
});
