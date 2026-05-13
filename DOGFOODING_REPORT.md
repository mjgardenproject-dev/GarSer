# Informe de Dogfooding: Configuración del Perfil del Jardinero

**Fecha:** 2026-05-10
**Rol Simulado:** Jardinero profesional no técnico configurando su negocio por primera vez.
**Objetivo:** Identificar fricciones, carga cognitiva y problemas de usabilidad en la página "Mi Perfil".

---

## 1. Hallazgos Críticos (Severidad Alta)

### ❌ Inconsistencia en el Modelo de Guardado
- **Problema:** Las secciones de "Información Personal" y "Cobertura" requieren clic manual en "Guardar", mientras que la configuración de servicios utiliza un sistema de auto-save (debounced).
- **Impacto:** El usuario se confunde sobre cuándo sus datos están seguros. Algunos pueden abandonar la página sin guardar lo personal, o buscar desesperadamente un botón de guardado en servicios que no existe.
- **Riesgo:** Pérdida de datos y frustración.

### ❌ Terminología Técnica y Abstracta
- **Problema:** El término **"Rendimiento"** es demasiado técnico/industrial.
- **Impacto:** Un jardinero autónomo piensa en "¿Cuánto tardo en podar esto?" o "¿Cuántas palmeras hago en una mañana?", no en "unidades por hora" como métrica de rendimiento.
- **Propuesta:** Cambiar a "¿Cuántas unidades haces por hora?" o "Velocidad de trabajo".

### ❌ Falta de Feedback en Auto-save
- **Problema:** Al cambiar un rendimiento o precio en el panel de servicios, no hay un indicador visual claro de "Guardando..." o "Guardado".
- **Impacto:** El usuario duda si el cambio se ha aplicado, especialmente con conexiones lentas.
- **Propuesta:** Añadir un pequeño check verde o texto "Sincronizado" cerca del input.

---

## 2. Experiencia de Usuario (Severidad Media)

### ⚠️ Desconexión entre Configuración y Simulador
- **Problema:** El simulador de precios está al final de una página muy larga.
- **Impacto:** Si cambio un rendimiento para ver cómo afecta al precio final, tengo que hacer scroll infinito hacia abajo.
- **Propuesta:** El simulador debería estar en un panel lateral persistente (drawer) o mostrar el "Precio estimado" en tiempo real dentro del mismo configurador del servicio.

### ⚠️ Carga Cognitiva por Monolitismo
- **Problema:** Toda la configuración (Personal, Cobertura, 7+ Servicios, Simulador) vive en una sola página con múltiples acordeones.
- **Impacto:** Sensación de "tarea interminable". El usuario se siente abrumado al ver tantos campos vacíos.
- **Propuesta:** Implementar la navegación por pestañas (Tabs) ya planificada en el spec de reestructuración UX.

### ⚠️ Errores Obstructivos (Toasts)
- **Problema:** Los errores de validación o red aparecen como toasts que bloquean la interacción con los elementos superiores.
- **Impacto:** Si hay un error persistente (ej. fallo de red), el usuario no puede cerrar el panel o corregir otros campos fácilmente.

---

## 3. Configuración de Precios y Lógica de Negocio

### 🔍 Poda de Palmeras/Árboles (Unidades)
- **Observación:** Se ha implementado correctamente la obligatoriedad de cobro por unidad.
- **Fricción:** El selector de especies es manual. Si el jardinero no añade especies, el simulador no funciona para palmeras, lo cual no es obvio al principio.
- **Propuesta:** Sugerir añadir las especies más comunes automáticamente al activar el servicio.

### 🔍 Rendimientos de Césped/Setos
- **Fricción:** El input numérico `UnifiedNumericInput` a veces no limpia correctamente el valor anterior al escribir rápido (visto en la simulación).
- **Propuesta:** Mejorar la gestión del foco y selección automática del texto al entrar en el input.

---

## 4. Usabilidad Móvil

- **Puntos Positivos:** Se han implementado vistas de tarjetas para los rendimientos en móvil, evitando el scroll horizontal de tablas.
- **Puntos Negativos:** Los inputs son pequeños para dedos grandes de un jardinero en el campo. Los márgenes entre servicios son escasos, provocando clics accidentales.

---

## 5. Plan de Acción Recomendado (Priorizado)

1.  **Prioridad 1 (Urgente):** Unificar el modelo de guardado a Auto-save en toda la página y añadir indicadores de estado (Saving/Saved).
2.  **Prioridad 2 (UX):** Migrar a la interfaz de pestañas (Tabs) para reducir la carga cognitiva.
3.  **Prioridad 3 (Negocio):** Simplificar el lenguaje (Rendimiento -> Velocidad) y añadir tooltips con ejemplos reales (ej: "Un seto de 10 metros suele tardar X...").
4.  **Prioridad 4 (Simulación):** Integrar un "Mini-Simulador" dentro de cada panel de servicio para feedback inmediato.

---

**Conclusión:** El sistema es técnicamente robusto pero UX-frágil. El jardinero siente que está rellenando un formulario de Hacienda en lugar de configurando su herramienta de trabajo. La reestructuración hacia un modelo de pestañas y auto-save es CRÍTICA para evitar el abandono en el onboarding.
