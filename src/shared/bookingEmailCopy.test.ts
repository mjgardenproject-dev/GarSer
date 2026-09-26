import { describe, it, expect } from 'vitest';
import {
  cancellationCopy,
  proposedDurationText,
  shouldSendGardenerConfirmation,
} from '../../supabase/functions/_shared/bookingEmailCopy.ts';

// H-37: correos reales de la reserva de prueba en garser.es (2026-09-26).
describe('cancellationCopy', () => {
  it('al jardinero, si cancela el cliente: lo dice y no le promete cobrar nada', () => {
    const copy = cancellationCopy({ actor: 'client', audience: 'gardener', counterpartName: 'Marta' });
    expect(copy.intro).toBe('Marta ha cancelado esta reserva:');
    expect(copy.footerNote).toBe('Esas horas vuelven a estar libres en tu agenda.');
    expect(`${copy.intro} ${copy.footerNote}`).not.toMatch(/cobrar|íntegro|€/i);
  });

  it('al cliente, si cancela el profesional', () => {
    const copy = cancellationCopy({ actor: 'gardener', audience: 'client', counterpartName: 'Jardines Sol' });
    expect(copy.intro).toBe('Jardines Sol ha cancelado tu reserva:');
    expect(copy.footerNote).toBe('Puedes hacer una nueva reserva cuando quieras.');
  });

  it('sin nombre, cancelada por el sistema, y con motivo', () => {
    expect(cancellationCopy({ actor: 'client', audience: 'gardener' }).intro).toBe('El cliente ha cancelado esta reserva:');
    expect(cancellationCopy({ actor: 'system', audience: 'client' }).intro).toBe('Tu reserva ha quedado cancelada:');
    expect(cancellationCopy({ actor: 'gardener', audience: 'client', reason: 'Lluvia' }).footerNote)
      .toBe('Motivo: Lluvia · Puedes hacer una nueva reserva cuando quieras.');
  });
});

describe('proposedDurationText', () => {
  it('como la web: «4 h (fin a las 13:00) — antes 3 h»', () => {
    expect(proposedDurationText({ startTime: '09:00:00', durationHours: 3, proposedDurationHours: 4 }))
      .toBe('4 h (fin a las 13:00) — antes 3 h');
  });

  it('nada si la propuesta no cambia la duración', () => {
    expect(proposedDurationText({ startTime: '09:00:00', durationHours: 3, proposedDurationHours: null })).toBeNull();
    expect(proposedDurationText({ startTime: '09:00:00', durationHours: 3, proposedDurationHours: 3 })).toBeNull();
  });
});

describe('shouldSendGardenerConfirmation', () => {
  it('no repite «Nueva reserva confirmada» si se confirmó al aceptar el cliente su precio', () => {
    expect(shouldSendGardenerConfirmation({ price_change_status: 'accepted' })).toBe(false);
    expect(shouldSendGardenerConfirmation({ price_change_status: null })).toBe(true);
    expect(shouldSendGardenerConfirmation({ price_change_status: 'rejected' })).toBe(true);
  });
});
