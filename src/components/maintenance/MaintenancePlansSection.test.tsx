// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/maintenancePlans', () => ({
  cancelMaintenancePlan: vi.fn(),
  FREQUENCY_LABEL: { weekly: 'Cada semana', biweekly: 'Cada 2 semanas', monthly: 'Cada mes' },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import MaintenancePlansSection from './MaintenancePlansSection';

const plan = {
  id: 'p1', status: 'active', frequency: 'weekly', total_price: 50, role: 'client', provider_name: 'Antonio',
  services: 'Corte de césped', next_visit_date: '2026-12-01', start_hour: 9, visits: [],
  proposal: { date: '2026-12-01', start_hour: 9, expires_at: '2026-11-29T10:00:00Z' },
};

describe('MaintenancePlansSection (QA-129)', () => {
  afterEach(() => cleanup());

  it('antes de «Confirmar la visita» dice que envía la solicitud y que los gastos se retienen', () => {
    render(<MaintenancePlansSection plans={[plan as never]} onPayVisit={vi.fn()} onChanged={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Confirmar la visita/ })).toBeTruthy();
    expect(document.body.textContent).toContain('Confirmar envía la solicitud al profesional');
    expect(document.body.textContent).toContain('solo se cobran si la acepta');
  });

  it('el profesional no ve ese aviso', () => {
    render(<MaintenancePlansSection plans={[{ ...plan, role: 'provider' } as never]} onChanged={vi.fn()} />);
    expect(document.body.textContent).not.toContain('Confirmar envía la solicitud');
  });
});
