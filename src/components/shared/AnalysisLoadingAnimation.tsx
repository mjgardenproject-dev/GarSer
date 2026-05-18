import React from 'react';
import { Sprout } from 'lucide-react';

export const AnalysisLoadingAnimation: React.FC<{ message?: string }> = ({ message = "Analizando estructura y vegetación..." }) => (
    <div className="relative h-64 w-full flex flex-col items-center justify-center bg-gradient-to-b from-gray-50 to-white rounded-xl border border-gray-100 overflow-hidden shadow-inner mb-4">
        <div className="analysis-grid-motion-reduce absolute inset-0 z-0 opacity-20 motion-reduce:opacity-10" 
             style={{
                 backgroundImage: 'linear-gradient(#16a34a 1px, transparent 1px), linear-gradient(90deg, #16a34a 1px, transparent 1px)',
                 backgroundSize: '20px 20px',
                 transform: 'perspective(500px) rotateX(60deg) translateY(-50px) scale(1.5)',
                 animation: 'gridMove 4s linear infinite'
             }} 
        />
        <div className="relative z-10 w-24 h-24 flex items-center justify-center mb-4">
            <div className="absolute w-full h-full rounded-full border-2 border-green-500/30 motion-safe:animate-ping motion-reduce:animate-none" />
            <div className="absolute w-3/4 h-3/4 rounded-full border border-green-500/50 motion-safe:animate-ping motion-safe:delay-150 motion-reduce:animate-none" />
            <div className="relative z-20 bg-white p-3 rounded-full shadow-lg border border-green-100">
                <Sprout className="w-8 h-8 text-green-600 motion-safe:animate-pulse motion-reduce:animate-none" />
            </div>
            <div className="absolute w-full h-full rounded-full border-t-2 border-r-2 border-green-500 motion-safe:animate-spin motion-reduce:animate-none" />
        </div>
        <div className="relative z-10 text-center">
            <p className="text-sm font-semibold text-gray-800 motion-safe:animate-pulse transition-opacity duration-300">
                {message}
            </p>
            <p className="text-xs text-gray-400 mt-1">Analizando...</p>
        </div>
        <style>{`
            @keyframes gridMove {
                0% { background-position: 0 0; }
                100% { background-position: 0 20px; }
            }
            @media (prefers-reduced-motion: reduce) {
                .analysis-grid-motion-reduce {
                    animation: none !important;
                }
            }
        `}</style>
    </div>
);
