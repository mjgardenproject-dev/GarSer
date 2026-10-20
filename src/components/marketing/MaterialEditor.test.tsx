// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(async () => ({ data: 1, error: null })),
  renderMaterial: vi.fn(async () => undefined),
  renderToBlob: vi.fn(async () => new Blob(['png'], { type: 'image/png' })),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

vi.mock('../../lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock('react-hot-toast', () => ({ default: mocks.toast }));
vi.mock('../../utils/marketing/renderMaterial', () => ({
  renderMaterial: mocks.renderMaterial,
  renderToBlob: mocks.renderToBlob,
  loadImage: async () => null,
}));

import MaterialEditor from './MaterialEditor';
import { getMaterial } from '../../utils/marketing/materials';
import { defaultOptions, type MarketingOptions, type MarketingProfile } from '../../utils/marketing/content';

const profile: MarketingProfile = {
  providerId: 'prov-1', name: 'Pablo Gómez', kind: 'solo', zone: 'Marbella', avatarUrl: null, ratingAverage: 4.5, ratingCount: 2,
};
const visible = ['Corte de césped', 'Poda de setos'];

function renderEditor(overrides: Partial<React.ComponentProps<typeof MaterialEditor>> = {}) {
  let options: MarketingOptions = defaultOptions(profile, visible, new Date('2026-10-20'));
  const onOptionsChange = vi.fn((next: MarketingOptions) => {
    options = next;
  });
  const utils = render(
    <MaterialEditor
      material={getMaterial('social')}
      profile={profile}
      visibleServices={visible}
      feeWaiverEnabled={false}
      canDownload
      avatar={null}
      options={options}
      onOptionsChange={onOptionsChange}
      onBack={vi.fn()}
      onCompleteAccount={vi.fn()}
      {...overrides}
    />,
  );
  return { ...utils, onOptionsChange, getOptions: () => options };
}

describe('MaterialEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
  });
  afterEach(() => {
    cleanup();
    Object.assign(navigator, { share: undefined, canShare: undefined });
  });

  it('cambiar estilo, titular y servicios avisa del cambio', () => {
    const { onOptionsChange } = renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Claro' }));
    expect(onOptionsChange).toHaveBeenLastCalledWith(expect.objectContaining({ theme: 'light' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tu jardín, en buenas manos' }));
    expect(onOptionsChange).toHaveBeenLastCalledWith(expect.objectContaining({ headline: 'Tu jardín, en buenas manos' }));
    fireEvent.change(screen.getByPlaceholderText('O escribe el tuyo'), { target: { value: 'Jardines de 10' } });
    expect(onOptionsChange).toHaveBeenLastCalledWith(expect.objectContaining({ headline: 'Jardines de 10' }));
    fireEvent.click(screen.getByRole('button', { name: /Poda de setos/ }));
    expect(onOptionsChange).toHaveBeenLastCalledWith(expect.objectContaining({ services: ['Corte de césped'] }));
  });

  it('sin aparecer a los clientes no se puede abrir la descarga', () => {
    const onCompleteAccount = vi.fn();
    renderEditor({ canDownload: false, onCompleteAccount });
    expect((screen.getByRole('button', { name: /Compartir o descargar/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Completar mi cuenta' }));
    expect(onCompleteAccount).toHaveBeenCalled();
  });

  it('descarga varios tamaños a la vez, un PNG por tamaño, y lo apunta', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    renderEditor();
    fireEvent.click(screen.getByRole('button', { name: /Compartir o descargar/ }));
    expect(screen.getByRole('dialog', { name: 'Elige los tamaños' })).toBeTruthy();
    // Viene marcado el de la vista previa (vertical); se añade la historia.
    fireEvent.click(screen.getByRole('checkbox', { name: /Historia/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Descargar 2 imágenes' }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(2), { timeout: 3000 });
    expect(mocks.renderToBlob).toHaveBeenCalledTimes(2);
    expect(mocks.rpc).toHaveBeenCalledWith('log_marketing_download', { p_material: 'social', p_formats: ['portrait', 'story'] });
    click.mockRestore();
  });

  it('con el menú de compartir del móvil, manda todas las imágenes juntas', async () => {
    const share = vi.fn(async () => undefined);
    Object.assign(navigator, { share, canShare: () => true });
    renderEditor();
    fireEvent.click(screen.getByRole('button', { name: /Compartir o descargar/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Cuadrada/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Compartir' }));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const files = (share.mock.calls[0] as unknown as [{ files: File[] }])[0].files;
    expect(files.map((f) => f.name)).toEqual(['garser-pablo-gomez-flyer-portrait.png', 'garser-pablo-gomez-flyer-square.png']);
    expect(files.every((f) => f.type === 'image/png')).toBe(true);
  });

  it('copia el texto para la publicación', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderEditor();
    fireEvent.click(screen.getByRole('button', { name: /Copiar texto para la publicación/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect((writeText.mock.calls[0] as unknown as [string])[0]).toContain('https://garser.es/reservar/prov-1?utm_source=instagram');
  });
});
