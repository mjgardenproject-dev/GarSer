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

  it('walks to consent and gates submit on the veracity checkbox', () => {
    const { onSubmit } = renderWeeding();

    // Step 1: area
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Superficie a desbrozar' }), { target: { value: '120' } });
    fireEvent.click(screen.getByText('Siguiente'));

    // Step 2: state (cards)
    fireEvent.click(screen.getByText('Dificultad media'));
    fireEvent.click(screen.getByText('Siguiente'));

    // Step 3: herbicide toggle (optional) -> next
    fireEvent.click(screen.getByText('Siguiente'));

    // Global waste step -> review
    fireEvent.click(screen.getByText('Revisar mis datos'));

    // Summary -> next to consent
    expect(screen.getByText('Revisa tus datos antes de continuar')).toBeTruthy();
    fireEvent.click(screen.getByText('Siguiente'));

    // Consent: confirm button disabled until checkbox checked
    const confirmBtn = screen.getByText('Confirmar y continuar') as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);

    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    expect((screen.getByText('Confirmar y continuar') as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByText('Confirmar y continuar'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.items[0].area).toBe(120);
    expect(payload.items[0].state).toBe('dificultad_media');
  });

  it('blocks advancing when a required value is out of range (no silent truncation)', () => {
    renderWeeding();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Superficie a desbrozar' }), { target: { value: '999999' } });
    fireEvent.click(screen.getByText('Siguiente'));
    // still on step 1 with an error, not advanced to the state step
    expect(screen.getByText('¿Qué superficie hay que desbrozar?')).toBeTruthy();
    expect(screen.getByText(/no puede superar/i)).toBeTruthy();
  });

  it('renders the exact published consent text', () => {
    renderWeeding({ initialItems: [{ area: 50, state: 'normal' }] });
    fireEvent.click(screen.getByText('Siguiente')); // area -> state
    fireEvent.click(screen.getByText('Siguiente')); // state -> herbicide
    fireEvent.click(screen.getByText('Siguiente')); // herbicide -> waste
    fireEvent.click(screen.getByText('Revisar mis datos')); // waste -> summary
    fireEvent.click(screen.getByText('Siguiente')); // summary -> consent
    expect(screen.getByText(MANUAL_ENTRY_CONSENT_TEXT)).toBeTruthy();
  });

  it('preserves provided initial draft (mode switch keeps progress)', () => {
    renderWeeding({ initialItems: [{ area: 333, state: 'normal' }], initialWasteRemoval: false });
    expect((screen.getByRole('spinbutton', { name: 'Superficie a desbrozar' }) as HTMLInputElement).value).toBe('333');
  });
});
