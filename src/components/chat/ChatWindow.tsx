import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Send, MessageCircle, X, ImagePlus } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { proposeBookingPriceChange, respondBookingPriceChange, PriceChangeStatus } from '../../utils/bookingPriceChangeService';
import { reportBookingEvent } from '../../utils/bookingTelemetry';

interface ChatMessage {
  id: string;
  booking_id: string;
  sender_id: string;
  message: string;
  image_url?: string | null;
  read_at?: string | null;
  read_by?: string | null;
  created_at: string;
  sender_name?: string;
}

interface ChatWindowProps {
  bookingId: string;
  isOpen: boolean;
  onClose: () => void;
  otherUserName: string;
}

type BookingChatMeta = {
  id: string;
  client_id: string;
  gardener_id: string;
  status: string;
  total_price: number;
  price_change_status?: PriceChangeStatus | null;
  proposed_total_price?: number | null;
  proposed_price_reason?: string | null;
  proposed_price_expires_at?: string | null;
  pricing_context?: {
    service_type?: string;
    allows_price_change?: boolean;
  } | null;
};

const ChatWindow: React.FC<ChatWindowProps> = ({ bookingId, isOpen, onClose, otherUserName }) => {
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [bookingMeta, setBookingMeta] = useState<BookingChatMeta | null>(null);
  const [proposalPrice, setProposalPrice] = useState('');
  const [proposalReason, setProposalReason] = useState('');
  const [priceActionLoading, setPriceActionLoading] = useState(false);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && bookingId) {
      fetchMessages();
      fetchBookingMeta();
      const unsubscribeMessages = subscribeToMessages();
      const unsubscribeBooking = subscribeToBookingMeta();
      return () => {
        unsubscribeMessages();
        unsubscribeBooking();
      };
    }
  }, [isOpen, bookingId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const fetchMessages = async () => {
    try {
      const { data, error } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('booking_id', bookingId)
        .order('created_at', { ascending: true });

      if (error) throw error;

      const msgs = (data || []) as ChatMessage[];
      const senderIds = Array.from(new Set(msgs.map(m => m.sender_id).filter(Boolean)));

      // Fetch sender names from profiles by user_id
      const namesMap = new Map<string, string>();
      if (senderIds.length > 0) {
        const { data: profiles, error: profError } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', senderIds);
        if (!profError && profiles) {
          profiles.forEach((p: any) => {
            if (p.id) namesMap.set(p.id, p.full_name);
          });
        }
      }

      const messagesWithNames = msgs.map(m => ({
        ...m,
        sender_name: namesMap.get(m.sender_id) || 'Usuario'
      }));

      setMessages(messagesWithNames);
      await markMessagesAsRead();
    } catch (error) {
      console.error('Error fetching messages:', error);
    }
  };

  const markMessagesAsRead = async () => {
    if (!user?.id) return;
    try {
      const { error } = await supabase
        .from('chat_messages')
        .update({
          read_at: new Date().toISOString(),
          read_by: user.id,
        })
        .eq('booking_id', bookingId)
        .neq('sender_id', user.id)
        .is('read_at', null);
      if (error) throw error;
    } catch (error) {
      console.warn('No se pudieron marcar mensajes como leídos:', error);
    }
  };

  const fetchBookingMeta = async () => {
    try {
      const { data, error } = await supabase
        .from('bookings')
        .select('id, client_id, gardener_id, status, total_price, price_change_status, proposed_total_price, proposed_price_reason, proposed_price_expires_at, pricing_context')
        .eq('id', bookingId)
        .single();
      if (error) throw error;
      setBookingMeta((data || null) as BookingChatMeta | null);
    } catch (error) {
      console.error('Error fetching booking chat meta:', error);
    }
  };

  const subscribeToMessages = () => {
    const subscription = supabase
      .channel(`chat_${bookingId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `booking_id=eq.${bookingId}`
        },
        async (payload: { new: ChatMessage }) => {
          const newMsg = payload.new;
          let senderName = 'Usuario';
          if (newMsg?.sender_id) {
            // Try to resolve sender name on-the-fly if not already known
            const { data: prof } = await supabase
              .from('profiles')
              .select('full_name')
              .eq('id', newMsg.sender_id)
              .maybeSingle();
            if (prof && (prof as any).full_name) senderName = (prof as any).full_name;
          }
          setMessages(prev => [...prev, { ...newMsg, sender_name: senderName }]);
          if (newMsg.sender_id !== user?.id) {
            await markMessagesAsRead();
          }
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  };

  const subscribeToBookingMeta = () => {
    const subscription = supabase
      .channel(`booking_meta_${bookingId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'bookings',
          filter: `id=eq.${bookingId}`
        },
        (payload: any) => {
          const updated = payload?.new as BookingChatMeta | undefined;
          if (!updated) return;
          setBookingMeta((prev) => ({
            ...(prev || { id: bookingId } as BookingChatMeta),
            ...updated,
          }));
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!newMessage.trim() && !selectedImage) || !user) return;

    setLoading(true);
    try {
      let imageUrl: string | null = null;
      if (selectedImage) {
        setUploadingImage(true);
        const bucket = (import.meta.env.VITE_CHAT_MEDIA_BUCKET as string | undefined) || 'booking-photos';
        const safeName = (selectedImage.name || 'chat_image.jpg').replace(/[^a-zA-Z0-9._-]/g, '_');
        const path = `chat/${bookingId}/${user.id}/${Date.now()}_${safeName}`;
        const { error: uploadError } = await supabase.storage
          .from(bucket)
          .upload(path, selectedImage, { upsert: true, contentType: selectedImage.type || 'image/jpeg' });
        if (uploadError) throw uploadError;
        const { data } = supabase.storage.from(bucket).getPublicUrl(path);
        imageUrl = data?.publicUrl || null;
      }

      const messageContent = newMessage.trim() || (imageUrl ? 'Imagen' : '');
      const { error } = await supabase
        .from('chat_messages')
        .insert([
          {
            booking_id: bookingId,
            sender_id: user.id,
            message: messageContent,
            image_url: imageUrl,
          }
        ]);

      if (error) throw error;

      setNewMessage('');
      setSelectedImage(null);
    } catch (error: any) {
      toast.error('Error al enviar mensaje');
      console.error('Error sending message:', error);
    } finally {
      setLoading(false);
      setUploadingImage(false);
    }
  };

  const submitPriceProposal = async () => {
    if (!user || !bookingMeta) return;
    const isPalmBooking = bookingMeta.pricing_context?.service_type === 'palm_pruning';
    const allowsPriceChange = !isPalmBooking || bookingMeta.pricing_context?.allows_price_change === true;
    if (!allowsPriceChange) {
      toast.error('Solo puedes proponer ajuste en palmeras del último rango abierto.');
      return;
    }
    const value = Number(proposalPrice);
    if (!(value > 0)) {
      toast.error('Introduce un precio válido');
      return;
    }
    setPriceActionLoading(true);
    try {
      await proposeBookingPriceChange({
        bookingId,
        proposedTotalPrice: value,
        reason: proposalReason,
        operationId: crypto.randomUUID(),
      });
      toast.success('Propuesta de precio enviada');
      setProposalPrice('');
      setProposalReason('');
      await fetchBookingMeta();
    } catch (error: any) {
      toast.error(error?.message || 'No se pudo proponer el nuevo precio');
    } finally {
      setPriceActionLoading(false);
    }
  };

  const respondToPriceProposal = async (accept: boolean) => {
    if (!user || !bookingMeta) return;
    setPriceActionLoading(true);
    try {
      await respondBookingPriceChange({
        bookingId,
        accept,
        operationId: crypto.randomUUID(),
      });
      reportBookingEvent('info', {
        event: 'booking.price_discrepancy_resolved',
        context: { bookingId, resolution: accept ? 'accepted' : 'rejected' },
      });
      toast.success(accept ? 'Nuevo precio aceptado' : 'Propuesta rechazada');
      await fetchBookingMeta();
    } catch (error: any) {
      toast.error(error?.message || 'No se pudo responder a la propuesta');
    } finally {
      setPriceActionLoading(false);
    }
  };

  if (!isOpen) return null;
  const isGardener = !!(user && bookingMeta && bookingMeta.gardener_id === user.id);
  const isClient = !!(user && bookingMeta && bookingMeta.client_id === user.id);
  const hasPendingPriceProposal = bookingMeta?.price_change_status === 'pending_client_acceptance';
  const canGardenerProposePrice = !!(
    isGardener &&
    bookingMeta?.status === 'pending' &&
    (bookingMeta?.pricing_context?.service_type !== 'palm_pruning' || bookingMeta?.pricing_context?.allows_price_change === true)
  );

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-none sm:rounded-2xl shadow-xl w-full max-w-md h-[100dvh] sm:h-[600px] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 pt-[calc(1rem+env(safe-area-inset-top))] border-b border-gray-200">
          <div className="flex items-center">
            <MessageCircle className="w-5 h-5 text-green-600 mr-2" />
            <h3 className="font-semibold text-gray-900">Chat con {otherUserName}</h3>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {hasPendingPriceProposal && bookingMeta && (
            <div className="p-3 rounded-lg border border-amber-200 bg-amber-50 text-amber-900">
              <p className="text-sm font-medium">
                Propuesta de precio pendiente: €{Number(bookingMeta.proposed_total_price || 0).toFixed(2)}
              </p>
              {bookingMeta.proposed_price_reason && (
                <p className="text-xs mt-1">{bookingMeta.proposed_price_reason}</p>
              )}
              {bookingMeta.proposed_price_expires_at && (
                <p className="text-xs mt-1">
                  Válida hasta {format(parseISO(bookingMeta.proposed_price_expires_at), 'dd/MM HH:mm', { locale: es })}
                </p>
              )}
            </div>
          )}

          {isGardener && bookingMeta?.status === 'pending' && (
            <div className="p-3 rounded-lg border border-blue-200 bg-blue-50">
              <p className="text-xs text-blue-800 mb-2">Proponer cambio de precio para esta reserva</p>
              {bookingMeta?.pricing_context?.service_type === 'palm_pruning' && bookingMeta?.pricing_context?.allows_price_change !== true && (
                <p className="text-xs text-amber-700 mb-2">
                  Cambio de precio no permitido: esta palmera no está en el último rango abierto de especie.
                </p>
              )}
              <div className="flex gap-2 mb-2">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={proposalPrice}
                  onChange={(e) => setProposalPrice(e.target.value)}
                  placeholder="Nuevo precio (€)"
                  className="flex-1 px-2 py-1.5 border border-blue-200 rounded-md text-sm"
                />
                <button
                  type="button"
                  onClick={submitPriceProposal}
                  disabled={priceActionLoading || !proposalPrice || !canGardenerProposePrice}
                  className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-60"
                >
                  Proponer
                </button>
              </div>
              <input
                type="text"
                value={proposalReason}
                onChange={(e) => setProposalReason(e.target.value)}
                placeholder="Motivo (opcional)"
                className="w-full px-2 py-1.5 border border-blue-200 rounded-md text-xs"
              />
            </div>
          )}

          {messages.length === 0 ? (
            <div className="text-center text-gray-500 py-8">
              <MessageCircle className="w-12 h-12 mx-auto mb-2 text-gray-300" />
              <p>No hay mensajes aún</p>
              <p className="text-sm">Inicia la conversación</p>
            </div>
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.sender_id === user?.id ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-xs px-4 py-2 rounded-lg ${
                    message.sender_id === user?.id
                      ? 'bg-green-600 text-white'
                      : 'bg-gray-100 text-gray-900'
                  }`}
                >
                  {message.image_url && (
                    <a href={message.image_url} target="_blank" rel="noreferrer">
                      <img src={message.image_url} alt="Adjunto chat" className="mb-2 max-h-40 rounded-md object-cover" loading="lazy" />
                    </a>
                  )}
                  <p className="text-sm">{message.message}</p>
                  <p
                    className={`text-xs mt-1 ${
                      message.sender_id === user?.id ? 'text-green-100' : 'text-gray-500'
                    }`}
                  >
                    {format(parseISO(message.created_at), 'HH:mm', { locale: es })}
                    {message.sender_id === user?.id && (
                      <span className="ml-2">
                        {message.read_at ? `Leído ${format(parseISO(message.read_at), 'HH:mm', { locale: es })}` : 'Enviado'}
                      </span>
                    )}
                  </p>
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Message Input */}
        <form onSubmit={sendMessage} className="p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] border-t border-gray-200">
          {selectedImage && (
            <div className="mb-2 text-xs text-gray-600">
              Imagen seleccionada: {selectedImage.name}
            </div>
          )}
          <div className="flex space-x-2">
            <label className="px-3 py-2 border border-gray-300 rounded-lg cursor-pointer text-gray-600 hover:bg-gray-50">
              <ImagePlus className="w-4 h-4" />
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => setSelectedImage(e.target.files?.[0] || null)}
              />
            </label>
            <input
          type="text"
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          placeholder="Escribe un mensaje..."
          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent text-base sm:text-sm"
          disabled={loading}
        />
            <button
              type="submit"
              disabled={loading || uploadingImage || (!newMessage.trim() && !selectedImage)}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ChatWindow;
