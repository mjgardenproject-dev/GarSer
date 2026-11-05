// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import ServiceActivateButton from './ServiceActivateButton';

describe('ServiceActivateButton · tres estados (fallo 7.1)', () => {
  afterEach(cleanup);

  it('no se puede activar todavía: gris muy claro, «Activar», y sigue siendo tocable (aria-disabled, no disabled)', () => {
    const onClick = vi.fn();
    render(<ServiceActivateButton state="locked" serviceName="Corte de césped" onClick={onClick} />);
    const button = screen.getByRole('button', { name: /primero hay que configurar su precio/ }) as HTMLButtonElement;
    expect(button.textContent).toBe('Activar');
    expect(button.className).toContain('bg-gray-100');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('configurado y listo: gris más oscuro, «Activar»', () => {
    render(<ServiceActivateButton state="ready" serviceName="Corte de césped" onClick={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Activar Corte de césped' });
    expect(button.textContent).toBe('Activar');
    expect(button.className).toContain('bg-gray-300');
    expect(button.getAttribute('aria-disabled')).toBeNull();
  });

  it('activo: verde y «Activado»', () => {
    render(<ServiceActivateButton state="active" serviceName="Corte de césped" onClick={vi.fn()} />);
    const button = screen.getByRole('button', { name: /activado. Toca para desactivarlo/ });
    expect(button.textContent).toBe('Activado');
    expect(button.className).toContain('bg-emerald-700');
  });

  it('el gris claro es más claro que el gris oscuro (orden de los tres estados)', () => {
    const { rerender } = render(<ServiceActivateButton state="locked" serviceName="X" onClick={vi.fn()} />);
    const locked = screen.getByRole('button').className;
    rerender(<ServiceActivateButton state="ready" serviceName="X" onClick={vi.fn()} />);
    const ready = screen.getByRole('button').className;
    expect(locked).toContain('bg-gray-100');
    expect(ready).toContain('bg-gray-300');
    expect(locked).not.toBe(ready);
  });

  it('mide al menos 44 px de alto y no admite doble toque mientras trabaja', () => {
    const onClick = vi.fn();
    render(<ServiceActivateButton state="ready" serviceName="X" onClick={onClick} busy />);
    const button = screen.getByRole('button');
    expect(button.className).toContain('min-h-11');
    expect(button.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
