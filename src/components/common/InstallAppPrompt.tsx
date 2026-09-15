import React, { useEffect, useState } from 'react';
import { Share2, PlusSquare, Download, Smartphone, MoreVertical } from 'lucide-react';

/**
 * Fallo 1 (auditoría UX móvil 2026-09-14): no había ninguna explicación en la web de
 * cómo instalar GarSer en el móvil. Se muestra solo si la web NO se está ejecutando ya
 * como app instalada (standalone), y adapta las instrucciones a iOS/Android porque no
 * comparten mecanismo de instalación (iOS no dispara `beforeinstallprompt`).
 *
 * Se construye en la Fase 2 del plan; se monta dentro de "Mi Cuenta" en la Fase 6.
 */

type Platform = 'ios' | 'android' | 'other';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent || '';
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && typeof document !== 'undefined' && 'ontouchend' in document);
  if (isIOS) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'other';
}

function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

const InstallAppPrompt: React.FC = () => {
  const [platform, setPlatform] = useState<Platform>('other');
  const [standalone, setStandalone] = useState(true);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    setPlatform(detectPlatform());
    setStandalone(isStandaloneDisplay());

    const handleBeforeInstall = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => {
      setInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  if (standalone || installed) {
    return null;
  }

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      setInstalled(true);
    }
    setDeferredPrompt(null);
  };

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
      <div className="mb-3 flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-green-100 text-green-700">
          <Smartphone className="h-5 w-5" aria-hidden="true" />
        </div>
        <h2 className="text-base font-bold text-gray-900">Instala GarSer en tu móvil</h2>
      </div>

      {platform === 'ios' && (
        <div className="space-y-2 text-sm text-gray-600">
          <p>
            Añádela a tu pantalla de inicio para abrirla como una app, con el icono
            oficial y sin la barra de Safari:
          </p>
          <ol className="list-decimal space-y-1.5 pl-5">
            <li className="flex flex-wrap items-center gap-1">
              Toca <Share2 className="h-4 w-4 text-gray-500" aria-hidden="true" />
              <span className="font-medium text-gray-800">Compartir</span> en la barra de Safari.
            </li>
            <li className="flex flex-wrap items-center gap-1">
              Elige <PlusSquare className="h-4 w-4 text-gray-500" aria-hidden="true" />
              <span className="font-medium text-gray-800">Añadir a pantalla de inicio</span>.
            </li>
            <li>
              Confirma pulsando <span className="font-medium text-gray-800">Añadir</span>.
            </li>
          </ol>
        </div>
      )}

      {platform === 'android' && (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            Instálala para abrirla como una app, con el icono oficial y sin la barra del
            navegador.
          </p>
          {deferredPrompt ? (
            <button
              type="button"
              onClick={() => void handleInstallClick()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-green-600 px-4 py-3 font-bold text-white shadow-lg shadow-green-600/20 transition-colors hover:bg-green-700 active:scale-[0.98] sm:w-auto"
            >
              <Download className="h-5 w-5" aria-hidden="true" />
              Instalar app
            </button>
          ) : (
            <ol className="list-decimal space-y-1.5 pl-5 text-sm text-gray-600">
              <li className="flex flex-wrap items-center gap-1">
                Toca <MoreVertical className="h-4 w-4 text-gray-500" aria-hidden="true" /> el
                menú de Chrome (arriba a la derecha).
              </li>
              <li>
                Elige <span className="font-medium text-gray-800">Instalar app</span> o{' '}
                <span className="font-medium text-gray-800">Añadir a pantalla de inicio</span>.
              </li>
            </ol>
          )}
        </div>
      )}

      {platform === 'other' && (
        <p className="text-sm text-gray-600">
          Abre garser.es desde el navegador de tu móvil (Safari en iPhone, Chrome en
          Android) para poder instalarla.
        </p>
      )}
    </div>
  );
};

export default InstallAppPrompt;
