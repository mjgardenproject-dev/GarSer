-- Script para inicializar el bucket 'services-background' y simular carpetas
-- Ejecuta este script en el Editor SQL de Supabase

-- 1. Crear el bucket 'services-background' si no existe
INSERT INTO storage.buckets (id, name, public)
VALUES ('services-background', 'services-background', true)
ON CONFLICT (id) DO NOTHING;

-- 2. Configurar políticas de seguridad (Público para lectura, Autenticado para escritura)
-- Eliminar políticas anteriores para evitar duplicados/errores
DROP POLICY IF EXISTS "Public Access" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated Upload" ON storage.objects;
DROP POLICY IF EXISTS "Public Select" ON storage.objects;
DROP POLICY IF EXISTS "Auth Insert" ON storage.objects;

-- Lectura pública para todos
CREATE POLICY "Public Select"
ON storage.objects FOR SELECT
USING ( bucket_id = 'services-background' );

-- Escritura solo para usuarios autenticados (Admin o Jardineros según necesidad)
-- Aquí permitimos a cualquier usuario autenticado subir, puedes restringirlo más si deseas.
CREATE POLICY "Auth Insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK ( bucket_id = 'services-background' );

-- Permitir actualizar/borrar a usuarios autenticados (opcional)
CREATE POLICY "Auth Update"
ON storage.objects FOR UPDATE
TO authenticated
USING ( bucket_id = 'services-background' );

CREATE POLICY "Auth Delete"
ON storage.objects FOR DELETE
TO authenticated
USING ( bucket_id = 'services-background' );

-- 3. Crear "carpetas" (simuladas) para cada servicio
-- En Supabase Storage (S3), las carpetas no existen realmente, son parte del nombre del archivo.
-- Para que aparezcan en el panel, solemos subir un archivo vacío o .keep.
-- Este script intenta insertar objetos placeholder si no existen.
-- NOTA: Insertar directamente en storage.objects es posible pero delicado.
-- Lo ideal es subir un archivo real desde el cliente o usar la API.
-- Sin embargo, podemos intentar registrar los placeholders aquí si el backend lo permite.

-- Lista de servicios normalizados para las carpetas:
-- corte-de-cesped
-- poda-de-plantas
-- corte-de-setos-a-maquina
-- poda-de-arboles
-- labrar-y-quitar-malas-hierbas-a-mano
-- fumigacion-de-plantas
-- poda-de-palmeras

-- Como no podemos "subir" archivos desde SQL puro fácilmente sin contenido binario,
-- lo mejor es crear una función auxiliar o simplemente instruir al usuario.
-- Pero si el usuario pide SQL, podemos insertar metadatos de objetos "vacíos".
-- ADVERTENCIA: Esto crea la entrada en la base de datos, pero el archivo físico no existirá.
-- Esto podría causar errores si intentas descargarlo.
-- ES MEJOR NO INSERTAR OBJETOS FALSOS EN storage.objects DIRECTAMENTE.

-- ALTERNATIVA RECOMENDADA:
-- No ejecutar inserts manuales en storage.objects.
-- El bucket ya está creado arriba.
-- Las carpetas se crearán automáticamente cuando subas la primera imagen.
-- Ejemplo: Al subir 'corte-de-cesped/fondo.jpg', la carpeta aparece.

-- Si realmente quieres ver las carpetas vacías, necesitas subir un archivo '.keep' a cada una.
-- Puedes hacerlo con este script SQL (SOLO METADATOS, el archivo dará 404 si se intenta descargar, pero la carpeta se verá):

/*
INSERT INTO storage.objects (bucket_id, name, owner, metadata)
VALUES 
('services-background', 'corte-de-cesped/.keep', auth.uid(), '{"mimetype": "text/plain"}'),
('services-background', 'poda-de-plantas/.keep', auth.uid(), '{"mimetype": "text/plain"}'),
('services-background', 'corte-de-setos-a-maquina/.keep', auth.uid(), '{"mimetype": "text/plain"}'),
('services-background', 'poda-de-arboles/.keep', auth.uid(), '{"mimetype": "text/plain"}'),
('services-background', 'labrar-y-quitar-malas-hierbas-a-mano/.keep', auth.uid(), '{"mimetype": "text/plain"}'),
('services-background', 'fumigacion-de-plantas/.keep', auth.uid(), '{"mimetype": "text/plain"}'),
('services-background', 'poda-de-palmeras/.keep', auth.uid(), '{"mimetype": "text/plain"}')
ON CONFLICT (bucket_id, name) DO NOTHING;
*/

-- NOTA: He comentado la inserción de objetos falsos porque puede ser peligroso.
-- Lo correcto es subir archivos reales.
-- Con el bucket creado y las políticas aplicadas (pasos 1 y 2), ya puedes ir al panel de Supabase,
-- entrar en 'services-background' y crear las carpetas subiendo un archivo de prueba.
