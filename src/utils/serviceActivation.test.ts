// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const v = vi.hoisted(() => ({
  lawn: vi.fn(), palm: vi.fn(), hedge: vi.fn(), tree: vi.fn(), shrub: vi.fn(), weeding: vi.fn(), phyto: vi.fn(),
}));
const db = vi.hoisted(() => ({
  prices: [] as Array<{ service_id: string; active: boolean | null; additional_config: unknown }>,
  services: [] as Array<{ id: string; name: string }>,
  updates: [] as Array<{ table: string; patch: unknown; filters: Record<string, unknown> }>,
  updatedRows: [{ service_id: 's1' }] as Array<{ service_id: string }>,
  failAt: '' as string,
}));

vi.mock('./serviceValidation', () => ({
  isLawnConfigValid: v.lawn, isPalmConfigValid: v.palm, isHedgeConfigValid: v.hedge, isTreePruningConfigValid: v.tree,
  isShrubConfigValid: v.shrub, isWeedingConfigValid: v.weeding, isPhytosanitaryConfigValid: v.phyto,
}));
vi.mock('./phytosanitaryConfig', () => ({
  normalizePhytosanitaryPricingConfig: (c: unknown) => ({ normalized: c }),
  ensurePhytosanitaryPersistedConfig: (c: unknown) => ({ persisted: c }),
}));
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const state: { patch?: unknown; filters: Record<string, unknown>; select?: boolean } = { filters: {} };
      const chain: any = {
        select: (cols?: string) => { state.select = true; if (table === 'services') return Promise.resolve({ data: db.services, error: null }); void cols; return chain; },
        update: (patch: unknown) => { state.patch = patch; return chain; },
        eq: (col: string, val: unknown) => { state.filters[col] = val; return chain; },
        then: (resolve: (r: unknown) => unknown) => {
          if (state.patch !== undefined) {
            db.updates.push({ table, patch: state.patch, filters: state.filters });
            if (db.failAt === table) return resolve({ data: null, error: { message: 'boom' } });
            return resolve({ data: table === 'gardener_service_prices' && !state.select ? null : db.updatedRows, error: null });
          }
          return resolve({ data: table === 'gardener_service_prices' ? db.prices.filter((p) => state.filters.active === undefined || p.active === state.filters.active) : [], error: null });
        },
      };
      // `update(...).eq().eq().select(...)` también debe devolver filas
      const origSelect = chain.select;
      chain.select = (cols?: string) => {
        if (state.patch !== undefined) { state.select = true; return chain; }
        return origSelect(cols);
      };
      return chain;
    },
  },
}));

import { isSavedServiceConfigValid, loadServiceActivation, serviceActivationState, setServiceActive } from './serviceActivation';

describe('isSavedServiceConfigValid', () => {
  beforeEach(() => { Object.values(v).forEach((fn) => fn.mockReset().mockReturnValue(true)); });

  it('usa el validador de CADA servicio, con su nombre exacto', () => {
    const cfg = { a: 1 };
    expect(isSavedServiceConfigValid('Corte de césped', cfg)).toBe(true);
    expect(v.lawn).toHaveBeenCalledWith(cfg);
    isSavedServiceConfigValid('Poda de palmeras', cfg); expect(v.palm).toHaveBeenCalledWith(cfg);
    isSavedServiceConfigValid('Poda de setos', cfg); expect(v.hedge).toHaveBeenCalledWith(cfg);
    isSavedServiceConfigValid('Poda de árboles', cfg); expect(v.tree).toHaveBeenCalledWith(cfg);
    isSavedServiceConfigValid('Poda de plantas y arbustos', cfg); expect(v.shrub).toHaveBeenCalledWith(cfg);
    isSavedServiceConfigValid('Desbroce de malas hierbas', cfg); expect(v.weeding).toHaveBeenCalledWith(cfg);
  });

  it('fitosanitarios se normaliza como lo hace «Mi perfil» antes de validar', () => {
    isSavedServiceConfigValid('Servicios fitosanitarios', { raw: true });
    expect(v.phyto).toHaveBeenCalledWith({ persisted: { normalized: { raw: true } } });
  });

  it('sin configuración, o servicio desconocido: no se puede activar', () => {
    expect(isSavedServiceConfigValid('Corte de césped', null)).toBe(false);
    expect(isSavedServiceConfigValid('Corte de césped', undefined)).toBe(false);
    expect(isSavedServiceConfigValid('Servicio inventado', { a: 1 })).toBe(false);
    expect(v.lawn).not.toHaveBeenCalled();
  });

  it('un validador que dice que no, es que no', () => {
    v.lawn.mockReturnValue(false);
    expect(isSavedServiceConfigValid('Corte de césped', { a: 1 })).toBe(false);
  });
});

describe('serviceActivationState', () => {
  it('activo gana a todo; si no, configurado = ready; si no, locked', () => {
    expect(serviceActivationState(true, false)).toBe('active');
    expect(serviceActivationState(true, true)).toBe('active');
    expect(serviceActivationState(false, true)).toBe('ready');
    expect(serviceActivationState(false, false)).toBe('locked');
  });
});

describe('loadServiceActivation', () => {
  beforeEach(() => {
    Object.values(v).forEach((fn) => fn.mockReset().mockReturnValue(true));
    db.services = [{ id: 's1', name: 'Poda de setos' }, { id: 's2', name: 'Corte de césped' }];
    db.prices = [
      { service_id: 's1', active: false, additional_config: { ok: 1 } },
      { service_id: 's2', active: true, additional_config: { ok: 2 } },
      { service_id: 'zzz', active: false, additional_config: {} }, // servicio que ya no existe: se ignora
    ];
  });

  it('lista los servicios con fila de precios, con su estado, ordenados por nombre', async () => {
    v.hedge.mockReturnValue(false); // setos a medias
    const list = await loadServiceActivation('prov-1');
    expect(list).toEqual([
      { id: 's2', name: 'Corte de césped', active: true, canActivate: true },
      { id: 's1', name: 'Poda de setos', active: false, canActivate: false },
    ]);
  });
});

describe('setServiceActive', () => {
  beforeEach(() => {
    db.updates = [];
    db.updatedRows = [{ service_id: 's1' }];
    db.failAt = '';
    db.prices = [{ service_id: 's1', active: true, additional_config: {} }];
  });

  it('cambia SOLO la columna `active` (no toca la configuración) y deja al día la ficha', async () => {
    await setServiceActive('prov-1', 's1', true);
    const first = db.updates[0];
    expect(first.table).toBe('gardener_service_prices');
    expect(first.patch).toEqual({ active: true });
    expect(first.filters).toMatchObject({ gardener_id: 'prov-1', service_id: 's1' });
    const profile = db.updates.find((u) => u.table === 'gardener_profiles');
    expect(profile?.patch).toEqual({ services: ['s1'] });
    expect(profile?.filters).toMatchObject({ user_id: 'prov-1' });
  });

  it('si el servicio no tiene precios guardados, lanza (no se inventa una fila)', async () => {
    db.updatedRows = [];
    await expect(setServiceActive('prov-1', 's1', true)).rejects.toThrow('todavía no tiene precios guardados');
    expect(db.updates.find((u) => u.table === 'gardener_profiles')).toBeUndefined();
  });

  it('un fallo de la base se propaga', async () => {
    db.failAt = 'gardener_service_prices';
    await expect(setServiceActive('prov-1', 's1', false)).rejects.toBeTruthy();
  });
});
