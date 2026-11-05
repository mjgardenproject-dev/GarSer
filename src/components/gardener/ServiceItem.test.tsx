// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import ServiceItem from './ServiceItem';

const service = { id: 's1', name: 'Poda de setos' } as never;
const base = { service, hasError: false, onToggle: vi.fn(), onConfigClick: vi.fn() };

describe('ServiceItem (fallo 7.1: el círculo mudo pasa a «Activar»)', () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it('sin configurar: botón «Activar» claro + pista «Primero configura tu precio con el engranaje»', () => {
    render(<ServiceItem {...base} isActive={false} canActivate={false} />);
    expect(screen.getByRole('button', { name: /primero hay que configurar su precio/ }).getAttribute('data-state')).toBe('locked');
    expect(screen.getByText('Primero configura tu precio con el engranaje')).toBeTruthy();
  });

  it('configurado y apagado: «Activar» oscuro + «Configurado. Falta activarlo»', () => {
    render(<ServiceItem {...base} isActive={false} canActivate />);
    expect(screen.getByRole('button', { name: 'Activar Poda de setos' }).getAttribute('data-state')).toBe('ready');
    expect(screen.getByText('Configurado. Falta activarlo')).toBeTruthy();
  });

  it('activo: verde «Activado»', () => {
    render(<ServiceItem {...base} isActive canActivate />);
    expect(screen.getByRole('button', { name: /activado/ }).getAttribute('data-state')).toBe('active');
    expect(screen.getByText('Activado: los clientes pueden reservarlo')).toBeTruthy();
  });

  it('el botón activa/desactiva y el engranaje abre la configuración, cada uno lo suyo', () => {
    render(<ServiceItem {...base} isActive={false} canActivate />);
    fireEvent.click(screen.getByRole('button', { name: 'Activar Poda de setos' }));
    expect(base.onToggle).toHaveBeenCalledTimes(1);
    expect(base.onConfigClick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Configurar el precio de Poda de setos' }));
    expect(base.onConfigClick).toHaveBeenCalledTimes(1);
    expect(base.onToggle).toHaveBeenCalledTimes(1);
  });
});
