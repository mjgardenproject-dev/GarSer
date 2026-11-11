# Cuestionario de activación del profesional y del empleado — diseño (2026-11-11)

> Estado: **propuesta, pendiente de aprobación**. Nada implementado todavía.
> Objetivo: que más jardineros terminen de configurar su cuenta y empiecen a recibir reservas. Hoy lo hacen
> con una guía de pasos que los manda a pantallas técnicas (configuradores, calendario). La propuesta es un
> cuestionario de preguntas sencillas que **escribe en la misma configuración de siempre**: lo que responda se
> verá y se podrá cambiar después en «Mi perfil», «Horario» y «Equipo».

---

## 0. Resumen en 30 segundos

1. **Cuestionario «Activa tu cuenta»** (titular: autónomo o empresa). Se abre solo al entrar al panel mientras
   la cuenta no esté lista para recibir reservas. 4 bloques: **zona → servicios y tarifas → horario → equipo**,
   y una pantalla final que **activa los servicios** y confirma «ya apareces a los clientes».
2. **Cuestionario del empleado**, en dos partes:
   - el **titular** configura a cada persona que invita (servicios que hará y horario), en 1 minuto;
   - el **empleado**, al aceptar, tiene una bienvenida corta (sus datos, su carnet si hace falta, avisos).
3. **«Ayuda»**: la guía actual de pasos («Completa tu cuenta profesional») deja de ser la forma de empezar
   (la sustituye el cuestionario). Se queda solo su parte útil, el aviso «necesita atención» cuando algo deja de
   estar bien. Y se añade una **Ayuda de verdad** para profesionales: contacto y preguntas frecuentes.

**Decisiones que te pido** (con mi recomendación entre paréntesis), detalle en §9:
- D1 ¿Mostramos **valores sugeridos** en cada pregunta de tarifas? (Sí, como botones que el profesional toca o cambia; los fijas tú).
- D2 ¿El cuestionario **obliga** o se puede pausar? (Se abre solo, se puede pausar y retomar; el panel insiste hasta acabar).
- D3 ¿El titular configura al empleado **al invitarle**? (Sí; necesita un cambio pequeño en la base de datos).
- D4 ¿Es «Ayuda» la guía «Completa tu cuenta profesional»? (Así lo he entendido; ver §6).

---

## 1. Qué hay hoy y qué se reutiliza

| Pieza actual | Dónde | Uso en el cuestionario |
|---|---|---|
| Zona: dirección + radio + mapa | `CoverageTab.tsx` + `DistanceMapSelector` → `gardener_profiles` (dirección, `operational_latitude/longitude`, `max_distance` 1-100 km) | Paso 1, mismo componente de mapa |
| Tarifas por servicio | 7 configuradores (`*PricingConfigurator.tsx`) → `gardener_service_prices.additional_config` (JSON) | Paso 2: las respuestas se convierten al MISMO JSON |
| ¿Está completo un servicio? | `src/utils/serviceValidation.ts` (`is*ConfigValid`) vía `isSavedServiceConfigValid` | El cuestionario no deja pasar un servicio que el configurador consideraría incompleto |
| Activar un servicio | `setServiceActive` (`src/utils/serviceActivation.ts`) | Pantalla final |
| Precio que verá el cliente | Motor `src/shared/bookingQuoteCore.ts` (el mismo del servidor) | «Ejemplo de presupuesto» en vivo en cada servicio |
| Horario | `recurring_schedules` (día, hora inicio/fin) + `recurring_availability_settings` (`weeks_to_maintain`, `min_notice_hours`) + `generate_recurring_slots` | Paso 3 |
| Invitar al equipo | RPC de `InviteMemberCard.tsx` (+ correo `send-email-notification`, declaración de responsabilidad cuando aplica) | Paso 4, varios correos a la vez |
| Servicios / horario / carnet de cada persona | `set_company_member_services`, `set_member_recurring_schedule`, `request_member_phyto_license` | Cuestionario del titular sobre el empleado |
| Qué falta para aparecer | `useProviderSetupStatus` + `src/shared/providerSetup.ts` (calculado en SQL) | Decide cuándo se abre el cuestionario y qué dice la pantalla final |

