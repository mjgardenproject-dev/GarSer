import { describe, expect, it } from 'vitest';
import { emptyPersonPreset, looksLikeEmail, presetPayload, presetProblem } from './teamInvitations';

describe('invitar al equipo', () => {
  it('reconoce correos con forma de correo', () => {
    expect(looksLikeEmail('ana@empresa.es')).toBe(true);
    expect(looksLikeEmail(' ana@empresa.es ')).toBe(true);
    expect(looksLikeEmail('ana@')).toBe(false);
    expect(looksLikeEmail('ana empresa.es')).toBe(false);
    expect(looksLikeEmail('ana@empresa')).toBe(false);
  });

  it('«mismo horario que yo» se manda como modo empresa; el nombre vacío no se manda', () => {
    expect(presetPayload({ ...emptyPersonPreset(), serviceIds: ['s1'] })).toEqual({ service_ids: ['s1'], schedule: { mode: 'company' } });
  });

  it('«otro horario» manda una regla por día con horas en punto', () => {
    const payload = presetPayload({ ...emptyPersonPreset(), name: ' Ana ', schedule: 'custom', days: [1, 3], start: 9, end: 13, requestLicense: true });
    expect(payload).toEqual({
      display_name: 'Ana',
      service_ids: [],
      schedule: {
        mode: 'custom',
        weeks: 4,
        rules: [
          { day_of_week: 1, start_time: '09:00:00', end_time: '13:00:00' },
          { day_of_week: 3, start_time: '09:00:00', end_time: '13:00:00' },
        ],
      },
      request_license: true,
    });
  });

  it('dice qué falla en «otro horario»', () => {
    expect(presetProblem({ ...emptyPersonPreset(), schedule: 'custom', days: [] })).toMatch(/al menos un día/);
    expect(presetProblem({ ...emptyPersonPreset(), schedule: 'custom', start: 14, end: 9 })).toMatch(/fin/);
    expect(presetProblem(emptyPersonPreset())).toBe('');
  });
});
