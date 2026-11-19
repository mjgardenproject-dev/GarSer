// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  role: 'employee' as string | null,
  roleLoading: false,
  membership: { company_name: 'Jardines Sol', services: ['Corte de césped'] } as Record<string, unknown> | null,
}));

vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('../../contexts/AccountContext', () => ({ useAccount: () => ({ role: mocks.role, loading: mocks.roleLoading }) }));
vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: async () => ({ data: mocks.membership, error: null }),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { full_name: 'Laura Gómez', phone: '' } }) }) }) }),
  },
}));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn() } }));
vi.mock('../../components/gardener/PhytosanitaryLicenseUpload', () => ({ default: () => <div /> }));
vi.mock('../../components/account/PushNotificationsCard', () => ({ default: () => <div /> }));

import EmployeeWelcomePage from './EmployeeWelcomePage';

const open = () =>
  render(
    <MemoryRouter initialEntries={['/mi-trabajo/bienvenida']}>
      <Routes>
        <Route path="/mi-trabajo/bienvenida" element={<EmployeeWelcomePage />} />
        <Route path="/dashboard" element={<div>panel de inicio</div>} />
      </Routes>
    </MemoryRouter>,
  );

describe('Bienvenida del empleado · QA-003 (solo para quien tiene empresa)', () => {
  beforeEach(() => { mocks.role = 'employee'; mocks.roleLoading = false; mocks.membership = { company_name: 'Jardines Sol', services: ['Corte de césped'] }; });
  afterEach(() => cleanup());

  it('un empleado con empresa la ve, con el nombre de su empresa', async () => {
    open();
    expect(await screen.findByText(/Jardines Sol te ha añadido a su equipo/)).toBeTruthy();
  });

  it('un cliente, un profesional o un admin van a su inicio, no ven «Tu empresa te ha añadido»', async () => {
    for (const role of ['client', 'gardener', 'admin']) {
      mocks.role = role;
      const view = open();
      expect(await screen.findByText('panel de inicio')).toBeTruthy();
      expect(screen.queryByText(/te ha añadido a su equipo/)).toBeNull();
      view.unmount();
    }
  });

  it('un empleado que ya no tiene empresa (membresía vacía) tampoco la ve', async () => {
    mocks.membership = null;
    open();
    await waitFor(() => expect(screen.getByText('panel de inicio')).toBeTruthy());
    expect(screen.queryByText(/te ha añadido a su equipo/)).toBeNull();
  });
});
