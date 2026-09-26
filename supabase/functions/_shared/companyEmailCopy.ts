// Textos del correo de invitación a un equipo (GarSer Empresas, H-39, 2026-09-26). Sin
// dependencias de Deno: lo usa send-email-notification y lo prueba vitest
// (src/shared/companyEmailCopy.test.ts).
//
// Antes el correo decía «Hola» y «Tu empresa te asignará los trabajos», sin decir que te invitan
// como EMPLEADO ni qué hacer: parecía dirigido a una empresa. Ahora explica quién invita, para qué
// y los tres pasos, que son los de la página /invitacion (D21: la contraseña se pone ahí mismo).

export interface InvitationEmailCopy {
  subject: string;
  heading: string;
  intro: string;
  /** Pasos como filas etiqueta/valor: salen igual en HTML (detailRows) y en texto plano. */
  steps: Array<[string, string]>;
  ctaLabel: string;
  footerNote: string;
}

export function invitationEmailCopy(params: {
  companyName?: string | null;
  email?: string | null;
  expiresLabel: string;
}): InvitationEmailCopy {
  const company = String(params.companyName || '').trim() || 'Una empresa de jardinería';
  const email = String(params.email || '').trim();
  return {
    subject: `${company} te invita a trabajar con su equipo en GarSer`,
    heading: `${company} quiere que formes parte de su equipo`,
    intro: `${company} organiza sus trabajos de jardinería con GarSer y te ha invitado a unirte como empleado. Desde tu móvil verás los trabajos que te asignen, con la dirección y el horario.`,
    steps: [
      ['1', 'Pulsa «Unirme al equipo».'],
      ['2', 'Escribe tu nombre y elige una contraseña: tu correo ya está puesto.'],
      ['3', 'Entras directamente a tu panel de empleado.'],
    ],
    ctaLabel: 'Unirme al equipo',
    footerNote: `La invitación es personal${email ? `: solo sirve para ${email}` : ''} y caduca el ${params.expiresLabel}. Para volver otro día, entra en garser.es con este correo y tu contraseña. Si no conoces a ${company}, ignora este correo.`,
  };
}
