# Pruebas importantes antes de subir a producción

Solo lo imprescindible para que una **primera versión funcione bien** con anuncios en marcha: que se pueda entrar, reservar,
pagar lo justo, que el profesional acepte o rechace, que el dinero se cobre o se devuelva cuando toca y que nadie se quede
con un cargo sin reserva. El detalle de cada caso está en `docs/audit/2026-07-12/PRUEBAS-PRODUCCION.md` (sección indicada).

Cómo pasarlas: en **garser.es**, desde un **móvil** (iPhone a ser posible), con una cuenta de cliente y otra de profesional
de prueba. Donde haya cobro, con una tarjeta real e importe pequeño; lo cobrado se devuelve cancelando con 24 h o más.
Marca cada línea: ✅ bien · ❌ mal (apunta qué viste).

La columna **Paquete** dice de qué paquete del plan (`docs/qa-simulacro/PLAN-FASE-4.md`) depende la prueba: «Ya hecho»
es algo que ya funciona hoy y solo hay que comprobar que sigue igual; un número (1.1, 1.2…) es un arreglo de la FASE 4 que
tiene que estar desplegado antes de pasarla.

## 1. Entrar en la web

| # | Prueba | Debe pasar | Paquete |
|---|---|---|---|
| T1.1 | Crear cuenta de cliente con un correo nuevo | Llega el correo de confirmación; al confirmarlo puedes entrar | Ya hecho |
| T1.2 | Entrar con una cuenta sin confirmar | Mensaje en español junto al formulario y botón «Reenviar el correo de confirmación»; los correos de Auth llegan en español (QA-039, sección 49; **pegar antes las plantillas de `supabase/templates/`**) | 1.11 |
| T1.3 | «¿Has olvidado tu contraseña?» | Llega el correo en español, la pantalla dice de qué cuenta es, cambias la contraseña y entras con la nueva; un enlace ya usado dice «Enlace caducado» (QA-040, sección 49) | 1.11 |
| T1.4 | «Continuar con Google» (cliente y profesional) | Entra con el tipo de cuenta correcto | Ya hecho |
| T1.5 | Cerrar sesión (o que se cierre desde otro dispositivo) y entrar con OTRA cuenta en el mismo móvil; con la sesión iniciada, abrir /auth | Aterriza en su inicio, no en una pantalla de la cuenta anterior ni en «Acceso denegado»; /auth lleva al inicio (QA-155, QA-012, sección 48) | 1.10 |

## 2. Reservar y pagar (cliente)

| # | Prueba | Debe pasar | Paquete |
|---|---|---|---|
| T2.1 | Reserva completa de «Corte de césped» escribiendo los datos a mano, hasta pagar | Antes de pagar ves cuánto pagas hoy (gastos de gestión) y cuánto al profesional; en Stripe aparece **exactamente** ese importe de gastos, **retenido, no cobrado** | Ya hecho |
| T2.2 | La reserva aparece en «Mis reservas» | Una sola vez, «Pendiente», con su importe | Ya hecho |
| T2.3 | Llega el correo de confirmación | Al cliente y al profesional | Ya hecho |
| T2.4 | Pulsar «Pagar» dos veces muy seguidas | Una sola reserva y un solo pago en Stripe | Ya hecho |
| T2.5 | Reservar por el enlace o QR del profesional | Paga la tarifa del enlace (la que diga Ajustes → Comisiones), no la general | Ya hecho |

| T2.17 | Antes de pagar una reserva con gastos | Se explica qué son, su porcentaje y que se retienen y se liberan si no acepta; el botón dice «Retener X € y enviar» y al terminar «Solicitud enviada · importe retenido» (sección 45) | 1.7 |
| T2.18 | «Mis reservas» con una caducada y una completada | La caducada dice que no se cobró y ofrece «Volver a reservar»; la completada no dice «Pagado al profesional» | 1.7 |

### Nuevas de la fase 1.1 — pago con el horario caducado y tarjeta rechazada (sección 39)

| # | Prueba | Debe pasar | Paquete |
|---|---|---|---|
| T2.6 | Abre el pago, escribe una tarjeta y **cierra la hoja con la X** | Recuadro «Pago listo» con «**Aún no se te ha cobrado nada.**» | 1.1 |
| T2.7 | Deja la hoja de pago abierta **31 minutos** sin pagar | La hoja se cierra sola: «Tiempo agotado · **No se te ha cobrado nada.**»; en el banco no hay cargo ni retención | 1.1 |
| T2.8 | Paga con una tarjeta que el banco rechace y después, en el mismo formulario, con una buena | Con la rechazada, aviso arriba «No se ha completado el pago… No se te ha cobrado nada»; con la buena, «Pago confirmado y reserva creada» y la reserva sale **una sola vez** | 1.1 |
| T2.9 | Editor SQL de Supabase: `select has_function_privilege('authenticated', 'public.release_booking_payment_attempt(uuid, text, text, text, jsonb)', 'EXECUTE');` | `false` | 1.1 |
| T2.10 | Editor SQL: `select count(*) from public.list_orphan_payment_authorizations(200);` una hora después de desplegar | `0` (ningún pago retenido sin reserva) | 1.1 |
| T2.11 | Stripe → Desarrolladores → Webhooks → endpoint `booking-payment-webhook` | Suscrito a `payment_intent.payment_failed` y `payment_intent.canceled` además de `amount_capturable_updated` y `succeeded` | 1.1 |
| T2.12 | 48 h después de publicar, Stripe → Pagos → «No capturados» | Todos tienen reserva; ninguno sin reserva de más de 10 minutos | 1.1 |

