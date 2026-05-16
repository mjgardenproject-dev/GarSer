import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useBooking } from "../../contexts/BookingContext";
import { MapPin, Calendar, Clock, User, CreditCard } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { persistBookingMedia, uploadBookingPhotos } from '../../utils/bookingMediaService';
import { isHighestOpenRangeForSpecies } from '../../domain/speciesBusinessRules';
import toast from 'react-hot-toast';
import { createAtomicBooking } from '../../utils/bookingAtomicService';
import { reportBookingEvent } from '../../utils/bookingTelemetry';
import {
  clearBookingResumeStorage,
  readAnyBookingResume,
  writeBookingResume,
} from '../../utils/bookingResumeStorage';
import { createAuthoritativeQuote } from '../../utils/bookingAuthorityService';

const ConfirmationPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { bookingData, resetBooking, setCurrentStep, setBookingData } = useBooking();
  const [isProcessing, setIsProcessing] = useState(false);
  const [serviceNames, setServiceNames] = useState<string[]>([]);
  const [gardenerName, setGardenerName] = useState<string>('');
  const { user } = useAuth();
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authInfo, setAuthInfo] = useState('');
  const [showOtpOption, setShowOtpOption] = useState(false);
  const [breakdown, setBreakdown] = useState<Array<{ desc: string; price: number }>>([]);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const currencyFormatter = useMemo(
    () => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }),
    []
  );
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat('es-ES', { dateStyle: 'long' }),
    []
  );
  const collectStructuredPhotoUrls = (): string[] => {
    const out = new Set<string>();
    const maybePush = (value: unknown) => {
      const v = String(value || '').trim();
      if (v.startsWith('http://') || v.startsWith('https://')) out.add(v);
    };
    const collectGroupPhotoUrls = (arr: any[]) => {
      (arr || []).forEach((item) => {
        (item?.photoUrls || []).forEach((u: unknown) => maybePush(u));
      });
    };

    const activeServiceId = bookingData.serviceIds?.[0] || '';
    (bookingData.servicesData?.[activeServiceId]?.uploadedPhotoUrls || []).forEach((u: unknown) => maybePush(u));
    collectGroupPhotoUrls((bookingData as any).lawnZones || []);
    collectGroupPhotoUrls((bookingData as any).palmGroups || []);
    collectGroupPhotoUrls((bookingData as any).hedgeZones || []);
    collectGroupPhotoUrls((bookingData as any).treeGroups || []);
    collectGroupPhotoUrls((bookingData as any).shrubGroups || []);
    collectGroupPhotoUrls((bookingData as any).phytosanitaryZones || []);
    collectGroupPhotoUrls((bookingData as any).weedingZones || []);

    return Array.from(out);
  };

  const buildPricingContext = () => {
    const palmGroups = (bookingData.palmGroups || []).map((group: any) => {
      const isTerminalOpenRange = typeof group?.isTerminalOpenRange === 'boolean'
        ? group.isTerminalOpenRange
        : isHighestOpenRangeForSpecies(group?.species || '', group?.height || '');
      return {
        species: group?.species || '',
        height: group?.height || '',
        quantity: Number(group?.quantity || 0),
        is_terminal_open_range: isTerminalOpenRange,
      };
    });
    const allowsPriceChange = palmGroups.some((group: any) => group.quantity > 0 && group.is_terminal_open_range === true);
    const isPalmPruningService = palmGroups.length > 0;

    return {
      service_type: isPalmPruningService ? 'palm_pruning' : 'standard',
      allows_price_change: isPalmPruningService ? allowsPriceChange : true,
      palm_groups: palmGroups,
    };
  };

  useEffect(() => {
    if (Array.isArray(bookingData.priceBreakdown) && bookingData.priceBreakdown.length > 0) {
      setBreakdown(bookingData.priceBreakdown);
      return;
    }
    setBreakdown([]);
  }, [bookingData.priceBreakdown]);

  const handleConfirmBooking = async () => {
    setIsProcessing(true);
    
    try {
      if (!user) {
        setIsProcessing(false);
        setAuthError('Necesitas identificarte para confirmar.');
        return;
      }
      const parseStartTime = (slot: string) => {
        const m = (slot || '').match(/(\d{2}):(\d{2})/);
        return m ? `${m[1]}:${m[2]}:00` : null;
      };
      const startTime = parseStartTime(bookingData.timeSlot);
      if (!startTime) {
        throw new Error('No se pudo determinar la hora de inicio');
      }
      const startHourBlock = parseInt(startTime.split(':')[0], 10);

      const authoritativeQuote = await createAuthoritativeQuote({
        bookingData,
        serviceId: bookingData.serviceIds?.[0] || '',
        providerId: bookingData.providerId || '',
      });

      const photosArray = Array.isArray(bookingData.photos) ? bookingData.photos : [];
      const uploadedMedia = photosArray.length > 0
        ? await uploadBookingPhotos({
            clientId: user.id,
            date: bookingData.preferredDate || '',
            startHour: startHourBlock,
            files: photosArray,
          })
        : [];

      const structuredPhotoUrls = collectStructuredPhotoUrls();
      const notesWithPhotos = [
        bookingData.description || '',
        bookingData.palmSpecies ? `Especie de palmera: ${bookingData.palmSpecies}` : ''
      ].filter(Boolean).join('\n\n');
      const booking = await createAtomicBooking({
        providerId: bookingData.providerId || '',
        serviceId: bookingData.serviceIds?.[0] || '',
        date: bookingData.preferredDate,
        startTime,
        durationHours: Math.max(1, Number(authoritativeQuote.estimatedHours || 1)),
        totalPrice: Math.max(0, Number(authoritativeQuote.totalPrice || 0)),
        clientAddress: bookingData.address || '',
        notes: notesWithPhotos,
        pricingContext: buildPricingContext(),
        quoteId: authoritativeQuote.quoteId,
      });
      if (booking?.booking_id && (uploadedMedia.length > 0 || structuredPhotoUrls.length > 0)) {
        try {
          await persistBookingMedia({
            bookingId: booking.booking_id,
            uploaderId: user?.id || null,
            mediaItems: [
              ...uploadedMedia,
              ...structuredPhotoUrls.map((url) => ({ url })),
            ],
          });
        } catch (mediaError) {
          console.warn('No se pudieron persistir fotos estructuradas de la reserva:', mediaError);
          reportBookingEvent('warn', {
            event: 'booking.media_persist_failed',
            context: {
              bookingId: booking.booking_id,
              providerId: bookingData.providerId,
              serviceId: bookingData.serviceIds?.[0],
            },
          });
        }
      }

      setBookingData({
        estimatedHours: authoritativeQuote.estimatedHours,
        totalPrice: authoritativeQuote.totalPrice,
        priceBreakdown: authoritativeQuote.breakdown,
        quoteId: authoritativeQuote.quoteId || '',
        quoteSignature: authoritativeQuote.signature || '',
        quoteExpiresAt: authoritativeQuote.expiresAt || '',
        quotePricingVersion: authoritativeQuote.pricingVersion || '',
        quoteProviderConfigVersion: authoritativeQuote.providerConfigVersion || '',
      });

      // Limpiar el estado y redirigir a lista de reservas
      resetBooking();
      clearBookingResumeStorage();
      toast.success('Reserva creada correctamente');
      navigate('/bookings');
      
    } catch (error) {
      console.error('Error creating booking:', error);
      const message = error instanceof Error ? error.message : 'Error al crear la reserva.';
      reportBookingEvent('error', {
        event: 'booking.confirmation_failed',
        context: {
          providerId: bookingData.providerId,
          serviceId: bookingData.serviceIds?.[0],
          preferredDate: bookingData.preferredDate,
          timeSlot: bookingData.timeSlot,
          message,
        },
      });
      if (message.includes('presupuesto') || message.includes('quote')) {
        toast.error('El presupuesto ha caducado o ya no es válido. Revisa la selección y vuelve a confirmar.');
      } else if (message.includes('disponible')) {
        toast.error(message);
      } else if (message.includes('foto') || message.includes('storage')) {
        toast.error('No se pudieron procesar las fotos de la reserva. Reintenta la subida.');
      } else {
        toast.error('Error al crear la reserva. Por favor, inténtalo de nuevo.');
      }
    } finally {
      setIsProcessing(false);
    }
  };

  useEffect(() => {
    const fetchNames = async () => {
      try {
        if (Array.isArray(bookingData.serviceIds) && bookingData.serviceIds.length > 0) {
          const { data } = await supabase
            .from('services')
            .select('id,name')
            .in('id', bookingData.serviceIds);
          setServiceNames((data || []).map((s: any) => {
            if (s.name.toLowerCase().includes('fumigación') || s.name.toLowerCase().includes('fumigacion') || s.name.toLowerCase().includes('tratamientos fitosanitarios')) {
              return 'Servicios fitosanitarios';
            }
            return s.name;
          }));
        } else {
          setServiceNames([]);
        }
      } catch {
        setServiceNames([]);
      }
      try {
        if (bookingData.providerId) {
          const { data } = await supabase
            .from('gardener_profiles')
            .select('full_name')
            .eq('user_id', bookingData.providerId)
            .maybeSingle();
          setGardenerName((data as any)?.full_name || '');
        } else {
          setGardenerName('');
        }
      } catch {
        setGardenerName('');
      }
    };
    fetchNames();
  }, [bookingData.serviceIds.join(','), bookingData.providerId]);

  const displayServices = useMemo(() => {
    return serviceNames.length > 0 ? serviceNames.join(', ') : 'Servicio';
  }, [serviceNames]);

  const calculateTotal = () => Math.max(0, Number(bookingData.totalPrice || 0));
  const formattedDate = useMemo(() => {
    if (!bookingData.preferredDate) {
      return 'Fecha pendiente';
    }

    const parsed = new Date(`${bookingData.preferredDate}T12:00:00`);
    return Number.isNaN(parsed.getTime()) ? bookingData.preferredDate : dateFormatter.format(parsed);
  }, [bookingData.preferredDate, dateFormatter]);
  const buildResume = () => {
    const snapshot = {
      address: bookingData.address,
      serviceIds: bookingData.serviceIds,
      description: bookingData.description,
      preferredDate: bookingData.preferredDate,
      timeSlot: bookingData.timeSlot,
      providerId: bookingData.providerId,
      estimatedHours: bookingData.estimatedHours,
      totalPrice: bookingData.totalPrice,
      palmSpecies: bookingData.palmSpecies,
      priceBreakdown: bookingData.priceBreakdown,
      quoteId: bookingData.quoteId,
      quoteSignature: bookingData.quoteSignature,
      quoteExpiresAt: bookingData.quoteExpiresAt,
      quotePricingVersion: bookingData.quotePricingVersion,
      quoteProviderConfigVersion: bookingData.quoteProviderConfigVersion
    };
    try { return encodeURIComponent(btoa(JSON.stringify(snapshot))); } catch { return ''; }
  };
  const redirectUrl = `${window.location.origin}/reserva/confirmacion?auth=1${bookingData.serviceIds?.length ? `&resume=${buildResume()}` : ''}`;

  const handleCreateAccount = async () => {
    try {
      setAuthLoading(true);
      setAuthError('');
      setAuthInfo('');
      const { error } = await supabase.auth.signUp({
        email: authEmail.trim(),
        password: authPassword,
        options: { emailRedirectTo: redirectUrl }
      });
      if (error) {
        const msg = (error.message || '').toLowerCase();
        if (msg.includes('already')) {
          setAuthError('Este email ya tiene una cuenta. Inicia sesión para continuar');
          setShowOtpOption(false);
        } else {
          setAuthError('No se pudo registrar. Revisa el email y la contraseña.');
        }
      } else {
        writeBookingResume('confirmation', 'wizard', bookingData, { userId: user?.id });
        setAuthInfo('Te hemos enviado un email para confirmar tu cuenta');
      }
    } finally {
      setAuthLoading(false);
    }
  };

  useEffect(() => {
    // Restaurar snapshot si viene en el enlace o desde almacenamiento
    const params = new URLSearchParams(location.search);
    const resume = params.get('resume');
    if (resume) {
      try {
        const json = JSON.parse(atob(decodeURIComponent(resume)));
        setBookingData(json);
        writeBookingResume('confirmation', 'wizard', json, { userId: user?.id });
      } catch {}
    }
    if (!resume) {
      try {
        const stored = readAnyBookingResume<any>({
          userId: user?.id,
          flow: 'wizard',
          allowAnonFallback: true,
        });
        const json = stored?.stage === 'confirmation' ? stored.payload : null;
        if (json) {
          setBookingData(json);
          clearBookingResumeStorage();
          writeBookingResume('confirmation', 'wizard', json, { userId: user?.id });
        }
      } catch {}
    }
    // Escuchar cambio de sesión para ocultar bloque auth cuando supabase complete el redirect
    const { data: sub } = supabase.auth.onAuthStateChange((event: string, session: any) => {
      if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session?.user) {
        setAuthInfo('Sesión iniciada. Ya puedes confirmar la reserva.');
      }
    });
    return () => { sub.subscription.unsubscribe(); };
  }, [location.search, setBookingData, user?.id]);

  const handleLogin = async () => {
    try {
      setAuthLoading(true);
      setAuthError('');
      setAuthInfo('');
      const { error } = await supabase.auth.signInWithPassword({
        email: authEmail.trim(),
        password: authPassword
      });
      if (error) {
        const msg = (error.message || '').toLowerCase();
        const isInvalid = msg.includes('invalid') || msg.includes('credentials') || (error as any)?.status === 400;
        if (isInvalid) {
          // Escenario 3: contraseña incorrecta
          setAuthError('La contraseña es incorrecta');
          setShowOtpOption(true);
          return;
        }
        // Escenario potencial de usuario no existente: no crear cuenta automáticamente
        setAuthError('No existe una cuenta con este email');
        setShowOtpOption(false);
      } else {
        setAuthInfo('Sesión iniciada. Ya puedes confirmar la reserva.');
      }
    } finally {
      setAuthLoading(false);
    }
  };
  const handleOtpVerify = async () => {
    try {
      setAuthLoading(true);
      setAuthError('');
      setAuthInfo('');
      const { error } = await supabase.auth.signInWithOtp({
        email: authEmail.trim(),
        options: { emailRedirectTo: redirectUrl }
      } as any);
      if (error) {
        setAuthError('No se pudo enviar el email de verificación.');
      } else {
        writeBookingResume('confirmation', 'wizard', bookingData, { userId: user?.id });
        setAuthInfo('Te hemos enviado un enlace para continuar con tu reserva');
      }
    } finally {
      setAuthLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Contenido compacto */}
      <div className="max-w-md mx-auto px-4 py-3 pb-40">
        <div className="flex justify-end mb-2">
          <button
            type="button"
            onClick={() => setCurrentStep(3)}
            aria-label="Volver al paso de selección de jardinero"
            className="px-3 py-2 text-sm bg-white border border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
          >
            Volver
          </button>
        </div>

        {/* Booking Summary */}
        <div className="bg-white rounded-2xl shadow-sm p-3 mb-3">
          <h3 className="text-base font-semibold text-gray-900 mb-2">Resumen</h3>

          {/* Location */}
          <div className="flex items-start space-x-3 mb-3">
            <MapPin aria-hidden="true" className="w-5 h-5 text-gray-400 mt-0.5" />
            <div>
              <p className="font-medium text-gray-900">Ubicación</p>
              <p className="text-sm text-gray-600">{bookingData.address}</p>
            </div>
          </div>

          {/* Services */}
          <div className="flex items-start space-x-3 mb-3">
            <Calendar aria-hidden="true" className="w-5 h-5 text-gray-400 mt-0.5" />
            <div>
              <p className="font-medium text-gray-900">Servicios</p>
              <p className="text-sm text-gray-600">{displayServices}</p>
            </div>
          </div>

          {/* Date & Time */}
          <div className="flex items-start space-x-3 mb-3">
            <Clock aria-hidden="true" className="w-5 h-5 text-gray-400 mt-0.5" />
            <div>
              <p className="font-medium text-gray-900">Fecha y hora</p>
              <p className="text-sm text-gray-600">
                {formattedDate} a las {bookingData.timeSlot}
              </p>
            </div>
          </div>

          {/* Provider */}
          <div className="flex items-start space-x-3 mb-3">
            <User aria-hidden="true" className="w-5 h-5 text-gray-400 mt-0.5" />
            <div>
              <p className="font-medium text-gray-900">Jardinero</p>
              <p className="text-sm text-gray-600">{gardenerName || 'Jardinero'}</p>
            </div>
          </div>

          

          {/* Description */}
          {bookingData.description && (
            <div className="flex items-start space-x-3 mb-4">
              <Calendar aria-hidden="true" className="w-5 h-5 text-gray-400 mt-0.5" />
              <div>
                <p className="font-medium text-gray-900">Descripción</p>
                <p className="text-sm text-gray-600">{bookingData.description}</p>
              </div>
            </div>
          )}

          {/* Breakdown Toggle */}
          {breakdown.length > 0 && (
             <div className="mb-4">
                 <button
                     type="button"
                     onClick={() => setShowBreakdown(!showBreakdown)}
                    aria-expanded={showBreakdown}
                     className="text-xs font-medium text-green-600 underline hover:text-green-700 flex items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
                 >
                     {showBreakdown ? 'Ocultar desglose' : 'Ver desglose detallado'}
                 </button>
                 {showBreakdown && (
                     <div className="mt-2 bg-gray-50 rounded-lg p-3 space-y-2 border border-gray-100">
                         {breakdown.map((item, i) => (
                             <div key={i} className="flex justify-between text-xs">
                                 <span className="text-gray-600 truncate mr-2">{item.desc}</span>
                                <span className="font-medium text-gray-900 whitespace-nowrap">{currencyFormatter.format(item.price)}</span>
                             </div>
                         ))}
                     </div>
                 )}
             </div>
          )}

          {/* Divider */}
          <div className="border-t border-gray-200 pt-3">
            <div className="flex justify-between items-center">
              <span className="text-base font-semibold text-gray-900">Importe estimado</span>
              <span className="text-xl font-bold text-green-600 tabular-nums">{currencyFormatter.format(calculateTotal())}</span>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Importe operativo validado para enviar la solicitud. Cualquier ajuste posterior quedará explícito en el chat.
            </p>
          </div>
        </div>

        {/* Payment Method */}
        <div className="bg-white rounded-2xl shadow-sm p-3 mb-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-900">Método de pago</h3>
            <CreditCard className="w-4 h-4 text-gray-400" aria-hidden="true" />
          </div>
          <p className="text-xs text-gray-600">
            No se realiza ningún cobro en esta pantalla. Solo enviamos una solicitud con importe estimado validado y cualquier pago futuro se gestionará fuera de este paso.
          </p>
        </div>

        {/* Terms */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-3">
          <p className="text-xs text-blue-800">
            Al confirmar, aceptas nuestros términos y condiciones y la política de privacidad.
          </p>
        </div>

        {!user && (
          <div className="bg-white rounded-2xl shadow-sm p-3 mb-3 border border-gray-200">
            <div className="text-sm font-semibold text-gray-900 mb-2">Identifícate para continuar con la reserva</div>
            <div className="space-y-2">
              <label htmlFor="booking-auth-email" className="sr-only">Correo electrónico</label>
              <input
                id="booking-auth-email"
                type="email"
                name="email"
                autoComplete="email"
                spellCheck={false}
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                placeholder="Correo electrónico…"
                className="w-full px-3 py-2 border border-gray-300 rounded-xl text-base sm:text-sm"
              />
              <label htmlFor="booking-auth-password" className="sr-only">Contraseña</label>
              <input
                id="booking-auth-password"
                type="password"
                name="password"
                autoComplete="current-password"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                placeholder="Contraseña…"
                className="w-full px-3 py-2 border border-gray-300 rounded-xl text-base sm:text-sm"
              />
              {authError && <div className="text-xs text-red-600" aria-live="polite">{authError}</div>}
              {authInfo && <div className="text-xs text-green-700" aria-live="polite">{authInfo}</div>}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleLogin}
                  disabled={authLoading || !authEmail || !authPassword}
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white py-2 rounded-xl text-sm disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2"
                >
                  Iniciar sesión
                </button>
                <button
                  type="button"
                  onClick={handleCreateAccount}
                  disabled={authLoading || !authEmail || !authPassword}
                  className="flex-1 bg-white border border-gray-300 text-gray-800 hover:bg-gray-50 py-2 rounded-xl text-sm disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2"
                >
                  Crear cuenta
                </button>
              </div>
              {showOtpOption && (
                <div className="flex items-center justify-end mt-2">
                  <button
                    type="button"
                    onClick={handleOtpVerify}
                    disabled={authLoading || !authEmail}
                    className="text-xs text-gray-700 hover:text-gray-800 underline"
                  >
                    Continuar sin contraseña
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Fixed CTA */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 pt-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] z-50">
        <div className="max-w-md mx-auto">
          <button
            type="button"
            onClick={handleConfirmBooking}
            disabled={isProcessing || !user}
            className="w-full bg-gradient-to-r from-green-600 to-emerald-600 text-white py-4 px-6 rounded-2xl font-semibold text-lg shadow-lg hover:shadow-xl hover:scale-[1.02] motion-reduce:transform-none transition-transform duration-200 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2"
          >
            {isProcessing ? (
              <div className="flex items-center justify-center" aria-live="polite">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                Procesando…
              </div>
            ) : (
              'Confirmar reserva'
            )}
          </button>
          <p className="text-center text-gray-500 text-sm mt-3">
            Cancelación gratuita hasta 24h antes
          </p>
        </div>
      </div>
    </div>
  );
};

export default ConfirmationPage;
