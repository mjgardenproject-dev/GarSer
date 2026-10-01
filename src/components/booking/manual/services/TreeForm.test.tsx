// @vitest-environment jsdom
// F6 (ronda 2026-09-30): formulario manual de árboles.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ManualEntryWizard, type ManualWizardSubmitPayload } from '../ManualEntryWizard';
import { MANUAL_ENTRY_SURVEYS } from '../../../../shared/manualEntry/manualEntrySchema';
import { MANUAL_PARITY_FIXTURES } from '../../../../pages/reserva/manualEntryParityFixtures';
import { buildManualBookingPatch } from '../../../../pages/reserva/manualEntryBuilders';

afterEach(() => cleanup());

const survey = MANUAL_ENTRY_SURVEYS.tree;
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const heading = () => screen.getByRole('heading', { level: 2 }).textContent;
const pick = (label: string) => fireEvent.click(screen.getAllByRole('radio').find((r) => r.textContent?.startsWith(label))!);
const lastDraft = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls[fn.mock.calls.length - 1][0] as ManualWizardSubmitPayload;

const SIZE_LABEL: Record<string, string> = { small: 'Pequeño', medium: 'Mediano', large: 'Grande', over_9: 'Muy grande' };
const PRUNING_LABEL: Record<string, string> = { structural: 'Poda estructural', shaping: 'Poda de formación' };

describe('árboles · tamaño por tramo en metros (D-03)', () => {
  it('cuatro tramos sin comparaciones; el método de medida en «¿Cómo lo mido?»', () => {
    render(<ManualEntryWizard survey={survey} onSubmit={vi.fn()} />);
    expect(heading()).toBe('¿Qué tamaño tiene el árbol?');
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual([
      'Pequeño (0-3 m)',
      'Mediano (3-5 m)',
      'Grande (5-9 m)',
      'Muy grande (más de 9 m)',
    ]);
    expect(screen.queryByText(/planta baja|puerta|edificio|tejado|medios especiales/i)).toBeNull();
    expect(screen.getByText('¿Cómo lo mido?')).toBeTruthy();
    expect(screen.getByText(/desde el suelo hasta lo más alto de la copa/)).toBeTruthy();
  });

  it('la etiqueta nueva no cambia lo que se guarda: «Muy grande (más de 9 m)» es over_9', () => {
    const onDraftChange = vi.fn();
    render(<ManualEntryWizard survey={survey} onSubmit={vi.fn()} onDraftChange={onDraftChange} />);
    pick('Muy grande');
    expect(lastDraft(onDraftChange).items[0].aiSizeBand).toBe('over_9');
  });
});

describe('árboles · tipo de poda', () => {
  it('nombres intactos y la ayuda del configurador del jardinero', () => {
    render(<ManualEntryWizard survey={survey} onSubmit={vi.fn()} initialItems={[{ aiSizeBand: 'medium' }]} />);
    click('Siguiente');
    expect(heading()).toBe('¿Qué tipo de poda necesitas?');
    const options = screen.getAllByRole('radio');
    expect(options[0].textContent).toBe('Poda estructuralPara árboles grandes, ramas pesadas o saneamiento profundo.');
    expect(options[1].textContent).toBe('Poda de formaciónPara árboles jóvenes o mantenimiento ligero.');
  });
});

describe('árboles · acceso compacto', () => {
  it('segmentado «Acceso normal / Acceso difícil» con la definición en la frase de apoyo', () => {
    const onDraftChange = vi.fn();
    render(
      <ManualEntryWizard
        survey={survey}
        onSubmit={vi.fn()}
        onDraftChange={onDraftChange}
        initialItems={[{ aiSizeBand: 'medium', pruningType: 'structural' }]}
      />,
    );
    click('Siguiente');
    click('Siguiente');
    expect(heading()).toBe('¿El acceso al árbol es complicado?');
    expect(screen.getByText(/cercano a cables, en pendiente/)).toBeTruthy();
    const group = screen.getByRole('radiogroup', { name: 'Dificultad de acceso' });
    expect(Array.from(group.querySelectorAll('[role="radio"]')).map((r) => r.textContent)).toEqual(['Acceso normal', 'Acceso difícil']);
    pick('Acceso difícil');
    expect(lastDraft(onDraftChange).items[0].difficultyHigh).toBe(true);
    pick('Acceso normal');
    expect(lastDraft(onDraftChange).items[0].difficultyHigh).toBe(false);
  });
});

