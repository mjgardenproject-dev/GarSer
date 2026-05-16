import { useEffect, useRef, useState } from 'react';
import { deepEqual } from '../utils/deepEqual';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface UseAutoSaveProps<T> {
  value: T;
  initialValue: T;
  onSave: (value: T) => Promise<void> | void;
  validate: (value: T) => string[];
  delay?: number;
}

export function useAutoSave<T>({ value, initialValue, onSave, validate, delay = 1000 }: UseAutoSaveProps<T>) {
  const [status, setStatus] = useState<SaveStatus>('idle');
  const saveTimeout = useRef<NodeJS.Timeout | null>(null);
  const onSaveRef = useRef(onSave);
  const validateRef = useRef(validate);

  useEffect(() => {
    onSaveRef.current = onSave;
    validateRef.current = validate;
  }, [onSave, validate]);

  useEffect(() => {
    // Avoid saving if value hasn't changed from initial
    if (deepEqual(value, initialValue)) {
      return;
    }

    if (saveTimeout.current) {
      clearTimeout(saveTimeout.current);
    }

    setStatus('idle'); // Reset to idle when user starts typing

    saveTimeout.current = setTimeout(async () => {
      const errors = validateRef.current(value);
      if (errors.length === 0) {
        try {
          setStatus('saving');
          await onSaveRef.current(value);
          setStatus('saved');
          // Reset to idle after 3 seconds
          setTimeout(() => setStatus('idle'), 3000);
        } catch (error) {
          console.error('AutoSave error:', error);
          setStatus('error');
        }
      }
    }, delay);

    return () => {
      if (saveTimeout.current) {
        clearTimeout(saveTimeout.current);
      }
    };
  }, [value, initialValue, delay]);

  return { status };
}

