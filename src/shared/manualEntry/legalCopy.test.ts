import { describe, it, expect } from 'vitest';
import {
  MANUAL_ENTRY_LEGAL_VERSION,
  MANUAL_ENTRY_CONSENT_TEXT,
  MANUAL_ENTRY_CONSENT_HASH,
  hashConsentText,
  buildConsentRecord,
  PHYTOSANITARY_NOTICE_BODY,
  PHYTOSANITARY_ACK_TEXT,
  PHYTOSANITARY_SHORT_NOTE,
  PHYTOSANITARY_NOTICE_VERSION,
  buildPhytosanitaryAckRecord,
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

describe('aviso de fitosanitarios (QA-170: GarSer es plataforma, no inspector)', () => {
  it('dice quién aplica, quién decide y asume producto, dosis y plazos, y que GarSer solo gestiona la reserva', () => {
    const text = `${PHYTOSANITARY_NOTICE_BODY} ${PHYTOSANITARY_ACK_TEXT} ${PHYTOSANITARY_SHORT_NOTE}`.toLowerCase();
    expect(text).toContain('carnet');
    expect(text).toContain('producto');
    expect(text).toContain('dosis');
    expect(text).toContain('plazos de seguridad');
    expect(text).toContain('plataforma');
    expect(text).toContain('solo gestiona la reserva');
  });

  it('no promete nada que GarSer no pueda cumplir (no «garantiza», «supervisa» ni «certifica»)', () => {
    const text = `${PHYTOSANITARY_NOTICE_BODY} ${PHYTOSANITARY_ACK_TEXT} ${PHYTOSANITARY_SHORT_NOTE}`.toLowerCase();
    expect(text).not.toMatch(/garantiz|certific|asegura que|sin riesgo/);
    // «supervisa» solo puede aparecer negado.
    expect(text.replace(/no aplica, supervisa ni inspecciona/g, '')).not.toContain('supervisa');
  });

  it('deja un registro auditable con versión, hash, texto y fecha', () => {
    const record = buildPhytosanitaryAckRecord(new Date('2026-11-18T10:00:00.000Z'));
    expect(record.legalVersion).toBe(PHYTOSANITARY_NOTICE_VERSION);
    expect(record.acceptedText).toBe(PHYTOSANITARY_ACK_TEXT);
    expect(record.legalHash).toBe(hashConsentText(PHYTOSANITARY_ACK_TEXT));
    expect(record.acceptedAt).toBe('2026-11-18T10:00:00.000Z');
  });
});
