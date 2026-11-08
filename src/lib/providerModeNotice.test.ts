// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { modeTransition, readLastSeenMode, writeLastSeenMode } from './providerModeNotice';

describe('providerModeNotice', () => {
  beforeEach(() => localStorage.clear());

  it('modeTransition: solo hay aviso cuando el modo cambió respecto al último visto', () => {
    expect(modeTransition('individual', 'team')).toBe('to_team');
    expect(modeTransition('team', 'individual')).toBe('to_individual');
    expect(modeTransition('team', 'team')).toBeNull();
    expect(modeTransition('individual', 'individual')).toBeNull();
  });

  it('sin dato previo (primer acceso, otro navegador) o sin modo actual, no hay aviso', () => {
    expect(modeTransition(null, 'team')).toBeNull();
    expect(modeTransition(null, 'individual')).toBeNull();
    expect(modeTransition('team', null)).toBeNull();
  });

  it('guarda y lee el último modo visto, separado por cuenta', () => {
    writeLastSeenMode('u1', 'team');
    writeLastSeenMode('u2', 'individual');
    expect(readLastSeenMode('u1')).toBe('team');
    expect(readLastSeenMode('u2')).toBe('individual');
    expect(readLastSeenMode('u3')).toBeNull();
  });

  it('un valor guardado que no es un modo se ignora (nunca decide nada)', () => {
    localStorage.setItem('garser.providerMode.lastSeen:u1', 'company');
    expect(readLastSeenMode('u1')).toBeNull();
  });

  it('si el almacenamiento falla, no rompe: lee null y escribir no lanza', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('bloqueado'); });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('bloqueado'); });
    expect(readLastSeenMode('u1')).toBeNull();
    expect(() => writeLastSeenMode('u1', 'team')).not.toThrow();
    getItem.mockRestore();
    setItem.mockRestore();
  });
});
