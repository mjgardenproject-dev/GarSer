# Simulacro completo de GarSer en el iOS Simulator (100 % local)

## 1. Objetivo

Eres el coordinador de QA de GarSer (garser.es), un marketplace de jardinería: React + Vite + TypeScript, Supabase (Postgres + Edge Functions), Stripe y Gemini.

Quiero un simulacro de uso completo, **solo en local y desde el iOS Simulator**, con agentes que actúan como usuarios reales de cada rol (cliente, profesional autónomo, profesional con equipo, empleado y administrador), para encontrar y documentar todos los fallos **antes** de subir a producción. Después corregiremos lo documentado y re-verificaremos la versión final antes de desplegar.

Trabaja en español, directo: primero el resultado y después el detalle. Si algo falla, dilo con la salida del error.

## 2. Cómo trabajamos (estoy conectado en remoto)

- No estaré delante del Mac. Decide tú lo que sea reversible. No me preguntes lo que puedas averiguar leyendo el código. Ante lo irreversible o lo que salga de local, no actúes: anótalo y espera.
- Hay dos puertas en las que **te paras y esperas mi OK**: al terminar la FASE 0 (plan) y al terminar la FASE 3 (informe). El resto avanza solo.
- Mantén `docs/qa-simulacro/PROGRESO.md` (qué está hecho, qué sigue, qué te bloquea) y cierra cada fase con un resumen de 10 líneas como máximo.
- **Pre-flight, lo primero de todo:** lista lo que necesite una acción física mía en el Mac y yo la resuelvo mientras sigo conectado: Docker Desktop abierto, licencia de Xcode aceptada, runtimes de iOS instalados, permisos de macOS (Accesibilidad y Grabación de pantalla si usas computer-use), sesión de la CLI de Stripe, etc.

## 3. Reglas inviolables

1. **Solo local.** Antes de abrir nada comprueba que `.env` y las variables de las funciones apuntan a `http://127.0.0.1:54321` (desde el Simulator, `localhost` es el Mac). Si algo apunta a producción (`*.supabase.co`, `garser.es`), PARA y avísame. Stripe solo con claves `pk_test_` / `sk_test_`. No definas `SMTP_USER` / `SMTP_PASS`: así los correos salen en modo MOCK y se leen en los logs de `send-email-notification`, y no se escribe a personas reales.
2. **Nada de `git push`, PR, `supabase db push`, `supabase functions deploy` ni despliegue a Vercel sin mi orden explícita.** Trabaja en una rama nueva `qa/simulacro-ios-<fecha>` desde `main`. Haz commit local de tus documentos en el mismo turno en que los escribes, solo tus ficheros (nunca `git add -A`) y sin empujar.
3. **Durante el simulacro no corriges código: apuntas.** Excepción: si un fallo te impide continuar un escenario, desbloquéalo con un atajo por BD (solo local) y márcalo en el hallazgo como «atajo usado».
4. **Actúa como una persona.** Toda acción de usuario se hace por la interfaz del simulador. SQL, logs, buzón y cola de avisos sirven para **verificar efectos** y para **adelantar el reloj**, nunca para hacer lo que un usuario haría con un toque.
5. **Verifica antes de afirmar.** La documentación de este repo ya se quedó desfasada más de una vez. Cita `fichero:línea` y no des por cierto nada que no hayas visto ejecutarse. Lee primero `docs/garser-empresas/00-GUIA-DEL-CHAT.md` (reglas de la casa) y `docs/audit/HALLAZGOS-CONOCIDOS.md` (trampas conocidas).
6. **Reproducible.** Los datos de prueba son desechables, pero restaura el estado entre rondas (`supabase db reset` o limpieza) y deja anotado cómo.
7. No «arregles» lo que es deliberado: por ejemplo, el pago usa `capture_method: 'manual'` a propósito (se autoriza al reservar y se captura al confirmar).

