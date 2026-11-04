// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CommissionSettings as Settings } from '../../config/commissionSettings';

const mocks = vi.hoisted(() => ({
  fetchCommissionSettings: vi.fn(),
  saveCommissionSettings: vi.fn(),
  fetchCommissionAudit: vi.fn(),
}));

vi.mock('../../config/commissionSettings', async () => {
  const actual = await vi.importActual<typeof import('../../config/commissionSettings')>('../../config/commissionSettings');
  return {
    ...actual,
    fetchCommissionSettings: mocks.fetchCommissionSettings,
    saveCommissionSettings: mocks.saveCommissionSettings,
    fetchCommissionAudit: mocks.fetchCommissionAudit,
  };
});

import { CommissionSettingsError } from '../../config/commissionSettings';
import CommissionSettingsPage from './CommissionSettings';

const settings = (overrides: Partial<Settings> = {}): Settings => ({
  version: 4,
  rates: { garser_first: 12.5, link_first: 0, garser_repeat: 3, maintenance_visit: 3, link_repeat: 0 },
  updatedAt: '2026-11-02T10:30:00.000Z',
  updatedBy: 'admin-1',
  lastQuoteUsesCommissions: true,
  ...overrides,
});

// Cada tarjeta es una sección con el nombre de la regla; el campo es su único cuadro de texto.
const input = (title: string | RegExp) =>
  within(screen.getByRole('region', { name: title })).getByRole('textbox') as HTMLInputElement;

const TITLES = {
  garserFirst: 'Primera reserva de un cliente captado por GarSer',
  linkFirst: 'Primera reserva de un cliente procedente del enlace personal del jardinero',
  repeat: 'Reservas posteriores con el mismo jardinero',
  plan: 'Visitas de planes de mantenimiento',
  linkRepeat: 'Reservas posteriores con un jardinero procedentes del enlace personal de este',
};

const saveButton = () => screen.getByRole('button', { name: /Guardar configuración|Guardando/ });

async function renderLoaded(value: Settings = settings()) {
  mocks.fetchCommissionSettings.mockResolvedValue(value);
  render(<CommissionSettingsPage />);
  await screen.findByText(`Versión ${value.version}`);
}

