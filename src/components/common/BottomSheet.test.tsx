// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import BottomSheet from './BottomSheet';

afterEach(cleanup);

const sheet = (props: Partial<React.ComponentProps<typeof BottomSheet>> = {}) => (
  <BottomSheet open title="Añade a tu equipo" description="Hasta que acepte, nada cambia." onClose={vi.fn()} {...props}>
    <button type="button">Dentro</button>
  </BottomSheet>
);

describe('BottomSheet', () => {
  it('cerrada no pinta nada', () => {
    render(sheet({ open: false }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('abierta es un diálogo modal con su título y su descripción', () => {
    render(sheet());
    const dialog = screen.getByRole('dialog', { name: 'Añade a tu equipo' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
    expect(screen.getByText('Hasta que acepte, nada cambia.')).toBeTruthy();
  });

  it('se cierra con Escape, con la X y tocando fuera', () => {
    const onClose = vi.fn();
    render(sheet({ onClose }));
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    fireEvent.click(screen.getByTestId('bottom-sheet-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('si no se puede cerrar (algo se está enviando), ni Escape ni el fondo ni la X lo cierran', () => {
    const onClose = vi.fn();
    render(sheet({ onClose, dismissible: false }));
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByTestId('bottom-sheet-backdrop'));
    expect(screen.queryByRole('button', { name: 'Cerrar' })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('bloquea el desplazamiento del fondo mientras está abierta y lo devuelve al cerrar', () => {
    document.body.style.overflow = 'auto';
    const view = render(sheet());
    expect(document.body.style.overflow).toBe('hidden');
    view.rerender(sheet({ open: false }));
    expect(document.body.style.overflow).toBe('auto');
  });

  it('el foco entra en la hoja y vuelve al botón que la abrió', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const view = render(sheet());
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
    view.rerender(sheet({ open: false }));
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
