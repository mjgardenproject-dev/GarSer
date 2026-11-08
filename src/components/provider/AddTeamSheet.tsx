import React from 'react';
import { Check, Users } from 'lucide-react';
import BottomSheet from '../common/BottomSheet';
import InviteMemberCard from '../empresa/InviteMemberCard';

// «Añade a tu equipo» (2026-11-08, D31–D35): la hoja con la que un profesional individual invita a su
// primer compañero. Dice lo que cambia, lo que sigue igual y —solo la primera vez— pide la frase del
// seguro de responsabilidad civil. Tras enviar, deja claro que su cuenta NO cambia hasta que la
// persona acepte.

interface Props {
  open: boolean;
  onClose: () => void;
  /** Aún no hay empresa: la primera invitación pide confirmar el seguro (D35). */
  needsLiability: boolean;
  onInvited: () => void;
}

const CHANGES = [
  'Agenda por persona: ves quién hace cada trabajo y cuándo.',
  'Reparto de los trabajos entre tu equipo.',
  'El horario de cada uno.',
];
const STAYS = ['Tus servicios y precios', 'Tu enlace de reserva y tu perfil público', 'Tus reseñas y tus reservas'];

const AddTeamSheet: React.FC<Props> = ({ open, onClose, needsLiability, onInvited }) => (
  <BottomSheet
    open={open}
    onClose={onClose}
    title="Añade a tu equipo"
    description="Invita a tu primer compañero. Hasta que acepte, tu cuenta sigue como está."
  >
    <div className="space-y-4">
      <section aria-label="Qué cambia">
        <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-gray-500">
          <Users className="h-4 w-4" aria-hidden="true" /> Qué cambia
        </h3>
        <ul className="mt-1.5 space-y-1 text-sm text-gray-800">
          {CHANGES.map((line) => <li key={line}>· {line}</li>)}
        </ul>
      </section>

      <section aria-label="Qué sigue igual">
        <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-gray-500">
          <Check className="h-4 w-4" aria-hidden="true" /> Qué sigue igual
        </h3>
        <ul className="mt-1.5 space-y-1 text-sm text-gray-800">
          {STAYS.map((line) => <li key={line}>· {line}</li>)}
        </ul>
        <p className="mt-1.5 text-xs text-gray-500">Si algún día vuelves a trabajar solo, tu cuenta vuelve a ser la de siempre y no pierdes nada.</p>
      </section>

      <InviteMemberCard
        bare
        requireLiability={needsLiability}
        onInvited={onInvited}
        sentNote="Mientras no acepte, tu cuenta no cambia."
      />
    </div>
  </BottomSheet>
);

export default AddTeamSheet;
