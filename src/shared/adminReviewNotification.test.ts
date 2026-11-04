import { describe, expect, it } from 'vitest';
import { loadAdminRecipients, loadAdminReviewItem, loadPendingCounts } from '../../supabase/functions/_shared/adminReviewNotification.ts';

type Rows = Record<string, Array<Record<string, unknown>>>;

/** Un cliente de base de datos de mentira que contesta a lo que usa el módulo. */
function fakeAdmin(rows: Rows, users: Record<string, string | null> = {}, failOn?: string) {
  const query = (table: string) => {
    let data = [...(rows[table] || [])];
    const builder = {
      select: (_columns?: string, options?: { count?: string; head?: boolean }) => {
        (builder as { _head?: boolean })._head = Boolean(options?.head);
        return builder;
      },
      eq: (column: string, value: unknown) => { data = data.filter((r) => r[column] === value); return builder; },
      in: (column: string, values: unknown[]) => { data = data.filter((r) => values.includes(r[column])); return builder; },
      maybeSingle: async () => (failOn === table ? { data: null, error: new Error(`${table} falla`) } : { data: data[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => void) => {
        if (failOn === table) return resolve({ data: null, count: null, error: new Error(`${table} falla`) });
        return resolve({ data, count: data.length, error: null });
      },
    };
    return builder;
  };
  return {
    from: (table: string) => query(table),
    auth: { admin: { getUserById: async (id: string) => ({ data: { user: users[id] ? { email: users[id] } : null } }) } },
  };
}

describe('avisos al administrador: lectura de la novedad', () => {
  it('una solicitud de jardinero enviada se lee con lo que importa', async () => {
    const admin = fakeAdmin({ gardener_applications: [{ id: 'a1', status: 'submitted', full_name: ' Pablo ', city_zone: 'Marbella', services: ['Corte', ''], experience_range: '1-3' }] });
    expect(await loadAdminReviewItem(admin, 'gardener_application', 'a1')).toEqual({
      kind: 'gardener_application', name: 'Pablo', zone: 'Marbella', services: ['Corte'], experience: '1-3',
    });
  });

  it.each([
    ['gardener_application', 'gardener_applications', { status: 'approved' }],
    ['gardener_application', 'gardener_applications', { status: 'draft' }],
    ['company_application', 'company_applications', { status: 'rejected' }],
    ['phyto_license', 'gardener_licenses', { status: 'approved' }],
    ['phyto_license', 'gardener_licenses', { status: 'replaced' }],
    ['incident', 'booking_incidents', { status: 'resolved_refunded' }],
    ['incident', 'booking_incidents', { status: 'rejected' }],
  ] as const)('%s ya resuelta (%j): no se avisa de algo que no espera a nadie', async (kind, table, row) => {
    const admin = fakeAdmin({ [table]: [{ id: 'x1', ...row }] });
    expect(await loadAdminReviewItem(admin, kind, 'x1')).toBeNull();
  });

  it('una novedad que no existe, o sin id, no avisa', async () => {
    const admin = fakeAdmin({});
    expect(await loadAdminReviewItem(admin, 'incident', 'nope')).toBeNull();
    expect(await loadAdminReviewItem(admin, 'incident', '')).toBeNull();
  });

  it('el carnet de un empleado enviado por su empresa lleva a los dos nombres', async () => {
    const admin = fakeAdmin({
      gardener_licenses: [{ id: 'l1', status: 'pending', gardener_id: 'emp', submitted_by: 'owner', expires_at: '2031-03-03T10:00:00Z' }],
      profiles: [{ user_id: 'emp', full_name: 'Ana López' }, { user_id: 'owner', full_name: '' }],
      gardener_profiles: [{ user_id: 'owner', full_name: 'Jardines Sol' }],
    });
    expect(await loadAdminReviewItem(admin, 'phyto_license', 'l1')).toEqual({
      kind: 'phyto_license', holderName: 'Ana López', submittedByName: 'Jardines Sol', expiresLabel: '3 de marzo de 2031',
    });
  });

  it('una incidencia en revisión sigue pendiente', async () => {
    const admin = fakeAdmin({ booking_incidents: [{ id: 'i1', status: 'in_review', reporter_role: 'client', kind: 'billing', description: ' Me han cobrado de más ' }] });
    expect(await loadAdminReviewItem(admin, 'incident', 'i1')).toEqual({ kind: 'incident', reporterRole: 'client', incidentKind: 'billing', description: 'Me han cobrado de más' });
  });

  it('si la base de datos falla, lanza (la cola reintenta) en vez de dar la novedad por resuelta', async () => {
    await expect(loadAdminReviewItem(fakeAdmin({}, {}, 'booking_incidents'), 'incident', 'i1')).rejects.toThrow(/falla/);
    await expect(loadAdminReviewItem(fakeAdmin({}, {}, 'gardener_applications'), 'gardener_application', 'a1')).rejects.toThrow(/falla/);
  });
});

describe('avisos al administrador: contadores y destinatarios', () => {
  it('cuenta solo lo que espera revisión', async () => {
    const admin = fakeAdmin({
      gardener_applications: [{ id: 1, status: 'submitted' }, { id: 2, status: 'draft' }, { id: 3, status: 'approved' }],
      company_applications: [{ id: 1, status: 'submitted' }, { id: 2, status: 'submitted' }],
      gardener_licenses: [{ id: 1, status: 'pending' }, { id: 2, status: 'approved' }],
      booking_incidents: [{ id: 1, status: 'open' }, { id: 2, status: 'in_review' }, { id: 3, status: 'resolved_no_action' }],
    });
    expect(await loadPendingCounts(admin)).toEqual({ gardenerApplications: 1, companyApplications: 2, licenses: 1, incidents: 2 });
  });

  it('los destinatarios son los administradores con correo, sin repetidos y sin mayúsculas', async () => {
    const admin = fakeAdmin(
      { profiles: [{ user_id: 'a', role: 'admin' }, { user_id: 'b', role: 'admin' }, { user_id: 'c', role: 'admin' }, { user_id: 'd', role: 'client' }, { user_id: 'e', role: 'admin' }] },
      { a: 'Admin@GarSer.es', b: 'admin@garser.es', c: null, d: 'cliente@x.es', e: 'otro@garser.es' },
    );
    expect(await loadAdminRecipients(admin)).toEqual([
      { userId: 'a', email: 'admin@garser.es' },
      { userId: 'e', email: 'otro@garser.es' },
    ]);
  });

  it('sin administradores no hay a quién avisar', async () => {
    expect(await loadAdminRecipients(fakeAdmin({ profiles: [{ user_id: 'd', role: 'client' }] }, { d: 'cliente@x.es' }))).toEqual([]);
  });
});
