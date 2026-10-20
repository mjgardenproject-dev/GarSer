import { SITE_URL } from '../../config/publicSiteContent';
import type { MaterialId } from './materials';

// Marketing del profesional: los textos de cada material, siempre con datos reales. Sin precios,
// sin teléfono y sin dirección (solo la zona): la reserva va por GarSer, con el QR a su perfil.

export type MarketingTheme = 'green' | 'light';

export interface MarketingProfile {
  providerId: string;
  name: string;
  kind: 'solo' | 'company';
  /** Zona o ciudad (`city_zone`), nunca la dirección. */
  zone: string | null;
  avatarUrl: string | null;
  ratingAverage: number | null;
  ratingCount: number;
}

export interface MarketingOptions {
  headline: string;
  subtitle: string;
  /** Servicios elegidos (de los que salen a los clientes). */
  services: string[];
  showRating: boolean;
  theme: MarketingTheme;
}

export interface MarketingContent {
  name: string;
  initials: string;
  kind: 'solo' | 'company';
  subtitle: string;
  headline: string;
  services: string[];
  rating: { average: number; count: number; label: string } | null;
  /** «Sin gastos de gestión», solo con el interruptor del lanzamiento encendido. */
  badge: string | null;
  avatarUrl: string | null;
  qrUrl: string;
  site: string;
  cta: string;
  paymentNote: string;
  theme: MarketingTheme;
}

export const MAX_SERVICES = 6;
export const HEADLINE_MAX = 42;
export const SUBTITLE_MAX = 40;
export const SITE_LABEL = 'garser.es';

const FEE_WAIVER_BADGE = 'Sin gastos de gestión';

/** El enlace a su perfil con la reserva ligada a él, con el origen para medir. */
export function bookingUrl(providerId: string, source: string): string {
  return `${SITE_URL}/reservar/${providerId}?utm_source=${encodeURIComponent(source)}`;
}

export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'G';
  return (words.length === 1 ? words[0].slice(0, 2) : `${words[0][0]}${words[1][0]}`).toUpperCase();
}

export function defaultSubtitle(profile: Pick<MarketingProfile, 'zone'>): string {
  const zone = profile.zone?.trim();
  return zone ? `Jardinería en ${zone}` : 'Jardinería profesional';
}

/** El titular de temporada, según el mes (hemisferio norte). */
export function seasonalHeadline(date: Date): string {
  const month = date.getMonth(); // 0 = enero
  if (month >= 2 && month <= 4) return 'Prepara tu jardín para la primavera';
  if (month >= 5 && month <= 7) return 'Tu jardín, listo para el verano';
  if (month >= 8 && month <= 10) return 'Pon tu jardín a punto este otoño';
  return 'Cuida tu jardín también en invierno';
}

/** La misma estación, como frase para un mensaje a un cliente. */
export function seasonalReminder(date: Date): string {
  const month = date.getMonth();
  if (month >= 2 && month <= 4) return 'es buen momento para preparar tu jardín para la primavera';
  if (month >= 5 && month <= 7) return 'es buen momento para dejar tu jardín listo para el verano';
  if (month >= 8 && month <= 10) return 'es buen momento para poner tu jardín a punto este otoño';
  return 'tu jardín también necesita cuidados en invierno';
}

export function headlinePresets(date: Date): string[] {
  return [
    seasonalHeadline(date),
    'Tu jardín, en buenas manos',
    '¿Tu jardín necesita un repaso?',
    'Reserva tu jardinero en un minuto',
  ];
}

export function ratingLabel(average: number, count: number): string {
  const value = average.toFixed(1).replace('.', ',');
  return `★ ${value} · ${count} ${count === 1 ? 'reseña' : 'reseñas'}`;
}

const clip = (text: string, max: number) => text.trim().slice(0, max);

export function defaultOptions(profile: MarketingProfile, visibleServices: string[], date: Date): MarketingOptions {
  return {
    headline: seasonalHeadline(date),
    subtitle: defaultSubtitle(profile),
    services: visibleServices.slice(0, MAX_SERVICES),
    showRating: profile.ratingCount > 0,
    theme: 'green',
  };
}

