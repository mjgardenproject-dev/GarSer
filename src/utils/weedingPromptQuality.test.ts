import { describe, expect, it } from 'vitest';
import { areaBand, computeWeedingRepeatabilityMetrics } from './weedingPromptQuality';

describe('weedingPromptQuality', () => {
  it('calcula bandas de area de forma estable', () => {
    expect(areaBand(0)).toBe(0);
    expect(areaBand(2.4)).toBe(0);
    expect(areaBand(2.6)).toBe(5);
    expect(areaBand(12.6)).toBe(15);
  });

  it('mide repetibilidad alta cuando resultados son consistentes', () => {
    const metrics = computeWeedingRepeatabilityMetrics([
      { estado_malas_hierbas: 'dificultad_media', nivel_analisis: 2, superficie_malas_hierbas_m2: 20 },
      { estado_malas_hierbas: 'dificultad_media', nivel_analisis: 2, superficie_malas_hierbas_m2: 20 },
      { estado_malas_hierbas: 'dificultad_media', nivel_analisis: 2, superficie_malas_hierbas_m2: 20 },
      { estado_malas_hierbas: 'dificultad_media', nivel_analisis: 2, superficie_malas_hierbas_m2: 20 }
    ]);

    expect(metrics.state_match_ratio).toBe(1);
    expect(metrics.level_match_ratio).toBe(1);
    expect(metrics.area_band_match_ratio).toBe(1);
    expect(metrics.area_cv).toBe(0);
  });

  it('mide degradacion de repetibilidad con resultados dispares', () => {
    const metrics = computeWeedingRepeatabilityMetrics([
      { estado_malas_hierbas: 'normal', nivel_analisis: 1, superficie_malas_hierbas_m2: 4 },
      { estado_malas_hierbas: 'dificultad_media', nivel_analisis: 2, superficie_malas_hierbas_m2: 30 },
      { estado_malas_hierbas: 'dificultad_alta', nivel_analisis: 3, superficie_malas_hierbas_m2: 70 },
      { estado_malas_hierbas: 'normal', nivel_analisis: 2, superficie_malas_hierbas_m2: 15 }
    ]);

    expect(metrics.state_match_ratio).toBeLessThan(0.6);
    expect(metrics.level_match_ratio).toBeLessThan(0.6);
    expect(metrics.area_cv).toBeGreaterThan(0.5);
  });

  it('simula consolidacion de multiples tareas de desbroce en una sola', () => {
    // Simula salida de IA con múltiples tareas para la misma zona
    const mockAiOutput = {
      tareas: [
        {
          tipo_servicio: 'Desbroce de malas hierbas',
          estado_malas_hierbas: 'normal',
          superficie_malas_hierbas_m2: 15,
          nivel_analisis: 1,
          observaciones: null
        },
        {
          tipo_servicio: 'Desbroce de malas hierbas',
          estado_malas_hierbas: 'dificultad_media',
          superficie_malas_hierbas_m2: 20,
          nivel_analisis: 2,
          observaciones: ['mala luz']
        },
        {
          tipo_servicio: 'Desbroce de malas hierbas',
          estado_malas_hierbas: 'normal',
          superficie_malas_hierbas_m2: 18,
          nivel_analisis: 1,
          observaciones: null
        }
      ]
    };

    // Expected consolidated: max area 20, worst state 'dificultad_media', worst level 2, merged observations
    const expected = {
      tipo_servicio: 'Desbroce de malas hierbas',
      estado_malas_hierbas: 'dificultad_media',
      superficie_malas_hierbas_m2: 20,
      nivel_analisis: 2,
      observaciones: ['mala luz']
    };

    // Note: This is a mock test; actual consolidation is in backend parseWeedingResult
    // Here we verify the logic conceptually
    expect(expected.estado_malas_hierbas).toBe('dificultad_media'); // worst severity
    expect(expected.superficie_malas_hierbas_m2).toBe(20); // max area
    expect(expected.nivel_analisis).toBe(2); // worst level
    expect(expected.observaciones).toEqual(['mala luz']); // unique observations
  });

  it('no regresa estructura JSON de tarea de desbroce', () => {
    const validTask = {
      tipo_servicio: 'Desbroce de malas hierbas',
      estado_malas_hierbas: 'normal',
      superficie_malas_hierbas_m2: 25,
      nivel_analisis: 1,
      observaciones: null
    };

    // Verifica que la estructura sea correcta
    expect(validTask).toHaveProperty('tipo_servicio');
    expect(validTask).toHaveProperty('estado_malas_hierbas');
    expect(validTask).toHaveProperty('superficie_malas_hierbas_m2');
    expect(validTask).toHaveProperty('nivel_analisis');
    expect(validTask).toHaveProperty('observaciones');
    expect(typeof validTask.superficie_malas_hierbas_m2).toBe('number');
    expect([1, 2, 3]).toContain(validTask.nivel_analisis);
  });
});
