// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isSessionGone, LIVENESS_INTERVAL_MS, LIVENESS_MIN_GAP_MS, startSessionLiveness } from './sessionLiveness';

const gone = { code: 'session_not_found', status: 403, message: 'Session from session_id claim in JWT does not exist' };
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('¿sigue viva la sesión? (PH-35)', () => {
  let stop: () => void = () => {};
  afterEach(() => { stop(); vi.useRealTimers(); });

  const setup = (getUser: () => Promise<{ error: typeof gone | null }>, session: unknown = { user: { id: 'u1' } }) => {
    let t = 1_000_000;
    const auth = { getSession: vi.fn(async () => ({ data: { session } })), getUser: vi.fn(getUser) };
    const onGone = vi.fn();
    stop = startSessionLiveness(auth, onGone, () => t);
    return { auth, onGone, advance: (ms: number) => { t += ms; } };
  };

  it('solo «esa sesión no existe» cuenta como cerrada; un fallo de red, no', () => {
    expect(isSessionGone(gone)).toBe(true);
    expect(isSessionGone({ code: '', status: 403, message: 'Session from session_id claim in JWT does not exist' })).toBe(true);
    expect(isSessionGone({ status: 0, message: 'Failed to fetch' })).toBe(false);
    expect(isSessionGone({ status: 401, message: 'JWT expired' })).toBe(false);
    expect(isSessionGone(null)).toBe(false);
  });

  it('al volver a la app con la sesión cerrada fuera, avisa (una vez por minuto como mucho)', async () => {
    const { onGone } = setup(async () => ({ error: gone }));
    window.dispatchEvent(new Event('focus'));
    await flush();
    window.dispatchEvent(new Event('pointerdown'));
    await flush();
    expect(onGone).toHaveBeenCalledTimes(1);
  });

  it('si vuelve a entrar sin recargar, vigila la sesión nueva', async () => {
    let t = 1_000_000;
    let session: unknown = { user: { id: 'u1' } };
    const auth = { getSession: vi.fn(async () => ({ data: { session } })), getUser: vi.fn(async () => ({ error: gone })) };
    const onGone = vi.fn(() => { session = null; });
    stop = startSessionLiveness(auth, onGone, () => t);
    window.dispatchEvent(new Event('focus'));
    await flush();
    t += LIVENESS_MIN_GAP_MS;
    window.dispatchEvent(new Event('focus'));
    await flush();
    expect(auth.getUser).toHaveBeenCalledTimes(1); // fuera, no se pregunta
    session = { user: { id: 'u1' } };
    t += LIVENESS_MIN_GAP_MS;
    window.dispatchEvent(new Event('focus'));
    await flush();
    expect(onGone).toHaveBeenCalledTimes(2);
  });

  it('con la sesión viva no hace nada, y no pregunta más de una vez por minuto', async () => {
    const { auth, onGone, advance } = setup(async () => ({ error: null }));
    window.dispatchEvent(new Event('focus'));
    await flush();
    window.dispatchEvent(new Event('keydown'));
    await flush();
    expect(auth.getUser).toHaveBeenCalledTimes(1);
    advance(LIVENESS_MIN_GAP_MS);
    window.dispatchEvent(new Event('pointerdown'));
    await flush();
    expect(auth.getUser).toHaveBeenCalledTimes(2);
    expect(onGone).not.toHaveBeenCalled();
  });

  it('sin sesión guardada no pregunta al servidor', async () => {
    const { auth } = setup(async () => ({ error: gone }), null);
    window.dispatchEvent(new Event('focus'));
    await flush();
    expect(auth.getUser).not.toHaveBeenCalled();
  });

  it('sin red no saca a nadie', async () => {
    const { onGone } = setup(async () => { throw new Error('Failed to fetch'); });
    window.dispatchEvent(new Event('online'));
    await flush();
    expect(onGone).not.toHaveBeenCalled();
  });

  it('también mira cada 5 minutos', async () => {
    vi.useFakeTimers();
    const { onGone } = setup(async () => ({ error: gone }));
    await vi.advanceTimersByTimeAsync(LIVENESS_INTERVAL_MS);
    expect(onGone).toHaveBeenCalledTimes(1);
  });
});
