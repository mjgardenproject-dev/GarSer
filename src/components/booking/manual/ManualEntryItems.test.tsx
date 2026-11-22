// @vitest-environment jsdom
// F4 (ronda 2026-09-30): repetibles, revisión y consentimiento.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ManualEntryWizard, type ManualWizardSubmitPayload } from './ManualEntryWizard';
import { MANUAL_ENTRY_SURVEYS } from '../../../shared/manualEntry/manualEntrySchema';
import { buildManualBookingPatch } from '../../../pages/reserva/manualEntryBuilders';

afterEach(() => cleanup());

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const pick = (label: string) => fireEvent.click(screen.getAllByRole('radio').find((r) => r.textContent?.startsWith(label))!);
const heading = () => screen.getByRole('heading', { level: 2 }).textContent;
const eyebrow = () => screen.getByRole('heading', { level: 2 }).previousElementSibling?.textContent;
const lastDraft = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls[fn.mock.calls.length - 1][0] as ManualWizardSubmitPayload;

const TREE = { aiSizeBand: 'medium', pruningType: 'structural', difficultyHigh: false };

function answerTree(size = 'Mediano', pruning = 'Poda estructural', access = 'Acceso normal') {
  pick(size);
  click('Siguiente');
  pick(pruning);
  click('Siguiente');
  pick(access);
  click('Siguiente');
}

