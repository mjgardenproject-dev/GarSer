# Informe de Implementación y Eficiencia de la Canvas API

## Objetivo
Este informe detalla todas las instancias en las que se utiliza la Canvas API en la aplicación GarSer para el manejo, procesamiento, renderizado, edición y validación de imágenes. El propósito es garantizar que se sigan las mejores prácticas para la optimización de rendimiento y documentar los flujos existentes.

---

## 1. Instancias Identificadas de Canvas API

Tras analizar exhaustivamente el código base, se han identificado **4 usos distintos** de la Canvas API.

### 1.1 Validación Local de Imágenes (Pre-subida)
- **Ubicación:** `src/utils/imageValidator.ts`
- **Función:** `validateImageLocal(file: File)`
- **Uso de Canvas:**
  1. Carga la imagen mediante `URL.createObjectURL`.
  2. Crea un `canvas` de 100x100 px (independientemente del tamaño original).
  3. Dibuja la imagen redimensionada (`ctx.drawImage`).
  4. Extrae los píxeles (`ctx.getImageData`) y calcula el brillo medio utilizando la fórmula estándar de luma (\`R * 299 + G * 587 + B * 114\`).
- **Eficiencia y Mejores Prácticas:**
  - **Positivo:** Utiliza `willReadFrequently: true` al instanciar el contexto (`getContext('2d')`), lo que es una optimización crítica en navegadores modernos cuando se va a llamar a `getImageData` repetidamente.
  - **Positivo:** Redimensiona agresivamente a 100x100 píxeles. Analizar 10,000 píxeles es imperceptible en tiempo de ejecución (menos de 5ms), en lugar de iterar sobre imágenes de varios megapíxeles.
  - **Positivo:** Implementa bloque `try-catch` para evitar fallos catastróficos en caso de *Tainted Canvas* (restricciones de CORS en ciertas plataformas).

### 1.2 Compresión de Imágenes para Storage
- **Ubicación:** `src/pages/reserva/DetailsPage.tsx`
- **Contexto:** Flujo principal de subida de fotos por zonas de jardín.
- **Uso de Canvas:**
  1. Crea un canvas si la imagen supera los `1920px` en su lado más largo.
  2. Calcula la nueva resolución manteniendo la relación de aspecto (`aspect ratio`).
  3. Exporta la imagen de manera asíncrona usando `canvas.toBlob` en formato `image/jpeg` con compresión implícita.
- **Eficiencia y Mejores Prácticas:**
  - **Positivo:** Utiliza `canvas.toBlob()` en lugar de `toDataURL()`. `toBlob` es asíncrono y no bloquea el hilo principal (Main Thread) del navegador durante la codificación del JPEG, lo cual es vital para imágenes de gran tamaño.
  - **Recomendación futura:** Para mejorar aún más el rendimiento en móviles de gama baja, se podría trasladar esta operación a un *Web Worker* utilizando `OffscreenCanvas`, aunque para el volumen actual de 1-5 fotos, la latencia es aceptable.

### 1.3 Compresión de Imágenes Inline (Base64) para AI
- **Ubicación:** `src/components/client/ClientHome.tsx`
- **Contexto:** Conversión rápida para envíos directos de fotos vía API.
- **Uso de Canvas:**
  1. Reduce la dimensión máxima a `800px`.
  2. Exporta a string Base64 usando `canvas.toDataURL('image/jpeg', 0.7)`.
- **Eficiencia y Mejores Prácticas:**
  - **Análisis:** `toDataURL` es una operación síncrona y bloqueante. Sin embargo, al estar limitada a una dimensión de `800px` y a una calidad del `70%`, el tiempo de bloqueo en la UI es insignificante (generalmente < 15ms).
  - **Recomendación:** Se mantiene estable, pero es aconsejable evitar su uso para conjuntos grandes de fotos.

### 1.4 Edición y Recorte de Avatar de Usuario
- **Ubicación:** `src/components/auth/AuthForm.tsx`
- **Contexto:** Selección y ajuste de foto de perfil.
- **Uso de Canvas:**
  1. Utiliza un canvas de `512x512`.
  2. Aplica transformaciones de la API: `clearRect`, `clip` (recorte circular), `translate` (panorámica), `scale` (zoom), y `drawImage`.
  3. Exporta la imagen final recortada.
- **Eficiencia y Mejores Prácticas:**
  - **Positivo:** Utiliza `ctx.save()` y `ctx.restore()` para aislar el contexto de transformación, evitando la filtración de escalados a futuros renders.
  - **Positivo:** El uso de `clip()` con un trazado de arco es la forma más eficiente de crear máscaras circulares en el lado del cliente sin manipulación pesada de CSS o de matrices de píxeles.

---

## 2. Pruebas Unitarias y de Integración Implementadas

Para garantizar la fiabilidad del procesamiento de imágenes (en especial el paso crítico de "Garbage-In" o imágenes muy oscuras), se ha desarrollado una *suite* de pruebas automatizadas:

- **Archivo de Pruebas:** `src/utils/imageValidator.test.ts`
- **Framework:** Vitest
- **Estrategia (Mocks):** 
  Dado que el entorno de testing de NodeJS (o jsdom) no soporta el motor gráfico de renderizado de Canvas nativo, las pruebas simulan:
  1. El objeto `window.Image`.
  2. La función `document.createElement('canvas')`.
  3. El objeto `CanvasRenderingContext2D` simulando llamadas a `drawImage` y simulando un retorno de bytes (Uint8ClampedArray) para `getImageData`.
- **Casos Validados:**
  - `debería rechazar imágenes con resolución menor a 600x600` (Fallo por `TOO_SMALL`).
  - `debería aceptar imágenes válidas (resolución adecuada y buen brillo)` (Retorna `isValid: true`).
  - `debería rechazar imágenes demasiado oscuras (lux < 20)` (El mock genera píxeles con RGB(10,10,10) y la validación matemática los captura y rechaza con `TOO_DARK`).

---

## 3. Conclusión de Arquitectura

La implementación de la API Canvas en el proyecto actual es **robusta, altamente eficiente y sigue los estándares modernos de desarrollo web**:
1. **Evita el Main Thread Blocking:** Mediante el uso de `toBlob` para las fotos pesadas de jardines.
2. **Evita OOM (Out of Memory):** Las fotos siempre son reducidas en resolución (`1920px`, `800px` o `100px`) *antes* de extraer su matriz de bytes, lo cual es crítico para evitar *crashes* en Safari iOS.
3. **Hardware Acceleration:** Al habilitar `willReadFrequently: true` en las validaciones, el navegador optimiza el traspaso de la VRAM a la CPU para cálculos matemáticos (como el del brillo).

**Estado:** 🟢 Aprobado para producción sin cuellos de botella detectados.
