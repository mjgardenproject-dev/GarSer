import { describe, expect, it } from 'vitest';
import {
  canRequestLicense,
  canUpload,
  employeeLicensePrompt,
  licenseStatusCopy,
  licenseView,
  needsUpload,
  reasonSentence,
  requestIsCurrent,
  summaryFromTeamMember,
  type PhytoLicenseSummary,
} from './phytoLicense';
import { checkLicenseFile, licenseObjectPath } from '../utils/licenseFile';

const NOW = new Date('2026-10-20T12:00:00Z');
const inDays = (days: number) => new Date(NOW.getTime() + days * 86_400_000).toISOString();
const approved = (days: number, renewal: PhytoLicenseSummary['renewal'] = null): PhytoLicenseSummary =>
  ({ status: 'approved', active: true, expires_at: inDays(days), renewal });

describe('licenseView', () => {
  it('distingue cada situación', () => {
    expect(licenseView(null, NOW)).toBe('none');
    expect(licenseView({ status: 'pending', active: false }, NOW)).toBe('pending');
    expect(licenseView({ status: 'rejected', active: false }, NOW)).toBe('rejected');
    expect(licenseView({ status: 'expired', active: false }, NOW)).toBe('expired');
    expect(licenseView(approved(400), NOW)).toBe('approved');
    expect(licenseView(approved(45), NOW)).toBe('expiring');
    expect(licenseView(approved(400, { status: 'pending', submitted_at: inDays(-1), rejection_reason: null, submitted_by_company: false }), NOW)).toBe('renewal_pending');
    expect(licenseView(approved(400, { status: 'rejected', submitted_at: inDays(-1), rejection_reason: 'x', submitted_by_company: false }), NOW)).toBe('renewal_rejected');
  });

  it('el formulario sale solo cuando hace falta, y nunca con algo en revisión', () => {
    expect(['none', 'rejected', 'expired', 'renewal_rejected'].every((v) => needsUpload(v as never))).toBe(true);
    expect(needsUpload('approved') || needsUpload('expiring')).toBe(false);
    expect(canUpload('pending') || canUpload('renewal_pending')).toBe(false);
    expect(canUpload('approved') && canUpload('expiring')).toBe(true);
  });
});

describe('licenseStatusCopy', () => {
  it('explica cada estado al titular y a la empresa', () => {
    expect(licenseStatusCopy(approved(400), 'self', NOW)).toMatchObject({ tone: 'ok', title: 'Carnet aprobado' });
    expect(licenseStatusCopy(approved(10), 'company', NOW).detail).toContain('Pídele el renovado o súbelo tú');
    expect(licenseStatusCopy({ status: 'rejected', active: false, rejection_reason: 'No se lee.' }, 'self', NOW).detail)
      .toBe('Motivo: No se lee. Súbelo de nuevo corrigiéndolo.');
    expect(licenseStatusCopy({ status: 'pending', active: false, submitted_by_company: true, submitted_at: inDays(0) }, 'self', NOW).detail)
      .toContain('Tu empresa lo envió el');
    // Sin fecha no queda «el .»
    expect(licenseStatusCopy({ status: 'pending', active: false }, 'company', NOW).detail).toBe('Enviado. Os avisaremos cuando esté revisado.');
    expect(licenseStatusCopy(null, 'company', NOW)).toMatchObject({ tone: 'none', title: 'Sin carnet' });
  });

  it('el motivo lleva un solo punto final', () => {
    expect(reasonSentence('Falta la otra cara.')).toBe('Motivo: Falta la otra cara.');
    expect(reasonSentence('  Caducado  ')).toBe('Motivo: Caducado.');
    expect(reasonSentence(null)).toBe('Motivo: sin indicar.');
  });
});

