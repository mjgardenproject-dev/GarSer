const fs = require('fs');
const file = '/Users/javier/Downloads/GarSer-main 4/src/pages/reserva/DetailsPage.tsx';
let content = fs.readFileSync(file, 'utf8');

const startBlock = '                                            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">';
const endBlock = '                                            </button>\n                                        </div>\n                                    </div>\n                                );\n                            })}';

const idx1 = content.indexOf(startBlock);
const idx2 = content.indexOf(endBlock, idx1);

if (idx1 !== -1 && idx2 !== -1) {
    const newText = `                                            {isZoneAnalyzing ? (
                                                <div className="relative h-64 w-full flex flex-col items-center justify-center bg-gradient-to-b from-gray-50 to-white rounded-xl border border-gray-100 overflow-hidden shadow-inner mb-4">
                                                    <div className="absolute inset-0 z-0 opacity-20" 
                                                         style={{
                                                             backgroundImage: 'linear-gradient(#16a34a 1px, transparent 1px), linear-gradient(90deg, #16a34a 1px, transparent 1px)',
                                                             backgroundSize: '20px 20px',
                                                             transform: 'perspective(500px) rotateX(60deg) translateY(-50px) scale(1.5)',
                                                             animation: 'gridMove 4s linear infinite'
                                                         }} 
                                                    />
                                                    <div className="relative z-10 w-24 h-24 flex items-center justify-center mb-4">
                                                        <div className="absolute w-full h-full rounded-full border-2 border-green-500/30 animate-ping" />
                                                        <div className="absolute w-3/4 h-3/4 rounded-full border border-green-500/50 animate-ping delay-150" />
                                                        <div className="relative z-20 bg-white p-3 rounded-full shadow-lg border border-green-100">
                                                            <Wand2 className="w-8 h-8 text-green-600 animate-pulse" />
                                                        </div>
                                                        <div className="absolute w-full h-full rounded-full border-t-2 border-r-2 border-green-500 animate-spin" />
                                                    </div>
                                                    <div className="relative z-10 text-center">
                                                        <p className="text-sm font-semibold text-gray-800 animate-pulse transition-all duration-300">Analizando este árbol...</p>
                                                        <p className="text-xs text-gray-400 mt-1">Estimando altura y dificultad...</p>
                                                    </div>
                                                    <style>{\`
                                                        @keyframes gridMove {
                                                            0% { background-position: 0 0; }
                                                            100% { background-position: 0 20px; }
                                                        }
                                                    \`}</style>
                                                </div>
                                            ) : (
                                                <>
                                                    <div className="flex flex-row overflow-x-auto gap-3 pb-2 snap-x items-center scrollbar-hide min-h-[110px]">
                                                        {photoUrls.map((url, i) => (
                                                            <div key={i} className="relative shrink-0 snap-start group cursor-pointer">
                                                                <div className={\`relative w-24 h-24 rounded-lg overflow-hidden border transition-all duration-300 border-gray-200 shadow-sm \${hasResult ? 'opacity-80' : 'opacity-100'}\`}>
                                                                    <img src={url} alt={\`Foto \${i + 1}\`} className="w-full h-full object-cover transition-all duration-700 ease-in-out" />
                                                                    {hasResult && (
                                                                        <div className="absolute bottom-1 left-1 bg-green-500 text-white text-[8px] font-bold px-1.5 py-0.5 rounded shadow-sm z-10">
                                                                            Analizada
                                                                        </div>
                                                                    )}
                                                                </div>
                                                                {!isZoneAnalyzing && (
                                                                    <button
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            const next = [...(bookingData.treeGroups || [])];
                                                                            const idxToUpdate = next.findIndex(x => x.id === zone.id);
                                                                            if (idxToUpdate !== -1 && next[idxToUpdate].photoUrls) {
                                                                                next[idxToUpdate].photoUrls = next[idxToUpdate].photoUrls.filter((_, index) => index !== i);
                                                                                next[idxToUpdate].analysisLevel = undefined;
                                                                                next[idxToUpdate].isFailed = undefined;
                                                                                next[idxToUpdate].aiHeightMeters = undefined;
                                                                                next[idxToUpdate].difficultyHigh = undefined;
                                                                                next[idxToUpdate].observations = undefined;
                                                                                const newHours = calculateTotalTreeHours(next);
                                                                                setBookingData({ treeGroups: next, estimatedHours: newHours });
                                                                                if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { treeGroups: next, estimatedHours: newHours });
                                                                            }
                                                                        }}
                                                                        className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1.5 hover:bg-red-600 shadow-sm transition-colors z-10"
                                                                    >
                                                                        <Trash2 className="w-3.5 h-3.5" />
                                                                    </button>
                                                                )}
                                                            </div>
                                                        ))}
                                                        {!isZoneAnalyzing && photoUrls.length < 5 && (
                                                            <div className="w-24 h-24 shrink-0 flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 hover:bg-gray-100 hover:border-green-400 transition-colors cursor-pointer group snap-start">
                                                                <label className="w-full h-full flex flex-col items-center justify-center cursor-pointer">
                                                                    <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center group-hover:bg-green-100 transition-colors mb-1">
                                                                        <Camera className="w-4 h-4 text-gray-500 group-hover:text-green-600" />
                                                                    </div>
                                                                    <span className="text-[10px] font-medium text-gray-500 group-hover:text-green-700">Añadir foto</span>
                                                                    <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleTreeFileSelect(zone.id, e)} />
                                                                </label>
                                                            </div>
                                                        )}
                                                    </div>

                                                    <div className="mt-2">
                                                        <button
                                                            onClick={() => analyzeTreeGroup(zone.id)}
                                                            disabled={photoUrls.length === 0}
                                                            className={\`w-full py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors \${
                                                                photoUrls.length === 0
                                                                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                                                  : 'bg-green-600 text-white hover:bg-green-700'
                                                            }\`}
                                                        >
                                                            {hasResult ? 'Reanalizar este árbol' : 'Analizar este árbol'}
                                                        </button>
                                                        {photoUrls.length === 0 && (
                                                            <p className="text-xs text-center text-amber-600 mt-2">
                                                                Añade al menos una foto para analizar
                                                            </p>
                                                        )}
                                                    </div>

                                                    {hasResult && (
                                                        <div className="mt-4 bg-white p-4 rounded-xl border border-gray-200 shadow-sm animate-in fade-in slide-in-from-bottom-2 relative overflow-hidden">
                                                            <div className={\`absolute top-0 left-0 w-1 h-full \${
                                                                zone.analysisLevel === 3 ? 'bg-red-500' :
                                                                zone.analysisLevel === 2 ? 'bg-amber-500' : 'bg-green-500'
                                                            }\`}></div>
                                                            
                                                            <div className="flex justify-between items-start">
                                                                <div>
                                                                    {zone.analysisLevel === 3 ? (
                                                                        <div className="mt-1 text-xs font-medium text-red-600">
                                                                            Análisis fallido
                                                                        </div>
                                                                    ) : (
                                                                        <>
                                                                            <div className="flex items-center gap-2">
                                                                                <h4 className="font-semibold text-gray-900 text-sm">
                                                                                    Resultado del análisis
                                                                                </h4>
                                                                            </div>
                                                                            <div className="grid grid-cols-2 gap-4 mt-3">
                                                                                <div>
                                                                                    <span className="block text-xs text-gray-500 mb-1">Altura estimada</span>
                                                                                    <div className="font-medium text-gray-900">{Number.isFinite(height) && height > 0 ? \`\${height.toFixed(1)} m\` : '-'}</div>
                                                                                </div>
                                                                                <div>
                                                                                    <span className="block text-xs text-gray-500 mb-1">Dificultad detectada</span>
                                                                                    <div className="font-medium text-gray-900">{zone.difficultyHigh ? 'Alta' : 'Normal'}</div>
                                                                                </div>
                                                                            </div>

                                                                            <div className={\`mt-3 text-xs font-medium \${
                                                                                zone.analysisLevel === 1 ? 'text-green-600' : 'text-amber-600'
                                                                            }\`}>
                                                                                {zone.analysisLevel === 1 ? 'Análisis fiable' : 'Análisis con observaciones'}
                                                                            </div>
                                                                        </>
                                                                    )}
                                                                </div>
                                                                <button 
                                                                    onClick={() => {
                                                                        const next = [...(bookingData.treeGroups || [])];
                                                                        const idxToUpdate = next.findIndex(x => x.id === zone.id);
                                                                        if (idxToUpdate !== -1) {
                                                                            next[idxToUpdate].analysisLevel = undefined;
                                                                            next[idxToUpdate].isFailed = undefined;
                                                                            next[idxToUpdate].aiHeightMeters = undefined;
                                                                            next[idxToUpdate].difficultyHigh = undefined;
                                                                            next[idxToUpdate].observations = undefined;
                                                                            const newHours = calculateTotalTreeHours(next);
                                                                            setBookingData({ treeGroups: next, estimatedHours: newHours });
                                                                            if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { treeGroups: next, estimatedHours: newHours });
                                                                        }
                                                                    }}
                                                                    className="absolute top-3 right-3 text-gray-400 hover:text-red-500 transition-colors"
                                                                    title="Eliminar resultado"
                                                                >
                                                                    <Trash2 className="w-4 h-4" />
                                                                </button>
                                                            </div>

                                                            {isOver9 && (
                                                                <div className="mt-3 p-3 bg-amber-50 rounded-lg text-xs text-amber-800 border border-amber-200 flex items-start gap-2">
                                                                    <AlertTriangle className="w-4 h-4 shrink-0" />
                                                                    <span>El profesional tendrá que verificar el pago porque es un servicio muy complejo.</span>
                                                                </div>
                                                            )}

                                                            {zone.analysisLevel !== undefined && zone.analysisLevel >= 2 && zone.observations && zone.observations.length > 0 && (
                                                                <div className="mt-3 p-3 bg-gray-50 rounded-lg text-xs text-gray-600 border border-gray-100">
                                                                    <div className="font-medium mb-1 text-gray-700">Observaciones:</div>
                                                                    <ul className="list-disc list-inside space-y-0.5 ml-1">
                                                                        {zone.observations.map((obs, k) => <li key={k}>{obs}</li>)}
                                                                    </ul>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}`;
    content = content.substring(0, idx1) + newText + content.substring(idx2 + endBlock.length);
    fs.writeFileSync(file, content, 'utf8');
    console.log("Replaced successfully!");
} else {
    console.log("Could not find blocks. idx1:", idx1, "idx2:", idx2);
}
