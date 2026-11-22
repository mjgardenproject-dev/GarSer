// @vitest-environment jsdom
import { MemoryRouter } from 'react-router-dom';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import PublicFooter from './PublicFooter';
import { CookieConsentProvider } from '../../contexts/CookieConsentContext';

describe('PublicFooter', () => {
  afterEach(cleanup);

  it('tiene «Contacto y ayuda» con WhatsApp e info@garser.es', () => {
    render(
      <MemoryRouter>
        <PublicFooter />
      </MemoryRouter>,
    );

    const contact = screen.getByRole('region', { name: 'Contacto y ayuda' });
    expect(contact.id).toBe('contacto');

    const whatsapp = within(contact).getByRole('link', { name: /WhatsApp \+34 694 26 86 53/ });
    expect(whatsapp.getAttribute('href')).toBe('https://wa.me/34694268653');
    expect(whatsapp.getAttribute('target')).toBe('_blank');

    const email = within(contact).getByRole('link', { name: 'info@garser.es' });
    expect(email.getAttribute('href')).toBe('mailto:info@garser.es');
  });

  it('QA-008 · el texto del pie es para el público: sin lenguaje de diseño interno («clientes reales», «pantallas técnicas»)', () => {
    const { container } = render(<MemoryRouter><PublicFooter /></MemoryRouter>);
    expect(container.textContent).not.toMatch(/clientes reales|pantallas técnicas|zona de cliente comparten/i);
    expect(screen.getByRole('heading', { name: /Jardinería profesional/ })).toBeTruthy();
  });

  it('QA-094 · en la página para jardineros el pie habla a profesionales, no a clientes', () => {
    const { container } = render(<MemoryRouter><PublicFooter audience="professionals" /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: /Haz crecer tu negocio de jardinería/ })).toBeTruthy();
    expect(container.textContent).not.toMatch(/Reserva servicios de jardinería|clientes reales/i);
    // Los enlaces útiles siguen.
    expect(screen.getByRole('link', { name: 'Privacidad' })).toBeTruthy();
  });

  it('enlaza la Política de privacidad y los Términos', () => {
    render(
      <MemoryRouter>
        <PublicFooter />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Privacidad' }).getAttribute('href')).toBe('/privacidad');
    expect(screen.getByRole('link', { name: 'Términos y condiciones' }).getAttribute('href')).toBe('/terminos');
    expect(screen.getByRole('link', { name: 'Cookies' }).getAttribute('href')).toBe('/cookies');
  });

  it('ya no muestra la «Cobertura orientativa» (GarSer aún no tiene esa cobertura)', () => {
    render(
      <MemoryRouter>
        <PublicFooter />
      </MemoryRouter>,
    );

    expect(screen.queryByText('Cobertura orientativa')).toBeNull();
    expect(screen.queryByText('Estepona')).toBeNull();
  });

  it('QA-007 · el pie lleva «Configurar cookies» siempre a mano', async () => {
    vi.stubEnv('VITE_META_PIXEL_ID', '2034090553963036');
    window.localStorage.setItem('garser.cookie-consent.v1', JSON.stringify({ advertising: true, decidedAt: new Date().toISOString() }));
    render(
      <MemoryRouter>
        <CookieConsentProvider><PublicFooter /></CookieConsentProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('button', { name: 'Configurar cookies' })).toBeTruthy();
    vi.unstubAllEnvs();
    window.localStorage.clear();
  });
});
