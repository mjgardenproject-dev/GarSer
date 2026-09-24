# Guía de actuación — GarSer Empresas

> **Léeme entero antes de tocar nada.** Este fichero existe porque GarSer Empresas es un
> proyecto largo, repartido en muchas sesiones, y el modo en que una sesión de chat se
> desvía es siempre el mismo: empieza a programar antes de saber dónde está.
>
> Si estás leyendo esto al arrancar una sesión, tu primera acción **no** es escribir código.
> Es completar el arranque de §1.

---

## 1. Arranque obligatorio de cada sesión

Cuatro pasos, en este orden. No te saltes ninguno aunque creas que ya sabes el estado.

1. **Lee `01-PLAN-Y-PROGRESO.md`.** Te dice en qué fase estamos y qué está hecho de verdad.
   El estado real es el de ese fichero, no el de tu memoria ni el de tu resumen de contexto.
2. **Lee `02-HALLAZGOS.md`.** Contiene decisiones ya tomadas y trampas ya pisadas. Si vuelves
   a proponer algo que ahí está descartado, has perdido el tiempo del usuario.
3. **Comprueba dónde estás:** `git branch --show-current` y `git status --short`.
   Si hay cambios sin commitear que no son tuyos, **para y pregunta**: puede haber otra
   sesión trabajando en la misma carpeta. Ha pasado.
4. **Toma la línea base:** `npm test`. Apunta el número. Si no coincide con el de
   `01-PLAN-Y-PROGRESO.md`, algo ha cambiado desde la última sesión y hay que entender qué
   antes de seguir.

Solo después de esos cuatro pasos empieza el trabajo de la fase.

---

## 2. Las siete reglas

### Regla 1 — Primero verificar, después afirmar

Nunca escribas "el sistema hace X" sin haberlo leído en el código de **esta** carpeta.
Este proyecto ya ha sufrido dos veces el problema contrario:

- `ARCHITECTURE.md` (raíz) describe problemas resueltos hace meses. **No es un mapa válido.**
- `docs/audit/HALLAZGOS-CONOCIDOS.md` avisa de que las auditorías de septiembre se hicieron
  sobre otra línea de código.

Cuando cites algo, cita `fichero:línea`. Si no puedes citar la línea, no lo has verificado.

### Regla 2 — El autónomo no se rompe

Es el criterio de aceptación por encima de cualquier otro. Todo cambio de esquema lleva un
`DEFAULT` que reproduce el comportamiento actual. Toda RPC modificada sigue haciendo lo
mismo cuando el proveedor es una persona.

**Señal de alarma:** si una fase baja el número de tests en verde, has roto algo. No sigas.

### Regla 3 — El alcance es la fase, y solo la fase

Este repositorio arrastra **130 errores de `tsc`** anteriores a este proyecto, y código que
se puede mejorar en muchos sitios. **No es tu trabajo.**

- ¿Has encontrado algo mal fuera de tu fase? → a `02-HALLAZGOS.md`, y sigues.
- ¿Te estorba de verdad para terminar la fase? → arréglalo, y lo dices en el resumen.
- ¿Te apetece arreglarlo porque está feo? → no.

`npm run typecheck` **no sirve** como señal de regresión en este repositorio: siempre está
en rojo. La señal es `npm test`.

### Regla 4 — Cada fase termina cerrada, no "casi"

Una fase está terminada cuando:

- [ ] `npm test` en verde, con **el mismo número o más** que la línea base.
- [ ] `npm run build` pasa.
- [ ] `npm run typecheck` no ha subido de 130 errores (informativo, no bloqueante).
- [ ] Las pruebas de la fase están escritas en `03-PRUEBAS.md` y ejecutadas.
- [ ] `01-PLAN-Y-PROGRESO.md` actualizado con lo que se hizo de verdad.
- [ ] Los hallazgos nuevos, en `02-HALLAZGOS.md`.
- [ ] Commit hecho.

No se empieza una fase con la anterior a medias. Si hay que parar a mitad, se deja escrito
en `01-PLAN-Y-PROGRESO.md` qué falta exactamente.

