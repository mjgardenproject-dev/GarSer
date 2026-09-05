# Cómo rearrancar las auditorías sin que se vuelva a liar

Este documento existe porque el primer intento se torció, y no por mala suerte: por cinco
decisiones concretas que se pueden evitar. Cada regla de aquí abajo corresponde a una cosa
que salió mal.

---

## Lo que falló, y la regla que lo evita

| Qué pasó | Regla |
|---|---|
| Los seis worktrees salieron de un commit local que no estaba en GitHub | **Toda rama sale de `origin/main` recién traído.** Nunca de otra rama local |
| El Supabase local servía el código de *otro* checkout, así que cada chat medía lo que no era | **Un solo stack, levantado desde un checkout de referencia intocable.** Los chats miden con `READINESS_ENGINE=local` |
| Cada chat arreglaba en su rama fallos que afectaban a los siete servicios | **Lo transversal se documenta, no se arregla en la rama de un servicio** |
| Un chat desplegó a producción por su cuenta y revirtió un fix ajeno | **Nadie despliega. Solo tú, y solo desde `main`** |
| El fichero de coordinación vivía suelto en un worktree y varios chats lo pisaban | **La coordinación vive en `origin/main`**, y se actualiza con PR pequeñas |

---

## El montaje

### 1. Un checkout de referencia, que nadie toca

```bash
cd ~/Downloads
git clone git@github.com:mjgardenproject-dev/GarSer.git GarSer-referencia
cd GarSer-referencia
git checkout main
cp "../GarSer-main 4/.env.local" .env.local
cp -r "../GarSer-main 4/supabase/functions/.env" supabase/functions/.env
supabase start
```

**Este es el único sitio donde se levanta Supabase.** Sirve `main` limpio, así que cuando
un chat mide por HTTP sabe exactamente qué está midiendo. Nadie edita código aquí. Nunca.

### 2. Un worktree por servicio, todos desde `main`

```bash
cd ~/Downloads/GarSer-referencia
git fetch origin
for s in cesped setos arboles palmeras arbustos desbroce fitosanitarios; do
  git worktree add "../auditorias/$s" -b "auditoria/$s" origin/main
  cp .env.local "../auditorias/$s/.env.local"
done
```

Cada chat trabaja en el suyo. Todos parten del mismo sitio y ese sitio es producción.

### 3. Cada chat mide con el motor en proceso

Durante las fases 1, 2 y 3, el chat usa:

```bash
READINESS_ENGINE=local node scripts/readiness/<servicio>.mjs
```

Eso mide **el código de su worktree**, sin depender del stack ni pelearse por él. Es lo
que evita el fallo silencioso de la vez anterior.

El cierre por HTTP se hace **una sola vez, en el turno de integración**, cuando la rama ya
está mezclada en `main` y el checkout de referencia la sirve de verdad.

---

## El ritmo de trabajo

**Auditar en paralelo, corregir en serie.**

Las fases 1 y 2 (leer el código y medirlo) no tocan nada: los siete chats pueden ir a la
vez sin riesgo. La fase 3 (corregir) sí toca el motor de precios compartido, y ahí es donde
seis manos a la vez producen conflictos.

Recomendación: los siete auditan en paralelo y **te entregan su informe**. Tú decides el
orden de corrección y vas soltando de uno en uno —o de dos en dos si no comparten
ficheros—. Un chat que espera turno no pierde el trabajo: su informe ya está hecho.

Si prefieres no esperar, el mínimo aceptable es que **solo un chat toque
`src/shared/bookingQuoteCore.ts` a la vez.** Es el fichero que causó los tres conflictos.

---

## Cómo se cierra un servicio

1. El chat termina su fase 3 con su runner en verde (`READINESS_ENGINE=local`).
2. Abre una PR de su rama contra `main`. Una PR por servicio.
3. Tú la mezclas.
4. En el checkout de referencia: `git pull` y `supabase functions deploy booking-authority
   --use-api` si la PR tocó el motor.
5. El chat reejecuta su runner **por HTTP** (sin `READINESS_ENGINE`) contra el stack de
   referencia, que ahora sí sirve su código. Ese es el GO de verdad.
6. **Se ejecutan todos los runners**, no solo el del servicio recién integrado. Es lo único
   que detecta que arreglar un servicio ha roto otro.
7. Siguiente servicio.

---

## Lo que hay que hacer una sola vez, antes de empezar

**Subir la coordinación a `main`.** Una PR pequeña que añada:

- `docs/audit/COORDINACION-SERVICIOS.md` — el registro de ficheros compartidos y hallazgos
  transversales, empezando vacío salvo la lista de §3.2 (reembolsos, cancelación).
- `scripts/readiness/` — los siete runners del archivo, más el harness.

Así todos los worktrees lo tienen desde el minuto uno y nadie edita un fichero suelto que
otro va a pisar.

**Revalidar los runners.** Vienen de la base vieja: sus cifras esperadas se calcularon con
las tarifas del `seed.sql` de entonces. Antes de fiarse de un `PASA`, cada chat comprueba
que su tabla de predicciones cuadra con la configuración que el jardinero sembrado tiene
*ahora*. Un runner en verde contra las tarifas equivocadas no demuestra nada.

---

## Lo que no se toca hasta que lo decidas

- **Reembolsos.** No existen. Hace falta política antes que código: quién asume la tarifa
  según quién cancele y cuándo, si hay penalización, qué pasa con el importe pendiente al
  profesional.
- **Cancelación por parte del cliente.** No hay botón, y depende de lo anterior.

Mientras no haya decisión, ningún chat los arregla. Se anotan y se sigue.
