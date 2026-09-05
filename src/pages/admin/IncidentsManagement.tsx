import React from 'react';
import IncidentsQueue from '../../components/admin/IncidentsQueue';

/**
 * Sección propia del admin, no un bloque dentro de otra pantalla como las reseñas: aquí hay
 * dinero de por medio y una reserva congelada esperando, así que necesita visibilidad propia
 * (y el contador de abiertas en el menú), no competir por espacio con solicitudes o roles.
 */
const IncidentsManagement: React.FC = () => (
  <div className="space-y-8">
    <IncidentsQueue />
  </div>
);

export default IncidentsManagement;
