# Especificación de Mejora: Manejo Explícito de Fallos de Detección en IA

## 1. Contexto y Problema
Actualmente, los servicios de **Poda de árboles** y **Poda de palmeras** tienen un comportamiento inconsistente ante imágenes donde no se detectan elementos válidos:
- **Caso 1 (Imagen única fallida):** La IA devuelve un array vacío `[]`. El frontend lo interpreta como "cero resultados" y muestra un mensaje de advertencia general.
- **Caso 2 (Múltiples imágenes, algunas fallidas):** La IA "silencia" las imágenes fallidas, devolviendo solo los elementos detectados en las fotos válidas. El usuario no recibe feedback sobre las fotos ignoradas.

## 2. Objetivo
Asegurar que **cada imagen enviada** tenga una respuesta explícita en el JSON, ya sea un resultado exitoso o un reporte de fallo. Las imágenes fallidas deben mostrarse visualmente en la UI como tarjetas de error (rojas) con el motivo del fallo.

## 3. Alcance
- **Servicios afectados (Exclusivo):** "Poda de árboles" y "Poda de palmeras".
- **Archivos a modificar:** `supabase/functions/ai-pricing-estimator/index.ts`.
- **Frontend:** No requiere cambios estructurales (la UI ya soporta tarjetas de fallo), solo validación de que el flujo de datos alimenta correctamente estos estados.

## 4. Cambios Propuestos en Backend (`index.ts`)

### A. Modificación del System Prompt: "Poda de palmeras"
Se alterará la instrucción de validación para prohibir el retorno de arrays vacíos cuando hay imágenes de entrada. Se forzará la creación de un objeto de "Fallo" para cada índice de imagen no exitoso.

**Cambio de Lógica:**
- **Antes:** "IF NO VALID PRUNABLE PALM IS FOUND: Return 'palmas':[] immediately."
- **Después:** "IF NO VALID PRUNABLE PALM IS FOUND IN AN IMAGE: You MUST return an entry for that image with `nivel_analisis: 3`, `observaciones`: ['No se detectó ninguna palmera'], `especie`: 'No detectada' y `altura`: '0-0'."

### B. Modificación del System Prompt: "Poda de árboles"
Similar a palmeras, se modificará la instrucción de detección.

**Cambio de Lógica:**
- **Antes:** "IF NO VALID PRUNABLE TREE IS FOUND: Return 'arboles': [] immediately."
- **Después:** "IF NO VALID PRUNABLE TREE IS FOUND IN AN IMAGE: You MUST return an entry for that image with `nivel_analisis: 3`, `observaciones`: ['No se detectó ningún árbol válido'], `altura_m`: 0, `tipo_poda`: 'structural', `tipo_acceso`: 'Poda desde el suelo' y `horas_estimadas`: 0."

## 5. Comportamiento Esperado en Frontend (Verificado)
Al recibir estos objetos con `nivel_analisis: 3`:
1. **Poda de Palmeras:** `DetailsPage.tsx` iterará sobre `palmGroups`. El item tendrá `analysisLevel: 3`. La condición `const isFailed = ... || group.analysisLevel === 3` se cumplirá. Se renderizará la tarjeta roja.
2. **Poda de Árboles:** Similarmente, `treeGroups` detectará `analysisLevel: 3` y renderizará la tarjeta de error correspondiente.

## 6. Plan de Ejecución
1.  **Backup:** Asegurar copia de los prompts actuales.
2.  **Edición:** Modificar `index.ts` con las nuevas instrucciones de "Fallo Explícito" en los prompts de los dos servicios.
3.  **Despliegue:** Publicar la Edge Function actualizada.
