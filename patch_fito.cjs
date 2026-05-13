const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src/pages/reserva/DetailsPage.tsx');
let content = fs.readFileSync(file, 'utf8');

const targetStart = `<div className="pt-3 border-t border-gray-100">
                                  <div className="text-[11px] font-semibold uppercase tracking-wide text-green-700 mb-2">Fotos de la zona</div>`;

const targetEnd = `                                  )}
                                </div>
                              </div>
                            </div>`;

const startIdx = content.indexOf(targetStart);
const endIdx = content.indexOf(targetEnd);

if (startIdx === -1 || endIdx === -1) {
    console.error("Could not find target boundaries");
    process.exit(1);
}

const replacement = `<div className="pt-4 border-t border-gray-100">
                                  <ZonePhotoGallery
                                      photos={allPhotos}
                                      uploadingIndices={phytosanitaryUploads[zone.id] || new Set()}
                                      selectedIndices={zone.selectedIndices ?? allPhotos.map((_, i) => i)}
                                      analyzedIndices={zone.analyzedIndices ?? (isAnalyzed ? allPhotos.map((_, i) => i) : [])}
                                      isAnalyzing={isZoneAnalyzing}
                                      isAnalyzed={isAnalyzed}
                                      onToggleSelection={(i) => togglePhytosanitaryPhotoSelection(zone.id, i)}
                                      onRemovePhoto={(i) => removePhytosanitaryPhoto(zone.id, i)}
                                      onAddPhotos={(e) => handlePhytosanitaryFileSelect(zone.id, e)}
                                  />

                                  <div className="mt-2">
                                      {(!isAnalyzed || (isAnalyzed && (zone.analyzedIndices && (zone.analyzedIndices.length !== selectedPhotoCount || !zone.analyzedIndices.every(i => zone.selectedIndices?.includes(i)))))) && (
                                          <ZoneActionButton
                                              onClick={() => analyzePhytosanitaryZone(zone.id)}
                                              isAnalyzing={isZoneAnalyzing}
                                              isAnalyzed={isAnalyzed}
                                              disabled={isZoneAnalyzing || validation.issues.length > 0 || selectedPhotoCount === 0}
                                              analyzeText={\`Analizar \${selectedPhotoCount} foto\${selectedPhotoCount === 1 ? '' : 's'}\`}
                                              reanalyzeText="Reanalizar (hay cambios)"
                                          />
                                      )}
                                      
                                      {(validation.issues.length > 0 || validation.warnings.length > 0) && (
                                        <div className="p-3 rounded-lg border border-yellow-200 bg-yellow-50 text-yellow-800 text-xs space-y-1 mb-4">
                                          {validation.issues.map((issue, issueIndex) => <p key={\`issue-\${issueIndex}\`}>{issue}</p>)}
                                          {validation.warnings.map((warning, warningIndex) => <p key={\`warning-\${warningIndex}\`}>{warning}</p>)}
                                        </div>
                                      )}
                                  </div>

                                  {isAnalyzed && (
                                      <div className="mt-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                                          <ServiceResultCard
                                              title="Análisis Fitosanitario"
                                              analysisLevel={zone.analysisLevel}
                                              stats={[]}
                                              onDelete={() => {
                                                  openConfirm({
                                                      title: '¿Eliminar resultado?',
                                                      message: 'Se borrarán los datos del análisis, pero las fotos se mantendrán para poder re-analizar.',
                                                      onConfirm: () => {
                                                          const next = [...(bookingData.phytosanitaryZones || [])];
                                                          const z = next.find(x => x.id === zone.id);
                                                          if (z) {
                                                              (z as any).analysisMetrics = undefined;
                                                              z.area = 0;
                                                              z.analysisLevel = undefined;
                                                              z.observations = [];
                                                              z.analyzedIndices = [];
                                                              setBookingData({ phytosanitaryZones: next });
                                                              if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { phytosanitaryZones: next });
                                                          }
                                                      }
                                                  });
                                              }}
                                          >
                                              <div className="space-y-2 mt-3">
                                                  {detectedItems.length === 0 && aiObservations.length === 0 ? (
                                                      <div className="text-sm text-gray-600">La IA no detectó elementos con cantidad.</div>
                                                  ) : (
                                                      <>
                                                          {Object.entries(PHYTOSANITARY_GROUPED_FIELDS).map(([familyName, fields]) => {
                                                              const familyItems = detectedItems.filter(item => fields.some(f => f.key === item.key));
                                                              if (familyItems.length === 0) return null;
                                                              return (
                                                                  <div key={familyName} className="mb-4 last:mb-0">
                                                                      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-700 mb-2">{familyName}</div>
                                                                      <div className="space-y-2 pl-2 border-l-2 border-green-200">
                                                                          {familyItems.map((item) => {
                                                                              const fieldDef = fields.find(f => f.key === item.key);
                                                                              return (
                                                                                  <div key={item.key} className="flex items-center justify-between gap-3 bg-white/70 border border-gray-200 rounded-lg px-3 py-2">
                                                                                      <div className="text-sm text-gray-800">
                                                                                          {fieldDef?.label || item.label}: <span className="font-semibold">{item.value} {fieldDef?.unit || item.unit}</span>
                                                                                      </div>
                                                                                      <button
                                                                                          onClick={() => removePhytosanitaryMetricItem(zone.id, item.key)}
                                                                                          className="text-red-600 hover:text-red-700 p-1.5 rounded-lg hover:bg-red-50"
                                                                                      >
                                                                                          <Trash2 className="w-4 h-4" />
                                                                                      </button>
                                                                                  </div>
                                                                              );
                                                                          })}
                                                                      </div>
                                                                  </div>
                                                              );
                                                          })}
                                                          {aiObservations.length > 0 && !aiObservations.includes('none') && (
                                                              <div className={\`space-y-2 \${detectedItems.length > 0 ? 'mt-3 pt-3 border-t border-gray-200/50' : ''}\`}>
                                                                  <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Observaciones</div>
                                                                  {aiObservations.map((observation: string, observationIndex: number) => {
                                                                      if (observation === 'none') return null;
                                                                      return (
                                                                          <div key={\`\${observation}-\${observationIndex}\`} className="flex items-center justify-between gap-3 bg-white/70 border border-gray-200 rounded-lg px-3 py-2">
                                                                              <div className="text-sm text-gray-800">{OBS_TRANSLATIONS[observation] || observation}</div>
                                                                              <button
                                                                                  onClick={() => removePhytosanitaryObservation(zone.id, observationIndex)}
                                                                                  className="text-red-600 hover:text-red-700 p-1.5 rounded-lg hover:bg-red-50"
                                                                              >
                                                                                  <Trash2 className="w-4 h-4" />
                                                                              </button>
                                                                          </div>
                                                                      );
                                                                  })}
                                                              </div>
                                                          )}
                                                      </>
                                                  )}
                                              </div>
                                          </ServiceResultCard>
                                      </div>
                                  )}
                                </div>
                              </div>
                            </div>`;

const newContent = content.substring(0, startIdx) + replacement + content.substring(endIdx + targetEnd.length);

fs.writeFileSync(file, newContent);
console.log("Patched successfully");
