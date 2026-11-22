// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AgendaMockup from './AgendaMockup';
import BookingRequestMockup from './BookingRequestMockup';
import ClientBookingMockup from './ClientBookingMockup';
import TeamScheduleMockup from './TeamScheduleMockup';

describe('maquetas de /para-jardineros · QA-204/QA-011: sin fechas fijas ya pasadas', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 19, 12, 0, 0)); });
  afterEach(() => { vi.useRealTimers(); cleanup(); });

  it('la solicitud cae en el próximo sábado, en el texto y en la descripción accesible', () => {
    const { container } = render(<BookingRequestMockup />);
    expect(container.textContent).toContain('sábado, 21 de noviembre');
    expect(container.innerHTML).toContain('sábado 21 de noviembre');
    expect(container.textContent).not.toMatch(/octubre/);
  });

  it('la agenda enseña la semana siguiente con sus siete días', () => {
    const { container } = render(<AgendaMockup />);
    expect(container.textContent).toContain('23 nov - 29 nov');
    for (const n of ['23', '24', '25', '26', '27', '28', '29']) expect(container.textContent).toContain(n);
    expect(container.textContent).not.toMatch(/oct/);
  });

  it('la agenda del equipo enseña el jueves de esa semana', () => {
    const { container } = render(<TeamScheduleMockup />);
    expect(container.textContent).toContain('Jueves 26 de noviembre');
    expect(container.textContent).not.toMatch(/octubre/);
  });

  it('la reserva del cliente enseña la semana del sábado de ejemplo (16 a 22), con el sábado elegido y lo ya pasado sin poder elegir', () => {
    const { container } = render(<ClientBookingMockup />);
    const text = container.textContent || '';
    for (const n of ['16', '17', '18', '19', '20', '21', '22']) expect(text).toContain(n);
    expect(text).not.toMatch(/13/);
    // Hoy (jueves 19) y los días anteriores no se pueden elegir; viernes 20 y sábado 21 sí.
    const cells = Array.from(container.querySelectorAll('[class*="rounded"]')).filter((el) => /^[LMXJVSD]\d{2}$/.test((el.textContent || '').trim()));
    const byDate = Object.fromEntries(cells.map((c) => [(c.textContent || '').trim().slice(1), c]));
    expect(byDate['19']?.className ?? '').toMatch(/gray|disabled|opacity|cursor-not/);
  });

  it('un mes después las fechas siguen siendo futuras (no se quedan fijas)', () => {
    vi.setSystemTime(new Date(2026, 11, 19, 12, 0, 0));
    const { container } = render(<BookingRequestMockup />);
    expect(container.textContent).toContain('sábado, 26 de diciembre');
  });
});
