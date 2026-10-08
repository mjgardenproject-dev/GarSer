// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const single = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabase', () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ single }) }) }) },
}));

import { useServiceName } from './useServiceName';
import {
  getKnownServiceName,
  loadServiceName,
  normalizeServiceDisplayName,
  rememberServiceNames,
  resetServiceNameCatalog,
} from '../utils/serviceNameCatalog';

const renders: Array<{ name: string; status: string }> = [];
let retry: () => void = () => {};
const Probe = ({ id }: { id: string }) => {
  const state = useServiceName(id);
  renders.push({ name: state.name, status: state.status });
  retry = state.retry;
  return <p>{`${state.status}:${state.name}`}</p>;
};

describe('serviceNameCatalog', () => {
  beforeEach(() => {
    resetServiceNameCatalog();
    single.mockReset();
  });

  it('normaliza el nombre antiguo de fitosanitarios', () => {
    expect(normalizeServiceDisplayName('Fumigación y tratamientos')).toBe('Servicios fitosanitarios');
    expect(normalizeServiceDisplayName('Corte de césped')).toBe('Corte de césped');
  });

  it('guarda lo que carga «Servicios» y comparte las peticiones simultáneas', async () => {
    rememberServiceNames([{ id: 'a', name: 'Fumigación' }, { id: 'b', name: '' }, { id: 3, name: 'x' }]);
    expect(getKnownServiceName('a')).toBe('Servicios fitosanitarios');
    expect(getKnownServiceName('b')).toBeUndefined();

    single.mockResolvedValue({ data: { name: 'Poda de setos' }, error: null });
    const [first, second] = await Promise.all([loadServiceName('c'), loadServiceName('c')]);
    expect([first, second]).toEqual(['Poda de setos', 'Poda de setos']);
    expect(single).toHaveBeenCalledTimes(1);
    await loadServiceName('c');
    expect(single).toHaveBeenCalledTimes(1);
  });
});

describe('useServiceName', () => {
  beforeEach(() => {
    resetServiceNameCatalog();
    single.mockReset();
    renders.length = 0;
  });
  afterEach(() => cleanup());

  it('si «Servicios» ya lo cargó, está listo desde el primer render (sin parpadeo)', () => {
    rememberServiceNames([{ id: 'svc', name: 'Corte de césped' }]);
    render(<Probe id="svc" />);
    expect(renders[0]).toEqual({ name: 'Corte de césped', status: 'ready' });
    expect(single).not.toHaveBeenCalled();
  });

  it('si no, «loading» (nunca un nombre vacío como si estuviera listo) y después el nombre', async () => {
    single.mockResolvedValue({ data: { name: 'Poda de palmeras' }, error: null });
    render(<Probe id="svc" />);
    expect(renders[0]).toEqual({ name: '', status: 'loading' });
    await screen.findByText('ready:Poda de palmeras');
    expect(renders.some((r) => r.status === 'ready' && r.name === '')).toBe(false);
  });

  it('si falla, «error» y «Reintentar» vuelve a pedirlo', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    single.mockResolvedValueOnce({ data: null, error: new Error('red') });
    render(<Probe id="svc" />);
    await screen.findByText('error:');
    single.mockResolvedValueOnce({ data: { name: 'Poda de árboles' }, error: null });
    await act(async () => retry());
    await screen.findByText('ready:Poda de árboles');
  });

  it('descarta la respuesta tardía de un servicio que ya no es el activo', async () => {
    let resolveOld: (value: unknown) => void = () => {};
    single.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    const { rerender } = render(<Probe id="old" />);
    rememberServiceNames([{ id: 'new', name: 'Poda de setos' }]);
    rerender(<Probe id="new" />);
    expect(screen.getByText('ready:Poda de setos')).toBeTruthy();
    await act(async () => resolveOld({ data: { name: 'Corte de césped' }, error: null }));
    expect(screen.getByText('ready:Poda de setos')).toBeTruthy();
  });
});
