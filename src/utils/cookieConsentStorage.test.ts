// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONSENT_STORAGE_KEY,
  advertisingConsentColumns,
  advertisingConsentGranted,
  readStoredConsent,
  writeStoredConsent,
} from './cookieConsentStorage';

describe('cookieConsentStorage', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('sin decisión guardada no hay consentimiento', () => {
    expect(readStoredConsent()).toBeNull();
    expect(advertisingConsentGranted()).toBe(false);
  });

  it('aceptar se guarda y se lee; rechazar también, y no cuenta como consentimiento', () => {
    writeStoredConsent(true);
    expect(advertisingConsentGranted()).toBe(true);
    writeStoredConsent(false);
    expect(readStoredConsent()?.advertising).toBe(false);
    expect(advertisingConsentGranted()).toBe(false);
  });

  it('una decisión de hace más de 24 meses caduca', () => {
    const old = new Date();
    old.setMonth(old.getMonth() - 25);
    window.localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({ advertising: true, decidedAt: old.toISOString() }));
    expect(advertisingConsentGranted()).toBe(false);
  });

  it('un dato corrupto o con otra forma se trata como sin decidir', () => {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, '{no es json');
    expect(advertisingConsentGranted()).toBe(false);
    window.localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({ advertising: 'si', decidedAt: 'hoy' }));
    expect(advertisingConsentGranted()).toBe(false);
  });

  it('si el almacenamiento está bloqueado, no hay consentimiento y no lanza', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(advertisingConsentGranted()).toBe(false);
  });

  it('las columnas de la solicitud reflejan la decisión y cuándo se tomó', () => {
    expect(advertisingConsentColumns()).toEqual({ ads_consent: false, ads_consent_at: null });

    writeStoredConsent(true);
    const accepted = advertisingConsentColumns();
    expect(accepted.ads_consent).toBe(true);
    expect(Number.isNaN(new Date(accepted.ads_consent_at as string).getTime())).toBe(false);

    writeStoredConsent(false);
    const rejected = advertisingConsentColumns();
    expect(rejected.ads_consent).toBe(false);
    expect(rejected.ads_consent_at).toBeTruthy();
  });
});
