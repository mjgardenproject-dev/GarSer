// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import GarserLogo from './GarserLogo';

afterEach(cleanup);

const publicFile = (src: string) => resolve(process.cwd(), 'public', src.replace(/^\//, ''));

describe('GarserLogo', () => {
  it('pinta el logo vectorial (SVG) y el archivo existe en public/', () => {
    render(<GarserLogo />);
    const img = screen.getByRole('img', { name: /GarSer\.es/i });
    const src = img.getAttribute('src') ?? '';

    expect(src).toBe('/garser-logo.svg');
    expect(existsSync(publicFile(src))).toBe(true);
  });

  it('el SVG no tiene fondo: solo trazados, sin rectángulos, imágenes ni texto', () => {
    // «Sin fondo» y «vectorial» son justo lo que pidió el dueño: si alguien lo re-exporta con un
    // fondo blanco (o con letras como <text>, que dependerían de la fuente instalada), este test avisa.
    const svg = readFileSync(publicFile('/garser-logo.svg'), 'utf8');

    expect(svg).toMatch(/<svg[^>]*viewBox="0 0 1000 215\.09"/);
    expect(svg).toMatch(/<path /);
    expect(svg).not.toMatch(/<(rect|image|text|circle|ellipse|style|foreignObject)\b/i);
    expect(svg).not.toMatch(/background/i);
  });

  it('reserva el hueco (anchura y altura) para que la página no salte al cargarlo', () => {
    render(<GarserLogo className="h-8 w-auto" />);
    const img = screen.getByRole('img', { name: /GarSer\.es/i });

    expect(img.getAttribute('width')).toBe('1000');
    expect(img.getAttribute('height')).toBe('215');
    expect(img.className).toBe('h-8 w-auto');
  });

  it('si la imagen falla, enseña el nombre en texto', () => {
    render(<GarserLogo textClassName="texto-de-respaldo" />);
    fireEvent.error(screen.getByRole('img', { name: /GarSer\.es/i }));

    expect(screen.queryByRole('img')).toBeNull();
    const fallback = screen.getByText('GarSer');
    expect(fallback.className).toBe('texto-de-respaldo');
    expect(fallback.textContent).toBe('GarSer.es');
  });
});