describe('Configuración de comisiones', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchCommissionAudit.mockResolvedValue([]);
  });
  afterEach(cleanup);

  describe('carga', () => {
    it('mientras carga enseña un estado de carga y ningún campo editable', () => {
      mocks.fetchCommissionSettings.mockReturnValue(new Promise(() => {}));
      render(<CommissionSettingsPage />);
      expect(screen.getByText('Cargando la configuración de comisiones…')).toBeTruthy();
      expect(screen.queryAllByRole('textbox')).toHaveLength(0);
      expect(screen.queryByRole('button', { name: 'Guardar configuración' })).toBeNull();
    });

    it('si falla la carga NO enseña porcentajes (ni un 0 %): error claro y botón para reintentar', async () => {
      mocks.fetchCommissionSettings.mockRejectedValueOnce(new CommissionSettingsError('unavailable', 'No se ha podido contactar con el servidor.'));
      render(<CommissionSettingsPage />);
      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toContain('No se ha podido contactar con el servidor.');
      expect(screen.queryAllByRole('textbox')).toHaveLength(0);
      // Ni un solo «Valor guardado»: no se inventa ninguna configuración (y menos un 0 %).
      expect(screen.queryByText(/Valor guardado/)).toBeNull();

      mocks.fetchCommissionSettings.mockResolvedValueOnce(settings());
      fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
      await screen.findByText('Versión 4');
      expect(screen.getAllByRole('textbox')).toHaveLength(5);
    });

    it('un usuario sin permisos recibe el mensaje y no ve ningún campo', async () => {
      mocks.fetchCommissionSettings.mockRejectedValueOnce(
        new CommissionSettingsError('forbidden', 'No tienes permisos de administrador para ver o cambiar las comisiones.'),
      );
      render(<CommissionSettingsPage />);
      expect((await screen.findByRole('alert')).textContent).toContain('No tienes permisos de administrador');
      expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    });

    it('enseña las cinco reglas con su nombre, su descripción y el valor guardado en el servidor', async () => {
      await renderLoaded();
      // Las cinco reglas, «lo que dirá la web» y el bloque del historial.
      expect(screen.getAllByRole('region')).toHaveLength(7);
      expect(input(TITLES.garserFirst).value).toBe('12,5');
      expect(input(TITLES.linkFirst).value).toBe('0');
      expect(input(TITLES.repeat).value).toBe('3');
      expect(input(TITLES.plan).value).toBe('3');
      expect(input(TITLES.linkRepeat).value).toBe('0');
      expect(screen.getByText(/Comisión aplicada cuando un cliente contrata por primera vez/)).toBeTruthy();
      expect(within(screen.getByRole('region', { name: TITLES.garserFirst })).getByText('12,5 %')).toBeTruthy();
      expect(screen.getByText(/Actualizada el/)).toBeTruthy();
      // Sin cambios no hay nada que guardar.
      expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
    });
  });

  describe('«Lo que dirá la web»', () => {
    const preview = () => screen.getByRole('region', { name: 'Lo que dirá la web' });

    it('con los porcentajes guardados enseña lo que leerá un visitante', async () => {
      await renderLoaded();
      expect(within(preview()).getByText('Con los porcentajes guardados.', { exact: false })).toBeTruthy();
      expect(within(preview()).getByText(/Pagan tu precio y nada más\./)).toBeTruthy();
      expect(within(preview()).getByText('Y si un cliente que te trajo GarSer vuelve a reservar contigo, paga menos gastos de gestión.')).toBeTruthy();
      expect(within(preview()).getByText('Tus clientes reservan contigo sin gastos de gestión (salvo en las visitas de un plan de mantenimiento).')).toBeTruthy();
    });

    it('se actualiza con lo que se escribe, antes de guardar, y avisa de que no está guardado', async () => {
      await renderLoaded();
      fireEvent.change(input(TITLES.linkFirst), { target: { value: '12,5' } });
      fireEvent.change(input(TITLES.linkRepeat), { target: { value: '12,5' } });
      expect(within(preview()).getByText('todavía sin guardar', { exact: false })).toBeTruthy();
      expect(within(preview()).getByText('Pagan gastos de gestión, aparte de tu precio. Tú cobras tu precio entero.')).toBeTruthy();
      expect(within(preview()).queryByText(/sin gastos de gestión/i)).toBeNull();
      expect(mocks.saveCommissionSettings).not.toHaveBeenCalled();
    });

    it('con un campo inválido no inventa nada: sigue enseñando lo guardado', async () => {
      await renderLoaded();
      fireEvent.change(input(TITLES.linkFirst), { target: { value: 'abc' } });
      expect(within(preview()).getByText('Con los porcentajes guardados.', { exact: false })).toBeTruthy();
      expect(within(preview()).getByText(/Pagan tu precio y nada más\./)).toBeTruthy();
    });

    it('todo a 0 %: la web puede decir que nadie paga gastos de gestión', async () => {
      await renderLoaded(settings({ rates: { garser_first: 0, link_first: 0, garser_repeat: 0, maintenance_visit: 0, link_repeat: 0 } }));
      expect(within(preview()).getByText('Para ti es gratis. Para tus clientes, sin gastos de gestión.')).toBeTruthy();
      expect(within(preview()).getByText('Tampoco pagan gastos de gestión. Y a ti no se te descuenta nada.')).toBeTruthy();
    });
  });

  describe('validación', () => {
    it.each([
      ['', 'Indica un porcentaje.'],
      ['abc', 'Escribe solo el número, por ejemplo 12,5.'],
      ['-1', 'No puede ser negativo.'],
      ['100,01', 'No puede superar el 100 %.'],
      ['1,234', 'Admite como mucho dos decimales.'],
    ])('«%s» se rechaza con un mensaje comprensible y no se envía', async (text, message) => {
      await renderLoaded();
      const field = input(TITLES.garserFirst);
      fireEvent.change(field, { target: { value: text } });
      fireEvent.blur(field);
      expect(within(screen.getByRole('region', { name: TITLES.garserFirst })).getByRole('alert').textContent).toBe(message);
      expect(field.getAttribute('aria-invalid')).toBe('true');
      expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
      fireEvent.submit(field.closest('form') as HTMLFormElement);
      expect(mocks.saveCommissionSettings).not.toHaveBeenCalled();
    });

    it('acepta decimales con coma o punto y los límites 0 y 100', async () => {
      await renderLoaded();
      fireEvent.change(input(TITLES.garserFirst), { target: { value: '100' } });
      fireEvent.change(input(TITLES.linkFirst), { target: { value: '1.5' } });
      fireEvent.change(input(TITLES.repeat), { target: { value: '0' } });
      expect(screen.queryAllByRole('alert')).toHaveLength(0);
      expect((saveButton() as HTMLButtonElement).disabled).toBe(false);
    });

    it('un campo vacío NO se interpreta como 0: bloquea el guardado aunque haya otros cambios válidos', async () => {
      await renderLoaded();
      fireEvent.change(input(TITLES.repeat), { target: { value: '4' } });
      fireEvent.change(input(TITLES.plan), { target: { value: '' } });
      expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
      fireEvent.submit(input(TITLES.plan).closest('form') as HTMLFormElement);
      expect(mocks.saveCommissionSettings).not.toHaveBeenCalled();
      // Al intentar guardar se muestra el error del campo y el foco va a él.
      expect(within(screen.getByRole('region', { name: TITLES.plan })).getByRole('alert').textContent).toBe('Indica un porcentaje.');
      await waitFor(() => expect(document.activeElement).toBe(input(TITLES.plan)));
    });
  });

  describe('guardar', () => {
    it('guarda las cinco reglas juntas con la versión que se cargó y enseña lo que devuelve el servidor', async () => {
      await renderLoaded();
      fireEvent.change(input(TITLES.garserFirst), { target: { value: '14' } });
      fireEvent.change(input(TITLES.plan), { target: { value: '2,5' } });
      // Antes de guardar se ve qué va a cambiar.
      expect(screen.getByText('Cambios pendientes de guardar')).toBeTruthy();
      expect(screen.getByText(/Primera reserva \(captado por GarSer\): 12,5 % → 14 %/)).toBeTruthy();
      expect(within(screen.getByRole('region', { name: TITLES.plan })).getByText('Sin guardar')).toBeTruthy();

      // El servidor devuelve valores (y versión) distintos a los escritos solo en la versión.
      const saved = settings({ version: 5, rates: { garser_first: 14, link_first: 0, garser_repeat: 3, maintenance_visit: 2.5, link_repeat: 0 } });
      mocks.saveCommissionSettings.mockResolvedValue({ settings: saved, changed: true });
      fireEvent.click(saveButton());

      await screen.findByText(/Configuración guardada \(versión 5\)/);
      expect(mocks.saveCommissionSettings).toHaveBeenCalledTimes(1);
      expect(mocks.saveCommissionSettings).toHaveBeenCalledWith(4, {
        garser_first: 14, link_first: 0, garser_repeat: 3, maintenance_visit: 2.5, link_repeat: 0,
      });
      // El formulario pasa a mostrar lo persistido y no queda nada pendiente.
      expect(input(TITLES.garserFirst).value).toBe('14');
      expect(input(TITLES.plan).value).toBe('2,5');
      expect(screen.getByText('Versión 5')).toBeTruthy();
      expect(screen.queryByText('Cambios pendientes de guardar')).toBeNull();
      expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
      expect(mocks.fetchCommissionAudit).toHaveBeenCalledTimes(2); // al cargar y tras guardar
    });

    it('si el guardado falla NO anuncia éxito, conserva lo escrito y deja volver a intentarlo', async () => {
      await renderLoaded();
      fireEvent.change(input(TITLES.garserFirst), { target: { value: '14' } });
      mocks.saveCommissionSettings.mockRejectedValueOnce(new CommissionSettingsError('unavailable', 'No se ha podido contactar con el servidor.'));
      fireEvent.click(saveButton());

      const alert = await screen.findByText(/No se ha guardado nada\. No se ha podido contactar con el servidor\./);
      expect(alert).toBeTruthy();
      expect(screen.queryByText(/Configuración guardada/)).toBeNull();
      expect(input(TITLES.garserFirst).value).toBe('14');
      expect(screen.getByText('Versión 4')).toBeTruthy();
      expect((saveButton() as HTMLButtonElement).disabled).toBe(false);

      mocks.saveCommissionSettings.mockResolvedValueOnce({ settings: settings({ version: 5, rates: { ...settings().rates, garser_first: 14 } }), changed: true });
      fireEvent.click(saveButton());
      await screen.findByText(/Configuración guardada \(versión 5\)/);
    });

    it('un error inesperado (no de la API) tampoco se disfraza de éxito', async () => {
      await renderLoaded();
      fireEvent.change(input(TITLES.repeat), { target: { value: '5' } });
      mocks.saveCommissionSettings.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      fireEvent.click(saveButton());
      await screen.findByText(/No se ha guardado nada\. Inténtalo de nuevo en unos minutos\./);
      expect(screen.queryByText(/Configuración guardada/)).toBeNull();
    });

    it('si el servidor rechaza un campo, lo marca y conserva todo lo escrito', async () => {
      await renderLoaded();
      fireEvent.change(input(TITLES.repeat), { target: { value: '5' } });
      mocks.saveCommissionSettings.mockRejectedValueOnce(
        new CommissionSettingsError('invalid', 'El servidor ha rechazado algún porcentaje.', { fieldErrors: { garser_repeat: 'No puede superar el 100 %.' } }),
      );
      fireEvent.click(saveButton());
      await screen.findByText(/El servidor no ha guardado nada/);
      expect(within(screen.getByRole('region', { name: TITLES.repeat })).getByRole('alert').textContent).toBe('No puede superar el 100 %.');
      expect(input(TITLES.repeat).value).toBe('5');
    });

    it('un permiso revocado a mitad de sesión se explica', async () => {
      await renderLoaded();
      fireEvent.change(input(TITLES.repeat), { target: { value: '5' } });
      mocks.saveCommissionSettings.mockRejectedValueOnce(
        new CommissionSettingsError('forbidden', 'No tienes permisos de administrador para ver o cambiar las comisiones.'),
      );
      fireEvent.click(saveButton());
      await screen.findByText(/No tienes permisos de administrador/);
      expect(screen.queryByText(/Configuración guardada/)).toBeNull();
    });

    it('dos clics seguidos no provocan dos escrituras', async () => {
      await renderLoaded();
      fireEvent.change(input(TITLES.garserFirst), { target: { value: '14' } });
      let resolveSave: (value: unknown) => void = () => {};
      mocks.saveCommissionSettings.mockReturnValue(new Promise((resolve) => { resolveSave = resolve; }));

      const button = saveButton();
      fireEvent.click(button);
      fireEvent.click(button);
      fireEvent.submit(button.closest('form') as HTMLFormElement);
      expect(mocks.saveCommissionSettings).toHaveBeenCalledTimes(1);
      // Mientras se guarda: botón bloqueado, campos bloqueados y texto de estado.
      expect(screen.getByRole('button', { name: 'Guardando…' })).toBeTruthy();
      expect(input(TITLES.garserFirst).disabled).toBe(true);

      await act(async () => {
        resolveSave({ settings: settings({ version: 5, rates: { ...settings().rates, garser_first: 14 } }), changed: true });
      });
      await screen.findByText(/Configuración guardada \(versión 5\)/);
      expect(mocks.saveCommissionSettings).toHaveBeenCalledTimes(1);
    });

    it('si otro administrador cambió algo, avisa, no guarda y permite cargar los valores actuales', async () => {
      await renderLoaded();
      fireEvent.change(input(TITLES.garserFirst), { target: { value: '14' } });
      const current = settings({ version: 6, rates: { garser_first: 11, link_first: 0, garser_repeat: 3, maintenance_visit: 3, link_repeat: 0 } });
      mocks.saveCommissionSettings.mockRejectedValueOnce(
        new CommissionSettingsError('stale', 'La configuración ha cambiado mientras la editabas. Revisa los valores actuales.', { current }),
      );
      fireEvent.click(saveButton());
      await screen.findByText(/La configuración ha cambiado mientras la editabas/);
      expect(screen.queryByText(/Configuración guardada/)).toBeNull();
      // Lo escrito se conserva hasta que el administrador decida.
      expect(input(TITLES.garserFirst).value).toBe('14');

      fireEvent.click(screen.getByRole('button', { name: 'Cargar los valores actuales' }));
      expect(input(TITLES.garserFirst).value).toBe('11');
      expect(screen.getByText('Versión 6')).toBeTruthy();
      expect(screen.queryByText(/La configuración ha cambiado/)).toBeNull();
    });

    it('«Descartar cambios» vuelve a lo guardado sin llamar al servidor', async () => {
      await renderLoaded();
      fireEvent.change(input(TITLES.garserFirst), { target: { value: '14' } });
      fireEvent.change(input(TITLES.plan), { target: { value: 'abc' } });
      fireEvent.click(screen.getByRole('button', { name: 'Descartar cambios' }));
      expect(input(TITLES.garserFirst).value).toBe('12,5');
      expect(input(TITLES.plan).value).toBe('3');
      expect(mocks.saveCommissionSettings).not.toHaveBeenCalled();
    });
  });

  describe('estado del motor y del historial', () => {
    it('avisa si el último presupuesto firmado no usa estas comisiones (funciones sin desplegar)', async () => {
      await renderLoaded(settings({ lastQuoteUsesCommissions: false }));
      expect(screen.getByText(/no usa estas comisiones/)).toBeTruthy();
      expect(screen.getByText('booking-payment')).toBeTruthy();
    });

    it('no avisa cuando el motor ya firma con ellas', async () => {
      await renderLoaded(settings({ lastQuoteUsesCommissions: true }));
      expect(screen.queryByText(/no usa estas comisiones/)).toBeNull();
    });

    it('lista el historial con quién, cuándo y qué cambió', async () => {
      mocks.fetchCommissionAudit.mockResolvedValue([
        {
          id: 2, occurredAt: '2026-11-02T10:30:00.000Z', actorId: 'admin-1', actorName: 'Ana Admin', source: 'admin_rpc', outcome: 'saved',
          previousVersion: 3, newVersion: 4,
          previousRates: { garser_first: 12.5, link_first: 0, garser_repeat: 3, maintenance_visit: 3, link_repeat: 0 },
          savedRates: { garser_first: 14, link_first: 0, garser_repeat: 3, maintenance_visit: 3, link_repeat: 0 },
        },
        {
          id: 1, occurredAt: '2026-11-01T09:00:00.000Z', actorId: null, actorName: null, source: 'migration', outcome: 'saved',
          previousVersion: null, newVersion: 1, previousRates: null,
          savedRates: { garser_first: 12.5, link_first: 0, garser_repeat: 3, maintenance_visit: 3, link_repeat: 0 },
        },
      ]);
      await renderLoaded();
      await screen.findByText(/Ana Admin/);
      expect(screen.getByText(/versión 4/)).toBeTruthy();
      expect(screen.getByText('Primera reserva (captado por GarSer): 12,5 % → 14 %')).toBeTruthy();
      expect(screen.getByText('Valores iniciales', { exact: false })).toBeTruthy();
    });

    it('si el historial no carga, los porcentajes siguen disponibles', async () => {
      mocks.fetchCommissionAudit.mockRejectedValue(new Error('boom'));
      await renderLoaded();
      await screen.findByText(/No se ha podido cargar el historial/);
      expect(screen.getAllByRole('textbox')).toHaveLength(5);
    });
  });
});
