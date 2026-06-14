import React, { useEffect, useState } from 'react';
import { Users, Briefcase, Leaf, TrendingUp } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';

const AdminDashboard: React.FC = () => {
  const [data, setData] = useState({
    totalUsers: 0,
    activeServices: 0,
    pendingCertificates: 0,
    totalRevenue: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        setLoading(true);
        
        // Fetch total users
        const { count: usersCount, error: usersError } = await supabase
          .from('profiles')
          .select('*', { count: 'exact', head: true });
        
        if (usersError) throw usersError;

        // Fetch active services
        const { count: servicesCount, error: servicesError } = await supabase
          .from('services')
          .select('*', { count: 'exact', head: true })
          .eq('is_active', true);
        
        if (servicesError) throw servicesError;

        // Fetch pending certificates
        const { count: certsCount, error: certsError } = await supabase
          .from('gardener_licenses')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'pending');
        
        if (certsError) throw certsError;

        // Fetch completed bookings for revenue
        const { data: bookingsData, error: bookingsError } = await supabase
          .from('bookings')
          .select('total_price')
          .eq('status', 'completed');
        
        if (bookingsError) throw bookingsError;

        const revenue = (bookingsData || []).reduce((sum: number, booking: any) => sum + (Number(booking.total_price) || 0), 0);

        setData({
          totalUsers: usersCount || 0,
          activeServices: servicesCount || 0,
          pendingCertificates: certsCount || 0,
          totalRevenue: revenue,
        });

      } catch (error: any) {
        console.error('Error fetching dashboard data:', error);
        toast.error('Error al cargar datos del dashboard');
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, []);

  const formatNumber = (num: number) => new Intl.NumberFormat('es-ES').format(num);
  const formatCurrency = (num: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(num);

  const stats = [
    { title: 'Usuarios Totales', value: formatNumber(data.totalUsers), icon: Users, color: 'text-blue-500' },
    { title: 'Servicios Activos', value: formatNumber(data.activeServices), icon: Briefcase, color: 'text-purple-500' },
    { title: 'Certificados Pendientes', value: formatNumber(data.pendingCertificates), icon: Leaf, color: 'text-green-500' },
    { title: 'Ingresos Totales', value: formatCurrency(data.totalRevenue), icon: TrendingUp, color: 'text-emerald-500' },
  ];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard Administrativo</h1>
        <p className="text-gray-600 mt-1">Bienvenido al panel de control central.</p>
      </header>
      
      <div aria-live="polite">
        {loading ? (
          <div className="flex items-center justify-center p-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600" aria-hidden="true"></div>
            <span className="sr-only">Cargando datos del dashboard…</span>
          </div>
        ) : (
          <section aria-label="Estadísticas generales" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {stats.map((stat, i) => (
              <article key={i} className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center justify-between hover:shadow-md transition-shadow">
                <div>
                  <h2 className="text-sm font-medium text-gray-500 mb-1">{stat.title}</h2>
                  <p className="text-3xl font-bold text-gray-900" style={{ fontVariantNumeric: 'tabular-nums' }}>{stat.value}</p>
                </div>
                <div className={`p-4 bg-gray-50 rounded-full ${stat.color}`}>
                  <stat.icon className="w-8 h-8" aria-hidden="true" />
                </div>
              </article>
            ))}
          </section>
        )}
      </div>
    </div>
  );
};

export default AdminDashboard;