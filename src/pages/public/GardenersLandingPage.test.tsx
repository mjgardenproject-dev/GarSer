// @vitest-environment jsdom
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { gardenersFaqs } from '../../config/billingCopy';
import { gardenersContent, generalHomeContent, pageSeo } from '../../config/publicSiteContent';
import type { PublicBillingTerms } from '../../shared/billingTerms';

const billing = vi.hoisted(() => ({ terms: null as PublicBillingTerms | null }));
vi.mock('../../hooks/usePublicBillingTerms', () => ({ usePublicBillingTerms: () => billing.terms }));

const TERMS: PublicBillingTerms = {
  version: 1, garserFirst: 'standard', linkFirst: 'none', garserRepeat: 'reduced', linkRepeat: 'none', maintenanceVisit: 'reduced',
};

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
    billing.terms = null;
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

  it('el botón de la sección de equipos lleva al mismo registro de profesional: no hay un tipo «empresa» (D31)', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: gardenersContent.companies.ctaLabel }));

    expect(navigateMock).toHaveBeenCalledWith('/auth', {
      state: { initialMode: 'signup', preselectedRole: 'gardener' },
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
    const faqs = gardenersFaqs(null);
    expect(faqs).toHaveLength(7);
    for (const faq of faqs) {
      expect(within(faqSection).getByText(faq.question)).toBeTruthy();
    }

    const { jsonLd } = seoHeadMock.mock.calls[seoHeadMock.mock.calls.length - 1]?.[0] as { jsonLd: Array<{ '@type': string; mainEntity?: unknown[] }> };
    const faqPage = jsonLd.find((entry) => entry['@type'] === 'FAQPage');
    expect(faqPage?.mainEntity).toHaveLength(7);
  });

  it('no vuelve a prometer lo que la app no hace (cobro online, 12,5 %, «portal»)', () => {
    const visibleCopy = JSON.stringify([gardenersContent, gardenersFaqs(null), gardenersFaqs(TERMS)]).toLowerCase();

    expect(visibleCopy).not.toContain('12,5');
    expect(visibleCopy).not.toContain('cobras por la plataforma');
    expect(visibleCopy).not.toContain('se gestiona online');
    expect(visibleCopy).not.toContain('portal');
  });

  describe('lo que dice de los gastos de gestión sale de los ajustes', () => {
    it('sin saberlos (cargando o error) no promete nada: textos neutros', () => {
      billing.terms = null;
      renderPage();
      const main = screen.getByRole('main').textContent ?? '';
      expect(main).toContain('Tus clientes reservan directamente contigo');
      expect(main).toContain('Para ti es gratis. Los gastos de gestión, los paga el cliente.');
      expect(main).not.toMatch(/sin gastos de gestión|no pagan gastos|deja de pagar|sin comisión/i);
      expect(document.getElementById('quien-paga')).not.toBeNull();
    });

    it('con los ajustes de fábrica: los clientes del enlace no pagan, salvo en planes; los de vuelta de GarSer pagan menos', () => {
      billing.terms = TERMS;
      renderPage();
      const main = screen.getByRole('main').textContent ?? '';
      expect(main).toContain('Tus clientes reservan sin gastos de gestión (salvo en planes de mantenimiento)');
      expect(main).toContain('Las visitas de un plan de mantenimiento sí llevan gastos de gestión.');
      expect(main).toContain('paga menos gastos de gestión');
      expect(main).not.toContain('deja de pagar gastos de gestión');
    });

    it('cuando cambian los ajustes cambia el texto (y el JSON-LD de las preguntas)', () => {
      billing.terms = { ...TERMS, garserRepeat: 'none', maintenanceVisit: 'none' };
      renderPage();
      const main = screen.getByRole('main').textContent ?? '';
      expect(main).toContain('Para ti es gratis. Para tus clientes, sin gastos de gestión.');
      expect(main).toContain('deja de pagar gastos de gestión');
      const { jsonLd } = seoHeadMock.mock.calls[seoHeadMock.mock.calls.length - 1]?.[0] as {
        jsonLd: Array<{ '@type': string; mainEntity?: Array<{ acceptedAnswer: { text: string } }> }>;
      };
      const answers = jsonLd.find((entry) => entry['@type'] === 'FAQPage')?.mainEntity?.map((q) => q.acceptedAnswer.text) ?? [];
      expect(answers).toEqual(gardenersFaqs(billing.terms).map((f) => f.answer));
    });

    it('si los ajustes dicen que se cobra a todos, la página no presume de lo contrario', () => {
      billing.terms = { ...TERMS, linkFirst: 'standard', linkRepeat: 'standard', garserRepeat: 'standard', maintenanceVisit: 'standard' };
      renderPage();
      const main = screen.getByRole('main').textContent ?? '';
      expect(main).not.toMatch(/sin gastos de gestión|no pagan gastos|deja de pagar|sin comisión/i);
      expect(main).toContain('Pagan gastos de gestión, aparte de tu precio.');
    });
  });

  it('el texto fijo (SEO, portada, contenido estático) no puede prometer nada que dependa de los ajustes', () => {
    // Lo fijo no cambia cuando cambian los ajustes: solo puede decir lo que es cierto siempre.
    const fixed = JSON.stringify([gardenersContent, pageSeo, generalHomeContent]).toLowerCase();
    expect(fixed).not.toMatch(/sin comisi[oó]n|sin gastos|gastos de gesti[oó]n|sin pagar comisi[oó]n/);
  });
});
