import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Star, MapPin, Leaf, Calendar } from 'lucide-react';

const GardenerPublicProfile: React.FC = () => {
  const { gardenerId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<any>(null);

  useEffect(() => {
    const loadProfile = async () => {
      setLoading(true);
      setError(null);
      try {
        if (!gardenerId) {
          setError('Identificador de jardinero no válido');
          return;
        }
        const { data, error } = await supabase
          .from('gardener_profiles')
          .select('user_id, full_name, avatar_url, rating, total_reviews, services, max_distance, description, is_available')
          .eq('user_id', gardenerId)
          .maybeSingle();

        if (error) throw error;
        if (!data) {
          setError('No se ha encontrado este perfil de jardinero');
          return;
        }
        setProfile(data);
      } catch (e: any) {
        setError(e?.message || 'Error cargando el perfil público');
      } finally {
        setLoading(false);
      }
    };
    loadProfile();
  }, [gardenerId]);

  const handleReserve = () => {
    if (!gardenerId) return;
    navigate('/reserva', { state: { restrictedGardenerId: gardenerId } });
  };

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <div className="bg-white rounded-2xl shadow p-8 text-center">Cargando perfil…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-amber-800">{error}</div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6">
      <div className="bg-white rounded-2xl shadow-xl p-6 sm:p-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-6">Perfil Público del Jardinero</h1>

        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
          <img
            src={profile?.avatar_url || ''}
            alt={profile?.full_name || 'Foto del jardinero'}
            className="w-32 h-32 sm:w-40 sm:h-40 rounded-full object-cover border-4 border-green-200"
          />
          <div className="flex-1">
            <h2 className="text-xl sm:text-2xl font-semibold text-gray-900">{profile?.full_name || 'Jardinero GarSer'}</h2>
            <div className="mt-2 flex items-center gap-3 text-sm text-gray-600">
              <span className="inline-flex items-center gap-1">
                <Star className="w-4 h-4 text-yellow-500" />
                {profile?.rating ?? 5.0} ({profile?.total_reviews ?? 0} reseñas)
              </span>
              <span className="inline-flex items-center gap-1">
                <MapPin className="w-4 h-4 text-green-600" />
                Radio de trabajo: {profile?.max_distance ?? 20} km
              </span>
            </div>
            {profile?.description && (
              <p className="mt-3 text-gray-700 text-sm">{profile.description}</p>
            )}
          </div>
        </div>

        <div className="mt-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-3">Servicios que ofrece</h3>
          <div className="flex flex-wrap gap-2">
            {(profile?.services || []).map((svc: string) => (
              <span key={svc} className="inline-flex items-center gap-1 px-3 py-1 bg-green-50 text-green-700 border border-green-200 rounded-full text-sm">
                <Leaf className="w-4 h-4" /> {svc}
              </span>
            ))}
            {(!profile?.services || profile.services.length === 0) && (
              <span className="text-gray-500 text-sm">Este jardinero aún no ha configurado sus servicios.</span>
            )}
          </div>
        </div>

        <div className="mt-8">
          <button
            onClick={handleReserve}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 font-semibold"
          >
            <Calendar className="w-5 h-5" /> Reservar con este jardinero
          </button>
          {!profile?.is_available && (
            <p className="mt-2 text-sm text-amber-700">Este jardinero actualmente no está disponible. Aun así, podrás ver fechas futuras si las configura.</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default GardenerPublicProfile;
