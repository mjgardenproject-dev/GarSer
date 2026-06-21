import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle, ChevronLeft, Image, RotateCcw, Trash2 } from 'lucide-react';
import type { AnalysisV2Envelope } from '../../shared/analysisV2';
import { getAnalysisPresentation } from '../../shared/analysisV2Details';
import { AnalysisLoadingAnimation } from './AnalysisLoadingAnimation';

export interface ZonePhotoGalleryProps {
    photos: string[];
    photoIds?: string[];
    uploadingIndices?: Set<number>;
    selectedIndices?: number[];
    analyzedIndices?: number[];
    isAnalyzing: boolean;
    isAnalyzed?: boolean;
    analysis?: AnalysisV2Envelope | null;
    analysisLevel?: number;
    observations?: string[];
    loadingMessage?: string;
    onRetryAnalysis?: () => void;
    maxPhotos?: number;
    onToggleSelection: (index: number) => void;
    onRemovePhoto: (index: number) => void;
    onAddPhotos: (e: React.ChangeEvent<HTMLInputElement>) => void;
    emptyText?: string;
}

export interface ZonePhotoRemovalConfirmationCopy {
    title: string;
    message: string;
    confirmLabel: string;
    cancelLabel: string;
    tone: 'danger' | 'warning';
}

const normalizeIndices = (values: number[] | undefined, total: number) => {
    if (!Array.isArray(values)) return [];
    return Array.from(new Set(values.filter((value) => Number.isInteger(value) && value >= 0 && value < total))).sort((a, b) => a - b);
};

const areIndicesEqual = (a: number[], b: number[]) => {
    if (a.length !== b.length) return false;
    return a.every((value, index) => value === b[index]);
};

export const buildZonePhotoRemovalConfirmation = (params: {
    analysis?: AnalysisV2Envelope | null;
    analysisLevel?: number;
    observations?: string[];
    subjectLabel?: string;
    linkedResultCount?: number;
}): ZonePhotoRemovalConfirmationCopy => {
    const {
        analysis,
        analysisLevel,
        observations,
        subjectLabel = 'esta zona',
        linkedResultCount = 0
    } = params;
    const presentation = getAnalysisPresentation(analysis, {
        analysisLevel,
        observations
    });

    if (linkedResultCount > 0) {
        return {
            title: 'Eliminar foto analizada',
            message: `Esta foto tiene ${linkedResultCount} resultado${linkedResultCount === 1 ? '' : 's'} asociado${linkedResultCount === 1 ? '' : 's'}. Si continúas, se eliminará la foto y también sus resultados vinculados.`,
            confirmLabel: 'Eliminar foto y resultados',
            cancelLabel: 'Conservar todo',
            tone: 'danger'
        };
    }

    if (presentation.status === 'technical_error') {
        return {
            title: 'Eliminar foto del intento fallido',
            message: `Esta foto formó parte del último intento de análisis de ${subjectLabel}, que terminó con un error técnico controlado. Si continúas, se descartará ese intento y tendrás que reanalizar con las fotos restantes.`,
            confirmLabel: 'Eliminar foto y reintentar después',
            cancelLabel: 'Conservar todo',
            tone: 'warning'
        };
    }

    if (presentation.status === 'failed') {
        return {
            title: 'Eliminar foto del análisis fallido',
            message: `Esta foto participó en el último análisis de ${subjectLabel}, pero no hubo evidencia suficiente. Si continúas, se eliminará la foto y se descartará ese resultado para volver a analizar con nuevas imágenes.`,
            confirmLabel: 'Eliminar foto y descartar análisis',
            cancelLabel: 'Conservar todo',
            tone: 'warning'
        };
    }

    return {
        title: 'Eliminar foto analizada',
        message: `Esta foto forma parte del análisis actual de ${subjectLabel}. Si continúas, se eliminará la foto y también el resultado vigente para evitar inconsistencias.`,
        confirmLabel: 'Eliminar foto y resultado',
        cancelLabel: 'Conservar todo',
        tone: 'danger'
    };
};

