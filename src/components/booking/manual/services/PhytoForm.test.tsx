// @vitest-environment jsdom
// F8 (ronda 2026-09-30): formulario manual de fitosanitarios.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ManualEntryWizard, type ManualWizardSubmitPayload } from '../ManualEntryWizard';
import { MANUAL_ENTRY_SURVEYS, type ManualAnswers } from '../../../../shared/manualEntry/manualEntrySchema';
import { MANUAL_PARITY_FIXTURES } from '../../../../pages/reserva/manualEntryParityFixtures';
import { buildManualBookingPatch } from '../../../../pages/reserva/manualEntryBuilders';

afterEach(() => cleanup());

const survey = MANUAL_ENTRY_SURVEYS.phytosanitary;
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const heading = () => screen.getByRole('heading', { level: 2 }).textContent;
const eyebrow = () => screen.getByRole('heading', { level: 2 }).previousElementSibling?.textContent;
const group = (name: string) => screen.getByRole('radiogroup', { name });
const optionsOf = (name: string) => Array.from(group(name).querySelectorAll('[role="radio"]')).map((r) => r.textContent);
const pickIn = (groupName: string, label: string) =>
  fireEvent.click(Array.from(group(groupName).querySelectorAll('[role="radio"]')).find((r) => r.textContent?.startsWith(label))!);
const typeIn = (label: string, value: string) => fireEvent.change(screen.getByRole('textbox', { name: label }), { target: { value } });

const start = (affectedType: string) => {
  const onStepComplete = vi.fn();
  render(<ManualEntryWizard survey={survey} onSubmit={vi.fn()} onStepComplete={onStepComplete} />);
  pickIn('Tipo de vegetación', affectedType === 'Plantas bajas' ? 'Plantas y arbustos' : affectedType);
  click('Siguiente');
  return onStepComplete;
};

describe('fitosanitarios · cantidad y tamaño en una pantalla (D-05, P-08, D-12)', () => {
  it.each([
    ['Césped', '¿Cuántos m² de césped hay que tratar?', 'Superficie de césped'],
    ['Plantas bajas', '¿Qué superficie de plantas hay que tratar?', 'Superficie de plantas'],
    ['Setos', '¿Cuántos metros de seto hay que tratar?', 'Longitud de seto'],
    ['Árboles', '¿Cuántos árboles hay que tratar?', 'Número de árboles'],
    ['Palmeras', '¿Cuántas palmeras hay que tratar?', 'Número de palmeras'],
  ])('%s: «%s» con el campo «%s»', (type, title, label) => {
    start(type);
    expect(heading()).toBe(title);
    expect(screen.getByRole('textbox', { name: label })).toBeTruthy();
  });

  it('árboles: tamaños con los tramos del jardinero, sin comparaciones', () => {
    start('Árboles');
    expect(optionsOf('Altura de los árboles')).toEqual(['Pequeños (menos de 3 m)', 'Medianos (3-6 m)', 'Grandes (más de 6 m)']);
    expect(screen.queryByText(/desde el suelo|requieren altura/)).toBeNull();
    // El nombre del grupo se ve: hay dos preguntas en la pantalla.
    expect(screen.getAllByText('Altura de los árboles').length).toBeGreaterThan(0);
  });

  it('palmeras: < 3,5 / 3,5-8 / > 8 m de tronco', () => {
    start('Palmeras');
    expect(optionsOf('Altura del tronco')).toEqual(['Pequeñas (menos de 3,5 m)', 'Medianas (3,5-8 m)', 'Altas (más de 8 m)']);
    expect(screen.getByText(/Mide solo el tronco/)).toBeTruthy();
  });

  it('plantas: < 0,5 / 0,5-1,5 / 1,5-2 m, mismas claves que palmeras pero otras etiquetas', () => {
    start('Plantas bajas');
    expect(optionsOf('Altura de las plantas')).toEqual(['Pequeñas (menos de 0,5 m)', 'Medianas (0,5-1,5 m)', 'Grandes (1,5-2 m)']);
  });

  it('un solo «Siguiente» emite area y size en orden; vacíos, un error por campo', () => {
    const onStepComplete = start('Árboles');
    click('Siguiente');
    expect(screen.getByText('Indica el número de árboles.')).toBeTruthy();
    expect(screen.getByText('Elige una opción para continuar.')).toBeTruthy();
    typeIn('Número de árboles', '3');
    pickIn('Altura de los árboles', 'Grandes');
    click('Siguiente');
    expect(onStepComplete.mock.calls.map((call) => call[0])).toEqual(['affected', 'area', 'size']);
    expect(heading()).toBe('¿Qué tipo de tratamiento necesitas?');
  });
});

