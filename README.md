# 🚀 Mi Proyecto Web

Una aplicación web moderna construida con React, TypeScript, Vite y Supabase.

## ✨ Características

- ⚡ **Vite** - Build tool ultrarrápido
- ⚛️ **React 18** - Biblioteca de UI moderna
- 🔷 **TypeScript** - Tipado estático
- 🎨 **Tailwind CSS** - Framework de CSS utility-first
- 🗄️ **Supabase** - Backend como servicio
- 🗺️ **Google Maps** - Integración de mapas

## 🛠️ Tecnologías

- React 18
- TypeScript
- Vite
- Tailwind CSS
- Supabase
- Google Maps API

## 🚀 Desarrollo Local

```bash
# Instalar dependencias
npm install

# Ejecutar en modo desarrollo
npm run dev

# Construir para producción
npm run build

# Vista previa de producción
npm run preview
```

## 🌐 Variables de Entorno

Crea un archivo `.env` con:

```env
VITE_SUPABASE_URL=tu_url_de_supabase
VITE_SUPABASE_ANON_KEY=tu_clave_anonima_de_supabase
VITE_GOOGLE_MAPS_API_KEY=tu_clave_de_google_maps
```

## 📦 Despliegue

La aplicación está configurada para desplegarse automáticamente en Vercel.

**Última actualización:** Mapa en tiempo real implementado ✅

Ver [DEPLOY_VERCEL.md](./DEPLOY_VERCEL.md) para instrucciones detalladas.

## 🤝 Contribuir

1. Fork el proyecto
2. Crea una rama para tu feature (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abre un Pull Request

## 📄 Licencia

Este proyecto está bajo la Licencia MIT.
## 🔧 IA de Estimación (Setup rápido)

Para que el botón "Analizar con IA" funcione sin configurar endpoints:

1. Añade tu clave de OpenAI en `.env`:

   ```
   VITE_OPENAI_API_KEY=sk-xxxx
   ```

2. Reinicia `npm run dev`.

El sistema primero intentará invocar la función Edge `ai-pricing-estimator` en Supabase (si la despliegas), y si no está disponible, usará tu `VITE_OPENAI_API_KEY` directamente desde el navegador (solo recomendado para desarrollo).

### (Opcional) Desplegar la función segura en Supabase

Si prefieres no exponer la clave en el cliente:

- En Supabase, crea el secreto: `OPENAI_API_KEY`.
- Despliega la función que ya está en `supabase/functions/ai-pricing-estimator`.

El frontend invocará esta función automáticamente (no necesitas añadir endpoints).

## 🗂️ Bucket de fotos (opcional)

El análisis con fotos sube imágenes al bucket `booking-photos`.

Para crear el bucket automáticamente:

1. Añade tu service role key en `.env`:

   ```
   VITE_SUPABASE_SERVICE_ROLE_KEY=eyJ... (clave de servicio)
   ```

2. Ejecuta:

   ```
   npm run create:bucket
   ```

Esto creará el bucket `booking-photos` con acceso público y tipos permitidos (`jpeg`, `png`, `webp`). Si no lo creas, el análisis funcionará con texto (las fotos fallarán al subir).