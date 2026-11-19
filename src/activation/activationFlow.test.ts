import { describe, expect, it } from 'vitest';
import {
  blockNumber,
  clearActivationProgress,
  estimatedMinutes,
  clearTeamDraft,
  isActivationDoneLocally,
  isActivationPaused,
  markActivationDone,
  readTeamDraft,
  writeTeamDraft,
  nextStep,
  pauseActivation,
  previousStep,
  progressPercent,
  readActivationProgress,
  resumeActivation,
  stepSequence,
  writeActivationProgress,
} from './activationFlow';
import { ACTIVATION_SERVICES, sortActivationServices, toActivationServiceName, type ActivationServiceName } from './serviceCatalog';

const memory = () => {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
};
const known = (name: string): name is ActivationServiceName => ACTIVATION_SERVICES.some((s) => s.name === name);

describe('recorrido del cuestionario', () => {
  const two: ActivationServiceName[] = ['Corte de césped', 'Poda de palmeras'];

  it('bienvenida → zona → servicios → uno por servicio elegido → horario → equipo → final', () => {
    expect(stepSequence(two)).toEqual([
      'welcome', 'zone', 'services', 'service:Corte de césped', 'service:Poda de palmeras', 'schedule', 'team', 'finish',
    ]);
    expect(stepSequence([])).toEqual(['welcome', 'zone', 'services', 'schedule', 'team', 'finish']);
  });

  it('cuenta 4 bloques: zona 1, servicios 2 (también cada servicio), horario 3, equipo 4', () => {
    expect(blockNumber('welcome')).toBeNull();
    expect(blockNumber('zone')).toBe(1);
    expect(blockNumber('services')).toBe(2);
    expect(blockNumber('service:Poda de setos')).toBe(2);
    expect(blockNumber('schedule')).toBe(3);
    expect(blockNumber('team')).toBe(4);
    expect(blockNumber('finish')).toBeNull();
  });

  it('avanza y retrocede sin salirse de los extremos', () => {
    expect(nextStep('services', two)).toBe('service:Corte de césped');
    expect(nextStep('service:Poda de palmeras', two)).toBe('schedule');
    expect(nextStep('finish', two)).toBe('finish');
    expect(previousStep('schedule', two)).toBe('service:Poda de palmeras');
    expect(previousStep('welcome', two)).toBe('welcome');
    expect(previousStep('schedule', [])).toBe('services');
  });

  it('el progreso va de 0 a 100', () => {
    expect(progressPercent('welcome', two)).toBe(0);
    expect(progressPercent('finish', two)).toBe(100);
    expect(progressPercent('services', two)).toBeGreaterThan(progressPercent('zone', two));
  });

  it('tiempo estimado: mínimo 6 minutos, 2 más por servicio', () => {
    expect(estimatedMinutes(0)).toBe(6);
    expect(estimatedMinutes(1)).toBe(6);
    expect(estimatedMinutes(3)).toBe(10);
  });
});

describe('dónde se quedó', () => {
  it('guarda y retoma paso y servicios', () => {
    const storage = memory();
    writeActivationProgress('u1', { step: 'service:Poda de palmeras', selectedServices: ['Poda de palmeras'] }, storage);
    expect(readActivationProgress('u1', known, storage)).toEqual({ step: 'service:Poda de palmeras', selectedServices: ['Poda de palmeras'] });
    expect(readActivationProgress('otro', known, storage)).toBeNull();
    clearActivationProgress('u1', storage);
    expect(readActivationProgress('u1', known, storage)).toBeNull();
  });

  it('un paso que ya no existe (servicio desmarcado o dato roto) no se retoma', () => {
    const storage = memory();
    storage.setItem('garser:activation:u1', JSON.stringify({ step: 'service:Poda de setos', selectedServices: ['Corte de césped'] }));
    expect(readActivationProgress('u1', known, storage)).toBeNull();
    storage.setItem('garser:activation:u1', '{roto');
    expect(readActivationProgress('u1', known, storage)).toBeNull();
    storage.setItem('garser:activation:u1', JSON.stringify({ step: 'zone', selectedServices: ['Inventado', 'Corte de césped'] }));
    expect(readActivationProgress('u1', known, storage)).toEqual({ step: 'zone', selectedServices: ['Corte de césped'] });
  });

  it('retoma también las respuestas a medias y la pregunta en la que iba', () => {
    const storage = memory();
    writeActivationProgress('u1', {
      step: 'service:Corte de césped',
      selectedServices: ['Corte de césped'],
      serviceAnswers: { 'Corte de césped': { method: 'per_hour', hourly: 30 } },
      questionIndex: 2,
    }, storage);
    expect(readActivationProgress('u1', known, storage)).toEqual({
      step: 'service:Corte de césped',
      selectedServices: ['Corte de césped'],
      serviceAnswers: { 'Corte de césped': { method: 'per_hour', hourly: 30 } },
      questionIndex: 2,
    });
    storage.setItem('garser:activation:u1', JSON.stringify({ step: 'zone', selectedServices: [], serviceAnswers: { Inventado: {} }, questionIndex: -4 }));
    expect(readActivationProgress('u1', known, storage)).toEqual({ step: 'zone', selectedServices: [], serviceAnswers: {} });
  });

  it('sin almacenamiento no se rompe', () => {
    expect(readActivationProgress('u1', known, null)).toBeNull();
    expect(() => writeActivationProgress('u1', { step: 'zone', selectedServices: [] }, null)).not.toThrow();
    expect(isActivationPaused(null)).toBe(false);
  });

  it('«Seguir luego» pausa en la sesión y se puede reanudar', () => {
    const session = memory();
    expect(isActivationPaused(session)).toBe(false);
    pauseActivation(session);
    expect(isActivationPaused(session)).toBe(true);
    resumeActivation(session);
    expect(isActivationPaused(session)).toBe(false);
  });
});

