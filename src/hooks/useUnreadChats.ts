// Total de mensajes de chat sin leer del usuario, para el badge de navegación.
//
// Fuente: RPC chat_overview (la misma de la lista de chats). Se refresca cuando
// Realtime anuncia un mensaje nuevo o un cambio de cursor de lectura, con un
// pequeño debounce para no disparar una llamada por evento.
//
// R-01b: Navbar y BottomNav montan el hook a la vez. Antes cada una abría su propio canal, y al
// saltar a una página sin barras (el admin tras iniciar sesión) el canal se cerraba antes de
// conectar y el navegador lo avisaba en la consola. Ahora hay UN canal por usuario, compartido,
// que se cierra un momento después de que lo suelte el último (así un cambio de página rápido no
// lo abre y lo cierra), y el admin, que no tiene chats, no lo abre.

import { useState, useEffect } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { useAuth } from '../contexts/AuthContext';
import { useAccount } from '../contexts/AccountContext';
import { supabase } from '../lib/supabase';
import { fetchChatOverview } from '../utils/chatService';

type Listener = (count: number) => void;

const RELEASE_DELAY_MS = 2000;

const shared: {
  userId: string | null;
  channel: RealtimeChannel | null;
  listeners: Set<Listener>;
  count: number;
  debounce: ReturnType<typeof setTimeout> | null;
  release: ReturnType<typeof setTimeout> | null;
  generation: number;
} = { userId: null, channel: null, listeners: new Set(), count: 0, debounce: null, release: null, generation: 0 };

function notify(count: number) {
  shared.count = count;
  shared.listeners.forEach((listener) => listener(count));
}

function teardown() {
  if (shared.debounce) clearTimeout(shared.debounce);
  if (shared.release) clearTimeout(shared.release);
  shared.debounce = null;
  shared.release = null;
  if (shared.channel) supabase.removeChannel(shared.channel);
  shared.channel = null;
  shared.userId = null;
  shared.count = 0;
  shared.generation += 1;
}

async function refresh(generation: number) {
  const overview = await fetchChatOverview();
  if (generation !== shared.generation) return; // cambió el usuario o se cerró el canal
  notify(Object.values(overview).reduce((sum, row) => sum + (row.unread_count || 0), 0));
}

function open(userId: string) {
  teardown();
  shared.userId = userId;
  const generation = shared.generation;
  const scheduleRefresh = () => {
    if (shared.debounce) clearTimeout(shared.debounce);
    shared.debounce = setTimeout(() => { void refresh(generation); }, 400);
  };
  void refresh(generation);
  shared.channel = supabase
    .channel(`unread_badge_${userId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, scheduleRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_thread_reads' }, scheduleRefresh)
    .subscribe();
}

/** Se apunta al contador compartido de `userId`. Devuelve la función para soltarlo. */
export function subscribeUnreadChats(userId: string, listener: Listener): () => void {
  if (shared.release) { clearTimeout(shared.release); shared.release = null; }
  if (shared.userId !== userId || !shared.channel) open(userId);
  shared.listeners.add(listener);
  listener(shared.count);
  return () => {
    shared.listeners.delete(listener);
    if (shared.listeners.size === 0 && !shared.release) {
      shared.release = setTimeout(() => {
        shared.release = null;
        if (shared.listeners.size === 0) teardown();
      }, RELEASE_DELAY_MS);
    }
  };
}

export function useUnreadChats(): number {
  const { user } = useAuth();
  const { role, loading: roleLoading } = useAccount();
  const [unread, setUnread] = useState(0);
  // Sin tipo de cuenta aún no se abre nada; el admin no tiene chats.
  const userId = user?.id && !roleLoading && role && role !== 'admin' ? user.id : null;

  useEffect(() => {
    if (!userId) {
      setUnread(0);
      return;
    }
    return subscribeUnreadChats(userId, setUnread);
  }, [userId]);

  return unread;
}
