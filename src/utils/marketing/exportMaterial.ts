import { supabase } from '../../lib/supabase';
import type { MaterialId } from './materials';

// Marketing del profesional: compartir o descargar las imágenes ya dibujadas, y apuntar qué se
// descargó (para que el admin vea quién se promociona).

/** ¿El navegador puede mandar imágenes al menú de compartir (Instagram, WhatsApp, Fotos…)? */
export function canShareFiles(): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') {
    return false;
  }
  try {
    return navigator.canShare({ files: [new File([new Blob([''])], 'garser.png', { type: 'image/png' })] });
  } catch {
    return false;
  }
}

/** true si se compartió; false si la persona cerró el menú sin elegir nada. */
export async function shareFiles(files: File[], title: string): Promise<boolean> {
  try {
    await navigator.share({ files, title });
    return true;
  } catch (error) {
    if ((error as { name?: string })?.name === 'AbortError') return false;
    throw error;
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Una descarga por imagen, con una pausa entre ellas (si no, el navegador corta las siguientes). */
export async function downloadFiles(files: File[]): Promise<void> {
  for (const [index, file] of files.entries()) {
    if (index > 0) await wait(400);
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

/** Apunta la descarga. Si falla, no molesta: la descarga ya está hecha. */
export async function logMarketingDownload(material: MaterialId, formats: string[]): Promise<void> {
  try {
    await supabase.rpc('log_marketing_download', { p_material: material, p_formats: formats });
  } catch {
    // Solo es para medir.
  }
}
