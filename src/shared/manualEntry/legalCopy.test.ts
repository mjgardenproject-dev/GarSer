import { describe, it, expect } from 'vitest';
import {
  MANUAL_ENTRY_LEGAL_VERSION,
  MANUAL_ENTRY_CONSENT_TEXT,
  MANUAL_ENTRY_CONSENT_HASH,
  hashConsentText,
  buildConsentRecord,
} from './legalCopy';

describe('manualEntry legalCopy', () => {
  it('hash is deterministic and stable for the published text', () => {
    expect(hashConsentText(MANUAL_ENTRY_CONSENT_TEXT)).toBe(MANUAL_ENTRY_CONSENT_HASH);
    expect(hashConsentText(MANUAL_ENTRY_CONSENT_TEXT)).toBe(hashConsentText(MANUAL_ENTRY_CONSENT_TEXT));
  });

  it('hash changes when text changes (so version drift is detectable)', () => {
    expect(hashConsentText(MANUAL_ENTRY_CONSENT_TEXT + ' x')).not.toBe(MANUAL_ENTRY_CONSENT_HASH);
  });

  it('builds an auditable consent record with version, hash, text and timestamp', () => {
    const now = new Date('2026-06-16T10:00:00.000Z');
    const record = buildConsentRecord(now);
    expect(record.legalVersion).toBe(MANUAL_ENTRY_LEGAL_VERSION);
    expect(record.legalHash).toBe(MANUAL_ENTRY_CONSENT_HASH);
    expect(record.acceptedText).toBe(MANUAL_ENTRY_CONSENT_TEXT);
    expect(record.acceptedAt).toBe('2026-06-16T10:00:00.000Z');
  });
});
