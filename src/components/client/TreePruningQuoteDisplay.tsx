// src/components/client/TreePruningQuoteDisplay.tsx

import React from 'react';
import { TreePruningQuote } from '../../types/treePruning';

interface Props {
  quote: TreePruningQuote;
}

const TreePruningQuoteDisplay: React.FC<Props> = ({ quote }) => {
  if (!quote.isProfessionalSuitable) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
        <h3 className="text-lg font-semibold text-red-800 mb-2">
          Profesional No Apto
        </h3>
        <p className="text-red-700">
          Uno o más árboles exceden las capacidades configuradas por el profesional.
          Seleccione otro profesional o contacte directamente.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white border rounded-lg p-6 space-y-6">
      {/* Precio Total */}
      <div className="text-center border-b pb-4">
        <h3 className="text-2xl font-bold text-green-600">
          Total: {quote.totalPrice.toFixed(2)}€
        </h3>
        <p className="text-gray-600">
          Precio estimado para {quote.perTreeQuotes.length} árbol{quote.perTreeQuotes.length !== 1 ? 'es' : ''}
        </p>
      </div>

      {/* Warnings Generales */}
      {quote.overallWarnings.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded p-4">
          <h4 className="font-semibold text-yellow-800 mb-2">Advertencias Generales</h4>
          <ul className="list-disc list-inside text-yellow-700 space-y-1">
            {quote.overallWarnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Desglose por Árbol */}
      <div className="space-y-4">
        <h4 className="text-lg font-semibold">Desglose por Árbol</h4>

        {quote.perTreeQuotes.map((treeQuote, index) => (
          <div key={treeQuote.zoneId} className="border rounded p-4 bg-gray-50">
            <div className="flex justify-between items-center mb-2">
              <h5 className="font-medium">Árbol {index + 1}</h5>
              <span className="text-lg font-semibold text-green-600">
                {treeQuote.finalPrice.toFixed(2)}€
              </span>
            </div>

            <div className="text-sm text-gray-600 space-y-1">
              <div>Precio base: {treeQuote.basePrice.toFixed(2)}€</div>
              {treeQuote.appliedDifficultyIncrease && (
                <div className="text-orange-600">
                  + Incremento por dificultad aplicada
                </div>
              )}
            </div>

            {/* Warnings específicos del árbol */}
            {treeQuote.warnings.length > 0 && (
              <div className="mt-3 bg-yellow-50 border border-yellow-200 rounded p-3">
                <div className="text-yellow-800 font-medium text-sm mb-1">
                  Advertencias para este árbol:
                </div>
                <ul className="list-disc list-inside text-yellow-700 text-sm space-y-1">
                  {treeQuote.warnings.map((warning, wIndex) => (
                    <li key={wIndex}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Información adicional */}
      <div className="text-center text-sm text-gray-500 border-t pt-4">
        <p>
          Este es un precio estimado basado en el análisis de las imágenes.
          El precio final puede variar según la evaluación in situ del profesional.
        </p>
      </div>
    </div>
  );
};

export default TreePruningQuoteDisplay;