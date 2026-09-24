import React, { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { CheckCircle2, ChevronDown, Clock, Loader2, MapPin, Navigation, Phone, UserRound } from 'lucide-react';
import toast from 'react-hot-toast';
import ServiceDetailCard from '../gardener/ServiceDetailCard';
import { useConfirmDialog } from '../common/ConfirmDialog';
import { fetchBookingServiceDetails, type BookingServiceInput } from '../../utils/bookingServiceDetails';
import { markGardenerFinished } from '../../utils/bookingIncidentService';
import type { MyJob } from '../../hooks/useMyJobs';

// Un trabajo en el panel del empleado (GarSer Empresas F5.3): cuándo, dónde, qué hay que hacer y
// a quién llamar; y «He terminado» cuando ya ha empezado.

const hhmm = (t: string) => t.slice(0, 5);
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const endTime = (t: string, hours: number) => {
  const [h, m] = t.split(':').map(Number);
  return `${String(h + hours).padStart(2, '0')}:${String(m || 0).padStart(2, '0')}`;
};

const JobCard: React.FC<{ job: MyJob; showDate?: boolean; onChanged: () => void }> = ({ job, showDate, onChanged }) => {
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState<BookingServiceInput | null | undefined>(undefined);
  const [finishing, setFinishing] = useState(false);
  const { openConfirm, confirmDialog } = useConfirmDialog();

  const started = job.service_start ? Date.now() >= new Date(job.service_start).getTime() : false;
  const canFinish = job.status === 'confirmed' && !job.finished_at && started;
  const mapsUrl = job.client_address ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(job.client_address)}` : null;

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && details === undefined) {
      try {
        setDetails(await fetchBookingServiceDetails(job.booking_id));
      } catch {
        setDetails(null);
      }
    }
  };

  const askFinish = () =>
    openConfirm({
      title: '¿Has terminado este trabajo?',
      message: 'Avisaremos al cliente para que lo confirme.',
      confirmLabel: 'Sí, he terminado',
      tone: 'warning',
      onConfirm: async () => {
        setFinishing(true);
        try {
          await markGardenerFinished(job.booking_id);
          toast.success('Hecho. Avisamos al cliente.');
          onChanged();
        } catch (err: unknown) {
          toast.error((err as { message?: string })?.message || 'No se ha podido marcar.');
        } finally {
          setFinishing(false);
        }
      },
    });

  return (
    <li className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {showDate && (
            <p className="text-sm font-semibold text-emerald-800">{capitalize(format(parseISO(job.date), "EEEE d 'de' MMMM", { locale: es }))}</p>
          )}
          <p className="flex items-center gap-1.5 text-lg font-bold text-gray-900">
            <Clock className="h-5 w-5 shrink-0 text-emerald-700" />
            {hhmm(job.start_time)} – {endTime(job.start_time, job.duration_hours)}
          </p>
          <p className="mt-0.5 font-medium text-gray-800">{job.service_name}</p>
        </div>
        {job.finished_at ? (
          <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">Terminado</span>
        ) : job.status === 'pending' ? (
          <span className="shrink-0 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">Por confirmar</span>
        ) : null}
      </div>

      {job.client_address && (
        <p className="mt-3 flex items-start gap-1.5 text-sm text-gray-700">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
          <span className="break-words">{job.client_address}</span>
        </p>
      )}
      {job.client_name && (
        <p className="mt-1 flex items-center gap-1.5 text-sm text-gray-700">
          <UserRound className="h-4 w-4 shrink-0 text-gray-400" /> {job.client_name}
        </p>
      )}
      {job.status === 'pending' && (
        <p className="mt-2 text-xs text-gray-500">Tu empresa aún tiene que aceptar este trabajo.</p>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2">
        {mapsUrl && (
          <a href={mapsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50">
            <Navigation className="h-4 w-4" /> Cómo llegar
          </a>
        )}
        {job.client_phone && job.status !== 'pending' && (
          <a href={`tel:${job.client_phone}`} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50">
            <Phone className="h-4 w-4" /> Llamar
          </a>
        )}
      </div>

      {canFinish && (
        <button
          type="button"
          disabled={finishing}
          onClick={askFinish}
          className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          {finishing ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />} He terminado
        </button>
      )}

      <button type="button" onClick={() => void toggle()} aria-expanded={open} className="mt-3 flex w-full items-center justify-between text-sm font-semibold text-emerald-700">
        Qué hay que hacer <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-2">
          {details === undefined ? (
            <Loader2 className="mx-auto h-5 w-5 animate-spin text-gray-400" />
          ) : (
            <ServiceDetailCard durationHours={job.duration_hours} dataInputMode={details?.dataInputMode} serviceInput={details} />
          )}
          {job.notes && <p className="mt-2 rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-700">{job.notes}</p>}
        </div>
      )}
      {confirmDialog}
    </li>
  );
};

export default JobCard;
