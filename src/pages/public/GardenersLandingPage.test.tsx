// @vitest-environment jsdom
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { gardenersContent, gardenersFaqs } from '../../config/publicSiteContent';

const navigateMock = vi.fn();
const seoHeadMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock('../../components/common/SeoHead', () => ({
  default: (props: unknown) => {
    seoHeadMock(props);
    return null;
  },
}));

import GardenersLandingPage from './GardenersLandingPage';

const renderPage = () =>
  render(
    <MemoryRouter>
      <GardenersLandingPage />
    </MemoryRouter>,
  );

describe('GardenersLandingPage', () => {
  afterEach(() => {
    cleanup();
    navigateMock.mockClear();
    seoHeadMock.mockClear();
  });

  it('«Crear mi cuenta gratis» lleva al registro con el rol de jardinero', async () => {
    const user = userEvent.setup();
    renderPage();

    const ctas = screen.getAllByRole('button', { name: 'Crear mi cuenta gratis' });
    // Hero, tras «quién paga qué» y cierre: los tres llevan al mismo alta.
    expect(ctas).toHaveLength(3);
    for (const cta of ctas) await user.click(cta);

    expect(navigateMock).toHaveBeenCalledTimes(3);
    for (const call of navigateMock.mock.calls) {
      expect(call).toEqual(['/auth', { state: { initialMode: 'signup', preselectedRole: 'gardener' } }]);
    }
  });

  it('«Dar de alta mi empresa» lleva al registro con el rol de empresa', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Dar de alta mi empresa' }));

    expect(navigateMock).toHaveBeenCalledWith('/auth', {
      state: { initialMode: 'signup', preselectedRole: 'company' },
    });
  });

  it('el enlace para empresas baja a su sección', () => {
    renderPage();

    const link = screen.getByRole('link', { name: gardenersContent.hero.companiesLinkLabel });
    expect(link.getAttribute('href')).toBe('#empresas');
    expect(document.getElementById('empresas')).not.toBeNull();
  });

  it('pinta las 5 capturas de la app como imágenes con texto alternativo, sin nada pulsable dentro', () => {
    renderPage();

    // Dentro de <main>: el logo de la cabecera también es una imagen.
    const mockups = within(screen.getByRole('main')).getAllByRole('img');
    expect(mockups).toHaveLength(5);
    for (const mockup of mockups) {
      expect(mockup.getAttribute('aria-label')).toMatch(/de ejemplo/);
      expect(mockup.querySelectorAll('button, a, input, [tabindex]')).toHaveLength(0);
    }
  });

  it('muestra las 7 preguntas frecuentes y las publica en el JSON-LD', () => {
    renderPage();

    const faqSection = screen.getByRole('heading', { name: 'Preguntas frecuentes' }).closest('section') as HTMLElement;
    expect(gardenersFaqs).toHaveLength(7);
    for (const faq of gardenersFaqs) {
      expect(within(faqSection).getByText(faq.question)).toBeTruthy();
    }

    const { jsonLd } = seoHeadMock.mock.calls[seoHeadMock.mock.calls.length - 1]?.[0] as { jsonLd: Array<{ '@type': string; mainEntity?: unknown[] }> };
    const faqPage = jsonLd.find((entry) => entry['@type'] === 'FAQPage');
    expect(faqPage?.mainEntity).toHaveLength(7);
  });

  it('no vuelve a prometer lo que la app no hace (cobro online, 12,5 %, «portal»)', () => {
    const visibleCopy = JSON.stringify([gardenersContent, gardenersFaqs]).toLowerCase();

    expect(visibleCopy).not.toContain('12,5');
    expect(visibleCopy).not.toContain('cobras por la plataforma');
    expect(visibleCopy).not.toContain('se gestiona online');
    expect(visibleCopy).not.toContain('portal');
  });
});
