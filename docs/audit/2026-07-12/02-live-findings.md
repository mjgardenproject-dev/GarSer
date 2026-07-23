# Hallazgos web en vivo (npm run dev, Supabase LOCAL 127.0.0.1:54321)

Entorno: Vite + Supabase local. Viewport principal 375×812 (móvil). Recorrido: home → funnel servicios → detalles → wizard manual césped → auth.

**Aviso de entorno:** el dev apunta a un Supabase LOCAL, no a producción. Por eso las imágenes de `marketing-assets` fallan (bucket local vacío) y `booking-telemetry` da 503 (no desplegada localmente). Esos dos síntomas NO son bugs de producción por sí mismos, pero confirman el comportamiento del fallback y del código.

## Recorrido y estado

| Pantalla | Móvil 375px | Consola/Red | Notas |
|---|---|---|---|
| Home `/` | OK, sin scroll horizontal (scrollWidth=clientWidth) | Sin errores | Copy sin tildes: "jardineria", "jardin", "mas preciso". Jerarquía y CTAs correctos. |
| Servicios (paso 2) | OK, 7 servicios, touch targets amplios, aria-labels correctos | Imágenes marketing-assets fallan (local) | Fallback: badge oscuro "Imagen no disponible" muy prominente + gradiente gris; texto blanco sobre gris claro = bajo contraste. "Poda de setos" sí carga (service_images). |
| Detalles (paso 3) | OK | Sin errores | Elección IA (recomendado, preseleccionado) vs manual, limpia y clara. |
| Wizard manual césped | OK, arranca "Paso 1 de 2 · ¿Cuántos m²?" con input decimal + "Cambiar a fotos" | Sin errores | El funnel encadena correctamente entre pasos. |
| Auth `/auth` | OK, mobile-first, jerarquía correcta | Sin errores | Copy con tildes correcto; toggle de contraseña, "olvidé contraseña", registro. |

## Hallazgos

### [MEDIO] Fallback de imágenes de servicio poco profesional (badge "Imagen no disponible" prominente + bajo contraste)
- **Dimensión:** 8/10 UX
- **Archivo:** vivo: /reservar paso Servicios @ 375px; ServicesPage.tsx (overlay de fallback)
- **Problema:** Cuando la imagen no carga (hoy, todas salvo setos), la tarjeta muestra un badge oscuro grande "Imagen no disponible" sobre gradiente gris con el nombre en blanco de bajo contraste. Da aspecto de app rota justo en el paso donde el cliente elige qué contratar.
- **Impacto:** Conversión: primera impresión del catálogo degradada. Se resuelve al subir las 7 imágenes reales (pendiente manual), pero el fallback en sí debería ser un placeholder de marca elegante, no un badge de error.
- **Fix:** Sustituir el overlay por un placeholder neutro con el icono del servicio y el nombre con contraste AA; subir las 7 webp a `marketing-assets`.
- **Esfuerzo:** S

### [BAJO] Copy público sin tildes en la home ("jardineria", "jardin", "mas")
- **Dimensión:** 10 UX / SEO
- **Archivo:** vivo: `/` (PublicHomePage / MarbellaLandingPage)
- **Problema:** El H1 y el cuerpo de la landing usan "jardineria/jardin/mas" sin tilde. Afecta a percepción de calidad y a coincidencia de términos de búsqueda con tilde.
- **Impacto:** Imagen de marca y SEO en la página más visitada.
- **Fix:** Revisar y corregir la ortografía del copy público (con tildes).
- **Esfuerzo:** S

## No auditado en vivo (por límite de sesión)
Funnel completo hasta checkout Stripe de los 7 servicios en ambos caminos; panel jardinero, admin, área cliente en vivo; viewports 768/1440. La lógica de esas superficies está cubierta en profundidad por el análisis estático (Dim 1, 4, 5, 7). Recomendado un pase en vivo dirigido tras aplicar los fixes críticos.
