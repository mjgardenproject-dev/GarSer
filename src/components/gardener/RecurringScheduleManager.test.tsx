// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: { id: 'gardener-1' } as { id: string } | null,
  schedulesData: [] as any[],
  settingsData: null as any,
}));

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: mocks.user }),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../utils/availabilityService', () => ({
  applyRecurringSchedule: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../../lib/supabase', () => {
  const makeBuilder = (table: string) => {
    const builder: any = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      delete: vi.fn(() => builder),
      insert: vi.fn(() => Promise.resolve({ error: null })),
      upsert: vi.fn(() => Promise.resolve({ error: null })),
      single: vi.fn(() =>
        Promise.resolve(
          mocks.settingsData
            ? { data: mocks.settingsData, error: null }
            : { data: null, error: { code: 'PGRST116' } },
        ),
      ),
      // Thenable: `await supabase.from('recurring_schedules').select('*').eq(...)`
      then: (resolve: (value: { data: any[]; error: null }) => unknown) =>
        resolve(
          table === 'recurring_schedules'
            ? { data: mocks.schedulesData, error: null }
            : { data: [], error: null },
        ),
    };
    return builder;
  };
  return {
    supabase: {
      from: vi.fn((table: string) => makeBuilder(table)),
      rpc: vi.fn(() => Promise.resolve({ error: null })),
    },
  };
});

import RecurringScheduleManager from './RecurringScheduleManager';

const DAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

describe('RecurringScheduleManager — estado vacío por defecto', () => {
  beforeEach(() => {
    mocks.user = { id: 'gardener-1' };
    mocks.schedulesData = [];
    mocks.settingsData = null;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('no resalta ningún día cuando no hay horario guardado', async () => {
    render(<RecurringScheduleManager />);

    // Espera a que termine la carga (aparecen los botones de día).
    const lunes = await screen.findByTitle('Lunes');
    expect(lunes).toBeTruthy();

    for (const name of DAY_NAMES) {
      const pill = screen.getByTitle(name);
      // El estado "seleccionado" usa bg-green-600; en vacío no debe aparecer.
      expect(pill.className).not.toContain('bg-green-600');
    }
  });

  it('muestra la guía de funcionamiento al jardinero', async () => {
    render(<RecurringScheduleManager />);
    await waitFor(() => expect(screen.getByText('Cómo funciona tu horario')).toBeTruthy());
  });

  it('ofrece 7:00 como inicio y 20:00 como fin seleccionables', async () => {
    render(<RecurringScheduleManager />);
    await screen.findByTitle('Lunes');

    // "Desde" incluye 07:00; "Hasta" incluye 20:00.
    expect(screen.getAllByRole('option', { name: '07:00' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('option', { name: '20:00' }).length).toBeGreaterThan(0);
  });
});
