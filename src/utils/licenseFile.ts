// El archivo del carnet fitosanitario antes de subirlo (2026-10-20).
//
// Desde el móvil lo normal es una foto (o dos: el carnet tiene dos caras). Las fotos se pasan a un
// único JPEG de tamaño razonable: se sube rápido con datos móviles, el admin lo ve entero y las
// fotos HEIC del iPhone quedan en un formato que todos los navegadores abren. Un PDF se sube tal
// cual. El servidor (almacén y submit_phyto_license) vuelve a comprobar tipo, tamaño y ruta.

import { LICENSE_MAX_BYTES } from '../shared/phytoLicense';

export const LICENSE_PDF_TYPE = 'application/pdf';
/** Lado más largo de cada cara: el texto del carnet se lee de sobra. */
const MAX_SIDE = 2000;
const JPEG_QUALITY = 0.85;

export type LicenseDraftKind = 'pdf' | 'image';

/** Si un archivo elegido sirve; el mensaje explica qué hacer si no. */
export function checkLicenseFile(file: File, current: { images: number; hasPdf: boolean }): string | null {
  const isPdf = file.type === LICENSE_PDF_TYPE || /\.pdf$/i.test(file.name);
  const isImage = file.type.startsWith('image/') || /\.(jpe?g|png|heic|heif|webp)$/i.test(file.name);
  if (!isPdf && !isImage) return 'Ese archivo no vale: sube una foto (JPG o PNG) o un PDF.';
  if (isPdf && file.size > LICENSE_MAX_BYTES) return 'El PDF pesa más de 10 MB. Escanéalo con menos calidad o haz una foto.';
  if (!isPdf && file.size > 40 * 1024 * 1024) return 'La foto es demasiado grande. Haz otra con la cámara.';
  if (isImage && current.images >= 2) return 'Ya has puesto las dos caras.';
  return null;
}

export function isPdfFile(file: File): boolean {
  return file.type === LICENSE_PDF_TYPE || /\.pdf$/i.test(file.name);
}

/** `<titular>/<aleatorio>.<ext>`: la carpeta es la del titular (la exige el servidor). */
export function licenseObjectPath(holderId: string, ext: 'pdf' | 'jpg'): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '')
    : Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${holderId}/${random}.${ext}`;
}

/** Huella SHA-256 del archivo que se sube (queda en el carnet como prueba de qué se envió). */
export async function sha256Hex(blob: Blob): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

async function decode(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } catch {
    throw new Error('No podemos abrir esa foto. Hazla otra vez con la cámara o súbela en JPG, PNG o PDF.');
  } finally {
    // La imagen ya está decodificada: la URL no hace falta.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('No se ha podido preparar la foto.'))), 'image/jpeg', quality);
  });
}

/**
 * Lo que se sube: el PDF tal cual, o las fotos (una o dos caras, una debajo de otra) en un JPEG.
 */
export async function prepareLicenseUpload(files: File[]): Promise<{ file: File; ext: 'pdf' | 'jpg' }> {
  if (files.length === 1 && isPdfFile(files[0])) {
    const pdf = files[0];
    if (pdf.size > LICENSE_MAX_BYTES) throw new Error('El PDF pesa más de 10 MB.');
    return { file: pdf.type === LICENSE_PDF_TYPE ? pdf : new File([pdf], pdf.name, { type: LICENSE_PDF_TYPE }), ext: 'pdf' };
  }
  const images = await Promise.all(files.slice(0, 2).map(decode));
  const scaled = images.map((img) => {
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    return { img, w: Math.round(img.naturalWidth * scale), h: Math.round(img.naturalHeight * scale) };
  });
  const width = Math.max(...scaled.map((s) => s.w));
  const gap = scaled.length > 1 ? 24 : 0;
  const height = scaled.reduce((sum, s) => sum + s.h, 0) + gap;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se ha podido preparar la foto.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  let y = 0;
  for (const s of scaled) {
    ctx.drawImage(s.img, Math.round((width - s.w) / 2), y, s.w, s.h);
    y += s.h + gap;
  }
  let blob = await toJpeg(canvas, JPEG_QUALITY);
  if (blob.size > LICENSE_MAX_BYTES) blob = await toJpeg(canvas, 0.6);
  if (blob.size > LICENSE_MAX_BYTES) throw new Error('La foto pesa demasiado. Hazla otra vez con la cámara.');
  return { file: new File([blob], 'carnet.jpg', { type: 'image/jpeg' }), ext: 'jpg' };
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}
