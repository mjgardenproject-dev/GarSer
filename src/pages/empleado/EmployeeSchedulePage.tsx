import React from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import AvailabilityManager from '../../components/gardener/AvailabilityManager';
import { useAccount } from '../../contexts/AccountContext';

// Horario del empleado (/mi-trabajo/horario, GarSer Empresas F5.1). D22 (2026-09-28): lo pone el
// dueño de su empresa (/empresa/equipo/:memberId/horario); aquí el empleado lo VE, en solo lectura
// (el servidor tampoco le deja escribirlo). Sus horas ocupadas son las de SU agenda.

const EmployeeSchedulePage: React.FC = () => {
  const navigate = useNavigate();
  const { role, loading } = useAccount();
  if (loading) return null;
  if (role !== 'employee') return <Navigate to="/dashboard" replace />;
  return (
    <AvailabilityManager
      onBack={() => navigate('/mi-trabajo')}
      busyFrom="me"
      hideMinNotice
      readOnly
      readOnlyNote="Tu horario lo pone tu empresa. Si necesitas cambiar algún día u hora, díselo a tu empresa."
    />
  );
};

export default EmployeeSchedulePage;
