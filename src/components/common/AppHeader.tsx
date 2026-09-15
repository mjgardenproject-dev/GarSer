import React from 'react';
import { ArrowLeft } from 'lucide-react';

/**
 * Header estándar para pantallas internas con navegación propia (Mis Reservas, Mis
 * Chats, Mi Cuenta, Gestión de Disponibilidad, ...). Ver docs/design-system.md §5.
 *
 * `children` permite añadir filas adicionales debajo de la principal (selector de
 * subpágina, botón de guardado) — cada pantalla decide si las necesita.
 */

interface AppHeaderProps {
  title: string;
  onBack?: () => void;
  backLabel?: string;
  rightSlot?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

const AppHeader: React.FC<AppHeaderProps> = ({
  title,
  onBack,
  backLabel = 'Volver',
  rightSlot,
  children,
  className = '',
}) => {
  return (
    <header
      className={`sticky top-0 z-40 border-b border-gray-200 bg-white/95 backdrop-blur ${className}`}
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="-ml-1 inline-flex shrink-0 items-center gap-1.5 rounded-lg p-1.5 text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
            aria-label={backLabel}
          >
            <ArrowLeft className="h-5 w-5" />
            <span className="hidden text-sm font-medium sm:inline">{backLabel}</span>
          </button>
        )}

        <h1 className="flex-1 truncate text-lg font-bold text-gray-900">{title}</h1>

        {rightSlot && <div className="shrink-0">{rightSlot}</div>}
      </div>

      {children && <div className="flex flex-col gap-2 px-4 pb-3">{children}</div>}
    </header>
  );
};

export default AppHeader;
