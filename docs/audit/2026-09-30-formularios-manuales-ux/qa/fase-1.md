# F1 — Cimientos sin cambio visible · puerta de prueba

Fecha: 2026-09-30 · Rama `feat/formularios-manuales-ux-v2`.

## Qué se ha hecho

| Archivo | Cambio |
|---|---|
| `src/utils/decimalText.ts` (nuevo) | Lectura de números escritos a mano en español. `parseDecimalText` y `sanitizeDecimalTyping` salen tal cual de `UnifiedNumericInput` (tarifas del jardinero). `readManualNumber` es la lectura del asistente manual para F3: coma o punto decimal (P-15), miles con punto en cantidades («1.000» = 1000, D-07) e `invalid` para lo que no sea un número claro (nunca se adivina) |
| `src/components/gardener/UnifiedNumericInput.tsx` | Usa las dos funciones compartidas. Mismo comportamiento (sus 10 tests intactos y en verde; comprobado en el configurador real: «0.5» → «0,5», «,7» → «0,7»; sin guardar, 0 filas tocadas en la BD) |
| `src/components/booking/manual/presentation/manualEntryPresentation.ts` (nuevo) | Capa de presentación solo de cliente (D-01): pantallas por servicio (hoy una por paso), dependencias de las pantallas condicionales, formato numérico de cada campo y plurales |
| `src/components/booking/manual/presentation/screens.ts` (nuevo) | Pantallas visibles, `stepId` por pantalla, «Pregunta X de Y» que nunca crece (§6.9) y comprobación presentación ↔ schema |
| `src/components/booking/manual/presentation/formatManualValue.ts` (nuevo) | Formato es-ES para la revisión («5.000 m²», «2,3 m», «Acceso normal»). **Sin conectar** (se conecta en F4: hoy cambiaría el resumen) |
| `src/components/booking/manual/ManualEntryWizard.tsx` | Navega por las pantallas de la capa de presentación en vez de por los pasos del schema. Con una pantalla por paso, el resultado es idéntico; cada pantalla emite los `stepId` de todos sus pasos |
| Tests nuevos | `decimalText.test.ts` (16) y `presentation/presentation.test.ts` (21): la presentación cubre cada paso del schema una sola vez y en orden en los 7; con las 88 respuestas de referencia (y el elemento vacío) las pantallas, campos y `stepId` son exactamente los de antes; «Pregunta X de Y» en fitosanitarios nunca crece; formato es-ES |

No se ha tocado: schema, validación, `legalCopy`, constructores, motor, `DetailsPage`, `supabase/`.

## Puerta

| Nivel | Resultado | Frente a la línea base |
|---|---|---|
| A · `npm run typecheck` | 128 errores | **Los mismos 128** (comparados uno a uno) |
| A · `npx vitest run` | 100 archivos · **729/729** | 692 + 37 nuevos; 5 snapshots obsoletos, los mismos; ningún snapshot escrito ni actualizado |
| A · paridad de precio | 88/88 | Idéntica |
| A · alcance (`git diff origin/main` de schema, validación, `legalCopy`, constructores, motor, `supabase`) | vacío | ✅ |
| B · banco | `REPORT.md` y `report.json` **idénticos** a la línea base (medidas de las 432 pantallas, envíos, telemetría, escenarios) | ✅ 0 diferencias |
| B · capturas | 77 capturas: 37 con diferencias de 0-18 píxeles, todas en la barra de progreso a mitad de su animación (franja de 6 px) o en tonos de transición de un botón | ✅ sin cambio visual |
| C · E2E anónimo 375/1280 | 14 filas de la rama = línea base (total, horas, huella, telemetría) | ✅ |
| C · E2E con cliente sembrado | 7 filas = línea base; declaraciones escritas en los 7 | ✅ |
| D · corrección del jardinero | 45 / 178 / 257 / 366 / 270 / 415 / 180 € y sus horas, = línea base | ✅ |

Resultados completos: `~/Downloads/auditorias/formularios-qa/fase-1-{bench,e2e,e2e-login}/`.

## Lo que tienes que hacer tú

- **Local:** nada.
- **Producción:** (nada que desplegar)
