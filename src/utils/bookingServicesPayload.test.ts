import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase', () => ({ supabase: { functions: { invoke: vi.fn() } } }));

import { buildServicesPayload, snapshotServiceInput } from './bookingAuthorityService';
import type { BookingData } from '../contexts/BookingContext';

const base = {
  address: 'Marbella', addressCoordinates: { lat: 36.5, lng: -4.9 }, photos: [], description: '', preferredDate: '',
  timeSlot: '', providerId: '', estimatedHours: 0, totalPrice: 0,
} as unknown as BookingData;

describe('buildServicesPayload (GarSer Empresas F8)', () => {
  it('un servicio: lo de siempre, sin lista de servicios', () => {
    const payload = buildServicesPayload({ ...base, serviceIds: ['lawn'], lawnZones: [{ quantity: 300 }] } as unknown as BookingData);
    expect(payload.items).toBeUndefined();
    expect((payload.bookingInput as { lawnZones: unknown[] }).lawnZones).toHaveLength(1);
  });

  it('varios: cada servicio con sus datos; el que está en pantalla, con lo que hay', () => {
    const lawn = snapshotServiceInput({ ...base, serviceIds: ['lawn', 'hedge'], lawnZones: [{ quantity: 300 }] } as unknown as BookingData, 'lawn');
    const data = {
      ...base, serviceIds: ['lawn', 'hedge'], activeServiceIndex: 1,
      serviceInputs: { lawn }, lawnZones: [], hedgeZones: [{ length: 40 }],
    } as unknown as BookingData;
    const payload = buildServicesPayload(data);
    expect(payload.items?.map((i) => i.serviceId)).toEqual(['lawn', 'hedge']);
    expect(payload.bookingInput).toBe(payload.items?.[0].bookingInput);
    expect((payload.items?.[0].bookingInput as { lawnZones: unknown[] }).lawnZones).toHaveLength(1);
    expect((payload.items?.[1].bookingInput as { hedgeZones: unknown[] }).hedgeZones).toHaveLength(1);
    expect(payload.items?.[1].bookingInput.serviceIds).toEqual(['hedge']);
    expect('servicesData' in (payload.items?.[1].bookingInput || {})).toBe(false);
  });

  it('varios con un servicio sin rellenar (y no es el de pantalla): error claro', () => {
    const data = { ...base, serviceIds: ['lawn', 'hedge'], activeServiceIndex: 1, serviceInputs: {} } as unknown as BookingData;
    expect(() => buildServicesPayload(data)).toThrow(/Faltan los datos/);
  });
});
