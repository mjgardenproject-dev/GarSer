import { describe, it, expect } from 'vitest';
import {
  sanitizeNumber,
  sanitizeString,
  sanitizeBoolean,
  validateManualBookingInput,
  validateManualSerializableInput,
} from './manualEntryValidation';

describe('manualEntry sanitizers', () => {
  it('coerces numeric strings and rejects junk', () => {
    expect(sanitizeNumber('12')).toBe(12);
    expect(sanitizeNumber('12,5')).toBe(12.5);
    expect(sanitizeNumber('  30 ')).toBe(30);
    expect(sanitizeNumber('abc')).toBeNull();
    expect(sanitizeNumber({})).toBeNull();
    expect(sanitizeNumber(Infinity)).toBeNull();
  });

  it('trims strings and neutralizes non-strings', () => {
    expect(sanitizeString('  hola ')).toBe('hola');
    expect(sanitizeString(42)).toBe('42');
    expect(sanitizeString({ a: 1 })).toBe('');
    expect(sanitizeString(['<script>'])).toBe('');
  });

  it('only treats explicit true as boolean true', () => {
    expect(sanitizeBoolean(true)).toBe(true);
    expect(sanitizeBoolean('true')).toBe(true);
    expect(sanitizeBoolean('false')).toBe(false);
    expect(sanitizeBoolean(1)).toBe(false);
  });
});

describe('validateManualBookingInput - lawn', () => {
  it('accepts an in-range lawn zone', () => {
    const result = validateManualBookingInput('lawn', {
      lawnZones: [{ quantity: 80, state: 'normal' }],
    });
    expect(result.ok).toBe(true);
  });

  it('rejects out-of-range surface without truncating', () => {
    const result = validateManualBookingInput('lawn', {
      lawnZones: [{ quantity: 999999, state: 'normal' }],
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('out_of_range');
  });

  it('rejects an invalid enum state', () => {
    const result = validateManualBookingInput('lawn', {
      lawnZones: [{ quantity: 80, state: 'destroyed' }],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === 'invalid_option')).toBe(true);
  });

  it('rejects an empty collection', () => {
    const result = validateManualBookingInput('lawn', { lawnZones: [] });
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('empty_collection');
  });
});

describe('validateManualBookingInput - palm', () => {
  it('accepts a valid palm group with species-specific height', () => {
    const result = validateManualBookingInput('palm', {
      palmGroups: [{ species: 'Phoenix canariensis', height: '4-10m', state: 'normal', quantity: 3 }],
    });
    expect(result.ok).toBe(true);
  });

  it('rejects a height not valid for the species', () => {
    const result = validateManualBookingInput('palm', {
      palmGroups: [{ species: 'Roystonea regia', height: '12-20m', state: 'normal', quantity: 1 }],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.field.includes('height'))).toBe(true);
  });

  it('rejects a non-integer quantity', () => {
    const result = validateManualBookingInput('palm', {
      palmGroups: [{ species: 'Phoenix canariensis', height: '4-10m', state: 'normal', quantity: 2.5 }],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === 'not_integer')).toBe(true);
  });
});

describe('validateManualBookingInput - other services', () => {
  it('validates hedge faces range', () => {
    const ok = validateManualBookingInput('hedge', {
      hedgeZones: [{ length: 20, height: '2-4m', height_pricing_m: 2.5, faces_to_trim: 2, state: 'normal' }],
    });
    expect(ok.ok).toBe(true);
    const bad = validateManualBookingInput('hedge', {
      hedgeZones: [{ length: 20, height: '2-4m', height_pricing_m: 2.5, faces_to_trim: 5, state: 'normal' }],
    });
    expect(bad.ok).toBe(false);
  });

  it('rejects a hedge band that does not exist in the gardener pricing matrix', () => {
    // La banda selecciona pricing_matrix[height]; una banda fantasma ('1-2m') pasaría la
    // validación antigua y el motor devolvería missing_pricing_config → cero jardineros.
    const bad = validateManualBookingInput('hedge', {
      hedgeZones: [{ length: 20, height: '1-2m', height_pricing_m: 1.8, faces_to_trim: 1, state: 'normal' }],
    });
    expect(bad.ok).toBe(false);

    // Altura fuera de rango también se rechaza sin truncar.
    const badHeight = validateManualBookingInput('hedge', {
      hedgeZones: [{ length: 20, height: '4-6m', height_pricing_m: 12, faces_to_trim: 1, state: 'normal' }],
    });
    expect(badHeight.ok).toBe(false);
  });

  it('validates weeding area and state', () => {
    expect(validateManualBookingInput('weeding', { weedingZones: [{ area: 120, state: 'dificultad_media' }] }).ok).toBe(true);
    expect(validateManualBookingInput('weeding', { weedingZones: [{ area: 0, state: 'normal' }] }).ok).toBe(false);
  });

  it('validates phytosanitary affected type and area', () => {
    expect(
      validateManualBookingInput('phytosanitary', {
        phytosanitaryZones: [{ area: 50, affectedType: 'Césped', intent: 'preventive', productPreference: 'chemical' }],
      }).ok,
    ).toBe(true);
    expect(
      validateManualBookingInput('phytosanitary', {
        phytosanitaryZones: [{ area: 50, affectedType: 'Invented', intent: 'preventive' }],
      }).ok,
    ).toBe(false);
  });

  it('validates tree and shrub', () => {
    expect(validateManualBookingInput('tree', { treeGroups: [{ aiSizeBand: 'medium', pruningType: 'structural' }] }).ok).toBe(true);
    expect(validateManualBookingInput('shrub', { shrubGroups: [{ area: 24, size: 'medianas' }] }).ok).toBe(true);
    expect(validateManualBookingInput('shrub', { shrubGroups: [{ area: 24, size: 'enormes' }] }).ok).toBe(false);
  });
});

describe('validateManualSerializableInput - server gate', () => {
  it('skips validation for non-manual bookings', () => {
    const result = validateManualSerializableInput({
      serviceName: 'Corte de césped',
      dataInputMode: 'photos',
      bookingInput: { lawnZones: [] },
    });
    expect(result.ok).toBe(true);
  });

  it('enforces validation for manual bookings', () => {
    const result = validateManualSerializableInput({
      serviceName: 'Corte de césped',
      dataInputMode: 'manual',
      bookingInput: { lawnZones: [{ quantity: -5, state: 'normal' }] },
    });
    expect(result.ok).toBe(false);
  });

  it('does not block unknown services', () => {
    const result = validateManualSerializableInput({
      serviceName: 'Servicio inexistente',
      dataInputMode: 'manual',
      bookingInput: {},
    });
    expect(result.ok).toBe(true);
  });
});
