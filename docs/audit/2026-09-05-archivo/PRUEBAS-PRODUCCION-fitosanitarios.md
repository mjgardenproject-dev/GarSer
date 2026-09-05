# Servicios fitosanitarios — pruebas en PRODUCCIÓN (garser.es)

> **Cómo se usa este documento.** Es la sección de fitosanitarios de la batería final. Va
> pegada dentro de `docs/audit/2026-07-12/PRUEBAS-PRODUCCION.md`, que vive en la rama
> `fix/pagos-emails-geocoding`; aquí está aparte para no pisar sus 665 líneas desde otra
> rama. Se ejecuta **después** de desplegar, sobre garser.es, de arriba abajo y en orden.
>
> Marca `[ ]` solo lo que veas con tus ojos. **Si algo falla, para y avisa.**

## 0. Antes de empezar: ¿estás probando lo que crees?

- [ ] **0.1 · La función desplegada es la nueva.** En una zona de césped preventiva de
  1000 m², el precio debe ser **120 €** (0,12 €/m²). Si sale 200 € estás contra la versión
  vieja: `booking-authority` no se ha redesplegado.
- [ ] **0.2 · La migración está aplicada.** En el SQL editor de producción:
  ```sql
  select count(*) from public.gardener_public_catalog;
  select public.gardener_has_phytosanitary_license('<uuid de un jardinero real>');
  ```
  Las dos deben responder. Si dan "relation does not exist", falta la migración
  `20260905090000_public_gardener_catalog_and_phyto_license.sql`.
- [ ] **0.3 · Un jardinero real tiene tarifas.** Entra como jardinero → Mi Perfil →
  Servicios → Servicios fitosanitarios → Configurar. **La tabla «Tarifas por Categoría»
  debe verse nada más abrir el panel**, sin pulsar «Por Cantidad». Si está escondida,
  la versión desplegada es la vieja.

## 1. El precio que se cobra es el que el jardinero configuró

Sustituye las tarifas por las del jardinero real que uses. Con la configuración de
referencia (césped 0,12/0,20 · palmeras altas 50/75 · árboles grandes 40/65):

- [ ] **1.1 · Preventivo ≠ curativo.** Reserva de césped, 1000 m², **preventivo**,
  producto convencional → **120 €**. Repite en **curativo/insectos** → **200 €**.
  *Antes los dos cobraban 200 €.*
- [ ] **1.2 · Las plantas se cobran a tarifa de plantas.** Zona «Plantas y arbustos»,
  500 m², tamaño **Medianas**, curativo → **160 €** (500 × 0,32), no 100 € de tarifa de
  césped.
- [ ] **1.3 · Las palmeras distinguen intención.** 5 palmeras **Altas**, preventivo →
  **250 €**. Las mismas en curativo → **375 €**. *Antes las dos cobraban 275 €.*
- [ ] **1.4 · Los árboles tienen tres bandas.** 10 árboles **Grandes**, curativo →
  **650 €**. *Antes se cobraban como medianos: 250 €.*
- [ ] **1.5 · Dos productos, dos tarifas, sin recargo.** Césped 1000 m², curativo
  **«Ambos»** → **400 €** (0,20 × 2 × 1000). No debe aparecer ningún recargo por combinar.
- [ ] **1.6 · Ecológico.** Césped 1000 m², preventivo, producto **Ecológico** →
  **132 €** (0,12 + 10 %).
- [ ] **1.7 · Endoterapia.** 5 palmeras, modo **Endoterapia** → **325 €** (5 × 65 €/tronco).
  Compruébalo también en **Ambos**: pulverización + inyección suman.
- [ ] **1.8 · Mínimo del ámbito.** 1 palmera pequeña preventiva → **60 €** (el mínimo de
  palmeras), no 50 € del mínimo global. 20 m² de plantas → **45 €**.

## 2. El desglose que ve el cliente suma lo que paga

- [ ] **2.1** En la pantalla de pago, despliega «Ver desglose detallado». La suma de las
  líneas debe ser **exactamente** el «Subtotal del servicio». Prueba con un caso ecológico
  (1000 m² curativo eco → 220 €): antes el desglose decía 221 € y se cobraban 220 €.
- [ ] **2.2** La línea nombra la banda: «Zona 1: Palmeras Altas (más de 8 m) · 5ud · …».
- [ ] **2.3** Total de la reserva = subtotal + 12,5 % de tarifa. Para 250 € → **281,25 €**,
  con 31,25 € de tarifa y 250 € pendientes al profesional.

## 3. Un cliente nuevo ve profesionales

**Esta es la prueba que más importa: antes fallaba para todo el mundo que no hubiese
reservado ya.**

- [ ] **3.1 · Sin iniciar sesión** (ventana de incógnito), recorre el funnel hasta el paso 4.
  **Debe aparecer al menos un profesional** con su precio y sus horas.
