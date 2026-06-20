# Playbook — Auditoría estática con subagentes

Cómo ejecutar el Plano A y B con subagentes `general-purpose` en paralelo.

## Principios
- Un subagente por dimensión. Lánzalos en paralelo (mismo turno, varias tool calls).
- Cada subagente SOLO lee e informa. No edita nada.
- Cada subagente devuelve hallazgos en el formato de `findings-template.md`.
- El orquestador consolida, deduplica y prioriza.

## Patrones grep útiles (ejecutar antes de lanzar subagentes para dar pistas)

```bash
# Dim 2 — basura
grep -rn "console.log\|debugger" src/ --include="*.ts" --include="*.tsx"
ls *.js *.sql *.md *.html 2>/dev/null   # archivos sueltos en raíz
find . -name "*.bak" -o -name "temp*" -o -name "patch_*" 2>/dev/null | grep -v node_modules
# imports huérfanos: por cada componente, grep de su nombre en el resto de src

# Dim 5 — datos
grep -rn "\.insert(\|\.update(\|\.upsert(\|\.delete(" src/ | grep -v test
grep -rn "functions.invoke" src/

# Dim 6 — emails/notificaciones
ls -la supabase/functions/send-email*/ supabase/functions/booking-confirmation-email/
grep -rn "send-email\|notification\|notificar\|email" src/ --include="*.tsx" | grep -i invoke

# Dim 7 — features sin terminar
grep -rni "construcción\|coming soon\|próximamente\|en construccion\|wip\|not implemented" src/
grep -rn "TODO\|FIXME\|HACK\|XXX" src/ --include="*.ts" --include="*.tsx"

# Dim 3 — seguridad (complementar con /security-review)
grep -rn "dangerouslySetInnerHTML" src/
grep -rni "api_key\|apikey\|secret\|password\|token" src/ --include="*.ts" --include="*.tsx" | grep -v "type\|interface\|import"
ls supabase/migrations/ | grep -i rls
```

## Prompt-plantilla para cada subagente

```
Eres un auditor de código senior revisando el proyecto GarSer (marketplace de jardinería,
React + Vite + TS + Supabase) para preparación de producción.

TU DIMENSIÓN: <nombre de la dimensión y su definición copiada de dimensions.md>

ALCANCE DE ARCHIVOS: <rutas concretas a revisar para esta dimensión>

INSTRUCCIONES:
1. Lee en profundidad los archivos del alcance. No te quedes en la superficie.
2. Para cada problema encontrado, produce un hallazgo con EXACTAMENTE este formato:
   - **[SEVERIDAD]** título corto
   - Archivo: ruta/archivo.tsx:línea
   - Problema: una frase explicando qué está mal y por qué importa en la vida real.
   - Fix: acción concreta para arreglarlo.
3. Usa la rúbrica de severidad CRÍTICO/ALTO/MEDIO/BAJO.
4. NO edites ningún archivo. Solo informa.
5. Ordena tus hallazgos por severidad (crítico primero).
6. Si no encuentras nada en una sub-área, dilo explícitamente (no inventes hallazgos).

Devuelve solo la lista de hallazgos en markdown.
```

## Asignación de alcance por dimensión

| Dim | Subagente revisa |
|---|---|
| 1 Negocio | `src/domain/**`, `supabase/functions/ai-pricing-estimator/**`, `src/pages/reserva/ProvidersPage.tsx`, adapters |
| 2 Basura | raíz del repo, `src/components/debug/**`, grep de imports huérfanos y console.log |
| 3 Seguridad | `supabase/migrations/**rls**`, `supabase/functions/**`, `.env*`, `src/lib/supabase*`, webhook de Stripe + `/security-review` |
| 4 Flujos | `src/App.tsx`, `src/pages/reserva/BookingFlow.tsx` y todo el flujo, `navigate`/`<Link>` |
| 5 Datos | `src/services/**`, `src/hooks/booking/**`, `src/contexts/BookingContext*`, `supabase/functions/booking-*` |
| 6 Emails | `supabase/functions/send-email*`, `booking-confirmation-email`, invocaciones en front |
| 7 Features | grep de placeholders + cada página de `src/pages/**` |

## Consolidación
Tras recibir los subagentes:
1. Reúne todos los hallazgos en `docs/audit/<fecha>/01-static-findings.md`.
2. Deduplica (el mismo archivo puede salir en varias dimensiones).
3. Reordena globalmente por severidad.
4. Marca cada hallazgo con su dimensión de origen para el PR posterior.