## 4. Lo que ya sé del proyecto (verificado en el código el 2026-11-12; compruébalo)

- **No hay app nativa** (ni `ios/` ni Capacitor): es una web/PWA (`public/sw.js`, `site.webmanifest`). «El simulador de iOS» es **Safari de iOS dentro del Simulator** abriendo `http://localhost:5173` (`npm run dev`, `host: true`, `strictPort`).
  - Lo específico de iOS que hay que probar: safe-area y barra inferior (`BottomNav`), teclado, zoom por tamaño de fuente en inputs, `dvh`, tamaño táctil de 44 px, permisos de ubicación y de fotos, atrás por gesto, recarga a mitad, instalar en pantalla de inicio.
  - Push web y service worker en iOS requieren dispositivo real y HTTPS: no son verificables en el simulador. Márcalos como «pendiente en dispositivo real» (prueba P-R08-1 de `docs/garser-empresas/06-PRUEBA-REAL-PENDIENTE.md`), igual que Google OAuth, correos reales y Stripe real.
- **Los roles ya no son los de antes** (D31, `docs/garser-empresas/08-CUENTA-PROFESIONAL-DINAMICA.md`): hay **Cliente**, **Profesional**, **Empleado** y **Admin**.
  - El Profesional está en modo individual y pasa solo a modo equipo al aceptar su primer empleado; vuelve a individual al irse el último.
  - «Empresa» como alta propia (`/empresa/solicitud`) quedó latente: no la cuentes como funcionalidad, pero comprueba que sigue inaccesible.
- **«Mover reservas» solo existe en modo equipo:** el dueño propone otra fecha y el cliente la acepta o rechaza (`RescheduleSection`, `propose_booking_reschedule`). Un autónomo puede cancelar, proponer precio/duración y aceptar/rechazar; el cliente puede cancelar. Si producto esperaba más, anótalo como hallazgo de funcionalidad.
- **Dinero:** pago con Stripe Elements en la propia página de confirmación. Al reservar se pagan los **gastos de gestión** (la comisión de GarSer), configurables en Admin → Comisiones (5 reglas, las aplica SQL al firmar el presupuesto). Con captura diferida. El resto lo cobra el profesional (`ARCHITECTURE.md` §1; verifícalo).
- **Muchos flujos dependen del tiempo y hay que simularlo.**
  - Solicitudes pendientes: expiran a las 24 h (`expire_stale_booking_requests`).
  - Propuestas de precio/duración y de nueva fecha: caducan (reloj `expire-price-change-proposals`; verifica el plazo real).
  - Cierre automático si el cliente no responde tras «He terminado» (`booking-lifecycle-tick`: secreto `lifecycle_tick_secret` del Vault, cabecera `x-lifecycle-secret`).
  - Cancelación a más de 24 h: devuelve gastos de gestión; a menos, no.
  - «Irá X» (quién va) solo se ve el día antes.
  - Avisos: cola `notification_outbox` y `notification-dispatch`, con reintentos a 1/5/15/60 min.
  - Retención del hueco durante el pago y su caducidad.
  - Horarios recurrentes (`generate_recurring_slots`).
  - Visita de un plan de mantenimiento, 7 días antes.
  - En local `pg_cron` puede no correr: localiza cada mecanismo con `grep -rn "cron.schedule" supabase/migrations` y define cómo adelantarlo (timestamps con service role o llamada manual a la RPC/función).
