// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import EmailConfirmationModal from './EmailConfirmationModal';

afterEach(cleanup);

describe('EmailConfirmationModal (QA-041, QA-039)', () => {
  const base = { isOpen: true, onClose: vi.fn(), email: 'ana@ejemplo.com' };

  it('cerrar es fácil de tocar (44 pt) y está dentro de la ventana', () => {
    render(<EmailConfirmationModal {...base} />);
    const close = screen.getByRole('button', { name: 'Cerrar' });
    expect(close.className).toContain('h-11');
    expect(close.className).toContain('w-11');
    expect(close.className).toMatch(/top-2|top-3/);
  });

  it('la ventana se desplaza si el móvil es bajo, en lugar de cortarse', () => {
    render(<EmailConfirmationModal {...base} />);
    expect(screen.getByRole('dialog').className).toContain('overflow-y-auto');
  });

  it('ofrece reenviar el correo y lo dice en el botón; durante la pausa cuenta atrás', () => {
    const onResend = vi.fn();
    const { rerender } = render(<EmailConfirmationModal {...base} onResend={onResend} resendWait={0} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reenviar el correo' }));
    expect(onResend).toHaveBeenCalledTimes(1);
    rerender(<EmailConfirmationModal {...base} onResend={onResend} resendWait={42} />);
    const waiting = screen.getByRole('button', { name: 'Reenviar en 42 s' }) as HTMLButtonElement;
    expect(waiting.disabled).toBe(true);
  });

  it('la nota no manda a «registrarte nuevamente» (ya existe la cuenta): manda a reenviar', () => {
    render(<EmailConfirmationModal {...base} onResend={vi.fn()} />);
    expect(document.body.textContent).not.toMatch(/registrarte nuevamente/);
    expect(document.body.textContent).toContain('pulsa «Reenviar el correo»');
  });

  it('el botón de cerrar la ventana dice «Entendido»', () => {
    render(<EmailConfirmationModal {...base} />);
    fireEvent.click(screen.getByRole('button', { name: 'Entendido' }));
    expect(base.onClose).toHaveBeenCalled();
  });

  it('cerrada, no pinta nada', () => {
    render(<EmailConfirmationModal {...base} isOpen={false} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
