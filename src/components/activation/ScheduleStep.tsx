import React from 'react';
import { Plus, X } from 'lucide-react';
import {
  FIRST_HOUR,
  LAST_HOUR,
  NOTICE_CHOICES,
  SCHEDULE_TEMPLATES,
  WEEKS_CHOICES,
  WEEK_DAYS,
  copyMondayToWorkdays,
  weeklyHours,
  type TimeRange,
  type WeekRanges,
} from '../../activation/scheduleModel';

// Paso 3 del cuestionario: «¿Cuál es tu horario de trabajo?» (2026-11-11). Plantillas de un toque, tramos
// por día legibles («8:00 – 14:00», «+ Añadir tramo») y las dos reglas de la agenda en lenguaje llano.

const hourLabel = (h: number) => `${h}:00`;
const START_HOURS = Array.from({ length: LAST_HOUR - FIRST_HOUR }, (_, i) => FIRST_HOUR + i);
const END_HOURS = Array.from({ length: LAST_HOUR - FIRST_HOUR }, (_, i) => FIRST_HOUR + 1 + i);

const chip = (selected: boolean) =>
  `min-h-11 rounded-full border px-4 text-base font-semibold [touch-action:manipulation] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 ${
    selected ? 'border-emerald-700 bg-emerald-700 text-white' : 'border-gray-300 bg-white text-gray-800 hover:bg-gray-50'
  }`;

const selectClass =
  'min-h-11 rounded-xl border border-gray-300 bg-white px-3 text-base text-gray-900 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-600';

interface Props {
  week: WeekRanges;
  onWeekChange: (week: WeekRanges) => void;
  notice: number | null;
  onNoticeChange: (hours: number) => void;
  weeksAhead: number | null;
  onWeeksChange: (weeks: number) => void;
  problem: string;
  showProblem: boolean;
}

const ScheduleStep: React.FC<Props> = ({ week, onWeekChange, notice, onNoticeChange, weeksAhead, onWeeksChange, problem, showProblem }) => {
  const setDay = (day: number, ranges: TimeRange[]) => onWeekChange({ ...week, [day]: ranges });
  const total = weeklyHours(week);

  return (
    <div>
      <h1 className="text-2xl font-bold leading-tight text-gray-900">¿Cuál es tu horario de trabajo?</h1>
      <p className="mt-2 text-gray-700">Los clientes solo podrán reservarte en estas horas. Podrás cerrar días sueltos cuando quieras.</p>

      <p className="mt-5 text-sm font-semibold text-gray-800">Empieza con uno de estos:</p>
      <div className="mt-2 space-y-2">
        {SCHEDULE_TEMPLATES.map((template) => (
          <button
            key={template.id}
            type="button"
            onClick={() => onWeekChange(template.week())}
            className="flex min-h-12 w-full items-center rounded-2xl border-2 border-gray-200 bg-white px-4 py-2.5 text-left font-semibold text-gray-900 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 [touch-action:manipulation]"
          >
            {template.label}
          </button>
        ))}
      </div>

      <h2 className="mt-6 text-sm font-bold uppercase tracking-wide text-gray-500">Tu semana</h2>
      <ul className="mt-2 space-y-2">
        {WEEK_DAYS.map(({ value: day, label }) => {
          const ranges = week[day] ?? [];
          const working = ranges.length > 0;
          return (
            <li key={day} className="rounded-2xl border border-gray-200 bg-white p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold text-gray-900">{label}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={working}
                  aria-label={`${label}: ${working ? 'trabajo' : 'no trabajo'}`}
                  onClick={() => setDay(day, working ? [] : [{ start: 8, end: 14 }])}
                  className={`min-h-11 rounded-full px-4 text-sm font-bold [touch-action:manipulation] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 ${
                    working ? 'bg-emerald-700 text-white' : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  {working ? 'Trabajo' : 'No trabajo'}
                </button>
              </div>
              {working && (
                <div className="mt-2 space-y-2">
                  {ranges.map((range, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <label className="sr-only" htmlFor={`d${day}-r${index}-s`}>{`${label}, tramo ${index + 1}: desde`}</label>
                      <select
                        id={`d${day}-r${index}-s`}
                        value={range.start}
                        onChange={(e) => setDay(day, ranges.map((r, i) => (i === index ? { ...r, start: Number(e.target.value) } : r)))}
                        className={selectClass}
                      >
                        {START_HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
                      </select>
                      <span aria-hidden="true" className="text-gray-500">–</span>
                      <label className="sr-only" htmlFor={`d${day}-r${index}-e`}>{`${label}, tramo ${index + 1}: hasta`}</label>
                      <select
                        id={`d${day}-r${index}-e`}
                        value={range.end}
                        onChange={(e) => setDay(day, ranges.map((r, i) => (i === index ? { ...r, end: Number(e.target.value) } : r)))}
                        className={selectClass}
                      >
                        {END_HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
                      </select>
                      {ranges.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setDay(day, ranges.filter((_, i) => i !== index))}
                          aria-label={`Quitar el tramo ${index + 1} del ${label.toLowerCase()}`}
                          className="flex h-11 w-11 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                        >
                          <X className="h-5 w-5" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  ))}
                  {ranges.length < 3 && (
                    <button
                      type="button"
                      onClick={() => {
                        const last = ranges[ranges.length - 1];
                        const start = Math.min(Math.max(last.end + 2, FIRST_HOUR), LAST_HOUR - 1);
                        setDay(day, [...ranges, { start, end: Math.min(start + 3, LAST_HOUR) }]);
                      }}
                      className="inline-flex min-h-11 items-center gap-1 rounded text-sm font-semibold text-emerald-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 [touch-action:manipulation]"
                    >
                      <Plus className="h-4 w-4" aria-hidden="true" /> Añadir tramo (p. ej. la tarde)
                    </button>
                  )}
                  {day === 1 && (
                    <button
                      type="button"
                      onClick={() => onWeekChange(copyMondayToWorkdays(week))}
                      className="flex min-h-11 items-center rounded text-sm font-semibold text-emerald-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 [touch-action:manipulation]"
                    >
                      Copiar a martes-viernes
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <h2 id="activation-rules" className="mt-6 text-sm font-bold uppercase tracking-wide text-gray-500">Reglas de tu agenda</h2>
      <p className="mt-2 font-semibold text-gray-900">¿Con cuánta antelación necesitas que te reserven?</p>
      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Antelación mínima">
        {NOTICE_CHOICES.map((h) => (
          <button key={h} type="button" aria-pressed={notice === h} onClick={() => onNoticeChange(h)} className={chip(notice === h)}>
            {h} h
          </button>
        ))}
      </div>
      <p className="mt-4 font-semibold text-gray-900">¿Hasta cuántas semanas vista pueden reservarte?</p>
      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Semanas de agenda">
        {WEEKS_CHOICES.map((w) => (
          <button key={w} type="button" aria-pressed={weeksAhead === w} onClick={() => onWeeksChange(w)} className={chip(weeksAhead === w)}>
            {w} semanas
          </button>
        ))}
      </div>

      <p className="mt-5 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900" aria-live="polite">
        Abres <strong>{total} {total === 1 ? 'hora' : 'horas'} a la semana</strong>
        {weeksAhead ? <>, durante las próximas <strong>{weeksAhead} semanas</strong></> : null}.
      </p>
      {showProblem && problem && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {problem}
        </p>
      )}
    </div>
  );
};

export default ScheduleStep;
