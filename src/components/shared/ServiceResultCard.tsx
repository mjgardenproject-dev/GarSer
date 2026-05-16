import React from 'react';
import { Trash2 } from 'lucide-react';

export interface ServiceResultCardProps {
    title: string;
    analysisLevel?: number;
    stats: Array<{ label: string; value: React.ReactNode }>;
    observations?: string[];
    onDelete?: () => void;
    children?: React.ReactNode;
}

export const ServiceResultCard: React.FC<ServiceResultCardProps> = ({
    title,
    analysisLevel,
    stats,
    observations,
    onDelete,
    children
}) => {
    // Determine colors based on analysis level
    let borderColor = 'bg-gray-300';
    let levelText = '';
    let levelTextColor = '';
    
    if (analysisLevel === 1) {
        borderColor = 'bg-green-500';
        levelText = 'Análisis fiable';
        levelTextColor = 'text-green-600';
    } else if (analysisLevel === 2) {
        borderColor = 'bg-amber-500';
        levelText = 'Análisis con observaciones';
        levelTextColor = 'text-amber-600';
    } else if (analysisLevel === 3) {
        borderColor = 'bg-red-500';
        levelText = 'Análisis fallido';
        levelTextColor = 'text-red-600';
    }

    return (
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm relative overflow-hidden">
            {analysisLevel !== undefined && (
                <div className={`absolute top-0 left-0 w-1 h-full ${borderColor}`}></div>
            )}
            
            <div className="flex justify-between items-start">
                <div>
                    <h4 className="font-semibold text-gray-900 text-sm">
                        {title}
                    </h4>
                    
                    <div className="flex items-center flex-wrap gap-2 text-xs text-gray-600 mt-1">
                        {stats.map((stat, index) => (
                            <React.Fragment key={index}>
                                <span>
                                    {stat.label}: <span className="font-medium text-gray-900">{stat.value}</span>
                                </span>
                                {index < stats.length - 1 && (
                                    <span className="text-gray-300">|</span>
                                )}
                            </React.Fragment>
                        ))}
                    </div>
                    
                    {analysisLevel !== undefined && analysisLevel < 3 && (
                        <div className={`mt-2 text-xs font-medium ${levelTextColor}`}>
                            {levelText}
                        </div>
                    )}
                    {analysisLevel === 3 && (
                        <div className="mt-1 text-xs font-medium text-red-600">
                            Análisis fallido
                        </div>
                    )}
                </div>
                
                {onDelete && (
                    <button 
                        onClick={onDelete}
                        className="text-gray-400 hover:text-red-500 transition-colors shrink-0 ml-2"
                        title="Eliminar resultado"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                )}
            </div>

            {observations && observations.length > 0 && (
                <div className="mt-3 p-3 bg-gray-50 rounded-lg text-xs text-gray-600 border border-gray-100">
                    <div className="font-medium mb-1 text-gray-700">Observaciones:</div>
                    <ul className="list-disc list-inside space-y-0.5 ml-1">
                        {observations.map((obs, k) => (
                            <li key={k}>{obs}</li>
                        ))}
                    </ul>
                </div>
            )}
            
            {children}
        </div>
    );
};