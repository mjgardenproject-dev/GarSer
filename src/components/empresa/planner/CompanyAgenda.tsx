import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { addDays, format, parseISO, startOfWeek } from 'date-fns';
import { es } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Inbox, Loader2 } from 'lucide-react';
import {
  cellDate, hourLabel, isTeamJob, rangeLabel, useCompanySchedule, workersOfJob,
  type CompanySchedule, type ScheduleJob, type ScheduleMember,
} from '../../../hooks/useCompanySchedule';
import { describeJobShape } from '../../../utils/jobShape';
import JobSheet from './JobSheet';

// Planificador de la empresa (GarSer Empresas F6.2), móvil primero, en tres densidades:
// · Día: una fila por persona con sus horas (libre / trabajo / sin horario) y sus trabajos.
// · Semana: persona × día, con las horas de trabajo de cada uno; tocar una casilla abre ese día.
// · Lista: los próximos trabajos en orden, con quién va.
// Tocar un trabajo abre su hoja para repartirlo o cambiar quién va.

type Density = 'day' | 'week' | 'list';
const DAY_HOURS = Array.from({ length: 13 }, (_, i) => 7 + i); // 7:00 … 19:00 (hasta las 20:00)
const iso = (d: Date) => format(d, 'yyyy-MM-dd');
const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
// Como en el horario: con «EEEEE» martes y miércoles salían los dos como «M».
const WEEKDAY_LETTERS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

const Legend = () => (
  <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600">
    <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded-sm border border-emerald-300 bg-emerald-50" /> Libre</span>
    <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded-sm bg-emerald-700" /> Trabajo</span>
    <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded-sm bg-amber-400" /> Por aceptar</span>
    <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded-sm bg-gray-100" /> Sin horario</span>
  </div>
);

function useIndexes(data: CompanySchedule | null) {
  return useMemo(() => {
    const free = new Map<string, Set<number>>();
    (data?.free || []).forEach((f) => free.set(`${f.user_id}|${f.date}`, new Set(f.hours)));
    const busy = new Map<string, Map<number, ScheduleJob>>();
    // F7: cada hora trae su día (trabajos de varios días).
    (data?.jobs || []).forEach((job) => job.hours.forEach((cell) => {
      const { hour, worker_id } = cell;
      const key = `${worker_id}|${cellDate(job, cell)}`;
      const map = busy.get(key) || new Map<number, ScheduleJob>();
      map.set(hour, job);
      busy.set(key, map);
    }));
    return { free, busy };
  }, [data]);
}

