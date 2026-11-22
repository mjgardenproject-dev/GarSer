import React from 'react';
import { useOptionalCookieConsent } from '../../contexts/CookieConsentContext';

/**
 * «Configurar cookies» (QA-007): reabre el panel de preferencias para cambiar o retirar lo aceptado.
 * Se pone en el pie de la web y en la política de cookies, donde el visitante lo busca. Si no hay
 * proveedor de cookies (o no hay ninguna etiqueta de publicidad configurada: no hay nada que decidir)
 * no se pinta.
 */
const CookieSettingsButton: React.FC<{ className?: string; label?: string }> = ({ className, label = 'Configurar cookies' }) => {
  const consent = useOptionalCookieConsent();
  if (!consent || !consent.ready || !consent.available) return null;
  return (
    <button type="button" onClick={consent.openPreferences} className={className ?? 'text-left hover:text-white'}>
      {label}
    </button>
  );
};

export default CookieSettingsButton;
