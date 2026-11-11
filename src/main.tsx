import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { AccountProvider } from './contexts/AccountContext';
import { CookieConsentProvider } from './contexts/CookieConsentContext';
import App from './App.tsx';
import './index.css';
import { captureProviderLinkCodeFromUrl } from './utils/providerLinkCode';

// La clave del enlace de un profesional (garser.es/reservar/<id>?c=<clave>) se guarda y se quita de
// la dirección antes de que arranque nada que pueda mandar esa dirección a terceros (el Pixel de Meta).
captureProviderLinkCodeFromUrl();

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
