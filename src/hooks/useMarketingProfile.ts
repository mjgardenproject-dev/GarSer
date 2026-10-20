import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { MarketingProfile } from '../utils/marketing/content';

// Marketing del profesional: lo que sale en sus materiales, de su propia ficha (la que ven los
// clientes): nombre, foto, valoración y zona. Nunca la dirección.

export function useMarketingProfile(userId: string | undefined) {
  const [profile, setProfile] = useState<MarketingProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return undefined;
    let alive = true;
    (async () => {
      const { data, error: queryError } = await supabase
        .from('gardener_profiles')
        .select('user_id, full_name, avatar_url, rating_average, rating_count, city_zone, provider_kind')
        .eq('user_id', userId)
        .maybeSingle();
      if (!alive) return;
      if (queryError || !data) {
        setError('No hemos podido cargar tu ficha.');
        return;
      }
      const row = data as {
        user_id: string;
        full_name: string | null;
        avatar_url: string | null;
        rating_average: number | null;
        rating_count: number | null;
        city_zone: string | null;
        provider_kind: string | null;
      };
      setProfile({
        providerId: row.user_id,
        name: row.full_name?.trim() || 'Tu jardinero',
        kind: row.provider_kind === 'company' ? 'company' : 'solo',
        zone: row.city_zone?.trim() || null,
        avatarUrl: row.avatar_url?.trim() || null,
        ratingAverage: row.rating_average === null ? null : Number(row.rating_average),
        ratingCount: Number(row.rating_count || 0),
      });
      setError(null);
    })();
    return () => {
      alive = false;
    };
  }, [userId]);

  return { profile, error };
}
