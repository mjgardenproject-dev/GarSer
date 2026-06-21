# Playbook — Auditoría web en vivo

Cómo ejecutar el Plano C (UX/diseño) y validar el Plano B (features rotas) sobre la app real.

## Arranque del entorno
```bash
npm run dev    # arranca Vite en localhost:5173 (run_in_background: true)
```
Espera a que el servidor esté listo antes de navegar. La app usa React Router (SPA).

## Herramienta de navegación
Usa, por orden de preferencia:
1. **Claude in Chrome** (`mcp__Claude_in_Chrome__*`) — DOM-aware, rápido. Si no está conectado,
   pide al usuario que instale/conecte la extensión.
2. **Claude Preview** (`mcp__Claude_Preview__*`) — `preview_start` con la URL, luego
   `preview_resize` + `preview_screenshot` + `preview_snapshot`.

Carga las herramientas con ToolSearch (`query: "Claude in Chrome"` o `"preview"`) antes de usarlas.

## Viewports obligatorios
Para cada pantalla, capturar en los 3:
- **375 × 812** (móvil — PRIORITARIO, la app es mobile-first)
- **768 × 1024** (tablet)
- **1440 × 900** (escritorio)

## Rutas a auditar (de src/App.tsx)
Públicas: `/`, `/marbella`, `/para-jardineros`, `/apply`
Reserva (flujo completo, en orden): `/reserva` → address → details → providers →
availability → `/reserva/checkout` → `/reserva/confirmacion`
Usuario: `/dashboard`, `/bookings`, `/chat`, `/status`
Admin: `/admin/dashboard`, `/admin/services`, `/admin/phytosanitary`, `/admin/users`,
`/admin/settings` (placeholder conocido)
NO auditar como features (marcar para eliminar): `/debug-maps`, `/debug-roles`, `/role-monitor`

## Checklist por pantalla
Para cada ruta y viewport, comprobar y anotar con screenshot:

**Responsive (Dim 8)**
- [ ] ¿Hay scroll horizontal? (síntoma de overflow)
- [ ] ¿Texto o botones cortados / solapados?
- [ ] ¿Modales/menús se salen de pantalla en móvil?
- [ ] ¿Touch targets ≥44px en móvil?

**Espacio (Dim 9)**
- [ ] ¿Headers/secciones desproporcionadamente grandes?
- [ ] ¿Zonas vacías que desperdician viewport?
- [ ] ¿Densidad de info adecuada (ni apretado ni disperso)?

**UX y campos (Dim 10)**
- [ ] ¿Campos de formulario alineados y del mismo tamaño?
- [ ] ¿Labels claras y bien posicionadas?
- [ ] ¿Estados de carga / error / vacío presentes?
- [ ] ¿Validación de formularios y mensajes claros?
- [ ] ¿Jerarquía visual y CTA principal evidente?

**Features (Dim 7) — validación en vivo**
- [ ] ¿La pantalla está terminada o hay placeholders/secciones vacías?
- [ ] ¿Todos los botones hacen algo? (probar clics clave)
- [ ] ¿Errores en consola? (`read_console_messages` / `preview_console_logs`)

## Flujos a probar extremo a extremo
1. **Reserva completa** como cliente: elegir servicio → dirección → subir fotos y analizar →
   elegir jardinero → disponibilidad → checkout (Stripe test) → confirmación.
   Anotar cualquier paso que rompa, pierda datos o confunda.
2. **Alta de jardinero**: `/apply` y panel de jardinero.
3. **Admin**: navegar las 4 secciones reales.

## Salida
Consolida en `docs/audit/<fecha>/02-live-findings.md` con:
- Una sección por ruta, con los 3 screenshots referenciados y los hallazgos.
- Hallazgos en el formato de `findings-template.md` (severidad + fix).
- Una tabla resumen de "pantallas que rompen en móvil".
```
