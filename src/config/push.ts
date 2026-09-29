// Clave pública VAPID de las notificaciones al móvil (F7). Es pública por diseño (va en el
// navegador de cada usuario); la privada vive solo en los secretos de las funciones de Supabase.
export const VAPID_PUBLIC_KEY: string =
  (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ||
  'BJ0Ccce8_nntJPrrBqXPIU4TMMW4le-EXNkkjHP0liTFGTWVqsgO2spTAQWgsewIcz7G-xKGaMESdxQYxd8MgDg';
