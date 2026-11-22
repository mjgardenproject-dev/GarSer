// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import PaymentSheetShell from './PaymentSheetShell';

type VV = EventTarget & { height: number; offsetTop: number };
const setViewport = (vv: VV | undefined) => Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });

const sheet = () => render(
  <PaymentSheetShell
    title="Pago seguro" amountCaption="Gastos de gestión" amount="9,00 €" amountNote="Se retiene con Stripe"
    onClose={() => undefined} canClose
    footer={<button type="button">Pagar 9,00 €</button>}
  >
    <div style={{ height: 2000 }}>formulario de tarjeta</div>
  </PaymentSheetShell>,
);

describe('PaymentSheetShell · QA-135', () => {
  afterEach(() => { cleanup(); setViewport(undefined); });

  it('el pie con «Pagar» es parte de la hoja (no fijo sobre ella) y el contenido es lo que se desplaza', () => {
    setViewport(undefined);
    sheet();
    const footer = screen.getByRole('button', { name: 'Pagar 9,00 €' }).parentElement as HTMLElement;
    expect(footer.className).not.toMatch(/\bfixed\b/);
    expect(footer.className).toContain('shrink-0');
    const content = screen.getByText('formulario de tarjeta').parentElement as HTMLElement;
    expect(content.className).toContain('overflow-y-auto');
    expect(content.className).toContain('min-h-0');
    // Ya no hace falta el hueco de 8 rem que dejaba el pie fijo.
    expect(content.className).not.toContain('pb-32');
  });

  it('la hoja mide lo que ve el cliente: con el teclado abierto se encoge', () => {
    const vv = Object.assign(new EventTarget(), { height: 667, offsetTop: 0 });
    setViewport(vv);
    sheet();
    expect((screen.getByTestId('payment-sheet') as HTMLElement).style.height).toBe('667px');
    act(() => { vv.height = 400; vv.offsetTop = 0; vv.dispatchEvent(new Event('resize')); });
    expect((screen.getByTestId('payment-sheet') as HTMLElement).style.height).toBe('400px');
  });

  it('QA-135 · con el teclado abierto la hoja se compacta (sin la nota del importe, pie más bajo) para dejar sitio al formulario', () => {
    Object.defineProperty(window, 'innerHeight', { value: 667, configurable: true });
    const vv = Object.assign(new EventTarget(), { height: 667, offsetTop: 0 });
    setViewport(vv);
    sheet();
    expect(screen.getByTestId('payment-sheet').getAttribute('data-compact')).toBe('false');
    expect(screen.queryByText('Se retiene con Stripe')).not.toBeNull();
    act(() => { vv.height = 380; vv.dispatchEvent(new Event('resize')); });
    expect(screen.getByTestId('payment-sheet').getAttribute('data-compact')).toBe('true');
    expect(screen.queryByText('Se retiene con Stripe')).toBeNull();
    // El importe sigue a la vista, en la misma fila que el título.
    expect(screen.getByText('· 9,00 €').closest('#payment-sheet-title')).not.toBeNull();
    act(() => { vv.height = 667; vv.dispatchEvent(new Event('resize')); });
    expect(screen.getByTestId('payment-sheet').getAttribute('data-compact')).toBe('false');
  });

  it('sin visualViewport usa toda la pantalla como siempre', () => {
    setViewport(undefined);
    sheet();
    const el = screen.getByTestId('payment-sheet') as HTMLElement;
    expect(el.style.height).toBe('');
    expect(el.className).toContain('inset-y-0');
  });

  it('el aviso del cierre y el título siguen accesibles', () => {
    setViewport(undefined);
    sheet();
    expect(screen.getByRole('dialog', { name: 'Pago seguro' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cerrar pago' })).toBeTruthy();
  });
});