**Regla de oro:** el cuestionario **no guarda nada aparte**. Cada paso, al pulsar «Siguiente», escribe en las
tablas de siempre. Así: (a) si lo deja a medias, lo hecho ya cuenta; (b) el configurador enseña lo mismo;
(c) no hay dos verdades.

---

## 2. Principios de conversión (lo que hace que lo terminen)

1. **Una pregunta por pantalla en el móvil**, con botones grandes. Escribir números solo cuando no hay otra.
2. **Valores sugeridos como botones** («Lo habitual: 25 € · 30 € · 35 € · Otro») — tocar es más rápido que
   pensar un número. Nunca rellenados en silencio: el profesional siempre elige o escribe (D1).
3. **Lenguaje del oficio, no del sistema**: «¿Cuántos m² cortas en una hora?», no «rendimiento m²/h».
   Para unidades (árboles, palmeras) se pregunta **cuánto tardas en una**, en minutos, y se convierte.
4. **Por qué te lo preguntamos**, en una línea, en las preguntas raras (rendimiento → «para calcular cuánto
   dura el trabajo y no llenarte la agenda de más»).
5. **Ejemplo de presupuesto en vivo** al final de cada servicio: «Un césped de 150 m² normal: **45 €** y
   **1 h** de tu agenda. Descuidado: 54 € y 1,5 h». Hace visible el efecto de cada respuesta.
6. **Progreso y tiempo**: «Paso 2 de 4 · unos 8 minutos en total». Los servicios elegidos aparecen como
   sub-pasos («Césped ✓ · Setos · Palmeras»).
7. **Guardado automático y retomar**: «Guardado. Puedes seguir luego desde el panel». Al volver, continúa donde lo dejó.
8. **Nada bloquea por un servicio**: «Configurar este servicio más tarde» lo deja sin activar y sigue.
9. **Final con recompensa**: «¡Listo! Ya apareces a clientes en {zona}» + compartir su enlace + crear flyer.
10. **Lo opcional, al final** (foto, descripción, avisos en el móvil): no estorba para activarse.

---

## 3. Cuestionario 1 — «Activa tu cuenta»

### 3.0 Cuándo aparece y cómo se comporta
- **Quién**: titular aprobado (autónomo o empresa), en `/dashboard`.
- **Cuándo**: mientras el estado del servidor diga que le falta algo obligatorio para aparecer
  (`allRequiredDone = false`). Un profesional ya configurado **no lo ve nunca**.
- **Pantalla**: a pantalla completa (ruta propia, p. ej. `/activar`), cabecera con «Paso X de 4», botón «Atrás»
  y «Seguir luego» (vuelve al panel; el panel muestra arriba «Te falta poco: continúa tu activación»).
- **Si ya tiene datos** (zona o algún servicio configurado), las preguntas salen **ya contestadas** con lo suyo.
- **Autónomo vs empresa**: mismas preguntas; cambia el texto («tu negocio» / «tu empresa») y el paso 4.

### 3.1 Bienvenida
> **Hola {nombre}**, configura todo lo necesario para que tu empresa funcione en GarSer a la perfección.
> Este cuestionario es el último paso para disfrutar de las ventajas de garser.es. Todo lo configurado podrá
> editarse después desde tu configurador.
>
> Tardarás unos {N} minutos: tu zona, tus servicios y tarifas, tu horario y tu equipo.
>
> [ Empezar ]

(Para autónomos, «tu empresa» → «tu negocio». `{nombre}`: el nombre del titular; `{N}`: según cuántos servicios
marcó en el alta.)

### 3.2 Paso 1 — «Confirma dónde ofreces tus servicios»
- Campo de **dirección** (autocompletado de Google, ya está en la web) — sale rellena con la zona que puso en el alta.
- **Mapa de Google** con el círculo del radio, que se mueve al cambiar la dirección o el radio.
- **Selector de radio**: botones 10 · 20 · 30 · 50 km + deslizador fino (1-100 km, el límite actual).
- Texto vivo: «Te verán los clientes a menos de **25 km** de **Marbella**».
- Guarda en `gardener_profiles` igual que «Cobertura» (dirección, coordenadas, `max_distance`).

