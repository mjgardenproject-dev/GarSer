import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Send, MessageCircle, X, ImagePlus, Euro, ChevronUp, WifiOff, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { format, parseISO, isToday, isYesterday, isSameDay } from 'date-fns';
import { es } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { proposeBookingPriceChange, respondBookingPriceChange, PriceChangeStatus } from '../../utils/bookingPriceChangeService';
import { reportBookingEvent } from '../../utils/bookingTelemetry';
import {
  ChatMessage,
  ChatParticipants,
  fetchMessagesPage,
  fetchParticipants,
  fetchPeerReadCursor,
  markThreadRead,
  sendChatMessage,
  subscribeToThread,
} from '../../utils/chatService';

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

// Separador de día entre mensajes ("Hoy", "Ayer", "12 de julio")
const dayLabel = (iso: string): string => {
  const d = parseISO(iso);
  if (isToday(d)) return 'Hoy';
  if (isYesterday(d)) return 'Ayer';
  return format(d, "d 'de' MMMM", { locale: es });
};

const ChatWindow: React.FC<ChatWindowProps> = ({ bookingId, isOpen, onClose, otherUserName }) => {
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [participants, setParticipants] = useState<ChatParticipants | null>(null);
  const [bookingMeta, setBookingMeta] = useState<BookingChatMeta | null>(null);
  const [peerReadAt, setPeerReadAt] = useState<string | null>(null);
  const [connected, setConnected] = useState(true);

  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const [showPricePanel, setShowPricePanel] = useState(false);
  const [proposalPrice, setProposalPrice] = useState('');
  const [proposalReason, setProposalReason] = useState('');
  const [priceActionLoading, setPriceActionLoading] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messageIdsRef = useRef<Set<string>>(new Set());

  const isGardener = !!(user && bookingMeta && bookingMeta.gardener_id === user.id);
  const isClient = !!(user && bookingMeta && bookingMeta.client_id === user.id);
  const peerId = user && bookingMeta
    ? (isGardener ? bookingMeta.client_id : bookingMeta.gardener_id)
    : null;
  // El callback de Realtime se crea antes de conocer al otro participante: ref para no capturar null
  const peerIdRef = useRef<string | null>(null);
  peerIdRef.current = peerId;

  const hasPendingPriceProposal = bookingMeta?.price_change_status === 'pending_client_acceptance';
  const canGardenerProposePrice = !!(
    isGardener &&
    bookingMeta?.status === 'pending' &&
    (bookingMeta?.pricing_context?.service_type !== 'palm_pruning' || bookingMeta?.pricing_context?.allows_price_change === true)
  );

  const scrollToBottom = useCallback((smooth = true) => {
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  // Añade mensajes deduplicando por id (fetch inicial + Realtime + optimistas pueden solaparse)
  const appendMessage = useCallback((incoming: ChatMessage) => {
    setMessages((prev) => {
      if (messageIdsRef.current.has(incoming.id)) return prev;
      messageIdsRef.current.add(incoming.id);
      // Si es la confirmación de un optimista nuestro, lo sustituye
      const withoutPending = prev.filter(
        (m) => !(m.pending && m.sender_id === incoming.sender_id && m.message === incoming.message)
      );
      return [...withoutPending, incoming];
    });
  }, []);

  const refreshBookingMeta = useCallback(async () => {
    const { data, error } = await supabase
      .from('bookings')
      .select('id, client_id, gardener_id, status, total_price, price_change_status, proposed_total_price, proposed_price_reason, proposed_price_expires_at, pricing_context')
      .eq('id', bookingId)
      .single();
    if (!error && data) setBookingMeta(data as BookingChatMeta);
  }, [bookingId]);

  const refreshPeerCursor = useCallback(async (peer: string | null) => {
    if (!peer) return;
    const cursor = await fetchPeerReadCursor(bookingId, peer);
    setPeerReadAt(cursor);
  }, [bookingId]);

  // Carga inicial + suscripciones
  useEffect(() => {
    if (!isOpen || !bookingId || !user?.id) return;
    let cancelled = false;
    messageIdsRef.current = new Set();

    (async () => {
      try {
        const [page, parts] = await Promise.all([
          fetchMessagesPage(bookingId),
          fetchParticipants(bookingId),
        ]);
        if (cancelled) return;
        page.messages.forEach((m) => messageIdsRef.current.add(m.id));
        setMessages(page.messages);
        setHasMore(page.hasMore);
        setParticipants(parts);
        await refreshBookingMeta();
        await markThreadRead(bookingId, user.id);
      } catch (error) {
        console.error('Error inicializando el chat:', error);
        toast.error('No se pudo cargar el chat');
      }
    })();

    const unsubscribeThread = subscribeToThread(bookingId, {
      onMessage: (msg) => {
        appendMessage(msg);
        if (msg.sender_id !== user.id) {
          // Estamos con el hilo abierto: lo leído se actualiza al momento
          markThreadRead(bookingId, user.id);
        }
      },
      onReadCursorChange: () => {
        const peer = peerIdRef.current;
        if (peer) refreshPeerCursor(peer);
      },
      onStatusChange: (ok) => setConnected(ok),
    });

    const bookingChannel = supabase
      .channel(`booking_meta_${bookingId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'bookings', filter: `id=eq.${bookingId}` },
        (payload: { new?: Partial<BookingChatMeta> }) => {
          if (payload?.new) {
            setBookingMeta((prev) => ({ ...(prev || ({ id: bookingId } as BookingChatMeta)), ...payload.new }));
          }
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      unsubscribeThread();
      supabase.removeChannel(bookingChannel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, bookingId, user?.id]);

  // Cursor del otro participante cuando ya conocemos quién es
  useEffect(() => {
    if (isOpen && peerId) refreshPeerCursor(peerId);
  }, [isOpen, peerId, refreshPeerCursor]);

  // Botón atrás del móvil: cierra el chat, no la página
  useEffect(() => {
    if (!isOpen) return;
    const state = { garserChat: bookingId };
    window.history.pushState(state, '');
    const onPopState = () => onClose();
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
      // Si el chat se cierra desde la X, consumimos la entrada que añadimos
      if (window.history.state?.garserChat === bookingId) {
        window.history.back();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, bookingId]);

  // Mantener el final visible al llegar mensajes y cuando el teclado cambia el viewport
  useEffect(() => {
    scrollToBottom(messages.length > 0);
  }, [messages.length, scrollToBottom]);

  useEffect(() => {
    if (!isOpen) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => scrollToBottom(false);
    vv.addEventListener('resize', onResize);
    return () => vv.removeEventListener('resize', onResize);
  }, [isOpen, scrollToBottom]);

  // Previsualización de la imagen seleccionada
  useEffect(() => {
    if (!selectedImage) {
      setImagePreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(selectedImage);
    setImagePreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [selectedImage]);

  const loadOlderMessages = async () => {
    if (loadingOlder || messages.length === 0) return;
    setLoadingOlder(true);
    try {
      const container = scrollContainerRef.current;
      const prevHeight = container?.scrollHeight || 0;
      const oldest = messages.find((m) => !m.pending);
      const page = await fetchMessagesPage(bookingId, oldest?.created_at);
      page.messages.forEach((m) => messageIdsRef.current.add(m.id));
      setMessages((prev) => [...page.messages, ...prev]);
      setHasMore(page.hasMore);
      // Mantener la posición de scroll tras insertar arriba
      requestAnimationFrame(() => {
        if (container) container.scrollTop = container.scrollHeight - prevHeight;
      });
    } catch {
      toast.error('No se pudieron cargar mensajes anteriores');
    } finally {
      setLoadingOlder(false);
    }
  };

  const autosizeTextarea = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 112)}px`;
  };

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = newMessage.trim();
    if ((!text && !selectedImage) || !user || sending) return;

    const image = selectedImage;
    const optimistic: ChatMessage = {
      id: `pending-${Date.now()}`,
      booking_id: bookingId,
      sender_id: user.id,
      message: text || (image ? 'Imagen' : ''),
      image_url: imagePreviewUrl,
      created_at: new Date().toISOString(),
      pending: true,
    };

    // Envío optimista: el mensaje aparece al instante y se reconcilia al confirmar
    setMessages((prev) => [...prev, optimistic]);
    setNewMessage('');
    setSelectedImage(null);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setSending(true);

    try {
      const saved = await sendChatMessage({ bookingId, senderId: user.id, text, imageFile: image });
      setMessages((prev) => prev.map((m) => (m.id === optimistic.id ? saved : m)));
      messageIdsRef.current.add(saved.id);
    } catch (error) {
      console.error('Error sending message:', error);
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setNewMessage(text);
      setSelectedImage(image || null);
      toast.error('No se pudo enviar el mensaje');
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const submitPriceProposal = async () => {
    if (!user || !bookingMeta) return;
    if (!canGardenerProposePrice) {
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
      setShowPricePanel(false);
      await refreshBookingMeta();
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
      await refreshBookingMeta();
    } catch (error: any) {
      toast.error(error?.message || 'No se pudo responder a la propuesta');
    } finally {
      setPriceActionLoading(false);
    }
  };

  const headerName = useMemo(() => {
    if (participants && peerId && participants.names[peerId]) return participants.names[peerId];
    return otherUserName;
  }, [participants, peerId, otherUserName]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-none sm:rounded-2xl shadow-xl w-full max-w-md h-[100dvh] sm:h-[600px] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 pt-[calc(0.75rem+env(safe-area-inset-top))] border-b border-gray-200">
          <div className="flex items-center min-w-0">
            <MessageCircle className="w-5 h-5 text-green-600 mr-2 shrink-0" />
            <h3 className="font-semibold text-gray-900 truncate">{headerName}</h3>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {canGardenerProposePrice && (
              <button
                onClick={() => setShowPricePanel((v) => !v)}
                className={`p-2 rounded-lg transition-colors ${showPricePanel ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:bg-gray-100'}`}
                aria-label="Proponer cambio de precio"
              >
                <Euro className="w-5 h-5" />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              aria-label="Cerrar chat"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {!connected && (
          <div className="flex items-center justify-center gap-2 py-1.5 bg-amber-50 border-b border-amber-200 text-amber-800 text-xs">
            <WifiOff className="w-3.5 h-3.5" />
            Reconectando…
          </div>
        )}

        {/* Propuesta de precio pendiente: fija bajo el header, con acciones para el cliente */}
        {hasPendingPriceProposal && bookingMeta && (
          <div className="px-4 py-3 border-b border-amber-200 bg-amber-50">
            <p className="text-sm font-medium text-amber-900">
              Propuesta de nuevo precio: €{Number(bookingMeta.proposed_total_price || 0).toFixed(2)}
            </p>
            {bookingMeta.proposed_price_reason && (
              <p className="text-xs text-amber-800 mt-0.5">{bookingMeta.proposed_price_reason}</p>
            )}
            {bookingMeta.proposed_price_expires_at && (
              <p className="text-xs text-amber-700 mt-0.5">
                Válida hasta {format(parseISO(bookingMeta.proposed_price_expires_at), 'dd/MM HH:mm', { locale: es })}
              </p>
            )}
            {isClient ? (
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => respondToPriceProposal(true)}
                  disabled={priceActionLoading}
                  className="flex-1 py-2.5 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700 disabled:opacity-60 transition-colors"
                >
                  Aceptar
                </button>
                <button
                  onClick={() => respondToPriceProposal(false)}
                  disabled={priceActionLoading}
                  className="flex-1 py-2.5 rounded-lg bg-white border border-amber-300 text-amber-900 text-sm font-semibold hover:bg-amber-100 disabled:opacity-60 transition-colors"
                >
                  Rechazar
                </button>
              </div>
            ) : (
              <p className="text-xs text-amber-700 mt-1.5">A la espera de la respuesta del cliente.</p>
            )}
          </div>
        )}

        {/* Panel del jardinero para proponer precio (desde el botón € del header) */}
        {showPricePanel && canGardenerProposePrice && (
          <div className="px-4 py-3 border-b border-blue-200 bg-blue-50">
            <p className="text-xs text-blue-800 mb-2 font-medium">Proponer cambio de precio</p>
            <div className="flex gap-2 mb-2">
              <input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={proposalPrice}
                onChange={(e) => setProposalPrice(e.target.value)}
                placeholder="Nuevo precio (€)"
                className="flex-1 min-w-0 px-3 py-2 border border-blue-200 rounded-lg text-base sm:text-sm"
              />
              <button
                type="button"
                onClick={submitPriceProposal}
                disabled={priceActionLoading || !proposalPrice}
                className="px-4 py-2 text-sm font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors"
              >
                {priceActionLoading ? '…' : 'Enviar'}
              </button>
            </div>
            <input
              type="text"
              value={proposalReason}
              onChange={(e) => setProposalReason(e.target.value)}
              placeholder="Motivo (opcional)"
              className="w-full px-3 py-2 border border-blue-200 rounded-lg text-base sm:text-sm"
            />
          </div>
        )}

        {/* Mensajes */}
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {hasMore && (
            <div className="flex justify-center pb-1">
              <button
                onClick={loadOlderMessages}
                disabled={loadingOlder}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-full transition-colors"
              >
                {loadingOlder ? <Loader2 className="w-3 h-3 animate-spin" /> : <ChevronUp className="w-3 h-3" />}
                Mensajes anteriores
              </button>
            </div>
          )}

          {messages.length === 0 ? (
            <div className="text-center text-gray-500 py-8">
              <MessageCircle className="w-12 h-12 mx-auto mb-2 text-gray-300" />
              <p>No hay mensajes aún</p>
              <p className="text-sm">Inicia la conversación</p>
            </div>
          ) : (
            messages.map((message, idx) => {
              const prev = messages[idx - 1];
              const showDay = !prev || !isSameDay(parseISO(prev.created_at), parseISO(message.created_at));
              const isOwn = message.sender_id === user?.id;
              const isRead = isOwn && !message.pending && peerReadAt != null && peerReadAt >= message.created_at;

              return (
                <React.Fragment key={message.id}>
                  {showDay && (
                    <div className="flex justify-center py-1">
                      <span className="px-3 py-0.5 rounded-full bg-gray-100 text-[11px] text-gray-500">
                        {dayLabel(message.created_at)}
                      </span>
                    </div>
                  )}
                  {message.message_type === 'system' ? (
                    <div className="flex justify-center">
                      <div className="max-w-[85%] px-3 py-1.5 rounded-2xl bg-gray-100 border border-gray-200 text-center">
                        <p className="text-xs text-gray-600 whitespace-pre-wrap">{message.message}</p>
                        <p className="text-[10px] text-gray-400 mt-0.5">
                          {format(parseISO(message.created_at), 'HH:mm', { locale: es })}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-[80%] px-3.5 py-2 rounded-2xl ${
                          isOwn
                            ? `bg-green-600 text-white rounded-br-md ${message.pending ? 'opacity-70' : ''}`
                            : 'bg-gray-100 text-gray-900 rounded-bl-md'
                        }`}
                      >
                        {message.image_url && (
                          <button
                            type="button"
                            onClick={() => setLightboxUrl(message.image_url!)}
                            className="block mb-1.5"
                          >
                            <img
                              src={message.image_url}
                              alt="Adjunto chat"
                              className="max-h-48 rounded-lg object-cover"
                              loading="lazy"
                            />
                          </button>
                        )}
                        {message.message && message.message !== 'Imagen' && (
                          <p className="text-sm whitespace-pre-wrap break-words">{message.message}</p>
                        )}
                        <p className={`text-[10px] mt-0.5 ${isOwn ? 'text-green-100' : 'text-gray-500'}`}>
                          {format(parseISO(message.created_at), 'HH:mm', { locale: es })}
                          {isOwn && (
                            <span className="ml-1.5">
                              {message.pending ? 'Enviando…' : isRead ? 'Leído' : 'Enviado'}
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                  )}
                </React.Fragment>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <form onSubmit={handleSend} className="px-3 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] border-t border-gray-200">
          {imagePreviewUrl && (
            <div className="relative inline-block mb-2">
              <img src={imagePreviewUrl} alt="Previsualización" className="h-20 rounded-lg object-cover border border-gray-200" />
              <button
                type="button"
                onClick={() => setSelectedImage(null)}
                className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-gray-800 text-white flex items-center justify-center"
                aria-label="Quitar imagen"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          <div className="flex items-end gap-2">
            <label className="p-2.5 border border-gray-300 rounded-xl cursor-pointer text-gray-600 hover:bg-gray-50 shrink-0">
              <ImagePlus className="w-5 h-5" />
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => setSelectedImage(e.target.files?.[0] || null)}
              />
            </label>
            <textarea
              ref={textareaRef}
              rows={1}
              value={newMessage}
              onChange={(e) => { setNewMessage(e.target.value); autosizeTextarea(); }}
              onKeyDown={handleKeyDown}
              placeholder="Escribe un mensaje…"
              className="flex-1 min-w-0 px-3.5 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-transparent text-base sm:text-sm resize-none leading-snug"
              disabled={sending}
            />
            <button
              type="submit"
              disabled={sending || (!newMessage.trim() && !selectedImage)}
              className="p-2.5 bg-green-600 text-white rounded-xl hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
              aria-label="Enviar mensaje"
            >
              {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            </button>
          </div>
        </form>
      </div>

      {/* Lightbox de imágenes */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            className="absolute top-[calc(1rem+env(safe-area-inset-top))] right-4 p-2 text-white/80 hover:text-white"
            aria-label="Cerrar imagen"
          >
            <X className="w-7 h-7" />
          </button>
          <img src={lightboxUrl} alt="Imagen del chat" className="max-w-full max-h-full object-contain rounded-lg" />
        </div>
      )}
    </div>
  );
};

export default ChatWindow;
