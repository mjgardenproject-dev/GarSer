import { describe, expect, it } from 'vitest';
import {
  getBookingStatusLabel,
  getBookingStatusTone,
  isCancellableStatus,
  isClosedWithoutService,
  type BookingStatus,
} from './bookingStatus';

const ALL_STATUSES: BookingStatus[] = [
  'pending',
  'confirmed',
  'completed',
  'cancelled',
  'expired',
  'no_show_client',
  'no_show_gardener',
  'disputed',
];

describe('getBookingStatusLabel', () => {
  it('cubre los ocho estados sin dejar ninguno sin texto', () => {
    // El fallo que esto impide: el panel del jardinero solo mapeaba cuatro estados y pintaba
    // el identificador crudo ("no_show_client") delante del usuario.
    ALL_STATUSES.forEach((status) => {
      const label = getBookingStatusLabel(status);
      expect(label).not.toBe(status);
      expect(label).not.toContain('_');
    });
  });

  it('cuenta el mismo estado según a quién se lo cuentas', () => {
    expect(getBookingStatusLabel('no_show_client', 'client')).toBe('No se pudo realizar');
    expect(getBookingStatusLabel('no_show_client', 'gardener')).toBe('Cliente ausente');
    expect(getBookingStatusLabel('no_show_gardener', 'client')).toBe('El profesional no acudió');
    expect(getBookingStatusLabel('no_show_gardener', 'gardener')).toBe('No acudiste');
  });

  it('usa el mismo texto para ambos cuando no hay motivo para distinguir', () => {
    expect(getBookingStatusLabel('confirmed', 'client')).toBe(getBookingStatusLabel('confirmed', 'gardener'));
    expect(getBookingStatusLabel('completed', 'client')).toBe(getBookingStatusLabel('completed', 'gardener'));
  });

  it('ante un estado desconocido no enseña el identificador', () => {
    expect(getBookingStatusLabel('algo_raro')).toBe('Estado desconocido');
    expect(getBookingStatusLabel(null)).toBe('Estado desconocido');
    expect(getBookingStatusLabel(undefined)).toBe('Estado desconocido');
  });
});

describe('getBookingStatusTone', () => {
  it('da clases a los ocho estados', () => {
    ALL_STATUSES.forEach((status) => {
      expect(getBookingStatusTone(status)).toMatch(/^bg-/);
    });
  });

  it('cae en gris neutro ante un estado desconocido', () => {
    expect(getBookingStatusTone('algo_raro')).toBe('bg-gray-100 text-gray-800');
  });
});

describe('isCancellableStatus', () => {
  it('solo mientras la reserva sigue viva', () => {
    expect(isCancellableStatus('pending')).toBe(true);
    expect(isCancellableStatus('confirmed')).toBe(true);
  });

  it('nunca sobre una reserva ya cerrada', () => {
    // Cancelar una reserva completada movería dinero de un servicio que ya se prestó.
    ['completed', 'cancelled', 'expired', 'no_show_client', 'no_show_gardener', 'disputed'].forEach((status) => {
      expect(isCancellableStatus(status)).toBe(false);
    });
  });
});

describe('isClosedWithoutService', () => {
  it('agrupa lo que terminó sin servicio prestado', () => {
    ['cancelled', 'expired', 'no_show_client', 'no_show_gardener', 'disputed'].forEach((status) => {
      expect(isClosedWithoutService(status)).toBe(true);
    });
  });

  it('deja fuera lo vivo y lo completado', () => {
    ['pending', 'confirmed', 'completed'].forEach((status) => {
      expect(isClosedWithoutService(status)).toBe(false);
    });
  });
});
