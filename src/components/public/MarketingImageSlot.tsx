import React, { useMemo, useState } from 'react';

import type { MarketingImageSlotKey } from '../../config/publicSiteContent';
import { getMarketingAssetPath, getMarketingAssetUrl } from '../../utils/marketingAssets';

type MarketingImageSlotProps = {
  slot: MarketingImageSlotKey;
  alt: string;
  className?: string;
  imageClassName?: string;
  placeholderLabel?: string;
  priority?: boolean;
  sizes?: string;
};

const MarketingImageSlot: React.FC<MarketingImageSlotProps> = ({
  slot,
  alt,
  className = '',
  imageClassName = '',
  placeholderLabel,
  priority = false,
  sizes,
}) => {
  const [hasError, setHasError] = useState(false);
  const src = useMemo(() => getMarketingAssetUrl(slot), [slot]);
  const assetPath = useMemo(() => getMarketingAssetPath(slot), [slot]);

  if (hasError) {
    // En producción mostramos un placeholder neutro de marca: nunca instrucciones de
    // desarrollo ni rutas internas de Storage de cara al cliente. El detalle técnico
    // (cómo subir la imagen y a qué path) solo se muestra en desarrollo.
    const showDevHelper = import.meta.env.DEV;
    return (
      <div
        className={`relative overflow-hidden rounded-[1.75rem] border border-emerald-100 bg-gradient-to-br from-emerald-50 via-white to-lime-50 ${className}`}
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.12),_transparent_48%),radial-gradient(circle_at_bottom_right,_rgba(132,204,22,0.12),_transparent_44%)]" />
        {showDevHelper ? (
          <div className="relative flex h-full min-h-[220px] flex-col justify-between p-5 text-left">
            <div className="inline-flex w-fit rounded-full border border-emerald-200 bg-white/90 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-700">
              Slot listo para foto real
            </div>
            <div className="max-w-sm">
              <p className="text-lg font-semibold text-slate-900">{placeholderLabel || 'Hueco reservado para imagen real'}</p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Sube el archivo correspondiente a este path en Supabase Storage para reemplazar este bloque sin tocar código.
              </p>
            </div>
            <div className="text-xs font-medium text-slate-500">Path: {assetPath}</div>
          </div>
        ) : (
          <div className="relative flex h-full min-h-[220px] flex-col justify-end p-5 text-left">
            {placeholderLabel ? (
              <p className="text-base font-semibold text-emerald-900/80">{placeholderLabel}</p>
            ) : (
              <span className="sr-only">{alt}</span>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden rounded-[1.75rem] ${className}`}>
      <img
        src={src}
        alt={alt}
        loading={priority ? 'eager' : 'lazy'}
        sizes={sizes}
        onError={() => setHasError(true)}
        className={`h-full w-full object-cover ${imageClassName}`}
      />
    </div>
  );
};

export default MarketingImageSlot;
