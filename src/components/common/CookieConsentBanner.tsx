import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Cookie } from 'lucide-react';
import { useCookieConsent } from '../../contexts/CookieConsentContext';

// Banner de cookies, 2026-10-22. Conforme a la guía de la AEPD:
// - «Aceptar todo» y «Rechazar todo» con el mismo tamaño, el mismo peso y la misma posición —
//   ninguno de los dos resaltado sobre el otro.
// - «Configurar» para elegir la categoría de Publicidad por separado.
// - No sigue navegando ni hace scroll: solo un clic en un botón cuenta como decisión.
// Nada se carga (ni Meta ni Google Ads) hasta que CookieConsentContext recibe la decisión.

const CookieConsentBanner: React.FC = () => {
  const { needsDecision, acceptAll, rejectAll, setAdvertising } = useCookieConsent();
  const [expanded, setExpanded] = useState(false);
  const [draftAdvertising, setDraftAdvertising] = useState(false);

  if (!needsDecision) return null;

  const saveChoices = () => setAdvertising(draftAdvertising);

  return (
    <div
      role="region"
      aria-label="Preferencias de cookies"
      className="fixed inset-x-0 bottom-0 z-[70] border-t border-gray-200 bg-white px-4 py-4 shadow-[0_-4px_16px_rgba(0,0,0,0.08)] sm:px-6"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <div className="flex items-start gap-3">
          <Cookie className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" aria-hidden="true" />
          <div className="text-sm leading-6 text-gray-700">
            <p>
              Usamos cookies técnicas, siempre activas, para que GarSer funcione. Con tu permiso, también nos gustaría usar cookies de publicidad para medir y mejorar cómo te enseñamos GarSer.
              {' '}
              <Link to="/cookies" className="font-semibold text-emerald-700 underline hover:text-emerald-800">Más información</Link>
              {!expanded && (
                <>
                  {' · '}
                  <button type="button" onClick={() => setExpanded(true)} className="font-semibold text-emerald-700 underline hover:text-emerald-800">
                    Configurar
                  </button>
                </>
              )}
            </p>
          </div>
        </div>

        {expanded && (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-gray-900">Necesarias</p>
                <p className="text-xs text-gray-500">Para que la web funcione. Siempre activas.</p>
              </div>
              <span className="shrink-0 rounded-full bg-gray-200 px-3 py-1 text-xs font-semibold text-gray-600">Siempre activas</span>
            </div>
            <div className="mt-4 flex items-center justify-between gap-4 border-t border-gray-200 pt-4">
              <div>
                <p className="text-sm font-semibold text-gray-900">Publicidad</p>
                <p className="text-xs text-gray-500">Meta (Instagram/Facebook) y Google Ads, para medir y dirigir anuncios.</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={draftAdvertising}
                aria-label="Cookies de publicidad"
                onClick={() => setDraftAdvertising((v) => !v)}
                className={`relative h-7 w-12 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 ${draftAdvertising ? 'bg-emerald-600' : 'bg-gray-300'}`}
              >
                <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${draftAdvertising ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
            </div>
            <button
              type="button"
              onClick={saveChoices}
              className="mt-4 min-h-11 w-full rounded-full border border-gray-300 bg-white px-5 text-sm font-semibold text-gray-900 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
            >
              Guardar preferencias
            </button>
          </div>
        )}

        <div className="flex flex-col gap-2.5 sm:flex-row">
          <button
            type="button"
            onClick={rejectAll}
            className="min-h-11 flex-1 rounded-full border border-gray-300 bg-white px-5 text-sm font-semibold text-gray-900 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 [touch-action:manipulation]"
          >
            Rechazar todo
          </button>
          <button
            type="button"
            onClick={acceptAll}
            className="min-h-11 flex-1 rounded-full border border-emerald-700 bg-emerald-700 px-5 text-sm font-semibold text-white transition-colors hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 [touch-action:manipulation]"
          >
            Aceptar todo
          </button>
        </div>
      </div>
    </div>
  );
};

export default CookieConsentBanner;
