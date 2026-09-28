# Fallos de la prueba real en garser.es — GarSer Empresas

> Abierto el 2026-09-28, tras fusionar la PR #40. El usuario usa garser.es como un usuario real y
> reporta los fallos **uno a uno**. Por cada fallo, el chat:
>
> 1. Investiga la causa exacta, con `fichero:línea` y comprobándola contra producción cuando se
>    pueda.
> 2. Lo apunta aquí.
> 3. **No toca código.** El código se cambia solo cuando el usuario termine de reportar.
>
> Cuando el usuario cierre la lista, se escribe en §3 el **plan de implementación por fases**,
> con sus pruebas (locales y en garser.es), y solo entonces se programa.
>
> Numeración: **R-NN** (fallo de la prueba Real), para no mezclarla con los H-NN de
> `02-HALLAZGOS.md`. Si un R cambia una decisión de diseño, se enlaza desde allí.

---

## 1. Índice

| # | Qué ve el usuario | Gravedad | ¿Es de GarSer? | Estado |
|---|---|---|---|---|
| R-01 | Al iniciar sesión como admin, la consola se llena de errores | Baja (sin efecto funcional) | Una parte sí (1 aviso); el resto es de una extensión de Chrome | Analizado |

Gravedad: **Crítica** (dinero, datos o seguridad) · **Alta** (un usuario no puede completar algo)
· **Media** (lo completa, pero mal o confuso) · **Baja** (cosmético, o solo se ve en la consola).

---

## 2. Fallos

### R-01 — Errores en la consola al iniciar sesión como admin

**Qué se ve.** Tras iniciar sesión con la cuenta de admin en garser.es, la consola del navegador
muestra, por orden:

- `Error in event handler: TypeError: Cannot read properties of undefined (reading 'id')`, en
  `chrome-extension://pejdijmoenmkgeppbflobdenhhabjlaj/background.js`.
- 86 veces `Unchecked runtime.lastError: The message port closed before a response was received.`
- 5 veces `Uncaught (in promise) FrameDoesNotExistError: Frame N does not exist in tab …`, en
  `background.js`.
- 1 vez `WebSocket connection to 'wss://hleqspdnjfswrmozjkai.supabase.co/realtime/v1/websocket…'
  failed: WebSocket is closed before the connection is established.`, en `index-B4afYII6.js`
  (el código de garser.es).

Son **dos problemas distintos**.

#### R-01a — Los 92 primeros mensajes no son de GarSer

Los tres primeros tipos de mensaje los genera una **extensión de Chrome** instalada en el
navegador del usuario:

- Todos salen de `chrome-extension://pejdijmoenmkgeppbflobdenhhabjlaj/background.js`, el script
  de fondo de esa extensión. Ninguno sale de `garser.es`.
- `runtime.lastError` y `FrameDoesNotExistError` son errores de la API de extensiones de Chrome.
  Pasan cuando la extensión envía mensajes a pestañas o marcos que ya se han cerrado o han
  cambiado de página, como ocurre al iniciar sesión y redirigir.
- GarSer no usa `chrome.runtime` ni mensajería entre marcos.

**Qué hacer:** nada en GarSer. Para saber qué extensión es:

1. Abrir `chrome://extensions`.
2. Activar el «Modo de desarrollador».
3. Buscar el identificador `pejdijmoenmkgeppbflobdenhhabjlaj`.

Para probar garser.es sin ese ruido, usar una ventana de incógnito sin extensiones. Un cliente
real con esa misma extensión vería lo mismo en su consola, pero la web le funciona igual.

#### R-01b — El aviso del WebSocket sí es de GarSer

**Qué es.** El distintivo de «mensajes sin leer» de la barra de navegación abre una conexión en
tiempo real y la cierra antes de que termine de conectarse. El navegador avisa de ese corte.

**Causa exacta.** Se ha comprobado contra el código publicado: la línea 420 de
`https://garser.es/assets/index-B4afYII6.js` contiene `useUnreadChats` (el canal
`unread_badge_…`) y el envío del formulario de acceso (`navigate(… "/dashboard")`), que son las
funciones del rastro.

1. El admin inicia sesión en `/auth`. En esa página no se pintan ni la barra superior ni la
   inferior: `src/App.tsx:113` (`isAuthPage`), `:267` y `:598`.
2. `AuthForm` llama a `signIn` y después navega **siempre** a `/dashboard`
   (`src/components/auth/AuthForm.tsx:136-138`).