- **Entorno local:**
  - `supabase/config.toml` solo declara funciones: no tiene `project_id` ni `[auth]`. Los contenedores se nombran por la carpeta (`docker ps`).
  - El MCP de `.mcp.json` apunta al Supabase local.
  - Semilla (`supabase/seed.sql`): `admin.local@test.local`, `cliente.local@test.local` y `jardinero.local@test.local`, todas con contraseña `Test123456!`. El jardinero sembrado cubre Marbella con los 7 servicios configurados y carnet vigente.
  - Los secretos de las funciones van en `supabase/functions/.env` (no existe, fuera de git): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `GOOGLE_API_KEY` (Gemini), `BOOKING_APP_BASE_URL=http://localhost:5173`, etc.
  - Variables del front: `VITE_SUPABASE_*`, `VITE_STRIPE_PUBLISHABLE_KEY`, `VITE_GOOGLE_MAPS_API_KEY` (si está restringida por dominio puede no servir en localhost; prueba también el comportamiento sin ella) y `VITE_ENABLE_MANUAL_BOOKING_INPUT`: prueba con `true` y con `false`. Desbroce es siempre manual.
  - La IA tiene cuota por usuario (`consume_ai_pricing_quota`): puede cortarte pruebas repetidas.
- **Stripe en local:** para que el webhook confirme pagos hace falta `stripe listen --forward-to http://127.0.0.1:54321/functions/v1/booking-payment-webhook` (su `whsec_` va en `STRIPE_WEBHOOK_SECRET`) o replicar la firma como `scripts/commissions/verify-commissions-stripe.mjs`.
  - Tarjetas de prueba: `4242 4242 4242 4242` (ok), `4000 0000 0000 0002` (rechazada), `4000 0027 6000 3184` (3DS), `4000 0000 0000 9995` (fondos insuficientes).
- **Ya existe mucho QA automatizado: reutilízalo, no lo dupliques.**
  - `npm test` (unas 2.800 pruebas; tú tomas la cifra de línea base) y `npm run build`.
  - ~30 baterías de servidor en `scripts/garser-empresas/verify-*.mjs` (más las de `scripts/commissions`, `fee-waiver` y `provider-setup`): necesitan `supabase functions serve` y se niegan a correr fuera de 127.0.0.1.
  - `scripts/readiness/*.mjs` (precio, horas y avisos por servicio).
  - `scripts/qa/manual-entry/*` (Playwright).
  - `supabase/tests/*.sql`.
  - Todo eso cubre API y BD. **No cubre la interfaz real en iOS ni los recorridos multi-rol: ese es tu hueco.**
- **Hallazgos ya conocidos** (reconfírmalos, no los presentes como nuevos): `docs/garser-empresas/04`, `05` y `06`, y `docs/audit/*`. Ejemplos: PH-28 (falta aviso «Tu parte cambia»), PH-37 (la caducidad del pago no tiene reloj en la página), PH-30 (nombres cortados en la agenda).

## 5. Agentes y herramientas

- **Tres capas:** (1) línea base automática; (2) recorridos por interfaz en iOS Simulator, un agente por rol; (3) verificaciones laterales (BD, logs, buzón, cola de avisos).
- **Un agente por rol y un simulador por rol** (`xcrun simctl create/boot`, UDID distintos; sesión y `localStorage` son por dispositivo): Cliente, Profesional, Empleado y Admin. Añade un iPhone de pantalla pequeña (tipo SE) para los recorridos críticos. Si la RAM no da para todos, comparte simulador pero serializa.
- **Cómo conducir el simulador.** Elige y justifica en el plan entre:
  - (a) Appium + XCUITest sobre Safari: DOM y selectores, reproducible, varios UDID.
  - (b) idb o mobile-mcp.
  - (c) computer-use sobre Simulator.app: visual, pero solo un agente a la vez (hay un único ratón).
  - (d) Playwright con WebKit y perfil de iPhone, para barrer en paralelo lo que no sea específico de iOS.
  - Punto de partida recomendado: recorridos críticos como **scripts reproducibles** (se reutilizan como regresión tras corregir) y una pasada exploratoria visual para lo estético. Solo instala lo que figure en el plan que yo apruebe.
