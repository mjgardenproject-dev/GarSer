// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';
import React from 'react';

vi.mock('../../common/AddressAutocomplete', () => ({ default: ({ value }: { value: string }) => <input aria-label="Dirección base" defaultValue={value} readOnly /> }));
vi.mock('../../common/DistanceMapSelector', () => ({ default: () => <div data-testid="mapa" /> }));

import CoverageTab from './CoverageTab';

const Harness: React.FC<{ address: string; distance?: number; hasCoords: boolean; onSave: (d: unknown, o?: { successMessage?: string }) => unknown }> = ({ address, distance = 25, hasCoords, onSave }) => {
  const methods = useForm({ defaultValues: { address, max_distance: distance, full_name: 'Ana' } });
  return (
    <FormProvider {...methods}>
      <CoverageTab loading={false} initialData={{ address, max_distance: distance }} hasOperationalCoordinates={hasCoords} onSave={onSave} />
    </FormProvider>
  );
};

describe('CoverageTab · «Confirmar esta dirección» (fallo 4)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it('dirección escrita pero sin coordenadas: enseña la dirección, los km y el botón', () => {
    render(<Harness address="Calle Ancha 5, Marbella" distance={30} hasCoords={false} onSave={vi.fn()} />);
    expect(screen.getByText('Falta confirmar tu zona de trabajo')).toBeTruthy();
    expect(screen.getByText('Calle Ancha 5, Marbella')).toBeTruthy();
    expect(screen.getByText('Hasta 30 km')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirmar esta dirección' })).toBeTruthy();
  });

  it('al pulsar, hace el guardado de siempre con el valor del formulario y un aviso propio', async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    render(<Harness address="Calle Ancha 5, Marbella" hasCoords={false} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar esta dirección' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ address: 'Calle Ancha 5, Marbella', max_distance: 25 }),
      { successMessage: 'Zona de trabajo confirmada' },
    );
  });

  it('si la dirección no se puede localizar, lo explica y el botón sigue ahí para reintentar', async () => {
    const onSave = vi.fn().mockResolvedValue(false);
    render(<Harness address="asdf" hasCoords={false} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar esta dirección' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/No hemos podido localizar esa dirección/);
    await waitFor(() => expect((screen.getByRole('button', { name: 'Confirmar esta dirección' }) as HTMLButtonElement).disabled).toBe(false));
  });

  it('no admite doble toque mientras comprueba', async () => {
    let resolve: (v: boolean) => void = () => {};
    const onSave = vi.fn(() => new Promise<boolean>((r) => { resolve = r; }));
    render(<Harness address="Calle Ancha 5" hasCoords={false} onSave={onSave} />);
    const button = screen.getByRole('button', { name: 'Confirmar esta dirección' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Comprobando…' })).toBeTruthy();
    resolve(true);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar esta dirección' })).toBeTruthy());
  });

  it('con coordenadas: «Zona confirmada» y ningún botón (manda el guardado automático de siempre)', () => {
    render(<Harness address="Calle Ancha 5, Marbella" hasCoords onSave={vi.fn()} />);
    expect(screen.getByText('Zona confirmada.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Confirmar esta dirección/ })).toBeNull();
  });

  it('sin dirección no hay nada que confirmar: pide escribirla', () => {
    render(<Harness address="" hasCoords={false} onSave={vi.fn()} />);
    expect(screen.getByText(/Escribe la dirección desde la que trabajas/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Confirmar esta dirección/ })).toBeNull();
  });
});
