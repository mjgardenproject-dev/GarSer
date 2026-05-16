const fs = require('fs');

const file = 'src/pages/reserva/DetailsPage.tsx';
let content = fs.readFileSync(file, 'utf8');

const target = "const analyzeTreeGroup = async (id: string) => {";

const functionsToAdd = `
  const addPalmGroup = () => {
    const newGroup = {
        id: \`palm-\${Date.now()}\`,
        species: '',
        height: '',
        quantity: 1,
        state: 'normal',
        wasteRemoval: true,
        photoUrls: [] as string[]
    };
    const newGroups = [...(bookingData.palmGroups || []), newGroup as any];
    setBookingData({ palmGroups: newGroups });
    if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { palmGroups: newGroups });
  };

  const removePalmGroup = (id: string) => {
      const currentGroups = bookingData.palmGroups || [];
      const nextGroups = currentGroups.filter(g => g.id !== id);
      setBookingData({ palmGroups: nextGroups });
      if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { palmGroups: nextGroups });
      updatePalmPricing(nextGroups);
  };

  const handlePalmFileSelect = async (id: string, e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files || e.target.files.length === 0) return;
      const files = Array.from(e.target.files);
      const group = (bookingData.palmGroups || []).find(g => g.id === id);
      if (!group) return;
      const currentPhotos = (group as any).photoUrls || [];
      if (currentPhotos.length + files.length > 5) {
          toast.error('Máximo 5 fotos por grupo');
          return;
      }
      
      const newIndices = files.map((_, i) => currentPhotos.length + i);
      setPalmUploads(prev => {
          const next = { ...prev };
          const set = new Set(next[id] || []);
          newIndices.forEach(i => set.add(i));
          next[id] = set;
          return next;
      });

      const nextGroups = [...(bookingData.palmGroups || [])];
      const zIdx = nextGroups.findIndex(x => x.id === id);
      const tempUrls = files.map(f => URL.createObjectURL(f));
      nextGroups[zIdx] = { ...group, photoUrls: [...currentPhotos, ...tempUrls] } as any;
      setBookingData({ palmGroups: nextGroups });

      try {
          const uploadedUrls = await Promise.all(files.map(f => uploadPhoto(f)));
          const finalGroups = [...(bookingData.palmGroups || [])];
          const finalZIdx = finalGroups.findIndex(x => x.id === id);
          if (finalZIdx !== -1) {
              const updatedUrls = [...currentPhotos];
              uploadedUrls.forEach((url, i) => {
                  if (url) updatedUrls.push(url);
              });
              finalGroups[finalZIdx] = { ...finalGroups[finalZIdx], photoUrls: updatedUrls } as any;
              setBookingData({ palmGroups: finalGroups });
              if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { palmGroups: finalGroups });
          }
      } catch (err) {
          console.error('Error uploading palm photos:', err);
          toast.error('Error al subir algunas fotos');
      } finally {
          setPalmUploads(prev => {
              const next = { ...prev };
              const set = new Set(next[id] || []);
              newIndices.forEach(i => set.delete(i));
              if (set.size === 0) delete next[id];
              else next[id] = set;
              return next;
          });
      }
  };

  const togglePalmPhotoSelection = (id: string, photoIndex: number) => {
      const groups = [...(bookingData.palmGroups || [])];
      const zIdx = groups.findIndex(z => z.id === id);
      if (zIdx === -1) return;
      const group = groups[zIdx] as any;
      const currentSelected = group.selectedIndices ?? Array.from({ length: (group.photoUrls || []).length }, (_, i) => i);
      const newSelected = currentSelected.includes(photoIndex)
          ? currentSelected.filter((i: number) => i !== photoIndex)
          : [...currentSelected, photoIndex].sort((a: number, b: number) => a - b);
      group.selectedIndices = newSelected;
      setBookingData({ palmGroups: groups });
      if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { palmGroups: groups });
  };

  const removePalmPhoto = (id: string, photoIndex: number) => {
      const groups = [...(bookingData.palmGroups || [])];
      const zIdx = groups.findIndex(z => z.id === id);
      if (zIdx === -1) return;
      const group = groups[zIdx] as any;
      group.photoUrls = (group.photoUrls || []).filter((_: any, i: number) => i !== photoIndex);
      if (group.selectedIndices) {
          group.selectedIndices = group.selectedIndices
              .filter((i: number) => i !== photoIndex)
              .map((i: number) => i > photoIndex ? i - 1 : i);
      }
      setBookingData({ palmGroups: groups });
      if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { palmGroups: groups });
  };

  const analyzePalmGroup = async (id: string) => {
      const groups = [...(bookingData.palmGroups || [])];
      const idx = groups.findIndex(z => z.id === id);
      if (idx === -1) return;
      const group = groups[idx];
      
      try {
          setPalmAnalyzingZoneIds(prev => new Set(prev).add(id));
          const photoUrls = (group as any).photoUrls || [];
          
          const debugInputs = {
             description: '',
             photoCount: photoUrls.length,
             selectedServiceIds: bookingData.serviceIds,
             photoUrls: photoUrls,
             serviceName: 'Poda de palmeras',
             model: aiModel
          };

          const res = await estimateWorkWithAI(debugInputs);
          
          const currentDebugInfo: AnalysisDebugInfo = {
              service: 'Poda de palmeras',
              model: aiModel,
              promptInputs: debugInputs,
              rawResponse: res.rawResponse,
              parsedResponse: res.palmas,
              finalAnalysisData: {},
              errors: [],
              timestamp: new Date().toISOString()
          };
          setDebugLogs(currentDebugInfo);

          if (!res.palmas || res.palmas.length === 0) {
              throw new Error('No se han detectado palmeras claras en la imagen.');
          }

          const p0 = res.palmas[0];
          group.species = p0.especie ? p0.especie.charAt(0).toUpperCase() + p0.especie.slice(1) : 'Desconocida';
          group.height = p0.altura;
          group.state = normalizePalmState(p0.estado);
          group.analysisLevel = p0.nivel_analisis;
          group.observations = p0.observaciones || [];
          (group as any).isFailed = group.analysisLevel === 3;
          (group as any).hasPhytosanitary = supportsPhytosanitaryForSpecies(group.species);
          groups[idx] = group;

          for (let i = 1; i < res.palmas.length; i++) {
              const p = res.palmas[i];
              groups.push({
                  id: \`palm-ai-\${Date.now()}-\${i}\`,
                  species: p.especie ? p.especie.charAt(0).toUpperCase() + p.especie.slice(1) : 'Desconocida',
                  height: p.altura,
                  quantity: 1,
                  state: normalizePalmState(p.estado),
                  wasteRemoval: true,
                  hasPhytosanitary: supportsPhytosanitaryForSpecies(p.especie ? p.especie.charAt(0).toUpperCase() + p.especie.slice(1) : 'Desconocida'),
                  analysisLevel: p.nivel_analisis,
                  observations: p.observaciones || [],
                  photoUrls: [...photoUrls],
                  isFailed: p.nivel_analisis === 3
              } as any);
          }

          await updatePalmPricing(groups);
          setBookingData({ palmGroups: groups });
          if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { palmGroups: groups });
          
          currentDebugInfo.finalAnalysisData = { palmGroups: groups };
          setDebugLogs({...currentDebugInfo});
          
          saveProgress();
      } catch (e: any) {
          console.error(e);
          setDebugLogs(prev => prev ? ({...prev, errors: [...prev.errors, e]}) : {
              service: 'Poda de palmeras',
              model: aiModel,
              promptInputs: {},
              rawResponse: {},
              parsedResponse: {},
              finalAnalysisData: {},
              errors: [e],
              timestamp: new Date().toISOString()
          });
          
          setBookingData((prev) => {
              const currentZones = prev.palmGroups || [];
              const updatedZones = currentZones.map(z => {
                  if (z.id === id) {
                      return { 
                          ...z, 
                          isFailed: true,
                          analysisLevel: 3,
                          observations: [e.message || 'Error en el análisis. Por favor, reintente.']
                      } as any;
                  }
                  return z;
              });
              
              const activeServiceId = prev.serviceIds?.[0] || '';
              const nextServicesData = activeServiceId
                  ? {
                      ...prev.servicesData,
                      [activeServiceId]: {
                          ...(prev.servicesData?.[activeServiceId] || {}),
                          palmGroups: updatedZones
                      }
                  }
                  : prev.servicesData;

              return { ...prev, palmGroups: updatedZones, servicesData: nextServicesData };
          });
          
          const currentZones = bookingData.palmGroups || [];
          const updatedZones = currentZones.map(z => z.id === id ? { ...z, isFailed: true, analysisLevel: 3, observations: [e.message || 'Error en el análisis.'] } as any : z);
          await updatePalmPricing(updatedZones);
      } finally {
          setPalmAnalyzingZoneIds(prev => {
              const next = new Set(prev);
              next.delete(id);
              return next;
          });
      }
  };

  const analyzeAllPendingPalmGroups = async () => {
      const groups = bookingData.palmGroups || [];
      const pending = groups.filter(z => z.analysisLevel === undefined && ((z as any).photoUrls || []).length > 0);
      for (const z of pending) {
          await analyzePalmGroup(z.id);
      }
  };

`;

if (content.includes(target)) {
    content = content.replace(target, functionsToAdd + target);
    fs.writeFileSync(file, content, 'utf8');
    console.log('Palm functions added');
} else {
    console.error('Target not found for palm functions');
}