### Nuevas de la fase 1.4 — primera reserva una a la vez y clave del enlace (sección 42)

| # | Prueba | Debe pasar | Paquete |
|---|---|---|---|
| T2.13 | Antes de aplicar la migración del 1.4, la consulta 42.0 en el editor SQL | Ninguna fila (si sale alguna, no se aplica y se avisa) | 1.4 |
| T2.14 | Con la misma cuenta, dos reservas seguidas con el mismo profesional sin que acepte la primera | La segunda lleva la tarifa de «siguientes» y el aviso «Ya tienes otra reserva en curso con …»; si cancelas la primera, vuelve la de primera | 1.4 |
| T2.15 | En el mismo móvil, «Cerrar sesión» y entrar con otra cuenta; abrir la dirección del profesional sin `?c=` | Paga la tarifa de GarSer (no la del enlace) y ve el aviso de que no es el enlace personal | 1.4 |
| T2.16 | Abrir un enlace antiguo después de «Cambiar mi enlace» | Aviso «Este enlace ya no es el vigente…» en vez de un precio distinto sin explicación | 1.4 |
| T2.20 | En un iPhone pequeño, pagar la reserva: botón de pago, hoja «Pago seguro» con teclado y con un error de caducidad, y la confirmación | El botón no queda bajo Safari, «Pagar» y los errores se ven con el teclado abierto y la confirmación sale arriba (QA-103, QA-135, QA-136) | 1.16 |

## 3. El profesional

| # | Prueba | Debe pasar | Paquete |
|---|---|---|---|
| T3.1 | Alta de profesional nueva → el admin la aprueba | Le llega el aviso; al entrar ve su panel y el cuestionario «Activa tu cuenta» | Ya hecho |
| T3.2 | Completar la activación (servicio, zona, horario) | Al terminar va a su panel (QA-196) y aparece a los clientes de su zona | 1.12 |
| T3.3 | En una cuenta con equipo en la que el titular trabaja, activar un servicio nuevo | Queda asignado al titular, el perfil público lo lista y un cliente puede reservarlo; si nadie puede hacerlo (p. ej. fitosanitarios sin carnet), la fila dice «nadie de tu equipo lo hace… Asígnalo en «Equipo»» en vez de «los clientes pueden reservarlo» | 1.3 |
| T3.6 | Pestaña «Equipo» de una empresa | Cada persona muestra sus próximos trabajos (o «Sin trabajos asignados próximamente») | 1.3 |
| T3.7 | Editor SQL: `select has_table_privilege('authenticated', 'public.public_gardener_directory', 'UPDATE');` | `false` (antes cualquier usuario podía reescribir el perfil de cualquier profesional) | 1.3 |
| T3.4 | **Aceptar** la solicitud de 2.1 | Reserva «Confirmada»; en Stripe los gastos pasan de retenidos a **cobrados** | Ya hecho |
| T3.5 | **Rechazar** otra solicitud | Reserva rechazada; en Stripe la retención se **libera** (0 € cobrados) | Ya hecho |

### Nueva de la fase 1.5 — servicio desactivado (sección 43)

| # | Prueba | Debe pasar | Paquete |
|---|---|---|---|
| T3.8 | El admin desactiva un servicio mientras un cliente lo tiene a medias en la confirmación | Al pulsar «Continuar al pago»: «Este servicio ya no se puede reservar», sin cobro, y el servicio ya no sale ni en la lista ni en los perfiles; al reactivarlo vuelve | 1.5 |

### Nueva de la fase 1.8 — avisos legales de fitosanitarios (sección 46)

