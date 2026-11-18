// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadGoogleAdsTag, isGoogleAdsTagLoaded, revokeGoogleAdsTag, trackGoogleAdsConversion, resetGoogleAdsTagForTests } from './googleAds';

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

  it('QA-007 · retirar el consentimiento: Consent Mode pasa a denegado, se borran sus cookies y no salen conversiones', () => {
    vi.stubEnv('VITE_GOOGLE_ADS_ID', 'AW-1234567890');
    loadGoogleAdsTag();
    document.cookie = '_gcl_au=1.1.789; path=/';
    revokeGoogleAdsTag();
    const calls = (window.dataLayer || []) as unknown[][];
    const update = calls.find((c) => c[0] === 'consent' && c[1] === 'update');
    expect(update?.[2]).toEqual({ ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' });
    expect(document.cookie).not.toContain('_gcl_au');
    expect(isGoogleAdsTagLoaded()).toBe(false);
    const before = calls.length;
    trackGoogleAdsConversion('abc');
    expect((window.dataLayer || []).length).toBe(before);
  });

  it('QA-007 · volver a aceptar concede otra vez sin duplicar el script', () => {
    vi.stubEnv('VITE_GOOGLE_ADS_ID', 'AW-1234567890');
    loadGoogleAdsTag();
    revokeGoogleAdsTag();
    loadGoogleAdsTag();
    const calls = (window.dataLayer || []) as unknown[][];
    const updates = calls.filter((c) => c[0] === 'consent' && c[1] === 'update');
    expect(updates[updates.length - 1][2]).toEqual({ ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted', analytics_storage: 'granted' });
    expect(isGoogleAdsTagLoaded()).toBe(true);
    expect(document.head.querySelectorAll('script[src*="googletagmanager.com"]').length).toBe(1);
  });

  it('QA-007 · sin haberlo cargado nunca, retirar no rompe nada', () => {
    expect(() => revokeGoogleAdsTag()).not.toThrow();
  });
});
