// @vitest-environment jsdom
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WeedingPricingConfigurator from './WeedingPricingConfigurator';
import type { WeedingPricingConfig } from '../../types';

const base = (herbicide: number | ''): WeedingPricingConfig => ({
  version: 'weeding_v1',
  importe_minimo: 40,
  precio_desbroce_m2: 0.6,
  precio_herbicida_m2: herbicide as number,
  suplementos: { dificultad_media: 10, dificultad_alta: 20, retirada_restos: 15 },
});

let latest: WeedingPricingConfig;
const Harness: React.FC<{ start: WeedingPricingConfig; license?: 'approved' | null }> = ({ start, license = 'approved' }) => {
  const [value, setValue] = useState(start);
  latest = value;
  return <WeedingPricingConfigurator value={value} initialConfig={start} onChange={(c) => { latest = c; setValue(c); }} onSave={vi.fn(async () => true)} licenseStatus={license} />;
};

const toggle = () => screen.getAllByRole('switch').find((el) => el.getAttribute('aria-checked') !== null) as HTMLElement;

describe('Desbroce · herbicida (QA-050)', () => {
  afterEach(() => cleanup());

  it('apagar y volver a encender el herbicida recupera el precio que tenía (no queda a 0)', () => {
    render(<Harness start={base(0.15)} />);
    expect(toggle().getAttribute('aria-checked')).toBe('true');
    fireEvent.click(toggle());
    expect(latest.precio_herbicida_m2).toBe(0); // apagado: se guarda 0
    fireEvent.click(toggle());
    expect(toggle().getAttribute('aria-checked')).toBe('true');
    expect(latest.precio_herbicida_m2).toBe(0.15);
  });

  it('si nunca tuvo precio, al encenderlo queda vacío para escribirlo (el guardado lo exige), no a 0', () => {
    render(<Harness start={base(0)} />);
    fireEvent.click(toggle()); // sin carnet aprobado no se puede; con carnet sí
    expect(toggle().getAttribute('aria-checked')).toBe('true');
    expect(latest.precio_herbicida_m2 === ('' as unknown) || latest.precio_herbicida_m2 === undefined).toBe(true);
  });

  it('el precio escrito después de encender es el que manda', () => {
    render(<Harness start={base(0.15)} />);
    fireEvent.click(toggle());
    fireEvent.click(toggle());
    expect(latest.precio_herbicida_m2).toBe(0.15);
  });
});
