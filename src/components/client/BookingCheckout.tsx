import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { Service } from '../../types';
import { broadcastBookingRequest } from '../../utils/bookingBroadcastService';
import toast from 'react-hot-toast';
import { CheckCircle } from 'lucide-react';

type CheckoutPayload = {
  restrictedGardenerId?: string;
  selectedAddress: string;
  selectedServiceIds: string[];
  description?: string;
  estimatedHours: number;
  selectedDate: string;
  startHour: number;
  endHour?: number;
  eligibleGardenerIds: string[];
  hourlyRateAverage?: number;
  totalPrice: number;
  aiTasks?: any[];
  aiAutoPrice?: number;
  aiPriceTotal?: number;
  photoFiles?: File[];
};

type InvoiceLineItem = {
  serviceId: string;
  name: string;
  price: number;
};

const readPayloadFromStorage = (): CheckoutPayload | null => {
  try {
    const raw = localStorage.getItem('pending_checkout') || sessionStorage.getItem('pending_checkout');
    if (!raw) return null;
    return JSON.parse(raw) as CheckoutPayload;
  } catch {
    return null;
  }
};

const writePayloadToStorage = (payload: CheckoutPayload) => {
  try {
    const { photoFiles: _photoFiles, ...serializable } = payload;
    localStorage.setItem('pending_checkout', JSON.stringify(serializable));
  } catch {}
};

const clearPayloadFromStorage = () => {
  try {
    localStorage.removeItem('pending_checkout');
    sessionStorage.removeItem('pending_checkout');
  } catch {}
};

