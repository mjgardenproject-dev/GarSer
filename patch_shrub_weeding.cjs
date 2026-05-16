const fs = require('fs');
const content = fs.readFileSync('src/pages/reserva/DetailsPage.tsx', 'utf8');

// For Weeding
const weedingOldStr = `                                         <div className="mb-4">
                                            <div className="text-xs text-gray-500 mb-2">Fotos de esta zona ({allPhotos.length})</div>
                                            <div className="flex flex-row overflow-x-auto gap-3 pb-2 snap-x items-center scrollbar-hide min-h-[110px]">
                                                {allPhotos.map((p, i) => {
                                                    const isSelected = zone.selectedIndices?.includes(i) ?? true;
                                                    const isAnalyzedPhoto = zone.analyzedIndices?.includes(i);
                                                    
                                                    return (
                                                        <div 
                                                            key={i} 
                                                            className={\`relative shrink-0 snap-start group cursor-pointer \${isSelected ? 'p-0.5' : ''}\`}
                                                            onClick={() => toggleWeedingPhotoSelection(zone.id, i)}
                                                        >
                                                            <div className={\`relative w-24 h-24 rounded-lg overflow-hidden border transition-all duration-300 \${isSelected ? 'border-2 border-green-500 shadow-md' : 'border-gray-200 shadow-sm'} \${isAnalyzedPhoto ? 'opacity-80' : 'opacity-100'}\`}>
                                                               <img 
                                                                   src={typeof p === 'string' ? p : URL.createObjectURL(p)} 
                                                                   alt={\`Foto \${i}\`}
                                                                   className={\`w-full h-full object-cover transition-all duration-700 ease-in-out \${weedingUploads[zone.id]?.has(i) ? 'scale-110 blur-sm brightness-50' : 'scale-100 blur-0 brightness-100'}\`}
                                                               />
                                                               
                                                               {weedingUploads[zone.id]?.has(i) && (
                                                                   <div className="absolute inset-0 flex items-center justify-center bg-black/20 z-20 transition-opacity duration-300">
                                                                       <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                                                   </div>
                                                               )}
                                                               
                                                                {isAnalyzedPhoto && (
                                                                    <div className="absolute bottom-1 left-1 bg-green-500 text-white text-[8px] font-bold px-1.5 py-0.5 rounded shadow-sm z-10">
                                                                        Analizada
                                                                    </div>
                                                                )}
                                                                
                                                                <div className={\`absolute top-1 left-1 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all z-20 \${isSelected ? 'bg-green-500 border-green-500 scale-100' : 'bg-black/20 border-white/80 group-hover:bg-black/40 scale-90 group-hover:scale-100'}\`}>
                                                                    {isSelected && <CheckCircle className="w-3.5 h-3.5 text-white" />}
                                                                </div>
                                                            </div>
                                                            
                                                            {!isZoneAnalyzing && (
                                                               <button
                                                                   onClick={(e) => { e.stopPropagation(); removeWeedingPhoto(zone.id, i); }}
                                                                   className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1.5 hover:bg-red-600 shadow-sm transition-colors z-10"
                                                               >
                                                                   <Trash2 className="w-3.5 h-3.5" />
                                                               </button>
                                                           )}
                                                        </div>
                                                    );
                                                })}
                                                
                                               {!isZoneAnalyzing && allPhotos.length < 5 && (
                                                   <div className="w-24 h-24 shrink-0 flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 hover:bg-gray-100 hover:border-green-400 transition-colors cursor-pointer group snap-start">
                                                        <label className="w-full h-full flex flex-col items-center justify-center cursor-pointer">
                                                            <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center group-hover:bg-green-100 transition-colors mb-1">
                                                                <Image className="w-4 h-4 text-gray-500 group-hover:text-green-600" />
                                                            </div>
                                                            <span className="text-[10px] font-medium text-gray-500 group-hover:text-green-700">Añadir foto</span>
                                                            <input 
                                                                type="file" 
                                                                accept="image/*" 
                                                                multiple 
                                                                className="hidden" 
                                                                onChange={(e) => handleWeedingFileSelect(zone.id, e)}
                                                            />
                                                        </label>
                                                    </div>
                                                )}
                                            </div>
                                         </div>

                                         <div className="mt-2">
                                             <button
                                                 onClick={() => analyzeWeedingZone(zone.id)}
                                                 disabled={isZoneAnalyzing || (zone.selectedIndices !== undefined && zone.selectedIndices.length === 0) || allPhotos.length === 0}
                                                 className={\`w-full py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2 mb-3 transition-colors \${
                                                     isZoneAnalyzing || (zone.selectedIndices !== undefined && zone.selectedIndices.length === 0) || allPhotos.length === 0
                                                     ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                                                     : 'bg-green-600 text-white hover:bg-green-700'
                                                 }\`}
                                             >
                                                 {isZoneAnalyzing ? (
                                                     <>
                                                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-green-600 border-t-transparent"></div>
                                                        Analizando...
                                                     </>
                                                 ) : (
                                                     isAnalyzed ? 'Reanalizar esta zona' : 'Analizar esta zona'
                                                 )}
                                             </button>
                                             {allPhotos.length === 0 && (
                                                 <p className="text-xs text-center text-amber-600 mt-2">
                                                     Añade al menos una foto para analizar
                                                 </p>
                                             )}
                                         </div>

                                         {isAnalyzed && (
                                             <div className="mt-4 bg-white p-4 rounded-xl border border-gray-200 shadow-sm animate-in fade-in slide-in-from-bottom-2 duration-300 relative overflow-hidden">
                                                <div className={\`absolute top-0 left-0 w-1 h-full \${zone.analysisLevel === 2 ? 'bg-amber-500' : 'bg-green-500'}\`}></div>
                                                
                                                <div className="flex justify-between items-start">
                                                    <div>
                                                        <h4 className="font-semibold text-gray-900 text-sm">
                                                            Desbroce de malas hierbas
                                                        </h4>
                                                        <div className="flex items-center gap-2 text-xs text-gray-600 mt-1">
                                                            <span>
                                                                Superficie: <span className="font-medium text-gray-900">{zone.area} m²</span>
                                                            </span>
                                                            <span className="text-gray-300">|</span>
                                                            <span>
                                                                Estado: <span className="font-medium text-gray-900 capitalize">{zone.state.replace(/_/g, ' ')}</span>
                                                            </span>
                                                        </div>
                                                        <div className={\`mt-2 text-xs font-medium \${zone.analysisLevel === 1 ? 'text-green-600' : 'text-amber-600'}\`}>
                                                            {zone.analysisLevel === 1 ? 'Análisis fiable' : 'Análisis con observaciones'}
                                                        </div>
                                                    </div>
                                                </div>

                                                {zone.observations && zone.observations.length > 0 && (
                                                    <div className="mt-3 p-3 bg-gray-50 rounded-lg text-xs text-gray-600 border border-gray-100">
                                                        <div className="font-medium mb-1 text-gray-700">Observaciones:</div>
                                                        <ul className="list-disc list-inside space-y-0.5 ml-1">
                                                            {zone.observations.map((obs, k) => (
                                                                <li key={k}>{obs}</li>
                                                            ))}
                                                        </ul>
                                                    </div>
                                                )}
                                             </div>
                                         )}`;

