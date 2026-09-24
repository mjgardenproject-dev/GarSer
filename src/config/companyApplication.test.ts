import { describe, expect, it } from 'vitest';
import {
  COMPANY_APPLICATION_STEPS,
  EMPTY_COMPANY_APPLICATION,
  describeAnswers,
  fromApplicationRow,
  isValidSpanishPhone,
  isValidSpanishTaxId,
  missingInApplication,
  missingInStep,
  toApplicationRow,
  type CompanyApplicationDraft,
} from './companyApplication';

const complete: CompanyApplicationDraft = {
  commercial_name: 'Jardines Costa del Sol',
  legal_name: 'Jardines Costa del Sol S.L.',
  tax_id: 'B12345678',
  contact_name: 'Ana Pérez',
  phone: '600 123 123',
  address: 'Calle Mayor 1, Marbella',
  city_zone: 'Marbella',
  services: ['Corte de césped'],
  owner_works: false,
  accept_terms: true,
  declaration_truth: true,
  answers: { team_size: '2-5', has_liability_insurance: true },
};

describe('encuesta de alta de empresas (D7)', () => {
  it('una solicitud completa no tiene nada pendiente en ningún paso', () => {
    expect(missingInApplication(complete)).toEqual([]);
  });

  it('una solicitud vacía pide lo obligatorio de cada paso, en palabras para el usuario', () => {
    const empty = { ...EMPTY_COMPANY_APPLICATION, answers: {} };
    expect(missingInStep('empresa', empty)).toEqual(['el nombre comercial', 'la razón social', 'el CIF']);
    expect(missingInStep('equipo', empty)).toEqual(['cuántas personas sois', 'si el titular trabaja en los servicios']);
    expect(missingInStep('servicios', empty)).toEqual(['al menos un servicio']);
    expect(missingInStep('garantias', empty)).toContain('si tenéis seguro de responsabilidad civil');
    expect(COMPANY_APPLICATION_STEPS.map((s) => s.id)).toEqual(['empresa', 'contacto', 'equipo', 'servicios', 'garantias']);
  });

  it('«el titular no trabaja» es una respuesta válida, distinta de no contestar', () => {
    expect(missingInStep('equipo', { ...complete, owner_works: false })).toEqual([]);
    expect(missingInStep('equipo', { ...complete, owner_works: null })).toContain('si el titular trabaja en los servicios');
  });

  it('«no tenemos seguro» también es una respuesta (la valora el admin), no un campo vacío', () => {
    expect(missingInStep('garantias', { ...complete, answers: { ...complete.answers, has_liability_insurance: false } })).toEqual([]);
  });

  it('valida el formato de CIF, NIF y NIE, y del teléfono', () => {
    for (const ok of ['B12345678', 'b-1234567-8', '12345678Z', 'X1234567L']) expect(isValidSpanishTaxId(ok)).toBe(true);
    for (const bad of ['123', 'I1234567A', 'B1234567', 'ABCDEFGHI']) expect(isValidSpanishTaxId(bad)).toBe(false);
    for (const ok of ['600123123', '+34 700 123 123', '912-345-678']) expect(isValidSpanishPhone(ok)).toBe(true);
    for (const bad of ['500123123', '60012312', '']) expect(isValidSpanishPhone(bad)).toBe(false);
    expect(missingInStep('empresa', { ...complete, tax_id: '123' })).toEqual(['un CIF, NIF o NIE con formato válido']);
  });

  it('guardar y recuperar un borrador no pierde respuestas, tampoco un «no» explícito', () => {
    const row = { ...toApplicationRow(complete), status: 'draft' };
    const back = fromApplicationRow(row);
    expect(back.owner_works).toBe(false);
    expect(back.answers.team_size).toBe('2-5');
    expect(back.tax_id).toBe('B12345678');
    expect(fromApplicationRow({ ...row, answers: {} }).owner_works).toBeNull();
  });

  it('la fila que se guarda normaliza el CIF y no incluye columnas que la empresa no puede escribir', () => {
    const row = toApplicationRow({ ...complete, tax_id: ' b-12345678 ' });
    expect(row.tax_id).toBe('B12345678');
    for (const forbidden of ['status', 'email', 'review_comment', 'reviewer_id', 'user_id']) expect(row).not.toHaveProperty(forbidden);
  });

  it('las respuestas se presentan al admin con etiquetas legibles', () => {
    const lines = describeAnswers({ team_size: '6-10', has_liability_insurance: false });
    expect(lines).toContainEqual({ label: 'Personas en el equipo', value: '6 a 10' });
    expect(lines).toContainEqual({ label: 'Seguro de responsabilidad civil', value: 'No' });
  });
});
