import React from 'react';
import { Trash2 } from 'lucide-react';
import type { AnalysisV2Envelope } from '../../shared/analysisV2';
import { getAnalysisPresentation } from '../../shared/analysisV2Details';

export interface ServiceResultCardProps {
    title: string;
    analysisLevel?: number;
    stats?: Array<{ label: string; value: React.ReactNode }>;
    observations?: string[];
    analysis?: AnalysisV2Envelope;
    onDelete?: () => void;
    children?: React.ReactNode;
}

export const ServiceResultCard: React.FC<ServiceResultCardProps> = ({
    title,
    analysisLevel,
    stats = [],
    observations,
    analysis,
    onDelete,
    children
}) => {
    const presentation = getAnalysisPresentation(analysis, {
        analysisLevel,
        observations
    });
    const resolvedObservations = presentation.observations;

    const accentClass = presentation.tone === 'success'
        ? 'bg-emerald-500'
        : presentation.tone === 'partial'
            ? 'bg-amber-500'
            : presentation.tone === 'technical_error'
                ? 'bg-orange-500'
                : presentation.tone === 'failed'
                    ? 'bg-red-500'
                    : 'bg-gray-300';

    const badgeClass = presentation.tone === 'success'
        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
        : presentation.tone === 'partial'
            ? 'bg-amber-50 text-amber-700 border-amber-200'
            : presentation.tone === 'technical_error'
                ? 'bg-orange-50 text-orange-700 border-orange-200'
                : presentation.tone === 'failed'
                    ? 'bg-red-50 text-red-700 border-red-200'
                    : 'bg-gray-50 text-gray-600 border-gray-200';

    return (
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm relative overflow-hidden">
            {(analysisLevel !== undefined || analysis) && (
                <div className={`absolute top-0 left-0 w-1 h-full ${accentClass}`}></div>
            )}
            
            <div className="flex justify-between items-start">
                <div className="min-w-0">
                    <h4 className="font-semibold text-gray-900 text-base">
                        {title}
                    </h4>

                    <div className="flex items-center flex-wrap gap-2 text-sm text-gray-600 mt-1">
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

                    {(analysisLevel !== undefined || analysis) && (
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                            <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${badgeClass}`}>
                                {presentation.badgeLabel}
                            </span>
                            {presentation.status === 'partial' && (
                                <span className="text-xs text-gray-500">
                                    La estimación sigue siendo utilizable para presupuesto.
                                </span>
                            )}
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

            {resolvedObservations.length > 0 && (
                <div className="mt-3 p-3 bg-gray-50 rounded-lg text-sm text-gray-600 border border-gray-100">
                    <div className="font-medium mb-1 text-gray-700">Observaciones:</div>
                    <ul className="list-disc list-inside space-y-0.5 ml-1">
                        {resolvedObservations.map((obs, k) => (
                            <li key={k}>{obs}</li>
                        ))}
                    </ul>
                </div>
            )}
            
            {children}
        </div>
    );
};
