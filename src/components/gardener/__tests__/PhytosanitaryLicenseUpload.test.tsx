// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import PhytosanitaryLicenseUpload from '../PhytosanitaryLicenseUpload';
import { useAuth } from '../../../contexts/AuthContext';
import toast from 'react-hot-toast';

// Mocks de dependencias
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      insert: vi.fn().mockResolvedValue({ error: null }),
    })),
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn().mockResolvedValue({ error: null }),
      })),
    },
  },
}));

vi.mock('react-hot-toast', () => ({
  default: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

// Mock para prevenir errores con createObjectURL
global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
global.URL.revokeObjectURL = vi.fn();

describe('PhytosanitaryLicenseUpload QA Suite', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuth as any).mockReturnValue({
      user: { id: 'test-gardener-id' },
    });
  });

  it('debe mostrar error si el archivo es mayor a 10MB (Seguridad)', async () => {
    render(<PhytosanitaryLicenseUpload onStatusChange={vi.fn()} />);
    
    // Esperar a que pase el loading inicial
    await waitFor(() => {
      expect(screen.getByLabelText(/Seleccionar archivo/i)).toBeTruthy();
    });

    const input = screen.getByLabelText(/Seleccionar archivo/i) as HTMLInputElement;
    
    // Simular un archivo falso > 10MB (ej. 11MB)
    const largeFile = new File(['x'.repeat(11 * 1024 * 1024)], 'large.pdf', { type: 'application/pdf' });
    
    fireEvent.change(input, { target: { files: [largeFile] } });
    
    // Verificar que se haya bloqueado y avisado al usuario
    expect(toast.error).toHaveBeenCalledWith('El archivo es demasiado grande (máximo 10MB)');
  });

  it('debe mostrar error si el formato del archivo no es válido (Compliance)', async () => {
    render(<PhytosanitaryLicenseUpload onStatusChange={vi.fn()} />);
    
    await waitFor(() => {
      expect(screen.getByLabelText(/Seleccionar archivo/i)).toBeTruthy();
    });

    const input = screen.getByLabelText(/Seleccionar archivo/i) as HTMLInputElement;
    
    // Archivo malicioso o no permitido
    const invalidFile = new File(['test'], 'script.sh', { type: 'text/plain' });
    
    fireEvent.change(input, { target: { files: [invalidFile] } });
    
    expect(toast.error).toHaveBeenCalledWith('Formato no válido. Solo se admiten PDF, JPG o PNG.');
  });

  it('debe mantener el botón de envío deshabilitado hasta aceptar la declaración responsable', async () => {
    render(<PhytosanitaryLicenseUpload onStatusChange={vi.fn()} />);
    
    await waitFor(() => {
      expect(screen.getByLabelText(/Seleccionar archivo/i)).toBeTruthy();
    });

    const input = screen.getByLabelText(/Seleccionar archivo/i) as HTMLInputElement;
    const validFile = new File(['dummy content'], 'test.pdf', { type: 'application/pdf' });
    
    fireEvent.change(input, { target: { files: [validFile] } });
    
    // Esperar a que la UI cambie al estado de borrador y muestre el botón
    await waitFor(() => {
      expect(screen.getByText('Enviar Documento')).toBeTruthy();
    });

    const submitButton = screen.getByText('Enviar Documento');
    
    // Como el checkbox no está marcado por defecto, debe estar bloqueado
    expect(submitButton).toHaveProperty('disabled', true);

    // Marcar la declaración de responsabilidad legal
    const checkbox = screen.getAllByRole('checkbox')[0];
    fireEvent.click(checkbox);

    // El botón ya debe ser clicable
    expect(submitButton).toHaveProperty('disabled', false);
  });
});
