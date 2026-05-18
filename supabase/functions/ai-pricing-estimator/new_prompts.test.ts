import { describe, expect, it } from 'vitest';
import {
  buildAnalysisPromptAssembly,
  buildAutoQuotePromptAssembly,
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

  it('etiqueta caras de setos y reutiliza el mismo ensamblador para auto_quote', () => {
    const hedgeAssembly = buildAnalysisPromptAssembly({
      service_name: 'Corte de setos',
      hedge_faces: {
        face_a_urls: ['https://example.com/hedge-a.jpg'],
        face_b_urls: ['https://example.com/hedge-b.jpg'],
      },
    });
    const hedgeUserContent = hedgeAssembly.messages[1].content;
    const hedgeTextParts = Array.isArray(hedgeUserContent)
      ? hedgeUserContent.filter((part) => part.type === 'text').map((part) => part.text)
      : [];

    expect(hedgeAssembly.service).toBe('Corte de setos');
    expect(hedgeTextParts).toContain('FACE_A:');
    expect(hedgeTextParts).toContain('FACE_B:');

    const autoQuoteAssembly = buildAutoQuotePromptAssembly({
      service: 'Corte de césped',
      image_url: 'https://example.com/lawn.jpg',
      description: 'Cesped trasero',
    });

    expect(autoQuoteAssembly.service).toBe('Corte de césped');
    expect(Array.isArray(autoQuoteAssembly.messages[1].content)).toBe(true);
  });
});
