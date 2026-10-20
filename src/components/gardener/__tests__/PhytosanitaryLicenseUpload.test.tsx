// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PhytoLicenseSummary } from '../../../shared/phytoLicense';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  upload: vi.fn(async () => ({ error: null as null | { message: string } })),
  prepare: vi.fn(async (files: File[]) => ({ file: new File(['x'], 'carnet.jpg', { type: 'image/jpeg' }), ext: files[0]?.type === 'application/pdf' ? 'pdf' : 'jpg' })),
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'gardener-1' } }) }));
vi.mock('react-hot-toast', () => ({ default: mocks.toast }));
vi.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc: mocks.rpc,
    storage: { from: () => ({ upload: mocks.upload }) },
  },
}));
// El canvas no existe en jsdom: preparar el archivo se simula; las comprobaciones son las reales.
vi.mock('../../../utils/licenseFile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../utils/licenseFile')>()),
  prepareLicenseUpload: mocks.prepare,
  sha256Hex: async () => 'a'.repeat(64),
}));

import PhytosanitaryLicenseUpload from '../PhytosanitaryLicenseUpload';

const ownLicense = (summary: PhytoLicenseSummary | null) =>
  mocks.rpc.mockImplementation(async (fn: string) => {
    if (fn === 'my_phyto_license') return { data: summary ?? { status: null, active: false, renewal: null }, error: null };
    if (fn === 'submit_phyto_license') return { data: { licenseId: 'lic-1', status: 'pending' }, error: null };
    return { data: null, error: null };
  });

const chooseFile = (file: File) => {
  const input = document.querySelector('input[type=file]:not([capture])') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
};

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

describe('PhytosanitaryLicenseUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
  });
  afterEach(() => cleanup());

  it('sin carnet: se puede hacer foto o elegir archivo', async () => {
    ownLicense(null);
    render(<PhytosanitaryLicenseUpload />);
    expect(await screen.findByRole('button', { name: /Hacer foto/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Elegir archivo/ })).toBeTruthy();
    expect(document.querySelector('input[capture=environment]')).toBeTruthy();
  });

  it('rechaza un PDF de más de 10 MB y un archivo que no es foto ni PDF', async () => {
    ownLicense(null);
    render(<PhytosanitaryLicenseUpload />);
    await screen.findByRole('button', { name: /Elegir archivo/ });
    chooseFile(new File(['x'.repeat(11 * 1024 * 1024)], 'grande.pdf', { type: 'application/pdf' }));
    expect(mocks.toast.error).toHaveBeenCalledWith('El PDF pesa más de 10 MB. Escanéalo con menos calidad o haz una foto.');
    chooseFile(new File(['#!/bin/sh'], 'script.sh', { type: 'text/plain' }));
    expect(mocks.toast.error).toHaveBeenCalledWith('Ese archivo no vale: sube una foto (JPG o PNG) o un PDF.');
    expect(screen.queryByText('grande.pdf')).toBeNull();
  });

  it('no se envía sin la declaración responsable; con ella, sube a su carpeta y lo envía a revisión', async () => {
    ownLicense(null);
    const onSubmitted = vi.fn();
    render(<PhytosanitaryLicenseUpload onSubmitted={onSubmitted} />);
    await screen.findByRole('button', { name: /Elegir archivo/ });
    chooseFile(new File(['%PDF'], 'carnet.pdf', { type: 'application/pdf' }));
    expect(await screen.findByText('carnet.pdf')).toBeTruthy();
    const send = screen.getByRole('button', { name: /Enviar a revisión/ }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/Número de carnet/), { target: { value: ' ES-123 ' } });
    fireEvent.click(screen.getByRole('checkbox'));
    expect(send.disabled).toBe(false);
    fireEvent.click(send);

    await waitFor(() => expect(onSubmitted).toHaveBeenCalled());
    const [path] = mocks.upload.mock.calls[0] as unknown as [string];
    expect(path).toMatch(/^gardener-1\/[0-9a-f]{32}\.pdf$/);
    expect(mocks.rpc).toHaveBeenCalledWith('submit_phyto_license', {
      p_document_path: path,
      p_declaration: true,
      p_license_number: 'ES-123',
      p_document_hash: 'a'.repeat(64),
      p_member_id: undefined,
    });
    expect(mocks.toast.success).toHaveBeenCalledWith('Carnet enviado. Te avisaremos cuando esté revisado.');
  });

  it('la empresa lo envía por alguien de su equipo: su carpeta, su declaración y el miembro', async () => {
    mocks.rpc.mockResolvedValue({ data: { licenseId: 'lic-2' }, error: null });
    render(
      <PhytosanitaryLicenseUpload
        forMember={{ memberId: 'member-9', userId: 'employee-9', name: 'Ana López' }}
        summary={{ status: 'rejected', active: false, rejection_reason: 'No se lee', renewal: null }}
      />,
    );
    expect(screen.getByText('Motivo: No se lee. Puede subirlo de nuevo, o súbelo tú.')).toBeTruthy();
    chooseFile(new File(['img'], 'foto.jpg', { type: 'image/jpeg' }));
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByText(/Declaro que es el carnet de Ana López, que está en vigor y que tengo su permiso/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Enviar a revisión/ }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('submit_phyto_license', expect.objectContaining({ p_member_id: 'member-9' })));
    expect((mocks.upload.mock.calls[0] as unknown as [string])[0]).toMatch(/^employee-9\/[0-9a-f]{32}\.jpg$/);
    // No pide el suyo: el estado llega por props.
    expect(mocks.rpc).not.toHaveBeenCalledWith('my_phyto_license');
  });

  it('si el servidor lo rechaza, enseña su mensaje', async () => {
    mocks.rpc.mockImplementation(async (fn: string) => (fn === 'my_phyto_license'
      ? { data: { status: null, active: false }, error: null }
      : { data: null, error: { message: 'Se han enviado demasiados carnets hoy. Vuelve a intentarlo mañana.' } }));
    render(<PhytosanitaryLicenseUpload />);
    await screen.findByRole('button', { name: /Elegir archivo/ });
    chooseFile(new File(['%PDF'], 'carnet.pdf', { type: 'application/pdf' }));
    fireEvent.click(await screen.findByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /Enviar a revisión/ }));
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith('Se han enviado demasiados carnets hoy. Vuelve a intentarlo mañana.'));
  });

  it('aprobado: dice hasta cuándo vale y deja subir el renovado solo si lo pide', async () => {
    ownLicense({ status: 'approved', active: true, expires_at: inDays(400), renewal: null });
    const onStatusChange = vi.fn();
    render(<PhytosanitaryLicenseUpload onStatusChange={onStatusChange} />);
    expect(await screen.findByText('Carnet aprobado')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Enviar a revisión/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Has renovado tu carnet/ }));
    expect(screen.getByRole('button', { name: /Enviar a revisión/ })).toBeTruthy();
    expect(onStatusChange).toHaveBeenCalledWith('approved');
  });

  it('caduca pronto: lo avisa y el botón de renovar va destacado', async () => {
    ownLicense({ status: 'approved', active: true, expires_at: inDays(20), renewal: null });
    render(<PhytosanitaryLicenseUpload />);
    expect(await screen.findByText(/Caduca en (19|20) días/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Subir el carnet renovado/ })).toBeTruthy();
  });

  it('en revisión: no deja enviar otro', async () => {
    ownLicense({ status: 'pending', active: false, submitted_at: new Date().toISOString(), renewal: null });
    render(<PhytosanitaryLicenseUpload />);
    expect(await screen.findByText('En revisión')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Hacer foto/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Has renovado/ })).toBeNull();
  });
});
