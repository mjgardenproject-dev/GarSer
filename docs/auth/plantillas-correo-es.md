# Correos de acceso de Supabase Auth, en español (QA-039)

Los correos de **confirmar el alta**, **recuperar la contraseña**, **enlace mágico**, **cambio de correo**, **invitación** y
**código de reautenticación** los envía Supabase Auth, no GarSer. Vienen con sus plantillas por defecto, **en inglés**.
Los textos en español ya están escritos en `supabase/templates/*.html`, con el asunto en `supabase/config.toml`
(`[auth.email.template.*]`). Una prueba (`supabase/templates/templates.test.ts`) comprueba que todos existen, que llevan la
variable de Supabase que necesitan (`{{ .ConfirmationURL }}` o `{{ .Token }}`) y que no queda inglés.

## Qué tienes que hacer tú (una sola vez, antes de publicar)

En el panel de Supabase de **producción**: *Authentication → Emails → Templates*. Para cada una de las seis, pega el asunto y
el contenido HTML del fichero (abre el `.html`, copia todo, pégalo en «Message body» y guarda):

| Plantilla de Supabase | Asunto | Fichero |
|---|---|---|
| Confirm signup | Confirma tu correo en GarSer | `supabase/templates/confirmation.html` |
| Reset password | Cambia tu contraseña de GarSer | `supabase/templates/recovery.html` |
| Magic link | Tu enlace para entrar en GarSer | `supabase/templates/magic_link.html` |
| Change email address | Confirma tu nuevo correo en GarSer | `supabase/templates/email_change.html` |
| Invite user | Te han invitado a GarSer | `supabase/templates/invite.html` |
| Reauthentication | Tu código de GarSer | `supabase/templates/reauthentication.html` |

(Alternativa: `supabase config push` aplica el `config.toml` entero, pero toca también otros ajustes del proyecto; mejor
revisar antes con `supabase config push --dry-run` o pegarlas a mano.)

Después, en *Authentication → URL Configuration*: que **Site URL** sea `https://garser.es` y que `https://garser.es/**` esté
en las *Redirect URLs* (el botón del correo vuelve a la web).

## Cómo comprobarlo (sección 49 de `docs/audit/2026-07-12/PRUEBAS-PRODUCCION.md`)

1. Crea una cuenta nueva con un correo tuyo: te llega «Confirma tu correo en GarSer», en español, con el botón.
2. En «Entrar», con esa cuenta sin confirmar: mensaje en español y botón «Reenviar el correo de confirmación».
3. «¿Has olvidado tu contraseña?»: te llega «Cambia tu contraseña de GarSer»; el botón abre «Elige tu nueva contraseña» con tu correo.

## Remitente

Por defecto Supabase envía desde `noreply@mail.app.supabase.io`, con un límite muy bajo de correos por hora. Para producción
conviene un SMTP propio (Authentication → SMTP Settings) con un remitente tipo `no-reply@garser.es`; sin él, con anuncios en
marcha, el límite de altas por hora se puede quedar corto y los correos pueden caer en spam. Es una decisión tuya (coste y
proveedor): GarSer ya envía otros correos por su propio servicio (`send-email-notification`).
