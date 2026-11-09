// Recargar la página siempre empieza arriba (2026-11-09).
//
// Al recargar, el navegador del móvil (Safari, también el que se abre desde un enlace del correo) devuelve
// la página al scroll que tenía. La web carga cada pantalla en diferido: el scroll se restaura cuando el
// contenido ya existe, DESPUÉS de que `ScrollToTop` haya subido arriba, y la pantalla se queda a medias,
// con su primera sección tapada por las barras fijas (la general y la de la pantalla). Navegando desde
// otra pantalla no pasa porque `ScrollToTop` sí actúa. Pasaba en todas las pantallas.
//
// Se desactiva la restauración del navegador: `ScrollToTop` es quien decide dónde empieza cada pantalla
// (arriba, o en el ancla `#…` si la dirección la trae).

export function disableBrowserScrollRestoration(): void {
  try {
    if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
  } catch {
    // Algunos navegadores embebidos lo prohíben: entonces se queda como estaba.
  }
}
