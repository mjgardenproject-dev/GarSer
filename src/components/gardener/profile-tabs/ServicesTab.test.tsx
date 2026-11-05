// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), custom: vi.fn(), dismiss: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: toast }));
vi.mock('../../common/SlideOver', () => ({
  default: ({ isOpen, title, headerActions, children }: { isOpen: boolean; title: string; headerActions?: React.ReactNode; children?: React.ReactNode }) =>
    (isOpen ? <div role="dialog"><span>{title}</span>{headerActions}{children}</div> : null),
}));
for (const name of ['Palm', 'Lawn', 'Shrub', 'Phytosanitary', 'Weeding']) {
  vi.mock(`../${name}PricingConfigurator`, () => ({ default: () => null }));
}
// El configurador de setos simula uno con cambios, cuyo guardado sale bien.
vi.mock('../HedgePricingConfigurator', async () => {
  const React = await import('react');
  return {
    default: ({ registerSave, onDirtyChange }: { registerSave: (fn: () => Promise<string>) => void; onDirtyChange: (d: boolean) => void }) => {
      // Se registra un instante después: ServicesTab limpia el registro al abrir otro servicio y los
      // configuradores de verdad se vuelven a registrar al cambiar su valor.
      React.useEffect(() => {
        const id = setTimeout(() => { registerSave(async () => 'success'); onDirtyChange(true); }, 0);
        return () => clearTimeout(id);
      }, []);
      return <div>configurador de setos</div>;
    },
  };
});
vi.mock('../TreePruningConfigurator', () => ({ default: () => null }));
vi.mock('../../common/ResetOptionsModal', () => ({ default: () => null }));

import ServicesTab from './ServicesTab';

const services = [
  { id: 's-lawn', name: 'Corte de césped' },
  { id: 's-hedge', name: 'Poda de setos' },
  { id: 's-tree', name: 'Poda de árboles' },
];

const renderTab = (props: Partial<React.ComponentProps<typeof ServicesTab>> = {}) => {
  const handlers = { handleToggleService: vi.fn(), handleExpand: vi.fn() };
  render(
    <ServicesTab
      sortedServices={services}
      watchedServices={['s-lawn']}
      expandedServiceId={null}
      handleWrapperSave={vi.fn()}
      configs={{} as never}
      setConfigs={{} as never}
      savedConfigs={{}}
      licenseStatus={null}
      onGoToLicense={vi.fn()}
      canActivateService={(id) => id !== 's-tree'}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
};

describe('ServicesTab · botón «Activar» (fallo 7.1)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it('cada servicio enseña su estado: activado (verde), configurado (oscuro) o sin configurar (claro)', () => {
    renderTab();
    expect(screen.getByRole('button', { name: /Corte de césped: activado/ }).getAttribute('data-state')).toBe('active');
    expect(screen.getByRole('button', { name: 'Activar Poda de setos' }).getAttribute('data-state')).toBe('ready');
    expect(screen.getByRole('button', { name: /Poda de árboles: primero hay que configurar/ }).getAttribute('data-state')).toBe('locked');
  });

  it('un servicio configurado se activa con un toque', () => {
    const { handleToggleService } = renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Activar Poda de setos' }));
    expect(handleToggleService).toHaveBeenCalledWith('s-hedge');
  });

  it('uno activado se desactiva con un toque', () => {
    const { handleToggleService } = renderTab();
    fireEvent.click(screen.getByRole('button', { name: /Corte de césped: activado/ }));
    expect(handleToggleService).toHaveBeenCalledWith('s-lawn');
  });

  it('uno sin configurar NO se activa: explica y abre su configuración', () => {
    const { handleToggleService, handleExpand } = renderTab();
    fireEvent.click(screen.getByRole('button', { name: /Poda de árboles: primero hay que configurar/ }));
    expect(handleToggleService).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('Primero configura el precio de Poda de árboles.', expect.anything());
    expect(handleExpand).toHaveBeenCalledWith('s-tree');
    expect(screen.getByRole('dialog').textContent).toContain('Configurar Poda de árboles');
  });

  it('el engranaje abre la configuración sin activar nada', () => {
    const { handleToggleService } = renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Configurar el precio de Poda de setos' }));
    expect(handleToggleService).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog').textContent).toContain('Configurar Poda de setos');
  });

  describe('«Precio guardado. ¿Activas X ahora?»', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    const saveHedge = async (props: Partial<React.ComponentProps<typeof ServicesTab>> = {}) => {
      const handlers = renderTab(props);
      fireEvent.click(screen.getByRole('button', { name: 'Configurar el precio de Poda de setos' }));
      await act(async () => { vi.advanceTimersByTime(10); });
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' })); });
      await act(async () => { vi.advanceTimersByTime(300); });
      return handlers;
    };

    it('tras guardar un precio válido de un servicio apagado, ofrece activarlo', async () => {
      await saveHedge();
      expect(toast.custom).toHaveBeenCalledTimes(1);
      expect(toast.custom.mock.calls[0][1]).toMatchObject({ id: 'offer-activate-s-hedge' });
    });

    it('el botón «Activar» del aviso activa ese servicio', async () => {
      const { handleToggleService } = await saveHedge();
      const element = toast.custom.mock.calls[0][0]({ id: 't-1' });
      render(element);
      expect(screen.getAllByText(/Precio guardado/).length).toBeGreaterThan(0);
      fireEvent.click(screen.getAllByRole('button', { name: 'Activar' }).pop() as HTMLElement);
      expect(toast.dismiss).toHaveBeenCalledWith('t-1');
      expect(handleToggleService).toHaveBeenCalledWith('s-hedge');
    });

    it('si el servicio ya estaba activo, no se ofrece nada', async () => {
      await saveHedge({ watchedServices: ['s-lawn', 's-hedge'] });
      expect(toast.custom).not.toHaveBeenCalled();
    });

    it('si el precio guardado todavía no vale para activar, no se ofrece (no se promete lo que fallaría)', async () => {
      await saveHedge({ canActivateService: () => false });
      expect(toast.custom).not.toHaveBeenCalled();
    });
  });
});
