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
  - En producción: Solo usuarios con `profiles.role = 'admin'`

### Variables de Entorno de Seguridad

```env
# Habilitar rutas de debug en producción (NO recomendado)
VITE_ENABLE_DEBUG_ROUTES=false
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
const role = await fetchCurrentUserProfileRole(user.id);
const isAdmin = role === 'admin';
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
  role
});
```

## 📋 Checklist de Seguridad

### Para Desarrollo
- [ ] Verificar que las rutas de debug funcionen en localhost
- [ ] Confirmar que el logging esté habilitado
- [ ] Probar acceso con diferentes roles

### Para Producción
- [ ] Confirmar `VITE_ENABLE_DEBUG_ROUTES=false`
- [ ] Verificar que el rol admin se gestiona en `profiles` o claims server-side
- [ ] Probar que las rutas de debug estén bloqueadas
- [ ] Confirmar que solo administradores accedan a `/role-monitor`

## 🔧 Mantenimiento

### Agregar Nuevo Administrador
1. Asignar rol `admin` en la base de datos o mediante claims server-side
2. Confirmar que las policies RLS reconocen ese rol
3. Forzar refresco de sesion si el cliente ya estaba autenticado

### Habilitar Debug en Producción (NO recomendado)
1. Establecer `VITE_ENABLE_DEBUG_ROUTES=true`
2. Reiniciar la aplicación
3. **IMPORTANTE**: Deshabilitar después del uso

## ⚠️ Advertencias

1. **NUNCA** habilitar rutas de debug en producción permanentemente
2. **SIEMPRE** verificar el origen server-side del rol admin antes del despliegue
3. **MONITOREAR** los logs de acceso a rutas administrativas
4. **ROTAR** las credenciales de administrador regularmente

## 🔍 Auditoría

Para auditar la seguridad:
1. Revisar logs de acceso a rutas protegidas
2. Verificar configuración de variables de entorno
3. Probar acceso con usuarios no autorizados
4. Confirmar que las rutas de debug estén bloqueadas en producción
