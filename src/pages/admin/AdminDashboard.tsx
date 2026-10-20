import React, { useEffect, useState } from 'react';
import { Users, Briefcase, Leaf, TrendingUp, Wallet, BadgePercent, UserX } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import { formatEuro } from '../../shared/bookingAmounts';
import { buildAdminProviderEntries, type AdminProviderRow } from '../../components/admin/providerSetupEntries';

const AdminDashboard: React.FC = () => {
  const [data, setData] = useState({
    totalUsers: 0,
    activeServices: 0,
    pendingCertificates: 0,
    grossVolume: 0,
    platformRevenue: 0,
    feeWaivedBookings: 0,
  });
  const [loading, setLoading] = useState(true);
  // Profesionales aprobados que todavía no salen a ningún cliente (completar la cuenta profesional).
  // Aparte del resto: si falla, la tarjeta dice «—» y el dashboard sigue.
  const [providersHidden, setProvidersHidden] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await supabase.rpc('admin_provider_setup_overview');
      if (!alive || error) return;
      const entries = buildAdminProviderEntries((data ?? []) as unknown as AdminProviderRow[]);
      setProvidersHidden(entries.filter((entry) => entry.category === 'hidden').length);
    })();
    return () => { alive = false; };
  }, []);

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

        // Volumen transaccionado e ingresos reales de la plataforma. Son cifras distintas:
        // total_price lo cobra integro el jardinero en mano; GarSer solo ingresa management_fee.
        const { data: bookingsData, error: bookingsError } = await supabase
          .from('bookings')
          .select('total_price, management_fee, management_fee_source')
          .in('status', ['confirmed', 'completed']);

        if (bookingsError) throw bookingsError;

        const grossVolume = (bookingsData || []).reduce(
          (sum: number, booking: any) => sum + (Number(booking.total_price) || 0),
          0,
        );
        const platformRevenue = (bookingsData || []).reduce(
          (sum: number, booking: any) => sum + (Number(booking.management_fee) || 0),
          0,
        );

        // Lanzamiento (2026-10): reservas que fueron sin gastos de gestión (cliente del enlace,
        // cliente que repite o visita de un plan), para vigilar el alcance de la exención.
        const feeWaivedBookings = (bookingsData || []).filter(
          (booking: { management_fee_source?: string | null }) => String(booking.management_fee_source || '').startsWith('waived_'),
        ).length;

        setData({
          totalUsers: usersCount || 0,
          activeServices: servicesCount || 0,
          pendingCertificates: certsCount || 0,
          grossVolume,
          platformRevenue,
          feeWaivedBookings,
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

  const stats = [
    { title: 'Usuarios Totales', value: formatNumber(data.totalUsers), icon: Users, color: 'text-blue-500' },
    { title: 'Servicios Activos', value: formatNumber(data.activeServices), icon: Briefcase, color: 'text-purple-500' },
    { title: 'Certificados Pendientes', value: formatNumber(data.pendingCertificates), icon: Leaf, color: 'text-green-500' },
    { title: 'Volumen transaccionado', value: formatEuro(data.grossVolume), icon: TrendingUp, color: 'text-emerald-500' },
    { title: 'Ingresos GarSer', value: formatEuro(data.platformRevenue), icon: Wallet, color: 'text-amber-500' },
    { title: 'Reservas sin gastos de gestión', value: formatNumber(data.feeWaivedBookings), icon: BadgePercent, color: 'text-emerald-600' },
    { title: 'Profesionales sin aparecer', value: providersHidden === null ? '—' : formatNumber(providersHidden), icon: UserX, color: 'text-amber-600', to: '/admin/providers' },
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
          <section aria-label="Estadísticas generales" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
            {stats.map((stat, i) => {
              const card = (
                <article className="h-full bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center justify-between hover:shadow-md transition-shadow">
                  <div>
                    <h2 className="text-sm font-medium text-gray-500 mb-1">{stat.title}</h2>
                    <p className="text-3xl font-bold text-gray-900" style={{ fontVariantNumeric: 'tabular-nums' }}>{stat.value}</p>
                  </div>
                  <div className={`p-4 bg-gray-50 rounded-full ${stat.color}`}>
                    <stat.icon className="w-8 h-8" aria-hidden="true" />
                  </div>
                </article>
              );
              return 'to' in stat && stat.to ? (
                <Link key={i} to={stat.to} className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500">{card}</Link>
              ) : (
                <React.Fragment key={i}>{card}</React.Fragment>
              );
            })}
          </section>
        )}
      </div>
    </div>
  );
};

export default AdminDashboard;