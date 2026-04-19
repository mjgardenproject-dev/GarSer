// src/components/client/TreePruningDetails.tsx

import React, { useState, useCallback } from 'react';
import { TreePruningZone, PruningServiceType } from '../../types/treePruning';
import { analyzeTreeImages } from '../../services/aiTreeAnalysisService';
import { calculateTreePruningQuote } from '../../domain/pricing/treePruningPricing';
import { TreePruningServiceConfig, AITreeAnalysisResult, TreePruningQuote } from '../../types/treePruning';

interface Props {
  serviceConfig: TreePruningServiceConfig;
  onQuoteCalculated: (quote: TreePruningQuote) => void;
}

interface TreeZone extends TreePruningZone {
  isAnalyzing: boolean;
  analysisResult?: AITreeAnalysisResult;
}

const TreePruningDetails: React.FC<Props> = ({ serviceConfig, onQuoteCalculated }) => {
  const [zones, setZones] = useState<TreeZone[]>([
    { id: crypto.randomUUID(), pruningType: 'estructural', photos: [], isAnalyzing: false }
  ]);
  const [isCalculating, setIsCalculating] = useState(false);

  const addZone = () => {
    setZones(prev => [...prev, {
      id: crypto.randomUUID(),
      pruningType: 'estructural',
      photos: [],
      isAnalyzing: false
    }]);
  };

  const removeZone = (zoneId: string) => {
    setZones(prev => prev.filter(z => z.id !== zoneId));
  };

  const updateZone = (zoneId: string, updates: Partial<TreeZone>) => {
    setZones(prev => prev.map(z =>
      z.id === zoneId ? { ...z, ...updates } : z
    ));
  };

  const handlePhotoUpload = (zoneId: string, files: FileList) => {
    const photos = Array.from(files);
    updateZone(zoneId, { photos });
  };

  const analyzeAllZones = useCallback(async () => {
    if (zones.some(z => z.photos.length === 0)) {
      alert('Todas las zonas deben tener al menos una foto.');
      return;
    }

    setIsCalculating(true);

    try {
      // Marcar todas las zonas como analizando
      setZones(prev => prev.map(z => ({ ...z, isAnalyzing: true })));

      // Análisis paralelo
      const analysisResults = await analyzeTreeImages(zones);

      // Actualizar zonas con resultados
      setZones(prev => prev.map(zone => {
        const result = analysisResults.find(r => r.zoneId === zone.id);
        return { ...zone, isAnalyzing: false, analysisResult: result };
      }));

      // Calcular cotización
      const quote = calculateTreePruningQuote(serviceConfig, zones, analysisResults);
      onQuoteCalculated(quote);

    } catch (error) {
      console.error('Error en análisis:', error);
      alert('Error al analizar las imágenes. Intente nuevamente.');
      setZones(prev => prev.map(z => ({ ...z, isAnalyzing: false })));
    } finally {
      setIsCalculating(false);
    }
  }, [zones, serviceConfig, onQuoteCalculated]);

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold">Detalles de Poda de Árboles</h2>
        <p className="text-gray-600 mt-2">
          Configure cada árbol individualmente. La IA analizará las fotos para estimar precios precisos.
        </p>
      </div>

      {/* Zonas (Árboles) */}
      <div className="space-y-6">
        {zones.map((zone, index) => (
          <div key={zone.id} className="border rounded-lg p-6 bg-gray-50">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">Árbol {index + 1}</h3>
              {zones.length > 1 && (
                <button
                  onClick={() => removeZone(zone.id)}
                  className="text-red-500 hover:text-red-700"
                >
                  Eliminar
                </button>
              )}
            </div>

            {/* Tipo de Poda */}
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">Tipo de Poda</label>
              <select
                value={zone.pruningType}
                onChange={(e) => updateZone(zone.id, { pruningType: e.target.value as PruningServiceType })}
                className="w-full p-2 border rounded"
              >
                <option value="estructural">Estructural</option>
                <option value="formacion">De formación</option>
              </select>

              {/* Explicación concisa */}
              <div className="mt-2 text-sm text-gray-600">
                {zone.pruningType === 'estructural' ? (
                  <div>
                    <strong>Estructural:</strong> Mantiene la salud y estructura del árbol,
                    elimina ramas muertas o enfermas.
                  </div>
                ) : (
                  <div>
                    <strong>De formación:</strong> Da forma al árbol y guía su crecimiento,
                    ideal para árboles jóvenes.
                  </div>
                )}
              </div>
            </div>

            {/* Fotos */}
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">
                Fotos del Árbol
              </label>
              <input
                type="file"
                multiple
                accept="image/*"
                onChange={(e) => e.target.files && handlePhotoUpload(zone.id, e.target.files)}
                className="w-full p-2 border rounded"
              />
              {zone.photos.length > 0 && (
                <p className="text-sm text-gray-600 mt-1">
                  {zone.photos.length} foto{zone.photos.length !== 1 ? 's' : ''} seleccionada{zone.photos.length !== 1 ? 's' : ''}
                </p>
              )}
            </div>

            {/* Estado de Análisis */}
            {zone.isAnalyzing && (
              <div className="text-blue-600 text-sm">
                Analizando imágenes...
              </div>
            )}

            {zone.analysisResult && (
              <div className="bg-white p-3 rounded border text-sm">
                <div><strong>Altura estimada:</strong> {zone.analysisResult.altura_m.toFixed(1)}m</div>
                <div><strong>Dificultad alta:</strong> {zone.analysisResult.dificultad_alta ? 'Sí' : 'No'}</div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Botón Agregar Árbol */}
      <div className="text-center">
        <button
          onClick={addZone}
          className="px-6 py-2 bg-green-500 text-white rounded hover:bg-green-600"
        >
          + Añadir Otro Árbol
        </button>
      </div>

      {/* Botón Analizar */}
      <div className="text-center">
        <button
          onClick={analyzeAllZones}
          disabled={isCalculating || zones.some(z => z.photos.length === 0)}
          className="px-8 py-3 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400"
        >
          {isCalculating ? 'Analizando...' : 'Analizar con IA'}
        </button>
      </div>
    </div>
  );
};

export default TreePruningDetails;
