import React from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import AvailabilityManager from '../../components/gardener/AvailabilityManager';
import { useAccount } from '../../contexts/AccountContext';

// Horario del empleado (/mi-trabajo/horario, GarSer Empresas F5.1). La MISMA pantalla que usa un
// autónomo (A-06: cada persona declara su disponibilidad); sus horas ocupadas son las de SU
// agenda, y la antelación mínima la decide su empresa.

const EmployeeSchedulePage: React.FC = () => {
  const navigate = useNavigate();
  const { role, loading } = useAccount();
  if (loading) return null;
  if (role !== 'employee') return <Navigate to="/dashboard" replace />;
  return <AvailabilityManager onBack={() => navigate('/mi-trabajo')} busyFrom="me" hideMinNotice />;
};

export default EmployeeSchedulePage;
