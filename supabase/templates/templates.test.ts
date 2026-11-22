import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const read = (name: string) => readFileSync(join(here, name), 'utf8');
const config = readFileSync(join(here, '..', 'config.toml'), 'utf8');

const TEMPLATES: Array<{ key: string; variable: string }> = [
  { key: 'confirmation', variable: '{{ .ConfirmationURL }}' },
  { key: 'recovery', variable: '{{ .ConfirmationURL }}' },
  { key: 'magic_link', variable: '{{ .ConfirmationURL }}' },
  { key: 'email_change', variable: '{{ .ConfirmationURL }}' },
  { key: 'invite', variable: '{{ .ConfirmationURL }}' },
  { key: 'reauthentication', variable: '{{ .Token }}' },
];

describe('plantillas de los correos de acceso (QA-039)', () => {
  it.each(TEMPLATES)('$key: en español, con la variable de Supabase y sin inglés', ({ key, variable }) => {
    const html = read(`${key}.html`);
    expect(html).toContain('<html lang="es">');
    expect(html).toContain(variable);
    expect(html).not.toMatch(/Confirm your|Reset (your )?password|Click (here|the link)|Follow this link|Magic Link|Confirm Your Signup/i);
    // Marca GarSer, sin restos de Supabase.
    expect(html).toContain('Gar');
    expect(html).not.toMatch(/supabase/i);
  });

  it.each(TEMPLATES)('$key: tiene asunto en español y apunta a su fichero en config.toml', ({ key }) => {
    const section = new RegExp(`\\[auth\\.email\\.template\\.${key}\\]\\s*subject = "([^"]+)"\\s*content_path = "\\./supabase/templates/${key}\\.html"`).exec(config);
    expect(section, `config.toml sin [auth.email.template.${key}]`).not.toBeNull();
    expect(section![1]).not.toMatch(/Confirm your|Reset your|You have been invited|Magic Link|Reauthentication/i);
  });
});