describe('employeeLicensePrompt («Hoy»)', () => {
  const base = { companyName: 'Jardines Sol', now: NOW };
  it('solo avisa si tiene que hacer algo', () => {
    expect(employeeLicensePrompt({ ...base, summary: null, needed: false })).toBeNull();
    expect(employeeLicensePrompt({ ...base, summary: null, needed: true })?.title).toBe('Sube tu carnet fitosanitario');
    expect(employeeLicensePrompt({ ...base, summary: null, needed: true, requestedAt: inDays(-1) })?.detail).toContain('Jardines Sol te lo ha pedido');
    expect(employeeLicensePrompt({ ...base, summary: { status: 'pending', active: false }, needed: true })).toBeNull();
    expect(employeeLicensePrompt({ ...base, summary: approved(400), needed: true })).toBeNull();
    expect(employeeLicensePrompt({ ...base, summary: { status: 'expired', active: false }, needed: false })?.tone).toBe('bad');
    expect(employeeLicensePrompt({ ...base, summary: { status: 'rejected', active: false, rejection_reason: 'Borroso' }, needed: true })?.detail)
      .toBe('Motivo: Borroso. Súbelo de nuevo.');
  });

  it('caducidad: a 30 días o menos; antes, solo si la empresa le pidió el renovado', () => {
    expect(employeeLicensePrompt({ ...base, summary: approved(25), needed: true })?.title).toContain('Tu carnet caduca el');
    expect(employeeLicensePrompt({ ...base, summary: approved(50), needed: true })).toBeNull();
    const summary = { ...approved(50), submitted_at: inDays(-300) };
    expect(employeeLicensePrompt({ ...base, summary, needed: true, requestedAt: inDays(-1) })).not.toBeNull();
    // Una petición anterior al carnet que tiene ya no cuenta.
    expect(employeeLicensePrompt({ ...base, summary, needed: true, requestedAt: inDays(-400) })).toBeNull();
  });
});

describe('pedir el carnet (empresa)', () => {
  it('se puede pedir sin carnet, rechazado, caducado o a punto de caducar; una vez al día', () => {
    expect(canRequestLicense({ status: null, active: false }, null, NOW)).toBe(true);
    expect(canRequestLicense({ status: 'rejected', active: false }, inDays(-2), NOW)).toBe(true);
    expect(canRequestLicense({ status: 'expired', active: false }, inDays(-0.5), NOW)).toBe(false);
    expect(canRequestLicense(approved(30), null, NOW)).toBe(true);
    expect(canRequestLicense(approved(400), null, NOW)).toBe(false);
    expect(canRequestLicense({ status: 'pending', active: false }, null, NOW)).toBe(false);
  });

  it('una petición cuenta si es posterior al último envío', () => {
    expect(requestIsCurrent({ status: 'rejected', active: false, submitted_at: inDays(-5) }, inDays(-1))).toBe(true);
    expect(requestIsCurrent({ status: 'rejected', active: false, submitted_at: inDays(-1) }, inDays(-5))).toBe(false);
    expect(requestIsCurrent(null, null)).toBe(false);
  });

  it('el carnet de alguien del equipo se lee igual que el propio', () => {
    expect(summaryFromTeamMember({
      license_status: 'approved', has_valid_phyto_license: true, license_expires_at: inDays(100), license_submitted_at: inDays(-10),
    })).toEqual({ status: 'approved', active: true, expires_at: inDays(100), rejection_reason: null, renewal: null, submitted_at: inDays(-10) });
  });
});

describe('licenseFile', () => {
  it('acepta fotos y PDF; rechaza lo demás, PDF de más de 10 MB y una tercera foto', () => {
    const none = { images: 0, hasPdf: false };
    expect(checkLicenseFile(new File(['x'], 'a.jpg', { type: 'image/jpeg' }), none)).toBeNull();
    expect(checkLicenseFile(new File(['x'], 'IMG_1.HEIC', { type: '' }), none)).toBeNull();
    expect(checkLicenseFile(new File(['x'], 'a.pdf', { type: 'application/pdf' }), none)).toBeNull();
    expect(checkLicenseFile(new File(['x'], 'a.exe', { type: 'application/octet-stream' }), none)).toContain('no vale');
    expect(checkLicenseFile(new File(['x'.repeat(10 * 1024 * 1024 + 1)], 'a.pdf', { type: 'application/pdf' }), none)).toContain('10 MB');
    expect(checkLicenseFile(new File(['x'], 'c.jpg', { type: 'image/jpeg' }), { images: 2, hasPdf: false })).toBe('Ya has puesto las dos caras.');
  });

  it('la ruta va en la carpeta del titular, con un nombre que acepta el servidor', () => {
    expect(licenseObjectPath('0a1eb2f1-0f8f-473e-81dc-27438e720e9b', 'jpg')).toMatch(/^0a1eb2f1-0f8f-473e-81dc-27438e720e9b\/[0-9a-f]{32}\.jpg$/);
  });
});
