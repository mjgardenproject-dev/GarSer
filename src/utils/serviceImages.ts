import { Service } from '../types';

const DEFAULT_PEXELS_IMAGE_ID = '416978';

const SERVICE_IMAGE_FALLBACKS: Record<string, string> = {
  'corte de cesped': DEFAULT_PEXELS_IMAGE_ID,
  'corte de setos a maquina': DEFAULT_PEXELS_IMAGE_ID,
  'desbroce de malas hierbas': DEFAULT_PEXELS_IMAGE_ID,
  'poda de arboles': DEFAULT_PEXELS_IMAGE_ID,
  'poda de palmeras': DEFAULT_PEXELS_IMAGE_ID,
  'poda de plantas y arbustos': DEFAULT_PEXELS_IMAGE_ID,
  'servicios fitosanitarios': DEFAULT_PEXELS_IMAGE_ID,
};

const normalizeServiceName = (value: string) =>
  (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const isHttpUrl = (value: string) => /^https?:\/\//i.test(value);

const buildPexelsImageUrl = (imageId: string, width: number) =>
  `https://images.pexels.com/photos/${imageId}/pexels-photo-${imageId}.jpeg?auto=compress&cs=tinysrgb&w=${width}`;

export const getServiceImageFallbackUrl = (serviceName?: string) =>
  buildPexelsImageUrl(
    SERVICE_IMAGE_FALLBACKS[normalizeServiceName(serviceName || '')] || DEFAULT_PEXELS_IMAGE_ID,
    1200
  );

export const getServiceImageUrl = (service: Pick<Service, 'name' | 'image_id' | 'image_url'>, width = 1200) => {
  const rawImageUrl = String(service.image_url || '').trim();
  if (isHttpUrl(rawImageUrl)) return rawImageUrl;

  const rawImageId = String(service.image_id || '').trim();
  if (isHttpUrl(rawImageId)) return rawImageId;
  if (/^\d+$/.test(rawImageId)) return buildPexelsImageUrl(rawImageId, width);

  return getServiceImageFallbackUrl(service.name);
};