3. `/dashboard` no es una página de admin, así que se montan `Navbar` y `BottomNav`
   (`src/App.tsx:267`, `:598`). Cada una usa `useUnreadChats`, que, al haber usuario, abre un
   canal de Realtime (`src/hooks/useUnreadChats.ts:42-54`). Esa es la primera conexión del
   WebSocket, que empieza a conectarse.
4. En ese mismo instante, `/dashboard` ve que la cuenta es admin y redirige a `/admin/dashboard`
   (`src/App.tsx:336-337`).
5. En `/admin/*` no se pintan las barras (`src/App.tsx:117`, `isAdminPage`), así que se
   desmontan. La limpieza del hook llama a `supabase.removeChannel`
   (`src/hooks/useUnreadChats.ts:59`).
6. `removeChannel` de realtime-js 2.15.5 desconecta el WebSocket cuando no queda ningún canal
   (`node_modules/@supabase/realtime-js/dist/main/RealtimeClient.js:240-245`). El socket aún
   estaba conectándose, y el navegador escribe el aviso.

**Impacto.**

- **Ninguno funcional.** El panel de admin no usa tiempo real, y no hay datos en juego.
- Es una **conexión desperdiciada**: se abre y se cierra sin usarse en cada inicio de sesión de
  admin.
- Es **ruido en la consola**, que tapa los errores de verdad cuando se prueba.
- **Otras cuentas.**
  - Cliente, autónomo, dueño de empresa y empleado **no** lo tienen al iniciar sesión: tras
    `/dashboard` siguen en páginas con barras, así que el canal se queda abierto y se usa.
  - Aun así, el paso por `/dashboard` y la redirección son comunes a todas las cuentas, y
    cualquier salto a una página sin barras justo después de montarlas repite el aviso. Por
    ejemplo, entrar en una reserva nada más iniciar sesión, porque en `/reserva*` también se
    ocultan (`src/App.tsx:114`, `isBookingPage`).
- Se relaciona con dos cosas conocidas, que no se tocan aquí:
  - `AuthContext` escribe mensajes `console.log('🕒', …)` en producción
    (`src/contexts/AuthContext.tsx:106`).
  - Cada cuenta monta **dos** canales iguales, uno por barra (`useUnreadChats.ts:18-19`).

**Solución propuesta** (a confirmar en el plan de §3):

1. **Que el admin no pase por `/dashboard`.** Al iniciar sesión, llevar a cada cuenta
   directamente a su panel (`/admin/dashboard` para el admin). El tipo de cuenta ya se lee en
   `signIn` (`AuthContext.tsx:176`), así que se evita montar las barras para desmontarlas un
   instante después.
2. **Que el distintivo de chats no se active en una cuenta de admin.** El admin no tiene chats,
   y así no se abre el canal aunque en el futuro se llegue a otra página con barras.
3. **Un único canal de «sin leer» por usuario,** compartido por `Navbar` y `BottomNav` (un
   proveedor o un contador de uso), en lugar de uno por barra. Si una barra se desmonta, la otra
   no pierde la conexión.
4. **Opcional, a decidir:** quitar en producción los `console.log` de diagnóstico de
   `AuthContext`, para que la consola solo muestre lo que importa.

**Pruebas propuestas.**

- **Unitarias:**
  - `useUnreadChats` no abre canal para una cuenta de admin.
  - Con `Navbar` y `BottomNav` montadas a la vez se abre **un** canal.
  - Al desmontar una barra, el canal sigue abierto; al desmontar las dos, se cierra.
  - El destino tras iniciar sesión depende del tipo de cuenta: admin → `/admin/dashboard`.
- **Navegador local:**
  - Iniciar sesión como admin con la consola abierta: ningún aviso de WebSocket, y en la
    pestaña «Red» ninguna conexión `realtime` abierta.
  - Iniciar sesión como cliente: una sola conexión, que se queda abierta.
  - El distintivo de «sin leer» sigue subiendo al recibir un mensaje.
- **En garser.es (P-R01-1):** iniciar sesión como admin en una ventana de incógnito sin
  extensiones y comprobar que la consola queda limpia. Repetir como dueño de empresa y como
  cliente, y comprobar que el chat avisa en tiempo real.

---

## 3. Plan de implementación

*(Se escribe cuando el usuario termine de reportar los fallos.)*
