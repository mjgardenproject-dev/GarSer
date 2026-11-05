// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ProviderSetupStatus } from '../../shared/providerSetup';

const hook = vi.hoisted(() => ({ status: null as ProviderSetupStatus | null }));
vi.mock('../../hooks/useProviderSetupStatus', () => ({
  useProviderSetupStatus: () => ({ status: hook.status, loading: false, error: null, refresh: vi.fn() }),
}));

import SetupGuideBanner from './SetupGuideBanner';

const base = (): ProviderSetupStatus => ({
  provider_id: 'p1',
  provider_kind: 'solo',
  suspended: false,
  window_days: 14,
  profile: { full_name: 'Ana', address: 'Marbella', max_distance: 25, has_coordinates: false, has_description: true, has_photo: true },
  services: [],
  schedule: { has_recurring: false, free_hours_14d: 0 },
  license: { status: null, active: false },
  team: null,
  push_enabled: true,
  fee_waiver_enabled: false,
});

const lawn = { id: 's1', name: 'Corte de césped', service_active: true, needs_license: false, workers: 1, workers_with_hours: 1, licensed_workers_with_hours: 1, visible: true, visible_chemical: true };

describe('SetupGuideBanner · «Paso X de N» (fallo 7.2)', () => {
  beforeEach(() => { hook.status = base(); });
  afterEach(cleanup);

  it('en una pantalla de un paso pendiente: en qué paso está y qué tiene que hacer, y cómo volver', () => {
    const onBack = vi.fn();
    render(<SetupGuideBanner stepId="coverage" onBack={onBack} />);
    expect(screen.getByText(/Primeros pasos · Paso 2 de 3/)).toBeTruthy();
    expect(screen.getByText('Zona de trabajo')).toBeTruthy();
    expect(screen.getByText('Pulsa «Confirmar esta dirección».')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Volver a los primeros pasos' }));
    expect(onBack).toHaveBeenCalled();
  });

  it('el paso de servicios es el 1 y lleva sus tres acciones', () => {
    render(<SetupGuideBanner stepId="services" onBack={vi.fn()} />);
    expect(screen.getByText(/Paso 1 de 3/)).toBeTruthy();
    expect(screen.getByText('Pon tus precios y pulsa «Guardar».')).toBeTruthy();
  });

  it('al terminar el paso: «¡Hecho!» y un botón «Siguiente paso» hacia lo que toca ahora', () => {
    hook.status = { ...base(), services: [lawn] }; // servicios hecho; falta zona y horario
    const onBack = vi.fn();
    render(<SetupGuideBanner stepId="services" onBack={onBack} />);
    expect(screen.getByText('¡Hecho! Servicios y precios está completo.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Siguiente paso: Zona de trabajo/ }));
    expect(onBack).toHaveBeenCalled();
  });

  it('con todo lo obligatorio hecho no sale (la franja es solo para los primeros pasos)', () => {
    hook.status = {
      ...base(),
      services: [lawn],
      profile: { ...base().profile, has_coordinates: true },
      schedule: { has_recurring: true, free_hours_14d: 20 },
    };
    const { container } = render(<SetupGuideBanner stepId="services" onBack={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });

  it('al completar el ÚLTIMO paso obligatorio en esta pantalla, celebra y ofrece volver al panel (no desaparece sin más)', () => {
    hook.status = { ...base(), services: [lawn], profile: { ...base().profile, has_coordinates: true } }; // falta solo el horario
    const onBack = vi.fn();
    const { rerender } = render(<SetupGuideBanner stepId="schedule" onBack={onBack} />);
    expect(screen.getByText(/Primeros pasos · Paso 3 de 3/)).toBeTruthy();

    hook.status = { ...hook.status, schedule: { has_recurring: true, free_hours_14d: 20 } } as ProviderSetupStatus; // lo guarda
    rerender(<SetupGuideBanner stepId="schedule" onBack={onBack} />);
    expect(screen.getByText('¡Todo listo! Ya has completado los pasos obligatorios.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Volver al panel/ }));
    expect(onBack).toHaveBeenCalled();
  });

  it('en la empresa, el horario es el del equipo: no se guía desde la pantalla de horario', () => {
    hook.status = { ...base(), provider_kind: 'company' };
    const { container } = render(<SetupGuideBanner stepId="schedule" onBack={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });

  it('sin estado todavía, o con la cuenta suspendida: nada', () => {
    hook.status = null;
    const { container, rerender } = render(<SetupGuideBanner stepId="services" onBack={vi.fn()} />);
    expect(container.innerHTML).toBe('');
    hook.status = { ...base(), suspended: true };
    rerender(<SetupGuideBanner stepId="services" onBack={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });
});
