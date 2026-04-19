# GarSer - Patrones y Convenciones de Arquitectura

**Objetivo:** Definir cómo escribir código que sea predecible, mantenible y escalable en GarSer.

---

## 🏗️ Arquitectura de Capas

GarSer sigue una arquitectura **frontend-heavy** (React) + **backend lightweight** (Supabase FaaS).

```
┌─────────────────────────────────────┐
│  PRESENTACIÓN (React + TypeScript)  │
│  - Componentes UI (TailwindCSS)     │
│  - Enrutamiento (React Router)      │
│  - Estados globales (Context API)   │
└────────────────┬────────────────────┘
                 │
┌────────────────▼────────────────────┐
│  LÓGICA DE NEGOCIO (Servicios)      │
│  - availabilityService.ts           │
│  - pricingEngine.ts                 │
│  - bookingBroadcastService.ts       │
│  - (Validaciones, cálculos)         │
└────────────────┬────────────────────┘
                 │
┌────────────────▼────────────────────┐
│  PERSISTENCIA (Supabase)            │
│  - PostgreSQL (RLS habilitado)      │
│  - Auth built-in                    │
│  - Storage (buckets)                │
│  - Edge Functions (IA)              │
└─────────────────────────────────────┘
```

**Flujo de datos:**
```
Usuario interactúa → Componente → Servicio → Supabase
                                     ↑
                            (Validación de reglas de negocio)
```

---

## 📦 Estructura de Directorios Explicada

### `src/components/`

**Regla:** Componentes organizados por ROL, no por tipo.

```
components/
├── auth/
│   ├── LoginForm.tsx      ← Todos pueden entrar
│   └── ProtectedRoute.tsx ← Validación de acceso
├── admin/
│   ├── AdminDashboard.tsx ← Solo role='admin'
│   └── UserManagement.tsx
├── gardener/
│   ├── GardenerBookings.tsx ← Solo role='gardener'
│   └── AvailabilityEditor.tsx
├── client/
│   ├── ServiceCatalog.tsx ← Solo role='client'
│   └── BookingHistory.tsx
├── booking/
│   ├── BookingForm.tsx    ← Compartido (múltiples roles)
│   └── BookingCard.tsx
├── common/
│   ├── ErrorBoundary.tsx  ← Utilities globales
│   ├── GoogleMapsDebug.tsx
│   └── LoadingSpinner.tsx
└── debug/
    ├── DevelopmentRoute.tsx   ← SOLO en DEV
    ├── RoleMonitor.tsx        ← SOLO en DEV
    └── DatabaseFix.tsx        ← SOLO en DEV
```

**Por qué por rol:**
- Claridad: qué componentes puede ver qué role
- Seguridad: menos riesgo de exponer funcionalidad admin en bundle client
- Colaboración: team gardening = trabaja en `gardener/`, no buscando archivos

### `src/utils/`

**Regla:** Cada dominio de negocio = un archivo de servicio + helper + test.

```
utils/
├── availabilityService.ts       ← Orquestación de availability
├── availabilityServiceCompat.ts ← DEPRECATED (remover)
├── availabilityHelpers.ts       ← Utilidades (calcular slots, etc)
├── availabilityService.test.ts  ← Tests de dominio
│
├── pricingEngine.ts             ← Estrategia de precios (CONSOLIDADO)
├── weedingPricing.ts            ← Lógica específica de desbroce
├── phytosanitaryPricing.ts      ← Lógica específica de fitosanitarios
├── phytosanitaryHelpers.ts      ← Helpers (plagas, urgencia)
├── weedingPricing.test.ts       ← Tests
│
├── bookingBroadcastService.ts   ← Real-time updates
├── bookingHelpers.ts            ← Validar fechas, estado, etc
│
├── geolocation.ts               ← Google Maps
├── imageValidator.ts            ← Validación de uploads
├── imageCompressor.ts           ← Optimización de imágenes
├── imageValidator.test.ts       ← Tests
│
├── aiPricingEstimator.ts        ← OpenAI/Gemini
├── bufferService.ts             ← Cálculo de distancias
└── ...
```

**Patrón:** `[domain].ts` + `[domain]Service.ts` + `[domain]Helpers.ts` + `[domain].test.ts`

### `src/contexts/`

**Regla:** SOLO contextos globales críticos. Props drilling para el resto.

