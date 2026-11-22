import React, { useEffect, useState } from 'react';
import { User } from 'lucide-react';

/** Hasta dos iniciales en mayúsculas («Rosa López QA» → «RL»). */
export const initialsOf = (name: string | null | undefined): string =>
  String(name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');

interface Props {
  url?: string | null;
  name?: string | null;
  /** Tamaño y forma (p. ej. «h-32 w-32 rounded-full border-4»). */
  className?: string;
  textClassName?: string;
}

/**
 * Foto de una persona o, si no hay (o no carga), sus iniciales. Antes un `<img src="">` pintaba el icono de
 * imagen rota con el nombre como texto alternativo (QA-023): cualquier profesional sin foto lo tenía.
 */
const ProfileAvatar: React.FC<Props> = ({ url, name, className = 'h-12 w-12', textClassName = 'text-lg' }) => {
  const clean = String(url ?? '').trim();
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [clean]);
  const initials = initialsOf(name);

  if (clean && !failed) {
    return <img src={clean} alt={name || 'Foto del profesional'} onError={() => setFailed(true)} className={`${className} rounded-full object-cover`} />;
  }
  return (
    <div className={`${className} flex shrink-0 items-center justify-center rounded-full bg-green-100 font-bold text-green-700 ${textClassName}`} aria-hidden={initials ? undefined : true}>
      {initials || <User className="h-1/2 w-1/2" aria-hidden="true" />}
    </div>
  );
};

export default ProfileAvatar;
