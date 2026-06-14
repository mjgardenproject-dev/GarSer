# 🚀 Guía de Despliegue en Vercel

## ✅ Preparación Completada

Tu proyecto ya está listo para desplegarse en Vercel. Se han configurado:

- ✅ Build de producción funcionando
- ✅ Archivo `vercel.json` con configuración optimizada
- ✅ Variables de entorno preparadas
- ✅ Optimizaciones de caché y routing

## 📋 Pasos para Desplegar

### 1. Crear cuenta en Vercel
- Ve a [vercel.com](https://vercel.com)
- Regístrate con GitHub, GitLab o email

### 2. Subir tu proyecto a GitHub (recomendado)
```bash
# Si no tienes git inicializado
git init
git add .
git commit -m "Proyecto listo para Vercel"

# Crear repositorio en GitHub y conectarlo
git remote add origin https://github.com/tu-usuario/tu-repositorio.git
git push -u origin main
```

### 3. Conectar con Vercel
- En Vercel, haz clic en "New Project"
- Conecta tu repositorio de GitHub
- Vercel detectará automáticamente que es un proyecto Vite

### 4. Configurar Variables de Entorno
En el panel de Vercel, ve a Settings > Environment Variables y agrega:

```
VITE_SUPABASE_URL = https://tu-proyecto.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY = sb_publishable_xxxxx
# Compatibilidad legacy si tu proyecto aun usa anon JWT
VITE_SUPABASE_ANON_KEY = eyJ...opcional...
VITE_GOOGLE_MAPS_API_KEY = AIza...restringida-por-dominio...
```

Notas importantes:
- `VITE_*` son variables publicas del frontend, no secretos.
- No pongas `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `STRIPE_SECRET_KEY` ni secretos equivalentes en Vercel como variables del frontend.
- Los secretos de backend deben vivir en Supabase Secrets, Edge Functions o en el entorno server-side que los consuma.

### 5. Desplegar
- Haz clic en "Deploy"
- Vercel construirá y desplegará tu aplicación automáticamente
- Recibirás una URL pública como: `https://tu-proyecto.vercel.app`

## 🎯 Beneficios del Despliegue

- **URL Pública**: Accesible desde cualquier dispositivo
- **100% Estabilidad**: Sin problemas de servidor local
- **HTTPS Automático**: Seguridad garantizada
- **CDN Global**: Carga rápida en todo el mundo
- **Actualizaciones Automáticas**: Cada push actualiza la app

## 🔄 Actualizaciones Futuras

Cada vez que hagas cambios:
1. Haz commit y push a GitHub
2. Vercel desplegará automáticamente los cambios
3. Tu app se actualizará en segundos

## 📞 Soporte

Si necesitas ayuda con algún paso, ¡pregúntame!