```
contexts/
├── AuthContext.tsx      ← Sesión de usuario
│   ├── user
│   ├── profile
│   ├── role
│   └── isLoading
├── BookingContext.tsx   ← Estado de booking actual
│   ├── currentBooking
│   ├── selectedGardener
│   └── estimatedPrice
└── (Nada más aquí)
```

**NO crear:**
- ❌ `PricingContext.tsx` - usar `pricingEngine.ts` directamente
- ❌ `AvailabilityContext.tsx` - usar `availabilityService.ts`
- ❌ `UIContext.tsx` - usar useState local

**Por qué:** Cada contexto es overhead. La regla:
- Si > 3 componentes lo usan
- Y se actualiza frecuentemente (< 1s)
- ENTONCES → contexto

De lo contrario → props drilling es más claro.

### `src/types/`

```
types/
├── index.ts           ← Todas las interfaces centralizadas
```

**Regla:** Un archivo. No types esparcidos por archivos.

```typescript
// types/index.ts
export interface Profile {
  id: string;
  role: 'admin' | 'gardener' | 'client';
  email: string;
  phone?: string;
}

export interface GardenerProfile extends Profile {
  hourlyRate: number;
  services: ServiceType[];
  availability?: TimeSlot[];
}

export interface Booking {
  id: string;
  clientId: string;
  gardenerId: string;
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled';
  estimatedPrice: number;
}

// Enums centralizados
export enum ServiceType {
  WEEDING = 'weeding',
  PHYTOSANITARY = 'phytosanitary',
  PRUNING = 'pruning'
}

export enum BookingStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled'
}
```

**Por qué centralizado:**
- Una fuente de verdad
- Fácil encontrar todas las interfaces
- Evita importes circulares
- Fácil versionar API

### `src/lib/`

```
lib/
├── supabase.ts         ← Cliente Supabase configurado
├── googleMapsLoader.ts ← Google Maps API
└── (Solo configuraciones)
```

**Regla:** SOLO inicializaciones, no lógica.

---

## 🔐 Patrones de Seguridad

### 1. Route Protection (Frontend)

```typescript
// En App.tsx
import { ProtectedRoute } from './components/auth/ProtectedRoute';

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/admin"
        element={
          <ProtectedRoute allowedRoles={['admin']}>
            <AdminDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/debug"
        element={
          <DevelopmentRoute>
            <DebugPanel />
          </DevelopmentRoute>
        }
      />
    </Routes>
  );
}
```

**Componentes de protección:**

```typescript
// components/auth/ProtectedRoute.tsx
export const ProtectedRoute = ({ allowedRoles, children }) => {
  const { user, profile } = useAuth();
  
  if (!user) return <Redirect to="/login" />;
  if (!allowedRoles.includes(profile.role)) {
    console.warn('Access denied', { role: profile.role, allowedRoles });
    return <AccessDenied />;
  }
  
  return children;
};

// components/debug/DevelopmentRoute.tsx
export const DevelopmentRoute = ({ children }) => {
  const isDev = import.meta.env.DEV;
  const isLocalhost = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
  
  if (!isDev && !isLocalhost) {
    return <NotFound />;
  }
  
  return children;
};
```

### 2. Row Level Security (Backend)

**Patrón:** Cada tabla tiene políticas explícitas por role.

```sql
-- example: bookings table
CREATE POLICY "clients_read_own_bookings" 
  ON bookings FOR SELECT
  USING (auth.uid() = client_id AND role_from_jwt() = 'client');

CREATE POLICY "gardeners_read_assigned_bookings" 
  ON bookings FOR SELECT
  USING (auth.uid() = gardener_id AND role_from_jwt() = 'gardener');

CREATE POLICY "admins_read_all_bookings" 
  ON bookings FOR SELECT
  USING (role_from_jwt() = 'admin');
```

**Convención de nombres RLS:**
- `[role]_[action]_[resource]` en inglés
- NO usar caracteres españoles
- NO duplicar (buscar antes de CREATE POLICY)

---

## 🛠️ Patrones de Servicios

### Patrón 1: Service Simple (Sin Side Effects)

