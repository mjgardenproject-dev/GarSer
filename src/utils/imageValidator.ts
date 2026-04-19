/**
 * Validador Local de Imágenes antes de subir a Storage.
 * Comprueba resolución mínima y lux (iluminación básica) vía Canvas.
 */

export interface ValidationResult {
  isValid: boolean;
  reason?: 'TOO_SMALL' | 'TOO_DARK' | 'ERROR';
  details?: string;
}

export const validateImageLocal = async (file: File): Promise<ValidationResult> => {
  return new Promise((resolve) => {
    const img = new window.Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      
      // 1. Validar Resolución Mínima (800x600 o similar)
      const MIN_WIDTH = 600;
      const MIN_HEIGHT = 600;
      
      if (img.width < MIN_WIDTH || img.height < MIN_HEIGHT) {
        resolve({ isValid: false, reason: 'TOO_SMALL', details: `Resolution ${img.width}x${img.height} is below minimum ${MIN_WIDTH}x${MIN_HEIGHT}.` });
        return;
      }

      // 2. Validar Iluminación Básica (Lux/Histograma)
      const canvas = document.createElement('canvas');
      // Escalar la imagen para análisis rápido (100x100 es suficiente para brillo general)
      canvas.width = 100;
      canvas.height = 100;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      
      if (!ctx) {
        resolve({ isValid: false, reason: 'ERROR', details: 'Could not create canvas context.' });
        return;
      }

      ctx.drawImage(img, 0, 0, 100, 100);
      
      try {
        const imageData = ctx.getImageData(0, 0, 100, 100);
        const data = imageData.data;
        
        let r, g, b, avg;
        let colorSum = 0;
        
        for (let x = 0, len = data.length; x < len; x += 4) {
          r = data[x];
          g = data[x + 1];
          b = data[x + 2];
          
          // Brillo percibido (standard luma formula)
          avg = Math.floor((r * 299 + g * 587 + b * 114) / 1000);
          colorSum += avg;
        }

        const brightness = Math.floor(colorSum / (100 * 100));

        // Threshold de oscuridad extrema (configurable, 20 es casi negro)
        if (brightness < 20) {
           resolve({ isValid: false, reason: 'TOO_DARK', details: `Image brightness (${brightness}) is too low.` });
           return;
        }

        resolve({ isValid: true });
      } catch (e) {
        // En caso de CORS/Tainted Canvas, dejar pasar
        resolve({ isValid: true });
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ isValid: false, reason: 'ERROR', details: 'Failed to load image for validation.' });
    };

    img.src = url;
  });
};