| # | Prueba | Debe pasar | Paquete |
|---|---|---|---|
| T3.9 | Reservar fitosanitarios con producto convencional (o desbroce con herbicida) | Sale el aviso «Tratamiento con producto fitosanitario» con la casilla sin marcar y no se avanza sin marcarla; con ecológico no sale | 1.8 |
| T3.10 | /terminos y la subida del carnet del profesional | Los términos tienen las secciones 8 y 9 de fitosanitarios y responsabilidad; la declaración del carnet nombra el RD 1311/2012. **Textos pendientes de revisión legal** | 1.8 |
| T3.20 | Profesional recién aprobado entra; «Ir a mi panel» tras activar con el carnet pendiente; sal y vuelve a entrar | Ve «Te hemos aprobado»; «Ir a mi panel» lleva al panel con «Completa tu cuenta profesional»; el cuestionario NO se reabre solo (QA-196, QA-108, QA-024) | 1.12 |
| T3.21 | En el cuestionario: errores del Horario y del seguro; recargar con invitaciones escritas; solicitud de reserva sin responder | El motivo sale junto al botón; lo escrito sigue tras recargar; el aviso «Tienes N solicitudes…» lleva a verlas (QA-025, QA-026, QA-062) | 1.12 |
| T3.22 | Profesional con un día bloqueado y horas extra en su agenda cambia SOLO la antelación en «Horario fijo» | El aviso dice que la agenda no se toca y el bloqueo y las horas extra siguen después de guardar (QA-043) | 1.13 |
| T3.23 | Desbroce: apagar y volver a encender el herbicida, con el carnet aprobado | El precio vuelve al de antes, no queda a 0 (QA-050) | 1.13 |
| T3.24 | El admin aprueba una solicitud con foto; mira el perfil del profesional (Mi cuenta, perfil público, «Completa tu cuenta») | Tiene su foto y su nombre en los tres sitios y no se la vuelve a pedir (QA-014); sin foto salen sus iniciales, nunca una imagen rota (QA-023) | 1.14 |
| T3.25 | Una empleada entra y mira su menú; un cliente abre /mi-trabajo/bienvenida | La empleada solo ve Mi trabajo, Mi horario y Mi cuenta; el cliente no ve «Tu empresa te ha añadido…» (QA-030, QA-003) | 1.15 |

## 4. Cancelar y devolver

| # | Prueba | Debe pasar | Paquete |
|---|---|---|---|
| T4.1 | El cliente cancela con **24 h o más** una reserva ya aceptada | Stripe **devuelve** los gastos enteros | Ya hecho |
| T4.2 | El cliente cancela una solicitud aún sin aceptar | La retención se libera, nada cobrado | Ya hecho |
| T4.3 | El profesional cancela una reserva aceptada | El cliente recupera los gastos enteros | Ya hecho |
| T4.4 | Una solicitud que el profesional no responde en 24 h | Caduca sola y la retención se libera | Ya hecho |

## 5. Después del servicio

| # | Prueba | Debe pasar | Paquete |
|---|---|---|---|
| T5.1 | Pasada la hora del servicio | Al cliente le llega el correo para confirmar que se hizo y la reserva acaba «Completada» | Ya hecho |
| T5.2 | El cliente envía una **incidencia desde el móvil** | El botón «Enviar incidencia» se puede pulsar (QA-187) y el admin la ve | 1.2 |
| T5.3 | El admin la resuelve con devolución | Pide doble confirmación (QA-189) y Stripe devuelve el importe una sola vez | 1.2 |
| T5.5 | Cuando el cliente abre la incidencia de T5.2, el profesional | Recibe un correo «Un cliente ha abierto una incidencia sobre tu trabajo» con el motivo, y al entrar ve en su Panel el aviso «Contar mi versión» | 1.2 |
| T5.6 | En «Resolver sin acción» o «Rechazar» del admin, y al devolver sin escribir nota | Pide confirmación antes de cerrar; sin nota no deja resolver | 1.2 |
| T5.4 | El cliente deja una valoración | Aparece en el perfil del profesional | Ya hecho |

## 6. Lo legal y la primera impresión

| # | Prueba | Debe pasar | Paquete |
|---|---|---|---|
| T6.1 | Primera visita a la web | Sale el aviso de cookies con «Aceptar» y «Rechazar» iguales; «Rechazar» no carga Meta Pixel; «Configurar cookies» del pie permite cambiarlo y retirarlo (se borran `_fbp`/`_gcl_*` y no sale tráfico a Meta/Google) (QA-007, sección 47) | 1.9 |
| T6.2 | /privacidad y /terminos | Se abren y se leen bien en el móvil | Ya hecho |
| T6.3 | /para-jardineros (la página de los anuncios) | Sin fechas pasadas ni textos internos | 1.18 |
| T6.6 | Marketing del profesional y FAQ de /para-jardineros | Ningún flyer ni mensaje promete «pagas al terminar»; la FAQ no dice «GarSer no toca tu dinero» (sección 45) | 1.7 |
| T6.4 | Ningún extra con coste llega marcado de antemano | «Retirar restos» sin marcar en la reserva a mano (no deja seguir sin elegir) y apagado en la de fotos; sin elegir no se cobra (QA-065, sección 44) | 1.6 |
| T6.5 | Valorar un trabajo terminado | Las estrellas empiezan vacías y no se puede enviar sin puntuar; después se puede abrir y corregir (QA-116) | 1.6 |

## Criterio para subir

Todas las líneas en ✅. Las de un paquete aún no desplegado se marcan «pendiente de paquete» hasta que lo esté.
