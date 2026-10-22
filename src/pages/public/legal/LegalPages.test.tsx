// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { missingLegalFields, type LegalInfo } from '../../../config/legal';

vi.mock('../../../hooks/useAppSettings', () => ({ useAppSettings: () => ({ settings: { contactEmail: 'info@garser.es', contactPhone: '' } }) }));

import PrivacyPage from './PrivacyPage';
import TermsPage from './TermsPage';

const renderPage = (page: React.ReactElement) => render(<MemoryRouter>{page}</MemoryRouter>);

describe('páginas legales', () => {
  afterEach(() => cleanup());

  it('privacidad: cuenta lo que hace la web, incluido Google, y los derechos ante la AEPD', () => {
    renderPage(<PrivacyPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Política de privacidad' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '7. Inicio de sesión con Google' })).toBeTruthy();
    expect(screen.getByText(/Google nos envía tu nombre, tu correo, tu foto de perfil/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'www.aepd.es' }).getAttribute('href')).toBe('https://www.aepd.es');
    expect(screen.getByText(/No usamos cookies de publicidad ni de analítica/)).toBeTruthy();
  });

  it('términos: los gastos de gestión y la regla de las 24 horas, como hace la app', () => {
    renderPage(<TermsPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Términos y condiciones' })).toBeTruthy();
    expect(screen.getByText(/solo se cobran cuando el profesional la acepta/)).toBeTruthy();
    expect(screen.getByText(/con más de 24 horas/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Política de privacidad' }).getAttribute('href')).toBe('/privacidad');
  });

  it('con los datos del titular rellenos, ya no sale ningún hueco por completar', () => {
    renderPage(<PrivacyPage />);
    expect(screen.queryByText(/\[Completar:/)).toBeNull();
  });

  it('missingLegalFields detecta los huecos de unos datos incompletos', () => {
    const complete: LegalInfo = {
      ownerName: 'GarSer SL', taxId: 'B00000000', address: 'Calle 1, Marbella', registry: '', privacyEmail: 'a@b.es',
      contactEmail: 'a@b.es', website: 'https://garser.es', updatedAt: 'hoy',
    };
    expect(missingLegalFields(complete)).toEqual([]);
    expect(missingLegalFields({ ...complete, taxId: ' ' })).toEqual(['taxId']);
    expect(missingLegalFields({ ...complete, ownerName: '' })).toEqual(['ownerName']);
  });
});
