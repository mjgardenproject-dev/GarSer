import React from 'react';
import { Trash2 } from 'lucide-react';

export const TreeDetails = ({
    idx,
    group,
    allPhotos,
    isZoneAnalyzing,
    treeUploads,
    handleTreeFileSelect,
    toggleTreePhotoSelection,
    removeTreePhoto,
    removeTreeGroup,
    analyzeTreeGroup,
    isAnalyzed,
    AnalysisLoadingAnimation,
    AnalysisFailedCard,
    ZonePhotoGallery,
    ZoneActionButton,
    ServiceResultCard
}: any) => {
    if (isZoneAnalyzing) {
        return <AnalysisLoadingAnimation key={group.id} message="Analizando árboles..." />;
    }

    if ((group as any).isFailed || group.analysisLevel === 3) {
        return (
            <AnalysisFailedCard 
                key={group.id}
                message={group.observations?.[0]} 
                onReanalyze={() => analyzeTreeGroup(group.id)} 
            />
        );
    }

    return (
        <div key={group.id} className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
            <div className="flex justify-between items-center mb-4 pb-2 border-b border-gray-100">
                <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-xs font-bold">
                        {idx + 1}
                    </div>
                    <h3 className="font-semibold text-gray-900">Grupo de Árboles {idx + 1}</h3>
                    <span className="text-xs text-gray-500 ml-1 font-normal">({allPhotos.length}/5 fotos)</span>
                </div>
                <button onClick={() => removeTreeGroup(group.id)} className="text-gray-400 hover:text-red-500 p-2 hover:bg-red-50 rounded-lg transition-colors">
                    <Trash2 className="w-5 h-5" />
                </button>
            </div>
            
            <div className="mb-4">
                <ZonePhotoGallery
                    photos={allPhotos}
                    uploadingIndices={treeUploads[group.id]}
                    selectedIndices={group.selectedIndices}
                    analyzedIndices={group.analyzedIndices}
                    isAnalyzing={isZoneAnalyzing}
                    isAnalyzed={isAnalyzed}
                    onToggleSelection={(i: number) => toggleTreePhotoSelection(group.id, i)}
                    onRemovePhoto={(i: number) => removeTreePhoto(group.id, i)}
                    onAddPhotos={(e: any) => handleTreeFileSelect(group.id, e)}
                    emptyText="Fotos de este grupo"
                />
            </div>

            <div className="mt-2">
                <ZoneActionButton
                    onClick={() => analyzeTreeGroup(group.id)}
                    isAnalyzing={isZoneAnalyzing}
                    isAnalyzed={isAnalyzed}
                    disabled={isZoneAnalyzing || (group.selectedIndices !== undefined && group.selectedIndices.length === 0) || allPhotos.length === 0}
                />
            </div>

            {isAnalyzed && (
                <div className="mt-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <ServiceResultCard
                        title="Poda de árboles"
                        metrics={[
                            { label: 'Altura est.', value: `${group.aiHeightMeters} m` },
                            { label: 'Tamaño', value: group.aiSizeBand || 'Normal' }
                        ]}
                        analysisLevel={group.analysisLevel}
                        observations={group.observations}
                    />
                </div>
            )}
        </div>
    );
};