### 3.3 Paso 2 — «¿Qué servicios hace tu empresa?»
Tarjetas con foto e icono de los **7 servicios** de GarSer; se marcan varias. Salen marcados los del alta.
- Corte de césped · Poda de setos · Poda de árboles · Poda de palmeras · Poda de plantas y arbustos ·
  Desbroce de malas hierbas · Servicios fitosanitarios (con aviso: «necesita carnet de aplicador»).

Después, **un sub-paso por servicio marcado** (2.1, 2.2…). Todos siguen el mismo esqueleto, para que al
segundo servicio ya sepa cómo va:

1. **¿Cómo cobras?** — «Por hora» o «Por m² / metro / unidad» (una línea explica cada uno).
2. **Tu precio** — según lo elegido.
3. **¿Cuánto haces en una hora?** (o **cuánto tardas en una unidad**) — siempre; explica para qué.
4. **Estado del trabajo** — «Si está descuidado, ¿cuánto más tiempo y precio supone?» → un % que sube **a la
   vez** el tiempo y el precio (así funciona hoy el motor: `bookingQuoteCore.ts`, comentario «el % de
   condition_surcharges es tiempo y precio a la vez»).
5. **Retirada de restos** — «¿Cuánto más cobras si el cliente quiere que te lleves los restos?» (%).
6. **Mínimo por trabajo** — «¿Cuál es lo mínimo que cobras por desplazarte a un trabajo?» (€).
7. **Ejemplo de presupuesto** en vivo (motor real) + «Guardar y seguir» / «Configurar más tarde».

> Los % se eligen con botones (0 · 10 · 20 · 30 · 50 · Otro). Entre paréntesis, el campo donde se guarda.

#### 2.x Corte de césped
| Pregunta | Respuesta → campo |
|---|---|
| ¿Cómo cobras el corte de césped? | Por hora / Por m² → `pricing_method` (`per_hour` / `per_quantity`) |
| ¿Cuánto cobras la hora? · o · ¿Cuánto cobras el m²? (ej. 0,25 €) | `precioPorHora` · `price_per_m2` |
| ¿Cuántos m² cortas en una hora, más o menos? *(para calcular la duración)* | `yield_m2_per_hour` |
| Césped **descuidado** (hierba alta, semanas sin cortar): ¿cuánto más tiempo y precio? | `condition_surcharges.descuidado` |
| Césped **muy descuidado** (muy alta, matojos): ¿cuánto más? | `condition_surcharges.muy_descuidado` |
| ¿Cuánto más si te llevas los restos? | `waste_removal.percentage` |
| ¿Mínimo por trabajo? | `minimum_price` |
Ejemplo vivo: 150 m² normal / descuidado / con restos.

#### 2.x Poda de setos
| Pregunta | Respuesta → campo |
|---|---|
| ¿Cómo cobras? | Por hora / Por metro de seto → `pricing_method` |
| Precio por hora · o · precio por **metro** de seto **hasta 2 m** de alto y **de 2 a 4 m** | `precioPorHora` · `pricing_matrix['0-2m']`, `['2-4m']` |
| ¿Cuántos metros de seto cortas en una hora (una cara)? hasta 2 m · de 2 a 4 m | `yield_ml_per_hour['0-2m']`, `['2-4m']` |
| ¿Cortas setos de **más de 4 m**? Sí → su precio y sus metros/hora · No → no te llegan esos trabajos | `pricing_matrix['4-6m']`, `yield_ml_per_hour['4-6m']` (opcional) |
| Seto **difícil** (dificultad media / alta): ¿cuánto más tiempo y precio? | `condition_surcharges.media`, `.alta` |
| ¿Cuánto más por llevarte los restos? | `waste_removal.percentage` |
| ¿Mínimo por trabajo? | `minimum_price` |
Nota en pantalla: «Si el cliente pide las dos caras, se cuenta el doble».

