// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZoneActionButton } from './ZoneActionButton';

afterEach(() => {
  cleanup();
});

describe('ZoneActionButton', () => {
  it('muestra CTA de análisis inicial o reanálisis según el estado común', () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <ZoneActionButton
        onClick={onClick}
        isAnalyzing={false}
        isAnalyzed={false}
        disabled={false}
        analyzeText="Analizar esta zona"
        reanalyzeText="Reanalizar esta zona"
      />,
    );

    expect(screen.getByRole('button', { name: 'Analizar esta zona' })).toBeTruthy();

    rerender(
      <ZoneActionButton
        onClick={onClick}
        isAnalyzing={false}
        isAnalyzed={true}
        disabled={false}
        analyzeText="Analizar esta zona"
        reanalyzeText="Reanalizar esta zona"
      />,
    );

    const button = screen.getByRole('button', { name: 'Reanalizar esta zona' });
    expect(button).toBeTruthy();

    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('prioriza el estado de carga sobre el texto de reanálisis', () => {
    render(
      <ZoneActionButton
        onClick={() => undefined}
        isAnalyzing={true}
        isAnalyzed={true}
        disabled={true}
        analyzingText="Analizando..."
        analyzeText="Analizar esta zona"
        reanalyzeText="Reanalizar esta zona"
      />,
    );

    expect(screen.getByRole('button', { name: 'Analizando...' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reanalizar esta zona' })).toBeNull();
  });
});
