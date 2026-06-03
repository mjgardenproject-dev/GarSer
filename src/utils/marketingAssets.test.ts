import { describe, expect, it, vi } from 'vitest';

const getPublicUrlMock = vi.fn((assetPath: string) => ({
  data: { publicUrl: `https://cdn.example.com/${assetPath}` },
}));

vi.mock('../lib/supabase', () => ({
  supabase: {
    storage: {
      from: () => ({
        getPublicUrl: getPublicUrlMock,
      }),
    },
  },
}));

describe('marketingAssets', () => {
  it('devuelve el path estable para cada slot', async () => {
    const { getMarketingAssetPath } = await import('./marketingAssets');

    expect(getMarketingAssetPath('home.hero.mobile')).toBe('home/hero-mobile.webp');
  });

  it('construye una URL publica desde el bucket de marketing', async () => {
    const { getMarketingAssetUrl } = await import('./marketingAssets');

    expect(getMarketingAssetUrl('marbella.hero')).toBe('https://cdn.example.com/marbella/hero.webp');
    expect(getPublicUrlMock).toHaveBeenCalledWith('marbella/hero.webp');
  });
});
