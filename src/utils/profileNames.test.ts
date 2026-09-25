import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        or: async () => ({
          data: table === 'profiles'
            ? [
                { user_id: 'duena', full_name: 'Marta Dueña', phone: '600' },
                { user_id: 'autonomo', full_name: 'Miguel Ruiz', phone: '611' },
                { user_id: 'cliente', full_name: 'Laura Fernández', phone: '622' },
              ]
            : [],
          error: null,
        }),
        in: async () => ({
          data: table === 'public_gardener_directory'
            ? [
                { user_id: 'duena', full_name: 'Jardines Demo Costa' },
                { user_id: 'autonomo', full_name: 'Miguel Ángel Ruiz' },
              ]
            : [],
          error: null,
        }),
      }),
    }),
  },
}));

import { fetchProviderNames } from './profileNames';

describe('fetchProviderNames (GarSer Empresas F5.4, H-31)', () => {
  it('una empresa se ve con su nombre comercial, no con el de la persona del dueño', async () => {
    const names = await fetchProviderNames(['duena']);
    expect(names.duena.full_name).toBe('Jardines Demo Costa');
    expect(names.duena.phone).toBe('600');
  });

  it('un autónomo, con el nombre de su ficha; un cliente, con el de su perfil', async () => {
    const names = await fetchProviderNames(['autonomo', 'cliente', null]);
    expect(names.autonomo.full_name).toBe('Miguel Ángel Ruiz');
    expect(names.cliente.full_name).toBe('Laura Fernández');
  });
});
