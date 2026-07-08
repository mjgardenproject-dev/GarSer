import { describe, expect, it } from 'vitest';
import {
  buildAnalysisPromptAssembly,
  DETERMINISTIC_PROMPT_SETTINGS,
} from './new_prompts';

describe('new_prompts SSOT backend', () => {
  it('construye prompts con backbone universal y configuracion determinista', () => {
    const assembly = buildAnalysisPromptAssembly({
      service_name: 'Desbroce de malas hierbas',
      description: 'Zona con malas hierbas cerca del vallado',
      photo_urls: ['https://example.com/weed-1.jpg', 'https://example.com/weed-2.jpg'],
    });

    const systemPrompt = String(assembly.messages[0].content);
    expect(assembly.service).toBe('Desbroce de malas hierbas');
    expect(systemPrompt).toContain('UNIVERSAL QUALITY STANDARD');
    expect(systemPrompt).toContain('MULTI-PHOTO DEDUPLICATION RULES');
    expect(systemPrompt).toContain('razonamiento_transversal');
    expect(systemPrompt).toContain('ELEMENTS_NOT_DETECTED');
    expect(DETERMINISTIC_PROMPT_SETTINGS).toMatchObject({
      temperature: 0,
      topP: 1,
      topK: 1,
      frequencyPenalty: 0,
      presencePenalty: 0,
    });
  });

  it('el prompt de palmeras incluye procedimiento, definiciones operativas y confidences', () => {
    const assembly = buildAnalysisPromptAssembly({
      service_name: 'Poda de palmeras',
      photo_urls: ['https://example.com/palm-1.jpg'],
    });

    const systemPrompt = String(assembly.messages[0].content);
    expect(assembly.service).toBe('Poda de palmeras');
    // Procedimiento y medición de tronco
    expect(systemPrompt).toContain('PROCEDURE');
    expect(systemPrompt).toContain('BASE of the crown');
    // Especies del catálogo con criterios visuales
    expect(systemPrompt).toContain('SPECIES IDENTIFICATION TRAITS');
    expect(systemPrompt).toContain('Trachycarpus fortunei');
    // Definiciones operativas de estado
    expect(systemPrompt).toContain('MAINTENANCE STATE DEFINITIONS');
    expect(systemPrompt).toContain('"muy descuidado"');
    // Rangos plausibles y calibración de confidence
    expect(systemPrompt).toContain('PLAUSIBLE TRUNK HEIGHT RANGES');
    expect(systemPrompt).toContain('CONFIDENCE CALIBRATION');
    // Schema con confidences y referencia de escala
    expect(systemPrompt).toContain('"especie_confidence"');
    expect(systemPrompt).toContain('"altura_confidence"');
    expect(systemPrompt).toContain('"estado_confidence"');
    expect(systemPrompt).toContain('"referencia_escala"');
  });

  it('el prompt de árboles incluye definiciones de bandas, confidences y prohibición de dificultad IA', () => {
    const assembly = buildAnalysisPromptAssembly({
      service_name: 'Poda de árboles',
      photo_urls: ['https://example.com/tree-1.jpg'],
    });

    const systemPrompt = String(assembly.messages[0].content);
    expect(assembly.service).toBe('Poda de árboles');
    // Procedimiento con altura total y referencias de escala
    expect(systemPrompt).toContain('PROCEDURE');
    expect(systemPrompt).toContain('TOTAL height');
    expect(systemPrompt).toContain('referencia_escala');
    // Definiciones operativas de bandas
    expect(systemPrompt).toContain('SIZE BAND DEFINITIONS');
    expect(systemPrompt).toContain('"over_9": 9 m or more');
    // Plausibilidad y confidence
    expect(systemPrompt).toContain('PLAUSIBLE HEIGHT RANGE');
    expect(systemPrompt).toContain('CONFIDENCE CALIBRATION');
    expect(systemPrompt).toContain('"size_band_confidence"');
    expect(systemPrompt).toContain('"altura_confidence"');
    // La dificultad nunca la decide la IA
    expect(systemPrompt).toContain('dificultad_alta must remain false');
  });

  it('el prompt de arbustos incluye estado operativo, confidences y rango plausible', () => {
    const assembly = buildAnalysisPromptAssembly({
      service_name: 'Poda de plantas y arbustos',
      photo_urls: ['https://example.com/shrub-1.jpg'],
    });

    const systemPrompt = String(assembly.messages[0].content);
    expect(assembly.service).toBe('Poda de plantas y arbustos');
    expect(systemPrompt).toContain('PROCEDURE');
    expect(systemPrompt).toContain('DOMINANT SIZE DEFINITIONS');
    expect(systemPrompt).toContain('MAINTENANCE STATE DEFINITIONS');
    expect(systemPrompt).toContain('estado_plantas');
    expect(systemPrompt).toContain('PLAUSIBLE AREA RANGE');
    expect(systemPrompt).toContain('CONFIDENCE CALIBRATION');
    expect(systemPrompt).toContain('"superficie_confidence"');
    expect(systemPrompt).toContain('"tamano_confidence"');
    expect(systemPrompt).toContain('"estado_confidence"');
    expect(systemPrompt).toContain('"referencia_escala"');
  });

  it('etiqueta caras de setos (FACE_A / FACE_B) en el contenido del usuario', () => {
    const hedgeAssembly = buildAnalysisPromptAssembly({
      service_name: 'Poda de setos',
      hedge_faces: {
        face_a_urls: ['https://example.com/hedge-a.jpg'],
        face_b_urls: ['https://example.com/hedge-b.jpg'],
      },
    });
    const hedgeUserContent = hedgeAssembly.messages[1].content;
    const hedgeTextParts = Array.isArray(hedgeUserContent)
      ? hedgeUserContent.filter((part) => part.type === 'text').map((part) => part.text)
      : [];

    expect(hedgeAssembly.service).toBe('Poda de setos');
    expect(hedgeTextParts).toContain('FACE_A:');
    expect(hedgeTextParts).toContain('FACE_B:');
  });
});
