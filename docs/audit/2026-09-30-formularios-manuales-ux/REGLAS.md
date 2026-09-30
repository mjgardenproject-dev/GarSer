# Reglas esenciales de la ronda

Se leen al empezar cada sesión. Si una regla entra en conflicto con una idea de diseño,
gana la regla; la idea se anota en `HALLAZGOS-NUEVOS.md` y se consulta al usuario.

## A. Datos y precio (no negociables)

1. **No se tocan** `src/shared/manualEntry/manualEntrySchema.ts`, `manualEntryValidation.ts`,
   `legalCopy.ts`, `src/pages/reserva/manualEntryBuilders.ts`, `src/shared/bookingQuoteCore.ts`,
   `src/domain/*BusinessRules.ts`, `supabase/**`, ni la configuración de los jardineros.
   Si un cambio de interfaz parece necesitarlo, **se para** y se consulta.
2. Cada campo envía **la misma clave, el mismo valor y el mismo tipo** que hoy. Cambiar el
   control (slider → campo, tarjetas → lista) está permitido; cambiar lo que se envía, no.
3. Rangos, pasos, defaults y opciones: los del schema. La presentación puede **ocultar**
   algo que el constructor ya ignora (P-04), nunca inventar ni quitar opciones que cuenten.
4. **Nunca se corrige un valor en silencio.** Si el cliente escribe algo fuera de rango, se
   le muestra el error; no se ajusta al máximo por él.
5. Los recargos y extras con coste se eligen a la vista. El único extra activado por
   defecto sigue siendo el fitosanitario de palmeras (decisión de negocio vigente).
6. `ManualWizardSubmitPayload` (`items[]`, `wasteRemoval`) y las props públicas de
   `ManualEntryWizard` no cambian. Solo se añaden props opcionales.
7. Telemetría: mismos eventos y mismos `stepId`, en el orden del schema, aunque varias
   preguntas compartan pantalla.
8. El texto legal no cambia ni en una coma. `MANUAL_ENTRY_LEGAL_VERSION` tampoco.
9. `manualEntryPricingParity.test.ts` **nunca** se actualiza con `-u` y
   `scripts/qa/manual-entry/baseline/payloads.json` **nunca** se regenera en esta ronda.
   Si difieren, hay un fallo que arreglar.

## B. Alcance y forma de trabajar

10. Una fase cada vez, en el orden del plan. No se adelanta trabajo de fases futuras.
11. Toda modificación del shell (`ManualEntryWizard`, `ManualFieldRenderer`,
    `ManualEntrySummary`, `ManualEntryChoice`, `ui/*`) se verifica en **los 7 servicios y en
    el modal de corrección del jardinero** (`BookingRequestsManager.tsx`).
12. Reutilizar antes que crear: `ConfirmDialog`, el patrón de segmentado de
    `AvailabilityManager`, el parseo de `UnifiedNumericInput`, el registro de iconos.
13. Sin refactorizaciones fuera de la zona manual. `DetailsPage.tsx` solo se toca en el
    montaje del asistente y, con D-02 aprobado, en `initialWasteRemoval`.
14. Microcopy: es-ES, segunda persona, sin exclamaciones, sin anglicismos, sin emojis,
    preguntas directas. Textos que cambian la interpretación de un dato de precio
    (referencias de altura, unidades) **los aprueba el usuario**.

## C. Diseño

15. Móvil primero (320-430 px). Nada de 2 columnas por debajo de `md:`.
16. Una sola barra de progreso en pantalla. Un solo nivel de superficie (sin tarjeta dentro
    de tarjeta). Sin sombras decorativas, sin degradados, sin animaciones decorativas.
17. Zonas táctiles ≥ 44 px; filas de opción ≥ 56 px; inputs con fuente ≥ 16 px.
18. Ningún elemento cambia de tamaño al seleccionarlo.
19. Texto con contraste ≥ 4,5:1 (fuera `gray-400` para texto).
20. Iconos Lucide del registro, con el mismo significado en los 7 servicios.

## D. Seguridad del trabajo

21. Commit al terminar cada fase **y** commit inmediato de cualquier documento escrito
    (el árbol de trabajo se ha revertido solo dos veces en septiembre de 2026).
22. Antes de cada fase: `git status` limpio y rama correcta. Si aparecen cambios que
    deshacen commits, **no** se commitean: `git stash` y se investiga.
23. Solo local hasta F12. Nada de despliegues, `supabase db push` ni `functions deploy`
    en esta ronda salvo el despliegue final del frontend, aprobado por el usuario.
24. Pagos: solo tarjeta de prueba de Stripe en local y con autorización explícita del
    usuario **en esta ronda**.
25. Cada fase termina con la sección «Lo que tienes que hacer tú» (local y producción),
    aunque sea «(nada que desplegar)».