#### 2.x Poda de árboles (solo precio por árbol: así funciona hoy)
Primero, en una línea, qué es cada poda (con el texto que ya usa el configurador): **formación** («árboles
jóvenes o mantenimiento ligero») y **estructural** («árboles grandes, ramas pesadas o saneamiento profundo»).
| Pregunta | Respuesta → campo |
|---|---|
| Precio por árbol, **poda de formación**: hasta 3 m · de 3 a 5 m | `formacion.small`, `.medium` |
| Precio por árbol, **poda estructural**: hasta 3 m · de 3 a 5 m | `estructural.small`, `.medium` |
| ¿Cuánto tardas en cada uno? (minutos) | → `yield_units_per_hour.{tipo}.{tamaño}` = 60 / minutos |
| ¿Podas árboles de **más de 5 m**? Sí → precio y minutos de cada poda · No | `formacion.large`, `estructural.large` + sus rendimientos (opcional) |
| Árbol **difícil** (lo confirma el cliente): ¿cuánto más? | `difficultyIncrease` |
| ¿Cuánto más por llevarte los restos? | `wasteRemovalMultiplier` |
| ¿Mínimo por trabajo? | `minimumPrice` |

#### 2.x Poda de palmeras
| Pregunta | Respuesta → campo |
|---|---|
| ¿Qué palmeras podas? (fotos de las especies: canaria, datilera, washingtonia, pindó/syagrus, trachycarpus, roystonea) | especies elegidas |
| ¿Cómo cobras? | Por hora / Por palmera → `pricing_method` |
| Por cada especie elegida y **cada altura** (las alturas salen de las reglas de cada especie, `speciesBusinessRules.ts`): precio por palmera y **minutos que tardas** | `height_prices[especie][altura]`, `yield_units_per_hour[especie][altura]` |
| Atajo: «Mismos precios que la canaria» cuando las alturas coinciden | — |
| Palmera **descuidada / muy descuidada**: ¿cuánto más? | `condition_surcharges.descuidado`, `.muy_descuidado` |
| ¿Cuánto más por llevarte los restos? | `waste_removal.percentage` |
| Extras (opcionales, se pueden dejar a 0): tratamiento fitosanitario (€ por palmera) · acabado del tronco (%) · acceso difícil (%) | `phytosanitary`, `trunk_finish`, `access_difficulty` |
| ¿Mínimo por trabajo? | `minimum_price` |
Es el servicio más largo: se muestra primero lo imprescindible (especies + alturas) y los extras plegados.

#### 2.x Poda de plantas y arbustos
| Pregunta | Respuesta → campo |
|---|---|
| ¿Cómo cobras? | Por hora / Por m² → `pricing_method` |
| Precio por hora · o · por m² de arbustos **pequeños / medianos / grandes** (con dibujo de cada tamaño) | `precioPorHora` · `prices_per_m2['pequeñas'/'medianas'/'grandes']` |
| ¿Cuántos m² podas en una hora? por tamaño | `yield_m2_per_hour[tamaño]` |
| Arbustos **descuidados / muy descuidados**: ¿cuánto más? | `condition_surcharges.media` (descuidado), `.alta` (muy descuidado) — *ojo: en este servicio los nombres van así* |
| ¿Cuánto más por llevarte los restos? | `waste_removal.percentage` |
| ¿Mínimo por trabajo? | `minimum_price` |

#### 2.x Desbroce de malas hierbas
| Pregunta | Respuesta → campo |
|---|---|
| ¿Cuánto cobras el m² de desbroce? | `precio_desbroce_m2` |
| ¿Cuántos m² desbrozas en una hora? | `yield_m2_per_hour` |
| Terreno **difícil** (dificultad media / alta): ¿cuánto más? | `suplementos.dificultad_media`, `.dificultad_alta` |
| ¿Cuánto más por llevarte los restos? | `suplementos.retirada_restos` |
| ¿Aplicas **herbicida**? Sí → precio por m² (solo se ofrece con carnet aprobado: enlace a subirlo) | `precio_herbicida_m2` |
| ¿Mínimo por trabajo? | `importe_minimo` |

