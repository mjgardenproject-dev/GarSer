// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadGoogleAdsTag, isGoogleAdsTagLoaded, trackGoogleAdsConversion, resetGoogleAdsTagForTests } from './googleAds';

describe('googleAds', () => {
  beforeEach(() => {
    resetGoogleAdsTagForTests();
    document.head.innerHTML = '';
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetGoogleAdsTagForTests();
    document.head.innerHTML = '';
  });

  it('sin VITE_GOOGLE_ADS_ID no instala nada', () => {
    vi.stubEnv('VITE_GOOGLE_ADS_ID', '');
    loadGoogleAdsTag();
    expect(isGoogleAdsTagLoaded()).toBe(false);
    expect(window.gtag).toBeUndefined();
    expect(document.head.querySelector('script[src*="googletagmanager.com"]')).toBeNull();
  });

  it('con el identificador, instala el script y manda el consentimiento concedido antes de configurar', () => {
    vi.stubEnv('VITE_GOOGLE_ADS_ID', 'AW-1234567890');
    loadGoogleAdsTag();
    expect(isGoogleAdsTagLoaded()).toBe(true);
    expect(document.head.querySelector('script[src="https://www.googletagmanager.com/gtag/js?id=AW-1234567890"]')).toBeTruthy();

    const calls = (window.dataLayer || []) as unknown[][];
    const consentCall = calls.find((c) => c[0] === 'consent');
    const configCall = calls.find((c) => c[0] === 'config');
    expect(consentCall?.[2]).toMatchObject({ ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted' });
    expect(configCall).toEqual(['config', 'AW-1234567890']);
    // El consentimiento se manda antes que la configuración, no después.
    expect(calls.indexOf(consentCall!)).toBeLessThan(calls.indexOf(configCall!));
  });

  it('llamarlo dos veces no duplica el script', () => {
    vi.stubEnv('VITE_GOOGLE_ADS_ID', 'AW-1234567890');
    loadGoogleAdsTag();
    loadGoogleAdsTag();
    expect(document.head.querySelectorAll('script[src*="googletagmanager.com"]').length).toBe(1);
  });

  it('trackGoogleAdsConversion no hace nada si la etiqueta no se ha cargado', () => {
    vi.stubEnv('VITE_GOOGLE_ADS_ID', 'AW-1234567890');
    const spy = vi.fn();
    window.gtag = spy;
    trackGoogleAdsConversion('abc123');
    expect(spy).not.toHaveBeenCalled();
  });

  it('trackGoogleAdsConversion manda el evento con la etiqueta de conversión', () => {
    vi.stubEnv('VITE_GOOGLE_ADS_ID', 'AW-1234567890');
    loadGoogleAdsTag();
    const calls: unknown[][] = [];
    window.gtag = (...args: unknown[]) => { calls.push(args); };
    trackGoogleAdsConversion('abc123', { value: 25 });
    expect(calls).toContainEqual(['event', 'conversion', { send_to: 'AW-1234567890/abc123', value: 25 }]);
  });
});
