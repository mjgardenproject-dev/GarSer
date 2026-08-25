import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle } from 'lucide-react';

/**
 * Diálogo de confirmación de la app.
 *
 * Vivía embebido dentro de DetailsPage, así que el resto de la web caía en `window.confirm` y
 * `window.alert` para decisiones que mueven dinero —cancelar una reserva, por ejemplo—. En
 * móvil el diálogo nativo recorta el texto, ignora la marca y parece un aviso del navegador,
 * justo donde hay que explicar que los gastos de gestión no se devuelven.
 *
 * Se conserva el diseño que ya existía (tonos, orden de botones, botones apilados a ancho
 * completo) y se añade lo que le faltaba para producción: cierre con Escape, foco inicial en la
 * opción segura y semántica de diálogo para lectores de pantalla.
 */

export type ConfirmTone = 'danger' | 'warning' | 'phytosanitary_warning';

export interface ConfirmConfig {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
  onConfirm: () => void | Promise<void>;
}

interface ConfirmState extends Required<Omit<ConfirmConfig, 'onConfirm'>> {
  isOpen: boolean;
  onConfirm: (() => void | Promise<void>) | null;
}

const CLOSED: ConfirmState = {
  isOpen: false,
  title: '',
  message: '',
  confirmLabel: 'Confirmar',
  cancelLabel: 'Cancelar',
  tone: 'warning',
  onConfirm: null,
};

/**
 * Uso:
 *   const { openConfirm, confirmDialog } = useConfirmDialog();
 *   ...
 *   return (<>{contenido}{confirmDialog}</>);
 */
export function useConfirmDialog() {
  const [state, setState] = useState<ConfirmState>(CLOSED);
  const [busy, setBusy] = useState(false);
  const safeButtonRef = useRef<HTMLButtonElement | null>(null);

  const openConfirm = useCallback((config: ConfirmConfig) => {
    setState({
      isOpen: true,
      title: config.title,
      message: config.message,
      confirmLabel: config.confirmLabel || 'Confirmar',
      cancelLabel: config.cancelLabel || 'Cancelar',
      tone: config.tone || 'warning',
      onConfirm: config.onConfirm,
    });
  }, []);

  const closeConfirm = useCallback(() => {
    setState((prev) => ({ ...prev, isOpen: false, onConfirm: null }));
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!state.onConfirm) return;
    // Bloqueo mientras la acción está en curso: sin esto, un doble toque en móvil dispara dos
    // cancelaciones o dos cobros.
    setBusy(true);
    try {
      await state.onConfirm();
    } finally {
      setBusy(false);
      setState((prev) => ({ ...prev, isOpen: false, onConfirm: null }));
    }
  }, [state]);

  useEffect(() => {
    if (!state.isOpen) return;
    // El foco entra en la opción SEGURA, no en la destructiva.
    safeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) closeConfirm();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [state.isOpen, busy, closeConfirm]);

  const isRedTone = state.tone === 'danger' || state.tone === 'phytosanitary_warning';

  const confirmDialog = state.isOpen
    ? createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
          aria-describedby="confirm-dialog-message"
        >
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl p-6 animate-in fade-in zoom-in duration-200">
            <div className="flex flex-col items-center text-center">
              <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-4 ${isRedTone ? 'bg-red-100' : 'bg-yellow-100'}`}>
                <AlertTriangle className={`w-6 h-6 ${isRedTone ? 'text-red-600' : 'text-yellow-600'}`} aria-hidden="true" />
              </div>
              <h3 id="confirm-dialog-title" className="text-lg font-bold text-gray-900 mb-2">
                {state.title}
              </h3>
              {/* `whitespace-pre-line`: hay avisos que enumeran consecuencias en varias líneas
                  y sin esto se aplastaban en un párrafo corrido. */}
              <p id="confirm-dialog-message" className="text-gray-500 text-center mb-6 text-sm whitespace-pre-line">
                {state.message}
              </p>

              <div className="flex flex-col gap-3 w-full">
                {state.tone === 'phytosanitary_warning' ? (
                  <>
                    {/* Aquí la opción segura va ARRIBA y en verde: renunciar al tratamiento es
                        la decisión con consecuencias, no aceptarlo. */}
                    <button
                      ref={safeButtonRef}
                      type="button"
                      onClick={closeConfirm}
                      disabled={busy}
                      className="w-full bg-green-600 text-white hover:bg-green-700 shadow-lg shadow-green-600/20 py-3 px-4 rounded-xl font-bold transition-colors disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2"
                    >
                      {state.cancelLabel}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleConfirm()}
                      disabled={busy}
                      className="w-full bg-white text-red-600 border border-red-200 hover:bg-red-50 py-3 px-4 rounded-xl font-bold transition-colors disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
                    >
                      {busy ? 'Un momento…' : state.confirmLabel}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => void handleConfirm()}
                      disabled={busy}
                      className={`w-full text-white py-3 px-4 rounded-xl font-bold transition-colors flex items-center justify-center disabled:opacity-60 focus-visible:outline-none focus-visible:ring-offset-2 focus-visible:outline-none focus-visible:ring-2 ${
                        state.tone === 'danger'
                          ? 'bg-red-600 hover:bg-red-700 shadow-lg shadow-red-600/20 focus-visible:ring-red-500'
                          : 'bg-amber-600 hover:bg-amber-700 shadow-lg shadow-amber-600/20 focus-visible:ring-amber-500'
                      }`}
                    >
                      {busy ? 'Un momento…' : state.confirmLabel}
                    </button>
                    <button
                      ref={safeButtonRef}
                      type="button"
                      onClick={closeConfirm}
                      disabled={busy}
                      className="w-full bg-white text-gray-700 border border-gray-200 py-3 px-4 rounded-xl font-bold hover:bg-gray-50 transition-colors disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2"
                    >
                      {state.cancelLabel}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )
    : null;

  return { openConfirm, closeConfirm, confirmDialog, isConfirmBusy: busy };
}