export function buildMarketingContent(params: {
  profile: MarketingProfile;
  /** Los servicios que salen de verdad a los clientes (my_provider_setup_status). */
  visibleServices: string[];
  feeWaiverEnabled: boolean;
  options: MarketingOptions;
  source: MaterialId | string;
}): MarketingContent {
  const { profile, options } = params;
  // Solo servicios que salen de verdad, en el orden en que los eligió y como mucho 6.
  const services = options.services.filter((name) => params.visibleServices.includes(name)).slice(0, MAX_SERVICES);
  const showRating = options.showRating && profile.ratingCount > 0 && Number(profile.ratingAverage) > 0;
  return {
    name: profile.name.trim() || 'Tu jardinero',
    initials: initialsOf(profile.name),
    kind: profile.kind,
    subtitle: clip(options.subtitle || defaultSubtitle(profile), SUBTITLE_MAX),
    headline: clip(options.headline || seasonalHeadline(new Date()), HEADLINE_MAX),
    services,
    rating: showRating
      ? { average: Number(profile.ratingAverage), count: profile.ratingCount, label: ratingLabel(Number(profile.ratingAverage), profile.ratingCount) }
      : null,
    badge: params.feeWaiverEnabled ? FEE_WAIVER_BADGE : null,
    avatarUrl: profile.avatarUrl,
    qrUrl: bookingUrl(profile.providerId, params.source),
    site: SITE_LABEL,
    cta: 'Escanea y reserva en un minuto',
    paymentNote: profile.kind === 'company' ? 'Pagas al terminar el servicio' : 'Pagas al profesional al terminar',
    theme: options.theme,
  };
}

const hashtag = (text: string | null | undefined) =>
  text
    ? text
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Za-z0-9]/g, '')
    : '';

/** El texto para acompañar la publicación en redes. */
export function flyerCaption(content: MarketingContent, zone: string | null, link: string): string {
  const services = content.services.length > 0 ? `${content.services.join(' · ')}.` : '';
  const zoneTag = hashtag(zone);
  return [
    content.headline,
    '',
    [services, `Reserva en un minuto${content.badge ? ', sin gastos de gestión' : ''}: ${link}`].filter(Boolean).join('\n'),
    '',
    ['#jardineria', zoneTag ? `#${zoneTag}` : '', '#GarSer'].filter(Boolean).join(' '),
  ].join('\n');
}

export interface ClientMessage {
  id: 'online' | 'season' | 'thanks';
  title: string;
  text: string;
}

/** Mensajes listos para mandar a sus clientes por WhatsApp. */
export function clientMessages(params: { kind: 'solo' | 'company'; feeWaiverEnabled: boolean; link: string; date: Date }): ClientMessage[] {
  const company = params.kind === 'company';
  const withUs = company ? 'con nosotros' : 'conmigo';
  const toUs = company ? 'a nosotros' : 'a mí';
  const fee = params.feeWaiverEnabled ? ', sin gastos de gestión' : '';
  return [
    {
      id: 'online',
      title: 'Ya puedes reservar online',
      text: `Hola, ahora puedes reservar ${withUs} online en GarSer: eliges el día y la hora en un minuto${fee}, y pagas al terminar, directamente ${toUs}. ${params.link}`,
    },
    {
      id: 'season',
      title: 'Recordatorio de temporada',
      text: `Hola, ${seasonalReminder(params.date)}. Si quieres que ${company ? 'pasemos' : 'pase'} por tu jardín, reserva aquí el día que mejor te venga: ${params.link}`,
    },
    {
      id: 'thanks',
      title: 'Gracias por confiar',
      text: `¡Gracias por confiar en ${company ? 'nosotros' : 'mí'}! Cuando quieras la próxima visita, la reservas aquí en un minuto: ${params.link}`,
    },
  ];
}

/** Abre WhatsApp con el mensaje, para que elija el contacto (sin teléfono). */
export const whatsappUrl = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;

export function slugify(text: string): string {
  return (
    text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'profesional'
  );
}

const MATERIAL_SLUG: Record<MaterialId, string> = {
  social: 'flyer',
  business_card: 'tarjetas',
  next_visit_card: 'tarjeta-proxima-visita',
  mailbox_flyer: 'flyer-buzon',
  van_vinyl: 'vinilo-furgoneta',
  tear_off_poster: 'cartel-pestanas',
  qr_stickers: 'pegatinas-qr',
  fence_sign: 'cartel-valla',
  qr_code: 'qr',
};

export function materialFileName(name: string, material: MaterialId, sizeId: string): string {
  return `garser-${slugify(name)}-${MATERIAL_SLUG[material]}-${slugify(sizeId)}.png`;
}