- **Orquestación por rondas, no agentes libres:** los flujos se encadenan (el cliente reserva → el profesional acepta → el cliente confirma…). El orquestador pasa el testigo con `docs/qa-simulacro/HANDOFF.md` (ids de reserva, cuentas, hora, qué espera el siguiente). Cada agente conoce solo su rol y no hereda el contexto de los demás.
- **Cada agente se comporta como una persona real, incluida la que se equivoca:** campos vacíos o raros, doble toque, atrás, recargar a mitad, cambiar de app, teclado tapando. Toma una captura en cada paso relevante y anota lo esperado frente a lo ocurrido.
- Evidencias (capturas, vídeos, logs) fuera del repo: `~/garser-qa-evidencias/<fecha>/`.

## 6. FASE 0 — Plan e inventario (solo lectura; entrégalo y PARA)

Entregables en `docs/qa-simulacro/`:

1. **`PLAN.md`**
   - Arquitectura del simulacro.
   - Requisitos de entorno y herramientas a instalar.
   - Rondas y orden; qué va en paralelo y qué no.
   - Cómo se simula el tiempo y cómo se restaura el estado.
   - Estimación de duración, riesgos y criterios de salida.
   - Lista de acciones físicas mías.
2. **`MATRIZ-FUNCIONALIDADES.md`** — la **lista completa de funcionalidades y casos por rol**: Visitante, Cliente, Profesional individual, Profesional con equipo, Empleado, Admin y Sistema/reloj.
   - Dedúcela de las rutas (`src/App.tsx`), pantallas, RPC (`grep "\.rpc("`), Edge Functions (`supabase/functions/*`) y migraciones, **no** de la documentación.
   - Por cada ítem: ID, rol, ruta o pantalla, camino feliz, casos límite y negativos, quién NO debe poder hacerlo, efecto a verificar (BD, correo, aviso), escenario que lo cubre, y si va en simulador, automático o solo en dispositivo real.
   - Parte del inventario de abajo y amplíalo. Marca lo que esté latente o no encuentres.
3. Para cada ítem, **qué cubre ya una batería existente** y qué queda sin cubrir.

## 7. Inventario base por rol (punto de partida; amplíalo y verifícalo)

**Visitante (sin sesión)**
- Páginas públicas: `/` (portada), `/marbella`, `/costa-del-sol`, `/para-jardineros`, `/privacidad`, `/terminos`, `/cookies` y 404.
- Banner de cookies y aviso de instalar la app.
- Perfil público de un profesional, `/reservar/:gardenerId`, con y sin la clave `?c=` del enlace/QR personal.
- Embudo `/reservar` sin cuenta: hasta dónde llega, dónde pide entrar y si retoma lo hecho al volver (`hasWizardResume`).
- Enlaces de correo sin sesión: `/confirmar-servicio` (confirmación de un clic), `/invitacion`, `/reset-password`, `/auth/callback`.
- `/auth`:
  - Pestañas Entrar / Crear cuenta. Crear cuenta obliga a elegir tipo (Cliente o Profesional), sin preselección.
  - Olvidé mi contraseña.
  - Google, solo si hay client id.
  - Validaciones.
  - Confirmación de correo: en local viene desactivada. Actívala en una configuración local temporal (sin commitearla) para probarla, y lee el buzón de Supabase (normalmente `http://127.0.0.1:54324`).

**Cliente**
- **Reserva** (`/reservar`):
  1. Dirección: autocompletado de Google, «usar mi ubicación» y número de casa.
  2. Servicios: los 7 (césped, setos, árboles, palmeras, arbustos/plantas, desbroce, fitosanitarios), con selección múltiple y servicio parcial.
  3. Detalles: análisis por fotos con IA (subida, compresión, fallos de IA, cuota) o entrada manual según el flag.
  4. Profesionales: precio, horas, distancia, distintivo «Empresa», días y horas libres.
  5. Confirmación y pago: Stripe, retención del hueco, caducidad, gastos de gestión.
  6. `/reserva/confirmacion`.