const weedingNewStr = `                                         <ZonePhotoGallery
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
                                                     onDelete={() => removeWeedingZone(zone.id)}
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
                                         )}`;

// Shrub
const shrubOldStr = `                                         <div className="mb-4">
                                            <div className="text-xs text-gray-500 mb-2">Fotos de esta zona ({allPhotos.length})</div>
                                            <div className="flex flex-row overflow-x-auto gap-3 pb-2 snap-x items-center scrollbar-hide min-h-[110px]">
                                                {allPhotos.map((p, i) => {
                                                    const isSelected = group.selectedIndices?.includes(i) ?? true;
                                                    const isAnalyzedPhoto = group.analyzedIndices?.includes(i);
                                                    
                                                    return (
                                                        <div 
                                                            key={i} 
                                                            className={\`relative shrink-0 snap-start group cursor-pointer \${isSelected ? 'p-0.5' : ''}\`}
                                                            onClick={() => toggleShrubPhotoSelection(group.id, i)}
                                                        >
                                                            <div className={\`relative w-24 h-24 rounded-lg overflow-hidden border transition-all duration-300 \${isSelected ? 'border-2 border-green-500 shadow-md' : 'border-gray-200 shadow-sm'} \${isAnalyzedPhoto ? 'opacity-80' : 'opacity-100'}\`}>
                                                               <img 
                                                                   src={typeof p === 'string' ? p : URL.createObjectURL(p)} 
                                                                   alt={\`Foto \${i}\`}
                                                                   className={\`w-full h-full object-cover transition-all duration-700 ease-in-out \${shrubUploads[group.id]?.has(i) ? 'scale-110 blur-sm brightness-50' : 'scale-100 blur-0 brightness-100'}\`}
                                                               />
                                                               
                                                               {shrubUploads[group.id]?.has(i) && (
                                                                   <div className="absolute inset-0 flex items-center justify-center bg-black/20 z-20 transition-opacity duration-300">
                                                                       <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                                                   </div>
                                                               )}
                                                               
                                                                {isAnalyzedPhoto && (
                                                                    <div className="absolute bottom-1 left-1 bg-green-500 text-white text-[8px] font-bold px-1.5 py-0.5 rounded shadow-sm z-10">
                                                                        Analizada
                                                                    </div>
                                                                )}
                                                                
                                                                <div className={\`absolute top-1 left-1 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all z-20 \${isSelected ? 'bg-green-500 border-green-500 scale-100' : 'bg-black/20 border-white/80 group-hover:bg-black/40 scale-90 group-hover:scale-100'}\`}>
                                                                    {isSelected && <CheckCircle className="w-3.5 h-3.5 text-white" />}
                                                                </div>
                                                            </div>
                                                            
                                                            {!isZoneAnalyzing && (
                                                               <button
                                                                   onClick={(e) => { e.stopPropagation(); removeShrubPhoto(group.id, i); }}
                                                                   className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1.5 hover:bg-red-600 shadow-sm transition-colors z-10"
                                                               >
                                                                   <Trash2 className="w-3.5 h-3.5" />
                                                               </button>
                                                           )}
                                                        </div>
                                                    );
                                                })}
                                                
                                               {!isZoneAnalyzing && allPhotos.length < 5 && (
                                                   <div className="w-24 h-24 shrink-0 flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 hover:bg-gray-100 hover:border-green-400 transition-colors cursor-pointer group snap-start">
                                                        <label className="w-full h-full flex flex-col items-center justify-center cursor-pointer">
                                                            <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center group-hover:bg-green-100 transition-colors mb-1">
                                                                <Image className="w-4 h-4 text-gray-500 group-hover:text-green-600" />
                                                            </div>
                                                            <span className="text-[10px] font-medium text-gray-500 group-hover:text-green-700">Añadir foto</span>
                                                            <input 
                                                                type="file" 
                                                                accept="image/*" 
                                                                multiple 
                                                                className="hidden" 
                                                                onChange={(e) => handleShrubFileSelect(group.id, e)}
                                                            />
                                                        </label>
                                                    </div>
                                                )}
                                            </div>
                                         </div>

                                         <div className="mt-2">
                                             <button
                                                 onClick={() => analyzeShrubGroup(group.id)}
                                                 disabled={isZoneAnalyzing || (group.selectedIndices !== undefined && group.selectedIndices.length === 0) || allPhotos.length === 0}
                                                 className={\`w-full py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2 mb-3 transition-colors \${
                                                     isZoneAnalyzing || (group.selectedIndices !== undefined && group.selectedIndices.length === 0) || allPhotos.length === 0
                                                     ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                                                     : 'bg-green-600 text-white hover:bg-green-700'
                                                 }\`}
                                             >
                                                 {isZoneAnalyzing ? (
                                                     <>
                                                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-green-600 border-t-transparent"></div>
                                                        Analizando...
                                                     </>
                                                 ) : (
                                                     isAnalyzed ? 'Reanalizar esta zona' : 'Analizar esta zona'
                                                 )}
                                             </button>
                                             {allPhotos.length === 0 && (
                                                 <p className="text-xs text-center text-amber-600 mt-2">
                                                     Añade al menos una foto para analizar
                                                 </p>
                                             )}
                                         </div>

                                         {isAnalyzed && (
                                             <div className="mt-4 bg-white p-4 rounded-xl border border-gray-200 shadow-sm animate-in fade-in slide-in-from-bottom-2 duration-300 relative overflow-hidden">
                                                <div className={\`absolute top-0 left-0 w-1 h-full \${group.analysisLevel === 2 ? 'bg-amber-500' : 'bg-green-500'}\`}></div>
                                                
                                                <div className="flex justify-between items-start">
                                                    <div>
                                                        <h4 className="font-semibold text-gray-900 text-sm">
                                                            Macizo de plantas y arbustos
                                                        </h4>
                                                        <div className="flex items-center gap-2 text-xs text-gray-600 mt-1">
                                                            <span>
                                                                Superficie: <span className="font-medium text-gray-900">{group.area} m²</span>
                                                            </span>
                                                            <span className="text-gray-300">|</span>
                                                            <span>
                                                                Tamaño dominante: <span className="font-medium text-gray-900 capitalize">{group.size}</span>
                                                            </span>
                                                        </div>
                                                        <div className={\`mt-2 text-xs font-medium \${group.analysisLevel === 1 ? 'text-green-600' : 'text-amber-600'}\`}>
                                                            {group.analysisLevel === 1 ? 'Análisis fiable' : 'Análisis con observaciones'}
                                                        </div>
                                                    </div>
                                                </div>

                                                {group.observations && group.observations.length > 0 && (
                                                    <div className="mt-3 p-3 bg-gray-50 rounded-lg text-xs text-gray-600 border border-gray-100">
                                                        <div className="font-medium mb-1 text-gray-700">Observaciones:</div>
                                                        <ul className="list-disc list-inside space-y-0.5 ml-1">
                                                            {group.observations.map((obs, k) => (
                                                                <li key={k}>{obs}</li>
                                                            ))}
                                                        </ul>
                                                    </div>
                                                )}
                                             </div>
                                         )}`;

