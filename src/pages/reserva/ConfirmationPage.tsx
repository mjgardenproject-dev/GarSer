import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useBooking } from "../../contexts/BookingContext";
import { MapPin, Calendar, Clock, User, CreditCard } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import * as availCompat from '../../utils/availabilityServiceCompat';

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

  const handleConfirmBooking = async () => {
    setIsProcessing(true);
    
    try {
      if (!user) {
        setIsProcessing(false);
        setAuthError('Necesitas identificarte para confirmar.');
        return;
      }
      // Aquí iría la lógica real de creación de reserva
      // Por ahora simulamos una reserva exitosa
      
      // Subir fotos a Supabase Storage
      const photoUrls: string[] = [];
      const photosArray = Array.isArray(bookingData.photos) ? bookingData.photos : [];
      for (const photo of photosArray) {
        const fileName = `booking_${Date.now()}_${photo.name}`;
        const { data, error } = await supabase.storage
          .from('booking-photos')
          .upload(fileName, photo);
        
        if (!error && data) {
          const { data: { publicUrl } } = supabase.storage
            .from('booking-photos')
            .getPublicUrl(fileName);
          
          if (publicUrl) {
            photoUrls.push(publicUrl);
          }
        }
      }

      // Preparar payload según el esquema de la tabla 'bookings'
      const parseStartTime = (slot: string) => {
        const m = (slot || '').match(/(\d{2}):(\d{2})/);
        return m ? `${m[1]}:${m[2]}:00` : null;
      };
      const startTime = parseStartTime(bookingData.timeSlot);
      if (!startTime) {
        throw new Error('No se pudo determinar la hora de inicio');
      }
      const startHourBlock = parseInt(startTime.split(':')[0], 10);
      const duration = Math.max(1, Number(bookingData.estimatedHours || 1));
      // Filtrar bloques para asegurar que no excedan las 20:00 (último bloque permitido es 19, que termina a las 20)
      const hourBlocks = Array.from({ length: duration }, (_, i) => startHourBlock + i).filter(h => h >= 0);
      const availability = await availCompat.getGardenerAvailability(bookingData.providerId || '', bookingData.preferredDate || '');
      const availSet = new Set<number>(((availability || []) as any[]).filter((b: any) => b.is_available).map((b: any) => b.hour_block));
      const fitsAvailability = hourBlocks.every(h => availSet.has(h));
      if (!fitsAvailability) {
        alert('La hora seleccionada no cabe en la disponibilidad del jardinero');
        setIsProcessing(false);
        return;
      }
      const notesWithPhotos = [bookingData.description || '', photoUrls.length > 0 ? `Fotos:\n${photoUrls.join('\n')}` : ''].filter(Boolean).join('\n\n');
      const row = {
        client_id: user?.id || null,
        gardener_id: bookingData.providerId || null,
        service_id: bookingData.serviceIds?.[0] || null,
        date: bookingData.preferredDate,
        start_time: startTime,
        duration_hours: Math.max(1, Number(bookingData.estimatedHours || 1)),
        status: 'pending',
        total_price: Math.max(0, Number(bookingData.totalPrice || 0)),
        client_address: bookingData.address || '',
        notes: notesWithPhotos,
      };

      const { data: booking, error } = await supabase
        .from('bookings')
        .insert(row)
        .select()
        .single();

      if (error) {
        throw error;
      }
      try {
        if (hourBlocks.length > 0 && bookingData.providerId && bookingData.preferredDate) {
          await availCompat.blockTimeSlots(bookingData.providerId, bookingData.preferredDate, hourBlocks);
        }
      } catch (e) {
        console.warn('No se pudo bloquear disponibilidad, continuar de todas formas:', e);
      }

      // Limpiar el estado y redirigir a lista de reservas
      resetBooking();
      navigate('/bookings');
      
    } catch (error) {
      console.error('Error creating booking:', error);
      alert('Error al crear la reserva. Por favor, inténtalo de nuevo.');
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
          setServiceNames((data || []).map((s: any) => s.name));
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
  const buildResume = () => {
    const snapshot = {
      address: bookingData.address,
      serviceIds: bookingData.serviceIds,
      description: bookingData.description,
      preferredDate: bookingData.preferredDate,
      timeSlot: bookingData.timeSlot,
      providerId: bookingData.providerId,
      estimatedHours: bookingData.estimatedHours,
      totalPrice: bookingData.totalPrice
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
        try { localStorage.setItem('resumeBooking', JSON.stringify(bookingData)); } catch {}
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
        try {
          const progress = { bookingData: json, currentStep: 5, timestamp: new Date().toISOString() };
          localStorage.setItem('bookingProgress', JSON.stringify(progress));
        } catch {}
      } catch {}
    }
    if (!resume) {
      try {
        const raw = localStorage.getItem('resumeBooking');
        if (raw) {
          const json = JSON.parse(raw);
          setBookingData(json);
          localStorage.removeItem('resumeBooking');
          try {
            const progress = { bookingData: json, currentStep: 5, timestamp: new Date().toISOString() };
            localStorage.setItem('bookingProgress', JSON.stringify(progress));
          } catch {}
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
  }, []);

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
        try { localStorage.setItem('resumeBooking', JSON.stringify(bookingData)); } catch {}
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
            onClick={() => setCurrentStep(4)}
            className="px-3 py-2 text-sm bg-white border border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50"
          >
            Volver
          </button>
        </div>

        {/* Booking Summary */}
        <div className="bg-white rounded-2xl shadow-sm p-3 mb-3">
          <h3 className="text-base font-semibold text-gray-900 mb-2">Resumen</h3>

          {/* Location */}
          <div className="flex items-start space-x-3 mb-3">
            <MapPin className="w-5 h-5 text-gray-400 mt-0.5" />
            <div>
              <p className="font-medium text-gray-900">Ubicación</p>
              <p className="text-sm text-gray-600">{bookingData.address}</p>
            </div>
          </div>

          {/* Services */}
          <div className="flex items-start space-x-3 mb-3">
            <Calendar className="w-5 h-5 text-gray-400 mt-0.5" />
            <div>
              <p className="font-medium text-gray-900">Servicios</p>
              <p className="text-sm text-gray-600">{displayServices}</p>
            </div>
          </div>

          {/* Date & Time */}
          <div className="flex items-start space-x-3 mb-3">
            <Clock className="w-5 h-5 text-gray-400 mt-0.5" />
            <div>
              <p className="font-medium text-gray-900">Fecha y hora</p>
              <p className="text-sm text-gray-600">
                {bookingData.preferredDate} a las {bookingData.timeSlot}
              </p>
            </div>
          </div>

          {/* Provider */}
          <div className="flex items-start space-x-3 mb-3">
            <User className="w-5 h-5 text-gray-400 mt-0.5" />
            <div>
              <p className="font-medium text-gray-900">Jardinero</p>
              <p className="text-sm text-gray-600">{gardenerName || 'Jardinero'}</p>
            </div>
          </div>

          

          {/* Description */}
          {bookingData.description && (
            <div className="flex items-start space-x-3 mb-4">
              <Calendar className="w-5 h-5 text-gray-400 mt-0.5" />
              <div>
                <p className="font-medium text-gray-900">Descripción</p>
                <p className="text-sm text-gray-600">{bookingData.description}</p>
              </div>
            </div>
          )}

          {/* Divider */}
          <div className="border-t border-gray-200 pt-3">
            <div className="flex justify-between items-center">
              <span className="text-base font-semibold text-gray-900">Total estimado</span>
              <span className="text-xl font-bold text-green-600">€{calculateTotal()}</span>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Precio final confirmado por el jardinero
            </p>
          </div>
        </div>

        {/* Payment Method */}
        <div className="bg-white rounded-2xl shadow-sm p-3 mb-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-900">Método de pago</h3>
            <CreditCard className="w-4 h-4 text-gray-400" />
          </div>
          <p className="text-xs text-gray-600">Pago seguro con tarjeta tras la confirmación del jardinero.</p>
        </div>

        {/* Terms */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-3">
          <p className="text-xs text-blue-800">
            Al confirmar, aceptas nuestros{' '}
            <button className="text-blue-600 underline hover:text-blue-700">
              términos y condiciones
            </button>
            {' '}y{' '}
            <button className="text-blue-600 underline hover:text-blue-700">
              política de privacidad
            </button>
          </p>
        </div>

        {!user && (
          <div className="bg-white rounded-2xl shadow-sm p-3 mb-3 border border-gray-200">
            <div className="text-sm font-semibold text-gray-900 mb-2">Identifícate para continuar con la reserva</div>
            <div className="space-y-2">
              <input
                type="email"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                placeholder="Correo electrónico"
                className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm"
              />
              <input
                type="password"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                placeholder="Contraseña"
                className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm"
              />
              {authError && <div className="text-xs text-red-600">{authError}</div>}
              {authInfo && <div className="text-xs text-green-700">{authInfo}</div>}
              <div className="flex gap-2">
                <button
                  onClick={handleLogin}
                  disabled={authLoading || !authEmail || !authPassword}
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white py-2 rounded-xl text-sm disabled:opacity-50"
                >
                  Iniciar sesión
                </button>
                <button
                  onClick={handleCreateAccount}
                  disabled={authLoading || !authEmail || !authPassword}
                  className="flex-1 bg-white border border-gray-300 text-gray-800 hover:bg-gray-50 py-2 rounded-xl text-sm disabled:opacity-50"
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
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 z-50">
        <div className="max-w-md mx-auto">
          <button
            onClick={handleConfirmBooking}
            disabled={isProcessing || !user}
            className="w-full bg-gradient-to-r from-green-600 to-emerald-600 text-white py-4 px-6 rounded-2xl font-semibold text-lg shadow-lg hover:shadow-xl transform hover:scale-[1.02] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
          >
            {isProcessing ? (
              <div className="flex items-center justify-center">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                Procesando...
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