- **Variantes:**
  - Entrada por enlace/QR de un profesional (clientes propios sin gastos de gestión, clave rotada, enlace obsoleto, profesional que no hace el servicio).
  - Reanudar reserva guardada.
  - «Repetir» una reserva completada.
  - Plan de mantenimiento («Repetir cada…» y la visita con su pago).
  - Tarjeta rechazada o 3DS.
  - Abandonar y volver.
- **Mis reservas** (`/bookings`):
  - Filtros por estado.
  - Cancelar, con aviso del importe según antelación.
  - Aceptar/rechazar cambio de precio o duración.
  - Aceptar la nueva fecha propuesta.
  - «Irá X» (el día antes).
  - Confirmar servicio terminado.
  - Abrir incidencia (`/incidencias/:id`): no vino, no hizo el trabajo, incompleto, cobro, trato, otro.
  - Valorar y editar reseña (`/valoraciones`).
  - Repetir.
  - Chat.
- **Chat** (`/chat`): texto, fotos (compresión y visor), enviado/leído, mensajes de sistema, propuesta de precio dentro del chat, no leídos, reconexión, histórico, botón atrás.
- **Inicio** (`/dashboard`) y barra inferior Inicio / Reservas / Chat.
- **Mi cuenta** (`/account`): foto, datos, activar notificaciones, «Cerrar todas las sesiones», cerrar cuenta (bloqueada si hay algo pendiente; si no, borra o anonimiza).
- **Correos que debe recibir:** reserva recibida (no «confirmada»), aceptada, rechazada, cambio de precio/duración, nueva fecha, confirmar servicio (enlace de un clic), cancelación.

**Profesional (modo individual)**
- **Alta:**
  - Crear cuenta → Profesional → `/apply` (5 pasos: Tus datos · Servicios y herramientas · Tu actividad (solo/equipo y nº de personas) · Formación (opcional) · Confirmación). Con autoguardado, validación de teléfono, fotos y consentimientos.
  - `/status`: pendiente, «Actualizar estado», o rechazada con motivo y «Corregir y volver a enviar».
  - Aprobación del admin: correo de bienvenida, ficha y tarifas creadas.
- **Panel** (`/dashboard`): Solicitudes, Disponibilidad, Perfil, Reseñas y Marketing. Además guía de puesta en marcha, aviso de cuenta suspendida y tarjeta «¿Trabajas con más gente?».
- **Perfil** (`?tab=`):
  - Personal: nombre, teléfono, descripción y carnet fitosanitario.
  - Cobertura: dirección base, radio y mapa.
  - Servicios: 7 configuradores de precios, rendimientos, mínimos y recargos; activar/desactivar; sin negativos; un 0 explícito se respeta.
  - Guardado automático o manual y aviso de cambios sin guardar.
- **Disponibilidad:** semanal (marcar y guardar horas; las celdas reservadas o solicitadas no se desmarcan) y horario fijo recurrente.
- **Solicitudes:** aceptar, rechazar, proponer precio y/o duración (1–12 h), detalle del servicio (IA o declarado, fotos con visor) y expiración a las 24 h.
- **Reservas:** llamar, cómo llegar, chat, «He terminado» (pide confirmación; no cobra ni cierra), responder incidencia y cancelar una reserva aceptada.
- **Reseñas** (ver y responder), **Marketing** (enlace personal con copiar y rotar clave, QR, flyer, materiales imprimibles) y perfil público. Chat y Mi cuenta como el cliente.
- **Visibilidad:** no debe aparecer a los clientes mientras no complete la puesta en marcha, esté suspendido o no cubra la dirección. Debe aparecer cuando todo esté bien.

**Profesional con equipo**
- **Promoción:** invitar al primer compañero (declaración de seguro de RC, correo y enlace, anular invitación, límite diario).
  - Al aceptar: modo equipo, `/dashboard` → `/empresa` y aviso de cambio de modo.
  - Al irse el último empleado: vuelve a individual y los ajustes de equipo vuelven a fábrica.