### Regla 5 — La documentación se commitea al escribirla

Regla que viene de haber perdido trabajo dos veces: el working tree de esta máquina se ha
revertido solo. **Escribes en `docs/garser-empresas/**` → lo commiteas en ese mismo turno.**

Si hay cambios de otra sesión en el working tree, commitea **solo tus ficheros**
(`git add docs/garser-empresas/...`), nunca `git add -A`.

### Regla 6 — Toda respuesta acaba con acciones manuales

Cada entrega termina con una sección **"Acciones manuales del usuario"**: migraciones que
aplicar, funciones que desplegar, ajustes de panel. Si no hay nada, se escribe literalmente
`(nada que desplegar)`. Nunca se omite la sección.

**En este proyecto el usuario no hace ninguna acción manual fase a fase** (decisión del
2026-09-24): todo se acumula en `01-PLAN-Y-PROGRESO.md` §5 («Notas para el usuario»), que se
ejecuta una sola vez el día de la fusión. Cada fase **añade sus puntos a esa lista** y en la
respuesta se dice «apuntado en §5 para el día de la fusión», no «haz esto ahora».

Datos operativos que necesitas para esa sección:

- `supabase functions deploy` **se cuelga** en esta máquina (Docker). Usa `--use-api`.
- `booking-authority` **importa `src/shared/bookingQuoteCore.ts`**. Si tocas el motor de
  precios o de presupuesto, hay que **redesplegar la función**, o producción se queda con la
  versión vieja.

### Regla 7 — No inventes arquitectura nueva a mitad

El diseño está cerrado en `01-PLAN-Y-PROGRESO.md` y en el informe de arquitectura. Si durante
la implementación descubres que una decisión de diseño **no funciona**, la secuencia es:

1. Paras.
2. Lo escribes en `02-HALLAZGOS.md` con la evidencia.
3. Se lo planteas al usuario con la alternativa concreta.
4. Esperas respuesta.

Lo que **no** se hace es cambiar el diseño sobre la marcha y contarlo después.

---

## 3. Prohibiciones explícitas

Cosas que ya han causado daño en este proyecto, o que lo causarían:

| No hagas | Por qué |
|---|---|
| Crear un segundo motor de precios para empresas | El motor ya es agnóstico al proveedor. Duplicarlo condena las dos copias a divergir. |
| Crear un segundo sistema de disponibilidad | Uno solo, declarado por persona. La empresa **agrega**, no declara. |
| Crear un segundo flujo de reservas | Las reservas de empresa entran por las mismas RPC. |
| Renombrar `bookings.gardener_id` | Toca 113 migraciones, todas las RLS y todo el frontend, a cambio de cero funcionalidad. Cambia el **significado**, documentado en un `COMMENT ON COLUMN`. |
| Crear una tabla `providers` | Misma razón. `gardener_profiles` ya es la tabla de proveedores. |
| Crear una tabla `work_sessions` | Una jornada es un `GROUP BY assignee_id, date` sobre `booking_blocks`. Almacenarla crea un segundo sitio donde desincronizarse. |
| Tocar el bloque de otro servicio en `bookingQuoteCore.ts` | Regla heredada de las auditorías por servicio. Sigue vigente. |
| Escribir en `booking_blocks` desde el frontend | Las escrituras de reserva están revocadas a propósito (migración `20260713000001`). Todo por RPC `SECURITY DEFINER`. |
| Consultar otra tabla dentro de una policy RLS sin `SECURITY DEFINER` | Provoca recursión infinita de policies. Ya pasó en este proyecto. |
| Aceptar `company_id` como parámetro del cliente | Es el vector de suplantación principal. Se deriva siempre de `auth.uid()` o del token. |
| Dar por bueno el esquema sin verificarlo | El esquema se lee de `supabase/migrations/` y se contrasta contra el Supabase **local** vía MCP. Ojo: el MCP apunta al local, **nunca** tomes sus datos como datos de producción. |

---

## 4. Cómo se responde al usuario

