// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { deleteTrackingCookies, TRACKING_COOKIE_MATCHERS } from './trackingCookies';

const names = () => document.cookie.split(';').map((c) => c.trim().split('=')[0]).filter(Boolean);

afterEach(() => {
  for (const name of names()) document.cookie = `${name}=; Max-Age=0; path=/`;
});

describe('deleteTrackingCookies (QA-007: retirar el consentimiento borra lo de Meta y Google)', () => {
  it('borra las cookies de Meta y de Google y deja las demás', () => {
    document.cookie = '_fbp=fb.1.123; path=/';
    document.cookie = '_fbc=fb.1.456; path=/';
    document.cookie = '_gcl_au=1.1.789; path=/';
    document.cookie = '_gcl_aw=GCL.1; path=/';
    document.cookie = '_ga=GA1.1.1; path=/';
    document.cookie = '_ga_ABC123=GS1; path=/';
    document.cookie = 'sb-session=keep; path=/';
    document.cookie = 'tema=oscuro; path=/';
    deleteTrackingCookies();
    expect(names().sort()).toEqual(['sb-session', 'tema']);
  });

  it('sin cookies de seguimiento no hace nada', () => {
    document.cookie = 'tema=oscuro; path=/';
    deleteTrackingCookies();
    expect(names()).toEqual(['tema']);
  });

  it('reconoce los nombres de seguimiento y no otros parecidos', () => {
    const isTracking = (name: string) => TRACKING_COOKIE_MATCHERS.some((m) => m.test(name));
    for (const name of ['_fbp', '_fbc', '_gcl_au', '_gcl_aw', '_gcl_dc', '_gac_UA-1', '_ga', '_ga_XYZ']) expect(isTracking(name), name).toBe(true);
    for (const name of ['sb-abc-auth-token', 'fbp', 'gal', 'tema', '_gaming']) expect(isTracking(name), name).toBe(false);
  });
});
