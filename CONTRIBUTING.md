# GarSer - Documentación de Arquitectura y Desarrollo

**Última actualización:** 17 de abril de 2026 | **Versión:** 1.0 (CTO Mode Activo)

Este conjunto de documentos define los estándares, patrones y no-negociables para desarrollar en GarSer bajo un modelo de **CTO Senior / Arquitecto Crítico**.

---

## 📚 Documentos de Referencia

### 1. **[AGENTS.md](AGENTS.md)** — Mandatos para Agentes de IA
**Para:** Cualquier agente (IA, desarrollador) que trabaje en este codebase  
**Contiene:**
- ✅ 4 mandatos no negociables
- ✅ Por qué NO aceptar deuda técnica
- ✅ Cómo entender problemas de negocio primero
- ✅ Estándares arquitectónicos (SRP, RLS, Precios)
- ✅ Checklist obligatorio para PRs

**Cuándo leer:**
- Antes de hacer cambios arquitectónicos
- Si estás tentado de hacer un "parche rápido"
- Cuando rechazo un PR

**Tiempo de lectura:** 15 minutos

---

### 2. **[ARCHITECTURE.md](ARCHITECTURE.md)** — Inventario de Deuda Técnica
**Para:** Entender qué problemas existen y cómo se solucionan  
**Contiene:**
- 🔴 **5 problemas críticos** con análisis y planes
- 📊 Escala de criticidad y timeline
- 🚫 Qué NO hacer
- 💼 Impacto en negocio de cada problema

**Problemas cubiertos:**
1. RLS inestable (5+ fixes, requiere auditoría)
2. Tabla availability_blocks missing (causa double-booking)
3. 5 servicios de precios sin consolidación
4. Autenticación con retry frágil
5. Validación de imágenes sin tests

**Cuándo leer:**
- Al onboarding
- Antes de tocar componentes críticos
- Si surge un bug "raro"

**Tiempo de lectura:** 25 minutos

---

### 3. **[PATTERNS.md](PATTERNS.md)** — Patrones de Código
**Para:** Escribir código que sea predecible y mantenible  
**Contiene:**
- 🏗️ Arquitectura de capas (presentación → lógica → persistencia)
- 📦 Estructura de directorios explicada
- 🔐 Patrones de seguridad (ProtectedRoute, RLS)
- 🛠️ Patrones de servicios (Simple, Async, Orquestador)
- 📊 Patrones de estado (useState vs Context)
- 🧪 Convenciones de testing
- ⚠️ 3 anti-patrones comunes a evitar

**Cuándo leer:**
- Antes de crear un archivo nuevo
- Si no sabes dónde poner código
- Para ver ejemplos de "lo correcto"

**Tiempo de lectura:** 20 minutos

---

### 4. **[SECURITY.md](SECURITY.md)** — Seguridad Implementada
**Para:** Entender las protecciones actuales  
**Contiene:**
- 🔒 Rutas protegidas (DevelopmentRoute, AdminRoute)
- 🔑 Variables de entorno de seguridad
- ⚠️ Alertas de seguridad
- 📋 Checklist de seguridad

**Cuándo leer:**
- Al trabajar en autenticación/autorización
- Antes de exponer un endpoint nuevo
- Para evitar vulnerabilidades

---

### 5. **[README.md](README.md)** — Setup e Instalación
**Para:** Configuración del proyecto  
**Contiene:**
- 📦 Tech stack
- 🚀 Comandos de desarrollo
- 🌐 Variables de entorno
- 📋 Instrucciones de deploy

---

## 🎯 Guía Rápida por Escenario

### Escenario A: "Quiero añadir una feature nueva"

