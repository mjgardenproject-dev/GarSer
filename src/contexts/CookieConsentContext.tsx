import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { advertisingAvailable } from '../config/analytics';
import { loadMetaPixel, revokeMetaPixel } from '../utils/metaPixel';
import { loadGoogleAdsTag, revokeGoogleAdsTag } from '../utils/googleAds';
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
  /** Hay alguna etiqueta de publicidad configurada: tiene sentido ofrecer cambiar la decisión. */
  available: boolean;
  advertisingAllowed: boolean;
  /** El panel de preferencias está abierto por decisión del visitante (QA-007), tenga o no decisión guardada. */
  preferencesOpen: boolean;
  /** Reabre el panel para cambiar o retirar lo que se aceptó: «Configurar cookies» del pie y de la política. */
  openPreferences: () => void;
  closePreferences: () => void;
  acceptAll: () => void;
  rejectAll: () => void;
  setAdvertising: (allowed: boolean) => void;
}

const CookieConsentContext = createContext<CookieConsentValue | null>(null);

export const CookieConsentProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [ready, setReady] = useState(false);
  const [advertisingAllowed, setAdvertisingAllowed] = useState(false);
  const [hasDecision, setHasDecision] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  // Lo último concedido, para que «retirar» sepa si había algo que retirar sin depender de un repintado.
  const advertisingAllowedRef = useRef(false);

  useEffect(() => {
    const stored = readStoredConsent();
    if (stored) {
      advertisingAllowedRef.current = stored.advertising;
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
    // Primero se guarda: la vía servidor (Conversions API) lee esta decisión en cada envío, así que
    // retirar el consentimiento surte efecto en el acto, también antes de que React repinte.
    writeStoredConsent(allowed);
    // QA-007: retirar lo que ya se aceptó apaga Meta y Google y borra sus cookies.
    if (!allowed && advertisingAllowedRef.current) {
      revokeMetaPixel();
      revokeGoogleAdsTag();
    }
    advertisingAllowedRef.current = allowed;
    setAdvertisingAllowed(allowed);
    setHasDecision(true);
    setPreferencesOpen(false);
  }, []);
  const openPreferences = useCallback(() => setPreferencesOpen(true), []);
  const closePreferences = useCallback(() => setPreferencesOpen(false), []);

  const acceptAll = useCallback(() => setAdvertising(true), [setAdvertising]);
  const rejectAll = useCallback(() => setAdvertising(false), [setAdvertising]);

  const value = useMemo<CookieConsentValue>(() => ({
    ready,
    needsDecision: ready && !hasDecision && advertisingAvailable(),
    available: advertisingAvailable(),
    advertisingAllowed,
    preferencesOpen,
    openPreferences,
    closePreferences,
    acceptAll,
    rejectAll,
    setAdvertising,
  }), [ready, hasDecision, advertisingAllowed, preferencesOpen, openPreferences, closePreferences, acceptAll, rejectAll, setAdvertising]);

  return <CookieConsentContext.Provider value={value}>{children}</CookieConsentContext.Provider>;
};

export function useCookieConsent(): CookieConsentValue {
  const ctx = useContext(CookieConsentContext);
  if (!ctx) throw new Error('useCookieConsent must be used within CookieConsentProvider');
  return ctx;
}

/** Como `useCookieConsent`, pero devuelve null fuera del proveedor (páginas y pruebas que solo quieren
 * ofrecer «Configurar cookies» si hay con qué abrir el panel). */
export function useOptionalCookieConsent(): CookieConsentValue | null {
  return useContext(CookieConsentContext);
}