- **`/empresa`:**
  - Agenda (Día/Semana/Lista y hoja del trabajo).
  - Equipo (tarjeta por persona: servicios, carnet, horario, baja, invitaciones).
  - Marketing.
  - Tu empresa: modo de asignación automático/manual, aceptar trabajos partidos, máximo de personas a la vez, antelación mínima, «yo también trabajo», carnet propio, servicios/precios/zona.
  - Además `/empresa/solicitudes`, `/empresa/resenas`, `/empresa/horario` y `/empresa/equipo/:id/horario`.
- **Operar:**
  - Asignar y cambiar quién va.
  - Repartir por tramos.
  - Mover de fecha con propuesta al cliente.
  - Conflictos de agenda.
  - Trabajos de varias personas y de varios días.
  - Aviso único a quien entra o sale («Nuevo trabajo», «Ya no vas», «Tu parte»).
  - Dar de baja a un empleado (bloqueado con trabajos futuros).

**Empleado**
- Invitación (`/invitacion`): con y sin cuenta, correo distinto, token caducado/anulado/usado, ya cliente (acepta), ya profesional (no puede).
- `/mi-trabajo` (Hoy / Semana / Perfil) y `/mi-trabajo/horario` (solo lectura). «He terminado». Dirección y teléfono solo de sus trabajos. Subir carnet. Barra Mi trabajo / Horario / Cuenta.
- No puede cancelar ni ver trabajos ajenos.

**Admin** (`/admin/*`)
- Dashboard: métricas coherentes con los datos.
- Incidencias: Abiertas / Fallidas / Resueltas; resolver con o sin devolución.
- Profesionales: puesta en marcha, suspender y reactivar.
- Servicios: activar y desactivar.
- Certificados fitosanitarios: aprobar y rechazar.
- Usuarios: solicitudes de jardinero con detalle y fotos (aprobar/rechazar con motivo), monitor de roles, moderación de reseñas y baja de cuentas con sus bloqueos.
- Comisiones: 5 reglas, validación y auditoría.
- Configuración y Mi cuenta.
- Ningún otro rol debe entrar.

**Sistema / reloj:** expiración de solicitudes y propuestas, cierre automático, cola de avisos con reintentos, push, borrado de fotos al cerrar una reserva, horarios recurrentes, reembolsos, pagos tardíos (`reconciliation_required`), idempotencia de webhooks.

## 8. Escenarios mínimos (cada uno con su actor y su verificación lateral)

**A. Altas y acceso**
- A1. Cliente nuevo: registro (con y sin confirmación de correo), entrar, salir, recuperar contraseña, «Cerrar todas», sesión caducada.
- A2. Profesional nuevo: registro → `/apply` completo (recarga a mitad, teléfono inválido, foto grande, sin red) → pendiente → el admin aprueba → correo → guía de puesta en marcha → perfil, cobertura, servicios, precios, disponibilidad y carnet → **aparece** a los clientes.
- A3. Profesional rechazado → motivo → «Corregir y volver a enviar» → aprobado.
- A4. Empleado: todas las variantes de invitación → «Mi trabajo».
- A5. Guardas: cada rol intentando entrar a rutas de otro (URL directa, deep link, ids ajenos).

