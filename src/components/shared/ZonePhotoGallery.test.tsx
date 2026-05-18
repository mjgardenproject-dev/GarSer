// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ZonePhotoGallery, buildZonePhotoRemovalConfirmation } from './ZonePhotoGallery'

vi.mock('../../shared/analysisV2Details', () => ({
  getAnalysisPresentation: vi.fn((analysis, options) => {
    if (analysis?.analysis_status === 'failed' || options?.analysisLevel === 3) {
      return {
        status: 'failed',
        badgeLabel: 'Reintento recomendado',
        title: 'Análisis insuficiente',
        message: 'Faltan fotos válidas.',
      }
    }

    if (analysis?.analysis_status === 'technical_error') {
      return {
        status: 'technical_error',
        badgeLabel: 'Error técnico',
        title: 'Error técnico',
        message: 'Se ha producido un error controlado.',
      }
    }

    if (analysis) {
      return {
        status: 'success',
        badgeLabel: 'Analizadas',
        title: 'Análisis completado',
        message: 'Todo correcto.',
      }
    }

    return {
      status: null,
      badgeLabel: 'Pendiente',
      title: '',
      message: '',
    }
  }),
}))

describe('ZonePhotoGallery', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn((file: File) => `blob:${file.name}`),
    })
  })

  it('permite subir fotos, seleccionar y borrar desde la UI reinicializando el input', async () => {
    const user = userEvent.setup()
    const onAddPhotos = vi.fn()
    const onToggleSelection = vi.fn()
    const onRemovePhoto = vi.fn()

    const { container } = render(
      <ZonePhotoGallery
        photos={['https://cdn.example.com/uno.jpg']}
        selectedIndices={[0]}
        analyzedIndices={[]}
        uploadingIndices={new Set()}
        isAnalyzing={false}
        onRetryAnalysis={vi.fn()}
        onToggleSelection={onToggleSelection}
        onRemovePhoto={onRemovePhoto}
        onAddPhotos={onAddPhotos}
      />,
    )

    const image = screen.getByAltText('Foto 0')
    await user.click(image)
    expect(onToggleSelection).toHaveBeenCalledWith(0)

    const removeButton = container.querySelector('button[class*="bg-red-500"]') as HTMLButtonElement
    expect(removeButton).toBeTruthy()
    await user.click(removeButton)
    expect(onRemovePhoto).toHaveBeenCalledWith(0)

    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const nextFile = new File(['b'], 'dos.jpg', { type: 'image/jpeg' })
    await user.upload(input, nextFile)
    expect(onAddPhotos).toHaveBeenCalledTimes(1)

    const refreshedInput = container.querySelector('input[type="file"]') as HTMLInputElement
    expect(refreshedInput).not.toBe(input)
  })

  it('muestra cambios pendientes y badge analizada solo con índices realmente analizados', () => {
    render(
      <ZonePhotoGallery
        photos={['https://cdn.example.com/1.jpg', 'https://cdn.example.com/2.jpg']}
        selectedIndices={[0, 1]}
        analyzedIndices={[0]}
        uploadingIndices={new Set()}
        isAnalyzing={false}
        isAnalyzed
        analysis={{ analysis_status: 'success' } as any}
        onRetryAnalysis={vi.fn()}
        onToggleSelection={vi.fn()}
        onRemovePhoto={vi.fn()}
        onAddPhotos={vi.fn()}
      />,
    )

    expect(screen.getByText('Cambios pendientes')).toBeTruthy()
    expect(screen.getByText('1/2 analizadas')).toBeTruthy()
    expect(screen.getByText('Vuelve a analizar para que el resultado y las fotos seleccionadas vuelvan a coincidir.')).toBeTruthy()
    expect(screen.getAllByText('Analizada')).toHaveLength(1)
  })

  it('permite reintentar cuando el análisis ha fallado', async () => {
    const user = userEvent.setup()
    const onRetryAnalysis = vi.fn()

    render(
      <ZonePhotoGallery
        photos={['https://cdn.example.com/1.jpg']}
        selectedIndices={[0]}
        analyzedIndices={[]}
        uploadingIndices={new Set()}
        isAnalyzing={false}
        analysis={{ analysis_status: 'failed' } as any}
        analysisLevel={3}
        observations={['Foto insuficiente']}
        onRetryAnalysis={onRetryAnalysis}
        onToggleSelection={vi.fn()}
        onRemovePhoto={vi.fn()}
        onAddPhotos={vi.fn()}
      />,
    )

    const retryButton = screen.getByRole('button', { name: 'Reintentar' })
    await user.click(retryButton)
    expect(onRetryAnalysis).toHaveBeenCalledTimes(1)
  })

  it('muestra la animación de escaneo solo mientras el análisis está en curso', () => {
    const { rerender, container } = render(
      <ZonePhotoGallery
        photos={['https://cdn.example.com/1.jpg']}
        selectedIndices={[0]}
        analyzedIndices={[]}
        uploadingIndices={new Set()}
        isAnalyzing={true}
        loadingMessage="Analizando zona de césped..."
        onRetryAnalysis={vi.fn()}
        onToggleSelection={vi.fn()}
        onRemovePhoto={vi.fn()}
        onAddPhotos={vi.fn()}
      />,
    )

    expect(screen.getByText('Analizando zona de césped...')).toBeTruthy()
    expect(screen.getByText('Analizando...')).toBeTruthy()
    expect(container.querySelector('img[alt="Foto 0"]')).toBeNull()
    expect(container.textContent).not.toContain('Añadir foto')
    expect(container.textContent).not.toContain('Editar fotos')

    rerender(
      <ZonePhotoGallery
        photos={['https://cdn.example.com/1.jpg']}
        selectedIndices={[0]}
        analyzedIndices={[]}
        uploadingIndices={new Set()}
        isAnalyzing={false}
        loadingMessage="Analizando zona de césped..."
        onRetryAnalysis={vi.fn()}
        onToggleSelection={vi.fn()}
        onRemovePhoto={vi.fn()}
        onAddPhotos={vi.fn()}
      />,
    )

    expect(screen.queryByText('Analizando zona de césped...')).toBeNull()
    expect(screen.queryByText('Analizando...')).toBeNull()
    expect(container.querySelector('img[alt="Foto 0"]')).toBeTruthy()
    expect(container.textContent).toContain('Añadir foto')
  })

  it('genera confirmación más severa cuando la foto tiene resultados vinculados', () => {
    const copy = buildZonePhotoRemovalConfirmation({
      analysis: { analysis_status: 'success' } as any,
      linkedResultCount: 2,
      subjectLabel: 'el seto',
    })

    expect(copy.title).toBe('Eliminar foto analizada')
    expect(copy.confirmLabel).toBe('Eliminar foto y resultados')
    expect(copy.tone).toBe('danger')
  })
})
