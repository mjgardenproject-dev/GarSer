// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: { id: 'gardener-1' } as { id: string } | null,
  schedulesData: [] as any[],
  settingsData: null as any,
  toastError: vi.fn(),
  upserts: [] as any[],
}));

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: mocks.user }),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: (...args: unknown[]) => mocks.toastError(...args) },
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
      upsert: vi.fn((row: unknown) => { mocks.upserts.push(row); return Promise.resolve({ error: null }); }),
      maybeSingle: vi.fn(() => Promise.resolve({ data: mocks.settingsData, error: null })),
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
    mocks.upserts = [];
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

// Fallo 5b (2026-11-05): nada viene preconfigurado. Ni la franja 9-17, ni «1 mes», ni «24 horas».
describe('RecurringScheduleManager — sin valores preconfigurados', () => {
  beforeEach(() => {
    mocks.user = { id: 'gardener-1' };
    mocks.schedulesData = [];
    mocks.settingsData = null;
    mocks.upserts = [];
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const selects = () => screen.getAllByRole('combobox') as HTMLSelectElement[]; // desde, hasta, semanas, antelación

  it('la franja y las reglas arrancan vacías, con «Elige…» y sin 9:00-17:00', async () => {
    render(<RecurringScheduleManager />);
    await screen.findByTitle('Lunes');
    const [desde, hasta, semanas, antelacion] = selects();
    expect(desde.value).toBe('');
    expect(hasta.value).toBe('');
    expect(semanas.value).toBe('');
    expect(antelacion.value).toBe('');
    expect(screen.getAllByText('Elige hora').length).toBe(2);
    expect(screen.getAllByText('Elige una opción').length).toBe(2);
  });

  it('los selectores son de 16 px en el móvil (si no, iOS hace zoom al tocarlos)', async () => {
    render(<RecurringScheduleManager />);
    await screen.findByTitle('Lunes');
    for (const select of selects()) expect(select.className).toContain('text-base');
  });

  it('avisa de lo que queda por configurar y el aviso se va vaciando según elige', async () => {
    render(<RecurringScheduleManager />);
    await screen.findByTitle('Lunes');
    expect(screen.getByText('Te quedan cosas por configurar en tu horario')).toBeTruthy();
    expect(screen.getByText('Los días y las horas en que trabajas')).toBeTruthy();
    expect(screen.getByText('Cuántas semanas de agenda quieres abrir')).toBeTruthy();
    expect(screen.getByText('Con cuánta antelación pueden reservarte')).toBeTruthy();

    const [, , semanas, antelacion] = selects();
    fireEvent.change(semanas, { target: { value: '4' } });
    fireEvent.change(antelacion, { target: { value: '24' } });
    expect(screen.queryByText('Cuántas semanas de agenda quieres abrir')).toBeNull();
    expect(screen.queryByText('Con cuánta antelación pueden reservarte')).toBeNull();
    expect(screen.getByText('Los días y las horas en que trabajas')).toBeTruthy();
  });

  it('marcar un día NO rellena el calendario si no hay franja; con días Y franja, sí', async () => {
    render(<RecurringScheduleManager />);
    await screen.findByTitle('Lunes');
    fireEvent.click(screen.getByTitle('Lunes'));
    // Sigue sin horas: el aviso lo dice y pide la franja.
    expect(screen.getByText('Los días y las horas en que trabajas')).toBeTruthy();
    expect(screen.getByText('Elige también de qué hora a qué hora trabajas para rellenar el calendario.')).toBeTruthy();

    const [desde, hasta] = selects();
    fireEvent.change(desde, { target: { value: '9' } });
    expect(screen.getByText('Los días y las horas en que trabajas')).toBeTruthy(); // aún falta la hora final
    fireEvent.change(hasta, { target: { value: '14' } });
    expect(screen.queryByText('Los días y las horas en que trabajas')).toBeNull();
  });

  it('un horario ya guardado se carga tal cual, y «Sin restricción» (0 h) no se convierte en «24 horas»', async () => {
    mocks.schedulesData = [{ day_of_week: 1, start_time: '08:00:00', end_time: '12:00:00' }];
    mocks.settingsData = { weeks_to_maintain: 8, min_notice_hours: 0 };
    render(<RecurringScheduleManager />);
    await screen.findByTitle('Lunes');
    await waitFor(() => expect(selects()[2].value).toBe('8'));
    const [desde, hasta, semanas, antelacion] = selects();
    expect(desde.value).toBe('8');
    expect(hasta.value).toBe('12');
    expect(semanas.value).toBe('8');
    expect(antelacion.value).toBe('0');
    expect(screen.queryByText('Te quedan cosas por configurar en tu horario')).toBeNull();
  });

  it('sin las reglas elegidas no se puede guardar: lo dice, marca los campos y no guarda ni abre la confirmación', async () => {
    let trigger: () => void = () => {};
    render(<RecurringScheduleManager registerExplicitSaveTrigger={(fn) => { trigger = fn; }} />);
    await screen.findByTitle('Lunes');
    act(() => trigger());
    expect(mocks.toastError).toHaveBeenCalledWith('Antes de guardar, elige las semanas de agenda y la antelación mínima.');
    expect(screen.queryByText('¿Confirmar nuevo horario fijo?')).toBeNull();
    expect(mocks.upserts).toHaveLength(0);
    const [, , semanas, antelacion] = selects();
    expect(semanas.getAttribute('aria-invalid')).toBe('true');
    expect(antelacion.getAttribute('aria-invalid')).toBe('true');
  });

  it('«Guardar y salir» (guardado directo) también se detiene sin las reglas', async () => {
    let save: () => Promise<boolean> = async () => true;
    render(<RecurringScheduleManager registerSaveHandler={(fn) => { save = fn; }} />);
    await screen.findByTitle('Lunes');
    expect(await save()).toBe(false);
    expect(mocks.upserts).toHaveLength(0);
  });

  it('con las reglas elegidas, guardar abre la confirmación y guarda lo ELEGIDO, no un valor por defecto', async () => {
    let trigger: () => void = () => {};
    let save: () => Promise<boolean> = async () => true;
    render(<RecurringScheduleManager registerExplicitSaveTrigger={(fn) => { trigger = fn; }} registerSaveHandler={(fn) => { save = fn; }} />);
    await screen.findByTitle('Lunes');
    const [, , semanas, antelacion] = selects();
    fireEvent.change(semanas, { target: { value: '12' } });
    fireEvent.change(antelacion, { target: { value: '48' } });
    trigger();
    expect(await screen.findByText('¿Confirmar nuevo horario fijo?')).toBeTruthy();
    expect(await save()).toBe(true);
    expect(mocks.upserts[0]).toMatchObject({ gardener_id: 'gardener-1', weeks_to_maintain: 12, min_notice_hours: 48 });
  });

  it('un empleado (hideMinNotice) que guarda SU horario: no se envía la antelación (no es suya)', async () => {
    let save: () => Promise<boolean> = async () => false;
    render(<RecurringScheduleManager hideMinNotice registerSaveHandler={(fn) => { save = fn; }} />);
    await screen.findByTitle('Lunes');
    fireEvent.change(selects()[2], { target: { value: '4' } }); // solo las semanas
    expect(await save()).toBe(true);
    expect(mocks.upserts[0]).toMatchObject({ gardener_id: 'gardener-1', weeks_to_maintain: 4 });
    expect(mocks.upserts[0]).not.toHaveProperty('min_notice_hours');
  });

  it('el dueño que prepara el horario de un empleado lee «trabaja», no «trabajas»', async () => {
    render(<RecurringScheduleManager hideMinNotice member={{ memberId: 'm1', userId: 'u2', name: 'Luis' }} />);
    await screen.findByTitle('Lunes');
    expect(screen.getByText('Quedan cosas por configurar en su horario')).toBeTruthy();
    expect(screen.getByText('Los días y las horas en que trabaja')).toBeTruthy();
    expect(screen.getByText(/Marca los días en que trabaja y elige/)).toBeTruthy();
  });

  it('en el horario de un empleado la antelación no cuenta (la decide su empresa): solo piden las semanas', async () => {
    let trigger: () => void = () => {};
    render(
      <RecurringScheduleManager
        hideMinNotice
        member={{ memberId: 'm1', userId: 'u2', name: 'Luis' }}
        registerExplicitSaveTrigger={(fn) => { trigger = fn; }}
      />,
    );
    await screen.findByTitle('Lunes');
    expect(screen.queryByText('Con cuánta antelación pueden reservarle')).toBeNull();
    expect(screen.queryByText('Con cuánta antelación pueden reservarte')).toBeNull();
    trigger();
    expect(mocks.toastError).toHaveBeenCalledWith('Antes de guardar, elige las semanas de agenda.');
  });
});
