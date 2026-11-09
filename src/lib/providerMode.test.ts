import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('./supabase', () => ({ supabase: { rpc } }));

import { fetchProviderMode, parseProviderMode } from './providerMode';

describe('parseProviderMode · lo que devuelve my_provider_mode()', () => {
  it('un profesional individual sin equipo ni invitaciones', () => {
    expect(parseProviderMode({
      is_professional: true, mode: 'individual', has_team_structure: false, active_employees: 0,
      pending_invitations: 0, owner_works: true, suspended: false, liability_declared: false,
    })).toEqual({
      isProfessional: true, mode: 'individual', hasTeamStructure: false, activeEmployees: 0,
      pendingInvitations: 0, ownerWorks: true, suspended: false, liabilityDeclared: false,
    });
  });

  it('un profesional con equipo, invitaciones y el seguro ya declarado', () => {
    expect(parseProviderMode({
      is_professional: true, mode: 'team', has_team_structure: true, active_employees: 3,
      pending_invitations: 1, owner_works: false, suspended: false, liability_declared: true,
    })).toEqual({
      isProfessional: true, mode: 'team', hasTeamStructure: true, activeEmployees: 3,
      pendingInvitations: 1, ownerWorks: false, suspended: false, liabilityDeclared: true,
    });
  });

  it('quien no es profesional no tiene modo (un aspirante sin ficha, un cliente)', () => {
    const info = parseProviderMode({ is_professional: false });
    expect(info.isProfessional).toBe(false);
    expect(info.mode).toBeNull();
  });

  it('lo que no entiende nunca lo convierte en equipo', () => {
    for (const raw of [null, undefined, 'team', 7, [], {}, { is_professional: 'sí', mode: 'team' }]) {
      expect(parseProviderMode(raw).mode).not.toBe('team');
    }
    // Un modo desconocido de un profesional se lee como individual (el panel de siempre).
    expect(parseProviderMode({ is_professional: true, mode: 'otra-cosa' }).mode).toBe('individual');
  });

  it('los contadores raros no rompen: negativos, texto o decimales dan un número seguro', () => {
    const info = parseProviderMode({ is_professional: true, mode: 'team', active_employees: -4, pending_invitations: 'dos' });
    expect(info.activeEmployees).toBe(0);
    expect(info.pendingInvitations).toBe(0);
    expect(parseProviderMode({ is_professional: true, active_employees: 2.9 }).activeEmployees).toBe(2);
  });

  it('el titular trabaja salvo que el servidor diga lo contrario', () => {
    expect(parseProviderMode({ is_professional: true }).ownerWorks).toBe(true);
    expect(parseProviderMode({ is_professional: true, owner_works: false }).ownerWorks).toBe(false);
  });
});

describe('fetchProviderMode', () => {
  beforeEach(() => rpc.mockReset());

  it('pide my_provider_mode() sin parámetros (el servidor deriva todo de la sesión) y lo interpreta', async () => {
    rpc.mockResolvedValue({ data: { is_professional: true, mode: 'team', active_employees: 1 }, error: null });
    const info = await fetchProviderMode();
    expect(rpc).toHaveBeenCalledWith('my_provider_mode');
    expect(info.mode).toBe('team');
    expect(info.activeEmployees).toBe(1);
  });

  it('un error del servidor se propaga (quien llama decide qué enseñar)', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Failed to fetch' } });
    await expect(fetchProviderMode()).rejects.toMatchObject({ message: 'Failed to fetch' });
  });
});
