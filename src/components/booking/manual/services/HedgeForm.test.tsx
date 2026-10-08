// @vitest-environment jsdom
// F5 (ronda 2026-09-30): formulario manual de setos.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ManualEntryWizard, type ManualWizardSubmitPayload } from '../ManualEntryWizard';
import { MANUAL_ENTRY_SURVEYS } from '../../../../shared/manualEntry/manualEntrySchema';
import { MANUAL_PARITY_FIXTURES } from '../../../../pages/reserva/manualEntryParityFixtures';

afterEach(() => cleanup());

const survey = MANUAL_ENTRY_SURVEYS.hedge;
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const heading = () => screen.getByRole('heading', { level: 2 }).textContent;
const eyebrow = () => screen.getByRole('heading', { level: 2 }).previousElementSibling?.textContent;
const type = (label: string, value: string) => fireEvent.change(screen.getByRole('textbox', { name: label }), { target: { value } });
const pick = (label: string) => fireEvent.click(screen.getAllByRole('radio').find((r) => r.textContent?.startsWith(label))!);

describe('setos · medidas en una pantalla (D-05)', () => {
  it('longitud y altura juntas; «Pregunta 1 de 4»; un «Siguiente» emite length y height en orden', () => {
    const onStepComplete = vi.fn();
    render(<ManualEntryWizard survey={survey} onSubmit={vi.fn()} onStepComplete={onStepComplete} />);
    expect(heading()).toBe('¿Cuánto mide el seto?');
    expect(eyebrow()).toBe('Poda de setos · Pregunta 1 de 4');
    expect(screen.getByText('Una medida aproximada vale: el profesional la comprueba al llegar.')).toBeTruthy();
    type('Longitud del seto', '14');
    type('Altura del seto', '2,1');
    click('Siguiente');
    expect(onStepComplete.mock.calls.map((call) => call[0])).toEqual(['length', 'height']);
    expect(heading()).toBe('¿Cuántas caras hay que recortar?');
    expect(eyebrow()).toBe('Poda de setos · Pregunta 2 de 4');
  });

  it('con las dos medidas vacías: un error por campo y el foco en la longitud', () => {
    render(<ManualEntryWizard survey={survey} onSubmit={vi.fn()} />);
    click('Siguiente');
    expect(screen.getByText('Indica la longitud del seto.')).toBeTruthy();
    expect(screen.getByText('Indica la altura del seto.')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Longitud del seto' }));
  });
});

describe('setos · tramo de tarifa en vivo', () => {
  it.each([
    ['2', 'Tramo de tarifa: Bajo (hasta 2 m)'],
    ['2,5', 'Tramo de tarifa: Medio (2-4 m)'],
    ['4,5', 'Tramo de tarifa: Alto (4-6 m)'],
  ])('%s m → «%s»', (value, expected) => {
    render(<ManualEntryWizard survey={survey} onSubmit={vi.fn()} />);
    type('Altura del seto', value);
    expect(screen.getByText(expected)).toBeTruthy();
  });

  it('con los botones: 2,0 m queda en el tramo bajo y 2,5 m pasa al medio', () => {
    render(<ManualEntryWizard survey={survey} onSubmit={vi.fn()} />);
    const plus = screen.getByRole('button', { name: 'Aumentar altura del seto' });
    for (let i = 0; i < 4; i += 1) fireEvent.click(plus);
    expect(screen.getByText('Tramo de tarifa: Bajo (hasta 2 m)')).toBeTruthy();
    fireEvent.click(plus);
    expect(screen.getByText('Tramo de tarifa: Medio (2-4 m)')).toBeTruthy();
  });

  it('fuera de rango no se enseña tramo, se enseña el error', () => {
    render(<ManualEntryWizard survey={survey} onSubmit={vi.fn()} />);
    type('Altura del seto', '7');
    fireEvent.blur(screen.getByRole('textbox', { name: 'Altura del seto' }));
    expect(screen.queryByText(/Tramo de tarifa/)).toBeNull();
    expect(screen.getByText('La altura del seto no puede pasar de 6 m.')).toBeTruthy();
  });
});

describe('setos · sin comparaciones (D-03) y con el método de medida', () => {
  it('no hay coche, pasos ni puerta; «¿Cómo lo mido?» explica el método', () => {
    render(<ManualEntryWizard survey={survey} onSubmit={vi.fn()} />);
    expect(screen.queryByText(/coche|paso son|puerta/i)).toBeNull();
    expect(screen.getByText('¿Cómo lo mido?')).toBeTruthy();
    expect(screen.getByText(/Si hace esquinas o tiene varios tramos, súmalos/)).toBeTruthy();
    expect(screen.getByText(/incluidos los muros o estructuras sobre los que crece/)).toBeTruthy();
  });

  it('las caras llevan un dibujo propio y no el icono genérico', () => {
    render(<ManualEntryWizard survey={survey} onSubmit={vi.fn()} initialItems={[{ longitud_m: 14, altura_m: 2 }]} />);
    click('Siguiente');
    const options = screen.getAllByRole('radio');
    expect(options).toHaveLength(2);
    options.forEach((option) => expect(option.querySelector('svg[aria-hidden]')).toBeTruthy());
  });
});

describe('setos · revisión y envío', () => {
  it('«Cambiar altura del seto» lleva a la pantalla de medidas y vuelve', () => {
    render(
      <ManualEntryWizard
        survey={survey}
        onSubmit={vi.fn()}
        initialItems={[{ longitud_m: 14, altura_m: 2.1, caras: '2', estado_seto: 'normal' }]}
        initialPhase="summary"
      />,
    );
    click('Cambiar altura del seto');
    expect(heading()).toBe('¿Cuánto mide el seto?');
    type('Altura del seto', '2,5');
    click('Volver a la revisión');
    expect(screen.getByText('2,5 m')).toBeTruthy();
  });

  it('recorrido completo: envía exactamente la respuesta de referencia', () => {
    const fixture = MANUAL_PARITY_FIXTURES.find((f) => f.id === 'hedge/altura-2.1m-caras-2-normal')!;
    const onSubmit = vi.fn();
    render(<ManualEntryWizard survey={survey} onSubmit={onSubmit} />);
    const item = fixture.items[0];
    type('Longitud del seto', String(item.longitud_m).replace('.', ','));
    type('Altura del seto', String(item.altura_m).replace('.', ','));
    click('Siguiente');
    pick('Las dos caras');
    click('Siguiente');
    pick('Normal');
    click('Siguiente');
    pick(fixture.wasteRemoval ? 'Sí, que se lleven' : 'No, me encargo');
    click('Revisar mis datos');
    fireEvent.click(screen.getByRole('checkbox'));
    click('Confirmar y continuar');
    const payload = onSubmit.mock.calls[0][0] as ManualWizardSubmitPayload;
    expect(payload).toEqual({ items: fixture.items, wasteRemoval: fixture.wasteRemoval });
  });
});
