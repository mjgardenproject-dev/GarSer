const fs = require('fs');

const file = 'src/pages/reserva/DetailsPage.tsx';
let content = fs.readFileSync(file, 'utf8');

const targetStart = "if (isShrubService) {";
const targetEnd = "if (isWeedingService) {";

const startIndex = content.indexOf(targetStart);
const endIndex = content.indexOf(targetEnd);

if (startIndex === -1 || endIndex === -1) {
  console.error("No se encontraron los límites.");
  process.exit(1);
}

const replacement = `if (isShrubService) {
                     return (
                         <div className="space-y-6">
                             {(!bookingData.shrubGroups || bookingData.shrubGroups.length === 0) && (
                                 <div className="text-center py-8 bg-white rounded-xl border border-gray-200 shadow-sm">
                                     <Flower2 className="w-12 h-12 text-green-500 mx-auto mb-3" />
                                     <h3 className="text-lg font-medium text-gray-900 mb-1">Añade tus plantas</h3>
                                     <p className="text-gray-500 text-sm mb-4 max-w-xs mx-auto">
                                         Añade cada grupo o macizo de plantas de manera independiente.
                                     </p>
                                     <button onClick={addShrubGroup} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium mt-4">+ Añadir grupo de plantas</button>
                                 </div>
                             )}
                             {(bookingData.shrubGroups || []).map((group, idx) => {
                                 const isAnalyzed = group.area > 0 || (group.analysisLevel !== undefined);
                                 const allPhotos = [...(group.photoUrls || []), ...(group.files || [])];
                                 const isZoneAnalyzing = shrubAnalyzingZoneIds.has(group.id);

                                 if (isZoneAnalyzing) {
                                     return <AnalysisLoadingAnimation key={group.id} message="Analizando plantas y arbustos..." />;
                                 }

                                 if ((group as any).isFailed || group.analysisLevel === 3) {
                                     return (
                                         <AnalysisFailedCard 
                                             key={group.id}
                                             message={group.observations?.[0]} 
                                             onReanalyze={() => analyzeShrubGroup(group.id)} 
                                         />
                                     );
                                 }

                                 return (
                                     <div key={group.id} className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
                                         <div className="flex justify-between items-center mb-4 pb-2 border-b border-gray-100">
                                             <div className="flex items-center gap-2">
                                                 <div className="w-6 h-6 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-xs font-bold">
                                                     {idx + 1}
                                                 </div>
                                                 <h3 className="font-semibold text-gray-900">Grupo de Plantas {idx + 1}</h3>
                                                <span className="text-xs text-gray-500 ml-1 font-normal">({allPhotos.length}/5 fotos)</span>
                                             </div>
                                             <button onClick={() => removeShrubGroup(group.id)} className="text-gray-400 hover:text-red-500 p-2 hover:bg-red-50 rounded-lg transition-colors"><Trash2 className="w-5 h-5" /></button>
                                         </div>
                                         
                                         <ZonePhotoGallery
                                             photos={allPhotos}
                                             uploadingIndices={shrubUploads[group.id] || new Set()}
                                             selectedIndices={group.selectedIndices ?? Array.from({ length: allPhotos.length }, (_, i) => i)}
                                             analyzedIndices={group.analyzedIndices ?? []}
                                             isAnalyzing={isZoneAnalyzing}
                                             isAnalyzed={isAnalyzed}
                                             maxPhotos={5}
                                             onToggleSelection={(i) => toggleShrubPhotoSelection(group.id, i)}
                                             onRemovePhoto={(i) => removeShrubPhoto(group.id, i)}
                                             onAddPhotos={(e) => handleShrubFileSelect(group.id, e)}
                                             emptyText="Fotos de este grupo"
                                         />

                                         <div className="mt-2">
                                             <ZoneActionButton
                                                 isAnalyzing={isZoneAnalyzing}
                                                 isAnalyzed={isAnalyzed}
                                                 disabled={isZoneAnalyzing || (group.selectedIndices !== undefined && group.selectedIndices.length === 0) || allPhotos.length === 0}
                                                 onClick={() => analyzeShrubGroup(group.id)}
                                                 textAnalyzing="Analizando..."
                                                 textReanalyze="Reanalizar esta zona"
                                                 textAnalyze="Analizar esta zona"
                                             />
                                             {allPhotos.length === 0 && (
                                                 <p className="text-xs text-center text-amber-600 mt-2">
                                                     Añade al menos una foto para analizar
                                                 </p>
                                             )}
                                         </div>

                                         {isAnalyzed && (
                                             <ServiceResultCard
                                                 title="Macizo de plantas y arbustos"
                                                 analysisLevel={group.analysisLevel}
                                                 stats={[
                                                     { label: 'Superficie', value: \`\${group.area} m²\` },
                                                     { label: 'Tamaño dominante', value: <span className="capitalize">{group.size}</span> }
                                                 ]}
                                                 observations={group.observations}
                                             />
                                         )}
                                     </div>
                                 );
                             })}
                             
                             {(() => {
                                 const shrubGroups = bookingData.shrubGroups || [];
                                 const pendingShrubGroups = shrubGroups.filter(zone => !isShrubGroupAnalyzed(zone) && !shrubAnalyzingZoneIds.has(zone.id));
                                if (shrubGroups.length <= 1 || pendingShrubGroups.length <= 1) return null;

                                 return (
                                     <button
                                         onClick={analyzeAllPendingShrubGroups}
                                        disabled={shrubAnalyzingZoneIds.size > 0}
                                         className={\`w-full py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors \${
                                            shrubAnalyzingZoneIds.size > 0
                                             ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                             : 'bg-green-600 text-white hover:bg-green-700'
                                         }\`}
                                     >
                                         {shrubAnalyzingZoneIds.size > 0 ? (
                                             <>
                                                 <div className="animate-spin rounded-full h-4 w-4 border-2 border-green-600 border-t-transparent"></div>
                                                 Analizando zonas...
                                             </>
                                         ) : \`Analizar \${pendingShrubGroups.length} zona\${pendingShrubGroups.length === 1 ? '' : 's'}\`}
                                     </button>
                                 );
                             })()}

                             {(bookingData.shrubGroups && bookingData.shrubGroups.length > 0) && (
                                 <button onClick={addShrubGroup} className="w-full py-4 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 font-medium hover:bg-gray-50 flex items-center justify-center gap-2"><span className="w-6 h-6 rounded-full bg-gray-200 text-gray-500 flex items-center justify-center text-sm">+</span> Añadir otro grupo</button>
                             )}
                         </div>
                     );
                   }

                   `;

const newContent = content.substring(0, startIndex) + replacement + content.substring(endIndex);

fs.writeFileSync(file, newContent, 'utf8');
console.log('Parche aplicado correctamente a isShrubService.');
