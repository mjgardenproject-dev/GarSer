// Marketing del profesional: cortar un texto en líneas que caben en un ancho. La medida se inyecta
// (en el navegador, ctx.measureText) para poder probarlo sin canvas.

export function wrapText(text: string, maxWidth: number, measure: (value: string) => number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    // Una palabra más ancha que la caja va sola en su línea: el ajuste de tamaño la encoge.
    if (!line || measure(next) <= maxWidth) {
      line = next;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Recorta las líneas a `maxLines`, con «…» al final si sobra texto. */
export function clampLines(lines: string[], maxLines: number, maxWidth: number, measure: (value: string) => number): string[] {
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = `${kept[maxLines - 1]}…`;
  while (last.length > 1 && measure(last) > maxWidth) {
    last = `${last.slice(0, -2).trimEnd()}…`;
  }
  kept[maxLines - 1] = last;
  return kept;
}
