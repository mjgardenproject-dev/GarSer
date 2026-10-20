import React, { useEffect, useRef, useState } from 'react';
import { renderMaterial } from '../../utils/marketing/renderMaterial';
import type { MaterialId, MaterialSize } from '../../utils/marketing/materials';
import type { MarketingContent } from '../../utils/marketing/content';

// Vista previa de un material: el mismo dibujo que se descarga, a menos resolución. Se repinta
// poco después de cada cambio (no en cada tecla) y deja la anterior a la vista mientras tanto.

let queue: Promise<unknown> = Promise.resolve();
/** Una vista previa detrás de otra: así 8 miniaturas no se pelean por el procesador del móvil. */
const enqueue = <T,>(job: () => Promise<T>) => {
  const next = queue.then(job, job);
  queue = next.catch(() => undefined);
  return next;
};

interface Props {
  material: MaterialId;
  size: MaterialSize;
  content: MarketingContent;
  avatar: HTMLImageElement | null;
  /** Lado más largo de la vista previa, en px reales. */
  maxSide: number;
  className?: string;
  label: string;
  delayMs?: number;
}

const MaterialPreview: React.FC<Props> = ({ material, size, content, avatar, maxSide, className = '', label, delayMs = 150 }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void enqueue(async () => {
        if (cancelled || !canvasRef.current) return;
        try {
          const scale = Math.min(1, maxSide / Math.max(size.width, size.height));
          // Se pinta aparte y se copia de golpe: sin parpadeo mientras se dibuja.
          const work = document.createElement('canvas');
          await renderMaterial(work, { material, size, content, avatar, scale });
          if (cancelled || !canvasRef.current) return;
          const target = canvasRef.current;
          target.width = work.width;
          target.height = work.height;
          target.getContext('2d')?.drawImage(work, 0, 0);
          setFailed(false);
        } catch (error) {
          console.warn('No se pudo pintar la vista previa:', error);
          if (!cancelled) setFailed(true);
        }
      });
    }, delayMs);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [material, size, content, avatar, maxSide, delayMs]);

  return (
    <div className={`relative ${className}`}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={label}
        className="block h-auto max-h-full w-full max-w-full rounded-xl bg-gray-100 object-contain shadow-sm"
        style={{ aspectRatio: `${size.width} / ${size.height}` }}
      />
      {failed && (
        <p className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-gray-600">No se ha podido dibujar la vista previa.</p>
      )}
    </div>
  );
};

export default MaterialPreview;
