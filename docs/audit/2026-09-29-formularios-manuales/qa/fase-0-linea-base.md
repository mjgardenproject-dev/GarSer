# Banco de pruebas · línea base (Fase 0, antes de cualquier cambio)

Commit `11a0dad` · 2026-09-29T19:24:58.603Z · anchos 320, 360, 375, 414, 768, 1280 px

| Criterio | Resultado |
|---|---|
| Pantallas medidas | 432 |
| Sin desbordamiento horizontal | ❌ 30 pantallas desbordan |
| CTA visible sin scroll desde arriba (≤ 414 px, alto 667) | ❌ 245 pantallas con el CTA fuera |
| Controles ≥ 44 px | ❌ 44 controles distintos por debajo |
| Errores de consola | ✅ 0 |
| Recorridos sin error del banco | ✅ 0 con error |
| Lo enviado = respuesta de referencia (patch) | ✅ 88/88 |
| Lo enviado = línea base (payload y telemetría) | ✅ 0 distintos |
| Escenarios de hallazgos | ❌ 0/7 |

## Escenarios

| ID | Qué | Observado | Esperado | |
|---|---|---|---|---|
| S-SET-1 | Cuatro toques de «+» en la altura del seto, desde vacío | 0.8 → 1.3 → 1.8 → 2.3 | Pasa por 2,0 m (límite del tramo de tarifa) | ❌ |
| V2-coma | Escribir «1,5» con el teclado en la altura del seto | Campo: «15» · no avanza | Acepta 1,5 y avanza | ❌ |
| FANTASMA-tree | «Añadir otro» + «Atrás» y continuar | Elementos en el resumen: 2 · elementos enviados: 2 · grupos construidos: 2 | Un solo elemento en el resumen y en el envío | ❌ |
| FANTASMA-palm | «Añadir otro» + «Atrás» y continuar | Elementos en el resumen: 2 · elementos enviados: 2 · grupos construidos: 2 | Un solo elemento en el resumen y en el envío | ❌ |
| FANTASMA-phytosanitary | «Añadir otro» + «Atrás» y continuar | Elementos en el resumen: 2 · elementos enviados: 2 · grupos construidos: 2 | Un solo elemento en el resumen y en el envío | ❌ |
| V5-intro | Pulsar Intro tras escribir la superficie | No avanza | Avanza a la siguiente pantalla | ❌ |
| V5-atras | «Atrás» en la primera pantalla del asistente | Visible (no hace nada) | No se muestra | ❌ |

## Desbordamiento horizontal

- 320px · tree/tres-arboles-distintos · inicio · +22px
- 320px · tree/tres-arboles-distintos · error-sin-rellenar · +22px
- 320px · tree/tres-arboles-distintos · elemento-1-size · +22px
- 320px · tree/tres-arboles-distintos · elemento-1-pruning_type · +30px
- 320px · tree/tres-arboles-distintos · elemento-2-size · +54px
- 320px · tree/tres-arboles-distintos · elemento-2-access · +15px
- 320px · tree/tres-arboles-distintos · elemento-3-size · +22px
- 320px · palm/dos-grupos-sin-retirada · inicio · +8px
- 320px · palm/dos-grupos-sin-retirada · error-sin-rellenar · +8px
- 320px · palm/dos-grupos-sin-retirada · elemento-1-species · +8px
- 320px · palm/dos-grupos-sin-retirada · elemento-2-species · +8px
- 320px · shrub/medianas-descuidado · elemento-1-size · +53px
- 320px · shrub/medianas-descuidado · elemento-1-state · +27px
- 320px · phytosanitary/Palmeras-curative-insects · elemento-1-size · +1px
- 320px · phytosanitary/Palmeras-curative-insects · elemento-1-intent · +10px
- 320px · phytosanitary/Palmeras-curative-insects · elemento-1-product · +1px
- 320px · weeding/dificultad_media-con-herbicida · elemento-1-state · +1px
- 360px · tree/tres-arboles-distintos · inicio · +2px
- 360px · tree/tres-arboles-distintos · error-sin-rellenar · +2px
- 360px · tree/tres-arboles-distintos · elemento-1-size · +2px
- 360px · tree/tres-arboles-distintos · elemento-1-pruning_type · +10px
- 360px · tree/tres-arboles-distintos · elemento-2-size · +34px
- 360px · tree/tres-arboles-distintos · elemento-3-size · +2px
- 360px · shrub/medianas-descuidado · elemento-1-size · +33px
- 360px · shrub/medianas-descuidado · elemento-1-state · +7px
- 375px · tree/tres-arboles-distintos · elemento-1-pruning_type · +3px
- 375px · tree/tres-arboles-distintos · elemento-2-size · +27px
- 375px · shrub/medianas-descuidado · elemento-1-size · +26px
- 414px · tree/tres-arboles-distintos · elemento-2-size · +7px
- 414px · shrub/medianas-descuidado · elemento-1-size · +6px

