import type { ChangeEvent } from 'react'

function toInputElement(source: ChangeEvent<HTMLInputElement> | HTMLInputElement | null | undefined) {
  if (!source) return null
  if ('currentTarget' in source) return source.currentTarget
  return source
}

export function readAndResetFileInput(
  source: ChangeEvent<HTMLInputElement> | HTMLInputElement | null | undefined,
): File[] {
  const input = toInputElement(source)
  if (!input) return []

  try {
    return Array.from(input.files || []).filter((file): file is File => file instanceof File)
  } finally {
    input.value = ''
  }
}

export function resetFileInput(source: ChangeEvent<HTMLInputElement> | HTMLInputElement | null | undefined) {
  const input = toInputElement(source)
  if (!input) return
  input.value = ''
}
