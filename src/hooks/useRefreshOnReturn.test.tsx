// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRefreshOnReturn } from './useRefreshOnReturn';
import RefreshButton from '../components/common/RefreshButton';

const Probe = ({ fn, enabled = true }: { fn: () => unknown; enabled?: boolean }) => {
  useRefreshOnReturn(fn, { enabled });
  return null;
};
const setVisibility = (state: 'visible' | 'hidden') =>
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
const comeBack = () => { setVisibility('visible'); document.dispatchEvent(new Event('visibilitychange')); };

describe('useRefreshOnReturn (R-03)', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-28T20:00:00Z')); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('recarga al volver a la app, pero no dos veces en menos de 30 s', async () => {
    const fn = vi.fn();
    render(<Probe fn={fn} />);
    vi.advanceTimersByTime(31_000);
    await act(async () => { comeBack(); });
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    await act(async () => { comeBack(); });
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(25_000);
    await act(async () => { comeBack(); });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('al ocultarse no recarga, y desactivado tampoco', async () => {
    const fn = vi.fn();
    render(<Probe fn={fn} enabled={false} />);
    vi.advanceTimersByTime(31_000);
    await act(async () => { setVisibility('hidden'); document.dispatchEvent(new Event('visibilitychange')); });
    await act(async () => { comeBack(); });
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('RefreshButton (R-03)', () => {
  afterEach(() => cleanup());

  it('llama a la carga, se desactiva mientras carga y no admite doble toque', async () => {
    vi.useRealTimers();
    let resolve: () => void = () => undefined;
    const fn = vi.fn(() => new Promise<void>((r) => { resolve = r; }));
    render(<RefreshButton onRefresh={fn} />);
    const button = screen.getByRole('button', { name: 'Actualizar' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(fn).toHaveBeenCalledTimes(1);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { resolve(); });
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });
});
