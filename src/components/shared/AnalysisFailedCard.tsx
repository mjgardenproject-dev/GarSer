import React from 'react';
import { AlertTriangle } from 'lucide-react';

export const AnalysisFailedCard: React.FC<{ message?: string, onReanalyze: () => void }> = ({ message, onReanalyze }) => (
    <div className="mt-3 bg-white rounded-lg border border-red-200 p-3 shadow-sm relative overflow-hidden flex flex-col md:flex-row items-start md:items-center gap-3">
        <div className="absolute top-0 left-0 w-1 h-full bg-red-500"></div>
        <div className="flex-1 min-w-0 pl-2">
            <div className="flex items-center gap-2 mb-1">
                <AlertTriangle className="w-4 h-4 text-red-600" />
                <h4 className="font-semibold text-sm text-red-700">Análisis fallido</h4>
            </div>
            <p className="text-xs text-red-600 truncate">
                {message || 'Intenta hacer la foto desde otro ángulo.'} <span className="opacity-80">(No afectará al precio)</span>
            </p>
        </div>
        <button 
            onClick={onReanalyze}
            className="w-full md:w-auto mt-2 md:mt-0 px-4 py-2 bg-red-50 text-red-700 rounded-lg text-xs font-semibold hover:bg-red-100 transition-colors border border-red-100"
        >
            Re-analizar
        </button>
    </div>
);