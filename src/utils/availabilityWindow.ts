// SSOT de la ventana horaria laboral del marketplace.
//
// Bloques de 1 hora. Los inicios de bloque seleccionables van de 7:00 a 19:00
// (el bloque "19:00" cubre 19:00–20:00). El fin de jornada es 20:00 (límite exclusivo).
//
// Antes existía un desfase: la config del jardinero y el buffer usaban 7:00–20:00,
// pero los slots que se ofrecían al cliente arrancaban a las 8:00, de modo que el
// bloque de las 7:00 (disponible para el jardinero) nunca se ofrecía en la reserva.
// Centralizamos la ventana aquí para que las tres capas usen exactamente los mismos límites.

export const WORK_DAY_START_HOUR = 7;
export const WORK_DAY_END_HOUR = 20; // exclusivo
export const LATEST_BLOCK_START_HOUR = WORK_DAY_END_HOUR - 1; // 19: último inicio de bloque válido
