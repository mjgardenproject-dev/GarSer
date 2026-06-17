/**
 * Manual Entry — UI strings (es-ES)
 * -------------------------------------------------------------
 * Centralized copy for the manual-entry wizard chrome. There is no i18n layer
 * in the project today; centralizing here (instead of hardcoding inline) keeps
 * the strings ready for a future i18n adoption and avoids duplication.
 */

export const MANUAL_ENTRY_STRINGS = {
  choice: {
    heading: '¿Cómo quieres calcular tu presupuesto?',
    subheading: 'Elige la opción que mejor te venga. Podrás cambiar de opción en cualquier momento sin perder lo que ya hayas hecho.',
    photo: {
      title: 'Analizar mi jardín con fotos',
      badge: 'Recomendado',
      description: 'Sube fotos y nuestra IA mide tu jardín. Presupuesto más preciso y rápido.',
    },
    manual: {
      title: 'Prefiero introducir los datos manualmente',
      description: 'Responde unas preguntas sencillas sobre tu jardín. Ideal si no estás en casa ahora mismo.',
    },
  },
  wizard: {
    stepProgress: (current: number, total: number) => `Paso ${current} de ${total}`,
    back: 'Atrás',
    next: 'Siguiente',
    continueToSummary: 'Revisar mis datos',
    addItem: 'Añadir otro',
    finishItems: 'Continuar',
    edit: 'Editar',
    switchToPhotos: 'Cambiar a fotos',
    priceHint: 'Verás el precio con cada profesional en el siguiente paso.',
  },
  summary: {
    title: 'Revisa tus datos antes de continuar',
    subtitle: 'Comprueba que todo es correcto. Puedes editar cualquier dato.',
    itemLabel: (noun: string, index: number) => `${noun.charAt(0).toUpperCase()}${noun.slice(1)} ${index + 1}`,
  },
  consent: {
    confirmCta: 'Confirmar y continuar',
    checkboxAriaLabel: 'Confirmo que la información proporcionada es real',
    mustAccept: 'Debes confirmar que los datos son reales para continuar.',
  },
  errors: {
    submitFailed: 'No hemos podido guardar tus datos. Inténtalo de nuevo.',
    outOfRange: 'Revisa los valores marcados: alguno está fuera del rango permitido.',
    genericRetry: 'Algo no ha ido bien. Inténtalo de nuevo en unos segundos.',
  },
  gardener: {
    manualBadge: 'Datos introducidos manualmente por el cliente · no verificados por IA',
    manualBadgeShort: 'Datos manuales',
    correctionHint: 'Revisa las medidas al llegar. Si no coinciden, puedes proponer un nuevo precio.',
  },
} as const;
