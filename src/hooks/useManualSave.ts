import { useCallback, useEffect, useRef, useState } from 'react';
import { deepEqual } from '../utils/deepEqual';

export type ManualSaveStatus = 'idle' | 'saving' | 'saved' | 'error';
export type ManualSaveResult = 'success' | 'invalid' | 'error';

interface UseManualSaveProps<T> {
  value: T;
  initialValue: T;
  /** Debe devolver `true`/`false` según el guardado real haya tenido éxito — a diferencia de
   * `useAutoSave`, aquí el resultado se propaga al botón "Guardar cambios" del header. */
  onSave: (value: T) => Promise<boolean> | boolean;
  validate: (value: T) => string[];
}

/**
 * Homólogo de `useAutoSave` para guardado MANUAL (fallo 10, auditoría UX 2026-09-14): calcula
 * si hay cambios sin guardar (`isDirty`) con la misma comparación `deepEqual`, pero nunca
 * dispara el guardado por sí solo — expone `save()` para que un botón externo lo invoque.
 *
 * No sustituye a `useAutoSave` (que sigue usándose en Información Personal, Cobertura y la
 * licencia fitosanitaria): es un hook nuevo y separado para no arriesgar esos otros flujos.
 */
export function useManualSave<T>({ value, initialValue, onSave, validate }: UseManualSaveProps<T>) {
  const [status, setStatus] = useState<ManualSaveStatus>('idle');
  const valueRef = useRef(value);
  const onSaveRef = useRef(onSave);
  const validateRef = useRef(validate);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    onSaveRef.current = onSave;
    validateRef.current = validate;
  }, [onSave, validate]);

  const isDirty = !deepEqual(value, initialValue);

  // Si el jardinero vuelve a editar tras un guardado o un error, el estado deja de reflejar
  // ese guardado/error pasado.
  useEffect(() => {
    setStatus((prev) => (prev === 'saved' || prev === 'error' ? 'idle' : prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const save = useCallback(async (): Promise<ManualSaveResult> => {
    const errors = validateRef.current(valueRef.current);
    if (errors.length > 0) {
      setStatus('error');
      return 'invalid';
    }
    setStatus('saving');
    try {
      const ok = await onSaveRef.current(valueRef.current);
      setStatus(ok ? 'saved' : 'error');
      return ok ? 'success' : 'error';
    } catch (error) {
      console.error('ManualSave error:', error);
      setStatus('error');
      return 'error';
    }
  }, []);

  return { status, isDirty, save };
}