export const ZonePhotoGallery: React.FC<ZonePhotoGalleryProps> = ({
    photos,
    photoIds,
    uploadingIndices = new Set(),
    selectedIndices,
    analyzedIndices = [],
    isAnalyzing,
    isAnalyzed = false,
    analysis,
    analysisLevel,
    observations,
    loadingMessage = "Analizando fotos seleccionadas...",
    onRetryAnalysis,
    maxPhotos = 5,
    onToggleSelection,
    onRemovePhoto,
    onAddPhotos,
    emptyText = "Fotos de esta zona"
}) => {
    const [isExpanded, setIsExpanded] = useState(!isAnalyzed);
    const [fileInputKey, setFileInputKey] = useState(0);
    const presentation = useMemo(() => getAnalysisPresentation(analysis, {
        analysisLevel,
        observations,
        analyzedIndices
    }), [analysis, analysisLevel, observations, analyzedIndices]);
    const normalizedSelectedIndices = useMemo(() => {
        if (Array.isArray(selectedIndices)) {
            return normalizeIndices(selectedIndices, photos.length);
        }
        return Array.from({ length: photos.length }, (_, index) => index);
    }, [photos.length, selectedIndices]);
    const normalizedAnalyzedIndices = useMemo(
        () => normalizeIndices(analyzedIndices, photos.length),
        [analyzedIndices, photos.length]
    );
    const hasCanonicalResult = presentation.status !== null || isAnalyzed;
    const hasFailedResult = presentation.status === 'failed' || presentation.status === 'technical_error';
    const hasPendingSelectionChanges = hasCanonicalResult && !areIndicesEqual(normalizedSelectedIndices, normalizedAnalyzedIndices);
    const shouldCollapseIntoStack = hasCanonicalResult && !isAnalyzing && !hasFailedResult && !hasPendingSelectionChanges;
    const showStack = shouldCollapseIntoStack && !isExpanded && photos.length > 0;
    const interactionsDisabled = isAnalyzing;
    const selectionSummary = normalizedSelectedIndices.length === photos.length
        ? 'Todas seleccionadas'
        : `${normalizedSelectedIndices.length}/${photos.length} seleccionadas`;
    const analyzedSummary = normalizedAnalyzedIndices.length > 0
        ? `${normalizedAnalyzedIndices.length}/${photos.length} analizadas`
        : undefined;
    const handleAddPhotos = (event: React.ChangeEvent<HTMLInputElement>) => {
        onAddPhotos(event);
        setFileInputKey((value) => value + 1);
    };
    const handleRemovePhoto = (index: number) => {
        onRemovePhoto(index);
        setFileInputKey((value) => value + 1);
    };

    useEffect(() => {
        setIsExpanded(!shouldCollapseIntoStack);
    }, [shouldCollapseIntoStack]);

    const headerBadge = isAnalyzing
        ? {
            className: 'border-green-200 bg-green-50 text-green-700',
            label: 'Analizando'
        }
        : hasPendingSelectionChanges
            ? {
                className: 'border-amber-200 bg-amber-50 text-amber-700',
                label: 'Cambios pendientes'
            }
            : presentation.status === 'technical_error'
                ? {
                    className: 'border-orange-200 bg-orange-50 text-orange-700',
                    label: 'Error técnico'
                }
                : presentation.status === 'failed'
                    ? {
                        className: 'border-red-200 bg-red-50 text-red-700',
                        label: 'Reintento recomendado'
                    }
                    : hasCanonicalResult
                        ? {
                            className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
                            label: presentation.badgeLabel
                        }
                        : null;

    return (
        <div className="mb-4">
            <div className="mb-2 flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500">
                        <span>{emptyText} ({photos.length})</span>
                        {headerBadge && (
                            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 font-semibold ${headerBadge.className}`}>
                                {headerBadge.label}
                            </span>
                        )}
                    </div>
                    {photos.length > 0 && (
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                            <span>{selectionSummary}</span>
                            {analyzedSummary && <span>{analyzedSummary}</span>}
                        </div>
                    )}
                </div>
                {shouldCollapseIntoStack && isExpanded && (
                    <button 
                        onClick={() => setIsExpanded(false)}
                        className="text-xs text-green-600 hover:text-green-700 font-medium flex items-center gap-1"
                    >
                        <ChevronLeft className="w-3 h-3 rotate-90" />
                        Ocultar fotos
                    </button>
                )}
            </div>

            {isAnalyzing ? (
                <div className="mb-3">
                    <AnalysisLoadingAnimation message={loadingMessage} />
                </div>
            ) : (
                <>
            {hasFailedResult && (
                <div className={`mb-3 flex items-start justify-between gap-3 rounded-xl border px-3 py-2.5 text-sm ${
                    presentation.status === 'technical_error'
                        ? 'border-orange-200 bg-orange-50 text-orange-800'
                        : 'border-red-200 bg-red-50 text-red-800'
                }`}>
                    <div className="flex items-start gap-2 min-w-0">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <div className="min-w-0">
                            <p className="font-medium">{presentation.title}</p>
                            <p className="text-sm opacity-90">{presentation.message}</p>
                        </div>
                    </div>
                    {onRetryAnalysis && (
                        <button
                            onClick={onRetryAnalysis}
                            className={`inline-flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                                presentation.status === 'technical_error'
                                    ? 'border-orange-200 bg-white text-orange-700 hover:bg-orange-100'
                                    : 'border-red-200 bg-white text-red-700 hover:bg-red-100'
                            }`}
                        >
                            <RotateCcw className="h-3.5 w-3.5" />
                            Reintentar
                        </button>
                    )}
                </div>
            )}

            {!hasFailedResult && hasCanonicalResult && (
                <div className={`mb-3 rounded-xl border px-3 py-2.5 text-sm ${
                    hasPendingSelectionChanges
                        ? 'border-amber-200 bg-amber-50 text-amber-800'
                        : 'border-emerald-200 bg-emerald-50 text-emerald-800'
                }`}>
                    <p className="font-medium">
                        {hasPendingSelectionChanges
                            ? 'Has cambiado la selección de fotos desde el último análisis.'
                            : 'Las fotos analizadas están marcadas y la selección actual está sincronizada.'}
                    </p>
                    <p className="mt-1 opacity-90">
                        {hasPendingSelectionChanges
                            ? 'Vuelve a analizar para que el resultado y las fotos seleccionadas vuelvan a coincidir.'
                            : presentation.message}
                    </p>
                </div>
            )}

            {showStack ? (
                <div 
                    onClick={() => setIsExpanded(true)}
                    className="relative h-32 w-full flex items-center justify-center cursor-pointer group py-4 transition-all duration-500 ease-in-out bg-gray-50/50 rounded-xl border border-dashed border-gray-200 hover:bg-green-50/30 hover:border-green-200"
                >
                    {photos.slice(0, 3).map((photo, i) => (
                        <div 
                            key={photoIds?.[i] || i}
                            className="absolute transition-all duration-500 ease-in-out shadow-lg rounded-xl overflow-hidden border-2 border-white bg-white"
                            style={{
                                width: '90px',
                                height: '90px',
                                transform: `translateX(${i * 12}px) rotate(${i * 3}deg)`,
                                zIndex: 10 - i,
                                opacity: 1 - (i * 0.1)
                            }}
                        >
                            <img
                                src={photo}
                                className="w-full h-full object-cover"
                                alt=""
                            />
                        </div>
                    ))}
                    <div className="absolute bottom-2 bg-white/90 backdrop-blur-sm px-3 py-1 rounded-full text-xs font-medium text-gray-700 shadow-sm z-20 translate-y-1 group-hover:-translate-y-1 transition-transform border border-gray-100 flex items-center gap-1.5">
                        <Image className="w-3 h-3" />
                        Editar fotos
                    </div>
                </div>
            ) : (
                <div className="flex flex-row overflow-x-auto gap-3 pb-2 snap-x items-center scrollbar-hide min-h-[110px]">
                    {photos.map((p, i) => {
                        const isSelected = selectedIndices?.includes(i) ?? true;
                        const isAnalyzedPhoto = analyzedIndices?.includes(i);
                        const isUploading = uploadingIndices.has(i);

                        return (
                            <div 
                                key={photoIds?.[i] || i} 
                                className={`relative shrink-0 snap-start group ${interactionsDisabled ? 'cursor-default' : 'cursor-pointer'} ${isSelected ? 'p-0.5' : ''}`}
                                onClick={() => {
                                    if (!interactionsDisabled) {
                                        onToggleSelection(i);
                                    }
                                }}
                            >
                                <div className={`relative w-24 h-24 rounded-lg overflow-hidden border transition-all duration-300 ${isSelected ? 'border-2 border-green-500 shadow-md' : 'border-gray-200 shadow-sm'} ${isAnalyzedPhoto ? 'opacity-80' : 'opacity-100'}`}>
                                   <img
                                       src={p}
                                       alt={`Foto ${i}`}
                                       className={`w-full h-full object-cover transition-all duration-700 ease-in-out ${isUploading ? 'scale-110 blur-sm brightness-50' : 'scale-100 blur-0 brightness-100'}`}
                                   />
                                   
                                   {isUploading && (
                                       <div className="absolute inset-0 flex items-center justify-center bg-black/20 z-20 transition-opacity duration-300">
                                           <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                       </div>
                                   )}
                                   
                                    {isAnalyzedPhoto && (
                                        <div className="absolute bottom-1 left-1 bg-green-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded shadow-sm z-10">
                                            Analizada
                                        </div>
                                    )}
                                    
                                    {!isAnalyzedPhoto && !isUploading && !interactionsDisabled && (
                                        <div className={`absolute top-1 left-1 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all z-20 ${isSelected ? 'bg-green-500 border-green-500 scale-100' : 'bg-black/20 border-white/80 group-hover:bg-black/40 scale-90 group-hover:scale-100'}`}>
                                            {isSelected && <CheckCircle className="w-3.5 h-3.5 text-white" />}
                                        </div>
                                    )}
                                </div>
                                
                                {!interactionsDisabled && (
                                   <button
                                       onClick={(e) => { e.stopPropagation(); handleRemovePhoto(i); }}
                                       className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1.5 hover:bg-red-600 shadow-sm transition-colors z-10"
                                   >
                                       <Trash2 className="w-3.5 h-3.5" />
                                   </button>
                               )}
                            </div>
                        );
                    })}
                    
                   {!interactionsDisabled && photos.length < maxPhotos && (
                       <div className="w-24 h-24 shrink-0 flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 hover:bg-gray-100 hover:border-green-400 transition-colors cursor-pointer group snap-start">
                            <label className="w-full h-full flex flex-col items-center justify-center cursor-pointer">
                                <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center group-hover:bg-green-100 transition-colors mb-1">
                                    <Image className="w-4 h-4 text-gray-500 group-hover:text-green-600" />
                                </div>
                                <span className="text-xs font-medium text-gray-500 group-hover:text-green-700">Añadir foto</span>
                                <input 
                                    key={`zone-photo-input-${fileInputKey}`}
                                    type="file" 
                                    accept="image/*" 
                                    multiple 
                                    className="hidden" 
                                    onChange={handleAddPhotos}
                                />
                            </label>
                        </div>
                    )}
                </div>
            )}
                </>
            )}
        </div>
    );
};
