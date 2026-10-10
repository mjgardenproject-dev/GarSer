// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase', () => ({ supabase: { rpc: vi.fn(), functions: { invoke: vi.fn() } } }));

import { supabase } from '../lib/supabase';
import {
  closeOwnAccount, consumeAccountClosed, describeClosureBlockers, describeClosureOutcome, fetchSelfClosurePlan,
  formatClosureDate, markAccountClosed, type SelfClosurePlan,
} from './selfAccountClosure';

describe('baja desde «Mi cuenta» (PH-01)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('dice la fecha como en España', () => {
    expect(formatClosureDate('2026-10-03')).toBe('3 de octubre');
    expect(formatClosureDate('no-es-fecha')).toBe('no-es-fecha');
  });

  it('cada reserva que bloquea, con su fecha, su estado y qué hacer', () => {
    const plan: SelfClosurePlan = {
      exists: true, mode: 'blocked',
      blockers: [{ code: 'open_bookings', count: 3, message: 'x' }],
      openBookings: [
        { date: '2026-10-03', status: 'confirmed', service: 'Corte de césped', asClient: true },
        { date: '2026-10-05', status: 'pending', service: null, asClient: false },
      ],
    };
    expect(describeClosureBlockers(plan)).toEqual([
      'Tienes una reserva de Corte de césped confirmada el 3 de octubre: cancélala o espera a que termine.',
      'Tienes una reserva pendiente de aceptar el 5 de octubre: termínala o cancélala desde tus reservas.',
      'Y 1 reserva(s) más sin terminar.',
    ]);
  });

  it('trabajos asignados, pagos, incidencias, planes y motivos desconocidos', () => {
    const plan: SelfClosurePlan = {
      exists: true, mode: 'blocked',
      blockers: [
        { code: 'assigned_jobs', message: 'x' }, { code: 'payments_in_progress', message: 'x' },
        { code: 'open_incidents', message: 'x' }, { code: 'active_plans', message: 'x' }, { code: 'otro', message: 'Motivo del servidor' },
      ],
      assignedJobs: [{ date: '2026-11-01', service: 'Poda de setos' }],
    };
    const lines = describeClosureBlockers(plan);
    expect(lines[0]).toBe('Tienes un trabajo de Poda de setos asignado el 1 de noviembre: pide a tu empresa que se lo asigne a otra persona.');
    expect(lines).toHaveLength(5);
    expect(lines[4]).toBe('Motivo del servidor');
  });

  it('explica qué pasa al borrar y al dar de baja con historial', () => {
    expect(describeClosureOutcome({ exists: true, mode: 'delete' }).join(' ')).toMatch(/cuenta entera.*No se puede deshacer/);
    const withCompany = describeClosureOutcome({
      exists: true, mode: 'deactivate', company: { id: 'c', status: 'active', name: 'Jardines', activeEmployees: 2 },
    }).join(' ');
    expect(withCompany).toMatch(/datos personales/);
    expect(withCompany).toMatch(/reservas pasadas y sus importes se conservan/);
    expect(withCompany).toMatch(/tu equipo \(2 persona\(s\)\)/);
    expect(describeClosureOutcome({ exists: true, mode: 'blocked' })).toEqual([]);
  });

  it('pide el análisis al servidor y ejecuta lo que dijo', async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: { exists: true, mode: 'delete' }, error: null } as never);
    await expect(fetchSelfClosurePlan()).resolves.toEqual({ exists: true, mode: 'delete' });
    expect(supabase.rpc).toHaveBeenCalledWith('my_account_closure_preview');

    vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: { success: true }, error: null } as never);
    await closeOwnAccount('delete');
    expect(supabase.functions.invoke).toHaveBeenCalledWith('account-closure', { body: { expectedMode: 'delete' } });
  });

  it('si el servidor lo rechaza, se ve su motivo', async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: { error: 'La cuenta ha cambiado' }, error: null } as never);
    await expect(closeOwnAccount('deactivate')).rejects.toThrow('La cuenta ha cambiado');
  });

  it('el aviso de cuenta cerrada se enseña una sola vez', () => {
    expect(consumeAccountClosed()).toBe(false);
    markAccountClosed();
    expect(consumeAccountClosed()).toBe(true);
    expect(consumeAccountClosed()).toBe(false);
  });
});
