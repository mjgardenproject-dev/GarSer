import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, BadgeCheck, CalendarClock, Clock, Loader2, Phone, Send, ShieldAlert, Upload, UserMinus, Wrench, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { PHYTO_SERVICE_NAME, type TeamMember, type TeamService } from '../../hooks/useCompanyTeam';
import PhytosanitaryLicenseUpload from '../gardener/PhytosanitaryLicenseUpload';
import {
  agoLabel,
  canRequestLicense,
  canUpload,
  licenseStatusCopy,
  licenseView,
  requestIsCurrent,
  summaryFromTeamMember,
  type LicenseTone,
} from '../../shared/phytoLicense';

// Una persona del equipo en el panel de la empresa (GarSer Empresas F3.3): sus servicios (D5),
// el estado de su carnet (D4), la baja, y para el titular el interruptor «Yo también trabajo»
// (D3). Todo lo decide el servidor; aquí solo se pide y se explica.
//
// Carnet (2026-10-20): de cada empleado se ve el estado, la caducidad o el motivo del rechazo
// (nunca el documento). Se le puede pedir (le llega un aviso) o, con su permiso, enviarlo por él.

interface Props {
  member: TeamMember;
  offeredServices: TeamService[];
  /** La empresa hace tratamientos que piden carnet (fitosanitarios o desbroce con herbicida). */
  offersChemical?: boolean;
  onChanged: () => void;
  onAskDeactivate: (member: TeamMember) => void;
}

const LICENSE_ICON: Record<LicenseTone, React.ReactNode> = {
  ok: <BadgeCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" aria-hidden="true" />,
  info: <Clock className="mt-0.5 h-5 w-5 shrink-0 text-sky-700" aria-hidden="true" />,
  warn: <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden="true" />,
  bad: <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-700" aria-hidden="true" />,
  none: <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-gray-500" aria-hidden="true" />,
};

const LICENSE_LABEL: Record<string, string> = {
  approved: 'Carnet aprobado',
  pending: 'Carnet en revisión',
  rejected: 'Carnet rechazado',
  expired: 'Carnet caducado',
};

const TeamMemberCard: React.FC<Props> = ({ member, offeredServices, offersChemical, onChanged, onAskDeactivate }) => {
  const isOwner = member.role === 'owner';
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string[]>(member.services.map((s) => s.id));
  const [saving, setSaving] = useState(false);
  const [togglingWork, setTogglingWork] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  const offersPhyto = offeredServices.some((s) => s.name === PHYTO_SERVICE_NAME);
  const canHaveServices = !isOwner || member.counts_as_labour;
  const displayName = isOwner ? 'Tú (titular)' : member.full_name || member.email || 'Sin nombre';
  const personName = member.full_name || member.email || 'esta persona';
  const license = summaryFromTeamMember(member);
  const licenseCopy = licenseStatusCopy(license, 'company');
  const view = licenseView(license);
  const showLicense = !isOwner && member.status === 'active' && (Boolean(offersChemical) || offersPhyto || Boolean(member.license_status));
  const canSendForThem = canUpload(view) && view !== 'approved';
  const askable = view !== 'pending' && view !== 'renewal_pending' && view !== 'approved';
  const requestAllowed = canRequestLicense(license, member.license_requested_at);
  const requestedLabel = requestIsCurrent(license, member.license_requested_at) || view === 'none'
    ? (member.license_requested_at ? agoLabel(member.license_requested_at) : '')
    : '';

  useEffect(() => {
    if (!uploadOpen) return;
    sheetRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setUploadOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [uploadOpen]);

  const requestLicense = async () => {
    setRequesting(true);
    try {
      const { error } = await supabase.rpc('request_member_phyto_license', { p_member_id: member.member_id });
      if (error) throw error;
      toast.success(`Le hemos avisado a ${personName} por correo y en el móvil`);
      onChanged();
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message || 'No se ha podido enviar el aviso.');
    } finally {
      setRequesting(false);
    }
  };

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
    <li id={`member-${member.member_id}`} className="scroll-mt-24 rounded-2xl border border-gray-200 bg-white p-4">
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
        {isOwner && offersPhyto && canHaveServices && (
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

      {showLicense && (
        <div className="mt-3 rounded-xl border border-gray-100 bg-gray-50 p-3">
          <div className="flex items-start gap-2.5">
            {LICENSE_ICON[licenseCopy.tone]}
            <div className="min-w-0 text-sm">
              <p className="font-semibold text-gray-900">Carnet fitosanitario: {licenseCopy.title.charAt(0).toLowerCase() + licenseCopy.title.slice(1)}</p>
              <p className="mt-0.5 text-gray-600">{licenseCopy.detail}</p>
              {askable && requestedLabel && <p className="mt-1 text-xs text-gray-500">Se lo pediste {requestedLabel}.</p>}
            </div>
          </div>
          {(canSendForThem || askable) && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              {askable && (
                <button
                  type="button"
                  onClick={() => void requestLicense()}
                  disabled={!requestAllowed || requesting}
                  className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {requesting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
                  {requestAllowed ? 'Pedírselo' : 'Pedido'}
                </button>
              )}
              {canSendForThem && (
                <button
                  type="button"
                  onClick={() => setUploadOpen(true)}
                  className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-emerald-700 px-3 text-sm font-semibold text-white hover:bg-emerald-800"
                >
                  <Upload className="h-4 w-4" aria-hidden="true" /> Subir su carnet
                </button>
              )}
            </div>
          )}
        </div>
      )}

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
                            : 'Necesita su carnet fitosanitario aprobado: pídeselo o súbelo tú (abajo, en su ficha).'}
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
          {isOwner && member.counts_as_labour && (
            <Link to="/empresa/horario" className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
              <CalendarClock className="h-4 w-4" /> Mi horario
            </Link>
          )}
          {/* D22: el horario de cada empleado lo pone el dueño. */}
          {!isOwner && member.status === 'active' && (
            <Link to={`/empresa/equipo/${member.member_id}/horario`} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
              <CalendarClock className="h-4 w-4" /> Horario
            </Link>
          )}
          {!isOwner && (
            <button type="button" onClick={() => onAskDeactivate(member)} className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50">
              <UserMinus className="h-4 w-4" /> Dar de baja
            </button>
          )}
        </div>
      )}

      {uploadOpen && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center" role="presentation">
          <button type="button" aria-label="Cerrar" className="absolute inset-0 bg-black/40" onClick={() => setUploadOpen(false)} />
          <div
            ref={sheetRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`license-${member.member_id}`}
            className="relative max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-xl outline-none sm:max-w-md sm:rounded-2xl"
          >
            <div className="mb-1 flex items-start justify-between gap-3">
              <h2 id={`license-${member.member_id}`} className="text-lg font-bold text-gray-900">Carnet de {personName}</h2>
              <button type="button" onClick={() => setUploadOpen(false)} aria-label="Cerrar" className="-mr-2 -mt-1 flex h-11 w-11 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100">
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <p className="text-sm text-gray-600">Si tienes su carnet, puedes enviarlo tú. Le avisaremos de que lo has enviado y de lo que digamos al revisarlo.</p>
            <PhytosanitaryLicenseUpload
              bare
              forMember={{ memberId: member.member_id, userId: member.user_id, name: personName }}
              summary={license}
              onSubmitted={() => { setUploadOpen(false); onChanged(); }}
            />
          </div>
        </div>
      )}
    </li>
  );
};

export default TeamMemberCard;
