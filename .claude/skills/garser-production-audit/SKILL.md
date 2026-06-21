---
name: garser-production-audit
description: >
  Auditoría integral de preparación para producción del marketplace GarSer. Usa esta skill
  siempre que el usuario quiera revisar el proyecto a fondo en busca de fallos antes de
  producción: bugs de lógica de negocio o incoherencias con la vida real, código basura/muerto,
  fallos de seguridad, flujos desconectados, problemas de manejo y guardado de datos, funciones
  que faltan (emails automáticos, notificaciones), features visibles pero sin terminar o rotas,
  y fallos estéticos (diseño no responsive, no mobile-first, mala distribución del espacio,
  campos descuadrados, mala UX). También activa con frases como "auditar la app", "revisar todo
  el proyecto", "dejar listo para producción", "app impoluta", "qué falla en GarSer",
  "revisión completa", "production readiness".
  Orquesta una auditoría en dos planos —código estático y web en vivo (npm run dev)— mediante
  subagentes especializados por dimensión, y produce un inventario priorizado por severidad
  con file:line y fix propuesto, seguido de PRs atómicos por dimensión.
---

# GarSer — Auditoría de Producción

Eres el orquestador de una auditoría integral de preparación para producción de GarSer
(marketplace de jardinería: React + Vite + TypeScript + Supabase + Gemini + Stripe).

Tu trabajo NO es revisar todo tú mismo de un tirón. Es **coordinar una auditoría por
dimensiones** usando subagentes, consolidar los hallazgos en un inventario priorizado, y
dirigir las correcciones en PRs atómicos.

---

## Mapa del proyecto (contexto base)

```
src/
  pages/        reserva/ (flujo de reserva), admin/, public/, account/
  components/   account auth booking chat client common debug gardener layout public reserva seo shared
  contexts/     BookingContext y otros (estado global)
  domain/       pricingEngine.ts, speciesBusinessRules.ts (lógica de negocio pura)
  hooks/        hooks de booking, availability, etc.
  services/     llamadas a Supabase / APIs
  shared/       analysisV2, contratos compartidos front/back
  utils/        helpers
supabase/
  functions/    edge functions Deno (ai-pricing-estimator, booking-*, send-email*)
  migrations/   78 migraciones SQL
```

Stack: Vite (dev en `localhost:5173`), Vitest, ESLint 9, Tailwind 3, React Router.
Scripts: `npm run dev`, `npm run build`, `npm run lint`. Tests: `npx vitest run`.

---

## Las dimensiones de la auditoría

Esta skill cubre 10 dimensiones agrupadas en 3 planos. La especificación de qué buscar,
cómo detectarlo y cómo clasificarlo está en `references/dimensions.md`. **Léelo antes de
lanzar cualquier subagente.**

**Plano A — Código y arquitectura (estático)**
1. Lógica de negocio e incoherencias con la vida real
2. Código basura / muerto / archivos sueltos
3. Seguridad (RLS, secretos, auth, validación en edge functions)
4. Flujos desconectados (componentes huérfanos, handlers sin cablear)
5. Manejo y guardado de datos (escrituras Supabase, integridad, errores)

**Plano B — Completitud funcional (estático + vivo)**
6. Funciones faltantes (emails automáticos, notificaciones)
7. Features visibles sin terminar o rotas

**Plano C — UX y diseño (vivo)**
8. Responsive / mobile-first
9. Distribución y eficiencia del espacio
10. UX, alineación de campos, secciones innecesarias

---

## Runbook — ejecuta en este orden

### Paso 0 — Preparación
1. Lee `references/dimensions.md`, `references/static-audit-playbook.md` y
   `references/live-web-audit-playbook.md`.
2. Crea la carpeta de salida del informe: `docs/audit/` con un timestamp,
   p.ej. `docs/audit/2026-06-21/`.
3. Confirma con el usuario el alcance elegido (todas las dimensiones / crítico primero /
   una sola) y el destino de la web en vivo (local vs desplegada).

### Paso 1 — Mapa de la aplicación (subagentes Explore)
Lanza 1-3 subagentes `Explore` EN PARALELO para producir el inventario base:
- Rutas y páginas (de `src/App.tsx`) → tabla ruta → componente → estado (activa/debug/placeholder).
- Edge functions → cuáles están implementadas vs vacías, quién las invoca desde el front.
- Tablas/migraciones y dónde se escriben/leen desde el front.
Guarda el mapa en `docs/audit/<fecha>/00-app-map.md`.

### Paso 2 — Auditoría estática (subagentes por dimensión)
Sigue `references/static-audit-playbook.md`. Lanza subagentes `general-purpose`
(uno por dimensión del plano A y B), cada uno con el prompt-plantilla del playbook.
Cada subagente devuelve hallazgos en el formato de `references/findings-template.md`.
Para la dimensión de **seguridad**, usa además el skill integrado `/security-review`.
Consolida en `docs/audit/<fecha>/01-static-findings.md`.

### Paso 3 — Auditoría web en vivo
Sigue `references/live-web-audit-playbook.md`. Arranca `npm run dev`, navega cada ruta
a 375px / 768px / 1440px, captura screenshots, prueba los flujos clave y detecta features
rotas/sin terminar y fallos estéticos. Consolida en
`docs/audit/<fecha>/02-live-findings.md`.

### Paso 4 — Inventario maestro priorizado
Fusiona estático + vivo en un único `docs/audit/<fecha>/REPORT.md` ordenado por severidad
(Crítico → Alto → Medio → Bajo), con file:line y fix propuesto. Usa el formato de
`references/findings-template.md`. Añade al final un **checklist de production-readiness**.

### Paso 5 — Correcciones en PRs atómicos
Por cada dimensión (o grupo de hallazgos cohesivo), crea una rama, aplica los fixes,
añade/actualiza tests, y abre un PR. Empieza por Crítico. Un PR por dimensión para que
sean revisables. No mezcles cleanup de basura con fixes de lógica en el mismo PR.

---

## Reglas de oro del orquestador

- **No borres nada sin inspeccionarlo.** Para "código basura", primero verifica que no se
  importe/use en ningún sitio (grep), y propón la eliminación antes de ejecutarla.
- **Severidad honesta.** No infles ni minimices. Usa la rúbrica de `references/dimensions.md`.
- **Cada hallazgo accionable.** file:line + por qué es un problema + fix concreto. Nada de
  "esto podría mejorarse" sin especificar qué y cómo.
- **Los subagentes solo leen e informan.** Las correcciones las decides y aplicas en el
  hilo principal, en PRs, tras consolidar el inventario.
- **Verifica antes de cerrar.** Tras cada PR: `npm run lint`, `npx vitest run` y, si toca UI,
  re-navega la pantalla afectada en los 3 viewports.

---

## Referencias

- `references/dimensions.md` — Las 10 dimensiones: qué buscar, cómo, rúbrica de severidad.
- `references/static-audit-playbook.md` — Prompts de subagente + patrones grep por dimensión.
- `references/live-web-audit-playbook.md` — Protocolo de navegación, viewports, checklist por ruta.
- `references/findings-template.md` — Formato de hallazgo, informe maestro y flujo de PRs.
