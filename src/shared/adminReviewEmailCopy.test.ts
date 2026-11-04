import { describe, expect, it } from 'vitest';
import {
  ADMIN_REVIEW_KINDS,
  adminReviewEmailCopy,
  adminReviewPathFor,
  isAdminReviewKind,
  pendingSummary,
  type AdminPendingCounts,
  type AdminReviewItem,
} from '../../supabase/functions/_shared/adminReviewEmailCopy.ts';

const none: AdminPendingCounts = { gardenerApplications: 0, companyApplications: 0, licenses: 0, incidents: 0 };

describe('avisos al administrador: textos', () => {
  it('conoce los cuatro tipos y rechaza cualquier otro', () => {
    expect([...ADMIN_REVIEW_KINDS]).toEqual(['gardener_application', 'company_application', 'phyto_license', 'incident']);
    for (const kind of ADMIN_REVIEW_KINDS) expect(isAdminReviewKind(kind)).toBe(true);
    for (const bad of ['', 'admin', 'GARDENER_APPLICATION', null, undefined, 3, {}]) expect(isAdminReviewKind(bad)).toBe(false);
  });

  it('cada tipo lleva a la sección donde se resuelve', () => {
    expect(adminReviewPathFor('gardener_application')).toBe('/admin/users');
    expect(adminReviewPathFor('company_application')).toBe('/admin/users');
    expect(adminReviewPathFor('phyto_license')).toBe('/admin/phytosanitary');
    expect(adminReviewPathFor('incident')).toBe('/admin/incidents');
  });

  it('solicitud de jardinero: quién es, de dónde, qué hace y cuánta experiencia tiene', () => {
    const item: AdminReviewItem = { kind: 'gardener_application', name: 'Pablo Gómez', zone: 'Marbella', services: ['Corte de césped', 'Poda de setos'], experience: '3-5' };
    const copy = adminReviewEmailCopy({ item, counts: { ...none, gardenerApplications: 2, licenses: 1 } });
    expect(copy.subject).toBe('Nueva solicitud de jardinero para revisar');
    expect(copy.intro).toContain('Pablo Gómez ha enviado su solicitud');
    expect(copy.pairs).toEqual([
      ['Nombre', 'Pablo Gómez'],
      ['Zona', 'Marbella'],
      ['Servicios', 'Corte de césped, Poda de setos'],
      ['Experiencia', 'De 3 a 5 años'],
      ['Pendiente ahora', '2 solicitudes de jardinero · 1 carnet fitosanitario'],
    ]);
    expect(copy.ctaPath).toBe('/admin/users');
    // Recuerda la promesa que se le hace a quien solicita el alta.
    expect(copy.footerNote).toContain('menos de 24 horas');
  });

  it('sin nombre no inventa uno, y no deja filas vacías', () => {
    const copy = adminReviewEmailCopy({ item: { kind: 'gardener_application', name: '', zone: '  ', services: [], experience: '' }, counts: none });
    expect(copy.intro.startsWith('Una persona ha enviado')).toBe(true);
    expect(copy.pairs).toEqual([]);
  });

  it('muchos servicios se resumen', () => {
    const services = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const copy = adminReviewEmailCopy({ item: { kind: 'company_application', companyName: 'Jardines Sol', contactName: 'Ana', zone: 'Estepona', services }, counts: none });
    expect(copy.pairs.find(([label]) => label === 'Servicios')?.[1]).toBe('A, B, C, D, E y 2 más');
    expect(copy.subject).toBe('Nueva solicitud de empresa para revisar');
    expect(copy.intro).toContain('Jardines Sol ha enviado su solicitud de alta');
  });

  it('carnet: titular, quién lo envía (si es otra persona) y qué pasa si se deja', () => {
    const own = adminReviewEmailCopy({ item: { kind: 'phyto_license', holderName: 'Ana López', submittedByName: 'Ana López', expiresLabel: '3 de marzo de 2031' }, counts: none });
    expect(own.pairs).toEqual([['Titular', 'Ana López'], ['Caducidad indicada', '3 de marzo de 2031']]);
    const byCompany = adminReviewEmailCopy({ item: { kind: 'phyto_license', holderName: 'Ana López', submittedByName: 'Jardines Sol', expiresLabel: '' }, counts: none });
    expect(byCompany.pairs).toEqual([['Titular', 'Ana López'], ['Enviado por', 'Jardines Sol']]);
    expect(byCompany.footerNote).toContain('no sale a los clientes');
    expect(byCompany.ctaPath).toBe('/admin/phytosanitary');
  });

  it('incidencia: quién la abre, motivo en llano y el texto recortado', () => {
    const long = 'x'.repeat(400);
    const copy = adminReviewEmailCopy({ item: { kind: 'incident', reporterRole: 'client', incidentKind: 'gardener_no_show', description: long }, counts: { ...none, incidents: 3 } });
    expect(copy.pairs[0]).toEqual(['La abre', 'Cliente']);
    expect(copy.pairs[1]).toEqual(['Motivo', 'El profesional no se presentó']);
    const detail = copy.pairs[2][1];
    expect(detail.length).toBeLessThanOrEqual(160);
    expect(detail.endsWith('…')).toBe(true);
    expect(copy.pairs[3]).toEqual(['Pendiente ahora', '3 incidencias']);
    expect(copy.footerNote).toContain('esperando una respuesta');
    const byGardener = adminReviewEmailCopy({ item: { kind: 'incident', reporterRole: 'gardener', incidentKind: 'raro', description: 'Hola, ha pasado algo con el cliente' }, counts: none });
    expect(byGardener.intro).toContain('Un profesional ha abierto una incidencia');
    // Un motivo desconocido se enseña tal cual en vez de esconderse.
    expect(byGardener.pairs[1]).toEqual(['Motivo', 'raro']);
  });

  it('el resumen de pendientes usa singular y plural y omite lo que es cero', () => {
    expect(pendingSummary(none)).toBe('');
    expect(pendingSummary({ gardenerApplications: 1, companyApplications: 1, licenses: 1, incidents: 1 }))
      .toBe('1 solicitud de jardinero · 1 solicitud de empresa · 1 carnet fitosanitario · 1 incidencia');
    expect(pendingSummary({ gardenerApplications: 0, companyApplications: 2, licenses: 0, incidents: 5 })).toBe('2 solicitudes de empresa · 5 incidencias');
  });

  it('nunca lleva porcentajes ni datos de contacto del solicitante', () => {
    const text = JSON.stringify(adminReviewEmailCopy({
      item: { kind: 'gardener_application', name: 'Pablo', zone: 'Marbella', services: ['Corte'], experience: '>5' }, counts: none,
    }));
    expect(text).not.toMatch(/@|\+34|tel[eé]fono|%/);
  });
});
