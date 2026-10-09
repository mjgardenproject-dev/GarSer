import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
const query = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn() };
vi.mock('../lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a), from: () => query } }));

import { applicationHasData, fetchLastRejection, restartRejectedApplication, wizardStateFromApplication } from './gardenerApplicationRetry';

describe('jardinero rechazado que vuelve a solicitar (PH-02)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.order.mockReturnValue(query);
  });

  it('reabre la solicitud en el servidor (no con UPDATE/DELETE desde el navegador)', async () => {
    rpc.mockResolvedValue({ data: { status: 'draft' }, error: null });
    await restartRejectedApplication();
    expect(rpc).toHaveBeenCalledWith('restart_gardener_application');
  });

  it('si el servidor no lo deja, se ve su motivo', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Solo se puede corregir una solicitud rechazada.' } });
    await expect(restartRejectedApplication()).rejects.toThrow('Solo se puede corregir una solicitud rechazada.');
  });

  it('el último motivo de rechazo, o nada', async () => {
    query.limit.mockResolvedValueOnce({ data: [{ review_comment: ' Faltan fotos ', reviewed_at: '2026-10-01T10:00:00Z' }], error: null });
    await expect(fetchLastRejection('u1')).resolves.toEqual({ reason: 'Faltan fotos', reviewedAt: '2026-10-01T10:00:00Z' });
    expect(query.eq).toHaveBeenCalledWith('user_id', 'u1');
    query.limit.mockResolvedValueOnce({ data: [], error: null });
    await expect(fetchLastRejection('u1')).resolves.toBeNull();
  });

  it('rellena el formulario con lo que había guardado', () => {
    const state = wizardStateFromApplication({
      full_name: 'Juan', phone: '600111222', city_zone: 'Marbella', professional_photo_url: 'https://x/a.jpg',
      services: ['Corte de césped'], tools_available: ['Cortacésped'], experience_years: 5,
      experience_description: 'Diez jardines', worked_for_companies: true, can_prove: null,
      proof_photos: ['https://x/p.jpg'], certification_text: null, certification_photos: null,
    });
    expect(state).toMatchObject({
      fullName: 'Juan', phone: '600111222', cityZone: 'Marbella', photoUrl: 'https://x/a.jpg', services: ['Corte de césped'],
      tools: ['Cortacésped'], expYears: 5, expYearsInput: '5', experienceText: 'Diez jardines', workedForCompanies: true,
      canProve: false, proofPhotos: ['https://x/p.jpg'], educationText: '', certPhotos: [],
    });
  });

  it('un borrador recién creado no tiene datos que restaurar', () => {
    expect(applicationHasData({})).toBe(false);
    expect(applicationHasData({ services: [] })).toBe(false);
    expect(applicationHasData({ full_name: 'Ana' })).toBe(true);
  });
});
