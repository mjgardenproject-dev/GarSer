// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  invoke: vi.fn(),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

vi.mock('../../lib/supabase', () => ({ supabase: { rpc: mocks.rpc, functions: { invoke: mocks.invoke } } }));
vi.mock('react-hot-toast', () => ({ default: mocks.toast }));

import InviteMemberCard, { LIABILITY_DECLARATION } from './InviteMemberCard';

const INVITATION = { invitation_id: 'inv-1', token: 'tok-123', email: 'ana@correo.com' };
const type = (email: string) => fireEvent.change(screen.getByLabelText('Correo de la persona'), { target: { value: email } });

describe('InviteMemberCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rpc.mockResolvedValue({ data: INVITATION, error: null });
    mocks.invoke.mockResolvedValue({ error: null });
  });
  afterEach(cleanup);

  describe('en el panel de equipo (tarjeta de siempre)', () => {
    it('invita con solo el correo (la empresa ya existe: no hay declaración que pedir) y manda el correo de invitación', async () => {
      const onInvited = vi.fn();
      render(<InviteMemberCard onInvited={onInvited} />);
      expect(screen.getByRole('heading', { name: /Invitar a alguien a tu equipo/ })).toBeTruthy();
      expect(screen.queryByText(LIABILITY_DECLARATION)).toBeNull();
      type('ana@correo.com');
      fireEvent.click(screen.getByRole('button', { name: 'Invitar' }));
      await waitFor(() => expect(onInvited).toHaveBeenCalled());
      expect(mocks.rpc).toHaveBeenCalledWith('create_company_invitation', { p_email: 'ana@correo.com' });
      expect(mocks.invoke).toHaveBeenCalledWith('send-email-notification', {
        body: { type: 'company_invitation', invitationId: 'inv-1', token: 'tok-123' },
      });
      expect(await screen.findByText('Le hemos enviado la invitación a ana@correo.com')).toBeTruthy();
      expect((screen.getByLabelText('Enlace de invitación') as HTMLInputElement).value).toMatch(/\/invitacion\?token=tok-123$/);
    });

    it('si el correo no sale, lo dice y deja el enlace para mandarlo a mano', async () => {
      mocks.invoke.mockResolvedValue({ error: { message: 'caído' } });
      render(<InviteMemberCard onInvited={vi.fn()} />);
      type('ana@correo.com');
      fireEvent.click(screen.getByRole('button', { name: 'Invitar' }));
      expect(await screen.findByText('Invitación creada para ana@correo.com')).toBeTruthy();
      expect(screen.getByText(/No hemos podido enviar el correo/)).toBeTruthy();
      expect(mocks.invoke).toHaveBeenCalledTimes(2); // un reintento
    });

    it('si el servidor lo rechaza, enseña su motivo y no dice que se envió', async () => {
      mocks.rpc.mockResolvedValue({ data: null, error: { message: 'Esa persona ya forma parte de tu equipo.' } });
      const onInvited = vi.fn();
      render(<InviteMemberCard onInvited={onInvited} />);
      type('ana@correo.com');
      fireEvent.click(screen.getByRole('button', { name: 'Invitar' }));
      await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith('Esa persona ya forma parte de tu equipo.'));
      expect(onInvited).not.toHaveBeenCalled();
      expect(screen.queryByLabelText('Enlace de invitación')).toBeNull();
    });
  });

  describe('la primera invitación de un profesional individual (D35)', () => {
    it('pide la frase del seguro y no deja enviar hasta marcarla', () => {
      render(<InviteMemberCard bare requireLiability onInvited={vi.fn()} />);
      type('ana@correo.com');
      const send = screen.getByRole('button', { name: 'Enviar invitación' }) as HTMLButtonElement;
      expect(send.disabled).toBe(true);
      fireEvent.click(screen.getByLabelText(LIABILITY_DECLARATION));
      expect(send.disabled).toBe(false);
    });

    it('manda la declaración al servidor y, tras enviar, avisa de que su cuenta no cambia hasta que acepte', async () => {
      const onInvited = vi.fn();
      render(<InviteMemberCard bare requireLiability onInvited={onInvited} sentNote="Mientras no acepte, tu cuenta no cambia." />);
      type('ana@correo.com');
      fireEvent.click(screen.getByLabelText(LIABILITY_DECLARATION));
      fireEvent.click(screen.getByRole('button', { name: 'Enviar invitación' }));
      await waitFor(() => expect(onInvited).toHaveBeenCalled());
      expect(mocks.rpc).toHaveBeenCalledWith('create_company_invitation', { p_email: 'ana@correo.com', p_liability_declared: true });
      expect(await screen.findByText('Mientras no acepte, tu cuenta no cambia.')).toBeTruthy();
    });

    it('sin la tarjeta ni el título de siempre: la hoja pone los suyos', () => {
      render(<InviteMemberCard bare requireLiability onInvited={vi.fn()} />);
      expect(screen.queryByRole('heading')).toBeNull();
    });

    it('un envío sin marcar el seguro no llega a llamar al servidor (ni con Enter)', () => {
      render(<InviteMemberCard bare requireLiability onInvited={vi.fn()} />);
      type('ana@correo.com');
      fireEvent.submit(screen.getByLabelText('Correo de la persona').closest('form')!);
      expect(mocks.rpc).not.toHaveBeenCalled();
    });
  });
});
