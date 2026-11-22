// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import ProfileAvatar, { initialsOf } from './ProfileAvatar';

describe('initialsOf', () => {
  it('dos iniciales como mucho, en mayúsculas', () => {
    expect(initialsOf('Rosa López QA')).toBe('RL');
    expect(initialsOf('  pepe ')).toBe('P');
    expect(initialsOf('')).toBe('');
    expect(initialsOf(null)).toBe('');
  });
});

describe('ProfileAvatar · QA-023 (nunca un icono de imagen rota)', () => {
  afterEach(() => cleanup());

  it('con foto la pinta', () => {
    render(<ProfileAvatar url="https://x.test/a.jpg" name="Rosa López" className="h-10 w-10" />);
    expect((screen.getByRole('img', { name: 'Rosa López' }) as HTMLImageElement).src).toBe('https://x.test/a.jpg');
  });

  it('sin foto (nula, vacía o solo espacios) pinta las iniciales, sin <img>', () => {
    for (const url of [null, undefined, '', '   ']) {
      const { container, unmount } = render(<ProfileAvatar url={url} name="Rosa López" className="h-10 w-10" />);
      expect(container.querySelector('img')).toBeNull();
      expect(screen.getByText('RL')).toBeTruthy();
      unmount();
    }
  });

  it('si la foto no carga (enlace roto), cambia a las iniciales', () => {
    const { container } = render(<ProfileAvatar url="https://x.test/rota.jpg" name="Rosa López" className="h-10 w-10" />);
    fireEvent.error(container.querySelector('img') as HTMLImageElement);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('RL')).toBeTruthy();
  });

  it('sin nombre ni foto, una figura neutra (no texto vacío)', () => {
    const { container } = render(<ProfileAvatar url={null} name={null} className="h-10 w-10" />);
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
