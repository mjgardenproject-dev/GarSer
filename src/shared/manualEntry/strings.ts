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
    /** «Paso» es el de la reserva («Paso 3 de 5»); dentro del asistente se habla de preguntas. */
    questionProgress: (current: number, total: number) => `Pregunta ${current} de ${total}`,
    reviewLabel: 'Revisión',
    addMoreTitle: '¿Quieres añadir más?',
    addedCount: (countText: string) => `Has añadido ${countText}.`,
    backToReview: 'Volver a la revisión',
    remove: 'Eliminar',
    duplicate: 'Duplicar',
    duplicated: (newTitle: string, sourceTitle: string) =>
      `Añadido el ${newTitle.toLowerCase()}, igual que el ${sourceTitle.toLowerCase()}.`,
    change: 'Cambiar',
    complete: 'Completar',
    missingData: 'Faltan datos',
    removeConfirmTitle: (title: string) => `¿Eliminar ${title.toLowerCase()}?`,
    removeConfirmMessage: 'Se borran sus respuestas y no entra en la reserva.',
    removeConfirmCta: 'Eliminar',
    keepCta: 'Conservar',
    incompleteNote: (title: string) => `Completa o elimina «${title}» para continuar.`,
    incompleteSingleNote: 'Completa los datos que faltan para continuar.',
    back: 'Atrás',
    next: 'Siguiente',
    continueToSummary: 'Revisar mis datos',
    addItem: 'Añadir otro',
    finishItems: 'Continuar',
    edit: 'Editar',
    switchToPhotos: 'Cambiar a fotos',
    priceHint: 'Verás el precio con cada profesional en el siguiente paso.',
  },
  /**
   * Retirada de restos como elección explícita (D-09): el mismo booleano y el mismo valor por
   * defecto (sí), pero se ve qué se elige y que puede tener coste. Mismo sentido que el
   * interruptor «Incluir retirada de restos» del modo fotos.
   */
  waste: {
    yes: { label: 'Sí, que se lleven los restos', help: 'Puede tener un coste adicional según el profesional.' },
    no: { label: 'No, me encargo yo', help: 'Te haces cargo de los restos que deje el trabajo.' },
  },
  summary: {
    title: 'Revisa tus datos antes de continuar',
    subtitle: 'Comprueba que todo es correcto. Puedes editar cualquier dato.',
    itemLabel: (noun: string, index: number) => `${noun.charAt(0).toUpperCase()}${noun.slice(1)} ${index + 1}`,
  },
  consent: {
    confirmCta: 'Confirmar y continuar',
    checkboxAriaLabel: 'Confirmo que la información proporcionada es real',
    mustAccept: 'Marca la casilla para poder continuar.',
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
