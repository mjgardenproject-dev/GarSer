import React, { useState } from 'react';
import { Image, Trash2, CheckCircle, ChevronLeft } from 'lucide-react';

export interface ZonePhotoGalleryProps {
    photos: (string | File)[];
    uploadingIndices?: Set<number>;
    selectedIndices?: number[];
    analyzedIndices?: number[];
    isAnalyzing: boolean;
    isAnalyzed?: boolean;
    maxPhotos?: number;
    onToggleSelection: (index: number) => void;
    onRemovePhoto: (index: number) => void;
    onAddPhotos: (e: React.ChangeEvent<HTMLInputElement>) => void;
    emptyText?: string;
}

export const ZonePhotoGallery: React.FC<ZonePhotoGalleryProps> = ({
    photos,
    uploadingIndices = new Set(),
    selectedIndices,
    analyzedIndices = [],
    isAnalyzing,
    isAnalyzed = false,
    maxPhotos = 5,
    onToggleSelection,
    onRemovePhoto,
    onAddPhotos,
    emptyText = "Fotos de esta zona"
}) => {
    const [isExpanded, setIsExpanded] = useState(!isAnalyzed);

    // If analysis state changes, we might want to auto-collapse, but for now we let it be.
    // If not analyzed, always expanded.
    const showStack = isAnalyzed && !isExpanded && photos.length > 0;

    return (
        <div className="mb-4">
            <div className="text-xs text-gray-500 mb-2 flex justify-between items-center">
                <span>{emptyText} ({photos.length})</span>
                {isAnalyzed && isExpanded && (
                    <button 
                        onClick={() => setIsExpanded(false)}
                        className="text-xs text-green-600 hover:text-green-700 font-medium flex items-center gap-1"
                    >
                        <ChevronLeft className="w-3 h-3 rotate-90" />
                        Ocultar fotos
                    </button>
                )}
            </div>

            {showStack ? (
                <div 
                    onClick={() => setIsExpanded(true)}
                    className="relative h-32 w-full flex items-center justify-center cursor-pointer group py-4 transition-all duration-500 ease-in-out bg-gray-50/50 rounded-xl border border-dashed border-gray-200 hover:bg-green-50/30 hover:border-green-200"
                >
                    {photos.slice(0, 3).map((photo, i) => (
                        <div 
                            key={i}
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
                                src={typeof photo === 'string' ? photo : URL.createObjectURL(photo)} 
                                className="w-full h-full object-cover" 
                                alt=""
                            />
                        </div>
                    ))}
                    <div className="absolute bottom-2 bg-white/90 backdrop-blur-sm px-3 py-1 rounded-full text-[10px] font-medium text-gray-700 shadow-sm z-20 translate-y-1 group-hover:-translate-y-1 transition-transform border border-gray-100 flex items-center gap-1.5">
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
                                key={i} 
                                className={`relative shrink-0 snap-start group cursor-pointer ${isSelected ? 'p-0.5' : ''}`}
                                onClick={() => onToggleSelection(i)}
                            >
                                <div className={`relative w-24 h-24 rounded-lg overflow-hidden border transition-all duration-300 ${isSelected ? 'border-2 border-green-500 shadow-md' : 'border-gray-200 shadow-sm'} ${isAnalyzedPhoto ? 'opacity-80' : 'opacity-100'}`}>
                                   <img 
                                       src={typeof p === 'string' ? p : URL.createObjectURL(p)} 
                                       alt={`Foto ${i}`}
                                       className={`w-full h-full object-cover transition-all duration-700 ease-in-out ${isUploading ? 'scale-110 blur-sm brightness-50' : 'scale-100 blur-0 brightness-100'}`}
                                   />
                                   
                                   {isUploading && (
                                       <div className="absolute inset-0 flex items-center justify-center bg-black/20 z-20 transition-opacity duration-300">
                                           <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                       </div>
                                   )}
                                   
                                    {isAnalyzedPhoto && (
                                        <div className="absolute bottom-1 left-1 bg-green-500 text-white text-[8px] font-bold px-1.5 py-0.5 rounded shadow-sm z-10">
                                            Analizada
                                        </div>
                                    )}
                                    
                                    {!isAnalyzedPhoto && !isUploading && (
                                        <div className={`absolute top-1 left-1 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all z-20 ${isSelected ? 'bg-green-500 border-green-500 scale-100' : 'bg-black/20 border-white/80 group-hover:bg-black/40 scale-90 group-hover:scale-100'}`}>
                                            {isSelected && <CheckCircle className="w-3.5 h-3.5 text-white" />}
                                        </div>
                                    )}
                                </div>
                                
                                {!isAnalyzing && (
                                   <button
                                       onClick={(e) => { e.stopPropagation(); onRemovePhoto(i); }}
                                       className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1.5 hover:bg-red-600 shadow-sm transition-colors z-10"
                                   >
                                       <Trash2 className="w-3.5 h-3.5" />
                                   </button>
                               )}
                            </div>
                        );
                    })}
                    
                   {!isAnalyzing && photos.length < maxPhotos && (
                       <div className="w-24 h-24 shrink-0 flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 hover:bg-gray-100 hover:border-green-400 transition-colors cursor-pointer group snap-start">
                            <label className="w-full h-full flex flex-col items-center justify-center cursor-pointer">
                                <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center group-hover:bg-green-100 transition-colors mb-1">
                                    <Image className="w-4 h-4 text-gray-500 group-hover:text-green-600" />
                                </div>
                                <span className="text-[10px] font-medium text-gray-500 group-hover:text-green-700">Añadir foto</span>
                                <input 
                                    type="file" 
                                    accept="image/*" 
                                    multiple 
                                    className="hidden" 
                                    onChange={onAddPhotos}
                                />
                            </label>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};