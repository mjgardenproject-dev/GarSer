import React, { useEffect, useState } from 'react';
import { Save, Loader2, Mail, Phone, Building2 } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  AppSettings,
  DEFAULT_APP_SETTINGS,
  fetchAppSettings,
  updateAppSettings,
} from '../../config/appSettings';

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
            className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-green-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
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
