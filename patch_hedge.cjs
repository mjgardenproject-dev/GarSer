const fs = require('fs');

const file = 'src/pages/reserva/DetailsPage.tsx';
let content = fs.readFileSync(file, 'utf8');

const targetStart = "if (isHedgeService) {";
const targetEnd = "if (isTreeService) {";

const startIndex = content.indexOf(targetStart);
const endIndex = content.indexOf(targetEnd);

if (startIndex === -1 || endIndex === -1) {
  console.error("No se encontraron los límites para isHedgeService.");
  process.exit(1);
}

const replacement = `if (isHedgeService) {
                     return (
                         <div className="space-y-6">
                             {(!bookingData.hedgeZones || bookingData.hedgeZones.length === 0) && (
                                 <div className="text-center py-8 bg-white rounded-xl border border-gray-200 shadow-sm">
                                     <Scissors className="w-12 h-12 text-green-500 mx-auto mb-3" />
                                     <h3 className="text-lg font-medium text-gray-900 mb-1">Añade tu zona de setos</h3>
                                     <p className="text-gray-500 text-sm mb-4 max-w-xs mx-auto">
                                         Añade una zona por cada tramo de seto diferente.
                                     </p>
                                     <button 
                                         onClick={addHedgeZone}
                                         className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium mt-4"
                                     >
                                         + Añadir primera zona
                                     </button>
                                 </div>
                             )}

                            {(bookingData.hedgeZones || []).map((zone, idx) => {
                                const normalizedZone = normalizeHedgeZone(zone);
                                const isAnalyzed = isHedgeZoneAnalyzed(normalizedZone);
                                const isZoneAnalyzing = hedgeAnalyzingZoneIds.has(zone.id);
                                const faceAUrls = normalizedZone.faceA.photoUrls || [];
                                const faceASelected = normalizedZone.faceA.selectedIndices ?? Array.from({ length: faceAUrls.length }, (_, i) => i);
                                const hasFaceAPhotos = faceAUrls.length > 0;
                                const hasFaceASelected = faceASelected.length > 0;
                                const totalPhotos = (normalizedZone.faceA.photoUrls?.length || 0) + (normalizedZone.faceB.photoUrls?.length || 0);

                                if (isZoneAnalyzing) {
                                    return <AnalysisLoadingAnimation key={zone.id} message="Analizando esta zona..." />;
                                }

                                if ((zone as any).isFailed || zone.analysisLevel === 3) {
                                    return (
                                        <AnalysisFailedCard 
                                            key={zone.id}
                                            message={zone.observations?.[0]} 
                                            onReanalyze={() => analyzeHedgeZone(zone.id)} 
                                        />
                                    );
                                }

                                 return (
                                     <div key={zone.id} className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
                                         <div className="flex justify-between items-center mb-4 pb-2 border-b border-gray-100">
                                             <div className="flex items-center gap-2">
                                                 <div className="w-6 h-6 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-xs font-bold">{idx + 1}</div>
                                                <h3 className="font-semibold text-gray-900">Zona de Setos {idx + 1}</h3>
                                                <span className="text-xs text-gray-500 ml-1 font-normal">({totalPhotos}/10 fotos)</span>
                                             </div>
                                             <button onClick={() => removeHedgeZone(zone.id)} className="text-gray-400 hover:text-red-500 p-2 hover:bg-red-50 rounded-lg transition-colors">
                                                 <Trash2 className="w-5 h-5" />
                                             </button>
                                         </div>

                                         <div className="mb-4">
                                           <div className="mb-3 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                                               Sube fotos por cara para evitar confusiones: Cara A es la delantera y es obligatoria para analizar; Cara B es la trasera y opcional.
                                           </div>
                                           {([
                                               { key: 'faceA', title: 'Cara A (delantera)', required: true },
                                               { key: 'faceB', title: 'Cara B (trasera)', required: false },
                                           ] as Array<{ key: HedgeFaceKey; title: string; required: boolean }>).map((faceBlock) => {
                                               const face = normalizedZone[faceBlock.key];
                                               const allFacePhotos = [...(face.photoUrls || []), ...(face.files || [])];
                                               const uploadKey = \`\${zone.id}-\${faceBlock.key}\`;

                                               return (
                                                   <div key={faceBlock.key} className="mb-3 rounded-lg border border-gray-200 p-3">
                                                       <div className="mb-2 flex items-center justify-between">
                                                           <div className="flex items-center gap-2">
                                                               <span className="text-sm font-medium text-gray-900">{faceBlock.title}</span>
                                                               {faceBlock.required ? (
                                                                   <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">Obligatoria</span>
                                                               ) : (
                                                                   <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600">Opcional</span>
                                                               )}
                                                           </div>
                                                       </div>
                                                       
                                                       <ZonePhotoGallery
                                                           photos={allFacePhotos}
                                                           uploadingIndices={hedgeUploads[uploadKey] || new Set()}
                                                           selectedIndices={face.selectedIndices ?? Array.from({ length: allFacePhotos.length }, (_, i) => i)}
                                                           analyzedIndices={face.analyzedIndices ?? []}
                                                           isAnalyzing={isZoneAnalyzing}
                                                           isAnalyzed={isAnalyzed}
                                                           maxPhotos={5}
                                                           onToggleSelection={(i) => toggleHedgePhotoSelection(zone.id, faceBlock.key, i)}
                                                           onRemovePhoto={(i) => removePhotoFromHedgeZone(zone.id, faceBlock.key, i)}
                                                           onAddPhotos={(e) => handleHedgeFileSelect(zone.id, faceBlock.key, e)}
                                                           emptyText={\`Fotos \${faceBlock.title}\`}
                                                       />

                                                       {faceBlock.required && allFacePhotos.length === 0 && (
                                                           <p className="mt-2 text-xs text-amber-600">
                                                               Debes subir al menos una foto de la Cara A para continuar.
                                                           </p>
                                                       )}
                                                   </div>
                                               );
                                           })}
                                         </div>

                                        <div className="mt-2">
                                            <ZoneActionButton
                                                 isAnalyzing={isZoneAnalyzing}
                                                 isAnalyzed={isAnalyzed}
                                                 disabled={isZoneAnalyzing || !hasFaceAPhotos || !hasFaceASelected}
                                                 onClick={() => analyzeHedgeZone(zone.id)}
                                                 textAnalyzing="Analizando..."
                                                 textReanalyze="Reanalizar esta zona"
                                                 textAnalyze="Analizar esta zona"
                                            />
                                        </div>

                                        {isAnalyzed && (
                                            <ServiceResultCard
                                                title={zone.type || '1-2m'}
                                                analysisLevel={zone.analysisLevel}
                                                stats={[
                                                    { label: 'Longitud', value: \`\${zone.length} m\` },
                                                    { label: 'Altura', value: zone.height },
                                                    { label: 'Estado', value: <span className="capitalize">{zone.state || 'normal'}</span> },
                                                    { label: 'Caras analizadas', value: Number((zone as any).faces_to_trim ?? (zone.hasBackFaceTrim ? 2 : 1)) }
                                                ]}
                                                observations={zone.observations}
                                            />
                                        )}
                                     </div>
                                 );
                             })}

                             {(() => {
                                 const hedgeZones = bookingData.hedgeZones || [];
                                 const pendingHedgeZones = hedgeZones.filter(zone => !isHedgeZoneAnalyzed(zone) && !hedgeAnalyzingZoneIds.has(zone.id));
                                 if (hedgeZones.length <= 1 || pendingHedgeZones.length <= 1) return null;

                                 return (
                                     <button
                                         onClick={analyzeAllPendingHedgeZones}
                                         disabled={hedgeAnalyzingZoneIds.size > 0}
                                         className={\`w-full py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors \${
                                            hedgeAnalyzingZoneIds.size > 0
                                             ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                             : 'bg-green-600 text-white hover:bg-green-700'
                                         }\`}
                                     >
                                         {hedgeAnalyzingZoneIds.size > 0 ? (
                                             <>
                                                 <div className="animate-spin rounded-full h-4 w-4 border-2 border-green-600 border-t-transparent"></div>
                                                 Analizando zonas...
                                             </>
                                         ) : \`Analizar \${pendingHedgeZones.length} zona\${pendingHedgeZones.length === 1 ? '' : 's'}\`}
                                     </button>
                                 );
                             })()}

                             {(bookingData.hedgeZones && bookingData.hedgeZones.length > 0) && (
                                 <button onClick={addHedgeZone} className="w-full py-4 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 font-medium hover:bg-gray-50 flex items-center justify-center gap-2">
                                     <span className="w-6 h-6 rounded-full bg-gray-200 text-gray-500 flex items-center justify-center text-sm">+</span> 
                                     Añadir otra zona
                                 </button>
                             )}
                         </div>
                     );
                   }

                   `;

const newContent = content.substring(0, startIndex) + replacement + content.substring(endIndex);

fs.writeFileSync(file, newContent, 'utf8');
console.log('Parche aplicado correctamente a isHedgeService.');
