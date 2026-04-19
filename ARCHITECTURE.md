# GarSer - Inventario de Deuda Técnica y Plan de Mitigación

**Objetivo:** Dar visibilidad clara sobre los problemas arquitectónicos y bloquear soluciones que los empeoren.

**Status:** 🔴 CRÍTICO | 📊 Última auditoría: Abril 2026

---

## 1. CRÍTICO: RLS (Row Level Security) Inestable

### El Problema

```sql
-- Historial de fixes en raíz
fix_rls_policies.sql         ← DROP POLICY loop (15+)
fix_database_schema.sql      ← Schema inicial incorrecto
fix_all_rls_issues.sql       ← Admin no puede leer admin_applications
diagnose_rls_issues.sql      ← Herramienta de diagnosis
```

**Síntoma:** Múltiples intentos de "arreglarlo" sugieren que no entendemos el modelo correcto.

### Raíz del Problema

```typescript
// En supabase_policies.sql probable existencia de políticas CONFLICTIVAS:
-- Política A: CREATE POLICY "admin_read" ON gardener_applications FOR SELECT...
-- Política B: CREATE POLICY "admin_read_v2" ON gardener_applications FOR SELECT...
-- → PostgreSQL ejecuta ambas con OR lógico = acceso incorrecto o inconsistente
```

### Impacto en Negocio

| Escenario | Riesgo |
|-----------|--------|
| Admin no puede ver aplicaciones de jardineros | ❌ Proceso de hiring bloqueado |
| Client ve datos de otro client | 🔓 Breach de privacidad |
| Jardinero modifica booking ajeno | 💥 Doble-booking + refunds |

### Plan de Remediación (2 días)

**Fase 1: Auditoría (4h)**
```bash
# En Supabase console, ejecutar:
SELECT schemaname, tablename, 
       array_agg(policyname) as policies 
FROM pg_policies 
GROUP BY schemaname, tablename;
```
- Documentar política por tabla
- Identificar duplicados/conflictos
- Listar qué rol puede qué operación

**Fase 2: Validación (4h)**
```typescript
// Crear archivo: supabase/tests/rls-validation.sql
-- Para cada (tabla, rol, operación):
-- 1. Conectar como ese rol
-- 2. Intentar SELECT, INSERT, UPDATE, DELETE
-- 3. Verificar resultado esperado
-- Ejemplo:
SELECT COUNT(*) FROM gardener_applications;  -- Como admin: debe dar N
                                              -- Como client: debe dar ERROR
```

**Fase 3: Remediación (4h)**
1. Backup de RLS actual: `pg_dump --schema-only`
2. Eliminar todas las políticas: `DROP POLICY ... ON ...`
3. Reescribir desde cero con nombres únicos (en inglés)
4. Validar con tests

**Bloqueo:** NO se puede cambiar nada de seguridad hasta tener auditoría.

---

## 2. CRÍTICO: Tabla `availability_blocks` No Existe

### El Problema

```typescript
// En availabilityServiceCompat.ts
const tryDB = async () => {
  try {
    return await supabase.from('availability_blocks').select();
  } catch {
    return null;  // ← Fallback silencioso
  }
};
```

**Consecuencia:**
- `availabilityService.ts` → delega a `availabilityServiceCompat.ts`
- `mergedAvailabilityService.ts` → también intenta
- **3 capas de indirección innecesarias**

### Impacto en Negocio

| Escenario | Riesgo |
|-----------|--------|
| Double-booking posible (sin tabla) | 💥 Múltiples jardineros mismo time-slot |
| Inconsistencia en caché vs BD | 🔄 Datos stale, bookings fantasma |
| Performance: N queries en lugar de 1 | ⚠️ Latencia 3-5x |

### Plan de Remediación (1 día)

