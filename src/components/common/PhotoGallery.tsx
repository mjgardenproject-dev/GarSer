import React, { useState, useEffect, useCallback } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';

interface PhotoGalleryProps {
  urls: string[];
  /** Miniaturas visibles antes del "+N" (por defecto 4, una fila en móvil). */
  maxThumbs?: number;
  label?: string;
}

// Galería de fotos con visor interno (lightbox): las miniaturas ya no abren
// pestañas nuevas — en móvil eso saca al usuario de la app.
const PhotoGallery: React.FC<PhotoGalleryProps> = ({ urls, maxThumbs = 4, label }) => {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const close = useCallback(() => setOpenIndex(null), []);
  const step = useCallback((delta: number) => {
    setOpenIndex((prev) => {
      if (prev === null) return prev;
      return (prev + delta + urls.length) % urls.length;
    });
  }, [urls.length]);

  // Teclado (desktop) y bloqueo de scroll de fondo mientras el visor está abierto
  useEffect(() => {
    if (openIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowLeft') step(-1);
      if (e.key === 'ArrowRight') step(1);
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = 'unset';
    };
  }, [openIndex, close, step]);

  if (!urls || urls.length === 0) return null;

  const visible = urls.slice(0, maxThumbs);
  const hidden = urls.length - visible.length;

  return (
    <div>
      {label && <p className="text-sm font-medium text-gray-700 mb-2">{label}</p>}
      <div className="grid grid-cols-4 gap-2">
        {visible.map((url, i) => {
          const isLast = i === visible.length - 1 && hidden > 0;
          return (
            <button
              key={url}
              type="button"
              onClick={() => setOpenIndex(i)}
              className="relative block rounded-lg overflow-hidden border border-gray-200 bg-gray-50 aspect-square"
              aria-label={`Ver foto ${i + 1} de ${urls.length}`}
            >
              <img src={url} alt={`Foto ${i + 1}`} className="w-full h-full object-cover" loading="lazy" />
              {isLast && (
                <span className="absolute inset-0 bg-black/50 flex items-center justify-center text-white font-bold text-sm">
                  +{hidden}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {openIndex !== null && (
        <div
          className="fixed inset-0 z-[70] bg-black/90 flex items-center justify-center"
          onClick={close}
          role="dialog"
          aria-label="Visor de fotos"
        >
          <button
            className="absolute top-[calc(0.75rem+env(safe-area-inset-top))] right-3 p-2 text-white/80 hover:text-white z-10"
            onClick={close}
            aria-label="Cerrar visor"
          >
            <X className="w-7 h-7" />
          </button>
          <span className="absolute top-[calc(1rem+env(safe-area-inset-top))] left-4 text-white/90 text-sm font-medium">
            {openIndex + 1} / {urls.length}
          </span>

          {urls.length > 1 && (
            <>
              <button
                className="absolute left-1 sm:left-3 p-2.5 text-white/70 hover:text-white z-10"
                onClick={(e) => { e.stopPropagation(); step(-1); }}
                aria-label="Foto anterior"
              >
                <ChevronLeft className="w-8 h-8" />
              </button>
              <button
                className="absolute right-1 sm:right-3 p-2.5 text-white/70 hover:text-white z-10"
                onClick={(e) => { e.stopPropagation(); step(1); }}
                aria-label="Foto siguiente"
              >
                <ChevronRight className="w-8 h-8" />
              </button>
            </>
          )}

          <img
            src={urls[openIndex]}
            alt={`Foto ${openIndex + 1} de ${urls.length}`}
            className="max-w-full max-h-full object-contain px-10"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
};

export default PhotoGallery;
