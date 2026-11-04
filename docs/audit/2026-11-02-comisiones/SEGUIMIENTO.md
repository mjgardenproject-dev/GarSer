# Seguimiento — cierre de comisiones configurables (2026-11-04)

Encargo del dueño (2026-11-04): *«Esta implementación es un tema muy delicado y quiero que quede completamente cerrada sin ningún fallo»*. Cinco tareas, en orden. Informe completo: `REPORT.md` §12.

| # | Tarea | Estado | Evidencia |
|---|---|---|---|
| 1 | Explicar el fallo del origen «enlace» y solucionarlo como decida el dueño | ✅ Hecho | Decisión: **clave secreta**; sin transición. Migración `20261104130000`; commit `b6a4ef7`; SQL 29 comprobaciones nuevas (M1–M29); verificado con Stripe real (S13, S13d, S14) y en el navegador |
| 2 | Texto que cambia con los ajustes de facturación | ✅ Hecho | Migración `20261104140000`; `billingCopy.ts` (1.024 combinaciones); vista previa en el panel; commit `259ee22`; navegador real: el texto cambia al cambiar la base |
| 3 | Revisar toda la web: afirmaciones falsas o que no se cumplen | ✅ Hecho | 10 correcciones (tabla en `REPORT.md` §12.3); guardia `publicClaims.test.ts`; commit `52a1ff1`. Decisiones del dueño: lo impreso no habla de gastos; cobertura → texto siempre cierto; plazo de alta de 24 h se mantiene |
| 4 | Actualizar la skill `garser-pricing-rules` | ✅ Hecho | Secciones 4, 9, 10.8, 11 y cabecera reescritas; copias en esta carpeta (`…actual…` y `…antes…`) |
| 5 | Probar a fondo en local con Stripe de prueba, todos los casos y límites | ✅ Hecho | `verify-commissions-stripe.mjs` 40/40, `verify-commissions.mjs` 37/37, SQL en Postgres real, commit `360a858` |

## Decisiones del dueño en esta ronda
- Solución del origen «enlace»: **clave secreta por profesional**. Enlaces antiguos sin clave: dejan de eximir de inmediato («aún no hay jardineros reales»).
- Reiniciar Docker: autorizado (hecho). Commitear en la rama: autorizado (sin push ni PR).
- Materiales impresos o descargables: **sin sello ni información de gastos de gestión, siempre**.
- Plazo «Revisamos tu alta en menos de 24 h»: **se mantiene**.
- Frases de cobertura (municipios, «servicios disponibles para Marbella»): **hacerlas ciertas siempre**.

## Hallazgos que NO eran de comisiones (corregidos por estar en la misma zona)
Ver `REPORT.md` §12.3. Los más serios: el texto «No se te ha cobrado nada» tras cancelar con menos de 24 h, y el «solo se cobran cuando acepte» que omitía el cobro al cancelar tarde.

## Pendiente (solo tú)
Ver `REPORT.md` §8 «Lo que tienes que hacer tú» y la sección 29 de `docs/audit/2026-07-12/PRUEBAS-PRODUCCION.md` (29.15–29.26 son nuevos).

## Notas de entorno
- Local: Supabase en marcha; migraciones aplicadas con `supabase migration up --local`; funciones servidas con un env propio (`STRIPE_WEBHOOK_SECRET` inventado, solo local).
- Un `supabase functions list` sin `--local` consultó el proyecto **de producción** (solo lectura, sin cambios). Recordatorio: `list`/`secrets`/`db push` sin `--local` apuntan a producción.