**Fase 1: Crear Migration (2h)**
```sql
-- supabase/migrations/20260417_create_availability_blocks.sql
CREATE TABLE availability_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gardener_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  start_time timestamp NOT NULL,
  end_time timestamp NOT NULL,
  is_available boolean NOT NULL DEFAULT true,
  reason TEXT,  -- "vacation", "booked", "maintenance"
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE INDEX idx_availability_gardener_time 
ON availability_blocks(gardener_id, start_time);

CREATE INDEX idx_availability_range 
ON availability_blocks(start_time, end_time) 
WHERE is_available = true;

-- Constraint: end_time > start_time
ALTER TABLE availability_blocks 
ADD CONSTRAINT valid_time_range CHECK (end_time > start_time);
```

**Fase 2: Remover Compat Layer (2h)**
```typescript
// Eliminar availabilityServiceCompat.ts
// Actualizar availabilityService.ts para usar la tabla real
// Remover mergedAvailabilityService.ts

export const blockTimeSlot = async (
  gardenerId: string, 
  startTime: Date, 
  endTime: Date
) => {
  const { data, error } = await supabase
    .from('availability_blocks')
    .insert({
      gardener_id: gardenerId,
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
      is_available: false,
      reason: 'booked'
    });
  
  if (error) throw new Error(`Failed to block: ${error.message}`);
  return data;
};
```

**Fase 3: Tests (2h)**
```typescript
describe('availabilityService', () => {
  it('should block time slots without overlap', async () => {
    // 1. Block 10-12
    // 2. Try to block 11-13
    // 3. Should fail with specific error
  });
  
  it('should not double-book', async () => {
    // Create booking at 10-12
    // Query availability should show false for 10-12
  });
});
```

**Bloqueo:** NO se aceptan nuevas features de disponibilidad hasta tener la tabla.

---

## 3. ALTO: Servicios de Precios Fragmentados (5 Motores)

### El Problema

| Servicio | Responsabilidad | Problema |
|----------|-----------------|----------|
| `weedingPricing.ts` | Desbroce | Matriz manual, sin tests |
| `phytosanitaryPricing.ts` | Fitosanitarios | Lógica condicional 48L |
| `aiPricingEstimator.ts` | IA OpenAI/Gemini | Fallback a "inconclusive" |
| `pricingEngine.ts` | Orquestación??? | Suena bien pero en `domain/` → probablemente incomplete |
| `mergedAvailabilityService.ts` | Mezcla precios + availability | ❌ Violación de SRP |

```typescript
// ¿Cuál usar? Cliente no sabe
const estimatePrice = async (service) => {
  if (service === 'weeding') return calculateWeedingPrice(...);
  if (service === 'phytosanitaria') return calculatePhytosanitaryPrice(...);
  // ¿Y si es custom?
  return callAIEstimator(...); // Fallback oculto
};
```

### Impacto en Negocio

| Escenario | Riesgo |
|-----------|--------|
| Cliente A recibe presupuesto $500, Cliente B $700 por mismo servicio | 💥 Inconsistencia |
| IA está offline → app devuelve "inconclusive" sin fallback | 🔴 Booking no se puede crear |
| Agregar servicio nuevo requiere editar 3 archivos | 🛠️ High refactor cost |

### Plan de Remediación (2 días)

**Fase 1: Documentar (2h)**
```typescript
// Crear: src/domain/PRICING_STRATEGY.md

## Matriz de Precios Actual

### Weeding (Desbroce)
- Área < 50m²: $50 base + $2/m²
- 50-200m²: $150 base + $1.5/m²
- > 200m²: $400 base + $1/m²
- Obstáculos: +25%, +50%, +100%
- Fuente: weedingPricing.ts line 23-45

### Phytosanitary (Fitosanitarios)
- Tipo plaga: ["hormigas", "ácaros", ...] → multiplicador
- Área: similar a weeding
- Urgencia: same-day = +50%
- Fuente: phytosanitaryPricing.ts + IA validation

### IA Estimator (OpenAI gpt-4o-mini)
- Modo: auto_quote | calculate_palm_pricing | weeding_quality_check
- Fallback: IA error → devuelve "inconclusive"
- Problema: mode selection no está documentado
```

