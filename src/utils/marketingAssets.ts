import { supabase } from '../lib/supabase';
import { marketingImageSlots, type MarketingImageSlotKey } from '../config/publicSiteContent';

export const MARKETING_BUCKET = 'marketing-assets';

export const getMarketingAssetPath = (slot: MarketingImageSlotKey): string => marketingImageSlots[slot];

export const getMarketingAssetUrl = (slot: MarketingImageSlotKey): string => {
  const assetPath = getMarketingAssetPath(slot);
  const { data } = supabase.storage.from(MARKETING_BUCKET).getPublicUrl(assetPath);

  return data.publicUrl;
};