1. 📖 Lee [AGENTS.md](AGENTS.md#-mandatos-no-negociables) → Entiende los 4 mandatos
2. 💼 Define el **problema de negocio** (responde 3 preguntas en tu cabeza)
3. 📐 Revisa [PATTERNS.md](PATTERNS.md#-arquitectura-de-capas) → Dónde iría el código
4. ✅ Sigue [PATTERNS.md#-patrones-de-servicios](PATTERNS.md#-patrones-de-servicios) → Estructura correcta
5. 🧪 Escribe tests (ver [PATTERNS.md#-patrones-de-testing](PATTERNS.md#-patrones-de-testing))

---

### Escenario B: "Encuentro un bug extraño"

1. 📋 Revisa [ARCHITECTURE.md#-inventario-de-deuda-técnica-y-plan-de-mitigación](ARCHITECTURE.md) → ¿Es problema conocido?
2. 🔍 Busca la sección relevante (ej: "RLS Inestable", "Precios Fragmentados")
3. 🧯 Sigue el plan de remediación o reporta al CTO

---

### Escenario C: "Alguien propone un 'parche rápido'"

1. ❌ Lee [AGENTS.md#-rechaza-soluciones-que-crean-deuda-técnica](AGENTS.md#-rechaza-soluciones-que-crean-deuda-técnica)
2. 🚫 Ve a [ARCHITECTURE.md#--qué-no-hacer](ARCHITECTURE.md#--qué-no-hacer)
3. 🏗️ Propón la **solución arquitectónica correcta**

---

### Escenario D: "Necesito implementar seguridad"

1. 🔐 Lee [SECURITY.md](SECURITY.md)
2. 🛡️ Usa [PATTERNS.md#-patrones-de-seguridad](PATTERNS.md#-patrones-de-seguridad)
3. ✅ Sigue [AGENTS.md#-checklist-obligatorio-para-cualquier-pr](AGENTS.md#-checklist-obligatorio-para-cualquier-pr)

---

### Escenario E: "¿Dónde pongo este código?"

1. 📦 Revisa [PATTERNS.md#-estructura-de-directorios-explicada](PATTERNS.md#-estructura-de-directorios-explicada)
2. 🏗️ Sigue la convención de nombres
3. ⚠️ Evita los [anti-patrones](PATTERNS.md#️-anti-patrones-qué-no-hacer)

---

## 🔴 Problemas Críticos Bloqueantes

**ANTES de hacer PRs de features, estos deben estar solucionados:**

| ID | Problema | Estado | Bloqueante | Ref |
|----|----------|--------|-----------|-----|
| 1 | RLS Audit | 🟡 Pendiente | ✅ SÍ | [ARCHITECTURE.md#1-crítico-rls](ARCHITECTURE.md#1-crítico-rls-row-level-security-inestable) |
| 2 | availability_blocks Schema | 🟡 Pendiente | ✅ SÍ | [ARCHITECTURE.md#2-crítico-tabla-availability_blocks](ARCHITECTURE.md#2-crítico-tabla-availability_blocks-no-existe) |
| 3 | Consolidar Precios | 🟡 Pendiente | ⚠️ Recomendado | [ARCHITECTURE.md#3-alto-servicios-de-precios](ARCHITECTURE.md#3-alto-servicios-de-precios-fragmentados-5-motores) |
| 4 | Auth Retry Logic | 🟡 Pendiente | ⚠️ Mejora UX | [ARCHITECTURE.md#4-alto-autenticación-con-retry](ARCHITECTURE.md#4-alto-autenticación-con-retry-frágil) |
| 5 | Image Validation Tests | 🟡 Pendiente | ✅ Seguridad | [ARCHITECTURE.md#5-medio-validación-de-imágenes](ARCHITECTURE.md#5-medio-validación-de-imágenes-sin-tests) |

---

## 📊 Impacto en Negocio

```
Problema Técnico          Impacto en Negocio           Riesgo Financiero
─────────────────────────────────────────────────────────────────────────
RLS quebrado        →     Breach de privacidad      →    $$ Litigios
Double-booking      →     Cliente + Jardinero fuera →    $$ Refunds + Reputación
Precios inconsist.  →     Desconfianza de tarifas  →    💨 Churn de clientes
Auth frágil         →     Usuarios abandonan app   →    📉 DAU ↓
Imágenes malware    →     Breach de seguridad      →    🔓 GDPR + Credibilidad
```

**Punto:** Estos no son problemas de "código sucio", son **riesgos comerciales**.

---

## 🚀 Roadmap de Remediación

### Semana 1 (CRÍTICO)
- [ ] RLS Audit completa (4h)
- [ ] Plan migration availability_blocks (2h)
- [ ] Image validation tests (4h)

### Semana 2 (CRÍTICO)
- [ ] Implementar availability_blocks schema (4h)
- [ ] Remover compat layers (2h)
- [ ] Validar con tests (2h)

### Semana 3-4 (ALTO)
- [ ] Consolidar pricingEngine.ts (8h)
- [ ] Auth retry con exponential backoff (4h)
- [ ] Documentar cambios (2h)

**Buffer:** Completar en 1 mes, no paralelo.

---

## 📞 Cómo Contactar al CTO

**Si tienes dudas sobre:**
- Arquitectura → Lee [AGENTS.md](AGENTS.md) primero
- Deuda técnica → Revisa [ARCHITECTURE.md](ARCHITECTURE.md)
- Patrones de código → Consulta [PATTERNS.md](PATTERNS.md)

**Si estás bloqueado:**
- Describe el problema
- Explica qué intentaste
- Referencia los docs correspondientes

---

## 🔗 Stack y Links Útiles

| Tecnología | Docs | Config |
|-----------|------|--------|
| React 18 | [react.dev](https://react.dev) | `src/App.tsx` |
| TypeScript | [typescriptlang.org](https://typescriptlang.org) | `tsconfig.json` |
| Vite | [vitejs.dev](https://vitejs.dev) | `vite.config.ts` |
| Tailwind | [tailwindcss.com](https://tailwindcss.com) | `tailwind.config.js` |
| Supabase | [supabase.com/docs](https://supabase.com/docs) | `src/lib/supabase.ts` |
| Google Maps | [developers.google.com/maps](https://developers.google.com/maps) | `src/lib/googleMapsLoader.ts` |
| OpenAI | [platform.openai.com](https://platform.openai.com) | `.env.example` |

---

## ✅ Checklist para Nuevos Desarrolladores

- [ ] Clone el repo y `npm install`
- [ ] Lee [README.md](README.md)
- [ ] Lee [AGENTS.md](AGENTS.md) (15 min)
- [ ] Lee [PATTERNS.md](PATTERNS.md) (20 min)
- [ ] Lee [ARCHITECTURE.md](ARCHITECTURE.md) (25 min)
- [ ] Revisa [SECURITY.md](SECURITY.md) (10 min)
- [ ] Haz `npm run dev` y explora la app
- [ ] Identifica un problema pequeño para tu primer PR
- [ ] Sigue el checklist de [AGENTS.md#-checklist-obligatorio-para-cualquier-pr](AGENTS.md#-checklist-obligatorio-para-cualquier-pr)

---

## 🎓 Ejemplo de "Hacer las Cosas Bien"

**User Story:** "Jardinero necesita bloquear su disponibilidad por vacaciones"

**Pasos (siguiendo los docs):**

1. **Entender el negocio** (AGENTS.md)
   - ¿Por qué? Algunos jardineros se van de vacaciones
   - ¿Cuándo? Momentos antes de una temporada
   - ¿Impacto si no lo hacemos? Clientes no pueden reservar (OK), pero jardinero no puede comunicar indisponibilidad

2. **Revisar arquitectura** (ARCHITECTURE.md)
   - ❌ availability_blocks tabla no existe → BLOQUEANTE
   - Necesito primero crear la tabla

3. **Planificar la solución** (PATTERNS.md)
   - BD: Migration para availability_blocks
   - Servicio: availabilityService.blockTimeSlot()
   - UI: GardenerAvailabilityEditor.tsx
   - Seguridad: RLS para que solo el jardinero bloquee su disponibilidad

4. **Implementar**
   ```
   a) supabase/migrations/xxx_availability_blocks.sql
   b) src/utils/availabilityService.ts
   c) src/components/gardener/GardenerAvailabilityEditor.tsx
   d) src/utils/availabilityService.test.ts
   ```

5. **Validar** (AGENTS.md checklist)
   - ¿Entiendo el problema? Sí
   - ¿Introduce deuda técnica? No (estamos removiendo)
   - ¿Cambia RLS? Sí → incluye test de seguridad
   - ¿Tengo tests? Sí
   - ¿Es la solución más simple? Sí

6. **PR Checklist**
   - [ ] Cambio de BD con migration
   - [ ] Service con tests
   - [ ] UI con protección de roles
   - [ ] Tests de seguridad (solo jardinero puede bloquear su propia disponibilidad)
   - [ ] No introduce deuda técnica

---

**FIN. Este documento es el "Contrato de Arquitectura" del proyecto.**

Última línea: *Si violamos esto, el sistema colapsa. Si lo respetamos, escalamos.*
