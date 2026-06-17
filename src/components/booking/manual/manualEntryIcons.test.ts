import { describe, it, expect } from 'vitest';
import { MANUAL_ICON_NAMES } from './fields/ManualFieldRenderer';
import {
  MANUAL_ENTRY_SURVEYS,
  MANUAL_SERVICE_KEYS,
  getFieldOptions,
  PALM_SPECIES_OPTIONS,
  type ManualAnswers,
} from '../../../shared/manualEntry/manualEntrySchema';

/**
 * Guard: every icon name referenced by the survey schema must exist in the
 * renderer's ICONS registry. A typo or an unregistered icon would otherwise
 * render silently as "no icon" instead of failing loudly.
 */
function collectIconNames(): string[] {
  const names = new Set<string>();
  // Sample answers that unlock dynamic options (palm height depends on species).
  const sampleAnswers: ManualAnswers[] = [
    {},
    ...PALM_SPECIES_OPTIONS.map((option) => ({ species: option.value })),
  ];

  MANUAL_SERVICE_KEYS.forEach((key) => {
    MANUAL_ENTRY_SURVEYS[key].steps.forEach((step) => {
      step.fields.forEach((field) => {
        sampleAnswers.forEach((answers) => {
          getFieldOptions(field, answers).forEach((option) => {
            if (option.icon) names.add(option.icon);
          });
        });
      });
    });
  });
  return Array.from(names);
}

describe('manual entry icon registry', () => {
  it('registers every icon referenced by the schema', () => {
    const referenced = collectIconNames();
    const missing = referenced.filter((name) => !MANUAL_ICON_NAMES.includes(name));
    expect(missing).toEqual([]);
  });

  it('references at least the expected new thematic icons', () => {
    const referenced = collectIconNames();
    // Sanity check that the aesthetic update is actually wired in the schema.
    ['Wheat', 'Trees', 'Microscope', 'ShieldCheck', 'SprayCan', 'TreeDeciduous'].forEach((name) => {
      expect(referenced).toContain(name);
    });
  });
});
