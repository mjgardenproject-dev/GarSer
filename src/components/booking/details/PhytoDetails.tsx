import React from 'react';
import { Trash2 } from 'lucide-react';

export const PhytoDetails = ({
    idx,
    zone,
    allPhotos,
    isZoneAnalyzing,
    phytosanitaryUploads,
    handlePhytosanitaryFileSelect,
    togglePhytosanitaryPhotoSelection,
    removePhytosanitaryPhoto,
    removePhytosanitaryZone,
    analyzePhytosanitaryZone,
    isAnalyzed,
    AnalysisLoadingAnimation,
    AnalysisFailedCard,
    ZonePhotoGallery,
    ZoneActionButton,
    ServiceResultCard
}: any) => {
    if (isZoneAnalyzing) {
        return <AnalysisLoadingAnimation key={zone.id} message="Analizando zona..." />;
    }

    if ((zone as any).isFailed || zone.analysisLevel === 3) {
        return (
            <AnalysisFailedCard 
                key={zone.id}
                message={zone.observations?.[0]} 
                onReanalyze={() => analyzePhytosanitaryZone(zone.id)} 
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
                    <h3 className="font-semibold text-gray-900">Zona Fitosanitaria {idx + 1}</h3>
                    <span className="text-xs text-gray-500 ml-1 font-normal">({allPhotos.length}/5 fotos)</span>
                </div>
                <button onClick={() => removePhytosanitaryZone(zone.id)} className="text-gray-400 hover:text-red-500 p-2 hover:bg-red-50 rounded-lg transition-colors">
                    <Trash2 className="w-5 h-5" />
                </button>
            </div>
            
            <div className="mb-4">
                <ZonePhotoGallery
                    photos={allPhotos}
                    uploadingIndices={phytosanitaryUploads[zone.id]}
                    selectedIndices={zone.selectedIndices}
                    analyzedIndices={zone.analyzedIndices}
                    isAnalyzing={isZoneAnalyzing}
                    isAnalyzed={isAnalyzed}
                    onToggleSelection={(i: number) => togglePhytosanitaryPhotoSelection(zone.id, i)}
                    onRemovePhoto={(i: number) => removePhytosanitaryPhoto(zone.id, i)}
                    onAddPhotos={(e: any) => handlePhytosanitaryFileSelect(zone.id, e)}
                    emptyText="Fotos de esta zona"
                />
            </div>

            <div className="mt-2">
                <ZoneActionButton
                    onClick={() => analyzePhytosanitaryZone(zone.id)}
                    isAnalyzing={isZoneAnalyzing}
                    isAnalyzed={isAnalyzed}
                    disabled={isZoneAnalyzing || (zone.selectedIndices !== undefined && zone.selectedIndices.length === 0) || allPhotos.length === 0}
                />
            </div>

            {isAnalyzed && (
                <div className="mt-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <ServiceResultCard
                        title="Tratamiento fitosanitario"
                        metrics={[
                            { label: 'Vegetación', value: zone.affectedType || 'Desconocida' },
                            { label: 'Superficie', value: `${zone.area} m²` }
                        ]}
                        analysisLevel={zone.analysisLevel}
                        observations={zone.observations}
                    />
                </div>
            )}
        </div>
    );
};
