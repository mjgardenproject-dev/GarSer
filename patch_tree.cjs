const fs = require('fs');

const file = 'src/pages/reserva/DetailsPage.tsx';
let content = fs.readFileSync(file, 'utf8');

const targetStart = "if (isTreeService) {";
const targetEnd = "if (isShrubService) {";

const startIndex = content.indexOf(targetStart);
const endIndex = content.indexOf(targetEnd);

if (startIndex === -1 || endIndex === -1) {
  console.error("No se encontraron los límites para isTreeService.");
  process.exit(1);
}

const replacement = `if (isTreeService) {
                     return (
                         <div className="space-y-6">
                             {(!bookingData.treeGroups || bookingData.treeGroups.length === 0) && (
                                 <div className="text-center py-8 bg-white rounded-xl border border-gray-200 shadow-sm">
                                     <Trees className="w-12 h-12 text-green-500 mx-auto mb-3" />
                                     <h3 className="text-lg font-medium text-gray-900 mb-1">Añade tus árboles</h3>
                                     <p className="text-gray-500 text-sm mb-4 max-w-xs mx-auto">
                                         Añade cada árbol o grupo de árboles para estimar el tiempo de poda.
                                     </p>
                                     <button onClick={addTreeGroup} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium mt-4">+ Añadir grupo de árboles</button>
                                 </div>
                             )}
                             {(bookingData.treeGroups || []).map((zone, idx) => {
                                 const isAnalyzed = zone.analysisLevel !== undefined;
                                 const photoUrls = zone.photoUrls || [];
                                 const isZoneAnalyzing = treeAnalyzingZoneIds.has(zone.id);
                                 const isFailedResult = (zone as any).isFailed === true || zone.analysisLevel === 3;
                                 const hasResult = isAnalyzed || isFailedResult;

                                 if (isZoneAnalyzing) {
                                     return <AnalysisLoadingAnimation key={zone.id} message="Analizando árboles..." />;
                                 }

                                 return (
                                     <div key={zone.id} className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
                                         <div className="flex justify-between items-center mb-4 pb-2 border-b border-gray-100">
                                             <div className="flex items-center gap-2">
                                                 <div className="w-6 h-6 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-xs font-bold">
                                                     {idx + 1}
                                                 </div>
                                                 <h3 className="font-semibold text-gray-900">Grupo de Árboles {idx + 1}</h3>
                                                <span className="text-xs text-gray-500 ml-1 font-normal">({photoUrls.length}/5 fotos)</span>
                                             </div>
                                             <button onClick={() => removeTreeGroup(zone.id)} className="text-gray-400 hover:text-red-500 p-2 hover:bg-red-50 rounded-lg transition-colors"><Trash2 className="w-5 h-5" /></button>
                                         </div>
                                         
                                         <ZonePhotoGallery
                                             photos={photoUrls}
                                             uploadingIndices={treeUploads[zone.id] || new Set()}
                                             selectedIndices={zone.selectedIndices ?? Array.from({ length: photoUrls.length }, (_, i) => i)}
                                             analyzedIndices={zone.analyzedIndices ?? (isAnalyzed ? Array.from({ length: photoUrls.length }, (_, i) => i) : [])}
                                             isAnalyzing={isZoneAnalyzing}
                                             isAnalyzed={hasResult}
                                             maxPhotos={5}
                                             onToggleSelection={(i) => toggleTreePhotoSelection(zone.id, i)}
                                             onRemovePhoto={(i) => removeTreePhoto(zone.id, i)}
                                             onAddPhotos={(e) => handleTreeFileSelect(zone.id, e)}
                                             emptyText="Fotos de este grupo"
                                         />

                                         <div className="mt-2">
                                             <ZoneActionButton
                                                 isAnalyzing={isZoneAnalyzing}
                                                 isAnalyzed={hasResult}
                                                 disabled={isZoneAnalyzing || photoUrls.length === 0}
                                                 onClick={() => {
                                                     if (hasResult) {
                                                         const next = [...(bookingData.treeGroups || [])];
                                                         const z = next.find(x => x.id === zone.id);
                                                         if (z) {
                                                             z.analysisLevel = undefined;
                                                             z.aiHeightMeters = 0;
                                                             z.difficultyHigh = false;
                                                             z.observations = [];
                                                             z.isFailed = false;
                                                             z.estimatedHours = 0;
                                                             const newHours = calculateTotalTreeHours(next);
                                                             setBookingData({ treeGroups: next, estimatedHours: newHours });
                                                             if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { treeGroups: next, estimatedHours: newHours });
                                                         }
                                                     }
                                                     setTimeout(() => analyzeTreeGroup(zone.id), 0);
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
                                                        onReanalyze={() => analyzeTreeGroup(zone.id)} 
                                                    />
                                                ) : (
                                                    <ServiceResultCard
                                                        title={zone.pruningType === 'shaping' ? 'Poda de Formación' : 'Poda Estructural'}
                                                        analysisLevel={zone.analysisLevel}
                                                        stats={[
                                                            { label: 'Altura', value: Number(zone.aiHeightMeters || 0) > 0 ? \`\${Number(zone.aiHeightMeters).toFixed(1)}m\` : '-' },
                                                            { label: 'Dificultad', value: zone.difficultyHigh ? 'Alta' : 'Normal' }
                                                        ]}
                                                        observations={zone.observations}
                                                        onDelete={() => removeTreeAnalysisResult(zone.id)}
                                                    />
                                                )}
                                                {Number(zone.aiHeightMeters || 0) > 9 && (
                                                    <div className="mt-1 text-[10px] text-amber-700 bg-amber-50 p-1.5 rounded border border-amber-100">
                                                        El profesional tendrá que verificar el pago porque es un servicio muy complejo.
                                                    </div>
                                                )}
                                            </div>
                                         )}
                                     </div>
                                 );
                             })}

                             {(() => {
                                 const zones = bookingData.treeGroups || [];
                                 const pending = zones.filter((z: any) => z.analysisLevel === undefined && (z.photoUrls || []).length > 0);
                                 if (zones.length <= 1 || pending.length <= 1) return null;
                                 const isBatchAnalyzing = treeAnalyzingZoneIds.size > 0;
                                 return (
                                     <button
                                         onClick={analyzeAllPendingTreeGroups}
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
                                                 Analizando árboles...
                                             </>
                                         ) : (\`Analizar \${pending.length} árbol\${pending.length === 1 ? '' : 'es'}\`)}
                                     </button>
                                 );
                             })()}

                             {(bookingData.treeGroups && bookingData.treeGroups.length > 0) && (
                                 <button onClick={addTreeGroup} className="w-full py-4 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 font-medium hover:bg-gray-50 flex items-center justify-center gap-2 group">
                                     <span className="w-6 h-6 rounded-full bg-gray-200 text-gray-500 flex items-center justify-center text-sm group-hover:bg-gray-300 transition-colors">+</span>
                                     Añadir otro árbol
                                 </button>
                             )}
                         </div>
                     );
                   }

                   `;

const newContent = content.substring(0, startIndex) + replacement + content.substring(endIndex);

fs.writeFileSync(file, newContent, 'utf8');
console.log('Parche aplicado correctamente a isTreeService.');
