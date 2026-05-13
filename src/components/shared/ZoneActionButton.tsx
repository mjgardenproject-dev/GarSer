import React from 'react';

export interface ZoneActionButtonProps {
    onClick: () => void;
    isAnalyzing: boolean;
    isAnalyzed: boolean;
    disabled: boolean;
    analyzingText?: string;
    analyzeText?: string;
    reanalyzeText?: string;
}

export const ZoneActionButton: React.FC<ZoneActionButtonProps> = ({
    onClick,
    isAnalyzing,
    isAnalyzed,
    disabled,
    analyzingText = "Analizando...",
    analyzeText = "Analizar esta zona",
    reanalyzeText = "Reanalizar esta zona"
}) => {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`w-full py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2 mb-3 transition-colors ${
                disabled
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                : 'bg-green-600 text-white hover:bg-green-700'
            }`}
        >
            {isAnalyzing ? (
                <>
                   <div className="animate-spin rounded-full h-4 w-4 border-2 border-green-600 border-t-transparent"></div>
                   {analyzingText}
                </>
            ) : (
                isAnalyzed ? reanalyzeText : analyzeText
            )}
        </button>
    );
};