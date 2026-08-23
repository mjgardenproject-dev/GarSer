# Plan — Sistema de reseñas y área de cliente

> Petición de Javier del **2026-08-23**, tras detectar en la sección 6 de `PRUEBAS-PRODUCCION.md`
> que las reseñas no se piden, no se ven y no llegan al jardinero.
>
> Este plan parte de una **verificación del código y de la base de datos reales**, no de
> suposiciones. Cada fase es **independiente y desplegable por separado**: si una se cae, las
> demás siguen en pie y nada de lo que hoy funciona se toca.

---

## 1. Estado actual verificado

Comprobado en el esquema real y en el código, no en la documentación.

### Lo que YA existe y funciona

| Pieza | Estado |
|---|---|
| Tabla `reviews` | ✅ con `rating` (1-5, medios puntos), `comment`, `booking_id`, `client_id`, `gardener_id` |
| Penalización del sistema | ✅ `is_system_penalty` + `system_reason` (del paso 8C: 1★ por cancelar tras aceptar) |
| Trigger de agregados | ✅ `trg_sync_gardener_rating_aggregates` recalcula la media en cada alta/baja |
| Escritura de reseña | ✅ modal en `BookingsList.tsx` (funciona, pero está escondido) |
| Mensajes de sistema en el chat | ✅ `post_booking_system_message()` + trigger sobre `bookings` |
| Payload completo de una reserva | ✅ `booking_quotes.input_payload` (jsonb) |

### Los fallos, con su causa

| # | Fallo | Causa verificada |
|---|---|---|
| **F1** | La reseña escrita **no aparece en ningún lado** | No existe ninguna pantalla que **liste** reseñas. Solo se leen los agregados (media y número) |
| **F2** | **No llega al jardinero** | Ídem: el jardinero no tiene pantalla de reseñas |
| **F3** | El jardinero **no puede responder** | La tabla `reviews` **no tiene columna de respuesta** |
| **F4** | **No se avisa** al cliente de que valore | El trigger de mensajes de sistema cubre `confirmed`, `cancelled`, `rejected` y los cambios de precio — **`completed` no está** |
| **F5** | Un visitante **sin sesión no puede leer reseñas** | La policy `"Anyone can read reviews"` es `TO authenticated`. Como el funnel anónimo es una capacidad deliberada, hoy ese visitante ve estrellas pero no podría abrir las reseñas |
| **F6** | Un cliente puede reseñar **la misma reserva dos veces** | El índice único de `booking_id` **solo cubre `is_system_penalty = true`**. Nada impide dos reseñas de cliente sobre la misma reserva, y ambas cuentan para la media |
| **F7** | La media vive en **cuatro columnas** | `rating` / `total_reviews` (las lee el perfil público) y `rating_average` / `rating_count` (las lee ProvidersPage). Hoy el trigger las sincroniza, pero es una fábrica de incoherencias |
| **F8** | Home del cliente casi vacía | `ClientBookingLauncher.tsx` son 44 líneas: saludo + 3 botones. Sin reservas, sin estados, sin avisos |

> **F5 y F6 son los graves.** F6 permite inflar la nota de un jardinero con reseñas repetidas
> — es manipulación de la prueba social sobre la que el cliente decide a quién mete en su casa.

---

## 2. Lo que añado y no estaba en tu petición

Sin esto, el sistema se rompe o se abusa en cuanto tenga usuarios reales.

1. **Una reseña por reserva, garantizada en la base de datos** (F6). No basta con ocultar el
   botón: hay que impedirlo en el esquema, o alguien lo hará por API.
2. **Reseñas legibles sin sesión** (F5), porque tu funnel anónimo es deliberado.
3. **Ventana de edición de 48 h.** Estándar del sector: permite corregir un arrebato sin
   convertir la reseña en algo mutable para siempre. Pasado ese plazo, queda fija.
4. **La respuesta del jardinero es única y editable 48 h**, con el mismo criterio.
5. **Límites y moderación.** Tope de caracteres (reseña 1.000, respuesta 1.000) y capacidad del
   admin para ocultar una reseña con motivo — sin borrarla, para que quede traza. Vas a recibir
   texto libre público: necesitas una vía para difamación o datos personales de terceros.
6. **La penalización del sistema se muestra distinta.** Las 1★ automáticas del paso 8C deben
   verse como *"GarSer · servicio no completado"*, nunca como si las hubiera escrito un cliente.
   Cuentan para la nota, pero son trazables y defendibles si el jardinero reclama.
7. **"Volver a reservar" tiene que recalcular el precio en el servidor.** Copiar el importe
   antiguo sería vender a un precio que ya no existe. El check obligatorio que propones cubre el
   estado del jardín; el precio lo tiene que refrescar el motor.
8. **Y comprobar que el servicio sigue disponible**: el jardinero pudo desactivarlo, cambiar de
   zona o dejar la plataforma.
9. **Consolidar las cuatro columnas de nota** (F7) en un solo par.
10. **Anti-abuso de la respuesta:** solo el jardinero reseñado responde, y solo a reseñas suyas.

---

## 3. Plan por fases

