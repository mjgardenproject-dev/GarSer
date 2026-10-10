import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Pendiente PH-03 (decisión del usuario): lo que lee el CLIENTE dice «profesional», porque quien
// hace el trabajo puede ser un autónomo o una empresa. El panel y el alta del propio jardinero
// siguen diciendo «jardinero» (no están en esta lista). Esta prueba vigila que no vuelva a colarse
// en un texto visible: mira cadenas y texto JSX, no comentarios ni nombres de variables.
const CLIENT_FILES = [
  'src/pages/reserva/AddressPage.tsx',
  'src/pages/reserva/DetailsPage.tsx',
  'src/pages/reserva/ProvidersPage.tsx',
  'src/pages/reserva/ConfirmationPage.tsx',
  'src/components/client/BookingsList.tsx',
  'src/components/client/ClientBookingLauncher.tsx',
  'src/components/chat/ChatList.tsx',
  'src/components/public/GardenerPublicProfile.tsx',
];

// Los bloques de comentario se vacían (conservando los saltos de línea para los números).
const withoutBlockComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '));

const visibleJardinero = (source: string) =>
  withoutBlockComments(source)
    .split('\n')
    .map((line, i) => ({ line: line.trim(), n: i + 1 }))
    .filter(({ line }) => !/^(\/\/|\*|\/\*|\{\/\*)/.test(line))
    .filter(({ line }) => /(['"`>]|^)[^'"`<{}]*\bjardiner(o|a|os|as)\b/i.test(line))
    .map(({ line, n }) => `${n}: ${line}`);

describe('textos para el cliente: «profesional», no «jardinero» (PH-03)', () => {
  it.each(CLIENT_FILES)('%s', (file) => {
    const source = readFileSync(resolve(process.cwd(), file), 'utf8');
    expect(visibleJardinero(source)).toEqual([]);
  });

  it('los botones y el resumen de la reserva', () => {
    const providers = readFileSync(resolve(process.cwd(), 'src/pages/reserva/ProvidersPage.tsx'), 'utf8');
    const confirmation = readFileSync(resolve(process.cwd(), 'src/pages/reserva/ConfirmationPage.tsx'), 'utf8');
    expect(providers).toContain("'Confirmar profesional'");
    expect(providers).toContain("'Selecciona un profesional'");
    expect(confirmation).toContain('<p className="font-medium text-gray-900">Profesional</p>');
  });

  it('el aviso del rango alto de palmeras', () => {
    const core = readFileSync(resolve(process.cwd(), 'src/shared/bookingQuoteCore.ts'), 'utf8');
    expect(core).toContain('el profesional puede ajustar el importe');
  });
});
