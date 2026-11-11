import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { AccountProvider } from './contexts/AccountContext';
import { CookieConsentProvider } from './contexts/CookieConsentContext';
import App from './App.tsx';
import './index.css';
import { captureProviderLinkCodeFromUrl } from './utils/providerLinkCode';
import { disableBrowserScrollRestoration } from './utils/scrollRestoration';
import { enableScrollDebugIfRequested } from './utils/scrollDebug';
import { startReloadScrollGuard } from './utils/reloadScrollGuard';

// La clave del enlace de un profesional (garser.es/reservar/<id>?c=<clave>) se guarda y se quita de
// la dirección antes de que arranque nada que pueda mandar esa dirección a terceros (el Pixel de Meta).
captureProviderLinkCodeFromUrl();

// Al recargar, el navegador del móvil devolvía la pantalla a medias, con su primera sección tapada por las barras
// fijas. ScrollToTop decide dónde empieza cada pantalla (src/utils/scrollRestoration.ts).
disableBrowserScrollRestoration();
// Solo con `?scrolldebug=1`: apunta quién mueve el scroll (src/utils/scrollDebug.ts). Sin la marca no hace nada.
enableScrollDebugIfRequested();
// Chrome del iPhone (iOS 26) deja la página ≈ 60 px desplazada y sin poder volver arriba al recargar TIRANDO de la
// pantalla (fallo de Chrome: Wikipedia también). En una recarga, intenta devolverla arriba y, si el navegador no deja,
// pone ese mismo hueco arriba del documento para que el encabezado no tape la primera sección.
startReloadScrollGuard();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CookieConsentProvider>
      <AuthProvider>
        <AccountProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </AccountProvider>
      </AuthProvider>
    </CookieConsentProvider>
  </StrictMode>
);
