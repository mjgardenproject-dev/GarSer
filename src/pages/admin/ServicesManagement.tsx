import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Service } from '../../types';
import { CheckCircle, XCircle, Briefcase, RefreshCw, AlertCircle, Clock } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../contexts/AuthContext';

interface AdminService extends Service {
  is_active: boolean;
  status: 'active' | 'review' | 'unavailable';
  required_by_services?: string[]; // Array of UUIDs
  last_modified_at?: string;
  last_modified_by_email?: string;
}

const ServicesManagement: React.FC = () => {
  const { user } = useAuth();
  const [services, setServices] = useState<AdminService[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchServices = async () => {
    setLoading(true);
    try {
      const { data: servicesData, error } = await supabase
        .from('services')
        .select('*')
        .order('name');
        
      if (error) throw error;
      
      // Fetch latest audit logs for each service to show last modified
      const { data: logsData, error: logsError } = await supabase
        .from('admin_audit_logs')
        .select('target_id, created_at, admin_id')
        .eq('target_table', 'services')
        .order('created_at', { ascending: false });

      let enrichedServices = servicesData as AdminService[];
      
      if (!logsError && logsData) {
        // Create a map for quick lookup of the most recent log per service
        const latestLogs = new Map();
        logsData.forEach((log: any) => {
          if (!latestLogs.has(log.target_id)) {
            latestLogs.set(log.target_id, log);
          }
        });

        // For simplicity, we just say "Admin" or if we had profiles we'd fetch them. 
        // We'll just show the date for now to meet the requirement.
        enrichedServices = enrichedServices.map(s => {
          const log = latestLogs.get(s.id);
          return {
            ...s,
            last_modified_at: log?.created_at
          };
        });
      }

      setServices(enrichedServices);
    } catch (e: any) {
      toast.error('Error al cargar los servicios: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchServices();
  }, []);

  const toggleServiceStatus = async (service: AdminService) => {
    // 1. Validaciones de dependencias ANTES de proceder
    if (service.is_active && service.required_by_services && service.required_by_services.length > 0) {
      // Find which services require this one and are CURRENTLY ACTIVE
      const activeDependents = services.filter(
        s => service.required_by_services?.includes(s.id) && s.is_active
      );

      if (activeDependents.length > 0) {
        const depNames = activeDependents.map(d => d.name).join(', ');
        toast.error(`No puedes desactivar este servicio porque los siguientes servicios activos dependen de él: ${depNames}`, {
          duration: 5000,
        });
        return;
      }
    }

    const newStatus = !service.is_active;
    
    // 2. Confirmación si estamos apagando un servicio crítico
    if (!newStatus) {
      const confirm = window.confirm(`¿Estás seguro de que deseas desactivar "${service.name}"? Dejará de estar disponible para futuras reservas.`);
      if (!confirm) return;
    }

    try {
      const { error } = await supabase
        .from('services')
        .update({ 
          is_active: newStatus,
          status: newStatus ? 'active' : 'unavailable'
        })
        .eq('id', service.id);

      if (error) throw error;
      
      // 3. Registrar en logs de auditoría
      if (user) {
        await supabase.from('admin_audit_logs').insert({
          admin_id: user.id,
          action_type: newStatus ? 'ACTIVATE_SERVICE' : 'DEACTIVATE_SERVICE',
          target_table: 'services',
          target_id: service.id,
          old_data: { is_active: service.is_active },
          new_data: { is_active: newStatus }
        });
      }

      toast.success(`Servicio ${newStatus ? 'activado' : 'desactivado'}`);
      fetchServices();
    } catch (e: any) {
      toast.error('Error al actualizar servicio');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Briefcase className="w-8 h-8 text-blue-600" />
          <h2 className="text-2xl font-bold text-gray-900">Gestión de Servicios</h2>
        </div>
        <button 
          onClick={fetchServices}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Actualizar
        </button>
      </div>

      <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded-md flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-yellow-600 shrink-0 mt-0.5" />
        <div>
          <h3 className="text-sm font-medium text-yellow-800">Acerca de la desactivación</h3>
          <p className="text-sm text-yellow-700 mt-1">
            Al desactivar un servicio, este desaparecerá del catálogo público y del formulario de reserva,
            pero las reservas históricas existentes no se verán afectadas (Soft Delete).
          </p>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="p-12 flex justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-6 py-4 font-semibold text-gray-600 text-sm">Servicio</th>
                  <th className="px-6 py-4 font-semibold text-gray-600 text-sm">Estado</th>
                  <th className="px-6 py-4 font-semibold text-gray-600 text-sm text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {services.map((service) => (
                  <tr key={service.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl" aria-hidden="true">{service.icon}</span>
                        <div>
                          <p className="font-medium text-gray-900">{service.name}</p>
                          <p className="text-xs text-gray-500 truncate max-w-xs">{service.description}</p>
                          {service.required_by_services && service.required_by_services.length > 0 && (
                            <p className="text-xs text-amber-600 mt-1 flex items-center gap-1 font-medium">
                              <AlertCircle className="w-3 h-3" />
                              Requerido por otros servicios
                            </p>
                          )}
                          {service.last_modified_at && (
                            <p className="text-[10px] text-gray-400 mt-1 flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              Última mod: {new Date(service.last_modified_at).toLocaleDateString()}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
                        service.is_active !== false 
                          ? 'bg-green-50 text-green-700 border-green-200'
                          : 'bg-red-50 text-red-700 border-red-200'
                      }`}>
                        {service.is_active !== false ? (
                          <><CheckCircle className="w-3.5 h-3.5" /> Activo</>
                        ) : (
                          <><XCircle className="w-3.5 h-3.5" /> Inactivo</>
                        )}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => toggleServiceStatus(service)}
                        className={`text-sm font-medium px-4 py-2 rounded-lg transition-colors border ${
                          service.is_active !== false
                            ? 'bg-white border-red-200 text-red-600 hover:bg-red-50'
                            : 'bg-white border-green-200 text-green-600 hover:bg-green-50'
                        }`}
                      >
                        {service.is_active !== false ? 'Desactivar' : 'Activar'}
                      </button>
                    </td>
                  </tr>
                ))}
                {services.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-6 py-8 text-center text-gray-500">
                      No hay servicios registrados.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default ServicesManagement;