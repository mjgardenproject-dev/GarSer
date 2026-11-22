// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CONFIRM_GUARD_MS, useConfirmDialog, type ConfirmConfig } from './ConfirmDialog';

function Harness({ config }: { config: ConfirmConfig }) {
  const { openConfirm, confirmDialog } = useConfirmDialog();
  return (
    <>
      <button type="button" onClick={() => openConfirm(config)}>abrir</button>
      {confirmDialog}
    </>
  );
}

let clock = 1_000_000;
const advance = (ms: number) => { clock += ms; };

describe('ConfirmDialog: doble comprobación antes de mover dinero (QA-189)', () => {
  beforeEach(() => {
    clock = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('con casilla de comprobación, no se puede confirmar hasta marcarla', async () => {
    const onConfirm = vi.fn();
    render(
      <Harness
        config={{
          title: '¿Devolver 9,00 € a Laura?',
          message: 'Se devuelve en Stripe y no se puede deshacer.',
          confirmLabel: 'Devolver 9,00 € a Laura',
          acknowledgement: 'He revisado el importe y la reserva',
          tone: 'danger',
          onConfirm,
        }}
      />,
    );
    fireEvent.click(screen.getByText('abrir'));
    const confirm = screen.getByRole('button', { name: 'Devolver 9,00 € a Laura' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();

    advance(5_000);
    fireEvent.click(screen.getByLabelText('He revisado el importe y la reserva'));
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    advance(CONFIRM_GUARD_MS + 1);
    await act(async () => { fireEvent.click(confirm); });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('un toque en confirmar justo después de marcar la casilla (toque fantasma) NO mueve dinero', async () => {
    const onConfirm = vi.fn();
    render(<Harness config={{ title: 't', message: 'm', confirmLabel: 'Devolver', acknowledgement: 'Revisado', onConfirm }} />);
    fireEvent.click(screen.getByText('abrir'));
    advance(5_000);
    fireEvent.click(screen.getByLabelText('Revisado'));
    advance(100);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Devolver' })); });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('un toque en confirmar nada más abrirse el diálogo NO mueve dinero', async () => {
    const onConfirm = vi.fn();
    render(<Harness config={{ title: 't', message: 'm', confirmLabel: 'Devolver', acknowledgement: 'Revisado', onConfirm }} />);
    fireEvent.click(screen.getByText('abrir'));
    fireEvent.click(screen.getByLabelText('Revisado'));
    advance(300);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Devolver' })); });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('la casilla va antes del texto y lejos del botón de confirmar', () => {
    render(<Harness config={{ title: 't', message: 'texto del aviso', confirmLabel: 'Devolver', acknowledgement: 'Revisado', onConfirm: vi.fn() }} />);
    fireEvent.click(screen.getByText('abrir'));
    const box = screen.getByLabelText('Revisado');
    const message = screen.getByText('texto del aviso');
    expect(box.compareDocumentPosition(message) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('la casilla vuelve a salir desmarcada al abrir otra vez', async () => {
    const config: ConfirmConfig = {
      title: 't', message: 'm', confirmLabel: 'Devolver', acknowledgement: 'Revisado', onConfirm: vi.fn(),
    };
    render(<Harness config={config} />);
    fireEvent.click(screen.getByText('abrir'));
    fireEvent.click(screen.getByLabelText('Revisado'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    fireEvent.click(screen.getByText('abrir'));
    expect((screen.getByLabelText('Revisado') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole('button', { name: 'Devolver' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('un doble toque en confirmar ejecuta la acción UNA sola vez', async () => {
    let release: () => void = () => undefined;
    const onConfirm = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    render(<Harness config={{ title: 't', message: 'm', confirmLabel: 'Sí', onConfirm }} />);
    fireEvent.click(screen.getByText('abrir'));
    const confirm = screen.getByRole('button', { name: 'Sí' });
    await act(async () => {
      fireEvent.click(confirm);
      fireEvent.click(confirm);
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await act(async () => { release(); });
  });

  it('sin casilla, se confirma como siempre', async () => {
    const onConfirm = vi.fn();
    render(<Harness config={{ title: 't', message: 'm', confirmLabel: 'Sí', onConfirm }} />);
    fireEvent.click(screen.getByText('abrir'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sí' })); });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe('ConfirmDialog: aviso tras un toque demasiado rápido', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });
  it('dice que vuelva a pulsar, y el segundo toque (ya con tiempo) confirma', async () => {
    let now = 5_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const onConfirm = vi.fn();
    render(<Harness config={{ title: 't', message: 'm', confirmLabel: 'Devolver', acknowledgement: 'Revisado', onConfirm }} />);
    fireEvent.click(screen.getByText('abrir'));
    now += 5_000;
    fireEvent.click(screen.getByLabelText('Revisado'));
    now += 100;
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Devolver' })); });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain('vuelve a pulsar');
    now += CONFIRM_GUARD_MS;
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Devolver' })); });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