Cada fase deja el sistema **coherente y desplegable**. Se pueden parar entre fases.

### Fase 1 — Cimientos de datos 🔴 ✅ **HECHA** (2026-08-23)

*Sin front. Solo esquema. Nada de lo que hoy funciona cambia de comportamiento.*

- Migración que añade a `reviews`: `gardener_response`, `gardener_response_at`,
  `hidden_at`, `hidden_reason`, `updated_at`.
- **Índice único de una reseña de cliente por reserva** (F6).
- **Policy de lectura para `anon`** sobre reseñas no ocultas (F5).
- Policy de UPDATE: el cliente edita **su** reseña dentro de 48 h; el jardinero solo puede
  escribir `gardener_response` **en las reseñas dirigidas a él**.
- Restricciones de longitud.
- El trigger de agregados pasa a **ignorar las reseñas ocultas**.

**Riesgo:** bajo. Solo añade. **Verificado en local:**

| Prueba | Resultado |
|---|---|
| Reseña legítima sobre reserva propia completada | ✅ 201 |
| Segunda reseña sobre la misma reserva (F6) | ✅ 409 |
| Reseña a un jardinero nunca contratado | ✅ 403 |
| Visitante sin sesión leyendo reseñas (F5) | ✅ 200 |
| Jardinero responde a su reseña | ✅ 200 |
| Un tercero intenta responder | ✅ 403 |
| Jardinero intenta cambiarse la nota | ✅ 0 filas, nota intacta |
| Admin oculta una reseña | ✅ desaparece **y sale de la media** |

**Nota de diseño:** la respuesta del jardinero se escribe **solo por RPC**, nunca por UPDATE
directo. RLS decide sobre la FILA, no sobre la columna: con permiso de UPDATE sobre las reseñas
dirigidas a él, un jardinero podría cambiarse la propia nota.

### Fase 2 — Pedir la reseña 🔴 ✅ **HECHA** (2026-08-23) *(cierra F4)*

- Extender el trigger de mensajes de sistema para que, al pasar a `completed`, publique en el
  chat: **"Servicio finalizado. ¿Nos dejas tu valoración?"**.
- Ese mensaje ya viaja por Realtime y ya cuenta para el badge de no leídos: **no hay que
  construir notificaciones nuevas**.
- Email al cliente pidiendo la valoración (reutiliza `send-email-notification`).

**Riesgo:** bajo, encapsulado en una función SQL que ya existe.

**Bug preexistente encontrado al probarla — y grave.** `chat_display_name()` buscaba el perfil
por `profiles.id`, pero recibe el id del usuario de auth, que vive en `profiles.user_id`
(el mismo fallo que tenía el Monitor de Roles). No devolvía ninguna fila → `NULL` → y en SQL
**concatenar con NULL da NULL**, así que el mensaje entero se volvía nulo y el helper lo
descartaba en su guarda de texto vacío: **sin error y sin rastro**.

Llevaban perdiéndose todos los mensajes que nombran al profesional:

- *"X ha aceptado la reserva"*
- *"X propone un nuevo precio del servicio"* — **el aviso de un cambio de dinero**
- y el de servicio finalizado que añade esta fase

Los que no lo nombran (solicitud, cancelación, precio aceptado/rechazado) sí funcionaban, que es
justo lo que hacía el fallo tan difícil de ver: el chat "funcionaba".

**Alcance del email:** el aviso del **chat cubre las dos vías** de finalización (manual y
autofinalización a 24 h) por ir en el trigger. El **email** solo cubre la manual, porque la
autofinalización es SQL puro y no puede invocar una edge function sin meter la clave de servicio
en la base de datos. → **Fase 2b** pendiente si se quiere cobertura total por email.

### Fase 3 — Ver las reseñas 🔴 ✅ **HECHA** (2026-08-23) *(cierra F1, F2, F3)*

- Componente **`ReviewList`** reutilizable, estilo ficha de Google: nota, número, desglose por
  estrellas, lista con fecha, texto y la respuesta del jardinero debajo.
- **ProvidersPage:** "ver reseñas" subrayado junto a las estrellas → abre el panel.
- **Perfil público del jardinero:** el mismo componente.
- **Panel del jardinero → "Reseñas":** todas sus valoraciones, con **responder** (una por
  reseña, editable 48 h).
- Al responder, **mensaje de sistema en el chat** de esa reserva para que el cliente se entere.

**Riesgo:** medio (toca ProvidersPage, que es crítica). Mitigación: el panel es un componente
nuevo montado en un desplegable; si falla, las estrellas siguen como hoy.

**Añadido no previsto:** la vista `public_gardener_reviews`. Desde el paso 1 `profiles` está
cerrada a `anon`, así que resolver el autor desde el navegador obligaría a reabrir esa fuga de
PII. La vista **enmascara en el servidor**: el nombre completo del cliente nunca sale de la base
de datos, y sale ya como "Laura F.". Las penalizaciones automáticas salen firmadas como "GarSer".

**Verificado en local, sin sesión iniciada:** media 2,8 con su desglose por estrellas, "Laura F."
con la respuesta del profesional debajo, y la penalización con su distintivo. En el panel del
jardinero, "Editar respuesta" en las de cliente y **ninguna acción** en la penalización, que no
la escribió nadie a quien responder.

