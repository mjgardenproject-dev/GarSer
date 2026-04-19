# Prompt Engineering: Desbroce de Malas Hierbas

## Objetivo
Maximizar la repetibilidad y confiabilidad de la extracción visual para el servicio `Desbroce de malas hierbas`, manteniendo compatibilidad con el contrato actual del frontend.

## Cambios Implementados
- Prompt de desbroce rediseñado con:
- Rol explícito del sistema (`DesbroceVision`).
- Restricciones duras de salida JSON.
- Política de decisión por pasos orientada a evidencia visible.
- Criterios cuantificables para `estado_malas_hierbas` y `nivel_analisis`.
- Reglas de consistencia del output para evitar respuestas inválidas.
- Estandarización numérica: `superficie_malas_hierbas_m2` se fuerza a entero (redondeo al entero más cercano).
- **Protocolo Anti-Duplicación Multi-Vista**: Sección CRITICAL de deduplicación multi-foto, consolidación de zona única, prohibición explícita de suma por imagen, anclaje espacial obligatorio.
- Few-shot con 3 ejemplos (escena clara, parcial, fallida).
- Configuración de inferencia determinista para desbroce:
- `temperature = 0.05`.
- Validación de salida para desbroce:
- Normalización de estados.
- Fallback seguro a `nivel_analisis = 3` cuando la salida no cumple contrato.
- **Guardrail Backend**: Consolidación determinista de múltiples tareas de desbroce en una sola salida (área máxima conservadora, severidad máxima, nivel peor, observaciones únicas).
- Modo de auditoría de prompt:
- `mode: "weeding_prompt_quality_check"`.
- Ejecuciones múltiples del mismo caso.
- Métricas de repetibilidad y umbrales de aceptación.

## Prompt Final (Resumen Operativo)
El prompt exige:
- JSON-only.
- Cero inferencia de áreas no visibles.
- Cero cálculo de precio.
- Degradar nivel de análisis ante incertidumbre.
- **Deduplicación Multi-Foto Obligatoria**: Consolidación de zona única, prohibición de suma por imagen, anclaje espacial por hitos comunes.
- Umbrales explícitos:
- `normal` (<30cm, baja densidad, tallos blandos).
- `dificultad_media` (>=30cm, densidad media/alta, no leñosa dominante).
- `dificultad_alta` (tallos leñosos o masa densa severa).
- Reglas de consistencia:
- Nivel 3 => área 0 + estado null + observaciones no vacías.
- Nivel 1/2 => estado válido + área entera >= 0.

## Configuración Recomendada del Modelo
- Modelo: Gemini (mismo proveedor actual).
- Temperatura:
- Desbroce: `0.05`.
- MIME de respuesta: `application/json`.
- Validación posterior: obligatoria antes de devolver payload a frontend.

## Protocolo de Validación (Cross-Run)
Usar el endpoint `ai-pricing-estimator` con:
- `mode: "weeding_prompt_quality_check"`
- `qa_runs`: número de ejecuciones (3-10, recomendado 5).
- `photo_urls`: mismo set de imágenes en todas las corridas.

### Métricas Calculadas
- `state_match_ratio`
- `level_match_ratio`
- `area_band_match_ratio` (bandas de 5 m2)
- `area_cv` (coeficiente de variación de área)

### Umbrales de Aceptación
- `state_match_ratio >= 0.80`
- `level_match_ratio >= 0.80`
- `area_band_match_ratio >= 0.70`
- `area_cv <= 0.25`
- `runs_valid >= 3`

Si no se cumple cualquier umbral, el caso se marca como `accepted = false`.

## Set de Pruebas Estandarizado
Definir al menos 12 casos (recomendado):
- 4 casos claros (nivel esperado 1).
- 4 casos parciales/oclusiones (nivel esperado 2).
- 4 casos fallidos (nivel esperado 3).

Por cada caso registrar:
- estado esperado.
- nivel esperado.
- rango esperado de área (banda).

## Mantenimiento Continuo
- Re-ejecutar QA ante:
- cambios de prompt.
- cambios de modelo.
- cambios de preprocesado de imágenes.
- **Cambios en lógica de deduplicación o consolidación**.
- Mantener histórico de métricas por versión (`prompt_version`).
- No cambiar claves de salida (`superficie_malas_hierbas_m2`, `estado_malas_hierbas`, etc.) sin migración frontend/backend.
