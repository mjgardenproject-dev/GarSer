import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { advertisingAvailable } from '../config/analytics';
import { loadMetaPixel } from '../utils/metaPixel';
import { loadGoogleAdsTag } from '../utils/googleAds';
import { readStoredConsent, writeStoredConsent } from '../utils/cookieConsentStorage';

// Consentimiento de cookies, 2026-10-22. Conforme a la guía de la AEPD: «Aceptar» y «Rechazar» con el
// mismo peso, sin instalar nada hasta que el visitante decide, y se vuelve a preguntar como mucho a
// los 24 meses. Una sola categoría además de las necesarias («publicidad»: Meta + Google Ads) porque es
// lo único que hay por ahora — si se añade otra más adelante, se amplía aquí.

interface CookieConsentValue {
  /** false mientras no se sabe si hay una decisión guardada (primer render, antes de leer localStorage). */
  ready: boolean;
  /** true si el visitante aún no ha decidido (o caducó su decisión) y hay algo que ofrecerle. */
  needsDecision: boolean;
  advertisingAllowed: boolean;
  acceptAll: () => void;
  rejectAll: () => void;
  setAdvertising: (allowed: boolean) => void;
}

const CookieConsentContext = createContext<CookieConsentValue | null>(null);

export const CookieConsentProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [ready, setReady] = useState(false);
  const [advertisingAllowed, setAdvertisingAllowed] = useState(false);
  const [hasDecision, setHasDecision] = useState(false);

  useEffect(() => {
    const stored = readStoredConsent();
    if (stored) {
      setAdvertisingAllowed(stored.advertising);
      setHasDecision(true);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!advertisingAllowed) return;
    loadMetaPixel();
    loadGoogleAdsTag();
  }, [advertisingAllowed]);

  const setAdvertising = useCallback((allowed: boolean) => {
    writeStoredConsent(allowed);
    setAdvertisingAllowed(allowed);
    setHasDecision(true);
  }, []);

  const acceptAll = useCallback(() => setAdvertising(true), [setAdvertising]);
  const rejectAll = useCallback(() => setAdvertising(false), [setAdvertising]);

  const value = useMemo<CookieConsentValue>(() => ({
    ready,
    needsDecision: ready && !hasDecision && advertisingAvailable(),
    advertisingAllowed,
    acceptAll,
    rejectAll,
    setAdvertising,
  }), [ready, hasDecision, advertisingAllowed, acceptAll, rejectAll, setAdvertising]);

  return <CookieConsentContext.Provider value={value}>{children}</CookieConsentContext.Provider>;
};

export function useCookieConsent(): CookieConsentValue {
  const ctx = useContext(CookieConsentContext);
  if (!ctx) throw new Error('useCookieConsent must be used within CookieConsentProvider');
  return ctx;
}
