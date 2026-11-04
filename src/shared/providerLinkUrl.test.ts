import { describe, expect, it } from 'vitest';

import { buildProviderBookingUrl, PROVIDER_LINK_QUERY_PARAM } from './providerLinkUrl';

const ID = '11111111-1111-4111-8111-111111111111';
const CODE = '0123456789abcdef0123456789abcdef';

describe('buildProviderBookingUrl', () => {
  it('lleva el profesional y la clave', () => {
    expect(PROVIDER_LINK_QUERY_PARAM).toBe('c');
    expect(buildProviderBookingUrl({ origin: 'https://garser.es', providerId: ID, code: CODE }))
      .toBe(`https://garser.es/reservar/${ID}?c=${CODE}`);
  });

  it('añade el origen para medir después de la clave y lo codifica', () => {
    expect(buildProviderBookingUrl({ origin: 'https://garser.es', providerId: ID, code: CODE, source: 'vinilo furgo' }))
      .toBe(`https://garser.es/reservar/${ID}?c=${CODE}&utm_source=vinilo%20furgo`);
  });

  it('tolera barras finales en el dominio', () => {
    expect(buildProviderBookingUrl({ origin: 'https://garser.es//', providerId: ID, code: CODE }))
      .toBe(`https://garser.es/reservar/${ID}?c=${CODE}`);
  });
});
