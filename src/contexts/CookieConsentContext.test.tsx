// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CookieConsentProvider, useCookieConsent } from './CookieConsentContext';

const mocks = vi.hoisted(() => ({
  loadMetaPixel: vi.fn(),
  loadGoogleAdsTag: vi.fn(),
}));
vi.mock('../utils/metaPixel', () => ({ loadMetaPixel: mocks.loadMetaPixel }));
vi.mock('../utils/googleAds', () => ({ loadGoogleAdsTag: mocks.loadGoogleAdsTag }));

const STORAGE_KEY = 'garser.cookie-consent.v1';

function Probe() {
  const { ready, needsDecision, advertisingAllowed, acceptAll, rejectAll } = useCookieConsent();
  if (!ready) return <p>cargando</p>;
  return (
    <div>
      <p>needsDecision: {String(needsDecision)}</p>
      <p>advertisingAllowed: {String(advertisingAllowed)}</p>
      <button onClick={acceptAll}>aceptar</button>
      <button onClick={rejectAll}>rechazar</button>
    </div>
  );
}

const renderProbe = () => render(<CookieConsentProvider><Probe /></CookieConsentProvider>);

describe('CookieConsentContext', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubEnv('VITE_META_PIXEL_ID', '2034090553963036');
    vi.stubEnv('VITE_GOOGLE_ADS_ID', '');
    mocks.loadMetaPixel.mockClear();
    mocks.loadGoogleAdsTag.mockClear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    window.localStorage.clear();
  });

  it('sin decisión guardada, pide decidir, y aceptar carga los píxeles y lo recuerda', async () => {
    renderProbe();
    expect(await screen.findByText('needsDecision: true')).toBeTruthy();
    expect(mocks.loadMetaPixel).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('aceptar'));
    expect(await screen.findByText('needsDecision: false')).toBeTruthy();
    expect(screen.getByText('advertisingAllowed: true')).toBeTruthy();
    expect(mocks.loadMetaPixel).toHaveBeenCalledTimes(1);
    expect(mocks.loadGoogleAdsTag).toHaveBeenCalledTimes(1);

    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}');
    expect(stored.advertising).toBe(true);
  });

  it('rechazar no carga nada y también se recuerda', async () => {
    renderProbe();
    await screen.findByText('needsDecision: true');
    fireEvent.click(screen.getByText('rechazar'));
    expect(await screen.findByText('needsDecision: false')).toBeTruthy();
    expect(screen.getByText('advertisingAllowed: false')).toBeTruthy();
    expect(mocks.loadMetaPixel).not.toHaveBeenCalled();
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}');
    expect(stored.advertising).toBe(false);
  });

  it('con una decisión reciente ya guardada, no vuelve a preguntar y respeta lo guardado', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ advertising: true, decidedAt: new Date().toISOString() }));
    renderProbe();
    expect(await screen.findByText('needsDecision: false')).toBeTruthy();
    expect(screen.getByText('advertisingAllowed: true')).toBeTruthy();
    expect(mocks.loadMetaPixel).toHaveBeenCalledTimes(1);
  });

  it('una decisión de hace más de 24 meses caduca y vuelve a preguntar', async () => {
    const old = new Date();
    old.setMonth(old.getMonth() - 25);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ advertising: true, decidedAt: old.toISOString() }));
    renderProbe();
    expect(await screen.findByText('needsDecision: true')).toBeTruthy();
    expect(mocks.loadMetaPixel).not.toHaveBeenCalled();
  });

  it('sin ninguna etiqueta configurada, no hace falta preguntar', async () => {
    vi.stubEnv('VITE_META_PIXEL_ID', '');
    vi.stubEnv('VITE_GOOGLE_ADS_ID', '');
    renderProbe();
    expect(await screen.findByText('needsDecision: false')).toBeTruthy();
  });
});
