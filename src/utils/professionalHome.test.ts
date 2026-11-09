import { describe, expect, it } from 'vitest';
import { professionalHome } from './professionalHome';

describe('professionalHome · a dónde lleva /dashboard a un profesional', () => {
  it('mientras no se conoce el estado de la solicitud, espera (sin saltar a ningún sitio)', () => {
    expect(professionalHome({ applicationStatus: null, statusLoaded: false, isTeam: false })).toBe('loading');
    expect(professionalHome({ applicationStatus: 'active', statusLoaded: false, isTeam: true })).toBe('loading');
  });

  it('aprobado y sin equipo: el panel de jardinero de siempre', () => {
    expect(professionalHome({ applicationStatus: 'active', statusLoaded: true, isTeam: false })).toBe('individual');
  });

  it('aprobado y con equipo: el panel de equipo (/empresa)', () => {
    expect(professionalHome({ applicationStatus: 'active', statusLoaded: true, isTeam: true })).toBe('team');
  });

  it('solicitud pendiente o rechazada: /status, aunque el modo diga equipo', () => {
    for (const applicationStatus of ['pending', 'denied'] as const) {
      expect(professionalHome({ applicationStatus, statusLoaded: true, isTeam: false })).toBe('status');
      expect(professionalHome({ applicationStatus, statusLoaded: true, isTeam: true })).toBe('status');
    }
  });

  it('sin solicitud enviada: /apply', () => {
    expect(professionalHome({ applicationStatus: null, statusLoaded: true, isTeam: false })).toBe('apply');
  });
});