```typescript
// utils/weedingPricing.ts
export interface WeedingEstimate {
  area: number;
  basePrice: number;
  pricePerUnit: number;
  total: number;
}

export const calculateWeedingPrice = (
  area: number, // m²
  obstacles: 'none' | 'light' | 'heavy' = 'none'
): WeedingEstimate => {
  let basePrice = 0;
  let pricePerUnit = 0;
  
  if (area < 50) {
    basePrice = 50;
    pricePerUnit = 2;
  } else if (area < 200) {
    basePrice = 150;
    pricePerUnit = 1.5;
  } else {
    basePrice = 400;
    pricePerUnit = 1;
  }
  
  const total = basePrice + area * pricePerUnit;
  const multipliers = { none: 1, light: 1.25, heavy: 1.5 };
  
  return {
    area,
    basePrice,
    pricePerUnit,
    total: total * multipliers[obstacles]
  };
};

// Test
describe('weedingPricing', () => {
  it('should calculate < 50m²', () => {
    const result = calculateWeedingPrice(30);
    expect(result.total).toBe(50 + 30 * 2); // $110
  });
});
```

### Patrón 2: Service Async (BD + Lógica)

```typescript
// utils/availabilityService.ts
export const blockTimeSlot = async (
  gardenerId: string,
  startTime: Date,
  endTime: Date,
  reason: 'booked' | 'vacation' | 'maintenance'
) => {
  // Validar rango
  if (endTime <= startTime) {
    throw new Error('Invalid time range');
  }
  
  // Validar no overlap
  const { data: conflicts } = await supabase
    .from('availability_blocks')
    .select('*')
    .eq('gardener_id', gardenerId)
    .eq('is_available', false)
    .overlaps('start_time', 'end_time', [startTime.toISOString(), endTime.toISOString()]);
  
  if (conflicts?.length) {
    throw new Error('Time slot already blocked');
  }
  
  // Crear block
  const { data, error } = await supabase
    .from('availability_blocks')
    .insert({
      gardener_id: gardenerId,
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
      is_available: false,
      reason
    })
    .select();
  
  if (error) throw new Error(`DB error: ${error.message}`);
  return data[0];
};
```

**Convenciones:**
- ✅ Validar inputs antes de BD
- ✅ Usar transacciones si > 1 operación
- ✅ Error messages informativos ("Already blocked" no "Error")
- ❌ NO retornar null, lanzar Error
- ❌ NO console.log, usar señales de error

### Patrón 3: Service Orquestador (Strategy Pattern)

```typescript
// src/domain/pricingEngine.ts (FUTURO)
export class PricingEngine {
  private strategies: Map<PricingStrategy, PricingCalculator>;
  
  constructor() {
    this.strategies = new Map([
      [PricingStrategy.WEEDING, new WeedingCalculator()],
      [PricingStrategy.PHYTOSANITARY, new PhytosanitaryCalculator()],
      [PricingStrategy.AI_ESTIMATE, new AIEstimator()]
    ]);
  }
  
  async estimate(context: PricingContext): Promise<PriceEstimate> {
    const calculator = this.strategies.get(context.strategy);
    if (!calculator) {
      throw new Error(`Unknown strategy: ${context.strategy}`);
    }
    
    return calculator.calculate(context);
  }
}

// Uso
const engine = new PricingEngine();
const price = await engine.estimate({
  strategy: PricingStrategy.WEEDING,
  area: 150,
  obstacles: 'heavy'
});
```

---

## 📊 Patrones de Estado

### Patrón 1: Componente Local (useState)

```typescript
// Para estado que solo afecta este componente
const BookingForm = () => {
  const [formData, setFormData] = useState({
    service: '',
    date: new Date(),
    area: 0
  });
  
  const [validation, setValidation] = useState({
    serviceError: '',
    dateError: ''
  });
  
  return (
    <form>
      <select value={formData.service} onChange={...} />
      {validation.serviceError && <span>{validation.serviceError}</span>}
    </form>
  );
};
```

### Patrón 2: Context Global (AuthContext, BookingContext)

```typescript
// Para estado compartido entre múltiples componentes, rara
const { user, profile, role } = useAuth();
const { currentBooking, setBooking } = useBooking();
```

**Cuándo NO usar Context:**
- Estado muy frecuente (< 100ms cambios)
- Muchos subscribers (> 5 componentes)
- Use props drilling o Redux en ese caso

---

## 🧪 Patrones de Testing

### Convención: `[module].test.ts` colocado junto

```
utils/
├── weedingPricing.ts
├── weedingPricing.test.ts      ← Aquí
├── availabilityService.ts
└── availabilityService.test.ts ← Aquí
```

### Test Structure

