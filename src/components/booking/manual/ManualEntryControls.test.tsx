// @vitest-environment jsdom
// F3 (ronda 2026-09-30): controles del asistente manual.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ManualEntryWizard, type ManualWizardSubmitPayload } from './ManualEntryWizard';
import { MANUAL_ENTRY_SURVEYS } from '../../../shared/manualEntry/manualEntrySchema';
import { stepValue } from './presentation/numberStep';

afterEach(() => cleanup());

const next = () => fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
const lastDraft = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls[fn.mock.calls.length - 1][0] as ManualWizardSubmitPayload;

describe('stepper con rejilla (P-03)', () => {
  const hedge = { min: 0.3, max: 6, step: 0.5 };

  it('altura del seto: 0,3 → 0,5 → 1,0 → 1,5 → 2,0 → 2,5 (pasa por el límite de tramo)', () => {
    const values: number[] = [];
    let current: number | undefined;
    for (let i = 0; i < 5; i += 1) {
      current = stepValue(current, 1, hedge);
      values.push(current);
    }
    expect(values).toEqual([0.5, 1, 1.5, 2, 2.5]);
  });

  it('un valor escrito fuera de la rejilla vuelve a ella con los botones', () => {
    expect(stepValue(2.3, 1, hedge)).toBe(2.5);
    expect(stepValue(2.3, -1, hedge)).toBe(2);
    expect(stepValue(0.5, -1, hedge)).toBe(0.3);
    expect(stepValue(6, 1, hedge)).toBe(6);
  });

  it('número de palmeras: enteros dentro de 1–50', () => {
    expect(stepValue(1, 1, { min: 1, max: 50, step: 1 })).toBe(2);
    expect(stepValue(1, -1, { min: 1, max: 50, step: 1 })).toBe(1);
  });

  it('en el asistente, cuatro toques de «+» llevan a 2,0 m', () => {
    const onDraftChange = vi.fn();
    render(<ManualEntryWizard survey={MANUAL_ENTRY_SURVEYS.hedge} onSubmit={vi.fn()} onDraftChange={onDraftChange} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Longitud del seto' }), { target: { value: '14' } });
    next();
    const plus = screen.getByRole('button', { name: 'Aumentar altura del seto' });
    for (let i = 0; i < 4; i += 1) fireEvent.click(plus);
    expect((screen.getByRole('textbox', { name: 'Altura del seto' }) as HTMLInputElement).value).toBe('2');
    expect(lastDraft(onDraftChange).items[0].altura_m).toBe(2);
  });
});

describe('campo numérico (P-15, D-07, P-10)', () => {
  it('la coma decimal se guarda como decimal: «1,5» = 1.5, no 15', () => {
    const onDraftChange = vi.fn();
    render(<ManualEntryWizard survey={MANUAL_ENTRY_SURVEYS.hedge} onSubmit={vi.fn()} onDraftChange={onDraftChange} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Longitud del seto' }), { target: { value: '14' } });
    next();
    fireEvent.change(screen.getByRole('textbox', { name: 'Altura del seto' }), { target: { value: '1,5' } });
    expect(lastDraft(onDraftChange).items[0].altura_m).toBe(1.5);
    expect((screen.getByRole('textbox', { name: 'Altura del seto' }) as HTMLInputElement).value).toBe('1,5');
  });

  it('«1.000» en una superficie son mil, y se dice cómo se ha leído', () => {
    const onDraftChange = vi.fn();
    render(<ManualEntryWizard survey={MANUAL_ENTRY_SURVEYS.lawn} onSubmit={vi.fn()} onDraftChange={onDraftChange} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Superficie de césped' }), { target: { value: '1.000' } });
    expect(lastDraft(onDraftChange).items[0].superficie_m2).toBe(1000);
    expect(screen.getByText('Se leerá como 1.000 m².')).toBeTruthy();
  });

  it('el teclado del móvil es numérico y no es un input type="number"', () => {
    render(<ManualEntryWizard survey={MANUAL_ENTRY_SURVEYS.lawn} onSubmit={vi.fn()} />);
    const input = screen.getByRole('textbox', { name: 'Superficie de césped' });
    expect(input.getAttribute('type')).toBe('text');
    expect(input.getAttribute('inputmode')).toBe('decimal');
    expect(document.querySelector('input[type="range"]')).toBeNull();
  });

  it('lo que no es un número se marca al salir del campo, sin adivinar un valor', () => {
    const onDraftChange = vi.fn();
    render(<ManualEntryWizard survey={MANUAL_ENTRY_SURVEYS.lawn} onSubmit={vi.fn()} onDraftChange={onDraftChange} />);
    const input = screen.getByRole('textbox', { name: 'Superficie de césped' });
    fireEvent.change(input, { target: { value: '80 metros' } });
    expect(screen.queryByText(/Escribe solo el número/)).toBeNull();
    fireEvent.blur(input);
    expect(screen.getByText('Escribe solo el número, por ejemplo 80 o 12,5.')).toBeTruthy();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(lastDraft(onDraftChange).items[0].superficie_m2).toBeUndefined();
  });

  it('fuera de rango: se avisa al salir del campo y el valor no se corrige solo', () => {
    render(<ManualEntryWizard survey={MANUAL_ENTRY_SURVEYS.lawn} onSubmit={vi.fn()} />);
    const input = screen.getByRole('textbox', { name: 'Superficie de césped' });
    fireEvent.change(input, { target: { value: '6000' } });
    fireEvent.blur(input);
    expect(screen.getByText('La superficie de césped no puede pasar de 5.000 m².')).toBeTruthy();
    expect((input as HTMLInputElement).value).toBe('6000');
  });

  it('Intro en una pantalla de un solo campo avanza (P-16)', () => {
    render(<ManualEntryWizard survey={MANUAL_ENTRY_SURVEYS.lawn} onSubmit={vi.fn()} />);
    const input = screen.getByRole('textbox', { name: 'Superficie de césped' });
    fireEvent.change(input, { target: { value: '80' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('¿En qué estado está el césped?');
  });
});

describe('errores (T-07)', () => {
  it('«Siguiente» nunca se desactiva; al fallar, error con artículo junto al campo y foco en él', () => {
    render(<ManualEntryWizard survey={MANUAL_ENTRY_SURVEYS.lawn} onSubmit={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Siguiente' }) as HTMLButtonElement;
    next();
    expect(button.disabled).toBe(false);
    expect(screen.getByText('Indica la superficie de césped.')).toBeTruthy();
    const input = screen.getByRole('textbox', { name: 'Superficie de césped' });
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute('aria-describedby')).toContain('manual-field-superficie_m2-error');
  });

  it('una pregunta de opciones sin contestar dice qué hacer y lleva el foco al grupo', () => {
    render(<ManualEntryWizard survey={MANUAL_ENTRY_SURVEYS.tree} onSubmit={vi.fn()} />);
    next();
    expect(screen.getByText('Elige una opción para continuar.')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('radiogroup', { name: 'Tamaño del árbol' }));
  });
});

describe('lista de opciones (T-05, T-06) y fila sí/no (T-11)', () => {
  it('una columna; al seleccionar no aparece ni desaparece nada dentro de la opción', () => {
    render(<ManualEntryWizard survey={MANUAL_ENTRY_SURVEYS.tree} onSubmit={vi.fn()} />);
    const group = screen.getByRole('radiogroup', { name: 'Tamaño del árbol' });
    expect(group.className).not.toContain('grid-cols-2');
    const option = screen.getAllByRole('radio')[1];
    const before = option.querySelectorAll('*').length;
    fireEvent.click(option);
    expect(option.getAttribute('aria-checked')).toBe('true');
    // El radio cambia de dentro (punto), pero el texto y su hueco son los mismos.
    expect(option.querySelectorAll('*').length - before).toBeLessThanOrEqual(1);
    expect(option.querySelector('svg')).toBeNull();
  });

  it('las flechas del teclado cambian de opción', () => {
    const onDraftChange = vi.fn();
    render(<ManualEntryWizard survey={MANUAL_ENTRY_SURVEYS.lawn} onSubmit={vi.fn()} initialItems={[{ superficie_m2: 80 }]} onDraftChange={onDraftChange} />);
    next();
    const [first] = screen.getAllByRole('radio');
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(lastDraft(onDraftChange).items[0].estado_jardin).toBe('descuidado');
  });

  it('la fila sí/no es pulsable entera', () => {
    const onDraftChange = vi.fn();
    render(<ManualEntryWizard survey={MANUAL_ENTRY_SURVEYS.weeding} onSubmit={vi.fn()} initialItems={[{ area: 300, state: 'normal' }]} onDraftChange={onDraftChange} />);
    next();
    next();
    fireEvent.click(screen.getByText('Aplicar herbicida'));
    expect(lastDraft(onDraftChange).items[0].applyHerbicide).toBe(true);
  });
});

describe('D-03: sin referencias comparativas', () => {
  it.each([
    ['lawn', /plaza de garaje|pádel/i],
    ['hedge', /coche|cada paso/i],
    ['weeding', /parcela urbana/i],
    ['shrub', /cama de matrimonio/i],
  ] as const)('%s no enseña el ejemplo del schema', (key, pattern) => {
    render(<ManualEntryWizard survey={MANUAL_ENTRY_SURVEYS[key]} onSubmit={vi.fn()} />);
    expect(screen.queryByText(pattern)).toBeNull();
  });
});