**B. Reserva autónoma**
- B1. Camino feliz de **cada uno de los 7 servicios**, por foto y manual: precio, horas y bloques coinciden en cliente, profesional y admin → pago `4242` → el profesional acepta → «He terminado» → el cliente confirma → reseña.
- B2. El profesional rechaza: se libera el hueco, hay devolución y llega el correo.
- B3. Sin respuesta en 24 h: la solicitud expira y libera.
- B4. Propuesta de precio y/o duración, desde Solicitudes y desde el chat: aceptar, rechazar y caducar.
- B5. Cancelación por el cliente a más y a menos de 24 h. Cancelación por el profesional de una reserva aceptada.
- B6. Pago: tarjeta rechazada, 3DS, fondos insuficientes, abandonar y volver, caducidad del hueco, dos pestañas, dos clientes por el mismo hueco, webhook repetido.
- B7. Cierre: confirmar por la app, por el enlace del correo sin sesión y por cierre automático. Incidencias (las 3 que bloquean y las 3 de soporte) → el admin resuelve con y sin devolución.
- B8. Reseñas: valorar, editar, responder, el admin oculta.
- B9. Repetir reserva. Plan de mantenimiento (crear, cancelar, visita y pago).
- B10. Multi-servicio, trabajo de más de 12 h en varios días, servicio parcial.
- B11. Enlace/QR propio: cliente propio sin gastos de gestión, rotar clave, enlace sin clave.
- B12. Reanudar el embudo tras login, recarga o cierre de Safari.

**C. Equipo**
- C1. Promoción a equipo y aviso de cambio de modo.
- C2. Servicios, carnet y horario por persona (correo de «horario publicado»).
- C3. Venta por el equipo: asignación automática y manual, conflicto de agenda, dos clientes a la misma hora, máximo de personas, trabajos partidos.
- C4. Cambiar quién va, repartir y mover de fecha (el cliente acepta, rechaza o caduca): avisos únicos y sin duplicados.
- C5. El empleado trabaja: Hoy/Semana, llamar, cómo llegar, «He terminado», sin ver datos ajenos.
- C6. Baja de empleado, anular invitación, último empleado fuera → modo individual.
- C7. Fitosanitarios: carnet del empleado → el admin aprueba → se puede asignar. Carnet caducado → se pierde.

**D. Admin**
- D1. Cola de altas, carnets e incidencias.
- D2. Suspender y reactivar un profesional: no aparece, recibe aviso y sus reservas siguen.
- D3. Baja de cuentas con bloqueos y motivos.
- D4. Moderar reseñas.
- D5. Cambiar una comisión y comprobar el efecto en un presupuesto nuevo, sin tocar los ya firmados.
- D6. Servicios on/off y su efecto en el embudo.
- D7. Métricas frente a la BD.

**E. Transversales a todo flujo**
- iOS: safe-area y barra inferior, teclado tapando campos o botones, zoom por input, 44 px táctiles, scroll y recarga, atrás por gesto, orientación, modo oscuro (también en correos), pantalla pequeña.
- Resiliencia: sin red y red lenta, doble toque, atrás/adelante, recarga a mitad, sesión caducada, dos dispositivos con la misma cuenta.
- Datos: coherencia precio ↔ horas ↔ bloques ↔ importes en las tres vistas, redondeos, moneda y formatos de fecha en español, textos «profesional» frente a «jardinero» según el contexto.
- Seguridad desde la interfaz: ids ajenos, URL directa, un rol usando pantallas de otro, datos personales visibles de más.
- Avisos: ni faltan ni se duplican, nombres reales, enlaces que abren la pantalla correcta.
- Consola: Safari Web Inspector (menú Develop) o Appium sin errores en los recorridos.

## 9. Fases

**FASE 1 — Entorno y línea base (autónoma)**
1. Pre-flight (sección 2) y comprobación de que todo apunta a local.
2. Levanta: `supabase start` + `supabase db reset` (estado limpio con semilla), `supabase functions serve --env-file supabase/functions/.env`, `stripe listen` si procede, `npm run dev` (anota el puerto real). Arranca los simuladores.
3. Línea base: `npm test`, `npm run build`, `npm run lint`, baterías de servidor y `readiness`. Anota las cifras. Lo que ya falle antes de empezar queda como «preexistente».
4. Humo: cada rol entra a su pantalla de inicio en su simulador.