- [ ] **3.2 · Con una cuenta recién creada** que no tenga ninguna reserva, lo mismo.
- [ ] **3.3 · En las herramientas de desarrollo, pestaña Red**, la petición a
  `gardener_public_catalog` debe devolver **200**. Si ves un 401 a `gardener_profiles`,
  el front desplegado es el viejo.
- [ ] **3.4 · No se filtra PII.** Inspecciona esa respuesta: solo debe traer `user_id`,
  `full_name`, `avatar_url`, `rating_average`, `rating_count` y
  `has_phytosanitary_license`. **Ni teléfono, ni dirección, ni documentos.**

## 4. Licencia de productos fitosanitarios

Necesitas un jardinero **sin** el carnet verificado, o quitárselo temporalmente desde el
panel de admin.

- [ ] **4.1** Reserva un tratamiento con producto **convencional** en su zona: **no debe
  aparecer** en la lista.
- [ ] **4.2** El mismo tratamiento con producto **ecológico**: **sí debe aparecer**.
- [ ] **4.3** Verifícale el carnet y repite 4.1: vuelve a aparecer.
- [ ] **4.4 · El mensaje de lista vacía dice la verdad.** Con una dirección fuera de
  cobertura, el aviso debe hablar de cobertura, **no** de licencia. Antes siempre culpaba
  a la licencia.

## 5. El configurador del jardinero no mueve precios solo

**El fallo más caro que encontró la auditoría: abrir el panel y guardar subía las tarifas.**

- [ ] **5.1** Como cliente, apunta el precio de 5 palmeras altas preventivas.
- [ ] **5.2** Como jardinero, abre el configurador de fitosanitarios, pulsa «Por Cantidad»,
  **no cambies nada** y cierra.
- [ ] **5.3** Repite la reserva del 5.1: **el precio debe ser idéntico**. Antes la
  endoterapia pasaba de 65 € a 160 €, la palmera >3 m de 55 € a 75 € y el árbol de 40 € a 65 €.
- [ ] **5.4** En SQL, `additional_config` **no** debe contener `superficies_plantas`,
  `setos`, `arboles`, `type_prices` ni `palmeras.tradicional`:
  ```sql
  select additional_config ? 'type_prices', additional_config->'palmeras' ? 'tradicional'
  from public.gardener_service_prices gsp
  join public.services s on s.id = gsp.service_id
  where s.name ilike '%fitosanit%';
  ```
  Las dos columnas deben decir `false`.
- [ ] **5.5** Cambia una tarifa a propósito (p. ej. palmeras altas preventivo de 50 a 60),
  guarda, y comprueba que el precio del cliente sube en consecuencia (250 € → 300 €).
  **Déjala como estaba después.**
- [ ] **5.6** El panel tiene control para: endoterapia por tronco, mínimo de cada ámbito
  (los cinco) y recargo ecológico. **No** debe haber ningún recargo por combinar
  tratamientos.

## 6. Wizard manual completo

- [ ] **6.1** El wizard pregunta el **tamaño** en plantas, setos, árboles y palmeras, con
  las mismas bandas que ve el jardinero al poner precio.
- [ ] **6.2** En palmeras pregunta el **modo de aplicación** (pulverización / endoterapia /
  ambos).
- [ ] **6.3** **No** pregunta por retirada de restos: no se cobra y el jardinero no puede
  tarifarla.
- [ ] **6.4** Fuera de rango: introduce 6000 m² (el máximo es 5000). Debe rechazarlo con un
  mensaje claro, **no truncar en silencio**.
- [ ] **6.5** Plausibilidad: 5000 m² de césped deben mostrar el aviso de que la superficie
  es mayor de lo habitual y que el profesional revisará la medida.

## 7. Disponibilidad

- [ ] **7.1** Un domingo no ofrece horas.
- [ ] **7.2** Una dirección fuera del radio del profesional lo excluye.
- [ ] **7.3** El hueco bloqueado cubre las horas estimadas (5 palmeras = 1,5 h → bloque
  suficiente en el calendario del jardinero).

## 8. Ciclo de vida (requiere pago real de test)

- [ ] **8.1** Pago con `4242 4242 4242 4242`; en `bookings`, `total_price` y
  `management_fee` coinciden con lo que decía la pantalla.
- [ ] **8.2** El jardinero propone un cambio de precio; el cliente lo acepta; el nuevo
  importe aparece en pantalla y en `bookings`.
- [ ] **8.3** Cancelación por los dos lados: comprueba captura, reembolso y penalización
  en base de datos.
- [ ] **8.4** Finalización y reseña: la reseña se ve y la media del jardinero se actualiza.
- [ ] **8.5** Volver a reservar el mismo servicio desde el área de cliente.

## 9. Cierre

- [ ] **9.1** Consola del navegador sin errores durante todo el recorrido.
- [ ] **9.2** Pestaña Red sin 4xx ni 5xx inesperados.
- [ ] **9.3** Vuelve a ejecutar el paso 0.1: sigue dando 120 €.
