import React, { useMemo } from 'react';
import { Eye } from 'lucide-react';
import { feeSplitCopy, gardenersFaqs, ownClientsLine } from '../../config/billingCopy';
import { termsFromRates } from '../../shared/billingTerms';
import type { CommissionRates } from '../../shared/commissionRules';

/**
 * «Lo que dirá la web»: los textos públicos que dependen de estas comisiones, calculados con los
 * mismos porcentajes que hay en el formulario. Usa EXACTAMENTE las funciones que pintan la web
 * (`config/billingCopy.ts`), así que lo que ves aquí es lo que leerá un visitante cuando guardes.
 */
const BillingCopyPreview: React.FC<{ rates: CommissionRates; unsaved: boolean }> = ({ rates, unsaved }) => {
  const copy = useMemo(() => {
    const terms = termsFromRates(rates);
    const faqs = gardenersFaqs(terms);
    return {
      split: feeSplitCopy(terms),
      panel: ownClientsLine(terms),
      ownAnswer: faqs[1],
      newAnswer: faqs[2],
    };
  }, [rates]);

  return (
    <section aria-labelledby="billing-copy-preview-title" className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h3 id="billing-copy-preview-title" className="flex items-center gap-2 text-sm font-semibold text-gray-900">
        <Eye className="h-4 w-4 text-emerald-700" aria-hidden="true" />
        Lo que dirá la web
      </h3>
      <p className="mt-1 text-xs text-gray-600">
        {unsaved
          ? 'Con los porcentajes que estás escribiendo (todavía sin guardar).'
          : 'Con los porcentajes guardados.'}{' '}
        Los textos se cambian solos al guardar; no hay que tocar nada más. Lo que se imprime o se descarga (flyers,
        tarjetas, QR, mensajes) no habla nunca de gastos de gestión.
      </p>

      <dl className="mt-3 space-y-3 text-sm">
        <div>
          <dt className="font-medium text-gray-700">Página para jardineros · título de «quién paga qué»</dt>
          <dd className="text-gray-900">{copy.split.title}</dd>
        </div>
        {copy.split.rows.map((row) => (
          <div key={row.id}>
            <dt className="font-medium text-gray-700">
              {row.label}
              {row.badge ? ` · «${row.badge}»` : ''}
            </dt>
            <dd className="text-gray-900">{row.result}</dd>
          </div>
        ))}
        <div>
          <dt className="font-medium text-gray-700">Cliente que trajo GarSer y vuelve con el mismo jardinero</dt>
          <dd className="text-gray-900">{copy.split.loyaltyNote ?? 'No se dice nada (se le cobra como en cualquier otra reserva).'}</dd>
        </div>
        <div>
          <dt className="font-medium text-gray-700">Panel del jardinero (enlace y Marketing)</dt>
          <dd className="text-gray-900">{copy.panel}</dd>
        </div>
        <div>
          <dt className="font-medium text-gray-700">{copy.ownAnswer.question}</dt>
          <dd className="text-gray-900">{copy.ownAnswer.answer}</dd>
        </div>
        <div>
          <dt className="font-medium text-gray-700">{copy.newAnswer.question}</dt>
          <dd className="text-gray-900">{copy.newAnswer.answer}</dd>
        </div>
      </dl>
    </section>
  );
};

export default BillingCopyPreview;
