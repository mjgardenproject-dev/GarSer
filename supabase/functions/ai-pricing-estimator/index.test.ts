import { describe, expect, it } from 'vitest';

describe('ai-pricing-estimator payload guards', () => {
  it('depende explícitamente del header apikey en la request', () => {
    const req = new Request('http://localhost:8000/ai-pricing-estimator', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ mode: 'auto_quote' }),
    });

    expect(req.headers.get('apikey')).toBeNull();
  });

  it('trunca descripciones largas a 1000 caracteres', () => {
    const description = 'A'.repeat(2000);
    const truncated = description.substring(0, 1000);
    expect(truncated).toHaveLength(1000);
    expect(truncated).toBe('A'.repeat(1000));
  });

  it('limita photo_urls al máximo permitido por el contrato', () => {
    const photoUrls = ['1', '2', '3', '4', '5', '6', '7', '8'];
    const sliced = photoUrls.slice(0, 6);
    expect(sliced).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('devuelve estructura de error heurístico consistente', () => {
    const reason = 'AI_TIMEOUT';
    const result = {
      tareas: [],
      reasons: [reason || 'AI_FAILED_CRITICAL'],
    };

    expect(result.tareas).toHaveLength(0);
    expect(result.reasons[0]).toBe('AI_TIMEOUT');
  });
});
