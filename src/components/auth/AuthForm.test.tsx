// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
  lastGoogleProps: null as null | { context: string; signupRole?: string; onSignedIn: (r: { role: string | null; isNew: boolean; firstName: string }) => void },
}));

vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ signIn: vi.fn(), signUp: vi.fn() }) }));
vi.mock('react-hot-toast', () => ({ default: mocks.toast }));
vi.mock('../../lib/supabase', () => ({ supabase: { auth: {} } }));
vi.mock('./GoogleSignInButton', () => ({
  default: (props: { context: string; signupRole?: string; onSignedIn: (r: { role: string | null; isNew: boolean; firstName: string }) => void }) => {
    mocks.lastGoogleProps = props;
    return <button type="button">Google ({props.context}{props.signupRole ? `, ${props.signupRole}` : ''})</button>;
  },
}));

import AuthForm from './AuthForm';

const renderAuth = (url = '/auth') => render(
  <MemoryRouter initialEntries={[url]}>
    <Routes>
      <Route path="/auth" element={<AuthForm />} />
      <Route path="/dashboard" element={<p>Panel del cliente</p>} />
    </Routes>
  </MemoryRouter>,
);

describe('AuthForm · Continuar con Google', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'client-123');
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it('al entrar: Google arriba, «o con tu correo» y la nota legal', () => {
    renderAuth();
    expect(screen.getByRole('button', { name: 'Google (signin)' })).toBeTruthy();
    expect(screen.getByRole('separator', { name: 'o con tu correo' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Términos y condiciones' }).getAttribute('href')).toBe('/terminos');
    expect(screen.getByRole('link', { name: 'Política de privacidad' }).getAttribute('href')).toBe('/privacidad');
  });

  it('al registrarse: Google vale para los tres tipos de cuenta, con el rol elegido', () => {
    renderAuth('/auth?mode=signup');
    expect(screen.getByRole('button', { name: 'Google (signup)' })).toBeTruthy();
    expect(mocks.lastGoogleProps!.signupRole).toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: /Jardinero/ }));
    expect(screen.getByRole('button', { name: 'Google (signup, gardener)' })).toBeTruthy();
    expect(screen.queryByText(/se crean con tu correo/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Empresa/ }));
    expect(screen.getByRole('button', { name: 'Google (signup, company)' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Cliente/ }));
    expect(screen.getByRole('button', { name: 'Google (signup)' })).toBeTruthy();
    expect(mocks.lastGoogleProps!.signupRole).toBeUndefined();
  });

  it('tras entrar con Google, saluda y lleva a su panel', async () => {
    renderAuth();
    mocks.lastGoogleProps!.onSignedIn({ role: 'client', isNew: true, firstName: 'Ana' });
    expect(mocks.toast.success).toHaveBeenCalledWith('¡Bienvenido a GarSer, Ana!');
    expect(await screen.findByText('Panel del cliente')).toBeTruthy();
  });

  it('sin Client ID de Google, la pantalla es la de siempre', () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '');
    renderAuth('/auth?mode=signup');
    expect(screen.queryByRole('button', { name: /Google/ })).toBeNull();
    expect(screen.queryByText(/se crean con tu correo/)).toBeNull();
  });
});
