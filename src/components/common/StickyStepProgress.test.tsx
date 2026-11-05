// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import StickyStepProgress from './StickyStepProgress';

describe('StickyStepProgress', () => {
  afterEach(cleanup);

  it('va fija justo debajo de la barra general', () => {
    const { container } = render(<StickyStepProgress title="Alta de empresa" stepLabel="Paso 2 de 5" percent={40} />);
    const bar = container.firstElementChild as HTMLElement;
    expect(bar.className).toContain('sticky');
    expect(bar.className).toContain('z-30');
    expect(bar.style.top).toBe('var(--app-navbar-h, 0px)');
  });

  it('dice en qué paso está y cuánto lleva, también para lectores de pantalla', () => {
    render(<StickyStepProgress title="Alta de jardinero" stepLabel="Paso 3 de 5" percent={50} />);
    expect(screen.getByText('Alta de jardinero')).toBeTruthy();
    expect(screen.getByText('Paso 3 de 5')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Alta de jardinero' }).getAttribute('aria-valuenow')).toBe('50');
  });

  it('el porcentaje nunca se sale de 0-100', () => {
    const { rerender } = render(<StickyStepProgress title="A" stepLabel="x" percent={140} />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
    rerender(<StickyStepProgress title="A" stepLabel="x" percent={-5} />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
  });
});
