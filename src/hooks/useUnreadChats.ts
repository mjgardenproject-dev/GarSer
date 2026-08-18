// Total de mensajes de chat sin leer del usuario, para el badge de navegación.
//
// Fuente: RPC chat_overview (la misma de la lista de chats). Se refresca cuando
// Realtime anuncia un mensaje nuevo o un cambio de cursor de lectura, con un
// pequeño debounce para no disparar una llamada por evento.

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { fetchChatOverview } from '../utils/chatService';

let instanceCounter = 0;

export function useUnreadChats(): number {
  const { user } = useAuth();
  const [unread, setUnread] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Navbar y BottomNav montan el hook a la vez: el topic debe ser único por instancia
  const instanceIdRef = useRef(++instanceCounter);

  useEffect(() => {
    if (!user?.id) {
      setUnread(0);
      return;
    }
    let cancelled = false;

    const refresh = async () => {
      const overview = await fetchChatOverview();
      if (cancelled) return;
      const total = Object.values(overview).reduce((sum, row) => sum + (row.unread_count || 0), 0);
      setUnread(total);
    };

    const scheduleRefresh = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(refresh, 400);
    };

    refresh();

    const channel = supabase
      .channel(`unread_badge_${user.id}_${instanceIdRef.current}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        scheduleRefresh
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'chat_thread_reads' },
        scheduleRefresh
      )
      .subscribe();

    return () => {
      cancelled = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  return unread;
}
