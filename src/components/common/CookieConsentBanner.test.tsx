// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CookieConsentProvider, useCookieConsent } from '../../contexts/CookieConsentContext';
import CookieConsentBanner from './CookieConsentBanner';

const toastSuccess = vi.fn();
vi.mock('react-hot-toast', () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn() } }));
vi.mock('../../utils/metaPixel', () => ({ loadMetaPixel: vi.fn(), revokeMetaPixel: vi.fn() }));
vi.mock('../../utils/googleAds', () => ({ loadGoogleAdsTag: vi.fn(), revokeGoogleAdsTag: vi.fn() }));

const renderBanner = () => render(
  <MemoryRouter>
    <CookieConsentProvider><CookieConsentBanner /></CookieConsentProvider>
  </MemoryRouter>,
);

describe('CookieConsentBanner', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubEnv('VITE_META_PIXEL_ID', '2034090553963036');
    vi.stubEnv('VITE_GOOGLE_ADS_ID', '');
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    window.localStorage.clear();
  });

  it('sale con Aceptar y Rechazar del mismo tamaño, y enlaza a Cookies', async () => {
    renderBanner();
    const region = await screen.findByRole('region', { name: 'Preferencias de cookies' });
    const accept = screen.getByRole('button', { name: 'Aceptar todo' });
    const reject = screen.getByRole('button', { name: 'Rechazar todo' });
    expect(region).toBeTruthy();
    // Mismo peso visual: idéntica clase de tamaño mínimo y ambos ocupan el mismo ancho (flex-1).
    expect(accept.className).toContain('min-h-11');
    expect(reject.className).toContain('min-h-11');
    expect(accept.className).toContain('flex-1');
    expect(reject.className).toContain('flex-1');
    expect(screen.getByRole('link', { name: 'Más información' }).getAttribute('href')).toBe('/cookies');
  });

  it('se cierra al aceptar, y no vuelve a salir', async () => {
    renderBanner();
    await screen.findByRole('region', { name: 'Preferencias de cookies' });
    fireEvent.click(screen.getByRole('button', { name: 'Aceptar todo' }));
    expect(screen.queryByRole('region', { name: 'Preferencias de cookies' })).toBeNull();
  });

  it('se cierra al rechazar', async () => {
    renderBanner();
    await screen.findByRole('region', { name: 'Preferencias de cookies' });
    fireEvent.click(screen.getByRole('button', { name: 'Rechazar todo' }));
    expect(screen.queryByRole('region', { name: 'Preferencias de cookies' })).toBeNull();
  });

  it('«Configurar» abre el panel y permite aceptar solo Publicidad', async () => {
    renderBanner();
    await screen.findByRole('region', { name: 'Preferencias de cookies' });
    fireEvent.click(screen.getByRole('button', { name: 'Configurar' }));

    const toggle = screen.getByRole('switch', { name: 'Cookies de publicidad' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Guardar preferencias' }));
    expect(screen.queryByRole('region', { name: 'Preferencias de cookies' })).toBeNull();
    const stored = JSON.parse(window.localStorage.getItem('garser.cookie-consent.v1') || '{}');
    expect(stored.advertising).toBe(true);
  });

  it('sin ninguna etiqueta configurada, no sale', () => {
    vi.stubEnv('VITE_META_PIXEL_ID', '');
    vi.stubEnv('VITE_GOOGLE_ADS_ID', '');
    renderBanner();
    expect(screen.queryByRole('region', { name: 'Preferencias de cookies' })).toBeNull();
  });

  it('QA-007 · Aceptar y Rechazar tienen el mismo aspecto (ninguno resaltado sobre el otro, AEPD)', async () => {
    renderBanner();
    await screen.findByRole('region', { name: 'Preferencias de cookies' });
    const accept = screen.getByRole('button', { name: 'Aceptar todo' });
    const reject = screen.getByRole('button', { name: 'Rechazar todo' });
    expect(accept.className).toBe(reject.className);
  });

  describe('reabrir el panel con la decisión ya tomada (QA-007)', () => {
    const Opener = () => {
      const { openPreferences } = useCookieConsent();
      return <button onClick={openPreferences}>Configurar cookies</button>;
    };
    const renderWithOpener = (advertising: boolean) => {
      window.localStorage.setItem('garser.cookie-consent.v1', JSON.stringify({ advertising, decidedAt: new Date().toISOString() }));
      return render(
        <MemoryRouter>
          <CookieConsentProvider><Opener /><CookieConsentBanner /></CookieConsentProvider>
        </MemoryRouter>,
      );
    };

    it('con la decisión tomada no sale solo, pero se abre desde «Configurar cookies» y enseña lo guardado', async () => {
      renderWithOpener(true);
      await screen.findByRole('button', { name: 'Configurar cookies' });
      expect(screen.queryByRole('region', { name: 'Preferencias de cookies' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Configurar cookies' }));
      expect(screen.getByRole('region', { name: 'Preferencias de cookies' })).toBeTruthy();
      // El panel arranca desplegado y con lo que el visitante tenía guardado.
      expect(screen.getByRole('switch', { name: 'Cookies de publicidad' }).getAttribute('aria-checked')).toBe('true');
    });

    it('apagar Publicidad y guardar retira el consentimiento', async () => {
      renderWithOpener(true);
      fireEvent.click(await screen.findByRole('button', { name: 'Configurar cookies' }));
      fireEvent.click(screen.getByRole('switch', { name: 'Cookies de publicidad' }));
      fireEvent.click(screen.getByRole('button', { name: 'Guardar preferencias' }));
      expect(screen.queryByRole('region', { name: 'Preferencias de cookies' })).toBeNull();
      expect(JSON.parse(window.localStorage.getItem('garser.cookie-consent.v1') || '{}').advertising).toBe(false);
    });

    it('guardar un cambio avisa de que se guardó (R3-1.9 OBS-05)', async () => {
      renderWithOpener(true);
      fireEvent.click(await screen.findByRole('button', { name: 'Configurar cookies' }));
      fireEvent.click(screen.getByRole('switch', { name: 'Cookies de publicidad' }));
      fireEvent.click(screen.getByRole('button', { name: 'Guardar preferencias' }));
      expect(toastSuccess).toHaveBeenCalledWith('Cookies de publicidad desactivadas.');
    });

    it('el panel se desplaza dentro de sí mismo con poca altura (R3-1.9 OBS-06) y el interruptor no se sale de su pista (OBS-02)', async () => {
      renderWithOpener(true);
      fireEvent.click(await screen.findByRole('button', { name: 'Configurar cookies' }));
      const region = screen.getByRole('region', { name: 'Preferencias de cookies' });
      expect(region.className).toContain('overflow-y-auto');
      expect(region.className).toContain('max-h-[100dvh]');
      const knob = screen.getByRole('switch', { name: 'Cookies de publicidad' }).firstElementChild as HTMLElement;
      expect(knob.className).toContain('left-0');
    });

    it('se puede cerrar sin cambiar nada', async () => {
      renderWithOpener(true);
      fireEvent.click(await screen.findByRole('button', { name: 'Configurar cookies' }));
      fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
      expect(screen.queryByRole('region', { name: 'Preferencias de cookies' })).toBeNull();
      expect(JSON.parse(window.localStorage.getItem('garser.cookie-consent.v1') || '{}').advertising).toBe(true);
    });

    it('«Rechazar todo» desde el panel reabierto también retira', async () => {
      renderWithOpener(true);
      fireEvent.click(await screen.findByRole('button', { name: 'Configurar cookies' }));
      fireEvent.click(screen.getByRole('button', { name: 'Rechazar todo' }));
      expect(JSON.parse(window.localStorage.getItem('garser.cookie-consent.v1') || '{}').advertising).toBe(false);
    });
  });
});