const normalize = (s: string) => (s || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const round2 = (n: number) => Math.round(n * 100) / 100;

const computeTaskPrice = (task: any) => {
  const tipo = normalize(task?.tipo_servicio || '');
  const estado = normalize(task?.estado_jardin || '');
  const factor = estado.includes('muy descuidado') || estado.includes('bastante descuidado') ? 1.6 : estado.includes('descuidado') ? 1.3 : 1;
  let price = 0;
  if (tipo.includes('cesped')) {
    const m2 = task?.superficie_m2;
    if (m2 != null) price = ((Number(m2) / 150) * factor) * 25;
  } else if (tipo.includes('setos') || tipo.includes('seto')) {
    const m2 = task?.superficie_m2;
    if (m2 != null) price = ((Number(m2) / 8.4) * factor) * 25;
  } else if (tipo.includes('malas hierbas') || tipo.includes('hierbas') || tipo.includes('maleza') || tipo.includes('labrado')) {
    const m2 = task?.superficie_m2;
    if (m2 != null) price = ((Number(m2) / 20) * factor) * 20;
  } else if (tipo.includes('fumig')) {
    const plants = task?.numero_plantas;
    if (plants != null) price = ((Number(plants) * 0.05) * factor) * 35;
  } else if (tipo.includes('poda') && (tipo.includes('arbol') || tipo.includes('árbol'))) {
    const trees = task?.numero_plantas;
    if (trees != null) price = ((Number(trees) * 1.0) * factor) * 30;
  } else if (tipo.includes('poda')) {
    const plants = task?.numero_plantas;
    if (plants != null) price = ((Number(plants) * 0.15) * factor) * 25;
  }
  return Math.max(0, round2(price));
};

const loadPayPalSdk = async (clientId: string) => {
  const anyWindow = window as any;
  if (anyWindow.paypal) return;
  const existing = document.querySelector<HTMLScriptElement>('script[data-paypal-sdk="true"]');
  if (existing) {
    await new Promise<void>((resolve, reject) => {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('PayPal SDK failed')));
    });
    return;
  }

  const script = document.createElement('script');
  script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=EUR&intent=capture&components=buttons`;
  script.async = true;
  script.dataset.paypalSdk = 'true';
  await new Promise<void>((resolve, reject) => {
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('PayPal SDK failed'));
    document.head.appendChild(script);
  });
};

const BookingCheckout: React.FC = () => {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const allowWithoutPayment =
    (import.meta.env.VITE_ALLOW_BOOKING_WITHOUT_PAYMENT as string | undefined) === 'true' ||
    import.meta.env.DEV;
  const [services, setServices] = useState<Service[]>([]);
  const [loadingServices, setLoadingServices] = useState(true);
  const [paying, setPaying] = useState(false);
  const [paid, setPaid] = useState(false);
  const [paymentRef, setPaymentRef] = useState<string>('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupLoading, setSignupLoading] = useState(false);

  const payload: CheckoutPayload | null = useMemo(() => {
    const st = (location.state as any)?.payload as CheckoutPayload | undefined;
    return st || readPayloadFromStorage();
  }, [location.state]);

  useEffect(() => {
    if (!payload) return;
    writePayloadToStorage(payload);
  }, [payload]);

  useEffect(() => {
    const fetchServices = async () => {
      try {
        if (!payload?.selectedServiceIds?.length) return;
        const { data, error } = await supabase
          .from('services')
          .select('*')
          .in('id', payload.selectedServiceIds);
        if (error) throw error;
        setServices((data as Service[]) || []);
      } catch (e) {
        console.error('Error loading services for checkout:', e);
      } finally {
        setLoadingServices(false);
      }
    };
    fetchServices();
  }, [payload?.selectedServiceIds?.join(',')]);

  const total = useMemo(() => {
    if (!payload) return 0;
    return Math.max(0, Number(payload.totalPrice || 0));
  }, [payload]);

  const deposit = useMemo(() => round2(total * 0.10), [total]);
  const remaining = useMemo(() => round2(total - deposit), [total, deposit]);

  const invoiceItems: InvoiceLineItem[] = useMemo(() => {
    if (!payload) return [];
    const selected = payload.selectedServiceIds || [];
    const catalogById = new Map<string, Service>(services.map(s => [s.id, s]));
    const itemsBase: InvoiceLineItem[] = selected.map((id) => ({
      serviceId: id,
      name: catalogById.get(id)?.name || 'Servicio',
      price: 0,
    }));

    const byName = new Map<string, string>();
    itemsBase.forEach(it => byName.set(normalize(it.name), it.serviceId));

    const grouped = new Map<string, number>();
    const tasks = Array.isArray(payload.aiTasks) ? payload.aiTasks : [];
    tasks.forEach(t => {
      const key = normalize(t?.tipo_servicio || '');
      const p = computeTaskPrice(t);
      if (!key || p <= 0) return;
      grouped.set(key, round2((grouped.get(key) || 0) + p));
    });

    let used = 0;
    const out = itemsBase.map(it => {
      const key = normalize(it.name);
      const taskPrice = grouped.get(key) || 0;
      used += taskPrice;
      return { ...it, price: taskPrice };
    });

    const remainingToAssign = Math.max(0, round2(total - used));
    if (remainingToAssign > 0 && out.length > 0) {
      const weights = out.map(it => {
        const svc = catalogById.get(it.serviceId);
        const w = typeof svc?.price_per_hour === 'number' && svc.price_per_hour > 0 ? svc.price_per_hour : 1;
        return w;
      });
      const sumW = weights.reduce((a, b) => a + b, 0) || 1;
      let assigned = 0;
      const updated = out.map((it, idx) => {
        if (idx === out.length - 1) {
          const last = round2(remainingToAssign - assigned);
          return { ...it, price: round2(it.price + last) };
        }
        const part = round2((remainingToAssign * weights[idx]) / sumW);
        assigned = round2(assigned + part);
        return { ...it, price: round2(it.price + part) };
      });
      return updated;
    }

    return out;
  }, [payload, services, total]);

  const paypalClientId = (import.meta.env.VITE_PAYPAL_CLIENT_ID as string | undefined) || '';

  useEffect(() => {
    const mount = async () => {
      if (!payload) return;
      if (allowWithoutPayment) return;
      if (!user) return;
      if (!paypalClientId) return;
      if (!deposit || deposit <= 0) return;
      if (!user?.id) return;
      if (paid) return;

      const container = document.getElementById('paypal-buttons');
      if (!container) return;
      if (container.dataset.mounted === 'true') return;

      try {
        await loadPayPalSdk(paypalClientId);
        const anyWindow = window as any;
        if (!anyWindow.paypal?.Buttons) return;

        anyWindow.paypal.Buttons({
          createOrder: (_data: any, actions: any) => {
            return actions.order.create({
              purchase_units: [
                {
                  amount: { currency_code: 'EUR', value: deposit.toFixed(2) },
                },
              ],
            });
          },
          onApprove: async (_data: any, actions: any) => {
            setPaying(true);
            try {
              const details = await actions.order.capture();
              const id = details?.id || '';
              setPaymentRef(id);
              setPaid(true);
              toast.success('Pago recibido');
            } catch (e: any) {
              toast.error(e?.message || 'Error procesando el pago');
            } finally {
              setPaying(false);
            }
          },
          onError: (err: any) => {
            console.error('PayPal error:', err);
            toast.error('Error de PayPal');
          },
        }).render('#paypal-buttons');

        container.dataset.mounted = 'true';
      } catch (e) {
        console.error('Error mounting PayPal:', e);
      }
    };
    mount();
  }, [payload, allowWithoutPayment, paypalClientId, deposit, user?.id, paid]);

  const sendRequests = async () => {
    if (!payload) return;
    if (!user?.id) return;
    if (!paid && !allowWithoutPayment) return;
    if (sent) return;
    setSending(true);
    try {
      const paymentLine = paymentRef ? `\nPago 10%: ${paymentRef}` : '';
      const bypassLine = allowWithoutPayment ? '\nModo pruebas: reserva confirmada sin pago' : '';
      const notes = `${payload.description || ''}${paymentLine}${bypassLine}`.trim();
      
      // Asegurarse de que eligibleGardenerIds solo contiene al jardinero seleccionado si hay restrictedGardenerId
      const gardenerIds = payload.restrictedGardenerId 
        ? [payload.restrictedGardenerId] 
        : payload.eligibleGardenerIds;

      await broadcastBookingRequest({
        clientId: user.id,
        gardenerIds,
        primaryServiceId: payload.selectedServiceIds[0],
        date: payload.selectedDate,
        startHour: payload.startHour,
        durationHours: payload.estimatedHours,
        clientAddress: payload.selectedAddress,
        notes,
        totalPrice: Math.ceil(total),
        hourlyRate: payload.hourlyRateAverage,
        photoFiles: payload.photoFiles,
      });
      setSent(true);
      clearPayloadFromStorage();
    } catch (e: any) {
      console.error('Error sending booking requests after payment:', e);
      toast.error(e?.message || 'No se pudieron enviar las solicitudes');
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    if (paid && !sent) sendRequests();
  }, [paid, sent]);

  if (!payload) {
    return (
      <div className="max-w-xl mx-auto p-6">
        <div className="bg-white border border-gray-200 rounded-xl p-6 text-center">
          <div className="text-gray-900 font-semibold mb-2">No hay una reserva pendiente</div>
          <div className="text-gray-700 text-sm mb-4">Vuelve a la pantalla de reserva para continuar.</div>
          <button
            onClick={() => navigate('/reserva')}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg"
          >
            Ir a reserva
          </button>
        </div>
      </div>
    );
  }

  if (!user?.id) {
    return (
      <div className="max-w-xl mx-auto p-6">
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <div className="text-xl font-semibold text-gray-900 mb-3">Crea tu cuenta para continuar</div>
          <div className="text-gray-700 text-sm mb-4">
            Regístrate con tu correo y contraseña. Te enviaremos un enlace de verificación; al confirmarlo volverás aquí para {allowWithoutPayment ? 'completar la reserva sin pagar' : 'realizar el pago'}.
          </div>
          <div className="space-y-3">
            <label className="block text-sm text-gray-700">Correo electrónico</label>
            <input
              type="email"
              value={signupEmail}
              onChange={(e) => setSignupEmail(e.target.value)}
              className="w-full border border-gray-300 rounded-lg p-2"
              placeholder="tu@email.com"
            />
            <label className="block text-sm text-gray-700">Contraseña</label>
            <input
              type="password"
              value={signupPassword}
              onChange={(e) => setSignupPassword(e.target.value)}
              className="w-full border border-gray-300 rounded-lg p-2"
              placeholder="••••••••"
            />
            <button
              onClick={async () => {
                if (signupLoading) return;
                setSignupLoading(true);
                try {
                  if (payload) writePayloadToStorage(payload);
                  try { localStorage.setItem('signup_source', 'checkout'); } catch {}
                  const origin = window.location.origin;
                  const redirectTo = `${origin}/reserva/checkout?continue=pay`;
                  const { error } = await supabase.auth.signUp({
                    email: signupEmail,
                    password: signupPassword,
                    options: {
                      emailRedirectTo: redirectTo,
                      data: { role: 'client', requested_role: 'client' },
                    },
                  });
                  if (error) throw error;
                  toast.success('Registro creado. Revisa tu email para verificar y continuar.');
                } catch (e: any) {
                  toast.error(e?.message || 'No se pudo registrar');
                } finally {
                  setSignupLoading(false);
                }
              }}
              className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg disabled:opacity-50"
              disabled={signupLoading || !signupEmail || !signupPassword}
            >
              Crear cuenta y enviar verificación
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (sent) {
    return (
      <div className="max-w-xl mx-auto p-6">
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
          <CheckCircle className="w-16 h-16 text-green-600 mx-auto mb-4" />
          <div className="text-2xl font-semibold text-gray-900 mb-2">Reserva completada</div>
          <div className="text-gray-700 mb-6">Se han enviado las solicitudes a los jardineros disponibles.</div>
          <div className="flex justify-center gap-3">
            <button
              onClick={() => navigate('/bookings')}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg"
            >
              Ver mis reservas
            </button>
            <button
              onClick={() => navigate('/dashboard')}
              className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg"
            >
              Volver al inicio
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6">
      <div className="bg-white border border-gray-200 rounded-2xl p-6">
        <div className="text-xl font-semibold text-gray-900 mb-4">Resumen de tu reserva</div>

        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <div className="bg-gray-50 px-4 py-3 text-sm font-medium text-gray-800">Factura</div>
          <div className="p-4">
            {loadingServices ? (
              <div className="text-sm text-gray-600">Cargando servicios…</div>
            ) : (
              <div className="space-y-2">
                {invoiceItems.map(it => (
                  <div key={it.serviceId} className="flex items-center justify-between text-sm">
                    <div className="text-gray-800">{it.name}</div>
                    <div className="text-gray-900 font-medium">€{round2(it.price).toFixed(2)}</div>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-4 pt-3 border-t border-gray-200 flex items-center justify-between">
              <div className="text-gray-800 font-semibold">Total</div>
              <div className="text-gray-900 font-semibold">€{round2(total).toFixed(2)}</div>
            </div>
          </div>
        </div>

        {allowWithoutPayment ? (
          <div className="mt-6 bg-amber-50 border border-amber-200 rounded-xl p-4">
            <div className="text-amber-900 font-semibold mb-1">Modo pruebas</div>
            <div className="text-amber-800 text-sm">
              El pago por adelantado está desactivado temporalmente. Puedes confirmar la reserva sin pagar.
            </div>
          </div>
        ) : (
          <div className="mt-6 bg-blue-50 border border-blue-200 rounded-xl p-4">
            <div className="text-blue-900 font-semibold mb-1">Pago por adelantado</div>
            <div className="text-blue-800 text-sm">
              Para confirmar la reserva debes abonar el 10% del precio final por adelantado ({`€${deposit.toFixed(2)}`}).
              El resto ({`€${remaining.toFixed(2)}`}) se lo pagarás al jardinero cuando te complete el servicio.
            </div>
          </div>
        )}

        <div className="mt-6">
          {allowWithoutPayment ? (
            <button
              onClick={() => {
                if (sending || sent) return;
                setPaid(true);
                toast.success('Reserva confirmada (sin pago)');
              }}
              className={`w-full px-4 py-3 rounded-xl font-semibold text-white ${sending ? 'bg-gray-400 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700'}`}
              disabled={sending || sent}
            >
              Confirmar reserva sin pagar
            </button>
          ) : (
            <>
              <div className="text-gray-900 font-semibold mb-2">Pagar 10% con PayPal o tarjeta</div>
              {paypalClientId ? (
                <div className={`border border-gray-200 rounded-xl p-4 ${paying ? 'opacity-60 pointer-events-none' : ''}`}>
                  <div id="paypal-buttons" />
                </div>
              ) : (
                <div className="border border-amber-200 bg-amber-50 rounded-xl p-4 text-sm text-amber-900">
                  Falta configurar `VITE_PAYPAL_CLIENT_ID` para mostrar el pago con PayPal/tarjeta.
                </div>
              )}
            </>
          )}
        </div>

        {paid && !sent && (
          <div className="mt-4 text-sm text-gray-700">
            Procesando confirmación y envío de solicitudes…
          </div>
        )}

        {sending && (
          <div className="mt-2 text-sm text-gray-700">
            Enviando solicitudes…
          </div>
        )}
      </div>
    </div>
  );
};

export default BookingCheckout;
