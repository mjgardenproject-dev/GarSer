// Capa de marca compartida para TODOS los emails transaccionales de GarSer.
//
// Objetivo: una sola plantilla de marca (cabecera, tipografía, botón CTA, pie con enlace
// a garser.es) que reutilicen todas las Edge Functions de email, en vez de HTML duplicado e
// inconsistente por función. Los correos usan siempre el NOMBRE REAL del usuario y una
// llamada a la acción que redirige a https://garser.es.

export const BRAND = {
  name: 'GarSer',
  green: '#16a34a',
  greenDark: '#15803d',
  site: 'https://garser.es',
  text: '#1f2937',
  muted: '#6b7280',
  border: '#e5e7eb',
  bg: '#f3f4f6',
} as const;

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatPrice(value: number | null | undefined): string {
  const n = Number(value || 0);
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n);
}

export function formatBookingDate(date: string | null, startTime: string | null): string {
  if (!date) return 'Fecha por confirmar';
  try {
    const iso = startTime ? `${date}T${startTime}` : `${date}T00:00:00`;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return date;
    const datePart = d.toLocaleDateString('es-ES', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
    if (!startTime) return datePart;
    const timePart = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    return `${datePart} a las ${timePart}`;
  } catch {
    return date;
  }
}

/** Filas etiqueta:valor para el cuerpo del email (ya escapadas). */
export function detailRows(rows: Array<[string, string]>): string {
  return `
    <table role="presentation" style="width:100%;border-collapse:collapse;margin:16px 0;">
      ${rows
        .map(
          ([label, value]) => `
        <tr>
          <td style="padding:8px 0;color:${BRAND.muted};font-size:14px;">${escapeHtml(label)}</td>
          <td style="padding:8px 0;font-weight:600;font-size:14px;text-align:right;">${escapeHtml(value)}</td>
        </tr>`,
        )
        .join('')}
    </table>`;
}

export interface BrandedEmailOptions {
  /** Preheader / título del documento. */
  title: string;
  heading: string;
  intro?: string;
  /** HTML adicional ya construido (p. ej. detailRows). No se escapa. */
  bodyHtml?: string;
  cta?: { label: string; url: string };
  footerNote?: string;
}

/** Envuelve el contenido en el shell de marca GarSer. Devuelve un documento HTML completo. */
export function renderBrandedEmail(opts: BrandedEmailOptions): string {
  const cta = opts.cta
    ? `
      <div style="text-align:center;margin:28px 0 8px;">
        <a href="${escapeHtml(opts.cta.url)}"
           style="display:inline-block;background:${BRAND.green};color:#ffffff;text-decoration:none;
                  padding:12px 28px;border-radius:8px;font-weight:700;font-size:15px;">
          ${escapeHtml(opts.cta.label)}
        </a>
      </div>`
    : '';

  return `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(opts.title)}</title></head>
<body style="margin:0;padding:0;background:${BRAND.bg};">
  <span style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(opts.title)}</span>
  <div style="max-width:600px;margin:0 auto;padding:24px 16px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${BRAND.text};">
    <div style="text-align:center;margin-bottom:16px;">
      <a href="${BRAND.site}" style="text-decoration:none;font-size:22px;font-weight:800;color:${BRAND.green};">${BRAND.name}</a>
    </div>
    <div style="background:#ffffff;border:1px solid ${BRAND.border};border-radius:16px;padding:28px 24px;">
      <h1 style="margin:0 0 12px;font-size:20px;color:${BRAND.text};">${escapeHtml(opts.heading)}</h1>
      ${opts.intro ? `<p style="margin:0 0 12px;font-size:15px;line-height:1.5;">${escapeHtml(opts.intro)}</p>` : ''}
      ${opts.bodyHtml || ''}
      ${cta}
      ${opts.footerNote ? `<p style="margin:16px 0 0;font-size:13px;color:${BRAND.muted};line-height:1.5;">${escapeHtml(opts.footerNote)}</p>` : ''}
    </div>
    <div style="text-align:center;margin-top:16px;font-size:12px;color:${BRAND.muted};">
      <p style="margin:0 0 4px;">Este es un mensaje automático de ${BRAND.name}.</p>
      <p style="margin:0;"><a href="${BRAND.site}" style="color:${BRAND.muted};">garser.es</a></p>
    </div>
  </div>
</body>
</html>`;
}

/** Envío vía Brevo (API REST). Reutilizable por todas las funciones. */
export async function sendViaBrevo(params: {
  to: string;
  subject: string;
  html: string;
  smtpUser: string;
  smtpPass: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': params.smtpPass,
        'accept': 'application/json',
      },
      body: JSON.stringify({
        sender: { name: BRAND.name, email: params.smtpUser },
        to: [{ email: params.to }],
        subject: params.subject,
        htmlContent: params.html,
      }),
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      return { ok: false, error: (detail as any)?.message || `Brevo HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'unknown' };
  }
}