#### 2.x Servicios fitosanitarios
- Primero el **carnet de aplicador**: «Súbelo ahora» (componente actual) o «Después». Sin carnet aprobado el
  servicio queda guardado pero **no se activa**; se le avisa cuando se apruebe.
- **¿Qué tratas?** césped · setos · palmeras · árboles · plantas → solo se preguntan los precios de lo marcado.
- **¿Qué tratamientos haces?** preventivo · curativo · ecológico · endoterapia (palmeras) → `tratamientos_activos`.
- Precios por elemento y tratamiento (€/m², €/metro, €/unidad) → `detailed_pricing.*`; endoterapia →
  `palmeras.endoterapia.precio_unico`.
- Rendimientos de lo marcado → `yields.*` (m²/h, metros/h, o minutos por unidad convertidos).
- Recargos: tratamiento ecológico (%) · dos tratamientos a la vez (%) · tres o más (%) → `pricing_modifiers.*`.
- Mínimo → `minimum_fee`.
Es el más técnico: en el cuestionario va la versión corta; el detalle fino sigue en el configurador.

### 3.4 Paso 3 — «¿Cuál es tu horario de trabajo?»
1. **Plantillas** de un toque: «Lunes a viernes, 8:00-14:00 y 16:00-19:00» · «Lunes a viernes, 8:00-17:00» ·
   «Lunes a sábado, mañanas» · «A mi manera».
2. **Editor por días**, legible: una fila por día con interruptor (trabajo / no trabajo) y sus tramos
   («8:00 – 14:00» · «+ Añadir tramo» para la tarde), y «Copiar a todos los días laborables».
3. **Reglas, en lenguaje llano**:
   - «¿Con cuánta antelación necesitas que te reserven?» 12 h · 24 h · 48 h · 72 h → `min_notice_hours`
   - «¿Hasta cuántas semanas vista pueden reservarte?» 2 · 4 · 8 semanas → `weeks_to_maintain`
4. Resumen: «Abres **35 horas a la semana**, durante las próximas 4 semanas». Guarda y genera las horas
   reservables como hoy (`recurring_schedules` + `generate_recurring_slots`).

### 3.5 Paso 4 — «¿Cuentas con más personas en tu equipo?»
- «No, trabajo solo» → termina.
- «Sí» → «Añádelos a tu perfil de empresa y gestionalos desde GarSer»: un campo para **varios correos**
  (se añaden como etiquetas; «+ Añadir otro»). Si en el alta dijo «con equipo de 4», aparecen 3 huecos.