```typescript
// weedingPricing.test.ts
import { describe, it, expect } from 'vitest';
import { calculateWeedingPrice } from './weedingPricing';

describe('weedingPricing', () => {
  describe('calculateWeedingPrice', () => {
    it('should calculate base price for small area < 50m²', () => {
      // ARRANGE
      const area = 30;
      const expectedTotal = 50 + 30 * 2; // $110
      
      // ACT
      const result = calculateWeedingPrice(area);
      
      // ASSERT
      expect(result.basePrice).toBe(50);
      expect(result.total).toBe(expectedTotal);
    });
    
    it('should apply obstacle multiplier', () => {
      const result = calculateWeedingPrice(100, 'heavy');
      const baseResult = calculateWeedingPrice(100, 'none');
      
      expect(result.total).toBe(baseResult.total * 1.5);
    });
  });
});
```

**Reglas:**
- ✅ Nombre describe = función/clase
- ✅ Nombre it = comportamiento testeable
- ✅ Estructura AAA (Arrange-Act-Assert)
- ✅ Un assert principal per test
- ❌ NO test unitario de UI (use Cypress/E2E)
- ❌ NO mocks complejos (indica diseño frágil)

---

## ⚠️ Anti-patrones (QUÉ NO HACER)

### ❌ Anti-patrón 1: Servicios que usan otros servicios sin documentación

```typescript
// MÁS
export const getBookingEstimate = async (booking) => {
  const priceEstimate = await pricingEngine.estimate(booking);
  const availabilityEstimate = await availabilityService.check(booking);
  return { priceEstimate, availabilityEstimate };
};
// ↑ OK si documenta el flujo
```

```typescript
// PEOR
export const calculatePrice = async (booking) => {
  // Internamente llama a 3 servicios sin documentar orden
  const aia = await aiEstimate(booking); // ¿por qué antes?
  const price = await weedingPrice(booking);
  return aia || price;
};
// ↑ CONFUSO: ¿por qué fallback a weeding si es palm?
```

### ❌ Anti-patrón 2: Componentes que acceden BD directamente

```typescript
// MALO
const BookingForm = () => {
  const [bookings, setBookings] = useState([]);
  
  useEffect(() => {
    // Acceso directo a BD en componente
    const { data } = await supabase.from('bookings').select();
    setBookings(data);
  }, []);
};

// BUENO
const BookingForm = () => {
  const bookings = useBookings(); // Hook que encapsula BD
};

// En un archivo bookingService.ts
export const useBookings = () => {
  const [bookings, setBookings] = useState([]);
  const [error, setError] = useState(null);
  
  useEffect(() => {
    // Lógica aquí
  }, []);
  
  return { bookings, error };
};
```

### ❌ Anti-patrón 3: Validación en componentes

```typescript
// MALO
const ServiceForm = () => {
  const handleSubmit = (e) => {
    if (!service) setError('Service required');
    if (area < 10) setError('Min 10m²');
    if (!date) setError('Date required');
    // ...16 más validaciones
  };
};

// BUENO - Usar librería: Zod o Yup
import { z } from 'zod';

const bookingSchema = z.object({
  service: z.enum(['weeding', 'phytosanitary']),
  area: z.number().min(10).max(5000),
  date: z.date().min(tomorrow)
});

const ServiceForm = () => {
  const { register, errors, handleSubmit } = useForm({
    resolver: zodResolver(bookingSchema)
  });
  
  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <input {...register('service')} />
      {errors.service && <span>{errors.service.message}</span>}
    </form>
  );
};
```

---

## 🔄 Flujo de Desarrollo Típico

```
1. User story llega (ej: "Jardinero debe bloquear disponibilidad")

2. Entender el problema
   - ¿Qué datos se necesitan?
   - ¿Qué reglas de negocio aplican?
   - ¿Qué existente puede romperse?

3. Planificar arquitectura
   - ¿Nueva tabla en BD? → Migration
   - ¿Nueva lógica de negocio? → Service
   - ¿Nueva UI? → Componente + protección de roles

4. Implementar en orden:
   a) BD schema (si es necesario)
   b) Service/lógica (testeable)
   c) Componente UI
   d) Tests

5. Validar
   - Tests pasan
   - RLS protege datos correctamente
   - No introduce deuda técnica
```

---

**Última actualización:** 17 de abril de 2026  
**Versión:** 1.0 (CTO Mode)
