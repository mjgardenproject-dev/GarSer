const fs = require('fs');
const content = fs.readFileSync('src/pages/reserva/DetailsPage.tsx', 'utf8');
const oldStr = fs.readFileSync('temp.txt', 'utf8');

const newStr = `                                         {/* Photos Area for this Zone */}
                                         <ZonePhotoGallery
                                             photos={allPhotos}
                                             uploadingIndices={lawnUploads[zone.id]}
                                             selectedIndices={zone.selectedIndices}
                                             analyzedIndices={zone.analyzedIndices}
                                             isAnalyzing={isZoneAnalyzing}
                                             isAnalyzed={isAnalyzed}
                                             onToggleSelection={(i) => toggleLawnPhotoSelection(zone.id, i)}
                                             onRemovePhoto={(i) => removePhotoFromZone(zone.id, i)}
                                             onAddPhotos={(e) => handleLawnFileSelect(zone.id, e)}
                                         />

                                         {/* Actions / Results */}
                                         <div className="mt-2">
                                             {!isAnalyzed && allPhotos.length > 0 && (
                                                 <ZoneActionButton
                                                     onClick={() => analyzeLawnZone(zone.id)}
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
                                                {zone.isFailed || zone.analysisLevel === 3 ? (
                                                    <AnalysisFailedCard 
                                                        message={zone.observations?.[0]} 
                                                        onReanalyze={() => analyzeLawnZone(zone.id)} 
                                                    />
                                                ) : (
                                                    <ServiceResultCard
                                                        title={zone.species || 'Césped general'}
                                                        analysisLevel={zone.analysisLevel}
                                                        stats={[
                                                            { label: 'Superficie', value: \`\${zone.quantity} m²\` },
                                                            { label: 'Estado', value: <span className="capitalize">{zone.state}</span> }
                                                        ]}
                                                        observations={zone.observations}
                                                        onDelete={() => {
                                                            openConfirm('¿Eliminar resultado?', 'Se borrarán los datos del análisis, pero las fotos se mantendrán para poder re-analizar.', () => {
                                                                const zones = [...(bookingData.lawnZones || [])];
                                                                const idx = zones.findIndex(z => z.id === zone.id);
                                                                if (idx !== -1) {
                                                                    zones[idx] = { ...zones[idx], quantity: 0, species: '', state: 'normal', analysisLevel: undefined, observations: [], analyzedIndices: [] };
                                                                    setBookingData({ lawnZones: zones });
                                                                    if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { lawnZones: zones });
                                                                }
                                                            });
                                                        }}
                                                    />
                                                )}
                                                
                                                <div className="mt-3">
                                                    <ZoneActionButton
                                                         onClick={() => analyzeLawnZone(zone.id)}
                                                         isAnalyzing={isZoneAnalyzing}
                                                         isAnalyzed={isAnalyzed}
                                                         disabled={isZoneAnalyzing || (zone.selectedIndices !== undefined && zone.selectedIndices.length === 0) || allPhotos.length === 0}
                                                     />
                                                </div>
                                             </div>
                                         )}`;

if (content.includes(oldStr.trim())) {
    fs.writeFileSync('src/pages/reserva/DetailsPage.tsx', content.replace(oldStr.trim(), newStr.trim()));
    console.log('Success');
} else {
    console.log('Failed to find string');
}