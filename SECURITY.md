# Seguridad de la Aplicación

## 🔒 Protección de Rutas Administrativas

### Rutas Protegidas

#### 1. Rutas de Desarrollo (`DevelopmentRoute`)
- **Rutas**: `/debug-maps`, `/debug-roles`
- **Protección**: Solo disponibles en entorno de desarrollo local
- **Condiciones**:
  - `import.meta.env.DEV === true` (modo desarrollo de Vite)
  - `hostname` debe ser `localhost`, `127.0.0.1` o `::1`
  - O `VITE_ENABLE_DEBUG_ROUTES=true` (para casos especiales)

#### 2. Rutas Administrativas (`AdminRoute`)
- **Rutas**: `/role-monitor`
- **Protección**: Solo para usuarios administradores
- **Condiciones**:
  - En desarrollo: Acceso permitido si `allowInDevelopment=true`
  - En producción: Solo usuarios con rol `admin` o emails autorizados

### Variables de Entorno de Seguridad

```env
# Habilitar rutas de debug en producción (NO recomendado)
VITE_ENABLE_DEBUG_ROUTES=false

# Emails de administradores autorizados
VITE_ADMIN_EMAILS=admin@jardineria.com,developer@jardineria.com
```

### Configuración por Entorno

#### Desarrollo Local
- ✅ Rutas de debug habilitadas automáticamente
- ✅ Rutas administrativas accesibles
- ✅ Logging detallado habilitado

#### Producción
- ❌ Rutas de debug deshabilitadas por defecto
- ❌ Solo administradores pueden acceder a rutas administrativas
- ⚠️ Logging reducido

## 🛡️ Medidas de Seguridad Implementadas

### 1. Verificación de Entorno
```typescript
const isDevelopment = import.meta.env.DEV;
const isLocalhost = window.location.hostname === 'localhost';
```

### 2. Verificación de Roles
```typescript
const adminEmails = import.meta.env.VITE_ADMIN_EMAILS?.split(',') || [];
const isAdmin = profile?.role === 'admin' || adminEmails.includes(profile?.email);
```

### 3. Páginas de Error Seguras
- Mensajes informativos sin revelar información sensible
- Redirección automática a páginas seguras
- Logging de intentos de acceso no autorizados

## 🚨 Alertas de Seguridad

### Acceso Denegado
Cuando un usuario intenta acceder a una ruta protegida:
1. Se registra el intento en la consola
2. Se muestra una página de error amigable
3. Se ofrece navegación de vuelta a áreas seguras

### Logging de Seguridad
```typescript
console.warn('🚫 AdminRoute: Acceso denegado', {
  userId: user.id,
  email: user.email,
  role: profile?.role
});
```

## 📋 Checklist de Seguridad

### Para Desarrollo
- [ ] Verificar que las rutas de debug funcionen en localhost
- [ ] Confirmar que el logging esté habilitado
- [ ] Probar acceso con diferentes roles

### Para Producción
- [ ] Confirmar `VITE_ENABLE_DEBUG_ROUTES=false`
- [ ] Verificar lista de emails de administradores
- [ ] Probar que las rutas de debug estén bloqueadas
- [ ] Confirmar que solo administradores accedan a `/role-monitor`

## 🔧 Mantenimiento

### Agregar Nuevo Administrador
1. Agregar email a `VITE_ADMIN_EMAILS` en variables de entorno
2. O asignar rol `admin` en la base de datos
3. Reiniciar la aplicación

### Habilitar Debug en Producción (NO recomendado)
1. Establecer `VITE_ENABLE_DEBUG_ROUTES=true`
2. Reiniciar la aplicación
3. **IMPORTANTE**: Deshabilitar después del uso

## ⚠️ Advertencias

1. **NUNCA** habilitar rutas de debug en producción permanentemente
2. **SIEMPRE** verificar la lista de administradores antes del despliegue
3. **MONITOREAR** los logs de acceso a rutas administrativas
4. **ROTAR** las credenciales de administrador regularmente

## 🔍 Auditoría

Para auditar la seguridad:
1. Revisar logs de acceso a rutas protegidas
2. Verificar configuración de variables de entorno
3. Probar acceso con usuarios no autorizados
4. Confirmar que las rutas de debug estén bloqueadas en producción