- Debajo de cada correo, **«Configurar a esta persona»** (opcional, 1 minuto): el cuestionario del titular de §4.1.
- Se mantiene la declaración de responsabilidad que ya pide la invitación cuando aplica.
- Para un **autónomo**, aviso honesto: «Cuando acepte la primera persona, tu cuenta pasa a cuenta de equipo
  (lo verás en el panel)» — así funciona desde la cuenta dinámica (PR #77).
- Envía las invitaciones con el mismo sistema de hoy (correo + enlace).

### 3.6 Final — «¡Todo listo!»
1. Resumen de lo configurado (zona, servicios con su precio de ejemplo, horario, invitaciones enviadas).
2. Botón principal **«Activar mi cuenta»** → activa los servicios completos (`setServiceActive`). Es el gesto
   explícito de «empiezo a ofrecer», no se activa nada a escondidas.
3. Comprobación con el estado real del servidor: «**Ya apareces a los clientes** en {zona}» o, si algo falta
   (p. ej. el carnet en revisión), qué falta y que se le avisará.
4. Opcional, en tarjetas: **activa los avisos en el móvil** (para no perder solicitudes) · **foto/logo** ·
   **descripción** · **comparte tu enlace** · **crea tu flyer**.

---

## 4. Cuestionario 2 — el empleado

### 4.1 Parte del titular: «Configura a {nombre o correo}» (al invitar, opcional, ~1 min)
| Pregunta | Dónde acaba |
|---|---|
| ¿Cómo se llama? (para reconocerle en tu equipo; él podrá corregirlo) | nombre provisional del miembro |
| ¿Qué servicios hará? (solo los que tu empresa tiene activos; fitosanitarios avisa de que necesita carnet) | `set_company_member_services` |
| ¿Qué horario tiene? «El mismo que la empresa» · «Otro» (mismo editor del paso 3) | `set_member_recurring_schedule` |
| ¿Hará tratamientos fitosanitarios? Sí → «Le pediremos el carnet al entrar» / «Lo subo yo» | `request_member_phyto_license` o subida |

**Cambio técnico necesario (D3):** hoy el miembro solo existe cuando **acepta** la invitación, así que no hay
dónde guardar esto antes. Propuesta: una columna en `company_invitations` con lo elegido (servicios, horario,
nombre, carnet) y que `accept_company_invitation` lo aplique al crear el miembro, con las mismas reglas que las
funciones de arriba (solo servicios que la empresa tenga activos, horario válido). Migración + pruebas SQL.
Si se rechaza D3: el titular recibe un aviso al aceptar el empleado («Juan se ha unido: configúralo») y hace
estas mismas preguntas en ese momento, sin migración.

### 4.2 Parte del empleado: bienvenida al aceptar (~1 min)
1. «**Hola {nombre}**, {empresa} te ha añadido a su equipo en GarSer. Configura tu perfil en un minuto.»
2. **Tus datos**: nombre y teléfono (ya los tiene la pantalla «Mi trabajo»).
3. **Tu carnet de aplicador**, solo si su empresa hace tratamientos o se lo ha pedido: «Súbelo ahora» / «Más tarde».
4. **Tu horario y tus servicios**: los ve tal como los dejó su empresa («Si no te encaja, díselo a tu empresa»).
5. **Activa los avisos en el móvil** para enterarte de los trabajos que te asignen.
6. «¡Listo!» → «Mi trabajo».

---

## 5. Lo que NO se rompe (reglas del motor de precios y de la web)
- Los rendimientos son **siempre obligatorios** (sin ellos el profesional no aparece): el cuestionario no deja
  un servicio sin ellos.
- Árboles solo se cobra **por árbol**; setos de más de 4 m y árboles de más de 5 m son **opcionales** (quien no
  los configura no recibe esos trabajos, pero sí los demás).
- El mínimo se aplica al total, al final: el ejemplo en vivo usa el **motor real**, no una cuenta aparte.
- Un servicio se considera completo con los **mismos validadores** del configurador (`serviceValidation.ts`).
- Fitosanitarios y herbicida: **sin carnet aprobado no se ofrecen**.
- Comisión / gastos de gestión: el cuestionario **no dice nada fijo** sobre quién paga; si hace falta, el texto
  sale de `billingCopy.ts` (como en el resto de la web).
- Todo lo que se guarda es **lo mismo** que guarda el configurador: después se edita allí sin sorpresas.

---

## 6. Qué hacer con la «Ayuda» actual
He entendido «la pestaña de ayuda» como la **guía «Completa tu cuenta profesional»** del panel (la lista de
pasos con «Ver cómo», y el banner que sale arriba de «Mi perfil» y «Horario» diciendo en qué paso estás). La
única «Ayuda» con ese nombre es el botón de contacto de la web pública. Si te referías a otra cosa, dímelo.

Propuesta:
1. **La guía deja de ser la forma de empezar**: la sustituye el cuestionario, que es más claro y lleva de la
   mano. Se retira el banner de pasos de «Mi perfil» y «Horario».
2. **Se queda su parte valiosa**: el cálculo en el servidor de «qué te falta para aparecer». Se convierte en
   una tarjeta pequeña de **«Necesita atención»** que solo sale cuando algo deja de estar bien (carnet caducado,
   agenda sin horas, un servicio desactivado), con un botón que lleva directo al arreglo.
3. **Los pasos recomendados** (foto, descripción, avisos) pasan a la pantalla final del cuestionario y a una
   tarjeta «Mejora tu perfil».
4. **Una «Ayuda» de verdad para profesionales**, botón fijo en el panel:
   - Contacto: WhatsApp y correo (los mismos de la web pública).
   - Preguntas frecuentes del profesional: cómo se calcula el precio que ve el cliente · cuándo y cómo cobro ·
     qué paga el cliente (texto de `billingCopy.ts`) · cancelaciones · cómo cambio precios u horario ·
     cómo funciona el equipo · el carnet de aplicador.
   - «Repetir el cuestionario de activación» (para quien quiera rehacer sus tarifas paso a paso).

---

## 7. Medir que funciona
- Guardar en qué paso va cada profesional (paso alcanzado y fecha) para verlo en **Admin → Profesionales**:
  así puedes llamar a quien se quedó en «Palmeras» hace 3 días.
- Embudo: abrió · terminó zona · servicios · horario · activó. Objetivo: subir el % de aprobados que se activan
  en 7 días (hoy se puede medir con los datos que ya hay, para comparar antes/después).

---

## 8. Fases de implementación (propuesta)
| Fase | Qué | Cómo se comprueba |
|---|---|---|
| F0 | Decisiones D1-D4 y tabla de valores sugeridos por servicio (los fijas tú; propongo partir de la configuración de pruebas) | — |
| F1 | Armazón: ruta, progreso, guardar y retomar, bienvenida, **paso 1 zona** | pruebas + móvil 375 px |
| F2 | Servicios: selección + **césped, setos, arbustos, desbroce** con ejemplo en vivo | cada respuesta → JSON validado por `serviceValidation.ts`; mismo precio que el configurador |
| F3 | **Árboles y palmeras** (minutos → rendimiento) | conversiones con pruebas; casos > 5 m / > 4 m opcionales |
| F4 | **Fitosanitarios** + carnet + herbicida | sin carnet no se activa |
| F5 | **Horario** (plantillas, editor, reglas) | genera horas reservables como hoy |
| F6 | **Equipo** (varios correos) + pantalla final (activar, comprobar, avisos) | profesional nuevo aparece en una reserva de prueba de punta a punta |
| F7 | **Empleado**: parte del titular (migración D3) + bienvenida | pruebas SQL + aceptar invitación de punta a punta |
| F8 | **Ayuda**: tarjeta «Necesita atención», ayuda del profesional, retirar banner; medición | móvil + PRUEBAS-PRODUCCION |

Cada fase: pruebas automáticas, verificación en el navegador a 375 px y su sección en
`docs/audit/2026-07-12/PRUEBAS-PRODUCCION.md`.

---

## 9. Decisiones que necesito
| # | Pregunta | Recomendación |
|---|---|---|
| D1 | ¿Ponemos valores sugeridos (botones) en las preguntas de precio y rendimiento? | Sí. Los fijas tú por servicio en F0; nunca se rellenan solos. |
| D2 | ¿El cuestionario obliga o se puede pausar? | Se abre solo y se puede pausar; el panel insiste hasta acabar. Obligar del todo frustra y no deja ver el panel. |
| D3 | ¿El titular configura al empleado al invitarle (necesita migración)? | Sí: lo hace una vez, en caliente. Alternativa sin migración: configurarlo cuando acepte. |
| D4 | ¿«Ayuda» = la guía «Completa tu cuenta profesional»? | Retirarla como guía, quedarse con «Necesita atención» y crear una Ayuda de contacto + preguntas frecuentes. |

Puntos abiertos menores (no bloquean): «retirada de restos» hoy no tiene opción «no la hago» (0 % = gratis);
si quieres que un profesional pueda no ofrecerla, es un cambio del motor aparte.

---

## 10. Acciones manuales del usuario
- Aprobar o ajustar las decisiones D1-D4.
- (nada que desplegar)
