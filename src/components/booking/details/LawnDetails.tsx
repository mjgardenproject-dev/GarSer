import React from 'react';
import { Trash2, Image, CheckCircle } from 'lucide-react';

export const LawnDetails = ({ 
    idx, 
    zone, 
    allPhotos, 
    isZoneAnalyzing, 
    lawnUploads, 
    handleLawnFileSelect, 
    toggleLawnPhotoSelection, 
    removeLawnPhoto, 
    removeLawnZone, 
    analyzeLawnZone, 
    isAnalyzed, 
    AnalysisLoadingAnimation, 
    AnalysisFailedCard, 
    ZonePhotoGallery, 
    ZoneActionButton, 
    ServiceResultCard 
}: any) => {
    if (isZoneAnalyzing) {
        return <AnalysisLoadingAnimation key={zone.id} message="Analizando zona de césped..." />;
    }

    if ((zone as any).isFailed || zone.analysisLevel === 3) {
        return (
            <AnalysisFailedCard 
                key={zone.id}
                message={zone.observations?.[0]} 
                onReanalyze={() => analyzeLawnZone(zone.id)} 
            />
        );
    }

    return (
        <div key={zone.id} className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
            <div className="flex justify-between items-center mb-4 pb-2 border-b border-gray-100">
                <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-xs font-bold">
                        {idx + 1}
                    </div>
                    <h3 className="font-semibold text-gray-900">Zona de Césped {idx + 1}</h3>
                    <span className="text-xs text-gray-500 ml-1 font-normal">({allPhotos.length}/5 fotos)</span>
                </div>
                <button onClick={() => removeLawnZone(zone.id)} className="text-gray-400 hover:text-red-500 p-2 hover:bg-red-50 rounded-lg transition-colors">
                    <Trash2 className="w-5 h-5" />
                </button>
            </div>
            
            <div className="mb-4">
                <ZonePhotoGallery
                    photos={allPhotos}
                    uploadingIndices={lawnUploads[zone.id]}
                    selectedIndices={zone.selectedIndices}
                    analyzedIndices={zone.analyzedIndices}
                    isAnalyzing={isZoneAnalyzing}
                    isAnalyzed={isAnalyzed}
                    onToggleSelection={(i: number) => toggleLawnPhotoSelection(zone.id, i)}
                    onRemovePhoto={(i: number) => removeLawnPhoto(zone.id, i)}
                    onAddPhotos={(e: any) => handleLawnFileSelect(zone.id, e)}
                    emptyText="Fotos de esta zona"
                />
            </div>

            <div className="mt-2">
                <ZoneActionButton
                    onClick={() => analyzeLawnZone(zone.id)}
                    isAnalyzing={isZoneAnalyzing}
                    isAnalyzed={isAnalyzed}
                    disabled={isZoneAnalyzing || (zone.selectedIndices !== undefined && zone.selectedIndices.length === 0) || allPhotos.length === 0}
                />
            </div>

            {isAnalyzed && (
                <div className="mt-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <ServiceResultCard
                        title="Corte de césped"
                        metrics={[
                            { label: 'Superficie', value: `${zone.area} m²` },
                            { label: 'Estado', value: zone.state === 'muy_alto' ? 'Muy alto / Asilvestrado' : zone.state === 'alto' ? 'Alto' : 'Normal' }
                        ]}
                        analysisLevel={zone.analysisLevel}
                        observations={zone.observations}
                    />
                </div>
            )}
        </div>
    );
};
