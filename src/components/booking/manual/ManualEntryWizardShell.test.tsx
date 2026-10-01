// @vitest-environment jsdom
// F2 (ronda 2026-09-30): carcasa y navegación del asistente manual.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ManualEntryWizard } from './ManualEntryWizard';
import { ManualEntryChoice } from './ManualEntryChoice';
import { MANUAL_ENTRY_SURVEYS } from '../../../shared/manualEntry/manualEntrySchema';

afterEach(() => cleanup());

const eyebrow = () => screen.getByRole('heading', { level: 2 }).previousElementSibling?.textContent;
const next = () => fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));

describe('carcasa del asistente (F2)', () => {
  it('dice el servicio y «Pregunta X de Y» contando la retirada; sin barra propia', () => {
    render(<ManualEntryWizard survey={MANUAL_ENTRY_SURVEYS.lawn} onSubmit={vi.fn()} stickyFooter />);
    expect(eyebrow()).toBe('Corte de césped · Pregunta 1 de 3');
    expect(screen.queryByRole('progressbar')).toBeNull();

    fireEvent.change(screen.getByRole('textbox', { name: 'Superficie de césped' }), { target: { value: '80' } });
    next();
    expect(eyebrow()).toBe('Corte de césped · Pregunta 2 de 3');

    fireEvent.click(screen.getByText('Normal'));
    next();
    // La retirada es una pregunta más, con su título-pregunta del schema.
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('¿Quieres que retiremos los restos?');
    expect(eyebrow()).toBe('Corte de césped · Pregunta 3 de 3');

    fireEvent.click(screen.getByRole('button', { name: 'Revisar mis datos' }));
    expect(eyebrow()).toBe('Corte de césped · Revisión');
  });

  it('sin «Atrás» en la primera pregunta (D-08); aparece en la segunda', () => {
    render(<ManualEntryWizard survey={MANUAL_ENTRY_SURVEYS.lawn} onSubmit={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Atrás' })).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: 'Superficie de césped' }), { target: { value: '80' } });
    next();
    expect(screen.getByRole('button', { name: 'Atrás' })).toBeTruthy();
  });

  it('el aviso del precio sale una vez, en la revisión, y no en cada pregunta', () => {
    render(<ManualEntryWizard survey={MANUAL_ENTRY_SURVEYS.lawn} onSubmit={vi.fn()} />);
    expect(screen.queryByText(/Verás el precio/)).toBeNull();
  });

  it('pie fijo solo cuando se pide (página «Detalles»); en línea por defecto (modal del jardinero)', () => {
    const { container, unmount } = render(
      <ManualEntryWizard survey={MANUAL_ENTRY_SURVEYS.lawn} onSubmit={vi.fn()} stickyFooter />,
    );
    expect(container.querySelector('[data-manual-footer]')?.className).toContain('fixed');
    unmount();
    const inline = render(
      <ManualEntryWizard survey={MANUAL_ENTRY_SURVEYS.lawn} onSubmit={vi.fn()} requireConsent={false} submitLabel="Recalcular precio" showSwitchToPhotos={false} />,
    );
    expect(inline.container.querySelector('[data-manual-footer]')).toBeNull();
    expect(inline.container.querySelector('.fixed')).toBeNull();
  });

  it('sin el nombre del servicio cuando la página ya lo dice (varios servicios)', () => {
    render(<ManualEntryWizard survey={MANUAL_ENTRY_SURVEYS.hedge} onSubmit={vi.fn()} showServiceName={false} />);
    // F5: longitud y altura comparten pantalla → 3 pantallas + retirada.
    expect(eyebrow()).toBe('Pregunta 1 de 4');
  });

  it('fitosanitarios: el total de preguntas no crece al ir respondiendo', () => {
    render(<ManualEntryWizard survey={MANUAL_ENTRY_SURVEYS.phytosanitary} onSubmit={vi.fn()} />);
    const totals: number[] = [];
    const total = () => Number(/de (\d+)$/.exec(eyebrow() || '')?.[1]);
    totals.push(total());
    fireEvent.click(screen.getByText('Árboles'));
    next();
    totals.push(total());
    fireEvent.change(screen.getByRole('textbox', { name: 'Cantidad a tratar' }), { target: { value: '3' } });
    next();
    totals.push(total());
    fireEvent.click(screen.getByText('Grandes'));
    next();
    totals.push(total());
    fireEvent.click(screen.getByText('Curativo'));
    next();
    totals.push(total());
    for (let i = 1; i < totals.length; i += 1) expect(totals[i]).toBeLessThanOrEqual(totals[i - 1]);
    expect(eyebrow()).toBe('Servicios fitosanitarios · Pregunta 5 de 6');
  });

  it('cada pantalla sigue emitiendo su stepId (telemetría)', () => {
    const onStepComplete = vi.fn();
    render(<ManualEntryWizard survey={MANUAL_ENTRY_SURVEYS.lawn} onSubmit={vi.fn()} onStepComplete={onStepComplete} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Superficie de césped' }), { target: { value: '80' } });
    next();
    fireEvent.click(screen.getByText('Normal'));
    next();
    expect(onStepComplete.mock.calls.map((call) => call[0])).toEqual(['surface', 'state']);
  });
});

describe('selector fotos/manual plegado (D-11)', () => {
  it('en modo manual es una línea con «Usar fotos»', () => {
    const onSelect = vi.fn();
    render(<ManualEntryChoice mode="manual" onSelect={onSelect} compact />);
    expect(screen.queryByRole('radio')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Usar fotos' }));
    expect(onSelect).toHaveBeenCalledWith('photos');
  });

  it('en modo fotos sigue siendo el selector completo', () => {
    render(<ManualEntryChoice mode="photos" onSelect={vi.fn()} compact />);
    expect(screen.getAllByRole('radio')).toHaveLength(2);
  });
});
