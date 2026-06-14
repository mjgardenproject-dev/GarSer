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

Crea un archivo `.env` local con solo configuracion publica del frontend:

```env
VITE_SUPABASE_URL=tu_url_de_supabase
VITE_SUPABASE_PUBLISHABLE_KEY=tu_clave_publica_de_supabase
# Compatibilidad legacy si aun no has migrado a publishable key.
VITE_SUPABASE_ANON_KEY=
VITE_GOOGLE_MAPS_API_KEY=tu_clave_de_google_maps
```

Reglas de seguridad:
- Todo `VITE_*` termina embebido en el bundle del navegador.
- No pongas `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `STRIPE_SECRET_KEY` ni ningun secreto de backend en variables `VITE_*`.
- Usa `.env.example` como plantilla y gestiona los secretos reales en Supabase Secrets o en tu proveedor de despliegue.

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
## 🔧 IA de Estimación

El flujo correcto para produccion es server-side:

1. Crea el secreto `OPENAI_API_KEY` en Supabase.
2. Despliega la Edge Function `supabase/functions/ai-pricing-estimator`.
3. Reinicia o redeploya el frontend si has cambiado configuracion relacionada.

No uses `VITE_OPENAI_API_KEY` en el navegador. Exponer la clave del proveedor IA al cliente es una mala practica y rompe el modelo de seguridad.

## 🗂️ Bucket de fotos (opcional)

El análisis con fotos sube imágenes al bucket `booking-photos`.

Para crear el bucket automáticamente:

1. Añade una variable de entorno **solo de administracion local o backend**:

   ```
   SUPABASE_SERVICE_ROLE_KEY=eyJ... (clave de servicio)
   ```

2. Ejecuta:

   ```
   npm run create:bucket
   ```

Esto creará el bucket `booking-photos` como **privado** y con tipos permitidos (`jpeg`, `png`, `webp`).

Notas importantes:
- No uses una `service role key` con prefijo `VITE_`: expondrías un secreto del backend al frontend.
- El bucket no debe ser público en producción.
- Las fotos de reserva deben servirse mediante URLs firmadas o acceso mediado por backend.
