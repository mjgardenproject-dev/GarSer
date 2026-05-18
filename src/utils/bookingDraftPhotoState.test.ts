import { describe, expect, it, vi } from 'vitest'

import {
  collectDraftPhotoFilesFromBookingData,
  restoreDraftPhotoFilesInBookingData,
} from './bookingDraftPhotoState'

describe('bookingDraftPhotoState', () => {
  it('recoge archivos locales indexados por photoId desde colecciones anidadas', () => {
    const file = new File(['abc'], 'foto.jpg', { type: 'image/jpeg', lastModified: 123 })

    const collected = collectDraftPhotoFilesFromBookingData({
      lawnZones: [
        {
          id: 'zone-1',
          photoIds: ['photo-1'],
          photoUrls: ['blob:photo-1'],
          files: [file],
        },
      ],
      servicesData: {
        svc: {
          hedgeZones: [
            {
              faceA: {
                photoIds: ['photo-2'],
                photoUrls: ['blob:photo-2'],
                files: [new File(['x'], 'otra.jpg', { type: 'image/jpeg', lastModified: 999 })],
              },
            },
          ],
        },
      },
    })

    expect(Array.from(collected.keys())).toEqual(['photo-1', 'photo-2'])
    expect(collected.get('photo-1')).toBe(file)
  })

  it('rehidrata fotos locales desde el resolver y poda las no recuperables sin dejar índices corruptos', async () => {
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn((file: File) => `blob:restored:${file.name}`),
    })

    const restoredFile = new File(['restored'], 'restored.jpg', { type: 'image/jpeg', lastModified: 456 })
    const resolver = vi.fn(async (photoId: string) => (photoId === 'photo-1' ? restoredFile : null))

    const result = await restoreDraftPhotoFilesInBookingData(
      {
        lawnZones: [
          {
            id: 'zone-1',
            photoIds: ['photo-1', 'photo-2'],
            photoUrls: [],
            files: [],
            selectedIndices: [0, 1],
            analyzedIndices: [1],
          },
        ],
      },
      resolver,
    )

    expect(result.restoredCount).toBe(1)
    expect(result.missingPaths).toEqual(['lawnZones[0].photoIds[1]'])
    expect(result.restoredData).toEqual({
      lawnZones: [
        {
          id: 'zone-1',
          photoIds: ['photo-1'],
          photoUrls: ['blob:restored:restored.jpg'],
          files: [restoredFile],
          selectedIndices: [0],
          analyzedIndices: [],
        },
      ],
    })
  })
})
