/**
 * Manual Entry — UI strings (es-ES)
 * -------------------------------------------------------------
 * Centralized copy for the manual-entry wizard chrome. There is no i18n layer
 * in the project today; centralizing here (instead of hardcoding inline) keeps
 * the strings ready for a future i18n adoption and avoids duplication.
 */

export const MANUAL_ENTRY_STRINGS = {
  choice: {
    heading: '¿Cómo calculamos tu presupuesto?',
    /** Va debajo de las tarjetas y en texto menor: tranquiliza, pero no debe ocupar
     * el primer pliegue del móvil por delante de la tarea real. */
    subheading: 'Puedes cambiar de opción cuando quieras sin perder lo que ya hayas hecho.',
    photo: {
      title: 'Con fotos',
      badge: 'Recomendado',
      description: 'La IA mide tu jardín. Más rápido y preciso.',
    },
    manual: {
      title: 'Escribo los datos',
      description: 'Respondes unas preguntas sencillas.',
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
    /**
     * Etiqueta corta de la casilla. El texto legal íntegro sigue siendo el que se registra y
     * se prueba (`MANUAL_ENTRY_CONSENT_TEXT`); esto es su resumen legible, con el texto
     * completo a un toque en el desplegable de al lado.
     */
    shortLabel:
      'Confirmo que los datos son reales. Si al llegar el profesional encuentra algo distinto, ' +
      'te propondrá un precio nuevo antes de empezar.',
    fullTextToggle: 'Leer el texto completo',
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
