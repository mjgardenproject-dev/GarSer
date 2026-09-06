# Archivo de las auditorías de septiembre de 2026

Aquí está lo único que merecía sobrevivir al borrado de las seis ramas de auditoría: **los
siete runners** y **los hallazgos documentados**. El código corregido no se guardó a
propósito, porque estaba construido sobre una base equivocada y hay que rehacerlo.

## Qué pasó, en tres frases

Las seis auditorías salieron de `98b54ae`, un commit local que nunca se subió a GitHub y
que es una línea paralela a `origin/main`, donde se hizo el mismo trabajo con las PR
#8–#16. Producción va con `origin/main`. Resultado: se auditó, se midió y se corrigió
código que no era el de producción, y algunos arreglos duplicaban cosas que main ya tenía
resueltas —a veces mejor, como la captura diferida del pago—.

## Qué hay aquí

- `scripts/readiness/` — los siete runners, uno por servicio, más el harness común. **Esto
  es lo valioso**: miden por HTTP contra `booking-authority`, así que no dependen de la
  base del código y se pueden reutilizar tal cual. Las cifras que esperan sí dependen de
  las tarifas del `seed.sql`, así que al reusarlos hay que revalidar la tabla de
  predicciones contra la configuración que tenga el jardinero sembrado.
- `COORDINACION-SERVICIOS.md` — el registro de qué tocó cada rama y los hallazgos
  transversales. La §0 explica el problema de la base; la §3 lista lo encontrado.
- `PLAN-INTEGRACION.md` — el plan que se abandonó al decidir empezar de cero.
- Los informes de fitosanitarios, el único servicio que llegó a cerrarse con GO.

## Hallazgos que se confirmaron y que seguirán ahí al reauditar sobre `origin/main`

Comprobados contra `origin/main` (`50a6031`) el 2026-09-05:

- **El redondeo de horas.** `totalHours *= 0.9` deja un residuo de coma flotante que el
  techo a media hora amplifica. Lo encontraron tres auditorías por separado (césped,
  arbustos, desbroce). Sigue presente en main.
- **La puerta de licencia fitosanitaria no existe.** Un profesional sin carnet puede ser
  reservado para un tratamiento con producto convencional.
- **No existe ningún reembolso, en ninguna parte.** El cliente paga la tarifa, el
  profesional rechaza, la reserva se cancela y el dinero no vuelve.
- **El cliente no puede cancelar su reserva** desde su área.
- **El motor de fitosanitarios cobraba el preventivo a tarifa curativa**, facturaba las
  plantas con los precios del césped y no distinguía intención en palmeras. El bloque es
  idéntico en las dos líneas, así que sigue roto en main.

Y dos que **NO hay que volver a arreglar**, porque `origin/main` ya los resolvió:

- El catálogo público de profesionales: main tiene `public_gardener_directory`.
- La captura del pago: main usa captura diferida a propósito (PR #9). Poner
  `capture_method: 'automatic'` rompería ese diseño.
