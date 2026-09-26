// @vitest-environment jsdom
import React, { useState } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { UnifiedNumericInput } from './UnifiedNumericInput';

// H-38 (2026-09-26, visto en garser.es): en las tarifas no se podía poner 0,5 €/m². Al escribir
// «0,» la casilla mandaba `null`, el configurador lo guardaba como '' y la casilla se vaciaba: el
// «5» siguiente quedaba como 5 € (10 veces más). El padre imita al de césped
// (`getVal`: null → '').
const LawnLikeField: React.FC<{ initial?: number | '' ; seen: Array<number | null | ''> }> = ({ initial = '', seen }) => {
  const [value, setValue] = useState<number | ''>(initial);
  return (
    <UnifiedNumericInput
      id="precio"
      value={value}
      suffix="€/m²"
      onChange={(next: number | null) => {
        const stored = next === null ? '' : next;
        seen.push(stored);
        setValue(stored);
      }}
    />
  );
};

const typeInto = async (text: string, initial?: number | '') => {
  const seen: Array<number | null | ''> = [];
  render(<LawnLikeField initial={initial} seen={seen} />);
  const input = screen.getByRole('textbox') as HTMLInputElement;
  const user = userEvent.setup();
  await user.click(input);
  if (text === '') await user.clear(input);
  else await user.type(input, text);
  return { input, last: seen[seen.length - 1] };
};

describe('UnifiedNumericInput (H-38)', () => {
  afterEach(() => cleanup());

  it.each([
    ['0,5', 0.5, '0,5'],
    ['0.5', 0.5, '0,5'],
    ['0,05', 0.05, '0,05'],
    ['12,75', 12.75, '12,75'],
    ['0,50', 0.5, '0,50'],
    ['05', 5, '5'],
    ['00,5', 0.5, '0,5'],
  ])('escribir «%s» guarda %s y la casilla enseña «%s»', async (text, stored, shown) => {
    const { input, last } = await typeInto(text);
    expect(last).toBe(stored);
    expect(input.value).toBe(shown);
  });

  it('borrar deja el campo vacío', async () => {
    const { input, last } = await typeInto('', 3);
    expect(last).toBe('');
    expect(input.value).toBe('');
  });

  it('también si el configurador guarda el 0 como vacío (suplemento ecológico)', async () => {
    const seen: number[] = [];
    const ZeroAsEmpty: React.FC = () => {
      const [pct, setPct] = useState(0);
      return <UnifiedNumericInput value={pct === 0 ? '' : pct} suffix="%" onChange={(n: number | null) => { seen.push(n ?? 0); setPct(n ?? 0); }} />;
    };
    render(<ZeroAsEmpty />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    await userEvent.setup().type(input, '0,5');
    expect(seen[seen.length - 1]).toBe(0.5);
    expect(input.value).toBe('0,5');
  });

  it('un valor que llega de fuera se enseña con coma', () => {
    render(<LawnLikeField initial={0.25} seen={[]} />);
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('0,25');
  });
});
