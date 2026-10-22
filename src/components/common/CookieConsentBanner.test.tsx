// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CookieConsentProvider } from '../../contexts/CookieConsentContext';
import CookieConsentBanner from './CookieConsentBanner';

vi.mock('../../utils/metaPixel', () => ({ loadMetaPixel: vi.fn() }));
vi.mock('../../utils/googleAds', () => ({ loadGoogleAdsTag: vi.fn() }));

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
});
