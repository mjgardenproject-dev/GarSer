-- Consentimiento de publicidad de quien envía una solicitud de alta (2026-11-02).
--
-- Por qué: el evento «ProviderApproved» del Conversions API de Meta (PR #66) lo mandaba el navegador
-- del admin con el correo cifrado de la persona aprobada, y no quedaba guardado en ninguna parte si esa
-- persona había aceptado la categoría «Publicidad» del banner de cookies. Se retiró en el PR #69. Para
-- poder volver a mandarlo con permiso, la solicitud guarda lo que la persona decidió en SU navegador
-- cuando la rellenó: el aviso de cookies solo existe ahí.
--
-- Qué guarda:
--   · ads_consent    true solo si en ese momento tenía aceptada la publicidad. Por defecto false, así
--                    que las solicitudes que ya existen NUNCA mandan nada a Meta.
--   · ads_consent_at cuándo tomó esa decisión (la del banner, no la del envío), como prueba.
-- Lo escribe el propio navegador junto con el resto de la solicitud, mientras es borrador; el admin la
-- lee con el resto de columnas (select *). Quien se la ponga a true sin haberla aceptado solo afecta a
-- sus propios datos.
--
-- Limitación conocida: si retira el consentimiento DESPUÉS de enviar la solicitud, este registro no se
-- entera (la revisión tarda menos de 24 h). Si hiciera falta, habría que ofrecer la retirada en la
-- cuenta del profesional.
--
-- Vuelta atrás: ALTER TABLE … DROP COLUMN ads_consent, DROP COLUMN ads_consent_at en las dos tablas
-- (y quitar el uso en el front; sin ellas «ProviderApproved» no se manda).

ALTER TABLE public.gardener_applications
  ADD COLUMN IF NOT EXISTS ads_consent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ads_consent_at timestamptz;

ALTER TABLE public.company_applications
  ADD COLUMN IF NOT EXISTS ads_consent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ads_consent_at timestamptz;

COMMENT ON COLUMN public.gardener_applications.ads_consent IS
  'La persona tenía aceptada la publicidad (cookies) al rellenar la solicitud; permite mandar «ProviderApproved» a Meta.';
COMMENT ON COLUMN public.company_applications.ads_consent IS
  'La persona tenía aceptada la publicidad (cookies) al rellenar la solicitud; permite mandar «ProviderApproved» a Meta.';

-- company_applications solo deja escribir las columnas que se conceden una a una (el estado y la
-- revisión no se pueden tocar desde el navegador); hay que abrir las dos nuevas. gardener_applications
-- no tiene permisos por columna: la regla applications_own_update ya limita a su borrador.
GRANT INSERT (ads_consent, ads_consent_at) ON public.company_applications TO authenticated;
GRANT UPDATE (ads_consent, ads_consent_at) ON public.company_applications TO authenticated;