**FASE 2 — Simulacro por rondas (autónoma)**
- Rondas sugeridas, ajústalas en el plan: R1 altas y acceso (A) → R2 configuración del profesional → R3 reserva (B1–B3) → R4 negociación y cancelaciones (B4–B5) → R5 pago y cierre (B6–B8) → R6 extras (B9–B12) → R7 equipo (C) → R8 admin (D) → R9 transversales (E).
- En cada ronda: prepara estado → ejecuta por interfaz → verifica de lado → restaura. Actualiza `PROGRESO.md` y `HALLAZGOS.md`.
- Repite los recorridos críticos en el iPhone de pantalla pequeña.

**FASE 3 — Informe (PARA y espera mi OK)**
`INFORME.md` con:
- Recuento por severidad y tabla priorizada.
- Cobertura real frente a la matriz (qué no se pudo probar y por qué) y limitaciones del simulador.
- Plan de corrección ordenado con estimación.
- Lista de recorridos que quedan como scripts.

**FASE 4 — Corrección (tras mi OK sobre la lista)**
- Un hallazgo o grupo coherente por commit, en la rama `qa/...`.
- Cada corrección con su prueba de regresión (unitaria o recorrido) y el ciclo de 5 pasos de `docs/garser-empresas/07-PROCEDIMIENTO-CORRECCION.md`.
- Reglas del repo: el autónomo no se rompe; no dupliques motores de precio, disponibilidad ni reservas; `bookings` solo por RPC; no consultes otra tabla dentro de una policy sin `SECURITY DEFINER`; nunca aceptes `company_id` del navegador.
- Si tocas `src/shared/bookingQuoteCore.ts` o las comisiones, anota el redespliegue de `booking-authority` y `booking-payment`.

**FASE 5 — Verificación final y preparación de salida (tras la Fase 4)**
- Repite TODO (línea base y recorridos) sobre el commit exacto que se subiría.
- Entrega `CHECKLIST-SALIDA.md`:
  - commit y resultados;
  - migraciones nuevas y su orden (`npx supabase db push`, con copia de seguridad antes);
  - funciones a redesplegar (`npx supabase functions deploy <nombre> --use-api`);
  - variables a revisar en Vercel y en los secretos de Supabase;
  - lo que solo se puede comprobar en garser.es o en un dispositivo real (push, instalación, Google OAuth, correos reales, Stripe real), siguiendo `docs/garser-empresas/06-PRUEBA-REAL-PENDIENTE.md` §3.
- **No despliegues nada.** Fusionar a `main` publica la web en Vercel: esa orden es mía.
- Opcional: complementa con la skill del repo `garser-production-audit` para el plano de código estático.

## 10. Formato del hallazgo (`docs/qa-simulacro/HALLAZGOS.md`)

`QA-NNN · [P0–P3] · título corto`
- **Rol / dispositivo / commit.**
- **Pasos** exactos para reproducir.
- **Esperado** frente a **ocurrido**.
- **Evidencia:** captura o vídeo, log y consulta SQL.
- **Verificado:** ¿se reproduce, solo en simulador, solo en local? ¿Ya conocido (PH-xx)?
- **Causa probable** con `fichero:línea` (solo si la has leído).
- **Atajo usado:** sí/no.

Severidades:
- **P0:** pérdida o cobro indebido de dinero, doble venta de un hueco, fuga de datos personales, imposible completar un flujo crítico.
- **P1:** flujo crítico roto con rodeo, dato incorrecto visible, aviso que falta o se duplica.
- **P2:** fallo menor o de UX.
- **P3:** estético o mejora.

## 11. Criterio de «listo para producción»

- Cero P0 y P1 abiertos; los P2 aceptados por mí por escrito.
- Cada corrección con regresión.
- Línea base ≥ la inicial (pruebas y build en verde).
- Todos los recorridos críticos en verde, en iPhone normal y pequeño, sobre el commit final.
- Consola sin errores en esos recorridos.
- Todo lo no verificable en local, listado y con quien lo verifica.
