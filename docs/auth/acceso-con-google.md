# «Continuar con Google» — cómo activarlo (2026-10-21)

La web ya tiene el botón. Hasta que estén hechos estos pasos no aparece: sin la variable
`VITE_GOOGLE_CLIENT_ID` la pantalla de acceso es la de siempre.

Se hacen en este orden y una sola vez. Calcula unos 20 minutos.

## 1. Google Cloud Console (gratis)

Entra en <https://console.cloud.google.com> con la cuenta de Google de GarSer.

1. **Proyecto.** Arriba a la izquierda: «Seleccionar proyecto» → «Proyecto nuevo» → nombre `GarSer` → Crear.
2. **Pantalla de consentimiento.** Menú → «APIs y servicios» → «Pantalla de consentimiento de OAuth» («Google Auth Platform»). Si pregunta el tipo de usuario: **Externo**.
   - **Información de la aplicación:**
     - nombre: `GarSer`;
     - correo de asistencia: `info@garser.es`;
     - logotipo: opcional (el de GarSer). Si lo pones, Google lo revisa antes de enseñarlo.
   - **Dominio de la aplicación:**
     - página principal: `https://garser.es`;
     - política de privacidad: `https://garser.es/privacidad`;
     - términos del servicio: `https://garser.es/terminos`.
   - **Dominios autorizados:** `garser.es` y `hleqspdnjfswrmozjkai.supabase.co`.
   - **Contacto del desarrollador:** tu correo.
   - **Permisos (scopes):** solo los básicos: `openid`, `.../auth/userinfo.email` y `.../auth/userinfo.profile`. No piden verificación de Google.
   - **Público / Estado de publicación:** pulsa **«Publicar aplicación»** para pasarla a **«En producción»**.
     ⚠️ Si se queda en «Prueba», solo podrán entrar las cuentas que añadas como usuarios de prueba.
3. **Credenciales.** «APIs y servicios» → «Credenciales» → «Crear credenciales» → «ID de cliente de OAuth».
   - **Tipo:** Aplicación web. **Nombre:** `GarSer web`.
   - **Orígenes de JavaScript autorizados:**
     - `https://garser.es`;
     - `https://www.garser.es` (si usas el «www»);
     - `http://localhost:5190` (para probar en local).
   - **URI de redirección autorizados:** `https://hleqspdnjfswrmozjkai.supabase.co/auth/v1/callback`.
   - Crear. **Copia el «ID de cliente»** (acaba en `.apps.googleusercontent.com`) y el **«Secreto del cliente»**.
4. **Opcional, recomendado:** verifica `garser.es` en Google Search Console y pide la verificación de la marca. Así Google enseña el logo de GarSer en su ventanita.

## 2. Supabase (proyecto `hleqspdnjfswrmozjkai`)

<https://supabase.com/dashboard/project/hleqspdnjfswrmozjkai>

1. **Authentication → Sign In / Providers → Google:** activar.
   - **Client IDs:** el ID de cliente del paso 1.3.
   - **Client Secret (for OAuth):** el secreto del paso 1.3.
   - **Skip nonce checks:** **desactivado**. La web manda un nonce en cada intento para que nadie reutilice un token.
   - **Allow users without an email:** desactivado.
   - Guardar.
2. **Authentication → URL Configuration:**
   - **Site URL:** `https://garser.es`.
   - **Redirect URLs:** añade `https://garser.es/**` (y `https://www.garser.es/**` si usas el «www»). Hace falta para la vuelta clásica, cuando el navegador bloquea el botón de Google.

Las cuentas con el mismo correo se unen solas: quien ya tenía cuenta con su Gmail entra con Google en la misma cuenta, con sus reservas y su rol.

## 3. Vercel

Proyecto `gar-ser` → Settings → Environment Variables:

- `VITE_GOOGLE_CLIENT_ID` = el ID de cliente del paso 1.3, en **Production** y **Preview**.

Después, **vuelve a desplegar** (Deployments → el último → Redeploy). Vite mete la variable al construir la web: sin desplegar de nuevo, el botón no sale.

## 4. Datos legales

Completa en `src/config/legal.ts`:

- `ownerName`;
- `taxId`;
- `address`;
- `registry`, solo si eres una sociedad.

O pásamelos y lo hago yo. Mientras falten, las páginas `/privacidad` y `/terminos` enseñan «[Completar: …]» resaltado. Google pide esas dos páginas en la pantalla de consentimiento. Conviene que un abogado revise los textos.

## 5. Seguridad de la cuenta de administración

La cuenta de administración (`mjgardenproject@gmail.com`) también podrá entrar con Google. Activa la **verificación en dos pasos** de esa cuenta de Google: <https://myaccount.google.com/signinoptions/two-step-verification>.

## Cómo funciona (para quien mantenga el código)

- **El botón:** `src/components/auth/GoogleSignInButton.tsx`. Google Identity Services (botón oficial y «One Tap») en la propia web.
  - Devuelve un ID token que `supabase.auth.signInWithIdToken` verifica con un nonce: SHA-256 a Google y el valor original a Supabase.
  - No se sale de garser.es, así que no se pierde la reserva.
- **Si el script de Google no carga** (bloqueadores): `signInWithOAuth`, la redirección clásica, que vuelve por `/auth/callback?next=…` (`src/pages/auth/AuthCallbackPage.tsx`).
- **Dentro de Instagram, Facebook o TikTok** (`detectEmbeddedBrowser`): Google no deja entrar. Se explica cómo abrir la web en el navegador y se puede copiar el enlace (en la reserva, con la reserva dentro).
- **Cuentas nuevas:** el servidor las crea como «cliente» (`provision_profile_on_signup`). Las de jardinero y empresa se siguen creando con correo.
- **Nombre y foto:** se copian al perfil de un cliente solo si está vacío (`src/lib/oauthAccount.ts`).
- **Medición:** `admin_signup_methods(p_days)`, en el panel del admin: «Altas con Google · 30 días».
- **Probar en local con Google de verdad:**
  - pon el ID de cliente real en `.env.local` (`VITE_GOOGLE_CLIENT_ID`);
  - activa Google en `supabase/config.toml` con `[auth.external.google]`, `enabled = true`, `client_id = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)"` y `secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)"`;
  - reinicia `supabase`.
