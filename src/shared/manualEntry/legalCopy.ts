/**
 * Manual Entry — Legal Copy & Consent (isomorphic)
 * -------------------------------------------------------------
 * Single source of truth for the veracity/price-variability consent text the
 * client must accept before submitting a manually-declared booking.
 *
 * Versioned + hashable so the exact text accepted by a client can be proven
 * later (requisito B "registro auditable"). Generalizes the existing Desbroce
 * checkbox copy to all services (does not contradict it).
 *
 * ⚠️ LEGAL REVIEW REQUIRED: this wording is a product proposal, not legal
 * advice. It must be reviewed by someone with legal criteria before going to
 * production. Bumping the text REQUIRES bumping `MANUAL_ENTRY_LEGAL_VERSION`.
 */

export const MANUAL_ENTRY_LEGAL_VERSION = 'manual_entry_consent_v1';

export const MANUAL_ENTRY_CONSENT_TEXT =
  'Confirmo que la información que he proporcionado sobre mi jardín es real y se corresponde con su ' +
  'estado actual. Entiendo que este presupuesto es una estimación basada en los datos que yo mismo he ' +
  'introducido y que el precio final puede ajustarse si el profesional, al evaluar el jardín en persona, ' +
  'detecta condiciones distintas a las declaradas. En ese caso, deberé aceptar el nuevo precio antes de ' +
  'que el servicio continúe, o podré cancelar sin coste dentro del plazo indicado.';

export const MANUAL_ENTRY_NOTICE_TITLE = 'Presupuesto basado en tus datos';

export const MANUAL_ENTRY_NOTICE_BODY =
  'Vas a introducir tú mismo las medidas y características de tu jardín. El presupuesto resultante es una ' +
  'estimación. Si al llegar el profesional comprueba que las condiciones reales no coinciden con lo ' +
  'declarado, te propondrá un nuevo precio que deberás aceptar antes de continuar.';

/**
 * Deterministic, dependency-free hash of the consent text (FNV-1a, 64-bit, hex).
 * Sufficient to prove which exact text version was accepted; not used for
 * security. Works identically in the browser and in Deno.
 */
export function hashConsentText(text: string = MANUAL_ENTRY_CONSENT_TEXT): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < text.length; i++) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}

export const MANUAL_ENTRY_CONSENT_HASH = hashConsentText();

export interface ManualEntryConsentRecord {
  legalVersion: string;
  legalHash: string;
  acceptedText: string;
  acceptedAt: string;
}

/** Build the auditable consent record captured at the moment of acceptance. */
export function buildConsentRecord(now: Date = new Date()): ManualEntryConsentRecord {
  return {
    legalVersion: MANUAL_ENTRY_LEGAL_VERSION,
    legalHash: MANUAL_ENTRY_CONSENT_HASH,
    acceptedText: MANUAL_ENTRY_CONSENT_TEXT,
    acceptedAt: now.toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* Tratamientos con producto fitosanitario (QA-170, decisión del dueño 2026-11-17) */
/* -------------------------------------------------------------------------- */

/**
 * GarSer es una plataforma de gestión de reservas, no un inspector: la aplicación, el producto, las
 * dosis y los plazos de seguridad son responsabilidad del profesional con carnet.
 *
 * ⚠️ REVISIÓN LEGAL RECOMENDADA antes (o justo después) de publicar. Los textos están aquí, en un único
 * sitio, para que sean fáciles de cambiar; si se cambia `PHYTOSANITARY_ACK_TEXT`, hay que subir
 * `PHYTOSANITARY_NOTICE_VERSION`.
 */
export const PHYTOSANITARY_NOTICE_VERSION = 'phytosanitary_notice_v1';

export const PHYTOSANITARY_NOTICE_TITLE = 'Tratamiento con producto fitosanitario';

export const PHYTOSANITARY_NOTICE_BODY =
  'Un tratamiento con producto fitosanitario lo aplica un profesional con carnet de aplicador en vigor. ' +
  'El producto, la dosis, las precauciones y los plazos de seguridad los decide y asume ese profesional. ' +
  'GarSer es una plataforma de gestión de reservas: no aplica, supervisa ni inspecciona el tratamiento.';

export const PHYTOSANITARY_ACK_TEXT =
  'He leído este aviso: el producto, la dosis y los plazos de seguridad los decide y asume el profesional ' +
  'con carnet que realice el tratamiento, y GarSer solo gestiona la reserva.';

export const PHYTOSANITARY_ACK_REQUIRED = 'Marca la casilla para poder continuar con este tratamiento.';

/** La frase corta del resumen y del correo de confirmación. */
export const PHYTOSANITARY_SHORT_NOTE =
  'Tratamiento aplicado por un profesional con carnet fitosanitario, que responde del producto, la dosis y ' +
  'los plazos de seguridad. GarSer solo gestiona la reserva.';

export interface PhytosanitaryAckRecord {
  legalVersion: string;
  legalHash: string;
  acceptedText: string;
  acceptedAt: string;
}

export function buildPhytosanitaryAckRecord(now: Date = new Date()): PhytosanitaryAckRecord {
  return {
    legalVersion: PHYTOSANITARY_NOTICE_VERSION,
    legalHash: hashConsentText(PHYTOSANITARY_ACK_TEXT),
    acceptedText: PHYTOSANITARY_ACK_TEXT,
    acceptedAt: now.toISOString(),
  };
}
