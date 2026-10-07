// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ManualEntryWizard } from './ManualEntryWizard';
import { MANUAL_ENTRY_SURVEYS } from '../../../shared/manualEntry/manualEntrySchema';
import { MANUAL_ENTRY_CONSENT_TEXT } from '../../../shared/manualEntry/legalCopy';

const weedingSurvey = MANUAL_ENTRY_SURVEYS.weeding;

afterEach(() => cleanup());

function renderWeeding(overrides: Partial<React.ComponentProps<typeof ManualEntryWizard>> = {}) {
  const onSubmit = vi.fn();
  const onSwitchToPhotos = vi.fn();
  render(
    <ManualEntryWizard
      survey={weedingSurvey}
      onSubmit={onSubmit}
      onSwitchToPhotos={onSwitchToPhotos}
      {...overrides}
    />,
  );
  return { onSubmit, onSwitchToPhotos };
}

describe('ManualEntryWizard', () => {
  it('shows the first step and a switch-to-photos affordance', () => {
    const { onSwitchToPhotos } = renderWeeding();
    expect(screen.getByText('¿Qué superficie hay que desbrozar?')).toBeTruthy();
    fireEvent.click(screen.getByText('Cambiar a fotos'));
    expect(onSwitchToPhotos).toHaveBeenCalled();
  });

  // La veracidad se acepta EN el resumen, sin pantalla aparte: el cliente marca la casilla
  // mirando los datos a los que se refiere, y el mismo botón que confirma es el que envía.
  it('acepta la veracidad en el propio resumen y bloquea el envío hasta marcarla', () => {
    const { onSubmit } = renderWeeding();

    // Step 1: area
    fireEvent.change(screen.getByRole('textbox', { name: 'Superficie a desbrozar' }), { target: { value: '120' } });
    fireEvent.click(screen.getByText('Siguiente'));

    // Step 2: state (cards)
    fireEvent.click(screen.getByText('Dificultad media'));
    fireEvent.click(screen.getByText('Siguiente'));

    // Step 3 (F9): «Opciones del servicio» — herbicida y retirada juntos -> revisión
    fireEvent.click(screen.getByText('Revisar mis datos'));

    // El resumen ya es la última pantalla: datos, casilla y botón de envío juntos.
    expect(screen.getByText('Revisa tus datos antes de continuar')).toBeTruthy();
    const confirmBtn = screen.getByText('Confirmar y continuar') as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);
    expect(screen.queryByText('Siguiente')).toBeNull();

    fireEvent.click(screen.getByRole('checkbox'));
    expect((screen.getByText('Confirmar y continuar') as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByText('Confirmar y continuar'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.items[0].area).toBe(120);
    expect(payload.items[0].state).toBe('dificultad_media');
  });

  it('blocks advancing when a required value is out of range (no silent truncation)', () => {
    renderWeeding();
    fireEvent.change(screen.getByRole('textbox', { name: 'Superficie a desbrozar' }), { target: { value: '999999' } });
    fireEvent.click(screen.getByText('Siguiente'));
    // still on step 1 with an error, not advanced to the state step
    expect(screen.getByText('¿Qué superficie hay que desbrozar?')).toBeTruthy();
    // F3: el mensaje va con artículo, unidad y miles en español, y el valor no se corrige solo.
    expect(screen.getByText('La superficie a desbrozar no puede pasar de 10.000 m².')).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Superficie a desbrozar' }) as HTMLInputElement).value).toBe('999999');
  });

  // El texto que se REGISTRA sigue siendo el íntegro, así que tiene que seguir estando en la
  // pantalla aunque la casilla enseñe un resumen corto: plegado, pero presente.
  it('mantiene el texto legal publicado íntegro en el resumen', () => {
    renderWeeding({ initialItems: [{ area: 50, state: 'normal' }] });
    fireEvent.click(screen.getByText('Siguiente')); // area -> state
    fireEvent.click(screen.getByText('Siguiente')); // state -> herbicide
    fireEvent.click(screen.getByText('Revisar mis datos')); // opciones (herbicida + retirada) -> summary
    expect(screen.getByText(MANUAL_ENTRY_CONSENT_TEXT)).toBeTruthy();
    expect(screen.getByText('Leer el texto completo')).toBeTruthy();
  });

  it('preserves provided initial draft (mode switch keeps progress)', () => {
    renderWeeding({ initialItems: [{ area: 333, state: 'normal' }], initialWasteRemoval: false });
    expect((screen.getByRole('textbox', { name: 'Superficie a desbrozar' }) as HTMLInputElement).value).toBe('333');
  });
});
