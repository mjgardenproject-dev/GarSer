// @vitest-environment jsdom
import { MemoryRouter } from 'react-router-dom';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import PublicFooter from './PublicFooter';

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

  it('enlaza la Política de privacidad y los Términos', () => {
    render(
      <MemoryRouter>
        <PublicFooter />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Privacidad' }).getAttribute('href')).toBe('/privacidad');
    expect(screen.getByRole('link', { name: 'Términos y condiciones' }).getAttribute('href')).toBe('/terminos');
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
});
