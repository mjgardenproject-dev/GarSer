import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateImageLocal } from './imageValidator';

describe('imageValidator (Canvas API)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();

    // Mock global window and document objects for NodeJS environment
    global.window = {
      Image: class {}
    } as any;

    global.document = {
      createElement: vi.fn()
    } as any;

    global.URL = {
      createObjectURL: vi.fn(() => 'blob:mock-url'),
      revokeObjectURL: vi.fn()
    } as any;
  });

  afterEach(() => {
    delete (global as any).window;
    delete (global as any).document;
  });

  it('debería rechazar imágenes con resolución menor a 600x600', async () => {
    global.window.Image = class {
      onload: () => void = () => {};
      onerror: () => void = () => {};
      src: string = '';
      width: number = 500; // Too small
      height: number = 500; // Too small
      
      constructor() {
        setTimeout(() => this.onload(), 10);
      }
    } as any;

    const mockFile = new File([''], 'test.jpg', { type: 'image/jpeg' });
    const result = await validateImageLocal(mockFile);

    expect(result.isValid).toBe(false);
    expect(result.reason).toBe('TOO_SMALL');
  });

  it('debería aceptar imágenes válidas (resolución adecuada y buen brillo)', async () => {
    global.window.Image = class {
      onload: () => void = () => {};
      onerror: () => void = () => {};
      src: string = '';
      width: number = 800;
      height: number = 800;
      
      constructor() {
        setTimeout(() => this.onload(), 10);
      }
    } as any;

    const mockContext = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => {
        const data = new Uint8ClampedArray(100 * 100 * 4);
        for (let i = 0; i < data.length; i += 4) {
          data[i] = 255;     // R
          data[i+1] = 255;   // G
          data[i+2] = 255;   // B
          data[i+3] = 255;   // A
        }
        return { data, width: 100, height: 100 };
      })
    };

    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => mockContext)
    };

    (global.document.createElement as any).mockImplementation((tagName: string) => {
      if (tagName === 'canvas') return mockCanvas;
      return {};
    });

    const mockFile = new File([''], 'valid.jpg', { type: 'image/jpeg' });
    const result = await validateImageLocal(mockFile);
    if (!result.isValid) console.error(result);

    expect(result.isValid).toBe(true);
    expect(mockContext.drawImage).toHaveBeenCalled();
    expect(mockContext.getImageData).toHaveBeenCalled();
  });

  it('debería rechazar imágenes demasiado oscuras (lux < 20)', async () => {
    global.window.Image = class {
      onload: () => void = () => {};
      onerror: () => void = () => {};
      src: string = '';
      width: number = 800;
      height: number = 800;
      
      constructor() {
        setTimeout(() => this.onload(), 10);
      }
    } as any;

    const mockContext = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => {
        const data = new Uint8ClampedArray(100 * 100 * 4);
        for (let i = 0; i < data.length; i += 4) {
          data[i] = 10;     // R
          data[i+1] = 10;   // G
          data[i+2] = 10;   // B
          data[i+3] = 255;   // A
        }
        return { data, width: 100, height: 100 };
      })
    };

    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => mockContext)
    };

    (global.document.createElement as any).mockImplementation((tagName: string) => {
      if (tagName === 'canvas') return mockCanvas;
      return {};
    });

    const mockFile = new File([''], 'dark.jpg', { type: 'image/jpeg' });
    const result = await validateImageLocal(mockFile);

    expect(result.isValid).toBe(false);
    expect(result.reason).toBe('TOO_DARK');
  });
});
