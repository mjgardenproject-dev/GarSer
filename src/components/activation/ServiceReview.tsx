import React from 'react';
import { Clock, Euro } from 'lucide-react';
import {
  textOf,
  visibleFields,
  visibleQuestions,
  type Answers,
  type Question,
  type QuotePreview,
  type ServiceQuestionnaire,
} from '../../activation/pricingQuestions';
import { formatValue } from './QuestionScreen';

/** Filas del resumen: una por respuesta (en las pantallas con varios números, una por número). */
function summaryRows(question: Question, answers: Answers): Array<{ key: string; label: string; value: string }> {
  const title = textOf(question.title, answers);
  if (question.kind === 'choice') {
    return [{ key: question.id, label: title, value: question.options.find((o) => o.value === answers[question.id])?.label ?? '—' }];
  }
  if (question.kind === 'number') return [{ key: question.id, label: title, value: formatValue(question.unit, answers[question.id]) }];
  return visibleFields(question, answers).map((field) => ({
    key: field.id,
    label: `${title} · ${field.label}`,
    value: formatValue(field.unit, answers[field.id]),
  }));
}

// Último paso de cada servicio: lo respondido y, sobre todo, cómo le saldría a un cliente — calculado con
// el MISMO motor que cobra las reservas (cuestionario «Activa tu cuenta», 2026-11-11).

const euros = (value: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value);
const hours = (h: number) => (h === 1 ? '1 h' : `${h} h`);

interface Props {
  questionnaire: ServiceQuestionnaire;
  answers: Answers;
  previews: QuotePreview[];
  valid: boolean;
  onEdit: (questionIndex: number) => void;
}

const ServiceReview: React.FC<Props> = ({ questionnaire, answers, previews, valid, onEdit }) => {
  const questions = visibleQuestions(questionnaire, answers);
  return (
    <div>
      <p className="text-sm font-semibold text-emerald-800">{questionnaire.service} · resumen</p>
      <h1 className="mt-1 text-2xl font-bold leading-tight text-gray-900">Así le saldría a un cliente</h1>
      <p className="mt-2 text-gray-700">Calculado con tus respuestas, igual que en una reserva de verdad.</p>

      {valid && previews.length > 0 ? (
        <ul className="mt-4 space-y-2" aria-label="Ejemplos de presupuesto">
          {previews.map((preview) => (
            <li key={preview.label} className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="font-semibold text-gray-900">{preview.label}</p>
              <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-gray-800">
                <span className="inline-flex items-center gap-1 text-lg font-bold">
                  <Euro className="h-4 w-4 text-emerald-700" aria-hidden="true" /> {euros(preview.price)}
                </span>
                <span className="inline-flex items-center gap-1 text-sm">
                  <Clock className="h-4 w-4 text-emerald-700" aria-hidden="true" /> {hours(preview.agendaHours)} de tu agenda
                </span>
                {preview.isMinimum && <span className="text-sm text-gray-600">(se cobra tu mínimo)</span>}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p role="alert" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Falta algún dato para poder calcular un presupuesto. Revisa las respuestas de abajo.
        </p>
      )}

      <h2 className="mt-6 text-sm font-bold uppercase tracking-wide text-gray-500">Tus respuestas</h2>
      <ul className="mt-2 divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white">
        {questions.flatMap((question, index) =>
          summaryRows(question, answers).map((row) => (
            <li key={row.key} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <span className="min-w-0 text-sm text-gray-700">{row.label}</span>
              <button
                type="button"
                onClick={() => onEdit(index)}
                className="shrink-0 rounded-lg px-2 py-1 text-right text-sm font-bold text-emerald-800 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                aria-label={`Cambiar: ${row.label}`}
              >
                {row.value}
              </button>
            </li>
          )),
        )}
      </ul>
      <p className="mt-3 text-sm text-gray-600">Podrás cambiarlo cuando quieras en «Mi perfil → Servicios».</p>
    </div>
  );
};

export default ServiceReview;
