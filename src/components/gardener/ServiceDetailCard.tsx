/**
 * Reexportación: el componente vive ahora en `src/components/booking/ServiceDetailCard.tsx`
 * porque también lo usa el área de cliente (la pantalla de repetir un servicio), no solo las
 * dos pantallas del jardinero.
 *
 * Se mantiene esta ruta para no tocar `GardenerBookings` ni `BookingRequestsManager`, que
 * funcionan y no son parte de este cambio.
 */
export { default, describeServiceItem, type DetailRow } from '../booking/ServiceDetailCard';
