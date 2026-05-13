const fs = require('fs');

const file = 'src/pages/reserva/DetailsPage.tsx';
let content = fs.readFileSync(file, 'utf8');

// Add isPalmService
const targetVar = "const isTreeService = debugService.includes('árbol') || debugService.includes('arbol');";
if (content.includes(targetVar)) {
    content = content.replace(targetVar, targetVar + "\\n                   const isPalmService = debugService.toLowerCase().includes('palmera');");
}

const targetStart = "if (isTreeService) {";
const palmRenderBlock = `if (isPalmService) {
                     return (
                         <div className="space-y-6">
                             {(!bookingData.palmGroups || bookingData.palmGroups.length === 0) && (
                                 <div className="text-center py-8 bg-white rounded-xl border border-gray-200 shadow-sm">
                                     <Trees className="w-12 h-12 text-green-500 mx-auto mb-3" />
                                     <h3 className="text-lg font-medium text-gray-900 mb-1">Añade tus palmeras</h3>
                                     <p className="text-gray-500 text-sm mb-4 max-w-xs mx-auto">
                                         Sube una foto por cada tipo de palmera diferente para estimar la poda.
                                     </p>
                                     <button onClick={addPalmGroup} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium mt-4">+ Añadir grupo de palmeras</button>
                                 </div>
                             )}
                             {(bookingData.palmGroups || []).map((zone, idx) => {
                                 const isAnalyzed = zone.analysisLevel !== undefined;
                                 const photoUrls = (zone as any).photoUrls || [];
                                 const isZoneAnalyzing = palmAnalyzingZoneIds.has(zone.id);
                                 const isFailedResult = (zone as any).isFailed === true || zone.analysisLevel === 3;
                                 const hasResult = isAnalyzed || isFailedResult;

                                 if (isZoneAnalyzing) {
                                     return <AnalysisLoadingAnimation key={zone.id} message="Analizando palmeras..." />;
                                 }

                                 return (
                                     <div key={zone.id} className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
                                         <div className="flex justify-between items-center mb-4 pb-2 border-b border-gray-100">
                                             <div className="flex items-center gap-2">
                                                 <div className="w-6 h-6 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-xs font-bold">
                                                     {idx + 1}
                                                 </div>
                                                 <h3 className="font-semibold text-gray-900">Grupo de Palmeras {idx + 1}</h3>
                                                <span className="text-xs text-gray-500 ml-1 font-normal">({photoUrls.length}/5 fotos)</span>
                                             </div>
                                             <button onClick={() => removePalmGroup(zone.id)} className="text-gray-400 hover:text-red-500 p-2 hover:bg-red-50 rounded-lg transition-colors"><Trash2 className="w-5 h-5" /></button>
                                         </div>
                                         
                                         <ZonePhotoGallery
                                             photos={photoUrls}
                                             uploadingIndices={palmUploads[zone.id] || new Set()}
                                             selectedIndices={(zone as any).selectedIndices ?? Array.from({ length: photoUrls.length }, (_, i) => i)}
                                             analyzedIndices={(zone as any).analyzedIndices ?? (isAnalyzed ? Array.from({ length: photoUrls.length }, (_, i) => i) : [])}
                                             isAnalyzing={isZoneAnalyzing}
                                             isAnalyzed={hasResult}
                                             maxPhotos={5}
                                             onToggleSelection={(i) => togglePalmPhotoSelection(zone.id, i)}
                                             onRemovePhoto={(i) => removePalmPhoto(zone.id, i)}
                                             onAddPhotos={(e) => handlePalmFileSelect(zone.id, e)}
                                             emptyText="Fotos de este grupo"
                                         />

                                         <div className="mt-2">
                                             <ZoneActionButton
                                                 isAnalyzing={isZoneAnalyzing}
                                                 isAnalyzed={hasResult}
                                                 disabled={isZoneAnalyzing || photoUrls.length === 0}
                                                 onClick={() => {
                                                     if (hasResult) {
                                                         const next = [...(bookingData.palmGroups || [])];
                                                         const z = next.find(x => x.id === zone.id);
                                                         if (z) {
                                                             z.analysisLevel = undefined;
                                                             z.observations = [];
                                                             (z as any).isFailed = false;
                                                             setBookingData({ palmGroups: next });
                                                             if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { palmGroups: next });
                                                         }
                                                     }
                                                     setTimeout(() => analyzePalmGroup(zone.id), 0);
                                                 }}
                                                 textAnalyzing="Analizando..."
                                                 textReanalyze="Reanalizar esta zona"
                                                 textAnalyze="Analizar esta zona"
                                             />
                                             {photoUrls.length === 0 && (
                                                 <p className="text-xs text-center text-amber-600 mt-2">
                                                     Añade al menos una foto para analizar
                                                 </p>
                                             )}
                                         </div>

                                         {hasResult && (
                                            <div className="mt-4">
                                                {isFailedResult ? (
                                                    <AnalysisFailedCard 
                                                        message={zone.observations?.[0] || 'Intenta hacer la foto desde otro ángulo.'} 
                                                        onReanalyze={() => analyzePalmGroup(zone.id)} 
                                                    />
                                                ) : (
                                                    <ServiceResultCard
                                                        title={zone.species || 'Desconocida'}
                                                        analysisLevel={zone.analysisLevel}
                                                        stats={[
                                                            { label: 'Altura', value: zone.height || '-' },
                                                            { label: 'Estado', value: <span className="capitalize">{zone.state || 'normal'}</span> }
                                                        ]}
                                                        observations={zone.observations}
                                                        onDelete={() => removePalmGroup(zone.id)}
                                                    />
                                                )}
                                            </div>
                                         )}
                                     </div>
                                 );
                             })}

                             {(() => {
                                 const zones = bookingData.palmGroups || [];
                                 const pending = zones.filter((z: any) => z.analysisLevel === undefined && (z.photoUrls || []).length > 0);
                                 if (zones.length <= 1 || pending.length <= 1) return null;
                                 const isBatchAnalyzing = palmAnalyzingZoneIds.size > 0;
                                 return (
                                     <button
                                         onClick={analyzeAllPendingPalmGroups}
                                         disabled={isBatchAnalyzing}
                                         className={\`w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors \${
                                             isBatchAnalyzing
                                               ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                               : 'bg-green-600 text-white hover:bg-green-700'
                                         }\`}
                                     >
                                         {isBatchAnalyzing ? (
                                             <>
                                                 <div className="animate-spin rounded-full h-4 w-4 border-2 border-green-600 border-t-transparent"></div>
                                                 Analizando palmeras...
                                             </>
                                         ) : (\`Analizar \${pending.length} grupo\${pending.length === 1 ? '' : 's'}\`)}
                                     </button>
                                 );
                             })()}

                             {(bookingData.palmGroups && bookingData.palmGroups.length > 0) && (
                                 <button onClick={addPalmGroup} className="w-full py-4 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 font-medium hover:bg-gray-50 flex items-center justify-center gap-2 group">
                                     <span className="w-6 h-6 rounded-full bg-gray-200 text-gray-500 flex items-center justify-center text-sm group-hover:bg-gray-300 transition-colors">+</span>
                                     Añadir otro grupo de palmeras
                                 </button>
                             )}
                         </div>
                     );
                   }

                   `;

if (content.includes(targetStart)) {
    content = content.replace(targetStart, palmRenderBlock + targetStart);
    fs.writeFileSync(file, content, 'utf8');
    console.log('Palm render block injected');
} else {
    console.error('Target not found for palm render');
}
