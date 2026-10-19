import { supabase } from '../lib/supabase';
import { PUBLIC_CONTACT_EMAIL } from './publicSiteContent';

// Configuración global del negocio editable desde /admin/settings.
// Se persiste en la tabla singleton `app_settings` (id = 1).
//
// Los valores estáticos de `publicSiteContent.ts` actúan como fallback: si la
// consulta falla o la fila todavía no tiene datos, la web sigue funcionando con
// los valores por defecto en lugar de quedarse en blanco.

export type AppSettings = {
  businessName: string;
  contactEmail: string;
  contactPhone: string;
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  businessName: 'GarSer',
  contactEmail: PUBLIC_CONTACT_EMAIL,
  contactPhone: '',
};

type AppSettingsRow = {
  business_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
};

function normalizeRow(row: AppSettingsRow | null | undefined): AppSettings {
  return {
    businessName: (row?.business_name ?? '').trim() || DEFAULT_APP_SETTINGS.businessName,
    contactEmail: (row?.contact_email ?? '').trim() || DEFAULT_APP_SETTINGS.contactEmail,
    contactPhone: (row?.contact_phone ?? '').trim() || DEFAULT_APP_SETTINGS.contactPhone,
  };
}

export async function fetchAppSettings(): Promise<AppSettings> {
  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('business_name, contact_email, contact_phone')
      .eq('id', 1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return normalizeRow(data as AppSettingsRow | null);
  } catch {
    // Nunca rompemos el render por un fallo de configuración: caemos al default.
    return DEFAULT_APP_SETTINGS;
  }
}

export async function updateAppSettings(settings: AppSettings): Promise<void> {
  const userId = (await supabase.auth.getUser()).data.user?.id ?? null;

  const { error } = await supabase
    .from('app_settings')
    .update({
      business_name: settings.businessName.trim(),
      contact_email: settings.contactEmail.trim(),
      contact_phone: settings.contactPhone.trim(),
      updated_at: new Date().toISOString(),
      updated_by: userId,
    })
    .eq('id', 1);

  if (error) {
    throw error;
  }
}

/* ------------------------------------------------------------------------------------- *
 * Lanzamiento (2026-10): interruptor «sin gastos de gestión para los clientes propios».
 *
 * Con él encendido no pagan gastos de gestión las reservas desde el enlace de un profesional, los
 * clientes con una reserva completada con ese profesional y las visitas de los planes. Lo decide
 * el servidor al firmar el presupuesto (`management_fee_waiver_reason`); aquí solo se lee y se
 * cambia desde Ajustes del admin. Va aparte de `fetchAppSettings` a propósito: el pie y el SEO de
 * la web pública no dependen de esta columna.
 * ------------------------------------------------------------------------------------- */

export async function fetchOwnClientsFeeWaiverEnabled(): Promise<boolean> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('own_clients_fee_waiver_enabled')
    .eq('id', 1)
    .maybeSingle();
  if (error) throw error;
  return Boolean((data as { own_clients_fee_waiver_enabled?: boolean } | null)?.own_clients_fee_waiver_enabled);
}

export async function updateOwnClientsFeeWaiverEnabled(enabled: boolean): Promise<void> {
  const userId = (await supabase.auth.getUser()).data.user?.id ?? null;
  const { data, error } = await supabase
    .from('app_settings')
    .update({
      own_clients_fee_waiver_enabled: enabled,
      updated_at: new Date().toISOString(),
      updated_by: userId,
    })
    .eq('id', 1)
    .select('own_clients_fee_waiver_enabled')
    .maybeSingle();
  if (error) throw error;
  // Sin fila devuelta (p. ej. sin permiso de admin) el cambio NO se ha guardado: se dice.
  if (Boolean((data as { own_clients_fee_waiver_enabled?: boolean } | null)?.own_clients_fee_waiver_enabled) !== enabled) {
    throw new Error('No se ha guardado el cambio. Vuelve a intentarlo.');
  }
}