## CTA fuera de la pantalla

- 320px · lawn/normal-80m2 · inicio
- 320px · lawn/normal-80m2 · error-sin-rellenar
- 320px · lawn/normal-80m2 · elemento-1-surface
- 320px · lawn/normal-80m2 · elemento-1-state
- 320px · lawn/normal-80m2 · retirada
- 320px · lawn/normal-80m2 · resumen
- 320px · hedge/altura-2.1m-caras-2-normal · inicio
- 320px · hedge/altura-2.1m-caras-2-normal · error-sin-rellenar
- 320px · hedge/altura-2.1m-caras-2-normal · elemento-1-length
- 320px · hedge/altura-2.1m-caras-2-normal · elemento-1-height
- 320px · hedge/altura-2.1m-caras-2-normal · elemento-1-faces
- 320px · hedge/altura-2.1m-caras-2-normal · elemento-1-state
- 320px · hedge/altura-2.1m-caras-2-normal · retirada
- 320px · hedge/altura-2.1m-caras-2-normal · resumen
- 320px · tree/tres-arboles-distintos · inicio
- 320px · tree/tres-arboles-distintos · error-sin-rellenar
- 320px · tree/tres-arboles-distintos · elemento-1-size
- 320px · tree/tres-arboles-distintos · elemento-1-pruning_type
- 320px · tree/tres-arboles-distintos · elemento-1-access
- 320px · tree/tres-arboles-distintos · elemento-2-size
- 320px · tree/tres-arboles-distintos · elemento-2-pruning_type
- 320px · tree/tres-arboles-distintos · elemento-2-access
- 320px · tree/tres-arboles-distintos · elemento-3-size
- 320px · tree/tres-arboles-distintos · elemento-3-pruning_type
- 320px · tree/tres-arboles-distintos · elemento-3-access
- 320px · tree/tres-arboles-distintos · retirada
- 320px · tree/tres-arboles-distintos · resumen
- 320px · palm/dos-grupos-sin-retirada · inicio
- 320px · palm/dos-grupos-sin-retirada · error-sin-rellenar
- 320px · palm/dos-grupos-sin-retirada · elemento-1-species
- 320px · palm/dos-grupos-sin-retirada · elemento-1-height
- 320px · palm/dos-grupos-sin-retirada · elemento-1-state
- 320px · palm/dos-grupos-sin-retirada · elemento-1-quantity
- 320px · palm/dos-grupos-sin-retirada · elemento-1-extras
- 320px · palm/dos-grupos-sin-retirada · intersticial-1
- 320px · palm/dos-grupos-sin-retirada · elemento-2-species
- 320px · palm/dos-grupos-sin-retirada · elemento-2-height
- 320px · palm/dos-grupos-sin-retirada · elemento-2-state
- 320px · palm/dos-grupos-sin-retirada · elemento-2-quantity
- 320px · palm/dos-grupos-sin-retirada · elemento-2-extras
- 320px · palm/dos-grupos-sin-retirada · intersticial-2
- 320px · palm/dos-grupos-sin-retirada · retirada
- 320px · palm/dos-grupos-sin-retirada · resumen
- 320px · shrub/medianas-descuidado · inicio
- 320px · shrub/medianas-descuidado · error-sin-rellenar
- 320px · shrub/medianas-descuidado · elemento-1-surface
- 320px · shrub/medianas-descuidado · elemento-1-size
- 320px · shrub/medianas-descuidado · elemento-1-state
- 320px · shrub/medianas-descuidado · retirada
- 320px · shrub/medianas-descuidado · resumen
- 320px · phytosanitary/Palmeras-curative-insects · inicio
- 320px · phytosanitary/Palmeras-curative-insects · error-sin-rellenar
- 320px · phytosanitary/Palmeras-curative-insects · elemento-1-affected
- 320px · phytosanitary/Palmeras-curative-insects · elemento-1-area
- 320px · phytosanitary/Palmeras-curative-insects · elemento-1-size
- 320px · phytosanitary/Palmeras-curative-insects · elemento-1-intent
- 320px · phytosanitary/Palmeras-curative-insects · elemento-1-target
- 320px · phytosanitary/Palmeras-curative-insects · elemento-1-product
- 320px · phytosanitary/Palmeras-curative-insects · elemento-1-endotherapy
- 320px · phytosanitary/Palmeras-curative-insects · intersticial-1
- 320px · phytosanitary/Palmeras-curative-insects · resumen
- 320px · weeding/dificultad_media-con-herbicida · elemento-1-state
- 320px · weeding/dificultad_media-con-herbicida · resumen
- 360px · lawn/normal-80m2 · inicio
- 360px · lawn/normal-80m2 · error-sin-rellenar
- 360px · lawn/normal-80m2 · elemento-1-surface
- 360px · lawn/normal-80m2 · elemento-1-state
- 360px · lawn/normal-80m2 · retirada
- 360px · lawn/normal-80m2 · resumen
- 360px · hedge/altura-2.1m-caras-2-normal · inicio
- 360px · hedge/altura-2.1m-caras-2-normal · error-sin-rellenar
- 360px · hedge/altura-2.1m-caras-2-normal · elemento-1-length
- 360px · hedge/altura-2.1m-caras-2-normal · elemento-1-height
- 360px · hedge/altura-2.1m-caras-2-normal · elemento-1-faces
- 360px · hedge/altura-2.1m-caras-2-normal · elemento-1-state
- 360px · hedge/altura-2.1m-caras-2-normal · retirada
- 360px · hedge/altura-2.1m-caras-2-normal · resumen
- 360px · tree/tres-arboles-distintos · inicio
- 360px · tree/tres-arboles-distintos · error-sin-rellenar
- 360px · tree/tres-arboles-distintos · elemento-1-size
- 360px · tree/tres-arboles-distintos · elemento-1-pruning_type
- 360px · tree/tres-arboles-distintos · elemento-1-access
- 360px · tree/tres-arboles-distintos · elemento-2-size
- 360px · tree/tres-arboles-distintos · elemento-2-pruning_type
- 360px · tree/tres-arboles-distintos · elemento-2-access
- 360px · tree/tres-arboles-distintos · elemento-3-size
- 360px · tree/tres-arboles-distintos · elemento-3-pruning_type
- 360px · tree/tres-arboles-distintos · elemento-3-access
- 360px · tree/tres-arboles-distintos · retirada
- 360px · tree/tres-arboles-distintos · resumen
- 360px · palm/dos-grupos-sin-retirada · inicio
- 360px · palm/dos-grupos-sin-retirada · error-sin-rellenar
- 360px · palm/dos-grupos-sin-retirada · elemento-1-species
- 360px · palm/dos-grupos-sin-retirada · elemento-1-height
- 360px · palm/dos-grupos-sin-retirada · elemento-1-state
- 360px · palm/dos-grupos-sin-retirada · elemento-1-quantity
- 360px · palm/dos-grupos-sin-retirada · elemento-1-extras
- 360px · palm/dos-grupos-sin-retirada · elemento-2-species
- 360px · palm/dos-grupos-sin-retirada · elemento-2-height
- 360px · palm/dos-grupos-sin-retirada · elemento-2-state
- 360px · palm/dos-grupos-sin-retirada · elemento-2-quantity
- 360px · palm/dos-grupos-sin-retirada · elemento-2-extras
- 360px · palm/dos-grupos-sin-retirada · retirada
- 360px · palm/dos-grupos-sin-retirada · resumen
- 360px · shrub/medianas-descuidado · inicio
- 360px · shrub/medianas-descuidado · error-sin-rellenar
- 360px · shrub/medianas-descuidado · elemento-1-surface
- 360px · shrub/medianas-descuidado · elemento-1-size
- 360px · shrub/medianas-descuidado · elemento-1-state
- 360px · shrub/medianas-descuidado · retirada
- 360px · shrub/medianas-descuidado · resumen
- 360px · phytosanitary/Palmeras-curative-insects · inicio
- 360px · phytosanitary/Palmeras-curative-insects · error-sin-rellenar
- 360px · phytosanitary/Palmeras-curative-insects · elemento-1-affected
- 360px · phytosanitary/Palmeras-curative-insects · elemento-1-area
- 360px · phytosanitary/Palmeras-curative-insects · elemento-1-size
- 360px · phytosanitary/Palmeras-curative-insects · elemento-1-intent
- 360px · phytosanitary/Palmeras-curative-insects · elemento-1-target
- 360px · phytosanitary/Palmeras-curative-insects · elemento-1-product
- 360px · phytosanitary/Palmeras-curative-insects · elemento-1-endotherapy
- 360px · phytosanitary/Palmeras-curative-insects · resumen
- 360px · weeding/dificultad_media-con-herbicida · elemento-1-state
- 360px · weeding/dificultad_media-con-herbicida · resumen
- 375px · lawn/normal-80m2 · inicio
- 375px · lawn/normal-80m2 · error-sin-rellenar
- 375px · lawn/normal-80m2 · elemento-1-surface
- 375px · lawn/normal-80m2 · elemento-1-state
- 375px · lawn/normal-80m2 · retirada
- 375px · lawn/normal-80m2 · resumen
- 375px · hedge/altura-2.1m-caras-2-normal · inicio
- 375px · hedge/altura-2.1m-caras-2-normal · error-sin-rellenar
- 375px · hedge/altura-2.1m-caras-2-normal · elemento-1-length
- 375px · hedge/altura-2.1m-caras-2-normal · elemento-1-height
- 375px · hedge/altura-2.1m-caras-2-normal · elemento-1-faces
- 375px · hedge/altura-2.1m-caras-2-normal · elemento-1-state
- 375px · hedge/altura-2.1m-caras-2-normal · retirada
- 375px · hedge/altura-2.1m-caras-2-normal · resumen
- 375px · tree/tres-arboles-distintos · inicio
- 375px · tree/tres-arboles-distintos · error-sin-rellenar
- 375px · tree/tres-arboles-distintos · elemento-1-size
- 375px · tree/tres-arboles-distintos · elemento-1-pruning_type
- 375px · tree/tres-arboles-distintos · elemento-1-access
- 375px · tree/tres-arboles-distintos · elemento-2-size
- 375px · tree/tres-arboles-distintos · elemento-2-pruning_type
- 375px · tree/tres-arboles-distintos · elemento-2-access
- 375px · tree/tres-arboles-distintos · elemento-3-size
- 375px · tree/tres-arboles-distintos · elemento-3-pruning_type
- 375px · tree/tres-arboles-distintos · elemento-3-access
- 375px · tree/tres-arboles-distintos · retirada
- 375px · tree/tres-arboles-distintos · resumen
- 375px · palm/dos-grupos-sin-retirada · inicio
- 375px · palm/dos-grupos-sin-retirada · error-sin-rellenar
- 375px · palm/dos-grupos-sin-retirada · elemento-1-species
- 375px · palm/dos-grupos-sin-retirada · elemento-1-height
- 375px · palm/dos-grupos-sin-retirada · elemento-1-state
- 375px · palm/dos-grupos-sin-retirada · elemento-1-quantity
- 375px · palm/dos-grupos-sin-retirada · elemento-1-extras
- 375px · palm/dos-grupos-sin-retirada · elemento-2-species
- 375px · palm/dos-grupos-sin-retirada · elemento-2-height
- 375px · palm/dos-grupos-sin-retirada · elemento-2-state
- 375px · palm/dos-grupos-sin-retirada · elemento-2-quantity
- 375px · palm/dos-grupos-sin-retirada · elemento-2-extras
- 375px · palm/dos-grupos-sin-retirada · retirada
- 375px · palm/dos-grupos-sin-retirada · resumen
- 375px · shrub/medianas-descuidado · inicio
- 375px · shrub/medianas-descuidado · error-sin-rellenar
- 375px · shrub/medianas-descuidado · elemento-1-surface
- 375px · shrub/medianas-descuidado · elemento-1-size
- 375px · shrub/medianas-descuidado · elemento-1-state
- 375px · shrub/medianas-descuidado · retirada
- 375px · shrub/medianas-descuidado · resumen
- 375px · phytosanitary/Palmeras-curative-insects · inicio
- 375px · phytosanitary/Palmeras-curative-insects · error-sin-rellenar
- 375px · phytosanitary/Palmeras-curative-insects · elemento-1-affected
- 375px · phytosanitary/Palmeras-curative-insects · elemento-1-area
- 375px · phytosanitary/Palmeras-curative-insects · elemento-1-size
- 375px · phytosanitary/Palmeras-curative-insects · elemento-1-intent
- 375px · phytosanitary/Palmeras-curative-insects · elemento-1-target
- 375px · phytosanitary/Palmeras-curative-insects · elemento-1-product
- 375px · phytosanitary/Palmeras-curative-insects · elemento-1-endotherapy
- 375px · phytosanitary/Palmeras-curative-insects · resumen
- 375px · weeding/dificultad_media-con-herbicida · elemento-1-state
- 375px · weeding/dificultad_media-con-herbicida · resumen
- 414px · lawn/normal-80m2 · inicio
- 414px · lawn/normal-80m2 · error-sin-rellenar
- 414px · lawn/normal-80m2 · elemento-1-surface
- 414px · lawn/normal-80m2 · elemento-1-state
- 414px · lawn/normal-80m2 · retirada
- 414px · lawn/normal-80m2 · resumen
- 414px · hedge/altura-2.1m-caras-2-normal · inicio
- 414px · hedge/altura-2.1m-caras-2-normal · error-sin-rellenar
- 414px · hedge/altura-2.1m-caras-2-normal · elemento-1-length
- 414px · hedge/altura-2.1m-caras-2-normal · elemento-1-height
- 414px · hedge/altura-2.1m-caras-2-normal · elemento-1-faces
- 414px · hedge/altura-2.1m-caras-2-normal · elemento-1-state
- 414px · hedge/altura-2.1m-caras-2-normal · retirada
- 414px · hedge/altura-2.1m-caras-2-normal · resumen
- 414px · tree/tres-arboles-distintos · inicio
- 414px · tree/tres-arboles-distintos · error-sin-rellenar
- 414px · tree/tres-arboles-distintos · elemento-1-size
- 414px · tree/tres-arboles-distintos · elemento-1-pruning_type
- 414px · tree/tres-arboles-distintos · elemento-1-access
- 414px · tree/tres-arboles-distintos · elemento-2-size
- 414px · tree/tres-arboles-distintos · elemento-2-pruning_type
- 414px · tree/tres-arboles-distintos · elemento-2-access
- 414px · tree/tres-arboles-distintos · elemento-3-size
- 414px · tree/tres-arboles-distintos · elemento-3-pruning_type
- 414px · tree/tres-arboles-distintos · elemento-3-access
- 414px · tree/tres-arboles-distintos · retirada
- 414px · tree/tres-arboles-distintos · resumen
- 414px · palm/dos-grupos-sin-retirada · inicio
- 414px · palm/dos-grupos-sin-retirada · error-sin-rellenar
- 414px · palm/dos-grupos-sin-retirada · elemento-1-species
- 414px · palm/dos-grupos-sin-retirada · elemento-1-height
- 414px · palm/dos-grupos-sin-retirada · elemento-1-state
- 414px · palm/dos-grupos-sin-retirada · elemento-1-quantity
- 414px · palm/dos-grupos-sin-retirada · elemento-1-extras
- 414px · palm/dos-grupos-sin-retirada · elemento-2-species
- 414px · palm/dos-grupos-sin-retirada · elemento-2-height
- 414px · palm/dos-grupos-sin-retirada · elemento-2-state
- 414px · palm/dos-grupos-sin-retirada · elemento-2-quantity
- 414px · palm/dos-grupos-sin-retirada · elemento-2-extras
- 414px · palm/dos-grupos-sin-retirada · retirada
- 414px · palm/dos-grupos-sin-retirada · resumen
- 414px · shrub/medianas-descuidado · inicio
- 414px · shrub/medianas-descuidado · error-sin-rellenar
- 414px · shrub/medianas-descuidado · elemento-1-surface
- 414px · shrub/medianas-descuidado · elemento-1-size
- 414px · shrub/medianas-descuidado · elemento-1-state
- 414px · shrub/medianas-descuidado · retirada
- 414px · shrub/medianas-descuidado · resumen
- 414px · phytosanitary/Palmeras-curative-insects · inicio
- 414px · phytosanitary/Palmeras-curative-insects · error-sin-rellenar
- 414px · phytosanitary/Palmeras-curative-insects · elemento-1-affected
- 414px · phytosanitary/Palmeras-curative-insects · elemento-1-area
- 414px · phytosanitary/Palmeras-curative-insects · elemento-1-size
- 414px · phytosanitary/Palmeras-curative-insects · elemento-1-intent
- 414px · phytosanitary/Palmeras-curative-insects · elemento-1-target
- 414px · phytosanitary/Palmeras-curative-insects · elemento-1-product
- 414px · phytosanitary/Palmeras-curative-insects · elemento-1-endotherapy
- 414px · phytosanitary/Palmeras-curative-insects · resumen
- 414px · weeding/dificultad_media-con-herbicida · elemento-1-state
- 414px · weeding/dificultad_media-con-herbicida · resumen
- 375px · lawn/normal-80m2 (jardinero) · error-sin-rellenar
- 375px · lawn/normal-80m2 (jardinero) · elemento-1-state

