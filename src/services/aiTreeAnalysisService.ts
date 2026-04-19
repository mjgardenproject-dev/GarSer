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
  let altura_m = 2.5 + Math.random() * 10; // 2.5m - 12.5m
  let dificultad_alta = Math.random() > 0.6; // 40% dificultad alta

  // Más fotos = árbol más complejo
  if (photoCount > 2) {
    altura_m = 8 + Math.random() * 5; // 8m - 13m
    dificultad_alta = true;
  } else if (photoCount === 0) {
    altura_m = 1; // Sin fotos, estimación baja
    dificultad_alta = false;
  }

  // Simular latencia de red
  await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 500));

  console.log(`[AI Mock] Árbol ${zone.id}: ${altura_m.toFixed(1)}m, dificultad: ${dificultad_alta}`);

  return {
    altura_m,
    dificultad_alta,
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
        altura_m: 0,
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
