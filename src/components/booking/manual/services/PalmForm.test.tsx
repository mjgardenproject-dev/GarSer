// @vitest-environment jsdom
// F7 (ronda 2026-09-30): formulario manual de palmeras.
import fs from 'node:fs';
import path from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ManualEntryWizard, type ManualWizardSubmitPayload } from '../ManualEntryWizard';
import { ManualFieldRenderer } from '../fields/ManualFieldRenderer';
import {
  getFieldOptions,
  MANUAL_ENTRY_SURVEYS,
  PALM_SPECIES_OPTIONS,
  type ManualAnswers,
} from '../../../../shared/manualEntry/manualEntrySchema';
import { MANUAL_PARITY_FIXTURES } from '../../../../pages/reserva/manualEntryParityFixtures';
import { buildManualBookingPatch } from '../../../../pages/reserva/manualEntryBuilders';
import { getManualPresentation, presentOption } from '../presentation/manualEntryPresentation';
import { PALM_SPECIES_PHOTOS, PALM_SPECIES_PHOTOS_DIR } from '../presentation/palmSpeciesPhotos';

afterEach(() => cleanup());

const survey = MANUAL_ENTRY_SURVEYS.palm;
const presentation = getManualPresentation('palm');
const heightField = survey.steps.find((step) => step.id === 'height')!.fields[0];
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const heading = () => screen.getByRole('heading', { level: 2 }).textContent;
const eyebrow = () => screen.getByRole('heading', { level: 2 }).previousElementSibling?.textContent;
const pick = (label: string) => fireEvent.click(screen.getAllByRole('radio').find((r) => r.textContent?.startsWith(label))!);
const pickExact = (label: string) => fireEvent.click(screen.getAllByRole('radio').find((r) => r.textContent === label)!);
const commonName = (species: string) => presentation.fields.species.optionLabels![species];
const heightLabel = (answers: ManualAnswers) =>
  getFieldOptions(heightField, answers).find((o) => o.value === answers.height)!.label;

const CANARIA = 'Phoenix canariensis';

describe('palmeras · especie (D-10, D-13)', () => {
  it('nombre común como etiqueta y latín con su rasgo debajo; el valor sigue siendo el latino', () => {
    const onDraftChange = vi.fn();
    render(<ManualEntryWizard survey={survey} onSubmit={vi.fn()} onDraftChange={onDraftChange} />);
    expect(heading()).toBe('¿Qué especie de palmera es?');
    const options = screen.getAllByRole('radio');
    expect(options).toHaveLength(6);
    expect(options[0].textContent).toBe('Palmera canariaPhoenix canariensis · Copa muy densa y redondeada.');
    expect(options[2].textContent).toBe('Washingtonia o palmera de abanicoWashingtonia robusta o filifera · Tronco muy alto y fino, copa pequeña.');
    pick('Pindó');
    expect(onDraftChange.mock.calls[onDraftChange.mock.calls.length - 1][0].items[0].species).toBe('Syagrus romanzoffiana');
  });

  it('cada especie tiene su hueco de foto; hoy están vacíos y no se pinta ninguna imagen', () => {
    expect(Object.keys(PALM_SPECIES_PHOTOS).sort()).toEqual(PALM_SPECIES_OPTIONS.map((o) => o.value).sort());
    for (const photo of Object.values(PALM_SPECIES_PHOTOS)) {
      if (photo === null) continue;
      // Una ruta puesta debe apuntar a un archivo que existe en `public/`.
      expect(photo.startsWith(PALM_SPECIES_PHOTOS_DIR)).toBe(true);
      expect(fs.existsSync(path.join(process.cwd(), 'public', photo))).toBe(true);
    }
    render(<ManualEntryWizard survey={survey} onSubmit={vi.fn()} />);
    if (Object.values(PALM_SPECIES_PHOTOS).every((photo) => photo === null)) expect(document.querySelector('img')).toBeNull();
  });

  it('cuando un hueco tenga foto, la opción la enseña (decorativa) junto al nombre', () => {
    const field = survey.steps[0].fields[0];
    render(
      <ManualFieldRenderer
        field={field}
        value={undefined}
        answers={{}}
        fieldPresentation={{ ...presentation.fields.species, optionImages: { [CANARIA]: '/images/palmeras/palmera-canaria.webp' } }}
        onChange={vi.fn()}
      />,
    );
    const images = document.querySelectorAll('img');
    expect(images).toHaveLength(1);
    expect(images[0].getAttribute('alt')).toBe('');
    expect(screen.getAllByRole('radio')[0].contains(images[0])).toBe(true);
  });
});