describe('fitosanitarios · tratamiento, producto y extras', () => {
  it('«qué combatir» aparece en la misma pantalla al elegir curativo y se va al elegir preventivo', () => {
    start('Césped');
    typeIn('Superficie de césped', '80');
    click('Siguiente');
    expect(screen.queryByRole('radiogroup', { name: 'Plaga o enfermedad a combatir' })).toBeNull();
    pickIn('Tipo de tratamiento', 'Curativo');
    const targets = optionsOf('Plaga o enfermedad a combatir');
    expect(targets).toHaveLength(3);
    ['Insectos / plagas', 'Hongos / enfermedad', 'Ambos'].forEach((name, index) => expect(targets[index]?.startsWith(name)).toBe(true));
    pickIn('Tipo de tratamiento', 'Preventivo');
    expect(screen.queryByRole('radiogroup', { name: 'Plaga o enfermedad a combatir' })).toBeNull();
  });

  it('producto en segmentado con la ayuda común; césped termina en 4 preguntas', () => {
    start('Césped');
    typeIn('Superficie de césped', '80');
    click('Siguiente');
    pickIn('Tipo de tratamiento', 'Preventivo');
    click('Siguiente');
    expect(eyebrow()).toBe('Servicios fitosanitarios · Pregunta 4 de 4');
    expect(optionsOf('Tipo de producto')).toEqual(['Convencional', 'Ecológico']);
    expect(screen.getByText('El ecológico puede tener un recargo según el profesional.')).toBeTruthy();
  });

  it('setos: última pantalla «¿Son setos altos?» con el corte de 2,5 m', () => {
    start('Setos');
    typeIn('Longitud de seto', '20');
    click('Siguiente');
    pickIn('Tipo de tratamiento', 'Preventivo');
    click('Siguiente');
    pickIn('Tipo de producto', 'Convencional');
    click('Siguiente');
    expect(heading()).toBe('¿Son setos altos?');
    expect(eyebrow()).toBe('Servicios fitosanitarios · Pregunta 5 de 5');
    expect(screen.getByText('Los setos de más de 2,5 m llevan más producto y más tiempo.')).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Supera los 2,5 m de altura' })).toBeTruthy();
  });

  it('revisión con unidades y nombres según lo tratado', () => {
    render(
      <ManualEntryWizard
        survey={survey}
        onSubmit={vi.fn()}
        initialPhase="summary"
        initialItems={[
          { affectedType: 'Árboles', area: 3, sizeBand: 'grandes', intent: 'curative', curativeTarget: 'fungus', productPreference: 'chemical' },
          { affectedType: 'Césped', area: 1200, intent: 'preventive', productPreference: 'ecological' },
          { affectedType: 'Palmeras', area: 1, sizeBand: 'medianas', intent: 'preventive', productPreference: 'chemical', wantsEndotherapy: true },
        ]}
      />,
    );
    expect(screen.getByText('3 árboles')).toBeTruthy();
    expect(screen.getByText('1.200 m²')).toBeTruthy();
    expect(screen.getByText('1 palmera')).toBeTruthy();
    expect(screen.getByText('Grandes (más de 6 m)')).toBeTruthy();
    expect(screen.getByText('Medianas (3,5-8 m)')).toBeTruthy();
    expect(screen.getAllByText('Número de árboles')).toHaveLength(1);
    expect(screen.getAllByText('Plaga o enfermedad a combatir')).toHaveLength(1);
  });
});