describe('árboles · «Duplicar» (D-04)', () => {
  const TREE = { aiSizeBand: 'large', pruningType: 'shaping', difficultyHigh: true };

  it('crea un árbol idéntico; cinco iguales = cinco elementos y cinco grupos', () => {
    const onDraftChange = vi.fn();
    render(<ManualEntryWizard survey={survey} onSubmit={vi.fn()} onDraftChange={onDraftChange} initialItems={[TREE]} />);
    click('Siguiente');
    click('Siguiente');
    click('Siguiente');
    expect(heading()).toBe('¿Quieres añadir más?');
    click('Duplicar árbol 1');
    expect(screen.getByText('Añadido el árbol 2, igual que el árbol 1.')).toBeTruthy();
    expect(screen.getByText('Has añadido 2 árboles.')).toBeTruthy();
    for (let i = 0; i < 3; i += 1) click('Duplicar árbol 1');
    const items = lastDraft(onDraftChange).items;
    expect(items).toEqual([TREE, TREE, TREE, TREE, TREE]);
    // Mismo contrato de siempre: un grupo por elemento (no se añade `quantity`).
    const { patch } = buildManualBookingPatch({ serviceKey: 'tree', items, wasteRemoval: true });
    expect(patch.treeGroups).toHaveLength(5);
    expect(patch.treeGroups?.map((group) => (group as { difficultyHigh?: boolean }).difficultyHigh)).toEqual([true, true, true, true, true]);
  });

  it('la copia es independiente: editarla no cambia el original', () => {
    const onDraftChange = vi.fn();
    render(<ManualEntryWizard survey={survey} onSubmit={vi.fn()} onDraftChange={onDraftChange} initialItems={[TREE]} />);
    click('Siguiente');
    click('Siguiente');
    click('Siguiente');
    click('Duplicar árbol 1');
    click('Editar árbol 2');
    pick('Pequeño');
    expect(lastDraft(onDraftChange).items.map((item) => item.aiSizeBand)).toEqual(['large', 'small']);
  });

  it('un árbol a medias no se puede duplicar; otros servicios no ofrecen «Duplicar»', () => {
    render(<ManualEntryWizard survey={survey} onSubmit={vi.fn()} initialItems={[TREE]} />);
    for (let i = 0; i < 3; i += 1) click('Siguiente');
    click('Añadir otro árbol');
    pick('Pequeño');
    click('Atrás');
    expect(screen.getByText('Faltan datos')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Duplicar árbol 1' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Duplicar árbol 2' })).toBeNull();
    cleanup();
    const palm = { species: 'Phoenix canariensis', height: '4-10m', state: 'normal', quantity: 1, hasPhytosanitary: true };
    render(<ManualEntryWizard survey={MANUAL_ENTRY_SURVEYS.palm} onSubmit={vi.fn()} initialItems={[palm]} />);
    for (let i = 0; i < 5; i += 1) click('Siguiente');
    expect(heading()).toBe('¿Quieres añadir más?');
    expect(screen.queryByRole('button', { name: /Duplicar/ })).toBeNull();
  });
});

describe('árboles · revisión y envío', () => {
  it('la revisión enseña las etiquetas nuevas', () => {
    render(
      <ManualEntryWizard
        survey={survey}
        onSubmit={vi.fn()}
        initialItems={[{ aiSizeBand: 'over_9', pruningType: 'structural', difficultyHigh: true }]}
        initialPhase="summary"
      />,
    );
    expect(screen.getByText('Muy grande (más de 9 m)')).toBeTruthy();
    expect(screen.getByText('Acceso difícil')).toBeTruthy();
  });

  it.each(MANUAL_PARITY_FIXTURES.filter((f) => f.serviceKey === 'tree').map((f) => [f.id, f] as const))(
    'recorrido completo %s: envía exactamente la respuesta de referencia',
    (_id, fixture) => {
      const onSubmit = vi.fn();
      render(<ManualEntryWizard survey={survey} onSubmit={onSubmit} />);
      fixture.items.forEach((item, index) => {
        if (index > 0) click('Añadir otro árbol');
        pick(SIZE_LABEL[item.aiSizeBand as string]);
        click('Siguiente');
        pick(PRUNING_LABEL[item.pruningType as string]);
        click('Siguiente');
        pick(item.difficultyHigh ? 'Acceso difícil' : 'Acceso normal');
        click('Siguiente');
      });
      click('Continuar');
      pick(fixture.wasteRemoval ? 'Sí, que se lleven' : 'No, me encargo');
      click('Revisar mis datos');
      fireEvent.click(screen.getByRole('checkbox'));
      click('Confirmar y continuar');
      const payload = onSubmit.mock.calls[0][0] as ManualWizardSubmitPayload;
      expect(payload).toEqual({ items: fixture.items, wasteRemoval: fixture.wasteRemoval });
    },
  );
});
