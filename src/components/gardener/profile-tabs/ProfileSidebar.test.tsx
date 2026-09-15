// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ProfileSidebar from './ProfileSidebar';

afterEach(() => {
  cleanup();
});

describe('ProfileSidebar', () => {
  it('marca como activa solo la pestaña que coincide con activeTab', () => {
    render(<ProfileSidebar activeTab="coverage" onTabChange={() => undefined} />);

    const coverageTabs = screen.getAllByRole('tab', { name: /Cobertura y Zonas/ });
    coverageTabs.forEach((tab) => expect(tab.getAttribute('aria-selected')).toBe('true'));

    const personalTabs = screen.getAllByRole('tab', { name: /Información Personal/ });
    personalTabs.forEach((tab) => expect(tab.getAttribute('aria-selected')).toBe('false'));
  });

  it('llama a onTabChange con el id de la pestaña pulsada', () => {
    const onTabChange = vi.fn();
    render(<ProfileSidebar activeTab="personal" onTabChange={onTabChange} />);

    const servicesTabs = screen.getAllByRole('tab', { name: /Servicios/ });
    fireEvent.click(servicesTabs[0]);

    expect(onTabChange).toHaveBeenCalledWith('services');
  });

  it('renderiza las 3 pestañas tanto en la variante móvil como en la de escritorio', () => {
    render(<ProfileSidebar activeTab="personal" onTabChange={() => undefined} />);
    expect(screen.getAllByRole('tab', { name: /Información Personal/ })).toHaveLength(2);
    expect(screen.getAllByRole('tab', { name: /Cobertura y Zonas/ })).toHaveLength(2);
    expect(screen.getAllByRole('tab', { name: /Servicios/ })).toHaveLength(2);
  });
});
