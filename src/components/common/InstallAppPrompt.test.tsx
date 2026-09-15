// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import InstallAppPrompt from './InstallAppPrompt';

const IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

function setUserAgent(ua: string) {
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
}

function setStandalone(value: boolean | undefined) {
  Object.defineProperty(window.navigator, 'standalone', { value, configurable: true });
}

beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation(
    (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }) as unknown as MediaQueryList,
  );
});

afterEach(() => {
  cleanup();
  setStandalone(undefined);
});

describe('InstallAppPrompt', () => {
  it('no muestra nada si la web ya se ejecuta en modo standalone', () => {
    setUserAgent(IOS_UA);
    setStandalone(true);
    const { container } = render(<InstallAppPrompt />);
    expect(container.firstChild).toBeNull();
  });

  it('en iOS muestra las instrucciones de Compartir / Añadir a pantalla de inicio', () => {
    setUserAgent(IOS_UA);
    setStandalone(false);
    render(<InstallAppPrompt />);
    expect(screen.getByText('Úsalo más cómodamente desde la app')).toBeTruthy();
    expect(screen.getByText('Compartir')).toBeTruthy();
    expect(screen.getByText('Añadir a pantalla de inicio')).toBeTruthy();
  });

  it('en Android con beforeinstallprompt disponible, el botón dispara el evento nativo', async () => {
    setUserAgent(ANDROID_UA);
    setStandalone(false);
    render(<InstallAppPrompt />);

    const promptFn = vi.fn().mockResolvedValue(undefined);
    const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
    };
    event.prompt = promptFn;
    event.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(event);

    const button = await screen.findByRole('button', { name: /Instalar app/i });
    fireEvent.click(button);

    expect(promptFn).toHaveBeenCalledTimes(1);
  });

  it('en Android sin beforeinstallprompt muestra instrucciones manuales', () => {
    setUserAgent(ANDROID_UA);
    setStandalone(false);
    render(<InstallAppPrompt />);
    expect(screen.queryByRole('button', { name: /Instalar app/i })).toBeNull();
    expect(screen.getByText(/el menú de Chrome/)).toBeTruthy();
  });
});
