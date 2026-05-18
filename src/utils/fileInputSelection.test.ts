// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { readAndResetFileInput, resetFileInput } from './fileInputSelection'

describe('fileInputSelection', () => {
  it('consume y resetea el input file en un único paso', () => {
    const input = {
      files: [],
      value: 'C:\\fakepath\\uno.jpg',
    } as unknown as HTMLInputElement
    const firstFile = new File(['a'], 'uno.jpg', { type: 'image/jpeg' })

    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [firstFile],
    })

    const files = readAndResetFileInput(input)

    expect(files).toHaveLength(1)
    expect(files[0].name).toBe('uno.jpg')
    expect(input.value).toBe('')
  })

  it('permite reutilizar el mismo input con otra selección tras el reset', () => {
    const input = {
      files: [],
      value: 'C:\\fakepath\\uno.jpg',
    } as unknown as HTMLInputElement

    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File(['a'], 'uno.jpg', { type: 'image/jpeg' })],
    })
    readAndResetFileInput(input)

    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File(['b'], 'dos.jpg', { type: 'image/jpeg' })],
    })
    input.value = 'C:\\fakepath\\dos.jpg'

    const secondSelection = readAndResetFileInput(input)

    expect(secondSelection).toHaveLength(1)
    expect(secondSelection[0].name).toBe('dos.jpg')
    expect(input.value).toBe('')
  })

  it('resetea el input también cuando se llama de forma explícita', () => {
    const input = {
      files: [],
      value: 'C:\\fakepath\\foto.jpg',
    } as unknown as HTMLInputElement

    resetFileInput(input)

    expect(input.value).toBe('')
  })
})
