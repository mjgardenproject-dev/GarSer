# Debug Session: profile-autosave-conflict [OPEN]

## Síntoma
- Al cambiar el radio de distancia en la configuración de cobertura del jardinero, el autosave hace `POST` a `gardener_profiles` y recibe `400`.
- Supabase devuelve `P0001` con el mensaje `Gardener profile already exists for user_id: 25acf25e-d615-4042-b1e9-3c1376c95908`.

## Evidencia inicial
- Consola del navegador mostrando `useAutoSave.ts:37 POST 400 (Bad Request)`.
- Error serializado en `ProfileSettings.tsx` indicando conflicto por perfil duplicado.

## Hipótesis falsables
1. `CoverageTab` dispara `onSave(getValues())` mediante `useAutoSave`, pero esa ruta termina usando una operación de inserción o una RPC/trigger que rechaza perfiles ya existentes en lugar de actualizar.
2. El `upsert` de `gardener_profiles` en `ProfileSettings.tsx` no está aplicando realmente `onConflict: 'user_id'` por una incompatibilidad del cliente/tipos y Supabase lo traduce a `insert`.
3. Existe un trigger o función en Postgres que intercepta la escritura en `gardener_profiles` y lanza `P0001` si detecta un perfil existente, aunque la llamada venga desde el autosave.
4. El autosave de cobertura está enviando un payload incompleto o con una ruta distinta a la del guardado manual, activando una política/trigger distinta a la esperada.
5. El error no está en cobertura sino en una condición de carrera: el autosave dispara varias escrituras seguidas y la segunda choca con una inserción previa no consolidada.

## Plan de depuración
- Inspeccionar el flujo exacto de `useAutoSave`, `CoverageTab` y `ProfileSettings`.
- Confirmar cómo se persiste `gardener_profiles` y si hay triggers/RPCs asociados.
- Instrumentar mínimamente el punto de escritura si la inspección no basta para identificar la divergencia.
- Aplicar una corrección mínima y robusta solo después de confirmar la causa exacta.

## Resultado del análisis
- Confirmadas las hipótesis `1`, `2` y `3`.
- `CoverageTab` llama a `onSave(getValues())` mediante `useAutoSave` y termina entrando en `onSaveProfileInfo()` de [ProfileSettings.tsx](file:///Users/javier/Downloads/GarSer-main%204/src/components/gardener/ProfileSettings.tsx).
- Esa función usaba `upsert(profileData, { onConflict: 'user_id' })` sobre `gardener_profiles`.
- La base contiene el trigger `prevent_duplicate_gardener_profiles_trigger` en [20250102000000_prevent_duplicate_profiles.sql](file:///Users/javier/Downloads/GarSer-main%204/supabase/migrations/20250102000000_prevent_duplicate_profiles.sql), que hace `RAISE EXCEPTION 'Gardener profile already exists for user_id: %'` en `BEFORE INSERT`.
- Como `upsert` entra primero por la ruta de inserción, el trigger rechaza la operación antes de la resolución de conflicto.

## Fix aplicado
- Se ha reemplazado la persistencia de `gardener_profiles` por una ruta explícita `UPDATE` por `user_id` y `INSERT` solo si no existe fila.
- No se toca el trigger ni la integridad de la base de datos; se corrige el cliente para respetar el contrato real de Supabase/Postgres.
