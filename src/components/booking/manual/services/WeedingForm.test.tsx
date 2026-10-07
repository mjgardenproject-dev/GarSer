// @vitest-environment jsdom
// F9 (ronda 2026-09-30): formulario manual de desbroce.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ManualEntryWizard, type ManualWizardSubmitPayload } from '../ManualEntryWizard';
import { MANUAL_ENTRY_SURVEYS } from '../../../../shared/manualEntry/manualEntrySchema';
import { MANUAL_PARITY_FIXTURES } from '../../../../pages/reserva/manualEntryParityFixtures';
import { buildManualBookingPatch } from '../../../../pages/reserva/manualEntryBuilders';

afterEach(() => cleanup());

const survey = MANUAL_ENTRY_SURVEYS.weeding;
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const heading = () => screen.getByRole('heading', { level: 2 }).textContent;
const eyebrow = () => screen.getByRole('heading', { level: 2 }).previousElementSibling?.textContent;
const group = (name: string) => screen.getByRole('radiogroup', { name });
const pickIn = (groupName: string, label: string) =>
  fireEvent.click(Array.from(group(groupName).querySelectorAll('[role="radio"]')).find((r) => r.textContent?.startsWith(label))!);
const area = () => screen.getByRole('textbox', { name: 'Superficie a desbrozar' });
const STATE_LABEL: Record<string, string> = {
  normal: 'Dificultad normal',
  dificultad_media: 'Dificultad media',
  dificultad_alta: 'Dificultad alta',
};

describe('desbroce · superficie', () => {
  it('apoyo con la fuente del dato y sin comparaciones (D-03); «Pregunta 1 de 3»', () => {
    render(<ManualEntryWizard survey={survey} onSubmit={vi.fn()} />);
    expect(heading()).toBe('¿Qué superficie hay que desbrozar?');
    expect(eyebrow()).toBe('Desbroce de malas hierbas · Pregunta 1 de 3');
    expect(screen.getByText('Si la conoces por la escritura o el catastro, usa esa cifra.')).toBeTruthy();
    expect(screen.queryByText(/parcela urbana/)).toBeNull();
  });

  it('«2.500» son 2.500 m² (D-07) y la revisión lo enseña con miles', () => {
    const onDraftChange = vi.fn();
    render(<ManualEntryWizard survey={survey} onSubmit={vi.fn()} onDraftChange={onDraftChange} />);
    fireEvent.change(area(), { target: { value: '2.500' } });
    expect(onDraftChange.mock.calls[onDraftChange.mock.calls.length - 1][0].items[0].area).toBe(2500);
    cleanup();
    render(
      <ManualEntryWizard survey={survey} onSubmit={vi.fn()} initialItems={[{ area: 2500, state: 'normal' }]} initialPhase="summary" />,
    );
    expect(screen.getByText('2.500 m²')).toBeTruthy();
  });
});

describe('desbroce · opciones del servicio (herbicida + retirada)', () => {
  const toOptions = (onStepComplete = vi.fn(), initialWasteRemoval?: boolean) => {
    render(
      <ManualEntryWizard
        survey={survey}
        onSubmit={vi.fn()}
        onStepComplete={onStepComplete}
        initialWasteRemoval={initialWasteRemoval}
        initialItems={[{ area: 300, state: 'dificultad_media' }]}
      />,
    );
    click('Siguiente');
    click('Siguiente');
    return onStepComplete;
  };

  it('una pantalla con el coste dicho una vez: herbicida apagado y retirada en «Sí»', () => {
    toOptions();
    expect(heading()).toBe('Opciones del servicio');
    expect(eyebrow()).toBe('Desbroce de malas hierbas · Pregunta 3 de 3');
    expect(screen.getByText('Cada opción puede tener un coste adicional según el profesional.')).toBeTruthy();
    const herbicide = screen.getByRole('switch', { name: 'Aplicar herbicida' });
    expect(herbicide.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('Se aplica sobre toda la superficie desbrozada.')).toBeTruthy();
    const waste = Array.from(group('Retirada de restos').querySelectorAll('[role="radio"]'));
    expect(waste.map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false']);
    // El botón lleva directamente a la revisión: ya no hay pantalla aparte de retirada.
    expect(screen.getByRole('button', { name: 'Revisar mis datos' })).toBeTruthy();
  });

  it('emite area, state y herbicide como antes (la retirada nunca emitió stepId)', () => {
    const onStepComplete = toOptions();
    click('Revisar mis datos');
    expect(onStepComplete.mock.calls.map((call) => call[0])).toEqual(['area', 'state', 'herbicide']);
    expect(heading()).toBe('Revisa tus datos antes de continuar');
  });

  it('respeta la retirada que llega de fuera (D-02) y no la cambia sola', () => {
    toOptions(vi.fn(), false);
    const waste = Array.from(group('Retirada de restos').querySelectorAll('[role="radio"]'));
    expect(waste.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'true']);
  });

  it('«Cambiar retirada de restos» en la revisión lleva a las opciones y vuelve', () => {
    render(
      <ManualEntryWizard
        survey={survey}
        onSubmit={vi.fn()}
        initialItems={[{ area: 300, state: 'normal', applyHerbicide: false }]}
        initialPhase="summary"
      />,
    );
    click('Cambiar retirada de restos');
    expect(heading()).toBe('Opciones del servicio');
    pickIn('Retirada de restos', 'No, me encargo');
    click('Volver a la revisión');
    expect(screen.getByText('No, me encargo yo')).toBeTruthy();
  });

  it('«Atrás» desde la revisión vuelve a las opciones', () => {
    render(
      <ManualEntryWizard survey={survey} onSubmit={vi.fn()} initialItems={[{ area: 300, state: 'normal' }]} initialPhase="summary" />,
    );
    click('Atrás');
    expect(heading()).toBe('Opciones del servicio');
  });
});

describe('desbroce · recorridos de referencia por la interfaz', () => {
  const strip = (patch: unknown) => JSON.parse(JSON.stringify(patch, (key, value) => (key === 'id' ? undefined : value)));

  it.each(MANUAL_PARITY_FIXTURES.filter((f) => f.serviceKey === 'weeding').map((f) => [f.id, f] as const))(
    '%s: mismo patch y misma retirada que la referencia',
    (_id, fixture) => {
      const onSubmit = vi.fn();
      render(<ManualEntryWizard survey={survey} onSubmit={onSubmit} />);
      const item = fixture.items[0];
      fireEvent.change(area(), { target: { value: String(item.area) } });
      click('Siguiente');
      pickIn('Dificultad del desbroce', STATE_LABEL[item.state as string]);
      click('Siguiente');
      if (item.applyHerbicide) fireEvent.click(screen.getByRole('switch', { name: 'Aplicar herbicida' }));
      pickIn('Retirada de restos', fixture.wasteRemoval ? 'Sí, que se lleven' : 'No, me encargo');
      click('Revisar mis datos');
      fireEvent.click(screen.getByRole('checkbox'));
      click('Confirmar y continuar');
      const payload = onSubmit.mock.calls[0][0] as ManualWizardSubmitPayload;
      expect(payload.wasteRemoval).toBe(fixture.wasteRemoval);
      expect(strip(buildManualBookingPatch({ serviceKey: 'weeding', items: payload.items, wasteRemoval: payload.wasteRemoval }).patch)).toEqual(
        strip(buildManualBookingPatch({ serviceKey: 'weeding', items: fixture.items, wasteRemoval: fixture.wasteRemoval }).patch),
      );
    },
  );
});