**Fase 2: Consolidar en pricingEngine.ts (4h)**
```typescript
// src/domain/pricingEngine.ts

export enum PricingStrategy {
  WEEDING = 'weeding',
  PHYTOSANITARY = 'phytosanitary',
  AI_ESTIMATE = 'ai_estimate'
}

export interface PricingContext {
  strategy: PricingStrategy;
  area: number; // m²
  serviceType: string;
  urgency?: 'same-day' | 'normal';
  images?: Blob[];
  conditions?: string;
}

export class PricingEngine {
  async estimatePrice(context: PricingContext): Promise<PriceEstimate> {
    switch (context.strategy) {
      case PricingStrategy.WEEDING:
        return this.calculateWeedingPrice(context);
      case PricingStrategy.PHYTOSANITARY:
        return this.calculatePhytosanitaryPrice(context);
      case PricingStrategy.AI_ESTIMATE:
        return this.estimateWithAI(context);
      default:
        throw new Error(`Unknown strategy: ${context.strategy}`);
    }
  }

  private calculateWeedingPrice(ctx: PricingContext): PriceEstimate {
    // Lógica consolidada de weedingPricing.ts
  }

  private calculatePhytosanitaryPrice(ctx: PricingContext): PriceEstimate {
    // Lógica consolidada de phytosanitaryPricing.ts
  }

  private async estimateWithAI(ctx: PricingContext): Promise<PriceEstimate> {
    // Lógica consolidada de aiPricingEstimator.ts
    // CON error handling explícito (no "inconclusive")
  }
}
```

**Fase 3: Tests + Deprecación (2h)**
```typescript
describe('PricingEngine', () => {
  it('should calculate weeding < 50m²', () => {
    const result = engine.estimatePrice({
      strategy: WEEDING,
      area: 30,
      serviceType: 'grass'
    });
    expect(result.price).toBe(50 + 30 * 2); // $110
  });

  it('should NOT return inconclusive on IA error', () => {
    // Mock OpenAI error
    // Expect fallback to rule-based OR explicit error
  });
});
```

**Bloqueo:** Rechaza PRs que añadan más funciones de precios hasta consolidar.

---

## 4. ALTO: Autenticación con Retry Frágil

### El Problema

```typescript
// En AuthContext.tsx
const restoreSession = async () => {
  for (let i = 0; i < 3; i++) {
    try {
      const session = await supabase.auth.getSession();
      if (session.data.session) return setAuthState(session.data.session);
    } catch (e) {
      if (i === 2) throw e;
      // ← NO exponential backoff, solo espera abierta
    }
  }
};
```

**Problemas:**
- Sin exponential backoff: si BD está lenta, hammering de requests
- Sin timeout: si getSession() tarda 30s × 3 = 90s app frozen
- Sin detectar tipo de error: reintenta en autenticación inválida

### Impacto en Negocio

| Escenario | Riesgo |
|-----------|--------|
| Surge de tráfico → Supabase lento → app se congela 90s | 😡 UX pésima |
| Token expirado → retry 3 veces innecesariamente | ⚠️ Logout forzado |
| Usuario "fantasma" si logout falla | 🔓 Sesión abierta |

### Plan de Remediación (1 día)

**Fase 1: Implementar Exponential Backoff (2h)**
```typescript
const withExponentialBackoff = async <T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 100
): Promise<T> => {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries - 1) throw error;
      
      // Don't retry on non-retriable errors
      if (isNonRetriableError(error)) throw error;
      
      const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 100;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
};

const restoreSession = async () => {
  return withExponentialBackoff(
    () => supabase.auth.getSession(),
    3,
    100
  );
};
```

**Fase 2: Agregar Timeouts (1h)**
```typescript
const withTimeout = <T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('Timeout')), timeoutMs)
    )
  ]);
};

const restoreSession = async () => {
  return withTimeout(
    withExponentialBackoff(async () => supabase.auth.getSession(), 3, 100),
    5000  // Max 5s total
  );
};
```

