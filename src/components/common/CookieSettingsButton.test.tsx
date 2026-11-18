// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CookieConsentProvider } from '../../contexts/CookieConsentContext';
import CookieConsentBanner from './CookieConsentBanner';
import CookieSettingsButton from './CookieSettingsButton';

vi.mock('../../utils/metaPixel', () => ({ loadMetaPixel: vi.fn(), revokeMetaPixel: vi.fn() }));
vi.mock('../../utils/googleAds', () => ({ loadGoogleAdsTag: vi.fn(), revokeGoogleAdsTag: vi.fn() }));

describe('CookieSettingsButton (QA-007)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubEnv('VITE_META_PIXEL_ID', '2034090553963036');
    vi.stubEnv('VITE_GOOGLE_ADS_ID', '');
  });
  afterEach(() => { cleanup(); vi.unstubAllEnvs(); window.localStorage.clear(); });

  it('con la decisión ya tomada, el botón reabre el panel', async () => {
    window.localStorage.setItem('garser.cookie-consent.v1', JSON.stringify({ advertising: true, decidedAt: new Date().toISOString() }));
    render(
      <MemoryRouter>
        <CookieConsentProvider><CookieSettingsButton /><CookieConsentBanner /></CookieConsentProvider>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Configurar cookies' }));
    expect(screen.getByRole('region', { name: 'Preferencias de cookies' })).toBeTruthy();
  });

  it('sin proveedor no se pinta (y no rompe)', () => {
    render(<CookieSettingsButton />);
    expect(screen.queryByRole('button', { name: 'Configurar cookies' })).toBeNull();
  });

  it('sin ninguna etiqueta de publicidad configurada no hay nada que cambiar: no se pinta', async () => {
    vi.stubEnv('VITE_META_PIXEL_ID', '');
    render(<CookieConsentProvider><CookieSettingsButton /></CookieConsentProvider>);
    await Promise.resolve();
    expect(screen.queryByRole('button', { name: 'Configurar cookies' })).toBeNull();
  });
});
