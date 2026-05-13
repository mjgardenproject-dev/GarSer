const fs = require('fs');

const file = 'src/pages/reserva/DetailsPage.tsx';
let content = fs.readFileSync(file, 'utf8');

const targetStart = "if (isPalmService) {";
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
                                                    >
                                                        {/* Line 3: Quantity (Editable) */}
                                                        <div className="text-xs text-gray-600 flex items-center gap-2 mt-3 pt-3 border-t border-gray-100">
                                                            <span className="font-medium text-gray-700">Cantidad de palmeras idénticas:</span>
                                                            <div className="flex items-center border border-gray-300 rounded-md bg-white">
                                                                <button 
                                                                    className="px-2 py-0.5 hover:bg-gray-100 text-gray-600 border-r border-gray-200"
                                                                    onClick={() => handlePalmQuantityChange(zone.id, (zone.quantity || 1) - 1)}
                                                                >
                                                                    -
                                                                </button>
                                                                <input 
                                                                    type="number" 
                                                                    min="1" 
                                                                    value={zone.quantity} 
                                                                    onChange={(e) => handlePalmQuantityChange(zone.id, parseInt(e.target.value) || 1)}
                                                                    className="w-10 text-center text-sm py-0.5 focus:outline-none"
                                                                />
                                                                <button 
                                                                    className="px-2 py-0.5 hover:bg-gray-100 text-gray-600 border-l border-gray-200"
                                                                    onClick={() => handlePalmQuantityChange(zone.id, (zone.quantity || 1) + 1)}
                                                                >
                                                                    +
                                                                </button>
                                                            </div>
                                                        </div>

                                                        {/* Servicios extras recomendados */}
                                                        {(supportsPhytosanitaryForSpecies(zone.species) || supportsTrunkPeelingForSpecies(zone.species)) && (
                                                            <div className="mt-3 pt-3 border-t border-gray-100 space-y-3">
                                                                <h5 className="text-sm font-semibold text-gray-800 mb-3">Servicios extras recomendados</h5>
                                                                
                                                                {supportsPhytosanitaryForSpecies(zone.species) && (
                                                                    <label className={\`flex items-center justify-between gap-3 p-3 rounded-xl border cursor-pointer transition-all duration-200 \${
                                                                        (zone as any).hasPhytosanitary ? 'bg-green-50 border-green-500 ring-1 ring-green-500' : 'bg-white border-gray-200 hover:border-green-300 hover:bg-gray-50'
                                                                    }\`}>
                                                                        <span className={\`text-sm font-medium \${(zone as any).hasPhytosanitary ? 'text-green-800' : 'text-gray-700'}\`}>
                                                                            Tratamiento de insecticida y fungicida para prevenir plagas
                                                                        </span>
                                                                        <div className={\`relative shrink-0 w-11 h-6 transition-colors duration-200 ease-in-out rounded-full \${(zone as any).hasPhytosanitary ? 'bg-green-500' : 'bg-gray-200'}\`}>
                                                                            <span className={\`absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform duration-200 ease-in-out shadow-sm \${(zone as any).hasPhytosanitary ? 'translate-x-5' : 'translate-x-0'}\`} />
                                                                            <input 
                                                                                type="checkbox" 
                                                                                className="sr-only"
                                                                                checked={(zone as any).hasPhytosanitary || false}
                                                                                onChange={(e) => {
                                                                                    const isChecking = e.target.checked;
                                                                                    if (isChecking) {
                                                                                        updatePalmGroup(zone.id, { hasPhytosanitary: true } as any);
                                                                                    } else {
                                                                                        openConfirm({
                                                                                            title: '¿Estás seguro de omitir este tratamiento?',
                                                                                            message: 'El tratamiento de insecticida y fungicida es esencial para palmeras recién podadas. Previene infecciones graves como el picudo rojo y protege la salud de tu palmera tras el corte. No es recomendable omitirlo.',
                                                                                            confirmLabel: 'No aplicar tratamiento',
                                                                                            cancelLabel: 'Mantener servicio extra',
                                                                                            tone: 'phytosanitary_warning',
                                                                                            onConfirm: () => {
                                                                                                updatePalmGroup(zone.id, { hasPhytosanitary: false } as any);
                                                                                            }
                                                                                        });
                                                                                    }
                                                                                }}
                                                                            />
                                                                        </div>
                                                                    </label>
                                                                )}

                                                                {supportsTrunkPeelingForSpecies(zone.species) && (
                                                                    <label className={\`flex items-center justify-between gap-3 p-3 rounded-xl border cursor-pointer transition-all duration-200 \${
                                                                        (zone as any).hasTrunkPeeling ? 'bg-green-50 border-green-500 ring-1 ring-green-500' : 'bg-white border-gray-200 hover:border-green-300 hover:bg-gray-50'
                                                                    }\`}>
                                                                        <span className={\`text-sm font-medium block \${(zone as any).hasTrunkPeeling ? 'text-green-800' : 'text-gray-700'}\`}>
                                                                            Cepillado y limpieza del tronco
                                                                            <span className="block text-[11px] font-normal text-gray-500 mt-0.5">Deja tu palmera impecable con el cepillado del tronco</span>
                                                                        </span>
                                                                        <div className={\`relative shrink-0 w-11 h-6 transition-colors duration-200 ease-in-out rounded-full \${(zone as any).hasTrunkPeeling ? 'bg-green-500' : 'bg-gray-200'}\`}>
                                                                            <span className={\`absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform duration-200 ease-in-out shadow-sm \${(zone as any).hasTrunkPeeling ? 'translate-x-5' : 'translate-x-0'}\`} />
                                                                            <input 
                                                                                type="checkbox" 
                                                                                className="sr-only"
                                                                                checked={(zone as any).hasTrunkPeeling || false}
                                                                                onChange={(e) => updatePalmGroup(zone.id, { hasTrunkPeeling: e.target.checked } as any)}
                                                                            />
                                                                        </div>
                                                                    </label>
                                                                )}
                                                            </div>
                                                        )}

                                                        <div className="mt-4 pt-4 border-t border-gray-100">
                                                            <span className="block text-sm font-medium text-gray-700 mb-3">¿Se encuentra la base de la palmera en un lugar despejado para arrojar las hojas libremente al suelo?</span>
                                                            <AccessDifficultyToggle 
                                                                group={zone} 
                                                                isAccessDisabled={!hasPositiveUnits(zone.quantity) || (isLowestRangeThresholdForSpecies(zone.species, zone.height) && !bookingData.palmGroups?.some(g => g.species === zone.species && hasPositiveUnits(g.quantity) && !isLowestRangeThresholdForSpecies(g.species, g.height)))} 
                                                                updatePalmGroup={updatePalmGroup} 
                                                            />
                                                                {!hasPositiveUnits(zone.quantity) && (
                                                                    <p className="text-xs text-gray-500 mt-2">
                                                                      Indica unidades mayores a 0 para habilitar esta opción.
                                                                    </p>
                                                                )}
                                                                {hasPositiveUnits(zone.quantity) && isLowestRangeThresholdForSpecies(zone.species, zone.height) && (
                                                                    <p className="text-xs text-gray-500 mt-2">
                                                                      Acceso no aplicable en el rango mínimo de esta especie.
                                                                    </p>
                                                                )}
                                                            </div>

                                                    </ServiceResultCard>
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

const endIndex = content.indexOf(targetStart) + targetStart.length;

// wait, I can just replace the old targetStart with my new block + targetStart.
// wait, targetStart is "if (isPalmService) {", but wait, my script `patch_palm_render.cjs` already injected it!
// Let me replace the entire `if (isPalmService) { ... }` up to `if (isTreeService) {`.
// Or just replace the old one.
const palmStart = "if (isPalmService) {";
const treeStart = "if (isTreeService) {";

if (content.includes(palmStart) && content.includes(treeStart)) {
    const s = content.indexOf(palmStart);
    const e = content.indexOf(treeStart);
    content = content.substring(0, s) + palmRenderBlock + content.substring(e);
    fs.writeFileSync(file, content, 'utf8');
    console.log('Palm render block updated successfully.');
} else {
    console.error('Could not find palm or tree block');
}