describe('fitosanitarios · recorridos de referencia por la interfaz', () => {
  const strip = (patch: unknown) => JSON.parse(JSON.stringify(patch, (key, value) => (key === 'id' ? undefined : value)));
  const AREA_LABEL: Record<string, string> = {
    Césped: 'Superficie de césped',
    'Plantas bajas': 'Superficie de plantas',
    Setos: 'Longitud de seto',
    Árboles: 'Número de árboles',
    Palmeras: 'Número de palmeras',
  };
  const SIZE: Record<string, [string, Record<string, string>]> = {
    Árboles: ['Altura de los árboles', { pequenos: 'Pequeños', medianos: 'Medianos', grandes: 'Grandes' }],
    Palmeras: ['Altura del tronco', { pequenas: 'Pequeñas', medianas: 'Medianas', altas: 'Altas' }],
    'Plantas bajas': ['Altura de las plantas', { pequenas: 'Pequeñas', medianas: 'Medianas', grandes: 'Grandes' }],
  };
  const TARGET: Record<string, string> = { insects: 'Insectos', fungus: 'Hongos', both: 'Ambos' };

  const answerItem = (item: ManualAnswers) => {
    const type = item.affectedType as string;
    pickIn('Tipo de vegetación', type === 'Plantas bajas' ? 'Plantas y arbustos' : type);
    click('Siguiente');
    typeIn(AREA_LABEL[type], String(item.area));
    if (SIZE[type]) pickIn(SIZE[type][0], SIZE[type][1][item.sizeBand as string]);
    click('Siguiente');
    pickIn('Tipo de tratamiento', item.intent === 'curative' ? 'Curativo' : 'Preventivo');
    if (item.intent === 'curative') pickIn('Plaga o enfermedad a combatir', TARGET[item.curativeTarget as string]);
    click('Siguiente');
    pickIn('Tipo de producto', item.productPreference === 'ecological' ? 'Ecológico' : 'Convencional');
    click('Siguiente');
    for (const [key, label] of [
      ['aboveThreeMeters', 'Supera los 2,5 m de altura'],
      ['wantsEndotherapy', 'Añadir endoterapia (inyección en tronco)'],
    ] as const) {
      const toggle = screen.queryByRole('switch', { name: label });
      if (!toggle) continue;
      if ((toggle.getAttribute('aria-checked') === 'true') !== (item[key] === true)) fireEvent.click(toggle);
      click('Siguiente');
    }
  };

  it.each(MANUAL_PARITY_FIXTURES.filter((f) => f.serviceKey === 'phytosanitary').map((f) => [f.id, f] as const))(
    '%s: construye el mismo patch que la respuesta de referencia',
    (_id, fixture) => {
      const onSubmit = vi.fn();
      render(<ManualEntryWizard survey={survey} onSubmit={onSubmit} />);
      fixture.items.forEach((item, index) => {
        if (index > 0) click('Añadir otra zona a tratar');
        answerItem(item);
      });
      click('Continuar');
      fireEvent.click(screen.getByRole('checkbox'));
      click('Confirmar y continuar');
      const payload = onSubmit.mock.calls[0][0] as ManualWizardSubmitPayload;
      expect(strip(buildManualBookingPatch({ serviceKey: 'phytosanitary', items: payload.items, wasteRemoval: payload.wasteRemoval }).patch)).toEqual(
        strip(buildManualBookingPatch({ serviceKey: 'phytosanitary', items: fixture.items, wasteRemoval: fixture.wasteRemoval }).patch),
      );
    },
  );
});