const shrubNewStr = `                                         <ZonePhotoGallery
                                             photos={allPhotos}
                                             uploadingIndices={shrubUploads[group.id]}
                                             selectedIndices={group.selectedIndices}
                                             analyzedIndices={group.analyzedIndices}
                                             isAnalyzing={isZoneAnalyzing}
                                             isAnalyzed={isAnalyzed}
                                             onToggleSelection={(i) => toggleShrubPhotoSelection(group.id, i)}
                                             onRemovePhoto={(i) => removeShrubPhoto(group.id, i)}
                                             onAddPhotos={(e) => handleShrubFileSelect(group.id, e)}
                                         />

                                         <div className="mt-2">
                                             {!isAnalyzed && allPhotos.length > 0 && (
                                                 <ZoneActionButton
                                                     onClick={() => analyzeShrubGroup(group.id)}
                                                     isAnalyzing={isZoneAnalyzing}
                                                     isAnalyzed={isAnalyzed}
                                                     disabled={isZoneAnalyzing || (group.selectedIndices !== undefined && group.selectedIndices.length === 0)}
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
                                                     title="Macizo de plantas y arbustos"
                                                     analysisLevel={group.analysisLevel}
                                                     stats={[
                                                         { label: 'Superficie', value: \`\${group.area} m²\` },
                                                         { label: 'Tamaño dominante', value: <span className="capitalize">{group.size}</span> }
                                                     ]}
                                                     observations={group.observations}
                                                     onDelete={() => removeShrubGroup(group.id)}
                                                 />
                                                 <div className="mt-3">
                                                     <ZoneActionButton
                                                         onClick={() => analyzeShrubGroup(group.id)}
                                                         isAnalyzing={isZoneAnalyzing}
                                                         isAnalyzed={isAnalyzed}
                                                         disabled={isZoneAnalyzing || (group.selectedIndices !== undefined && group.selectedIndices.length === 0) || allPhotos.length === 0}
                                                     />
                                                 </div>
                                             </div>
                                         )}`;

let newContent = content.replace(weedingOldStr.trim(), weedingNewStr.trim());
newContent = newContent.replace(shrubOldStr.trim(), shrubNewStr.trim());

fs.writeFileSync('src/pages/reserva/DetailsPage.tsx', newContent);
console.log('Success Shrub and Weeding');
