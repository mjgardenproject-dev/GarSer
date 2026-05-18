import React from 'react';
import { AlertTriangle } from 'lucide-react';
import type { AnalysisV2Envelope } from '../../shared/analysisV2';
import { getAnalysisPresentation } from '../../shared/analysisV2Details';

export const AnalysisFailedCard: React.FC<{
    message?: string;
    analysis?: AnalysisV2Envelope;
    onReanalyze: () => void;
}> = ({ message, analysis, onReanalyze }) => {
    const presentation = getAnalysisPresentation(analysis, {
        analysisLevel: 3,
        isFailed: true,
        observations: message ? [message] : []
    });
    const toneClasses = presentation.isTechnicalError
        ? {
            border: 'border-orange-200',
            accent: 'bg-orange-500',
            text: 'text-orange-700',
            button: 'bg-orange-50 text-orange-700 border-orange-100 hover:bg-orange-100'
        }
        : {
            border: 'border-red-200',
            accent: 'bg-red-500',
            text: 'text-red-700',
            button: 'bg-red-50 text-red-700 border-red-100 hover:bg-red-100'
        };

    return (
    <div className={`mt-3 bg-white rounded-lg border ${toneClasses.border} p-3 shadow-sm relative overflow-hidden flex flex-col md:flex-row items-start md:items-center gap-3`}>
        <div className={`absolute top-0 left-0 w-1 h-full ${toneClasses.accent}`}></div>
        <div className="flex-1 min-w-0 pl-2">
            <div className="flex items-center gap-2 mb-1">
                <AlertTriangle className={`w-4 h-4 ${toneClasses.text}`} />
                <h4 className={`font-semibold text-sm ${toneClasses.text}`}>{presentation.title}</h4>
            </div>
            <p className={`text-xs ${toneClasses.text}`}>
                {presentation.message} <span className="opacity-80">(No afectará al precio)</span>
            </p>
            {presentation.observations.length > 1 && (
                <ul className={`mt-2 list-disc pl-4 text-xs ${toneClasses.text} space-y-1`}>
                    {presentation.observations.slice(1).map((observation, index) => (
                        <li key={index}>{observation}</li>
                    ))}
                </ul>
            )}
        </div>
        <button 
            onClick={onReanalyze}
            className={`w-full md:w-auto mt-2 md:mt-0 px-4 py-2 rounded-lg text-xs font-semibold transition-colors border ${toneClasses.button}`}
        >
            Reanalizar
        </button>
    </div>
    );
};
