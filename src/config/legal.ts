// Datos del titular de GarSer para las páginas legales (/privacidad y /terminos), 2026-10-21.
//
// Todo lo que está vacío sale en la web resaltado como «[Completar: …]» hasta que se rellene aquí.
// Es el único sitio donde se cambian: las dos páginas leen de este objeto. Los textos son una base
// para un marketplace como GarSer; conviene que los revise un abogado antes de darlos por buenos.

import { PUBLIC_CONTACT_EMAIL, SITE_URL } from './publicSiteContent';

export interface LegalInfo {
  /** Nombre y apellidos (autónomo) o razón social (sociedad) del titular de GarSer. */
  ownerName: string;
  /** NIF o CIF. */
  taxId: string;
  /** Domicilio fiscal completo. */
  address: string;
  /** Registro Mercantil (solo si es una sociedad): tomo, folio, hoja… Vacío si es autónomo. */
  registry: string;
  /** Correo para ejercer los derechos de protección de datos. */
  privacyEmail: string;
  /** Correo general de contacto. */
  contactEmail: string;
  website: string;
  /** Fecha de la última actualización de los textos, en formato largo. */
  updatedAt: string;
}

export const LEGAL_INFO: LegalInfo = {
  ownerName: 'Javier Rodríguez',
  taxId: '79386773L',
  address: 'Calle Sicilia 32, Marbella, Málaga, Andalucía, España',
  registry: '',
  privacyEmail: PUBLIC_CONTACT_EMAIL,
  contactEmail: PUBLIC_CONTACT_EMAIL,
  website: SITE_URL,
  updatedAt: '22 de octubre de 2026',
};

/** Qué datos faltan por completar (para avisar en la propia página y en los tests). */
export function missingLegalFields(info: LegalInfo = LEGAL_INFO): Array<keyof LegalInfo> {
  const required: Array<keyof LegalInfo> = ['ownerName', 'taxId', 'address', 'privacyEmail', 'contactEmail'];
  return required.filter((key) => !String(info[key] || '').trim());
}

export const PRIVACY_PATH = '/privacidad';
export const TERMS_PATH = '/terminos';
