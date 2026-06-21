# Formato de hallazgos, informe maestro y flujo de PRs

## Formato de un hallazgo individual

```
### [SEVERIDAD] Título corto y específico
- **Dimensión:** <1-10 nombre>
- **Archivo:** ruta/al/archivo.tsx:línea  (o "vivo: /ruta @ 375px")
- **Problema:** Qué está mal y por qué importa en la práctica (1-2 frases).
- **Impacto:** Quién lo sufre y cuándo (cliente al reservar / jardinero / admin).
- **Fix:** Acción concreta. Si es código, esbozar el cambio.
- **Esfuerzo:** S / M / L
```

Severidad: CRÍTICO · ALTO · MEDIO · BAJO (ver rúbrica en `dimensions.md`).

## Estructura del informe maestro (`docs/audit/<fecha>/REPORT.md`)

```
# GarSer — Informe de Auditoría de Producción (<fecha>)

## Resumen ejecutivo
- Nº de hallazgos por severidad (tabla).
- Top 5 bloqueantes de producción.
- Veredicto: ¿listo para producción? ¿qué falta como mínimo?

## Hallazgos CRÍTICOS
<hallazgos en el formato de arriba>

## Hallazgos ALTOS
## Hallazgos MEDIOS
## Hallazgos BAJOS

## Checklist de production-readiness
- [ ] Emails transaccionales (confirmación reserva, aviso jardinero) implementados y probados
- [ ] RLS verificada en todas las tablas con datos de usuario
- [ ] Webhook de Stripe verifica firma e idempotencia
- [ ] Rutas/codigo de debug eliminados del bundle de producción
- [ ] Sin console.log en producción
- [ ] Flujo de reserva completo sin pérdida de datos
- [ ] Todas las pantallas usables a 375px sin scroll horizontal
- [ ] Estados de carga/error/vacío en todas las vistas con datos remotos
- [ ] Features visibles terminadas (sin "en construcción")
- [ ] Manejo de error en todas las escrituras a Supabase
- [ ] Lint y tests en verde

## Plan de PRs
<tabla: PR → dimensión → hallazgos que cubre → estado>
```

## Flujo de PRs (Paso 5 del runbook)

1. Un PR por dimensión (o por grupo cohesivo de hallazgos). Nunca mezclar limpieza de
   basura con cambios de lógica.
2. Orden recomendado: CRÍTICO primero. Dentro de crítico, primero lo de bajo riesgo de
   regresión (p.ej. eliminar rutas debug) y luego lo de más riesgo (lógica de datos/pagos).
3. Por cada PR:
   - Rama: `fix/audit-<dimension>` (p.ej. `fix/audit-emails`, `fix/audit-junk-cleanup`).
   - Aplicar fixes + tests.
   - Verificar: `npm run lint` && `npx vitest run` (+ re-navegar UI si aplica).
   - Commit con co-autoría de Claude.
   - PR con cuerpo que enlaza los hallazgos del REPORT que resuelve.
4. Marcar en la tabla "Plan de PRs" del REPORT el estado de cada uno.

## Sugerencia: chips de tarea para hallazgos fuera de alcance
Si durante la auditoría aparece algo grande y fuera del foco actual, usar `spawn_task`
para dejarlo como tarea en segundo plano en vez de inflar el PR en curso.
```
