// @vitest-environment jsdom
// QA-170 / QA-168: el aviso legal de los tratamientos con producto fitosanitario.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ManualEntryWizard, type ManualWizardSubmitPayload } from './ManualEntryWizard';
import { MANUAL_ENTRY_SURVEYS } from '../../../shared/manualEntry/manualEntrySchema';
import { PHYTOSANITARY_ACK_TEXT, PHYTOSANITARY_SHORT_NOTE } from '../../../shared/manualEntry/legalCopy';

afterEach(() => cleanup());

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const heading = () => screen.getByRole('heading', { level: 2 }).textContent;
const pickIn = (groupName: string, label: string) =>
  fireEvent.click(
    Array.from(screen.getByRole('radiogroup', { name: groupName }).querySelectorAll('[role="radio"]')).find((r) => r.textContent?.startsWith(label))!,
  );
const ackBox = () => screen.queryByLabelText(PHYTOSANITARY_ACK_TEXT) as HTMLInputElement | null;

// Recorre lo que queda (siguiente, «¿quieres añadir más?»…) hasta la revisión.
const toSummary = () => {
  for (let i = 0; i < 10 && !screen.queryByText('Revisa tus datos antes de continuar'); i += 1) {
    const next = screen.queryByRole('button', { name: /^(Siguiente|Continuar|Revisar mis datos)$/ });
    if (next) fireEvent.click(next);
  }
};

const phytoToProduct = (initial: Record<string, unknown> = {}, onSubmit = vi.fn()) => {
  render(
    <ManualEntryWizard
      survey={MANUAL_ENTRY_SURVEYS.phytosanitary}
      onSubmit={onSubmit}
      initialWasteRemoval={false}
      initialItems={[{ affectedType: 'Césped', area: 100, intent: 'preventive', ...initial }]}
    />,
  );
  for (let i = 0; i < 6 && !screen.queryByRole('radiogroup', { name: 'Tipo de producto' }); i += 1) click('Siguiente');
  expect(heading()).toBe('¿Prefieres producto convencional o ecológico?');
};

describe('fitosanitarios · aviso del producto convencional (QA-170)', () => {
  it('sin elegir producto o con el ecológico no sale el aviso', () => {
    phytoToProduct();
    expect(ackBox()).toBeNull();
    pickIn('Tipo de producto', 'Ecológico');
    expect(ackBox()).toBeNull();
  });

  it('con el convencional sale el aviso con la casilla SIN marcar y no deja seguir hasta marcarla', () => {
    phytoToProduct();
    pickIn('Tipo de producto', 'Convencional');
    expect(screen.getByText('Tratamiento con producto fitosanitario')).toBeTruthy();
    expect(document.body.textContent).toContain('carnet de aplicador');
    expect(document.body.textContent).toContain('GarSer es una plataforma de gestión de reservas');
    expect(ackBox()?.checked).toBe(false);
    click('Siguiente');
    expect(heading()).toBe('¿Prefieres producto convencional o ecológico?');
    expect(document.body.textContent).toContain('Marca la casilla para poder continuar con este tratamiento.');
    fireEvent.click(ackBox()!);
    click('Siguiente');
    expect(heading()).not.toBe('¿Prefieres producto convencional o ecológico?');
  });

  it('cambiar al ecológico quita el aviso y deja seguir', () => {
    phytoToProduct();
    pickIn('Tipo de producto', 'Convencional');
    pickIn('Tipo de producto', 'Ecológico');
    expect(ackBox()).toBeNull();
    click('Siguiente');
    expect(heading()).not.toBe('¿Prefieres producto convencional o ecológico?');
  });

  it('el resumen repite la frase corta y el envío lleva el registro de lo aceptado', () => {
    const onSubmit = vi.fn();
    phytoToProduct({}, onSubmit);
    pickIn('Tipo de producto', 'Convencional');
    fireEvent.click(ackBox()!);
    toSummary();
    expect(document.body.textContent).toContain(PHYTOSANITARY_SHORT_NOTE);
    fireEvent.click(screen.getByRole('checkbox', { name: /Confirmo que la información/ }));
    click('Confirmar y continuar');
    const payload = onSubmit.mock.calls[0][0] as ManualWizardSubmitPayload;
    expect(payload.phytosanitaryAck?.acceptedText).toBe(PHYTOSANITARY_ACK_TEXT);
    expect(payload.phytosanitaryAck?.legalVersion).toBe('phytosanitary_notice_v1');
  });

  it('con el ecológico no se pide ni se envía ningún registro', () => {
    const onSubmit = vi.fn();
    phytoToProduct({}, onSubmit);
    pickIn('Tipo de producto', 'Ecológico');
    toSummary();
    expect(document.body.textContent).not.toContain(PHYTOSANITARY_SHORT_NOTE);
    fireEvent.click(screen.getByRole('checkbox', { name: /Confirmo que la información/ }));
    click('Confirmar y continuar');
    expect((onSubmit.mock.calls[0][0] as ManualWizardSubmitPayload).phytosanitaryAck).toBeUndefined();
  });

  it('al repetir una reserva con convencional, confirmar sin haberlo leído lleva al aviso', () => {
    const onSubmit = vi.fn();
    render(
      <ManualEntryWizard
        survey={MANUAL_ENTRY_SURVEYS.phytosanitary}
        onSubmit={onSubmit}
        requireConsent={false}
        submitLabel="Confirmar"
        initialWasteRemoval={false}
        initialPhase="summary"
        initialItems={[{ affectedType: 'Césped', area: 100, intent: 'preventive', productPreference: 'chemical' }]}
      />,
    );
    click('Confirmar');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(ackBox()).toBeTruthy();
  });
});

describe('desbroce · herbicida (QA-168 + QA-170)', () => {
  const toHerbicide = () => {
    render(
      <ManualEntryWizard
        survey={MANUAL_ENTRY_SURVEYS.weeding}
        onSubmit={vi.fn()}
        initialItems={[{ area: 300, state: 'dificultad_media' }]}
      />,
    );
    click('Siguiente');
    click('Siguiente');
  };

  it('sin herbicida no hay aviso; con herbicida sale, con la casilla sin marcar y bloquea', () => {
    toHerbicide();
    expect(ackBox()).toBeNull();
    fireEvent.click(screen.getByRole('switch', { name: 'Aplicar herbicida' }));
    expect(document.body.textContent).toContain('carnet de aplicador');
    expect(document.body.textContent).toContain('puede encarecer el servicio');
    expect(ackBox()?.checked).toBe(false);
    pickIn('Retirada de restos', 'No, me encargo yo');
    click('Revisar mis datos');
    expect(heading()).toBe('Opciones del servicio');
    fireEvent.click(ackBox()!);
    click('Revisar mis datos');
    expect(heading()).toBe('Revisa tus datos antes de continuar');
  });
});