describe('palmeras · altura del tronco', () => {
  it('segmentado con los tramos de la especie; el tramo más alto avisa debajo', () => {
    render(<ManualEntryWizard survey={survey} onSubmit={vi.fn()} initialItems={[{ species: 'Phoenix dactylifera', quantity: 1, hasPhytosanitary: true }]} />);
    click('Siguiente');
    expect(heading()).toBe('¿Qué altura tiene el tronco?');
    const group = screen.getByRole('radiogroup', { name: 'Altura del tronco' });
    expect(Array.from(group.querySelectorAll('[role="radio"]')).map((r) => r.textContent)).toEqual(['0-5 m', '5-10 m', '10-15 m', 'Más de 15 m']);
    pickExact('Más de 15 m');
    expect(screen.getByText('Tramo más alto: el precio puede ajustarse tras la visita del profesional.')).toBeTruthy();
    pickExact('5-10 m');
    expect(screen.queryByText(/Tramo más alto/)).toBeNull();
  });

  it('si se cambia de especie y la altura ya no existe, se dice y no deja seguir sin elegirla', () => {
    render(
      <ManualEntryWizard
        survey={survey}
        onSubmit={vi.fn()}
        initialItems={[{ species: CANARIA, height: '4-10m', quantity: 1, hasPhytosanitary: true }]}
      />,
    );
    pick('Palmera de molino');
    click('Siguiente');
    expect(screen.getByText('Los tramos de altura cambian con la especie: vuelve a elegir la altura del tronco.')).toBeTruthy();
    expect(screen.getAllByRole('radio').some((r) => r.getAttribute('aria-checked') === 'true')).toBe(false);
    click('Siguiente');
    expect(heading()).toBe('¿Qué altura tiene el tronco?');
    pickExact('3-6 m');
    expect(screen.queryByText(/Los tramos de altura cambian/)).toBeNull();
    click('Siguiente');
    expect(heading()).toBe('¿En qué estado está la palmera?');
  });
});

describe('palmeras · número y extras', () => {
  const base = { species: CANARIA, height: '4-10m', state: 'normal', quantity: 3, hasPhytosanitary: true };

  it('el número se escribe sin «ud» y la revisión dice «3»', () => {
    render(<ManualEntryWizard survey={survey} onSubmit={vi.fn()} initialItems={[base]} initialPhase="summary" />);
    expect(screen.getByText('Palmera canaria')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.queryByText(/\bud\b/)).toBeNull();
  });

  it('extras: pregunta, coste dicho una vez, fitosanitario «Recomendado» y marcado, una línea por opción', () => {
    render(<ManualEntryWizard survey={survey} onSubmit={vi.fn()} initialItems={[base]} />);
    for (let i = 0; i < 4; i += 1) click('Siguiente');
    expect(heading()).toBe('¿Necesitas algo más?');
    expect(eyebrow()).toBe('Poda de palmeras · Pregunta 5 de 6');
    expect(screen.getByText('Cada opción puede tener un coste adicional según el profesional.')).toBeTruthy();
    const switches = screen.getAllByRole('switch');
    expect(switches.map((s) => s.getAttribute('aria-label'))).toEqual([
      'Tratamiento de insecticida y fungicida',
      'Limpieza / pelado de tronco',
      'Acceso difícil',
    ]);
    expect(switches[0].getAttribute('aria-checked')).toBe('true');
    expect(switches[0].textContent).toContain('Recomendado');
    expect(screen.getByText('Protege los cortes de la poda frente a plagas como el picudo rojo.')).toBeTruthy();
    expect(screen.getByText('Acabado estético del tronco.')).toBeTruthy();
    expect(screen.getByText('Cerca de cables, en pendiente o con obstáculos importantes.')).toBeTruthy();
  });

  it('P-04: en el tramo más bajo no se pregunta el acceso difícil (el constructor ya lo descarta)', () => {
    render(<ManualEntryWizard survey={survey} onSubmit={vi.fn()} initialItems={[{ ...base, height: '0-4m' }]} />);
    for (let i = 0; i < 4; i += 1) click('Siguiente');
    expect(heading()).toBe('¿Necesitas algo más?');
    expect(screen.queryByRole('switch', { name: 'Acceso difícil' })).toBeNull();
  });

  it('P-04 en pindó de tramo bajo: no queda ningún extra y la pantalla no aparece (5 preguntas)', () => {
    const onStepComplete = vi.fn();
    render(
      <ManualEntryWizard
        survey={survey}
        onSubmit={vi.fn()}
        onStepComplete={onStepComplete}
        initialItems={[{ species: 'Syagrus romanzoffiana', height: '0-5m', state: 'normal', quantity: 2, hasPhytosanitary: true }]}
      />,
    );
    expect(eyebrow()).toBe('Poda de palmeras · Pregunta 1 de 5');
    for (let i = 0; i < 4; i += 1) click('Siguiente');
    expect(heading()).toBe('¿Quieres añadir más?');
    expect(onStepComplete.mock.calls.map((call) => call[0])).toEqual(['species', 'height', 'state', 'quantity']);
  });
});

