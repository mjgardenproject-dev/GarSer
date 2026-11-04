// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import StaleProviderLinkNotice from './StaleProviderLinkNotice';

afterEach(() => cleanup());

describe('StaleProviderLinkNotice', () => {
  it('dice de quién es el enlace y cómo conseguir el bueno', () => {
    render(<StaleProviderLinkNotice providerName="Pablo Gómez" />);
    const text = screen.getByRole('status').textContent ?? '';
    expect(text).toContain('Pablo Gómez');
    expect(text).toMatch(/enlace actualizado/);
  });

  it('sin nombre habla de «tu profesional»', () => {
    render(<StaleProviderLinkNotice providerName="  " />);
    expect(screen.getByRole('status').textContent).toContain('tu profesional');
  });
});