## Controles por debajo de 44 px

- Cambiar a fotos (130×24) ×378
- Superficie de césped (112×38) ×21
- Superficie de césped (control deslizante) (246×8) ×3
- Retirada de restos (48×28) ×37
- Editar (77×28) ×61
- Confirmo que la información proporcionada es real (16×16) ×42
- Leer el texto completo (212×16) ×7
- Longitud del seto (112×38) ×18
- Longitud del seto (control deslizante) (246×8) ×3
- Altura del seto (96×36) ×6
- Número de palmeras (96×36) ×12
- Tratamiento de insecticida y fungicida (48×28) ×12
- Limpieza / pelado de tronco (48×28) ×12
- Acceso difícil (48×28) ×12
- Superficie de plantas y arbustos (112×38) ×18
- Superficie de plantas y arbustos (control deslizante) (246×8) ×3
- Cambiar a fotos (111×40) ×2
- Cantidad a tratar (96×36) ×6
- Añadir endoterapia (inyección en tronco) (48×28) ×6
- Cambiar a fotos (121×40) ×2
- Superficie a desbrozar (112×38) ×18
- Superficie a desbrozar (control deslizante) (246×8) ×3
- Aplicar herbicida (48×28) ×6
- Superficie de césped (control deslizante) (286×8) ×3
- Leer el texto completo (252×16) ×7
- Longitud del seto (control deslizante) (286×8) ×3
- Superficie de plantas y arbustos (control deslizante) (286×8) ×3
- Cambiar a fotos (127×40) ×2
- Superficie a desbrozar (control deslizante) (286×8) ×3
- Superficie de césped (control deslizante) (301×8) ×6
- Leer el texto completo (267×16) ×7
- Longitud del seto (control deslizante) (301×8) ×3
- Superficie de plantas y arbustos (control deslizante) (301×8) ×3
- Superficie a desbrozar (control deslizante) (301×8) ×3
- Superficie de césped (control deslizante) (340×8) ×3
- Leer el texto completo (306×16) ×7
- Longitud del seto (control deslizante) (340×8) ×3
- Superficie de plantas y arbustos (control deslizante) (340×8) ×3
- Superficie a desbrozar (control deslizante) (340×8) ×3
- Superficie de césped (control deslizante) (366×8) ×6
- Leer el texto completo (332×16) ×14
- Longitud del seto (control deslizante) (366×8) ×6
- Superficie de plantas y arbustos (control deslizante) (366×8) ×6
- Superficie a desbrozar (control deslizante) (366×8) ×6
