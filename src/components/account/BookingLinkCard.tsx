import React from 'react';
import { Copy, Link as LinkIcon, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useMyBookingLink } from '../../hooks/useMyBookingLink';
import { buildProviderBookingUrl } from '../../shared/providerLinkUrl';
import { useConfirmDialog } from '../common/ConfirmDialog';

/**
 * «Enlace de reserva directo» del profesional (autónomo o empresa).
 *
 * El enlace lleva una clave personal (`?c=`): solo las reservas que entren por él cuentan como
 * clientes del profesional. Sin la clave el enlace sigue abriendo su perfil, pero la reserva paga como
 * la de cualquier cliente de GarSer. Por eso el enlace no se puede construir sin ella.
 */
const BookingLinkCard: React.FC = () => {
  const { state, reload, rotate, rotating } = useMyBookingLink(true);
  const { openConfirm, confirmDialog } = useConfirmDialog();

  const url =
    state.status === 'ready'
      ? buildProviderBookingUrl({ origin: window.location.origin, providerId: state.providerId, code: state.code })
      : '';

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Enlace copiado');
    } catch {
      toast.error('No se pudo copiar');
    }
  };

  const askRotate = () => {
    openConfirm({
      title: '¿Cambiar tu enlace?',
      message:
        'Tu enlace actual y todos los QR o mensajes que lo lleven dejarán de servir para reservar sin gastos de gestión (seguirán abriendo tu perfil). Tendrás que volver a repartir el nuevo.',
      confirmLabel: 'Sí, cambiar mi enlace',
      cancelLabel: 'No, dejarlo como está',
      tone: 'warning',
      onConfirm: async () => {
        const ok = await rotate();
        if (ok) toast.success('Enlace cambiado. Reparte el nuevo.');
        else toast.error('No se ha podido cambiar el enlace. Inténtalo de nuevo.');
      },
    });
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 sm:p-6 shadow-sm hover:shadow-lg transition-shadow">
      <div className="flex items-center mb-3">
        <LinkIcon className="w-5 h-5 text-green-600 mr-2" />
        <div className="text-lg font-semibold text-gray-900">Enlace de reserva directo</div>
      </div>

      {state.status === 'loading' && (
        <p className="inline-flex items-center gap-2 text-sm text-gray-500" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Cargando tu enlace…
        </p>
      )}

      {state.status === 'error' && (
        <div role="alert" className="text-sm text-red-700">
          <p>No se ha podido cargar tu enlace. Sin él no se puede repartir ni imprimir.</p>
          <button
            type="button"
            onClick={() => void reload()}
            className="mt-2 inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-red-300 bg-white px-4 py-2 font-semibold text-red-800 hover:bg-red-50"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> Reintentar
          </button>
        </div>
      )}

      {state.status === 'ready' && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-center">
            <div className="md:col-span-5">
              <input
                aria-label="Tu enlace de reserva"
                value={url}
                readOnly
                className="w-full p-3 border border-gray-300 rounded-lg bg-white text-gray-800 text-base sm:text-sm"
              />
            </div>
            <div className="md:col-span-1">
              <button
                type="button"
                onClick={() => void copy()}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-emerald-700 text-white rounded-lg hover:bg-emerald-800"
              >
                <Copy className="w-4 h-4" />
                Copiar
              </button>
            </div>
          </div>
          <p className="mt-3 text-sm text-gray-600">
            Es tu enlace personal: compártelo con tus clientes. Lleva una clave que solo ves tú; las reservas que
            entren por él cuentan como tus clientes.
          </p>
          <button
            type="button"
            onClick={askRotate}
            disabled={rotating}
            className="mt-2 inline-flex min-h-[44px] items-center gap-2 rounded-lg px-1 text-sm font-medium text-gray-600 underline hover:text-gray-900 disabled:opacity-60"
          >
            {rotating && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Cambiar mi enlace
          </button>
        </>
      )}
      {confirmDialog}
    </div>
  );
};

export default BookingLinkCard;
