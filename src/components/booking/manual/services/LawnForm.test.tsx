// @vitest-environment jsdom
// F10 (ronda 2026-09-30): formulario manual de césped, patrón de referencia del sistema.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ManualEntryWizard, type ManualWizardSubmitPayload } from '../ManualEntryWizard';
import { MANUAL_ENTRY_SURVEYS } from '../../../../shared/manualEntry/manualEntrySchema';
import { MANUAL_PARITY_FIXTURES } from '../../../../pages/reserva/manualEntryParityFixtures';

afterEach(() => cleanup());

const survey = MANUAL_ENTRY_SURVEYS.lawn;
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const heading = () => screen.getByRole('heading', { level: 2 }).textContent;
const eyebrow = () => screen.getByRole('heading', { level: 2 }).previousElementSibling?.textContent;
const surface = () => screen.getByRole('textbox', { name: 'Superficie de césped' });
const pickIn = (groupName: string, label: string) =>
  fireEvent.click(
    Array.from(screen.getByRole('radiogroup', { name: groupName }).querySelectorAll('[role="radio"]')).find((r) =>
      r.textContent?.startsWith(label),
    )!,
  );
const STATE_LABEL: Record<string, string> = { normal: 'Normal', descuidado: 'Descuidado', 'muy descuidado': 'Muy descuidado' };

describe('césped · superficie', () => {
  it('frase de apoyo común, sin comparaciones y con el método de medida plegado', () => {
    render(<ManualEntryWizard survey={survey} onSubmit={vi.fn()} />);
    expect(heading()).toBe('¿Cuántos metros cuadrados de césped hay?');
    expect(eyebrow()).toBe('Corte de césped · Pregunta 1 de 3');
    expect(screen.getByText('Una medida aproximada vale: el profesional la comprueba al llegar.')).toBeTruthy();
    expect(screen.queryByText(/plaza de garaje|pádel|No te preocupes/)).toBeNull();
    expect(screen.getByText('¿Cómo lo mido?')).toBeTruthy();
    expect(screen.getByText('Mide el largo y el ancho de la zona de césped y multiplícalos.')).toBeTruthy();
    expect(screen.getByText('Si hay varias zonas, calcula cada una y súmalas.')).toBeTruthy();
    expect(screen.getByText('Si la forma es irregular, divídela en rectángulos aproximados.')).toBeTruthy();
  });

  it('vacío o fuera de rango: error junto al campo, con el foco en él', () => {
    render(<ManualEntryWizard survey={survey} onSubmit={vi.fn()} />);
    click('Siguiente');
    expect(screen.getByText('Indica la superficie de césped.')).toBeTruthy();
    expect(document.activeElement).toBe(surface());
    fireEvent.change(surface(), { target: { value: '6000' } });
    fireEvent.blur(surface());
    expect(screen.getByText('La superficie de césped no puede pasar de 5.000 m².')).toBeTruthy();
  });

  it('Intro avanza; la revisión enseña «1.200 m²»', () => {
    render(<ManualEntryWizard survey={survey} onSubmit={vi.fn()} />);
    fireEvent.change(surface(), { target: { value: '1.200' } });
    fireEvent.keyDown(surface(), { key: 'Enter' });
    expect(heading()).toBe('¿En qué estado está el césped?');
    pickIn('Estado del césped', 'Normal');
    click('Siguiente');
    click('Revisar mis datos');
    expect(screen.getByText('1.200 m²')).toBeTruthy();
  });
});

describe('césped · recorridos de referencia por la interfaz', () => {
  it.each(MANUAL_PARITY_FIXTURES.filter((f) => f.serviceKey === 'lawn').map((f) => [f.id, f] as const))(
    '%s: envía exactamente la respuesta de referencia',
    (_id, fixture) => {
      const onSubmit = vi.fn();
      render(<ManualEntryWizard survey={survey} onSubmit={onSubmit} />);
      const item = fixture.items[0];
      fireEvent.change(surface(), { target: { value: String(item.superficie_m2).replace('.', ',') } });
      click('Siguiente');
      pickIn('Estado del césped', STATE_LABEL[item.estado_jardin as string]);
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