**Fase 3: Tests + Monitoring (1h)**
```typescript
describe('AuthContext retry logic', () => {
  it('should retry with exponential backoff', async () => {
    const times = [];
    const fn = () => {
      times.push(Date.now());
      if (times.length < 3) throw new Error('Fail');
      return 'success';
    };
    
    await withExponentialBackoff(fn, 3, 10);
    
    // Verify exponential: 10ms, ~20ms, ~40ms
    expect(times[1] - times[0]).toBeGreaterThan(10);
    expect(times[2] - times[1]).toBeGreaterThan(times[1] - times[0]);
  });
  
  it('should not retry on non-retriable errors', async () => {
    let attempts = 0;
    const fn = async () => {
      attempts++;
      throw new Error('Invalid credentials');
    };
    
    try {
      await withExponentialBackoff(fn, 3, 10, ['Invalid credentials']);
    } catch (e) {
      expect(attempts).toBe(1); // NO retry
    }
  });
});
```

**Bloqueo:** Rechaza cambios en AuthContext sin error handling explícito.

---

## 5. MEDIO: Validación de Imágenes Sin Tests

### El Problema

```typescript
// imageValidator.test.ts
// ← VACÍO, solo imports faltantes

// imageValidator.ts usa:
export const validateImage = async (file: Blob): Promise<boolean> => {
  // Validación MIME type
  // Validación tamaño
  // SIN tests
};

// En componentes:
if (await validateImage(file)) {
  // Subir a bucket
  // ← No hay guarantee de que file sea realmente imagen
}
```

### Impacto en Negocio

| Escenario | Riesgo |
|-----------|--------|
| Malware subido como imagen | 🔓 Breach |
| MIME type spoofing (exe renombrado a .jpg) | 💣 XSS/RCE |
| Imagen corrupta → IA no puede procesar | 😡 IA pricing falla |

### Plan de Remediación (4h)

```typescript
// imageValidator.test.ts - IMPLEMENTAR
describe('imageValidator', () => {
  it('should reject non-image files', async () => {
    const exeFile = new Blob(['fake exe'], { type: 'application/x-msdownload' });
    const result = await validateImage(exeFile);
    expect(result).toBe(false);
  });

  it('should reject images > 5MB', async () => {
    const largeBlob = new Blob([new ArrayBuffer(6 * 1024 * 1024)], { type: 'image/jpeg' });
    const result = await validateImage(largeBlob);
    expect(result).toBe(false);
  });

  it('should accept valid JPEG/PNG', async () => {
    // Create minimal valid JPEG
    const jpegBlob = createValidJpeg();
    const result = await validateImage(jpegBlob);
    expect(result).toBe(true);
  });

  it('should verify magic bytes, not just MIME type', async () => {
    // Create file with image/jpeg MIME but EXE magic bytes
    const spoofedBlob = new Blob([EXE_MAGIC_BYTES], { type: 'image/jpeg' });
    const result = await validateImage(spoofedBlob);
    expect(result).toBe(false);
  });
});
```

**Bloqueo:** No se sube a `booking-photos` bucket sin pasar tests de validación.

---

## 📊 Estado General: Escala de Criticidad

| Prioridad | Componente | Semanas | Bloqueante |
|-----------|-----------|---------|-----------|
| 🔴 CRÍTICO | RLS Audit | 1-2 | SÍ |
| 🔴 CRÍTICO | availability_blocks | 1 | SÍ |
| 🟡 ALTO | Consolidar precios | 2 | NO (pero recomendado) |
| 🟡 ALTO | Auth retry logic | 1-2 | NO (mejora UX) |
| 🟡 ALTO | Image validation tests | 1 | SÍ (seguridad) |
| 🟢 MEDIO | componentización compat | 2 | NO |

---

## 🚫 QUÉ NO HACER

❌ **NO añadas features de precios** sin consolidar los 5 existentes  
❌ **NO cambies RLS** sin auditoría documentada  
❌ **NO uses availability_blocks fallback** como solución final  
❌ **NO subas imágenes** sin tests de validación  
❌ **NO hagas "parches" en BD** sin migration  

---

**Última actualización:** 17 de abril de 2026  
**Mantenedor:** CTO | Revisión obligatoria antes de PRs arquitectónicos
