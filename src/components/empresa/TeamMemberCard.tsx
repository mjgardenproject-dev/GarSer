import React, { useMemo, useState } from 'react';
import { BadgeCheck, Loader2, Phone, ShieldAlert, UserMinus, Wrench } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { PHYTO_SERVICE_NAME, type TeamMember, type TeamService } from '../../hooks/useCompanyTeam';

// Una persona del equipo en el panel de la empresa (GarSer Empresas F3.3): sus servicios (D5),
// el estado de su carnet (D4), la baja, y para el titular el interruptor «Yo también trabajo»
// (D3). Todo lo decide el servidor; aquí solo se pide y se explica.

interface Props {
  member: TeamMember;
  offeredServices: TeamService[];
  onChanged: () => void;
  onAskDeactivate: (member: TeamMember) => void;
}

const LICENSE_LABEL: Record<string, string> = {
  approved: 'Carnet aprobado',
  pending: 'Carnet en revisión',
  rejected: 'Carnet rechazado',
  expired: 'Carnet caducado',
};

const TeamMemberCard: React.FC<Props> = ({ member, offeredServices, onChanged, onAskDeactivate }) => {
  const isOwner = member.role === 'owner';
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string[]>(member.services.map((s) => s.id));
  const [saving, setSaving] = useState(false);
  const [togglingWork, setTogglingWork] = useState(false);

  const offersPhyto = offeredServices.some((s) => s.name === PHYTO_SERVICE_NAME);
  const canHaveServices = !isOwner || member.counts_as_labour;
  const displayName = isOwner ? 'Tú (titular)' : member.full_name || member.email || 'Sin nombre';

  const dirty = useMemo(() => {
    const now = [...selected].sort().join(',');
    const before = member.services.map((s) => s.id).sort().join(',');
    return now !== before;
  }, [selected, member.services]);

  const toggle = (id: string) => setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const saveServices = async () => {
    setSaving(true);
    try {
      const { error } = await supabase.rpc('set_company_member_services', { p_member_id: member.member_id, p_service_ids: selected });
      if (error) throw error;
      toast.success('Servicios guardados');
      setEditing(false);
      onChanged();
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message || 'No se han podido guardar los servicios.');
    } finally {
      setSaving(false);
    }
  };

  const toggleWorks = async () => {
    setTogglingWork(true);
    try {
      const { error } = await supabase.rpc('set_company_owner_works', { p_works: !member.counts_as_labour });
      if (error) throw error;
      onChanged();
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message || 'No se ha podido cambiar.');
    } finally {
      setTogglingWork(false);
    }
  };

  return (
    <li className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold text-gray-900">{displayName}</p>
          {!isOwner && member.email && member.full_name && <p className="truncate text-sm text-gray-500">{member.email}</p>}
          {!isOwner && member.phone && (
            <a href={`tel:${member.phone}`} className="mt-0.5 inline-flex items-center gap-1 text-sm text-emerald-700">
              <Phone className="h-3.5 w-3.5" /> {member.phone}
            </a>
          )}
        </div>
        {offersPhyto && canHaveServices && (
          <span
            className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
              member.has_valid_phyto_license ? 'bg-emerald-50 text-emerald-800' : 'bg-gray-100 text-gray-600'
            }`}
          >
            {member.has_valid_phyto_license ? <BadgeCheck className="h-3.5 w-3.5" /> : <ShieldAlert className="h-3.5 w-3.5" />}
            {member.license_status ? LICENSE_LABEL[member.license_status] ?? 'Sin carnet' : 'Sin carnet'}
          </span>
        )}
      </div>

      {isOwner && (
        <label className="mt-3 flex cursor-pointer items-center justify-between gap-3 rounded-xl bg-gray-50 px-3 py-2.5">
          <span className="text-sm text-gray-700">
            <span className="font-medium text-gray-900">Yo también trabajo</span>
            <span className="block text-xs text-gray-500">Si trabajas, podrás asignarte servicios como a tu equipo.</span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={member.counts_as_labour}
            disabled={togglingWork}
            onClick={toggleWorks}
            className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50 ${member.counts_as_labour ? 'bg-emerald-700' : 'bg-gray-300'}`}
          >
            <span className={`absolute left-0 top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${member.counts_as_labour ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </button>
        </label>
      )}

      {canHaveServices && (
        <div className="mt-3">
          {!editing ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {member.services.length === 0 ? (
                <span className="text-sm text-gray-500">Sin servicios asignados</span>
              ) : (
                member.services.map((s) => (
                  <span key={s.id} className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800">{s.name}</span>
                ))
              )}
            </div>
          ) : (
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-medium text-gray-700">{isOwner ? '¿Qué servicios haces tú?' : '¿Qué servicios hace?'}</legend>
              {offeredServices.map((s) => {
                const needsLicense = s.name === PHYTO_SERVICE_NAME && !member.has_valid_phyto_license;
                const checked = selected.includes(s.id);
                return (
                  <label key={s.id} className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 ${needsLicense ? 'border-gray-100 bg-gray-50' : 'cursor-pointer border-gray-200 bg-white'}`}>
                    <input
                      type="checkbox"
                      className="mt-0.5 h-5 w-5 rounded text-emerald-700 disabled:opacity-40"
                      checked={checked}
                      disabled={needsLicense && !checked}
                      onChange={() => toggle(s.id)}
                    />
                    <span className="text-sm">
                      <span className={needsLicense ? 'text-gray-400' : 'text-gray-800'}>{s.name}</span>
                      {needsLicense && (
                        <span className="block text-xs text-gray-500">
                          {isOwner
                            ? 'Necesitas tu carnet fitosanitario aprobado. Súbelo en «Tu empresa».'
                            : 'Necesita su carnet fitosanitario aprobado. Lo sube desde su panel.'}
                        </span>
                      )}
                    </span>
                  </label>
                );
              })}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button type="button" onClick={() => { setSelected(member.services.map((s) => s.id)); setEditing(false); }} className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 font-bold text-gray-700 hover:bg-gray-50">
                  Cancelar
                </button>
                <button type="button" disabled={!dirty || saving} onClick={saveServices} className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 font-bold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />} Guardar
                </button>
              </div>
            </fieldset>
          )}
        </div>
      )}

      {!editing && (canHaveServices || !isOwner) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {canHaveServices && offeredServices.length > 0 && (
            <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
              <Wrench className="h-4 w-4" /> Servicios
            </button>
          )}
          {!isOwner && (
            <button type="button" onClick={() => onAskDeactivate(member)} className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50">
              <UserMinus className="h-4 w-4" /> Dar de baja
            </button>
          )}
        </div>
      )}
    </li>
  );
};

export default TeamMemberCard;
