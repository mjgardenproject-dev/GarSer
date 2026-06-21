# Las 10 dimensiones de la auditoría GarSer

Para cada dimensión: **qué buscar**, **cómo detectarlo** y **señales concretas en GarSer**.

---

## Rúbrica de severidad (usar en todos los hallazgos)

- **CRÍTICO** — Rompe producción, pierde dinero, expone datos, o un flujo nuclear no funciona.
  Ej.: una RLS abierta, un pago que no se registra, un email de confirmación que nunca se envía.
- **ALTO** — Bug funcional serio o riesgo de datos sin pérdida inmediata. Feature visible rota.
  Ej.: estado del análisis que nunca se muestra bien, validación ausente que corrompe datos.
- **MEDIO** — Degrada la experiencia o la mantenibilidad pero hay workaround.
  Ej.: no responsive en una pantalla secundaria, código muerto, console.logs en producción.
- **BAJO** — Cosmético o de pulido. Ej.: padding inconsistente, copy mejorable.

---

## PLANO A — Código y arquitectura

### Dimensión 1 — Lógica de negocio e incoherencias con la vida real
**Qué buscar:**
- Cálculos de precio/tiempo que no cuadran con la realidad (jardinería).
- Reglas de negocio contradictorias entre `domain/`, edge functions y UI.
- Rangos imposibles (alturas negativas, áreas de 0, descuentos >100%).
- Estados que no pueden ocurrir o transiciones de estado inválidas.
**Cómo:** Leer `src/domain/pricingEngine.ts`, `speciesBusinessRules.ts`, las edge functions de
pricing, y contrastar con los enums/valores que produce la IA y consume la UI.
**Señales GarSer:** mismatch de enums IA↔UI (estado_jardin, estado_seto), conversión metros→bucket
de palmeras, multiplicadores de dificultad, factor de eficiencia por nº de elementos.

### Dimensión 2 — Código basura / muerto / archivos sueltos
**Qué buscar:**
- Archivos en la raíz que no son parte del build (scripts de patch, SQL sueltos, .md de debug).
- Componentes/funciones no importados en ningún sitio.
- Ramas de código inalcanzables, imports sin usar, `.bak` y temporales.
- `console.log`, `debugger`, código comentado masivo.
**Cómo:** `grep` de imports, detección de archivos huérfanos, revisión de la raíz del repo.
**Señales GarSer:** ~40 archivos sueltos en raíz (`check_*.js`, `fix_*.sql`, `patch_*`,
`debug-*.md`, `temp*.txt`), `index.ts.bak`, 88 `console.log`, carpeta `debug/`.

### Dimensión 3 — Seguridad
**Qué buscar:**
- Políticas RLS faltantes o demasiado permisivas en Supabase.
- Secretos hardcodeados, claves en el cliente, `.env` commiteado.
- Edge functions sin validar input / sin auth.
- Webhooks de Stripe sin verificar firma.
- XSS (dangerouslySetInnerHTML), inyección, IDOR.
**Cómo:** Usar el skill integrado `/security-review`. Revisar `supabase/migrations/*rls*`,
`fix_rls_*.sql`, edge functions, y `.env*`. Revisar `booking-payment-webhook`.
**Señales GarSer:** múltiples SQL de "fix_rls" sugieren historial de problemas de RLS;
verificar estado final. `.env.local` presente — confirmar que está en .gitignore.

### Dimensión 4 — Flujos desconectados
**Qué buscar:**
- Componentes renderizados pero cuyos handlers no hacen nada.
- Botones/CTA sin onClick efectivo o que apuntan a rutas inexistentes.
- Páginas no enlazadas desde ningún sitio (huérfanas).
- Pasos de un flujo (reserva, pago, confirmación) que no encadenan.
**Cómo:** Mapear rutas de `App.tsx` ↔ enlaces (`navigate`, `<Link>`), seguir el flujo de
reserva extremo a extremo (Services → Address → Details → Providers → Availability → Checkout
→ Confirmation).
**Señales GarSer:** rutas debug en prod (`/debug-maps`, `/debug-roles`, `/role-monitor`),
ruta `applications`/`licenses` que solo redirigen.

