import React, { useEffect, useState } from 'react';
import { Save, Loader2, Mail, Phone, Building2, BadgePercent } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  AppSettings,
  DEFAULT_APP_SETTINGS,
  fetchAppSettings,
  fetchOwnClientsFeeWaiverEnabled,
  updateAppSettings,
  updateOwnClientsFeeWaiverEnabled,
} from '../../config/appSettings';
import { useConfirmDialog } from '../../components/common/ConfirmDialog';

/**
 * Lanzamiento (2026-10): interruptor «sin gastos de gestión para los clientes propios». Toca lo que
 * pagan los clientes, así que cada cambio pide confirmación y se comprueba que se ha guardado.
 * Afecta a los presupuestos NUEVOS: los ya firmados se respetan hasta que caducan.
 */
const OwnClientsFeeWaiverCard: React.FC = () => {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const { openConfirm, confirmDialog } = useConfirmDialog();

  useEffect(() => {
    let active = true;
    fetchOwnClientsFeeWaiverEnabled()
      .then((value) => { if (active) setEnabled(value); })
      .catch(() => { if (active) setLoadError(true); });
    return () => { active = false; };
  }, []);

  const requestChange = (next: boolean) => {
    openConfirm({
      title: next ? '¿Activar «sin gastos de gestión»?' : '¿Desactivar «sin gastos de gestión»?',
      message: next
        ? 'Dejarán de pagar gastos de gestión: las reservas desde el enlace de un profesional, los clientes que ya han completado una reserva con ese profesional y las visitas de los planes de mantenimiento. Los clientes que trae GarSer siguen pagándolos.'
        : 'Todos los presupuestos nuevos volverán a llevar gastos de gestión (12,5 %). Los ya firmados se respetan hasta que caduquen.',
      confirmLabel: next ? 'Sí, activar' : 'Sí, desactivar',
      cancelLabel: 'Cancelar',
      tone: next ? 'warning' : 'danger',
      onConfirm: async () => {
        setSaving(true);
        try {
          await updateOwnClientsFeeWaiverEnabled(next);
          setEnabled(next);
          toast.success(next ? 'Activado: los clientes propios ya no pagan gastos de gestión.' : 'Desactivado: los presupuestos nuevos vuelven a llevar gastos de gestión.');
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'No se pudo guardar el cambio.');
        } finally {
          setSaving(false);
        }
      },
    });
  };

  return (
    <section
      aria-labelledby="fee-waiver-title"
      className="bg-white rounded-xl shadow-sm border border-gray-200 p-6"
    >
      <div className="flex items-start gap-3">
        <BadgePercent className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h3 id="fee-waiver-title" className="text-sm font-semibold text-gray-900">
            Lanzamiento: sin gastos de gestión para los clientes propios
          </h3>
          <p className="mt-1 text-sm text-gray-600">
            No pagan gastos de gestión las reservas desde el enlace de un profesional, los clientes
            que ya completaron una reserva con él y las visitas de los planes. Los clientes que trae
            GarSer siguen pagándolos.
          </p>
          {loadError ? (
            <p className="mt-3 text-sm text-red-700" role="alert">
              No se ha podido leer este ajuste. Recarga la página.
            </p>
          ) : enabled === null ? (
            <p className="mt-3 inline-flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Cargando…
            </p>
          ) : (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm">
                Estado:{' '}
                <span className={`font-semibold ${enabled ? 'text-emerald-700' : 'text-gray-700'}`}>
                  {enabled ? 'Activado' : 'Desactivado'}
                </span>
              </p>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                aria-labelledby="fee-waiver-title"
                onClick={() => requestChange(!enabled)}
                disabled={saving}
                className={`inline-flex min-h-[44px] items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 ${
                  enabled
                    ? 'border border-gray-300 bg-white text-gray-800 hover:bg-gray-50'
                    : 'bg-emerald-700 text-white hover:bg-emerald-800'
                }`}
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                {enabled ? 'Desactivar' : 'Activar'}
              </button>
            </div>
          )}
        </div>
      </div>
      {confirmDialog}
    </section>
  );
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const AdminSettings: React.FC = () => {
  const [form, setForm] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    fetchAppSettings()
      .then((value) => {
        if (active) setForm(value);
      })
      .catch(() => {
        if (active) toast.error('No se pudo cargar la configuración.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleChange = (field: keyof AppSettings) => (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const businessName = form.businessName.trim();
    if (!businessName) {
      toast.error('El nombre del negocio es obligatorio.');
      return;
    }
    if (form.contactEmail.trim() && !EMAIL_REGEX.test(form.contactEmail.trim())) {
      toast.error('El email de contacto no tiene un formato válido.');
      return;
    }

    try {
      setSaving(true);
      await updateAppSettings(form);
      toast.success('Configuración guardada.');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'No se pudo guardar la configuración.';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-500">
        <Loader2 className="w-6 h-6 animate-spin" />
        <span className="ml-3">Cargando configuración…</span>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <header>
        <h2 className="text-xl font-bold text-gray-900 pb-2 border-b">Configuración</h2>
        <p className="mt-3 text-sm text-gray-600">
          Datos de contacto y marca del negocio. El email y el teléfono se muestran en el
          pie de página público y en los datos de SEO.
        </p>
      </header>

      <OwnClientsFeeWaiverCard />

      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-6"
      >
        <div>
          <label
            htmlFor="business_name"
            className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2"
          >
            <Building2 className="w-4 h-4 text-gray-400" />
            Nombre del negocio
          </label>
          <input
            id="business_name"
            type="text"
            value={form.businessName}
            onChange={handleChange('businessName')}
            placeholder="GarSer"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:ring-1 focus:ring-green-500 outline-none"
          />
        </div>

        <div>
          <label
            htmlFor="contact_email"
            className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2"
          >
            <Mail className="w-4 h-4 text-gray-400" />
            Email de contacto
          </label>
          <input
            id="contact_email"
            type="email"
            value={form.contactEmail}
            onChange={handleChange('contactEmail')}
            placeholder="contacto@garser.es"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:ring-1 focus:ring-green-500 outline-none"
          />
          <p className="mt-1 text-xs text-gray-500">
            Déjalo vacío para no mostrar email de contacto en la web pública.
          </p>
        </div>

        <div>
          <label
            htmlFor="contact_phone"
            className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2"
          >
            <Phone className="w-4 h-4 text-gray-400" />
            Teléfono de contacto
          </label>
          <input
            id="contact_phone"
            type="tel"
            value={form.contactPhone}
            onChange={handleChange('contactPhone')}
            placeholder="+34 600 000 000"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:ring-1 focus:ring-green-500 outline-none"
          />
          <p className="mt-1 text-xs text-gray-500">
            Déjalo vacío para no mostrar teléfono en la web pública.
          </p>
        </div>

        <div className="flex justify-end pt-2 border-t">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-800 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default AdminSettings;
