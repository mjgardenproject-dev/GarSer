// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ManualEntryWizard } from './ManualEntryWizard';
import { MANUAL_ENTRY_SURVEYS, MANUAL_SERVICE_KEYS } from '../../../shared/manualEntry/manualEntrySchema';

afterEach(() => cleanup());

describe('ManualEntryWizard renders for all 7 services', () => {
  MANUAL_SERVICE_KEYS.forEach((key) => {
    it(`renders the first step of the ${key} survey`, () => {
      const survey = MANUAL_ENTRY_SURVEYS[key];
      render(
        <ManualEntryWizard
          survey={survey}
          onSubmit={vi.fn()}
          onSwitchToPhotos={vi.fn()}
        />,
      );
      // The first visible step title is rendered as the heading.
      expect(screen.getByText(survey.steps[0].title)).toBeTruthy();
      // The progress + switch-to-photos affordance is present.
      expect(screen.getByText('Cambiar a fotos')).toBeTruthy();
    });
  });
});