### Dimensión 5 — Manejo y guardado de datos
**Qué buscar:**
- Escrituras a Supabase sin manejo de error / sin feedback al usuario.
- Datos que se calculan pero nunca se persisten (o al revés).
- Condiciones de carrera, doble submit, falta de idempotencia (pagos/reservas).
- Pérdida de datos al navegar atrás en el flujo.
- Inconsistencia entre lo que se muestra y lo que se guarda.
**Cómo:** Revisar `services/`, hooks de booking, `contexts/BookingContext`, las edge functions
`booking-*`. Buscar `.insert(`, `.update(`, `.upsert(` sin `.error` manejado.
**Señales GarSer:** flujo de reserva con mucho estado en contexto; verificar persistencia.

---

## PLANO B — Completitud funcional

### Dimensión 6 — Funciones faltantes (emails, notificaciones)
**Qué buscar:**
- Emails automáticos que deberían existir y no: confirmación de reserva, recordatorio,
  notificación al jardinero de nueva reserva, cambio de estado, cancelación.
- Sistema de notificaciones in-app incompleto.
- Edge functions de email vacías o sin invocar.
**Cómo:** Inspeccionar `supabase/functions/send-email*`, `booking-confirmation-email`,
y buscar `functions.invoke('send-email...` en el front.
**Señales GarSer (CONFIRMADO):** `send-email/` y `booking-confirmation-email/` están VACÍAS.
Solo `ApplicationsAdmin.tsx` invoca `send-email-notification`. No hay email de confirmación
de reserva al cliente ni notificación al jardinero. → Esto es CRÍTICO para un marketplace.

### Dimensión 7 — Features visibles sin terminar o rotas
**Qué buscar:**
- Pantallas con "en construcción", placeholders, secciones vacías.
- Botones que abren modales vacíos o lanzan errores.
- Funciones a medio implementar (TODO/FIXME en flujos de usuario).
**Cómo:** `grep` de "construcción", "coming soon", "próximamente", "TODO", "FIXME";
navegación en vivo de cada pantalla.
**Señales GarSer (CONFIRMADO):** `/admin/settings` = "Configuración en construcción".
44 TODO/FIXME en src. Revisar chat, panel de jardinero, account.

---

## PLANO C — UX y diseño (requiere web en vivo)

### Dimensión 8 — Responsive / mobile-first
**Qué buscar:**
- Layouts que rompen a 375px (móvil): scroll horizontal, texto cortado, overlap.
- Uso de anchos fijos en px en vez de clases responsive de Tailwind.
- Tablas no adaptadas a móvil, modales que se salen de pantalla.
- Touch targets <44px, elementos inalcanzables en móvil.
**Cómo:** Navegación en vivo a 375/768/1440. Buscar en código `w-[NNNpx]`, ausencia de
prefijos `sm: md: lg:`, `overflow-x`.
**Mobile-first:** el marketplace se usa mayoritariamente en móvil → móvil es prioritario.

### Dimensión 9 — Distribución y eficiencia del espacio
**Qué buscar:**
- Secciones que ocupan mucho y aportan poco (headers gigantes, espaciados excesivos).
- Áreas vacías / desperdicio de viewport.
- Densidad de información mal calibrada (todo apretado o todo disperso).
**Cómo:** Navegación en vivo + revisión de paddings/margins (`py-`, `my-`, `gap-`) excesivos.

### Dimensión 10 — UX, alineación de campos, secciones innecesarias
**Qué buscar:**
- Campos de formulario descuadrados, labels desalineadas, inputs de tamaños distintos.
- Flujos con pasos innecesarios o confusos.
- Falta de estados de carga/error/vacío.
- Falta de validación en formularios, mensajes de error poco claros.
- CTAs ambiguos, jerarquía visual pobre.
**Cómo:** Navegación en vivo de cada formulario y flujo; checklist de UX por pantalla.
