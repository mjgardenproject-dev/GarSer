import { describe, expect, it } from 'vitest';
import {
  MAX_TEAM_SIZE,
  describeTeamSize,
  estimatedTeamSize,
  teamSizeHint,
  teamStateFromSize,
} from './applicationTeamSize';

describe('estimatedTeamSize', () => {
  it('«solo» son 1 persona, escriba lo que escriba en el campo del equipo', () => {
    expect(estimatedTeamSize('solo', '')).toBe(1);
    expect(estimatedTeamSize('solo', '7')).toBe(1);
  });

  it('sin elegir nada no hay respuesta', () => {
    expect(estimatedTeamSize(null, '')).toBeNull();
    expect(estimatedTeamSize(null, '3')).toBeNull();
  });

  it('«con equipo» cuenta al solicitante: de 2 a 200', () => {
    expect(estimatedTeamSize('team', '2')).toBe(2);
    expect(estimatedTeamSize('team', ' 12 ')).toBe(12);
    expect(estimatedTeamSize('team', String(MAX_TEAM_SIZE))).toBe(200);
  });

  it('«con equipo» sin número válido no cuenta como respondida', () => {
    for (const bad of ['', ' ', '1', '0', '-3', '201', '2.5', '2,5', '1e2', 'tres', '+4']) {
      expect(estimatedTeamSize('team', bad), `«${bad}»`).toBeNull();
    }
  });
});

describe('teamStateFromSize', () => {
  it('restaura un borrador guardado', () => {
    expect(teamStateFromSize(1)).toEqual({ choice: 'solo', input: '' });
    expect(teamStateFromSize(4)).toEqual({ choice: 'team', input: '4' });
    expect(teamStateFromSize(200)).toEqual({ choice: 'team', input: '200' });
  });

  it('una solicitud anterior (sin dato) o un valor imposible no restauran nada', () => {
    for (const bad of [null, undefined, 0, -1, 201, 2.5, Number.NaN]) {
      expect(teamStateFromSize(bad as number | null | undefined), String(bad)).toEqual({ choice: null, input: '' });
    }
  });

  it('ida y vuelta: lo que se guarda se restaura igual', () => {
    for (const size of [1, 2, 9, 200]) {
      const { choice, input } = teamStateFromSize(size);
      expect(estimatedTeamSize(choice, input)).toBe(size);
    }
  });
});

describe('teamSizeHint', () => {
  it('no dice nada si ya está respondida', () => {
    expect(teamSizeHint('solo', '')).toBe('');
    expect(teamSizeHint('team', '3')).toBe('');
  });

  it('pide elegir, o el número si se eligió «con equipo»', () => {
    expect(teamSizeHint(null, '')).toMatch(/solo o con equipo/i);
    expect(teamSizeHint('team', '')).toMatch(/de 2 a 200/);
    expect(teamSizeHint('team', '1')).toMatch(/de 2 a 200/);
  });
});

describe('describeTeamSize (lo que lee el administrador)', () => {
  it('distingue solo, con equipo y solicitud anterior sin dato', () => {
    expect(describeTeamSize(1)).toMatch(/^Solo/);
    expect(describeTeamSize(6)).toMatch(/Con equipo \(6 personas/);
    expect(describeTeamSize(null)).toMatch(/Sin indicar/);
    expect(describeTeamSize(undefined)).toMatch(/Sin indicar/);
  });
});