Tono y forma, basados en cómo trabaja este proyecto:

- **En español**, directo, sin adornos ni resúmenes de lo que acabas de hacer paso a paso.
- **Primero el resultado, después el detalle.** Qué funciona ahora que antes no.
- **Si algo ha fallado, se dice.** Con la salida del error. No se maquilla ni se omite.
- **Si el usuario propone algo que rompe una regla de §2 o §3**, se lo dices en una o dos
  frases, con la razón técnica, y propones la alternativa. Si insiste, es su decisión: se
  hace y se anota en `02-HALLAZGOS.md` que fue decisión suya.
- **No preguntes lo que puedes verificar.** Si la respuesta está en el código, léela.
- **Sí pregunta las decisiones de producto.** Están marcadas en `01-PLAN-Y-PROGRESO.md` como
  `DECISIÓN PENDIENTE`. No las inventes.

---

## 5. Qué hacer cuando no estás seguro

Por orden:

1. **¿Está en el código?** Léelo. No preguntes.
2. **¿Está decidido en `02-HALLAZGOS.md`?** Aplícalo.
3. **¿Es una decisión de producto?** Pregunta al usuario. Mientras esperas, adelanta todo lo
   que no dependa de esa respuesta.
4. **¿Es una decisión técnica reversible?** Tómala, documéntala en `02-HALLAZGOS.md` y sigue.
5. **¿Es una decisión técnica difícil de revertir** (esquema, RLS, borrado de datos)?
   Pregunta antes.

---

## 6. Estado del entorno

Cosas ciertas sobre esta máquina y este repositorio, a 2026-09-23:

- **Rama:** `feat/garser-empresas`, creada desde `origin/main` (`6eef75c`, tras el merge #34).
  No se trabaja en `main`.
- **Todo en local hasta el final** (decisión del usuario): **ni `git push` ni despliegues a
  producción** hasta que el proyecto esté terminado y probado. Ver `01-PLAN-Y-PROGRESO.md` §0.
- **Este es el único chat del proyecto.** El usuario lo decidió el 2026-09-23. Aun así, si al
  arrancar ves cambios sin commitear que no son tuyos, para y pregunta.
- **Supabase local: se levanta desde ESTA carpeta** (proyecto `GarSer-main_4`, contenedores
  `supabase_*_GarSer-main_4`). Montado el 2026-09-23: se paró el stack de
  `~/Downloads/auditorias/transversal` (sus datos siguen en su volumen, `supabase start` desde
  esa carpeta lo recupera) y se reconstruyó la BD con `supabase db reset` porque la anterior
  (de agosto) tenía una migración ajena, `20260905120000`, que no existe en este código.
  Verificado tras el reset: 113/113 migraciones, 3 cuentas de la semilla, Edge Functions
  montadas desde `GarSer-main 4/supabase/functions`.
- **Cuentas de prueba** (de `supabase/seed.sql`): `admin.local@test.local`,
  `cliente.local@test.local`, `jardinero.local@test.local`.
- **Consultas a la BD local:** `docker exec supabase_db_GarSer-main_4 psql -U postgres -d
  postgres -tAc "<sql>"` (no hay `psql` instalado en la máquina). Tras añadir una migración:
  `supabase migration up`; para empezar de cero: `supabase db reset`.
- **MCP de Supabase: conecta al Supabase LOCAL** (`http://127.0.0.1:54321`), no a producción.
  **No sirve para consultar datos de producción.**
- **Línea base de tests: 462 en verde / 68 ficheros** (revalidada 2026-09-23).
- **`tsc`: 130 errores preexistentes** (eran 172 antes del #34). No es señal de regresión.
  `AuthForm.tsx`, que toca la F0, está en 0.
- **Docker está colgado** → `supabase functions deploy --use-api`.
- **Tu `main` local está desviado de `origin/main`:** conserva dos commits de documentación
  que no entraron en el #34 (`ed9fd6b`, auditoría `2026-09-19-publico-movil`, y `1486dde`,
  el original de estos documentos). No hagas `reset` de `main` sin preguntar.
