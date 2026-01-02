import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Calendar, Clock, MapPin, MessageCircle, Star, Euro } from 'lucide-react';
import { Booking } from '../../types';
import { supabase } from '../../lib/supabase';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import ChatWindow from '../chat/ChatWindow';
import { } from 'react-router-dom';

interface BookingWithDetails extends Omit<Booking, 'services' | 'gardener_profile'> {
  services?: {
    name: string;
    icon?: string;
  } | null;
  gardener_profile?: {
    user_id: string;
    full_name: string;
    phone?: string;
  } | null;
}

const BookingsList = () => {
  const { user, loading: authLoading } = useAuth();
  const [bookings, setBookings] = useState<BookingWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedChat, setSelectedChat] = useState<{
    bookingId: string;
    gardenerName: string;
  } | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'confirmed' | 'completed' | 'cancelled'>('all');
  const [reviewTarget, setReviewTarget] = useState<BookingWithDetails | null>(null);
  const [existingReview, setExistingReview] = useState<{ id: string; rating: number; comment?: string } | null>(null);
  const [rating, setRating] = useState<number>(5);
  const [comment, setComment] = useState<string>('');
  const [submittingReview, setSubmittingReview] = useState(false);
  

  useEffect(() => {
    if (authLoading) return;
    if (!user?.id) return;
    fetchBookings();
  }, [user?.id, authLoading]);

  const fetchBookings = async () => {
    try {
      // Primero obtenemos las reservas básicas
      const { data: bookingsData, error: bookingsError } = await supabase
        .from('bookings')
        .select(`
          *,
          services(name, icon)
        `)
        .eq('client_id', user?.id)
        .order('date', { ascending: false });

      if (bookingsError) throw bookingsError;

      // Luego obtenemos los perfiles de los jardineros
      if (bookingsData && bookingsData.length > 0) {
        const gardenerIds = [...new Set(bookingsData.map((booking: any) => booking.gardener_id))];
        
        const { data: profilesData, error: profilesError } = await supabase
          .from('profiles')
          .select('id, full_name, phone')
          .in('id', gardenerIds);

        if (profilesError) throw profilesError;

        // Combinar los datos
        const bookingsWithProfiles = bookingsData.map((booking: any) => ({
          ...booking,
          gardener_profile: profilesData?.find((profile: any) => profile.id === booking.gardener_id) || null
        }));

        setBookings(bookingsWithProfiles);
      } else {
        setBookings([]);
      }
    } catch (error) {
      console.error('Error fetching bookings:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      case 'confirmed':
        return 'bg-blue-100 text-blue-800';
      case 'completed':
        return 'bg-gray-100 text-gray-800';
      case 'cancelled':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'pending':
        return 'Pendiente';
      case 'confirmed':
        return 'Confirmado';
      case 'in_progress':
        return 'Confirmado';
      case 'completed':
        return 'Completado';
      case 'cancelled':
        return 'Cancelado';
      default:
        return status;
    }
  };

  const openChat = (bookingId: string, gardenerName: string) => {
    setSelectedChat({ bookingId, gardenerName });
  };

  const openReview = async (booking: BookingWithDetails) => {
    setReviewTarget(booking);
    setExistingReview(null);
    setRating(5);
    setComment('');
    try {
      const { data } = await supabase
        .from('reviews')
        .select('id,rating,comment')
        .eq('booking_id', booking.id)
        .limit(1);
      if (data && data.length > 0) {
        setExistingReview({ id: data[0].id, rating: data[0].rating, comment: data[0].comment });
        setRating(data[0].rating);
        setComment(data[0].comment || '');
      }
    } catch {}
  };

  const submitReview = async () => {
    if (!reviewTarget || !user?.id) return;
    if (existingReview) { setReviewTarget(null); return; }
    try {
      setSubmittingReview(true);
      const { error: insertError } = await supabase
        .from('reviews')
        .insert({
          booking_id: reviewTarget.id,
          client_id: user.id,
          gardener_id: reviewTarget.gardener_id,
          rating,
          comment: comment || null,
        });
      if (insertError) throw insertError;

      const { data: ratingsData, error: ratingsError } = await supabase
        .from('reviews')
        .select('rating')
        .eq('gardener_id', reviewTarget.gardener_id);
      if (ratingsError) throw ratingsError;
      const ratings = (ratingsData || []).map((r: any) => r.rating);
      const count = ratings.length;
      const avg = count > 0 ? Math.round((ratings.reduce((a: number, b: number) => a + b, 0) / count) * 100) / 100 : 5;
      const { error: updError } = await supabase
        .from('gardener_profiles')
        .update({ rating: avg, total_reviews: count })
        .eq('user_id', reviewTarget.gardener_id);
      if (updError) throw updError;

      setReviewTarget(null);
      setExistingReview(null);
    } catch (e) {
      console.error('Error guardando reseña:', e);
    } finally {
      setSubmittingReview(false);
    }
  };

  

  

  const filteredBookings = statusFilter === 'all' ? bookings : bookings.filter(b => b.status === statusFilter);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6">
      <div className="bg-white rounded-2xl shadow-xl p-4 sm:p-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-6 sm:mb-8">Mis Reservas</h1>
        <div className="mb-4 flex items-center gap-2">
          <label className="text-sm text-gray-600">Estado</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="border border-gray-300 rounded-md px-3 py-2 text-base sm:text-sm"
          >
            <option value="all">Todos</option>
            <option value="pending">Pendiente</option>
            <option value="confirmed">Confirmado</option>
            <option value="completed">Completado</option>
            <option value="cancelled">Cancelado</option>
          </select>
        </div>

        {bookings.length === 0 ? (
          <div className="text-center py-12">
            <Calendar className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600 text-lg">No tienes reservas aún</p>
            <p className="text-gray-500">¡Explora nuestros servicios y haz tu primera reserva!</p>
          </div>
        ) : (
          <div className="space-y-6">
            {filteredBookings.map((booking) => (
              <div key={booking.id} className="border border-gray-200 rounded-xl p-6 hover:shadow-lg transition-shadow">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center space-x-4">
                    <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                      <Calendar className="w-6 h-6 text-green-600" />
                    </div>
                    <div>
                      <h3 className="text-xl font-semibold text-gray-900">
                        {booking.services?.name}
                      </h3>
                      <p className="text-gray-600">
                        Jardinero: {booking.gardener_profile?.full_name}
                      </p>
                    </div>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(booking.status)}`}>
                    {getStatusText(booking.status)}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                  <div className="flex items-center text-gray-600">
                    <Calendar className="w-4 h-4 mr-2" />
                    {format(parseISO(booking.date), 'EEEE, d MMMM yyyy', { locale: es })}
                  </div>
                  <div className="flex items-center text-gray-600">
                    <Clock className="w-4 h-4 mr-2" />
                    {booking.start_time} ({booking.duration_hours}h)
                  </div>
                  <div className="flex items-center text-gray-600">
                    <Euro className="w-4 h-4 mr-2" />
                    €{booking.total_price}
                  </div>
                </div>

                <div className="mb-4">
                  <div className="flex items-start text-gray-600">
                    <MapPin className="w-4 h-4 mr-2 mt-0.5" />
                    <span className="text-sm">{booking.client_address}</span>
                  </div>
                </div>

                {booking.notes && (
                  <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-600">
                      <strong>Notas:</strong> {booking.notes}
                    </p>
                  </div>
                )}

                <div className="flex items-center justify-between pt-4 border-t border-gray-100">
                  <div className="text-sm text-gray-500">
                    Reservado el {format(parseISO(booking.created_at), 'd MMM yyyy', { locale: es })}
                  </div>
                  <div className="flex space-x-2">
                    {booking.status === 'confirmed' && (
                      <button
                        onClick={() => openChat(booking.id, booking.gardener_profile?.full_name || 'Jardinero')}
                        className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                      >
                        <MessageCircle className="w-4 h-4 mr-2" />
                        Chat
                      </button>
                    )}
                    {booking.status === 'completed' && (
                      <button
                        onClick={() => openReview(booking)}
                        className="flex items-center px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition-colors"
                      >
                        <Star className="w-4 h-4 mr-2" />
                        Valorar
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Chat Window */}
      {selectedChat && (
        <ChatWindow
          bookingId={selectedChat.bookingId}
          isOpen={!!selectedChat}
          onClose={() => setSelectedChat(null)}
          otherUserName={selectedChat.gardenerName}
        />
      )}

      {reviewTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-[1000]">
          <div className="bg-white w-full sm:w-[480px] rounded-t-2xl sm:rounded-2xl p-6 shadow-xl max-h-[85vh] overflow-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Valorar servicio</h2>
              <button onClick={() => { setReviewTarget(null); setExistingReview(null); }} className="text-sm text-gray-500">Cerrar</button>
            </div>
            <div className="mb-3 text-sm text-gray-700">Jardinero: {reviewTarget.gardener_profile?.full_name}</div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Puntuación</label>
              <div className="flex items-center gap-1">
                {[1,2,3,4,5].map((n, idx) => {
                  const fullIndex = idx + 1;
                  const filled = Math.max(Math.min(rating - idx, 1), 0);
                  return (
                    <div key={fullIndex} className="relative w-8 h-8" aria-label={`Estrella ${fullIndex}`}>
                      <Star className="absolute inset-0 w-8 h-8 text-gray-300" />
                      <div className="absolute inset-0 overflow-hidden" style={{ width: `${filled*100}%` }}>
                        <Star className="w-8 h-8 text-yellow-500" />
                      </div>
                      <button
                        type="button"
                        onClick={() => !existingReview && setRating(fullIndex - 0.5)}
                        className="absolute left-0 top-0 h-full w-1/2"
                        aria-label={`${fullIndex - 0.5} estrellas`}
                      />
                      <button
                        type="button"
                        onClick={() => !existingReview && setRating(fullIndex)}
                        className="absolute right-0 top-0 h-full w-1/2"
                        aria-label={`${fullIndex} estrellas`}
                      />
                    </div>
                  );
                })}
                <span className="ml-2 text-sm text-gray-600">{rating.toFixed(1)} / 5</span>
              </div>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Comentario (opcional)</label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                disabled={!!existingReview}
                rows={3}
                className="w-full p-3 border border-gray-300 rounded-lg text-base sm:text-sm"
                placeholder="Cuéntanos tu experiencia"
              />
            </div>
            <div className="sticky bottom-0 bg-white flex items-center justify-end gap-2 pt-2 pb-3" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
              <button
                type="button"
                onClick={() => { setReviewTarget(null); setExistingReview(null); }}
                className="px-4 py-2 bg-gray-100 text-gray-800 rounded-lg hover:bg-gray-200"
              >
                Cancelar
              </button>
              <button
                onClick={submitReview}
                disabled={submittingReview || !!existingReview}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {existingReview ? 'Ya valorado' : (submittingReview ? 'Enviando…' : 'Enviar reseña')}
              </button>
            </div>
          </div>
        </div>
      )}

      
    </div>
  );
};

export default BookingsList;