describe('servicios', () => {
  it('reconoce los 7 servicios escritos de cualquier forma', () => {
    expect(toActivationServiceName('corte de cesped')).toBe('Corte de césped');
    expect(toActivationServiceName('Fumigación')).toBe('Servicios fitosanitarios');
    expect(toActivationServiceName('Limpieza de piscinas')).toBeNull();
    expect(toActivationServiceName(null)).toBeNull();
  });

  it('ordena como la pantalla y quita repetidos y desconocidos', () => {
    expect(sortActivationServices(['Poda de palmeras', 'corte de césped', 'Poda de palmeras', 'Otra cosa'])).toEqual([
      'Corte de césped',
      'Poda de palmeras',
    ]);
  });
});

describe('QA-196/QA-108 · cuestionario terminado', () => {
  it('se recuerda por persona y no cruza entre cuentas', () => {
    const storage = memory();
    expect(isActivationDoneLocally('u1', storage)).toBe(false);
    markActivationDone('u1', storage);
    expect(isActivationDoneLocally('u1', storage)).toBe(true);
    expect(isActivationDoneLocally('u2', storage)).toBe(false);
  });

  it('sin almacenamiento no falla (queda lo que diga el servidor)', () => {
    expect(() => markActivationDone('u1', null)).not.toThrow();
    expect(isActivationDoneLocally('u1', null)).toBe(false);
  });
});

describe('QA-026 · borrador de las invitaciones', () => {
  const draft = {
    team: {
      answer: 'yes' as const,
      emails: ['marta@ejemplo.es', ''],
      presets: [{ name: 'Marta', serviceIds: ['s1'], schedule: 'company', days: [1], start: 8, end: 14, requestLicense: false }, null],
      declared: true,
    },
    sent: [{ invitationId: 'i1', email: 'pepe@ejemplo.es', url: 'https://garser.es/invitacion?t=1', emailed: true }],
  };

  it('lo escrito sobrevive a recargar', () => {
    const storage = memory();
    writeTeamDraft('u1', draft, storage);
    expect(readTeamDraft('u1', storage)).toEqual(draft);
  });

  it('pasadas dos semanas se olvida (son correos de otras personas)', () => {
    const storage = memory();
    writeTeamDraft('u1', draft, storage);
    expect(readTeamDraft('u1', storage, Date.now() + 13 * 24 * 3600 * 1000)).not.toBeNull();
    expect(readTeamDraft('u1', storage, Date.now() + 15 * 24 * 3600 * 1000)).toBeNull();
  });

  it('es de cada cuenta y se puede borrar', () => {
    const storage = memory();
    writeTeamDraft('u1', draft, storage);
    expect(readTeamDraft('u2', storage)).toBeNull();
    clearTeamDraft('u1', storage);
    expect(readTeamDraft('u1', storage)).toBeNull();
  });

  it('un borrador estropeado se ignora', () => {
    const storage = memory();
    storage.setItem('garser:activation:team:u1', '{"team":{"emails":"no","presets":[]}}');
    expect(readTeamDraft('u1', storage)).toBeNull();
    storage.setItem('garser:activation:team:u1', 'basura{');
    expect(readTeamDraft('u1', storage)).toBeNull();
    storage.setItem('garser:activation:team:u1', JSON.stringify({ team: { answer: 'yes', emails: ['a@b.c'], presets: [] } }));
    expect(readTeamDraft('u1', storage)).toBeNull(); // presets y correos deben ir a la par
  });
});
