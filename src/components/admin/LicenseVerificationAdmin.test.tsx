// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AdminLicenseRow } from './licenseReview';

const row: AdminLicenseRow = {
  id: 'lic-1', holder_id: 'u-1', created_at: '2026-10-20T10:00:00Z', license_number: 'ES-1', document_url: 'u-1/abc.jpg',
  document_hash: null, holder_name: 'Pepe Ruiz', email: 'pepe@correo.es', phone: '600000000', holder_kind: 'employee',
  company_name: 'Jardines Sol', submitted_by_company: true, current_expires_at: '2027-01-10T00:00:00Z', previous_rejections: 1,
};

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: mocks.rpc,
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'https://signed/doc.jpg' }, error: null }) }) },
  },
}));
vi.mock('react-hot-toast', () => ({ default: mocks.toast }));

import LicenseVerificationAdmin from './LicenseVerificationAdmin';

describe('LicenseVerificationAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rpc.mockImplementation(async (fn: string) => (fn === 'admin_phyto_license_queue' ? { data: [row], error: null } : { data: {}, error: null }));
  });
  afterEach(() => cleanup());

  it('dice de quién es, si es una renovación, si lo envió la empresa y si se rechazó antes', async () => {
    render(<LicenseVerificationAdmin />);
    expect(await screen.findByText('Pepe Ruiz')).toBeTruthy();
    expect(screen.getByText('Empleado de Jardines Sol')).toBeTruthy();
    expect(screen.getByText(/Renovación · el actual vale hasta el/)).toBeTruthy();
    expect(screen.getByText('Lo envió su empresa')).toBeTruthy();
    expect(screen.getByText('Rechazado 1 vez antes')).toBeTruthy();
  });

  it('rechazar pide el motivo y lo envía', async () => {
    render(<LicenseVerificationAdmin />);
    fireEvent.click(await screen.findByRole('button', { name: /Revisar/ }));
    const reject = await screen.findByRole('button', { name: /Rechazar/ });
    expect((reject as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Falta la otra cara del carnet.' }));
    expect((reject as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(reject);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('review_gardener_license', {
      p_license_id: 'lic-1', p_status: 'rejected', p_expires_at: undefined, p_reason: 'Falta la otra cara del carnet.',
    }));
  });

  it('aprobar pide la fecha de caducidad', async () => {
    render(<LicenseVerificationAdmin />);
    fireEvent.click(await screen.findByRole('button', { name: /Revisar/ }));
    const approve = await screen.findByRole('button', { name: /Aprobar/ });
    await waitFor(() => expect(screen.getByAltText('Carnet fitosanitario enviado')).toBeTruthy());
    expect((approve as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/fecha de caducidad/), { target: { value: '2031-12-31' } });
    fireEvent.click(approve);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('review_gardener_license', expect.objectContaining({
      p_license_id: 'lic-1', p_status: 'approved', p_reason: undefined,
    })));
  });
});