describe('elemento fantasma (P-01)', () => {
  it('«Añadir otro» + «Atrás» lo descarta: la revisión y el envío llevan solo el árbol declarado', () => {
    const onSubmit = vi.fn();
    render(<ManualEntryWizard survey={MANUAL_ENTRY_SURVEYS.tree} onSubmit={onSubmit} />);
    answerTree();
    expect(heading()).toBe('¿Quieres añadir más?');
    click('Añadir otro árbol');
    expect(eyebrow()).toBe('Poda de árboles · Árbol 2 · Pregunta 1 de 4');
    click('Atrás');
    expect(heading()).toBe('¿Quieres añadir más?');
    expect(screen.getByText('Has añadido 1 árbol.')).toBeTruthy();
    click('Continuar');
    pick('Sí, que se lleven los restos');
    click('Revisar mis datos');
    expect(document.querySelectorAll('[data-manual-review-item]')).toHaveLength(1);
    fireEvent.click(screen.getByRole('checkbox'));
    click('Confirmar y continuar');
    const payload = onSubmit.mock.calls[0][0] as ManualWizardSubmitPayload;
    expect(payload.items).toEqual([TREE]);
    const { patch } = buildManualBookingPatch({ serviceKey: 'tree', items: payload.items, wasteRemoval: payload.wasteRemoval });
    expect(patch.treeGroups).toHaveLength(1);
  });

  it('un elemento nuevo con algo contestado no se descarta al volver a la lista: queda marcado', () => {
    render(<ManualEntryWizard survey={MANUAL_ENTRY_SURVEYS.tree} onSubmit={vi.fn()} />);
    answerTree();
    click('Añadir otro árbol');
    pick('Grande');
    click('Atrás');
    expect(screen.getByText('Has añadido 2 árboles.')).toBeTruthy();
    expect(screen.getByText('Faltan datos')).toBeTruthy();
  });

  it('un elemento incompleto bloquea la confirmación y «Completar» lleva a lo que falta', () => {
    render(
      <ManualEntryWizard survey={MANUAL_ENTRY_SURVEYS.tree} onSubmit={vi.fn()} initialItems={[TREE, { aiSizeBand: 'large' }]} initialPhase="summary" />,
    );
    fireEvent.click(screen.getByRole('checkbox'));
    expect((screen.getByRole('button', { name: 'Confirmar y continuar' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Completa o elimina «Árbol 2» para continuar.')).toBeTruthy();
    click('Completar');
    expect(heading()).toBe('¿Qué tipo de poda necesitas?');
    expect(eyebrow()).toContain('Árbol 2');
  });
});

describe('lista de elementos', () => {
  it('eliminar pide confirmación y quita el elemento del borrador', () => {
    const onDraftChange = vi.fn();
    render(<ManualEntryWizard survey={MANUAL_ENTRY_SURVEYS.tree} onSubmit={vi.fn()} onDraftChange={onDraftChange} />);
    answerTree();
    click('Añadir otro árbol');
    answerTree('Grande', 'Poda de formación', 'Acceso difícil');
    expect(screen.getByText('Has añadido 2 árboles.')).toBeTruthy();
    click('Eliminar árbol 1');
    expect(screen.getByText('¿Eliminar árbol 1?')).toBeTruthy();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Eliminar' }));
    expect(lastDraft(onDraftChange).items).toEqual([{ aiSizeBand: 'large', pruningType: 'shaping', difficultyHigh: true }]);
    expect(screen.getByText('Has añadido 1 árbol.')).toBeTruthy();
  });

  it('plurales correctos en palmeras y fitosanitarios', () => {
    const palm = { species: 'Phoenix canariensis', height: '4-10m', state: 'normal', quantity: 1, hasPhytosanitary: true };
    render(<ManualEntryWizard survey={MANUAL_ENTRY_SURVEYS.palm} onSubmit={vi.fn()} initialItems={[palm, palm]} />);
    for (let i = 0; i < 5; i += 1) click('Siguiente');
    expect(screen.getByText('Has añadido 2 grupos de palmeras.')).toBeTruthy();
  });
});

describe('revisión', () => {
  it('valores en español, booleanos por lo elegido y retirada por su opción', () => {
    render(
      <ManualEntryWizard
        survey={MANUAL_ENTRY_SURVEYS.hedge}
        onSubmit={vi.fn()}
        initialItems={[{ longitud_m: 1500, altura_m: 2.3, caras: '2', estado_seto: 'media' }]}
        initialPhase="summary"
        initialWasteRemoval={false}
      />,
    );
    expect(screen.getByText('1.500 m')).toBeTruthy();
    expect(screen.getByText('2,3 m')).toBeTruthy();
    expect(screen.getByText('Las dos caras')).toBeTruthy();
    expect(screen.getByText('No, me encargo yo')).toBeTruthy();
  });

  it('«Cambiar» lleva a esa pregunta y vuelve a la revisión con el valor nuevo', () => {
    const onDraftChange = vi.fn();
    render(
      <ManualEntryWizard
        survey={MANUAL_ENTRY_SURVEYS.lawn}
        onSubmit={vi.fn()}
        onDraftChange={onDraftChange}
        initialItems={[{ superficie_m2: 80, estado_jardin: 'normal' }]}
        initialPhase="summary"
      />,
    );
    click('Cambiar estado del césped');
    expect(heading()).toBe('¿En qué estado está el césped?');
    pick('Muy descuidado');
    click('Volver a la revisión');
    expect(heading()).toBe('Revisa tus datos antes de continuar');
    expect(screen.getByText('Muy descuidado')).toBeTruthy();
    expect(lastDraft(onDraftChange).items[0].estado_jardin).toBe('muy descuidado');
  });

  it('en la corrección del jardinero no hay casilla y se puede enviar', () => {
    const onSubmit = vi.fn();
    render(
      <ManualEntryWizard
        survey={MANUAL_ENTRY_SURVEYS.lawn}
        onSubmit={onSubmit}
        requireConsent={false}
        submitLabel="Recalcular precio"
        initialItems={[{ superficie_m2: 80, estado_jardin: 'normal' }]}
        initialWasteRemoval={false}
        initialPhase="summary"
      />,
    );
    expect(screen.queryByRole('checkbox')).toBeNull();
    click('Recalcular precio');
    // Arranca con lo que declaró el cliente (aquí «no»), no con un «sí» que nadie eligió.
    expect(onSubmit).toHaveBeenCalledWith({ items: [{ superficie_m2: 80, estado_jardin: 'normal' }], wasteRemoval: false });
  });

  it('sin la retirada contestada, confirmar lleva a la pregunta en vez de enviar', () => {
    const onSubmit = vi.fn();
    render(
      <ManualEntryWizard
        survey={MANUAL_ENTRY_SURVEYS.lawn}
        onSubmit={onSubmit}
        requireConsent={false}
        submitLabel="Recalcular precio"
        initialItems={[{ superficie_m2: 80, estado_jardin: 'normal' }]}
        initialPhase="summary"
      />,
    );
    click('Recalcular precio');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(heading()).toBe('¿Quieres que retiremos los restos?');
  });
});

describe('retirada de restos como elección (D-09, QA-065/QA-086: nada con coste marcado de antemano)', () => {
  const toWaste = (onDraftChange = vi.fn(), onSubmit = vi.fn()) => {
    render(
      <ManualEntryWizard survey={MANUAL_ENTRY_SURVEYS.lawn} onSubmit={onSubmit} onDraftChange={onDraftChange} initialItems={[{ superficie_m2: 80, estado_jardin: 'normal' }]} />,
    );
    click('Siguiente');
    click('Siguiente');
    expect(heading()).toBe('¿Quieres que retiremos los restos?');
    return { onDraftChange, onSubmit };
  };

  it('llega SIN ninguna opción marcada (puede costar más: lo elige el cliente)', () => {
    toWaste();
    for (const radio of screen.getAllByRole('radio')) expect(radio.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('Puede tener un coste adicional según el profesional.')).toBeTruthy();
  });

  it('«Continuar» sin elegir no avanza y pide que elija', () => {
    toWaste();
    click('Revisar mis datos');
    expect(heading()).toBe('¿Quieres que retiremos los restos?');
    expect(screen.getByText('Elige si quieres que retiremos los restos.')).toBeTruthy();
  });

  it('elegir «sí» o «no» cambia el booleano y deja seguir', () => {
    const { onDraftChange } = toWaste();
    pick('No, me encargo yo');
    expect(lastDraft(onDraftChange).wasteRemoval).toBe(false);
    pick('Sí, que se lleven los restos');
    expect(lastDraft(onDraftChange).wasteRemoval).toBe(true);
    click('Revisar mis datos');
    expect(heading()).toBe('Revisa tus datos antes de continuar');
  });
});

describe('«Siguiente» sin elegir no avanza (QA-138 / QA-172)', () => {
  it('césped: sin marcar el estado sigue en la misma pregunta y dice qué falta', () => {
    render(<ManualEntryWizard survey={MANUAL_ENTRY_SURVEYS.lawn} onSubmit={vi.fn()} initialItems={[{ superficie_m2: 80 }]} />);
    click('Siguiente');
    expect(heading()).toBe('¿En qué estado está el césped?');
    for (const radio of screen.getAllByRole('radio')) expect(radio.getAttribute('aria-checked')).toBe('false');
    click('Siguiente');
    expect(heading()).toBe('¿En qué estado está el césped?');
    expect(screen.getByRole('radiogroup').getAttribute('aria-invalid')).toBe('true');
  });

  it('fitosanitarios: la primera pregunta no avanza sin elegir', () => {
    render(<ManualEntryWizard survey={MANUAL_ENTRY_SURVEYS.phytosanitary} onSubmit={vi.fn()} />);
    const first = heading();
    click('Siguiente');
    expect(heading()).toBe(first);
  });
});
