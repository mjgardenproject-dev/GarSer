// @vitest-environment jsdom
// F11 (ronda 2026-09-30): formulario manual de plantas y arbustos.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ManualEntryWizard, type ManualWizardSubmitPayload } from '../ManualEntryWizard';
import { MANUAL_ENTRY_SURVEYS } from '../../../../shared/manualEntry/manualEntrySchema';
import { MANUAL_PARITY_FIXTURES } from '../../../../pages/reserva/manualEntryParityFixtures';

afterEach(() => cleanup());

const survey = MANUAL_ENTRY_SURVEYS.shrub;
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const heading = () => screen.getByRole('heading', { level: 2 }).textContent;
const eyebrow = () => screen.getByRole('heading', { level: 2 }).previousElementSibling?.textContent;
const surface = () => screen.getByRole('textbox', { name: 'Superficie de plantas y arbustos' });
const optionsOf = (name: string) =>
  Array.from(screen.getByRole('radiogroup', { name }).querySelectorAll('[role="radio"]')).map((r) => r.textContent);
const pickIn = (groupName: string, label: string) =>
  fireEvent.click(
    Array.from(screen.getByRole('radiogroup', { name: groupName }).querySelectorAll('[role="radio"]')).find((r) =>
      r.textContent?.startsWith(label),
    )!,
  );
const SIZE_LABEL: Record<string, string> = { pequeñas: 'Pequeñas', medianas: 'Medianas', grandes: 'Grandes' };
const STATE_LABEL: Record<string, string> = { normal: 'Normal', descuidado: 'Descuidadas', 'muy descuidado': 'Muy descuidadas' };

describe('arbustos · superficie (patrón de césped)', () => {
  it('frase de apoyo común, sin la cama de matrimonio y con el método de medida', () => {
    render(<ManualEntryWizard survey={survey} onSubmit={vi.fn()} />);
    expect(heading()).toBe('¿Qué superficie ocupan las plantas y arbustos?');
    expect(eyebrow()).toBe('Poda de plantas y arbustos · Pregunta 1 de 4');
    expect(screen.getByText('Una medida aproximada vale: el profesional la comprueba al llegar.')).toBeTruthy();
    expect(screen.queryByText(/cama|matrimonio/)).toBeNull();
    expect(screen.getByText('Mide el largo y el ancho del macizo y multiplícalos.')).toBeTruthy();
    expect(screen.getByText('Si hay varios macizos, calcula cada uno y súmalos.')).toBeTruthy();
    expect(screen.getByText('Cuenta solo la superficie con plantas, sin caminos ni césped.')).toBeTruthy();
  });

  it('fuera de rango: error con el máximo en español', () => {
    render(<ManualEntryWizard survey={survey} onSubmit={vi.fn()} />);
    fireEvent.change(surface(), { target: { value: '2.500' } });
    fireEvent.blur(surface());
    expect(screen.getByText('La superficie de plantas y arbustos no puede pasar de 2.000 m².')).toBeTruthy();
  });
});

describe('arbustos · tamaño con los tramos del jardinero (D-12)', () => {
  it('0-1 / 1-2 / 2-3 m, sin rodilla, cintura ni cabeza', () => {
    render(<ManualEntryWizard survey={survey} onSubmit={vi.fn()} initialItems={[{ superficie_m2: 30 }]} />);
    click('Siguiente');
    expect(heading()).toBe('¿De qué tamaño son las plantas predominantes?');
    expect(screen.getByText('Elige la altura de las plantas que más abundan.')).toBeTruthy();
    expect(optionsOf('Tamaño dominante')).toEqual(['Pequeñas (0-1 m)', 'Medianas (1-2 m)', 'Grandes (2-3 m)']);
    expect(screen.queryByText(/rodilla|cintura|pecho|cabeza/)).toBeNull();
  });

  it('la revisión enseña el tramo y lo enviado no cambia («grandes»)', () => {
    const onDraftChange = vi.fn();
    render(
      <ManualEntryWizard
        survey={survey}
        onSubmit={vi.fn()}
        onDraftChange={onDraftChange}
        initialItems={[{ superficie_m2: 30, tamano_dominante: 'grandes', estado_plantas: 'normal' }]}
        initialPhase="summary"
      />,
    );
    expect(screen.getByText('Grandes (2-3 m)')).toBeTruthy();
    expect(screen.getByText('30 m²')).toBeTruthy();
  });
});

describe('arbustos · recorridos de referencia por la interfaz', () => {
  it.each(MANUAL_PARITY_FIXTURES.filter((f) => f.serviceKey === 'shrub').map((f) => [f.id, f] as const))(
    '%s: envía exactamente la respuesta de referencia',
    (_id, fixture) => {
      const onSubmit = vi.fn();
      render(<ManualEntryWizard survey={survey} onSubmit={onSubmit} />);
      const item = fixture.items[0];
      fireEvent.change(surface(), { target: { value: String(item.superficie_m2) } });
      click('Siguiente');
      pickIn('Tamaño dominante', SIZE_LABEL[item.tamano_dominante as string]);
      click('Siguiente');
      pickIn('Estado de las plantas', STATE_LABEL[item.estado_plantas as string]);
      click('Siguiente');
      pickIn('Retirada de restos', fixture.wasteRemoval ? 'Sí, que se lleven' : 'No, me encargo');
      click('Revisar mis datos');
      fireEvent.click(screen.getByRole('checkbox'));
      click('Confirmar y continuar');
      const payload = onSubmit.mock.calls[0][0] as ManualWizardSubmitPayload;
      expect(payload).toEqual({ items: fixture.items, wasteRemoval: fixture.wasteRemoval });
    },
  );
});
