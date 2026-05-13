const fs = require('fs');
const content = fs.readFileSync('src/pages/reserva/DetailsPage.tsx', 'utf8');
const oldStr = fs.readFileSync('temp_weeding.txt', 'utf8');

const newStr = `                                     return (
                                         <AnalysisFailedCard 
                                             key={zone.id}
                                             message={zone.observations?.[0]} 
                                             onReanalyze={() => analyzeWeedingZone(zone.id)} 
                                         />
                                     );
                                 }

                                 return (
                                     <div key={zone.id} className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
                                         <div className="flex justify-between items-center mb-4 pb-2 border-b border-gray-100">
                                             <div className="flex items-center gap-2">
                                                 <div className="w-6 h-6 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-xs font-bold">
                                                     {idx + 1}
                                                 </div>
                                                 <h3 className="font-semibold text-gray-900">Zona de Desbroce {idx + 1}</h3>
                                                <span className="text-xs text-gray-500 ml-1 font-normal">({allPhotos.length}/5 fotos)</span>
                                             </div>
                                             <button onClick={() => removeWeedingZone(zone.id)} className="text-gray-400 hover:text-red-500 p-2 hover:bg-red-50 rounded-lg transition-colors"><Trash2 className="w-5 h-5" /></button>
                                         </div>
                                         
                                         <ZonePhotoGallery
                                             photos={allPhotos}
                                             uploadingIndices={weedingUploads[zone.id]}
                                             selectedIndices={zone.selectedIndices}
                                             analyzedIndices={zone.analyzedIndices}
                                             isAnalyzing={isZoneAnalyzing}
                                             isAnalyzed={isAnalyzed}
                                             onToggleSelection={(i) => toggleWeedingPhotoSelection(zone.id, i)}
                                             onRemovePhoto={(i) => removeWeedingPhoto(zone.id, i)}
                                             onAddPhotos={(e) => handleWeedingFileSelect(zone.id, e)}
                                         />

                                         <div className="mt-2">
                                             {!isAnalyzed && allPhotos.length > 0 && (
                                                 <ZoneActionButton
                                                     onClick={() => analyzeWeedingZone(zone.id)}
                                                     isAnalyzing={isZoneAnalyzing}
                                                     isAnalyzed={isAnalyzed}
                                                     disabled={isZoneAnalyzing || (zone.selectedIndices !== undefined && zone.selectedIndices.length === 0)}
                                                 />
                                             )}
                                             {allPhotos.length === 0 && (
                                                 <p className="text-xs text-center text-amber-600 mt-2 mb-4">
                                                     Añade al menos una foto para analizar
                                                 </p>
                                             )}
                                         </div>

                                         {isAnalyzed && (
                                             <div className="mt-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                                                 <ServiceResultCard
                                                     title="Desbroce de malas hierbas"
                                                     analysisLevel={zone.analysisLevel}
                                                     stats={[
                                                         { label: 'Superficie', value: \`\${zone.area} m²\` },
                                                         { label: 'Estado', value: <span className="capitalize">{zone.state.replace(/_/g, ' ')}</span> }
                                                     ]}
                                                     observations={zone.observations}
                                                 />
                                                 <div className="mt-3">
                                                     <ZoneActionButton
                                                         onClick={() => analyzeWeedingZone(zone.id)}
                                                         isAnalyzing={isZoneAnalyzing}
                                                         isAnalyzed={isAnalyzed}
                                                         disabled={isZoneAnalyzing || (zone.selectedIndices !== undefined && zone.selectedIndices.length === 0) || allPhotos.length === 0}
                                                     />
                                                 </div>
                                             </div>
                                         )}
                                     </div>
                                 );
                             })}
                             
                             {(() => {
                                 const weedingZones = bookingData.weedingZones || [];
                                 const pendingWeedingZones = weedingZones.filter(zone => !isWeedingZoneAnalyzed(zone) && !weedingAnalyzingZoneIds.has(zone.id));
                                if (weedingZones.length <= 1 || pendingWeedingZones.length <= 1) return null;`;

if (content.includes(oldStr.trim())) {
    fs.writeFileSync('src/pages/reserva/DetailsPage.tsx', content.replace(oldStr.trim(), newStr.trim()));
    console.log('Success Weeding');
} else {
    console.log('Failed Weeding');
}