const DayView: React.FC<{ date: string; data: CompanySchedule; members: ScheduleMember[]; onOpen: (job: ScheduleJob) => void }> = ({ date, data, members, onOpen }) => {
  const { free, busy } = useIndexes(data);
  return (
    <ul className="space-y-3">
      {members.map((m) => {
        const freeHours = free.get(`${m.user_id}|${date}`) || new Set<number>();
        const jobs = busy.get(`${m.user_id}|${date}`) || new Map<number, ScheduleJob>();
        const myJobs = [...new Set(jobs.values())].sort((a, b) => a.start_hour - b.start_hour);
        return (
          <li key={m.user_id} className="rounded-2xl border border-gray-200 bg-white p-3">
            <div className="flex items-baseline justify-between gap-2">
              <p className="min-w-0 break-words font-semibold text-gray-900">{m.name}{m.role === 'owner' ? ' (tú)' : ''}</p>
              <p className="shrink-0 text-xs text-gray-500">{jobs.size ? `${jobs.size} h de trabajo` : freeHours.size ? `${freeHours.size} h libres` : 'Sin horario'}</p>
            </div>
            <div className="mt-2 grid gap-0.5" style={{ gridTemplateColumns: `repeat(${DAY_HOURS.length}, minmax(0, 1fr))` }} aria-label={`Horas de ${m.name}`}>
              {DAY_HOURS.map((h) => {
                const job = jobs.get(h);
                const cls = job
                  ? job.status === 'pending' || job.assignment_pending ? 'bg-amber-400' : 'bg-emerald-700'
                  : freeHours.has(h) ? 'border border-emerald-300 bg-emerald-50' : 'bg-gray-100';
                return job ? (
                  <button key={h} type="button" onClick={() => onOpen(job)} className={`h-7 rounded-sm ${cls}`} aria-label={`${hourLabel(h)}: ${job.service}`} />
                ) : (
                  <span key={h} className={`h-7 rounded-sm ${cls}`} title={hourLabel(h)} />
                );
              })}
            </div>
            <div className="mt-0.5 flex justify-between text-[10px] text-gray-400"><span>7</span><span>10</span><span>13</span><span>16</span><span>20</span></div>
            {myJobs.length > 0 && (
              <ul className="mt-2 space-y-1">
                {myJobs.map((job) => {
                  const mine = job.hours.filter((x) => x.worker_id === m.user_id && cellDate(job, x) === date).map((x) => x.hour);
                  return (
                    <li key={job.booking_id}>
                      <button type="button" onClick={() => onOpen(job)} className="flex w-full items-center justify-between gap-2 rounded-lg bg-gray-50 px-2.5 py-2 text-left text-sm hover:bg-gray-100">
                        <span className="min-w-0"><span className="font-semibold text-gray-900">{rangeLabel(mine)}</span> · {job.service}{job.client_name ? ` · ${job.client_name}` : ''}</span>
                        {(job.status === 'pending' || job.assignment_pending) && <span className="shrink-0 text-xs font-semibold text-amber-700">{job.status === 'pending' ? 'Por aceptar' : 'Propuesta'}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
};

const WeekView: React.FC<{ days: string[]; data: CompanySchedule; members: ScheduleMember[]; onPickDay: (date: string) => void }> = ({ days, data, members, onPickDay }) => {
  const { free, busy } = useIndexes(data);
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-2">
      <div className="grid gap-1" style={{ gridTemplateColumns: 'minmax(0, 4.5rem) repeat(7, minmax(0, 1fr))' }}>
        <span />
        {days.map((d, i) => (
          <button key={d} type="button" onClick={() => onPickDay(d)} className="text-center text-[11px] font-semibold text-gray-600">
            {WEEKDAY_LETTERS[i]}<br />{format(parseISO(d), 'd')}
          </button>
        ))}
        {members.map((m) => (
          <React.Fragment key={m.user_id}>
            <span className="truncate self-center text-xs font-medium text-gray-800">{m.name.split(' ')[0]}</span>
            {days.map((d) => {
              const worked = busy.get(`${m.user_id}|${d}`)?.size || 0;
              const pending = [...(busy.get(`${m.user_id}|${d}`)?.values() || [])].some((j) => j.status === 'pending' || j.assignment_pending);
              const freeCount = free.get(`${m.user_id}|${d}`)?.size || 0;
              const cls = worked ? (pending ? 'bg-amber-400 text-amber-950' : 'bg-emerald-700 text-white') : freeCount ? 'border border-emerald-300 bg-emerald-50 text-emerald-800' : 'bg-gray-100 text-gray-400';
              return (
                <button key={d} type="button" onClick={() => onPickDay(d)} className={`flex h-10 items-center justify-center rounded-md text-xs font-semibold ${cls}`}
                  aria-label={`${m.name}, ${d}: ${worked} horas de trabajo, ${freeCount} libres`}>
                  {worked ? `${worked}h` : freeCount ? '·' : ''}
                </button>
              );
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};

const ListView: React.FC<{ data: CompanySchedule; members: ScheduleMember[]; onOpen: (job: ScheduleJob) => void }> = ({ data, members, onOpen }) => {
  const jobs = [...data.jobs].filter((j) => j.status !== 'completed').sort((a, b) => a.date.localeCompare(b.date) || a.start_hour - b.start_hour);
  const nameOf = (id: string) => members.find((m) => m.user_id === id)?.name.split(' ')[0] || '—';
  if (jobs.length === 0) return <p className="rounded-2xl border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-600">No hay trabajos en estos días.</p>;
  let lastDate = '';
  return (
    <ul className="space-y-2">
      {jobs.map((job) => {
        const header = job.date !== lastDate ? (lastDate = job.date) : null;
        return (
          <React.Fragment key={job.booking_id}>
            {header && <li className="px-1 pt-2 text-sm font-semibold text-gray-600">{capitalize(format(parseISO(job.date), "EEEE d 'de' MMMM", { locale: es }))}</li>}
            <li>
              <button type="button" onClick={() => onOpen(job)} className="w-full rounded-2xl border border-gray-200 bg-white p-3 text-left hover:bg-gray-50">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-gray-900">
                    {isTeamJob(job) && job.end_date
                      ? describeJobShape({ date: job.date, startHour: job.start_hour, durationHours: job.duration, endDate: job.end_date }).when
                      : `${hourLabel(job.start_hour)}–${hourLabel(job.start_hour + job.duration)}`} · {job.service}
                  </span>
                  {(job.status === 'pending' || job.assignment_pending) && <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">{job.status === 'pending' ? 'Por aceptar' : 'Propuesta'}</span>}
                </div>
                <p className="mt-0.5 text-sm text-gray-600">
                  {isTeamJob(job)
                    // F7: en equipo o en varios días, quién va (el detalle, en la hoja del trabajo).
                    ? `${workersOfJob(job).map((w) => nameOf(w.worker_id)).join(' y ')}${job.end_date ? '' : ' a la vez'}${job.labour_hours ? ` · ${job.labour_hours} h de trabajo` : ''}`
                    : workersOfJob(job).map((w) => `${nameOf(w.worker_id)}${job.duration > w.hours.length ? ` (${rangeLabel(w.hours)})` : ''}`).join(' · ')}
                  {job.client_name ? ` — ${job.client_name}` : ''}
                </p>
              </button>
            </li>
          </React.Fragment>
        );
      })}
    </ul>
  );
};

const CompanyAgenda: React.FC<{ pendingRequests: number | null }> = ({ pendingRequests }) => {
  const [density, setDensity] = useState<Density>('day');
  const [anchor, setAnchor] = useState(() => new Date());
  const [openJob, setOpenJob] = useState<ScheduleJob | null>(null);

  const weekStart = startOfWeek(anchor, { weekStartsOn: 1 });
  const days = Array.from({ length: 7 }, (_, i) => iso(addDays(weekStart, i)));
  const from = density === 'day' ? iso(anchor) : density === 'week' ? days[0] : iso(new Date());
  const to = density === 'day' ? iso(anchor) : density === 'week' ? days[6] : iso(addDays(new Date(), 13));
  const { data, loading, error, refresh } = useCompanySchedule(from, to);
  const members = (data?.members || []).filter((m) => m.works);

  const step = (dir: number) => setAnchor((d) => addDays(d, density === 'week' ? 7 * dir : dir));
  const title = density === 'day'
    ? capitalize(format(anchor, "EEEE d 'de' MMMM", { locale: es }))
    : density === 'week' ? `${format(parseISO(days[0]), 'd MMM', { locale: es })} – ${format(parseISO(days[6]), 'd MMM', { locale: es })}` : 'Próximos 14 días';

  return (
    <div className="space-y-3">
      {!!pendingRequests && (
        <Link to="/empresa/solicitudes" className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <Inbox className="h-5 w-5 shrink-0" />
          <span className="flex-1"><span className="font-semibold">{pendingRequests} {pendingRequests === 1 ? 'solicitud' : 'solicitudes'}</span> por aceptar</span>
          <ChevronRight className="h-4 w-4" />
        </Link>
      )}

      <div role="tablist" aria-label="Vista" className="grid grid-cols-3 gap-1 rounded-xl bg-gray-100 p-1">
        {([['day', 'Día'], ['week', 'Semana'], ['list', 'Lista']] as const).map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={density === key} onClick={() => setDensity(key)}
            className={`rounded-lg py-1.5 text-sm font-semibold ${density === key ? 'bg-white text-emerald-800 shadow-sm' : 'text-gray-600'}`}>{label}</button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2">
        {density !== 'list' ? (
          <button type="button" onClick={() => step(-1)} aria-label="Anterior" className="rounded-lg border border-gray-200 bg-white p-2"><ChevronLeft className="h-5 w-5" /></button>
        ) : <span className="w-9" />}
        <div className="text-center">
          <p className="font-semibold text-gray-900">{title}</p>
          {density !== 'list' && <button type="button" onClick={() => setAnchor(new Date())} className="text-xs font-semibold text-emerald-700">Hoy</button>}
        </div>
        {density !== 'list' ? (
          <button type="button" onClick={() => step(1)} aria-label="Siguiente" className="rounded-lg border border-gray-200 bg-white p-2"><ChevronRight className="h-5 w-5" /></button>
        ) : <span className="w-9" />}
      </div>

      {density !== 'list' && <Legend />}

      {loading && !data ? (
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-emerald-700" />
      ) : error ? (
        <p className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>
      ) : data && members.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-600">Aún no hay nadie en tu equipo que trabaje. Invita a alguien o activa «Yo también trabajo».</p>
      ) : data ? (
        density === 'day' ? <DayView date={from} data={data} members={members} onOpen={setOpenJob} />
          : density === 'week' ? <WeekView days={days} data={data} members={members} onPickDay={(d) => { setAnchor(parseISO(d)); setDensity('day'); }} />
            : <ListView data={data} members={data.members} onOpen={setOpenJob} />
      ) : null}

      {openJob && data && (
        <JobSheet job={openJob} members={data.members} onClose={() => setOpenJob(null)} onSaved={() => { setOpenJob(null); void refresh(); }} />
      )}
    </div>
  );
};

export default CompanyAgenda;
