// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  bindProviderLinkCodesToUser,
  captureProviderLinkCodeFromUrl,
  clearProviderLinkCodes,
  forgetProviderLinkCode,
  readStoredSessionUserId,
  recallProviderLinkCode,
  rememberProviderLinkCode,
} from './providerLinkCode';

const ID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const CODE = '0123456789abcdef0123456789abcdef';
const CODE2 = 'fedcba9876543210fedcba9876543210';
const DAY = 24 * 60 * 60 * 1000;

const fakeWindow = (pathname: string, search = '', hash = '') => {
  const replaceState = vi.fn();
  return { win: { location: { pathname, search, hash }, history: { state: { keep: 1 }, replaceState } }, replaceState };
};

beforeEach(() => localStorage.clear());

describe('guardar y recordar la clave', () => {
  it('la recuerda por profesional, sin distinguir mayúsculas del identificador ni de la clave', () => {
    rememberProviderLinkCode(ID.toUpperCase(), CODE.toUpperCase());
    expect(recallProviderLinkCode(ID)).toBe(CODE);
    expect(recallProviderLinkCode(OTHER)).toBeNull();
  });

  it('una clave mal formada no se guarda', () => {
    for (const bad of ['', 'abc', 'g'.repeat(32), `${CODE}0`, ' ']) rememberProviderLinkCode(ID, bad);
    expect(recallProviderLinkCode(ID)).toBeNull();
  });

  it('la última clave sustituye a la anterior (el profesional cambió su enlace)', () => {
    rememberProviderLinkCode(ID, CODE);
    rememberProviderLinkCode(ID, CODE2);
    expect(recallProviderLinkCode(ID)).toBe(CODE2);
  });

  it('caduca a los 30 días (ventana de atribución, QA-101) y olvida lo viejo al guardar otra', () => {
    const t0 = 1_700_000_000_000;
    rememberProviderLinkCode(ID, CODE, { now: t0 });
    expect(recallProviderLinkCode(ID, { now: t0 + 29 * DAY })).toBe(CODE);
    expect(recallProviderLinkCode(ID, { now: t0 + 31 * DAY })).toBeNull();
    rememberProviderLinkCode(OTHER, CODE2, { now: t0 + 40 * DAY });
    expect(JSON.parse(localStorage.getItem('garser.providerLinkCodes.v1') as string)).not.toHaveProperty(ID);
  });

  it('olvidar borra solo la de ese profesional', () => {
    rememberProviderLinkCode(ID, CODE);
    rememberProviderLinkCode(OTHER, CODE2);
    forgetProviderLinkCode(ID);
    expect(recallProviderLinkCode(ID)).toBeNull();
    expect(recallProviderLinkCode(OTHER)).toBe(CODE2);
  });

  it('un almacenamiento corrupto no rompe nada', () => {
    localStorage.setItem('garser.providerLinkCodes.v1', '{no es json');
    expect(recallProviderLinkCode(ID)).toBeNull();
    rememberProviderLinkCode(ID, CODE);
    expect(recallProviderLinkCode(ID)).toBe(CODE);
    localStorage.setItem('garser.providerLinkCodes.v1', '[1,2]');
    expect(recallProviderLinkCode(ID)).toBeNull();
  });

  it('sin almacenamiento disponible no lanza', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(() => rememberProviderLinkCode(ID, CODE)).not.toThrow();
    spy.mockRestore();
  });
});

