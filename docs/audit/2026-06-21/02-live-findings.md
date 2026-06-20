# GarSer — Auditoría web EN VIVO (2026-06-21)

> Entorno: `npm run dev` (puerto 5173) bajo Claude Preview. Viewport principal: móvil 375×812.
> Cubre rutas PÚBLICAS (sin login). Las rutas autenticadas quedan pendientes (requieren credenciales de prueba).

## Hallazgos

### [ALTO] Bloque placeholder de desarrollo visible en las landings públicas
- **Dimensión:** 7 — Features sin terminar (público)
- **Archivo:** `src/components/public/MarketingImageSlot.tsx:29-48`
- **Visto en vivo:** `/` (4 tarjetas) y `/para-jardineros` (≥1), viewport 375. Texto: *"SLOT LISTO PARA FOTO REAL — Sube el archivo correspondiente a este path en Supabase Storage para reemplazar este bloque sin tocar codigo. Path: …"*.
- **Problema:** Cuando la imagen de marketing no existe en Supabase Storage, el componente cae en un fallback que muestra **instrucciones internas de desarrollo y la ruta del bucket** a cualquier visitante. Las imágenes no están subidas, así que el bloque sale en producción.
- **Impacto:** Aspecto no profesional en la primera pantalla que ve un cliente; además filtra rutas internas de almacenamiento.
- **Fix:** (a) Subir las imágenes reales a Storage, y (b) cambiar el fallback `hasError` para que en producción muestre un placeholder neutro de marca (gradiente + `alt`), sin texto de dev ni `Path:`. Gatear el detalle técnico tras `import.meta.env.DEV`.
- **Esfuerzo:** S (fallback) + M (imágenes)

### [MEDIO] Copy público sin tildes (calidad de idioma)
- **Dimensión:** 10 — UX / contenido
- **Visto en vivo:** `/` y `/para-jardineros`: "jardineria", "pagina", "autonomos", "via", "codigo", "jardin", "Marbella, Estepona y Costa del Sol" (ok) pero cuerpo sin acentos.
- **Problema:** Texto de cara al cliente sin acentuación correcta. Resta profesionalidad y afecta SEO/lectura.
- **Fix:** Corregir el copy en `src/config/publicSiteContent.*` y componentes de landing. Revisar todo el texto público.
- **Esfuerzo:** S

### [BAJO] Path de Supabase Storage mostrado al público
- **Dimensión:** 3/7 — Seguridad menor / Features
- **Archivo:** `src/components/public/MarketingImageSlot.tsx:45` (`Path: {assetPath}`)
- **Problema:** Divulgación menor de estructura interna de almacenamiento. Se resuelve con el mismo fix del fallback.
- **Esfuerzo:** S

## Positivo (sin hallazgos)
- **Responsive móvil (375):** `/`, `/reserva` (paso 1 Dirección) y `/para-jardineros` se ven correctos, sin scroll horizontal (`scrollWidth == innerWidth == 375`).
- **Flujo de reserva:** el paso 1 (Dirección) está bien resuelto en móvil: progress "Paso 1 de 5", input de dirección, "usar mi ubicación", consejo y CTA fijo inferior.
- **Consola:** sin errores en la home.

## Pendiente (requiere credenciales / interacción)
Rutas autenticadas y de flujo profundo que no se han podido auditar en vivo todavía:
- Flujo de reserva completo: servicios → **detalles (subida de fotos + análisis IA)** → providers → disponibilidad → checkout (Stripe test) → confirmación.
- `/dashboard`, `/bookings`, `/chat`, `/status`.
- `/apply` y panel de jardinero (alta, perfil, precios, agenda).
- `/admin/dashboard`, `/admin/services`, `/admin/phytosanitary`, `/admin/users`, `/admin/settings`.
- `/marbella` (pública, pendiente de captura).
- Repetir en tablet (768) y escritorio (1280) las pantallas con más densidad (DetailsPage, ProvidersPage, ConfirmationPage, admin).

**Para continuar necesito:** un usuario de prueba (cliente) y, si es posible, uno de jardinero y uno de admin; y saber si Stripe está en modo test para probar el checkout.
