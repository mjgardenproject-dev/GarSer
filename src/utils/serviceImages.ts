import { Service } from '../types';
import { getMarketingAssetUrl } from './marketingAssets';

const SERVICE_IMAGE_SLOTS: Record<string, Parameters<typeof getMarketingAssetUrl>[0]> = {
  'corte de cesped': 'home.services.lawn',
  'corte de setos a maquina': 'home.services.hedges',
  'desbroce de malas hierbas': 'home.services.weeding',
  'poda de arboles': 'home.services.trees',
  'poda de palmeras': 'home.services.palms',
  'poda de plantas y arbustos': 'home.services.plants',
  'servicios fitosanitarios': 'home.services.phyto',
};

const normalizeServiceName = (value: string) =>
  (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const isHttpUrl = (value: string) => /^https?:\/\//i.test(value);

const getMarketingImageForService = (serviceName?: string) => {
  const slot = SERVICE_IMAGE_SLOTS[normalizeServiceName(serviceName || '')];
  return slot ? getMarketingAssetUrl(slot) : '';
};

export const getServiceImageFallbackUrl = (serviceName?: string) =>
  getMarketingImageForService(serviceName);

export const getServiceImageUrl = (service: Pick<Service, 'name' | 'image_id' | 'image_url'>) => {
  const marketingImageUrl = getMarketingImageForService(service.name);
  if (marketingImageUrl) return marketingImageUrl;

  const rawImageUrl = String(service.image_url || '').trim();
  if (isHttpUrl(rawImageUrl)) return rawImageUrl;

  const rawImageId = String(service.image_id || '').trim();
  if (isHttpUrl(rawImageId)) return rawImageId;
  if (/^\d+$/.test(rawImageId)) return '';

  return getServiceImageFallbackUrl(service.name) || '';
};
