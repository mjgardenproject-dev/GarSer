import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { advertisingAvailable } from '../config/analytics';
import { loadMetaPixel } from '../utils/metaPixel';
import { loadGoogleAdsTag } from '../utils/googleAds';

// Consentimiento de cookies, 2026-10-22. Conforme a la guía de la AEPD: «Aceptar» y «Rechazar» con el
// mismo peso, sin instalar nada hasta que el visitante decide, y se vuelve a preguntar como mucho a
// los 24 meses. Una sola categoría además de las necesarias («publicidad»: Meta + Google Ads) porque es
// lo único que hay por ahora — si se añade otra más adelante, se amplía aquí.

const STORAGE_KEY = 'garser.cookie-consent.v1';
const RENEW_AFTER_MS = 24 * 30 * 24 * 60 * 60 * 1000; // 24 meses, en meses de 30 días: sobra margen.

interface StoredConsent {
  advertising: boolean;
  decidedAt: string;
}

function readStoredConsent(): StoredConsent | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredConsent>;
    if (typeof parsed.advertising !== 'boolean' || typeof parsed.decidedAt !== 'string') return null;
    const decidedAt = new Date(parsed.decidedAt).getTime();
    if (!Number.isFinite(decidedAt) || Date.now() - decidedAt > RENEW_AFTER_MS) return null; // caducado: se vuelve a preguntar
    return { advertising: parsed.advertising, decidedAt: parsed.decidedAt };
  } catch {
    return null; // localStorage bloqueado o dato corrupto: se trata como «sin decidir».
  }
}

function writeStoredConsent(advertising: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ advertising, decidedAt: new Date().toISOString() }));
  } catch {
    // Sin almacenamiento disponible: el banner volverá a salir la próxima vez. No es grave.
  }
}

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
