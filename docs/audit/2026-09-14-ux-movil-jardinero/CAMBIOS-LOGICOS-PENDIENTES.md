# Cambios lógicos pendientes — auditoría UX móvil 2026-09-14

**Estado: RESUELTO (2026-09-15).** Los 3 fallos que el usuario marcó como **CAMBIO
LÓGICO** durante la detección (fuera de
[`PLAN-IMPLEMENTACION.md`](PLAN-IMPLEMENTACION.md), que era solo diseño/UX) se
implementaron y verificaron en vivo en una ronda aparte. Se deja el documento como
registro de las decisiones tomadas.

---

## Fallo 9 — Botón "Restablecer" en los configuradores de precio

**Ampliación (2026-09-15)**: pulsar "Restablecer" ya no revierte directo — abre
[`ResetOptionsModal.tsx`](../../../src/components/common/ResetOptionsModal.tsx) con dos
opciones y una X para cerrar sin hacer nada:
1. **Restablecer cambios no guardados** — vuelve a la **última configuración guardada**
   (`savedConfigs[serviceName]`), el comportamiento original.
2. **Restablecer completamente** — vacía el servicio como si nunca se hubiera tocado
   (`SERVICE_RESET[nombre](setConfigs, undefined)`: cada configurador ya sabe convertir
   `value: undefined` en su propio estado vacío, es el mismo camino que sigue un
   servicio nunca configurado). No borra nada en Supabase por sí sola — el jardinero
   sigue necesitando pulsar "Guardar cambios" para persistir el vaciado, y si faltan
   campos obligatorios la validación lo bloquea con un aviso, igual que un guardado
   normal.

**Bug encontrado y corregido durante la implementación**: `TreePruningConfigurator.tsx`
sincronizaba su estado local con `value` mediante `useEffect(() => { if (value) {
setConfig(...) } }, [value])` — el guard `if (value)` ignoraba silenciosamente
`value === undefined`, así que "Restablecer completamente" no vaciaba nada en Poda de
árboles (único de los 7 con este patrón; el resto usa `useMemo` puro sin guard). Se
quitó el guard: `normalizeConfig(undefined)` ya devuelve la forma vacía correcta, igual
que en los otros 6 configuradores.

**Decisión de alcance (opción 1)**: vuelve a la **última configuración guardada**
(`savedConfigs[serviceName]`), no a unos valores de fábrica — coherente con
`handleModalDiscard`, que ya usaba esa misma fuente para "descartar".

**Implementación**: `src/components/gardener/profile-tabs/ServicesTab.tsx` — mapa
`SERVICE_RESET` (uno por servicio, con el envoltorio de normalización que ya usaba
fitosanitarios; se reutiliza pasándole `undefined` para la opción 2) + botón
"Restablecer" en el header del `SlideOver`, deshabilitado si no hay cambios sin
guardar. Vive en `ServicesTab`, no en cada configurador: es el único sitio que ya tenía
`configs`/`setConfigs`/`savedConfigs` a mano.

**Verificado en vivo** (Poda de árboles, con el bug ya corregido, y Poda de palmeras,
sin el bug): la X cierra sin tocar nada; "Restablecer cambios no guardados" vuelve al
último valor guardado; "Restablecer completamente" vacía todos los campos (marcados en
rojo por validación) y deja "Guardar cambios" activo pero bloqueado hasta rellenarlos
de nuevo; la base de datos no cambia hasta guardar explícitamente.

---

## Fallo 10 — Guardado manual en las configuraciones de precio

**Decisión de alcance**: se aplicó **solo a los 7 `*PricingConfigurator.tsx`**
(Palm/Lawn/Hedge/TreePruning/Shrub/Phytosanitary/Weeding), no a `PersonalTab.tsx`,
`CoverageTab.tsx` ni `PhytosanitaryLicenseUpload.tsx` — el fallo, tal y como lo escribió
el usuario, habla explícitamente de "la configuración de precios de los servicios";
esos otros tres formularios siguen con autosave (`useAutoSave`), sin tocar.

**Hallazgo clave durante el análisis**: cada uno de los 7 configuradores aplica su
propia transformación antes de persistir (`processConfigForSave` en setos,
`toPersistedPhytosanitaryConfig` en fitosanitarios, el forzado a 0 del herbicida
desactivado en desbroce). Mover el botón "Guardar" a `ServicesTab` sin más habría
saltado esas transformaciones. Por eso el guardado real sigue viviendo dentro de cada
configurador — solo cambia quién lo dispara.

**Implementación**:
- `src/hooks/useManualSave.ts` (nuevo) — homólogo de `useAutoSave` que calcula
  `isDirty` igual (mismo `deepEqual`) pero nunca guarda solo; expone `save()`. No se
  tocó `useAutoSave.ts` para no arriesgar los otros 3 formularios que siguen usándolo.
- Los 7 configuradores cambian `useAutoSave` → `useManualSave`, registran su `save` y su
  `isDirty` hacia arriba (`registerSave`/`onDirtyChange`, mismo patrón que
  `registerSaveHandler` de Disponibilidad, Fase 5) y quitan el chip
  `SaveStatusIndicator`.
- `SlideOver.tsx` gana un `headerActions` opcional (fila bajo el título) para los
  botones Restablecer/Guardar.
- `ServicesTab.tsx` orquesta: header con nombre del servicio + Restablecer + Guardar
  cambios (deshabilitado hasta que hay cambios), y un aviso `useConfirmDialog`
  (2 botones — "Guardar cambios" / "No guardar", igual que Disponibilidad, tal y como
  pedía el fallo) si se intenta cerrar el panel con cambios sin guardar.
- `ProfileSettings.tsx`: `handleWrapperSave` ahora devuelve `Promise<boolean>` (antes
  `Promise<void>`) para que el header sepa si el guardado tuvo éxito antes de cerrar el
  panel — cambio aditivo, ningún llamador existente se rompe.
- El resto del árbol pre-existente (`expandedServiceId`, `dirtyServices`,
  `checkUnsavedAndAction`, `modalState`/`UnsavedChangesModal`, que guardan cuando se
  cambia de servicio con el botón "Configurar") se dejó **intacto**: sigue
  funcionando para ese caso, y no se tocó para no arriesgarlo.

**Verificado en vivo** (Setos, con `processConfigForSave`; Fitosanitarios, con
`toPersistedPhytosanitaryConfig`; Césped, sin transformación): sin autoguardado (solo
peticiones `GET` mientras se escribe); Guardar cambios persiste el payload ya
transformado (confirmado leyendo `additional_config` real en Supabase); cerrar sin
cambios no muestra aviso; cerrar con cambios muestra el aviso y tanto "Guardar cambios"
como "No guardar" hacen lo correcto y cierran el panel.

---

## Fallo 18 — Ocultar el botón "Reseñas" en Mis Chats para el jardinero

**Implementación**: `src/components/chat/ChatList.tsx` — el botón "Reseñas" del
`rightSlot` del header ahora es `!isGardener ? (<button>...) : undefined`; se quitó la
rama de navegación a `/dashboard` que solo usaba el jardinero (ya no hace falta, el
botón nunca se le muestra).

**Verificado en vivo**: con la cuenta de jardinero de prueba, "Mis Chats" ya no muestra
el botón "Reseñas" en el header (antes sí aparecía).