### Fase 4 — Área de cliente 🟠 ✅ **HECHA** (2026-08-23) *(cierra F8)*

Reescritura de `ClientBookingLauncher` con tu jerarquía:

1. **"Hola de nuevo, {nombre}"** y nada más.
2. Tres accesos: empezar reserva · continuar reserva · mis reservas.
3. **Mis reservas**, en el orden que pediste:
   1. **Próxima reserva** (confirmada, fecha futura) — con todos los datos y acceso directo al chat.
   2. **Completadas sin valorar** — con llamada clara y visible a valorar.
   3. **Completadas y valoradas** — con su nota y **"volver a reservar"**.
   - Sin ninguna: *"Todavía no tienes ninguna reserva"*.

**Riesgo:** bajo. Pantalla nueva que sustituye a una de 44 líneas.

**Bloqueante encontrado al construirla — sexta aparición del mismo fallo.** Media docena de
pantallas consultaban `profiles` por la columna `id` pasándole el id de **auth**, que vive en
`user_id`. Cero filas: el cliente no veía a su jardinero, el jardinero no veía a su cliente, el
chat mostraba genéricos y **"Mi Cuenta" cargaba vacía para todo el mundo**. Como todas caían a
un texto por defecto, parecía que "no había nombre" en lugar de un error. Centralizado en
`fetchProfileNames`, que busca por **ambas** columnas porque el histórico de migraciones usó las
dos como clave contra `auth.uid()`.

El botón **"volver a reservar" queda deshabilitado** hasta la Fase 5: repetir tiene que
recalcular el precio contra la configuración vigente, no copiar el importe antiguo.

### Fase 5 — Volver a reservar 🟠

- RPC `SECURITY DEFINER` que recupera `booking_quotes.input_payload` de una reserva del cliente
  (la tabla está cerrada a `service_role`, así que la puerta la guarda la función) y **precarga
  un borrador nuevo**.
- Pantalla de comprobación con todos los datos y **editar por apartado**.
- **Check obligatorio** declarando que el estado del jardín sigue siendo el mismo.
- **El precio se recalcula en el servidor** contra la configuración vigente. Nunca se copia.
- Después, a ProvidersPage con normalidad.

**Riesgo:** medio (toca el flujo de dinero). Mitigación: no se reutiliza ningún importe; se
genera un presupuesto nuevo por el camino de siempre.

### Fase 6 — Pulido de confianza 🟡

- Etiqueta **"Contratado anteriormente"** en ProvidersPage.
- Botón **"Reseñas"** en el chat, para ambas partes.
- **Consolidar las cuatro columnas de nota** en un par (F7).
- Vista de admin para **ocultar** una reseña con motivo.

---

## 4. Decisiones tomadas (2026-08-23)

1. **Reseñar NO es obligatorio** para volver a reservar.
2. **Nota real desde la primera reseña**, como Google. Sin reseñas: *"Nuevo"*.
3. **Autor mostrado como nombre + inicial** ("Laura F."), como Google: identifica lo justo sin
   exponer al cliente.
4. **No hay reseña del jardinero al cliente.** Fuera de alcance.

---

## 4b. Decisiones anteriores (ya cerradas)

1. **¿La reseña es obligatoria para volver a reservar?** Mi recomendación: **no**. Forzarla
   produce reseñas de relleno de 5★ que no informan a nadie.
2. **¿Nota mínima visible?** Si un jardinero tiene una sola reseña de 1★, ¿se muestra "1,0"?
   Recomiendo mostrar la nota real desde la primera reseña, y **"Nuevo"** mientras no haya
   ninguna — es lo que ya hace ProvidersPage.
3. **¿El jardinero ve quién le reseñó?** Recomiendo **nombre de pila e inicial** ("Laura F."),
   como Google: identifica lo justo sin exponer al cliente.
4. **¿Reseña también del jardinero al cliente?** Hoy no existe. Es lo normal en marketplaces de
   dos caras, pero **duplica el alcance**; lo dejaría fuera de este plan.

---

## 5. Orden recomendado

**Fases 1 → 2 → 3** son las que arreglan lo que reportaste, y las tres juntas ya dan un sistema
de reseñas completo y usable. Las **4 → 5 → 6** son la mejora del área de cliente y se pueden
hacer después sin bloquear la salida a producción.

Cada fase termina con sus pruebas añadidas a `PRUEBAS-PRODUCCION.md`.

---

## 🔧 Lo que tienes que hacer tú

**Ahora mismo:** *(nada que desplegar)* — esto es un plan, no hay código.

**Cuando lo aprobemos**, cada fase traerá su propia lista. Por adelantado:

- **Fases 1, 2, 5 y 6** llevan **migración** → `supabase db push`.
- **Fases 2 y 3** tocan **edge functions** → `supabase functions deploy … --use-api`.
- **Fases 3, 4 y 5** son front → entran con el despliegue de Vercel.

**Antes de empezar:** dime las cuatro decisiones del apartado 4 y por qué fase quieres arrancar.
