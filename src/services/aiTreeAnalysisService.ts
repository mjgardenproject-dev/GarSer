// src/services/aiTreeAnalysisService.ts

import { TreePruningZone, AITreeAnalysisResult } from '../types/treePruning';
import { TREE_ANALYSIS_SYSTEM_PROMPT } from '../domain/ai/prompts';

/**
 * Simula llamada a IA para desarrollo (reemplazar con llamada real a OpenAI/Gemini).
 */
async function mockAICall(zone: TreePruningZone): Promise<Omit<AITreeAnalysisResult, 'zoneId'>> {
  console.log(`[AI Mock] Analizando ${zone.photos.length} fotos para árbol ${zone.id}...`);

  // Simulación basada en cantidad de fotos
  const photoCount = zone.photos.length;
  let size_band: 'small' | 'medium' | 'large' | 'over_9' = 'medium';

  // Más fotos = árbol más complejo
  if (photoCount > 2) {
    size_band = 'over_9';
  } else if (photoCount === 1) {
    size_band = 'small';
  } else if (photoCount === 0) {
    size_band = 'small';
  }

  // Simular latencia de red
  await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 500));

  console.log(`[AI Mock] Árbol ${zone.id}: banda ${size_band}`);

  return {
    size_band,
    dificultad_alta: false,
    nivel_analisis: (photoCount === 0 ? 3 : photoCount === 1 ? 2 : 1) as 1 | 2 | 3,
    observaciones: photoCount === 0 ? ['No se detectó ningún árbol válido'] : []
  };
}

/**
 * Analiza imágenes de múltiples árboles en paralelo.
 * Cada zona (árbol) se procesa concurrentemente.
 */
export async function analyzeTreeImages(zones: TreePruningZone[]): Promise<AITreeAnalysisResult[]> {
  if (zones.length === 0) return [];

  console.log(`Iniciando análisis IA paralelo para ${zones.length} árboles...`);

  // Procesar todas las zonas en paralelo
  const analysisPromises = zones.map(async (zone) => {
    try {
      // En producción: llamar a OpenAI/Gemini con TREE_ANALYSIS_SYSTEM_PROMPT
      const analysis = await mockAICall(zone);

      return {
        zoneId: zone.id,
        ...analysis,
      } as AITreeAnalysisResult;
    } catch (error) {
      console.error(`Error analizando árbol ${zone.id}:`, error);
      // En caso de error, devolver valores por defecto
      return {
        zoneId: zone.id,
        size_band: 'small' as const,
        dificultad_alta: false,
        nivel_analisis: 3 as const,
        observaciones: ['Error analizando imágenes']
      };
    }
  });

  try {
    const results = await Promise.all(analysisPromises);
    console.log(`Análisis IA completado para ${results.length} árboles.`);
    return results;
  } catch (error) {
    console.error('Error en análisis IA paralelo:', error);
    throw new Error('Falló el análisis de una o más imágenes de árboles.');
  }
}
