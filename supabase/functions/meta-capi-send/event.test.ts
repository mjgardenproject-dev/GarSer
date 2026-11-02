import { describe, expect, it } from 'vitest';
import { buildCapiEvent, normalizePayload } from './event';

const sha256 = async (value: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
};

const client = { ip: '203.0.113.7', userAgent: 'Mozilla/5.0 (admin)' };

describe('normalizePayload', () => {
  it('rechaza lo que no trae nombre o identificador del evento', () => {
    expect(normalizePayload(null)).toBeNull();
    expect(normalizePayload({ event_name: 'Lead' })).toBeNull();
    expect(normalizePayload({ event_id: 'x' })).toBeNull();
  });

  it('el origen es «visitor» salvo que diga «recorded»', () => {
    expect(normalizePayload({ event_name: 'Lead', event_id: '1' })?.origin).toBe('visitor');
    expect(normalizePayload({ event_name: 'Lead', event_id: '1', origin: 'otra cosa' })?.origin).toBe('visitor');
    expect(normalizePayload({ event_name: 'ProviderApproved', event_id: '1', origin: 'recorded' })?.origin).toBe('recorded');
  });
});

describe('buildCapiEvent', () => {
  it('un evento del propio navegador lleva correo cifrado, IP, navegador, página y origen «website»', async () => {
    const payload = normalizePayload({
      event_name: 'Lead',
      event_id: 'evt-1',
      event_source_url: 'https://garser.es/para-jardineros',
      user_data: { email: ' Ana@Ejemplo.com ' },
    })!;
    const event = await buildCapiEvent(payload, client, 1700000000);

    expect(event.action_source).toBe('website');
    expect(event.event_source_url).toBe('https://garser.es/para-jardineros');
    expect(event.event_time).toBe(1700000000);
    expect(event.user_data).toEqual({
      em: [await sha256('ana@ejemplo.com')],
      client_ip_address: '203.0.113.7',
      client_user_agent: 'Mozilla/5.0 (admin)',
    });
  });

  it('un evento «recorded» NO lleva la IP, el navegador ni la página de quien lo manda (el admin)', async () => {
    const payload = normalizePayload({
      event_name: 'ProviderApproved',
      event_id: 'evt-2',
      event_source_url: 'https://garser.es/admin/users',
      origin: 'recorded',
      user_data: { email: 'empresa@ejemplo.com' },
    })!;
    const event = await buildCapiEvent(payload, client, 1700000000);

    expect(event.action_source).toBe('system_generated');
    expect(event).not.toHaveProperty('event_source_url');
    expect(event.user_data).toEqual({ em: [await sha256('empresa@ejemplo.com')] });
    expect(JSON.stringify(event)).not.toContain('203.0.113.7');
    expect(JSON.stringify(event)).not.toContain('admin');
  });

  it('el teléfono se normaliza a dígitos antes de cifrarlo', async () => {
    const payload = normalizePayload({ event_name: 'Lead', event_id: 'evt-3', user_data: { phone: '+34 612 345 678' } })!;
    const event = await buildCapiEvent(payload, {}, 1);
    expect(event.user_data).toEqual({ ph: [await sha256('34612345678')] });
  });
});
