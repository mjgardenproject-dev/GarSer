// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const query = vi.hoisted(() => ({ rows: [] as Array<{ gardener_response: string | null }>, calls: [] as unknown[][] }));

vi.mock('../../lib/supabase', () => {
  const builder: Record<string, unknown> = {};
  const chain = (name: string) => (...args: unknown[]) => { query.calls.push([name, ...args]); return builder; };
  builder.select = chain('select');
  builder.eq = chain('eq');
  builder.in = (...args: unknown[]) => { query.calls.push(['in', ...args]); return Promise.resolve({ data: query.rows, error: null }); };
  return { supabase: { from: (table: string) => { query.calls.push(['from', table]); return builder; } } };
});

import OpenIncidentsNotice from './OpenIncidentsNotice';

const renderNotice = () => render(<MemoryRouter><OpenIncidentsNotice userId="pro-1" /></MemoryRouter>);

describe('OpenIncidentsNotice (QA-192)', () => {
  afterEach(() => {
    cleanup();
    query.rows = [];
    query.calls = [];
  });

  it('avisa de la incidencia abierta que aún no tiene su versión', async () => {
    query.rows = [{ gardener_response: null }];
    renderNotice();
    expect(await screen.findByText('Un cliente ha abierto una incidencia sobre tu trabajo')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Contar mi versión' })).toBeTruthy();
    // Solo las de SUS reservas, abiertas por el cliente y sin cerrar.
    expect(query.calls).toContainEqual(['from', 'booking_incidents']);
    expect(query.calls).toContainEqual(['eq', 'bookings.gardener_id', 'pro-1']);
    expect(query.calls).toContainEqual(['eq', 'reporter_role', 'client']);
    expect(query.calls).toContainEqual(['in', 'status', ['open', 'in_review']]);
  });

  it('cuenta varias y no avisa de las que ya respondió', async () => {
    query.rows = [{ gardener_response: null }, { gardener_response: 'Mi versión' }, { gardener_response: null }];
    renderNotice();
    expect(await screen.findByText('Tienes 2 incidencias abiertas sobre tus trabajos')).toBeTruthy();
  });

  it('sin incidencias pendientes no pinta nada', async () => {
    query.rows = [{ gardener_response: 'Ya respondí' }];
    const { container } = renderNotice();
    await waitFor(() => expect(query.calls.length).toBeGreaterThan(0));
    expect(container.textContent).toBe('');
  });
});
