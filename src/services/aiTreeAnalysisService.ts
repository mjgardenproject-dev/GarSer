import { TreePruningZone, AITreeAnalysisResult } from '../types/treePruning';

/**
 * Compatibilidad para el componente legacy de poda de arboles.
 * El flujo activo de reserva usa el backend canonico (`estimateWorkWithAI` + `analysis_v2`),
 * asi que este fallback no debe depender de prompts frontend duplicados.
 */
async function inferTreeAnalysisLocally(zone: TreePruningZone): Promise<Omit<AITreeAnalysisResult, 'zoneId'>> {
  console.log(`[AI Legacy Fallback] Analizando ${zone.photos.length} fotos para arbol ${zone.id}...`);

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

  console.log(`[AI Legacy Fallback] Arbol ${zone.id}: banda ${size_band}`);

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

  console.log(`Iniciando analisis legacy paralelo para ${zones.length} arboles...`);

  // Procesar todas las zonas en paralelo
  const analysisPromises = zones.map(async (zone) => {
    try {
      const analysis = await inferTreeAnalysisLocally(zone);

      return {
        zoneId: zone.id,
        ...analysis,
      } as AITreeAnalysisResult;
    } catch (error) {
      console.error(`Error analizando arbol ${zone.id}:`, error);
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
    console.log(`Analisis legacy completado para ${results.length} arboles.`);
    return results;
  } catch (error) {
    console.error('Error en analisis legacy paralelo:', error);
    throw new Error('Fallo el analisis de una o mas imagenes de arboles.');
  }
}