describe('palmeras · recorridos de referencia por la interfaz', () => {
  const strip = (patch: unknown) => JSON.parse(JSON.stringify(patch, (key, value) => (key === 'id' ? undefined : value)));

  it.each(MANUAL_PARITY_FIXTURES.filter((f) => f.serviceKey === 'palm').map((f) => [f.id, f] as const))(
    '%s: construye el mismo patch que la respuesta de referencia',
    (_id, fixture) => {
      const onSubmit = vi.fn();
      render(<ManualEntryWizard survey={survey} onSubmit={onSubmit} />);
      fixture.items.forEach((item, index) => {
        if (index > 0) click('Añadir palmeras de otro tipo');
        pick(commonName(item.species as string));
        click('Siguiente');
        pickExact(heightLabel(item));
        click('Siguiente');
        const state = getFieldOptions(survey.steps[2].fields[0], item).find((o) => o.value === item.state)!;
        pick(presentOption(state, presentation.fields.state).label);
        click('Siguiente');
        fireEvent.change(screen.getByRole('textbox', { name: 'Número de palmeras' }), { target: { value: String(item.quantity) } });
        click('Siguiente');
        if (heading() === '¿Necesitas algo más?') {
          for (const [key, label] of [
            ['hasPhytosanitary', 'Tratamiento de insecticida y fungicida'],
            ['hasTrunkPeeling', 'Limpieza / pelado de tronco'],
            ['hasAccessDifficulty', 'Acceso difícil'],
          ] as const) {
            const toggle = screen.queryByRole('switch', { name: label });
            if (toggle && (toggle.getAttribute('aria-checked') === 'true') !== (item[key] === true)) fireEvent.click(toggle);
          }
          click('Siguiente');
        }
      });
      click('Continuar');
      pick(fixture.wasteRemoval ? 'Sí, que se lleven' : 'No, me encargo');
      click('Revisar mis datos');
      fireEvent.click(screen.getByRole('checkbox'));
      click('Confirmar y continuar');
      const payload = onSubmit.mock.calls[0][0] as ManualWizardSubmitPayload;
      expect(payload.wasteRemoval).toBe(fixture.wasteRemoval);
      expect(strip(buildManualBookingPatch({ serviceKey: 'palm', items: payload.items, wasteRemoval: payload.wasteRemoval }).patch)).toEqual(
        strip(buildManualBookingPatch({ serviceKey: 'palm', items: fixture.items, wasteRemoval: fixture.wasteRemoval }).patch),
      );
    },
  );
});
