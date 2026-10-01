# F5 — Setos · puerta de prueba

Fecha: 2026-10-01 · Rama `feat/formularios-manuales-ux-v2`.

## Qué se ha hecho

Ya venía resuelto de F2-F4 para setos: stepper con rejilla (2,0 m alcanzable), coma decimal, lista
de opciones sin desbordes ni el icono `Square`, «2,3 m» en la revisión.

| Cambio | Detalle | Dónde |
|---|---|---|
| **Medidas en una pantalla** (D-05) | «¿Cuánto mide el seto?» con longitud y altura; una frase de apoyo («Una medida aproximada vale: el profesional la comprueba al llegar.»). Emite `length` y `height` en ese orden. Setos pasa de 5 a **4 preguntas** (6 → 5 pantallas con la revisión) | `manualEntryPresentation.ts` (hedge) |
| **Tramo de tarifa en vivo** | Bajo la altura: «Tramo de tarifa: Bajo (hasta 2 m) / Medio (2-4 m) / Alto (4-6 m)», con las mismas bandas que usa el jardinero (`mapHedgeHeightToBand`, `HEDGE_BAND_LABELS`, solo leídas). Fuera de rango no se enseña tramo, se enseña el error. Sustituye a la ayuda «la altura decide la tarifa…» | idem, `Stepper`/`NumberField` (`feedback`) |
| **Método de medida, sin comparaciones** (D-03) | «¿Cómo lo mido?» plegado: «Longitud: a lo largo del seto. Si hace esquinas o tiene varios tramos, súmalos.» · «Altura: desde el suelo hasta lo más alto, incluidos los muros o estructuras sobre los que crece.» Fuera «coche», «cada paso», «puerta» y la frase repetida | idem, `ManualEntryWizard` (ayuda por pantalla) |
| **Dibujo de las caras** | Pictograma propio visto desde arriba: seto pegado a una pared (una cara) y seto libre (dos caras), con el lado que se recorta marcado. Decorativo (`aria-hidden`): la etiqueta ya lo dice | `ui/Pictogram.tsx`, `OptionList` (`media`) |
| Infraestructura | La presentación admite título, apoyo y ayuda de medida por pantalla, línea de contexto por campo y pictogramas por opción. El conductor del E2E salta los «siguiente» que quedan dentro de una pantalla agrupada (respuestas sin cambios) | `presentation/`, `e2e-local.mjs` |

No se ha tocado: schema, validación, constructor (`length_pricing_m` sigue siendo longitud base),
`hedgeBusinessRules.ts` (solo se lee), motor, `supabase/`.

## Puerta

| Nivel | Resultado |
|---|---|
| A · typecheck | Los mismos 128 errores previos |
| A · vitest | 104 archivos · **777/777** (11 nuevos en `services/HedgeForm.test.tsx`; 3 pruebas ajustadas a la agrupación: comparan pasos y campos aplanados, que es el invariante) |
| A · paridad / alcance | 88/88 · vacío (incluido `src/domain`) |
| B · banco | **100 % en verde**: envío = referencia y = línea base, 0 desbordes, 0 CTA fuera, 0 controles < 44 px, 7/7 escenarios. 426 pantallas (6 menos: la de altura de setos en cada ancho) |
| C · E2E anónimo 375/1280 y con cliente sembrado | 21 filas de la rama = línea base (total, horas, huella, corrección, eventos); declaraciones escritas; desborde 0 px. Setos: 200,25 € · 3 h en `main` y en la rama |
| C · escenarios F4 | Siguen corregidos (1 árbol, 103,50 €; desbroce en «Sí») |
| D · jardinero | 45 €, sin pie fijo en el modal |

Incidencias de la puerta (herramienta, no formulario): H-N-16. Decisión abierta: H-N-15 (enseñar el
tramo deja ver que 2,0 m es el último valor del tramo bajo).

## Pruebas reales

Capturas de la rama a 375 px en `~/Downloads/auditorias/formularios-qa/fase-5-ensayo/`: la pantalla de
medidas cabe entera sin scroll con «Siguiente» visible; las caras se ven con su dibujo.

## Lo que tienes que hacer tú

- **Local:** decidir H-N-15 (mantener el tramo visible —recomendado— o quitarlo).
- **Producción:** (nada que desplegar)