describe('la clave es de quien llegó con ella (QA-101)', () => {
  const ANA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const LUIS = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  it('la que guardó una cuenta no vale para otra, y en ese navegador se borra', () => {
    rememberProviderLinkCode(ID, CODE, { userId: ANA });
    expect(recallProviderLinkCode(ID, { userId: LUIS })).toBeNull();
    expect(recallProviderLinkCode(ID, { userId: ANA })).toBeNull();
  });

  it('tampoco vale sin sesión si era de una cuenta', () => {
    rememberProviderLinkCode(ID, CODE, { userId: ANA });
    expect(recallProviderLinkCode(ID, { userId: null })).toBeNull();
    expect(recallProviderLinkCode(ID, { userId: ANA })).toBe(CODE);
  });

  it('la de un visitante sin sesión pasa a la primera cuenta que la usa', () => {
    rememberProviderLinkCode(ID, CODE);
    expect(recallProviderLinkCode(ID, { userId: null })).toBe(CODE);
    expect(recallProviderLinkCode(ID, { userId: ANA })).toBe(CODE);
    expect(recallProviderLinkCode(ID, { userId: LUIS })).toBeNull();
  });

  it('al iniciar sesión: las de visitante pasan a esa cuenta y las de otra cuenta se borran', () => {
    rememberProviderLinkCode(ID, CODE);
    rememberProviderLinkCode(OTHER, CODE2, { userId: LUIS });
    bindProviderLinkCodesToUser(ANA);
    expect(recallProviderLinkCode(ID, { userId: ANA })).toBe(CODE);
    expect(JSON.parse(localStorage.getItem('garser.providerLinkCodes.v1') as string)).not.toHaveProperty(OTHER);
  });

  it('al cerrar sesión se olvidan todas', () => {
    rememberProviderLinkCode(ID, CODE, { userId: ANA });
    rememberProviderLinkCode(OTHER, CODE2);
    clearProviderLinkCodes();
    expect(localStorage.getItem('garser.providerLinkCodes.v1')).toBeNull();
    expect(recallProviderLinkCode(OTHER)).toBeNull();
  });

  it('al llegar por el enlace con sesión abierta, la clave queda ligada a esa cuenta', () => {
    localStorage.setItem('sb-abc-auth-token', JSON.stringify({ access_token: 'x', user: { id: ANA } }));
    expect(readStoredSessionUserId()).toBe(ANA);
    const { win } = fakeWindow(`/reservar/${ID}`, `?c=${CODE}`);
    captureProviderLinkCodeFromUrl(win as never);
    expect(recallProviderLinkCode(ID, { userId: LUIS })).toBeNull();
  });

  it('una sesión guardada ilegible cuenta como visitante', () => {
    localStorage.setItem('sb-abc-auth-token', '{roto');
    expect(readStoredSessionUserId()).toBeNull();
  });
});

describe('captureProviderLinkCodeFromUrl', () => {
  it('guarda la clave y la quita de la dirección, respetando el resto de parámetros', () => {
    const { win, replaceState } = fakeWindow(`/reservar/${ID}`, `?c=${CODE}&utm_source=qr`, '#x');
    expect(captureProviderLinkCodeFromUrl(win as never)).toEqual({ providerId: ID, saved: true });
    expect(recallProviderLinkCode(ID)).toBe(CODE);
    expect(replaceState).toHaveBeenCalledWith({ keep: 1 }, '', `/reservar/${ID}?utm_source=qr#x`);
  });

  it('si solo traía la clave, la dirección queda limpia', () => {
    const { win, replaceState } = fakeWindow(`/reservar/${ID}/`, `?c=${CODE}`);
    captureProviderLinkCodeFromUrl(win as never);
    expect(replaceState).toHaveBeenCalledWith({ keep: 1 }, '', `/reservar/${ID}/`);
  });

  it('una clave inválida se quita igualmente de la dirección pero no se guarda', () => {
    const { win, replaceState } = fakeWindow(`/reservar/${ID}`, '?c=trampa');
    expect(captureProviderLinkCodeFromUrl(win as never)).toEqual({ providerId: ID, saved: false });
    expect(recallProviderLinkCode(ID)).toBeNull();
    expect(replaceState).toHaveBeenCalledWith({ keep: 1 }, '', `/reservar/${ID}`);
  });

  it('en cualquier otra página no hace nada', () => {
    for (const [path, search] of [['/', `?c=${CODE}`], [`/reservar/${ID}`, ''], ['/reservar/no-es-un-id', `?c=${CODE}`], [`/perfil/${ID}`, `?c=${CODE}`], [`/reservar/${ID}/extra`, `?c=${CODE}`]]) {
      const { win, replaceState } = fakeWindow(path, search);
      expect(captureProviderLinkCodeFromUrl(win as never)).toBeNull();
      expect(replaceState).not.toHaveBeenCalled();
    }
    expect(recallProviderLinkCode(ID)).toBeNull();
  });
});
