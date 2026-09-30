# Línea base (pre-fase, 2026-09-30)

Contra estos números se compara la puerta de **cada fase**. Código medido: `origin/main`
(`81397be`) en 5192 y la rama (`e763e86`, idéntica en código) en 5191, sobre el Supabase
local rehecho (139/139 migraciones + siembra + licencia del jardinero, ver `pre-fase.md`).

Resultados completos (capturas incluidas) fuera del repo, en
`~/Downloads/auditorias/formularios-qa/`: `linea-base-bench/`, `linea-base-e2e-final-anon/`,
`linea-base-e2e-final-login/`.

## Nivel A — estático y unitario

| Prueba | Resultado |
|---|---|
| `npm run typecheck` | **128 errores**, todos preexistentes. En la zona manual: 5 en `BookingRequestsManager.tsx` (172, 288, 289, 291, 296) y 1 en `manualEntryValidation.ts:239` (`readonly` de `HEDGE_HEIGHT_BANDS`). Ninguna fase puede subir de 128 ni añadir errores en archivos que toque |
| `npx vitest run` | **98 archivos · 692 pruebas en verde** · 5 snapshots obsoletos (H-N-03) |
| Paridad de precio (`manualEntryPricingParity.test.ts`) | 88/88 idénticos |

## Nivel B — banco de componentes

Informe íntegro: [`linea-base-banco.md`](linea-base-banco.md). Resumen:

| Criterio | Línea base | Qué se espera tras el rediseño |
|---|---|---|
| Lo enviado = respuesta de referencia | ✅ 88/88 | **Igual (obligatorio en todas las fases)** |
| Lo enviado = línea base (payload + telemetría) | ✅ 0 distintos | **Igual (obligatorio en todas las fases)** |
| Errores de consola | ✅ 0 | 0 |
| Desbordamiento horizontal | ❌ 16 pantallas (árboles y arbustos, 320-375 px) | 0 (F3) |
| CTA visible sin scroll (≤ 414 × 667) | ❌ 242 pantallas | 0 en pantallas de pregunta (F2) |
| Controles < 44 px | ❌ 43 distintos (Cambiar a fotos 24 px, interruptores 28 px, casilla 16 px, deslizadores 8 px, campos 36-38 px, «Editar» 28 px) | 0 (F2-F4) |
| Escenarios | ❌ 0/7 | 7/7 al final de F4 (S-SET-1 y V2 en F3, fantasmas en F4, V5-intro en F3, V5-atrás en F2) |

Confirmado por el banco y añadido a la auditoría: el **elemento fantasma** también se crea en
palmeras y fitosanitarios (P-01) y **la coma decimal multiplica el valor** («1,5» → «15», P-15).

## Nivel C — app real, anónima (375 y 1280 px) y con cliente sembrado (375 px)

Idéntico en `main` y en la rama, en los dos anchos y con y sin sesión:

| Servicio | Respuestas (`SPECS` de `e2e-local.mjs`) | Total «Profesionales» | Horas | Huella de lo guardado | Eventos `booking.manual_*` |
|---|---|---|---|---|---|
| Césped | 80 m², descuidado, con retirada | **50,63 €** | 1 h | `e63f0fdb20453bfc` | 6 |
| Setos | 14 m, 2,1 m, dos caras, normal, con retirada | **200,25 €** | 3 h | `3c87dad69d0dfb31` | 8 |
| Árboles | mediano/estructural/normal + grande/formación/difícil, con retirada | **289,13 €** | 3 h | `de7ae9bcd74ad93b` | 10 |
| Palmeras | canaria 4-10 m normal ×2 + Washingtonia 4-12 m descuidada con acceso difícil, sin retirada | **411,75 €** | 5 h | `1b166be31abf721f` | 14 |
| Arbustos | 30 m², medianas, descuidadas, con retirada | **303,75 €** | 6 h | `46d29df39c1525db` | 7 |
| Fitosanitarios | 3 árboles grandes curativo hongos ecológico + 2 palmeras medianas preventivo convencional con endoterapia | **466,88 €** | 2 h | `25a54c8b95f0f71f` | 16 |
| Desbroce | 300 m², dificultad media, con herbicida, sin retirada | **202,50 €** | 5 h | `14e82f122e83f7f4` | 5 |

- Declaraciones (`--login`): escritas en `booking_manual_declarations` en los 7 servicios, con la
  misma huella en `main` y en la rama.
- Desborde a 375 px en la app real: árboles 15 px, arbustos 13 px (el resto 0).
- Consola/HTTP: 0 errores, salvo un `ERR_TIMED_OUT` puntual de un recurso externo en una pasada
  de arbustos (ruido de red, no de la app).

## Nivel D — precio de la corrección del jardinero (`recalculate_correction`)

Con lo que dejó guardado cada reserva y el jardinero sembrado (importe **al profesional**, sin
gastos de gestión; la reserva muestra las horas redondeadas hacia arriba):

| Servicio | Importe | Horas |
|---|---|---|
| Césped | 45 € | 1 |
| Setos | 178 € | 2,5 |
| Árboles | 257 € | 3 |
| Palmeras | 366 € | 4,5 |
| Arbustos | 270 € | 5,5 |
| Fitosanitarios | 415 € | 2 |
| Desbroce | 180 € | 4,5 |

La interfaz del modal del jardinero la cubre el banco (`gardener=1`). El recorrido real en el
panel exige una reserva pagada: queda para F4/F12 con autorización del pago de prueba.
