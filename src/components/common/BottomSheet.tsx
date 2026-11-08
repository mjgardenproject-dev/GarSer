import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/**
 * Hoja que sube desde abajo (móvil) y queda centrada en pantallas grandes. La usan las decisiones
 * que merecen una pausa pero no una página: «Añade a tu equipo», «Ya tienes equipo»…
 *
 * Lo mínimo de un diálogo bien hecho: semántica de diálogo, cierre con Escape y tocando fuera, el
 * foco entra en la hoja y vuelve a donde estaba, el fondo no se desplaza, y respeta la zona segura
 * del iPhone (nada queda bajo la barra de inicio).
 */
interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Texto corto bajo el título. */
  description?: string;
  children: React.ReactNode;
  /** `false` si cerrar no debe ser posible mientras algo se envía. */
  dismissible?: boolean;
}

const BottomSheet: React.FC<Props> = ({ open, onClose, title, description, children, dismissible = true }) => {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const returnFocusTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    returnFocusTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // El foco entra en la hoja (el botón de cerrar es lo primero que se alcanza con el teclado).
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && dismissible) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      returnFocusTo.current?.focus?.();
    };
  }, [open, onClose, dismissible]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9990] flex items-end justify-center sm:items-center" role="presentation">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={dismissible ? onClose : undefined}
        aria-hidden="true"
        data-testid="bottom-sheet-backdrop"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className="relative flex max-h-[90dvh] w-full flex-col rounded-t-3xl bg-white shadow-2xl outline-none sm:max-w-md sm:rounded-3xl"
      >
        <div className="flex items-start justify-between gap-3 px-5 pb-2 pt-5">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-bold leading-snug text-gray-900">{title}</h2>
            {description && <p id={descriptionId} className="mt-1 text-sm text-gray-600">{description}</p>}
          </div>
          {dismissible && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar"
              className="-mr-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 [touch-action:manipulation]"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-2">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default BottomSheet;
