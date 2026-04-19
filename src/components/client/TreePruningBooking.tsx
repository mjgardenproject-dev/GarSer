// src/components/client/TreePruningBooking.tsx
import React, { useState, useCallback } from 'react';
import { TreePruningZone, PruningServiceType } from '../../types/treePruning';

interface Props {
  onBookingChange: (zones: TreePruningZone[]) => void;
}

const PruningTypeInfo: React.FC<{ type: PruningServiceType }> = ({ type }) => {
  const info = {
    formacion: 'Ideal para árboles jóvenes. Guía su crecimiento para una estructura fuerte y estética.',
    estructural: 'Necesaria para árboles maduros. Elimina ramas peligrosas o enfermas, mejorando su salud y seguridad.',
  };
  return (
    <div className="tooltip tooltip-right" data-tip={info[type]}>
      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-400 ml-1 cursor-pointer" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    </div>
  );
};

const TreePruningBooking: React.FC<Props> = ({ onBookingChange }) => {
  const [zones, setZones] = useState<TreePruningZone[]>([]);

  const addZone = () => {
    const newZone: TreePruningZone = {
      id: crypto.randomUUID(),
      pruningType: 'estructural',
      photos: [],
    };
    const updatedZones = [...zones, newZone];
    setZones(updatedZones);
    onBookingChange(updatedZones);
  };

  const removeZone = (id: string) => {
    const updatedZones = zones.filter(zone => zone.id !== id);
    setZones(updatedZones);
    onBookingChange(updatedZones);
  };

  const handleZoneChange = useCallback((id: string, updatedZone: Partial<TreePruningZone>) => {
    setZones(prevZones => {
      const newZones = prevZones.map(zone => (zone.id === id ? { ...zone, ...updatedZone } : zone));
      onBookingChange(newZones);
      return newZones;
    });
  }, [onBookingChange]);


  return (
    <div className="space-y-6">
      <h3 className="text-xl font-semibold">Detalles de Poda de Árboles</h3>
      {zones.map((zone, index) => (
        <ZoneEditor key={zone.id} zone={zone} index={index + 1} onRemove={removeZone} onChange={handleZoneChange} />
      ))}
      <button className="btn btn-primary" onClick={addZone}>
        {zones.length === 0 ? 'Añadir Árbol' : 'Añadir Otro Árbol'}
      </button>
    </div>
  );
};

// --- Componente Interno para editar una Zona ---

interface ZoneEditorProps {
  zone: TreePruningZone;
  index: number;
  onRemove: (id: string) => void;
  onChange: (id: string, updatedZone: Partial<TreePruningZone>) => void;
}

const ZoneEditor: React.FC<ZoneEditorProps> = ({ zone, index, onRemove, onChange }) => {

  const handlePruningTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange(zone.id, { pruningType: e.target.value as PruningServiceType });
  };
  
  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      onChange(zone.id, { photos: Array.from(e.target.files) });
    }
  };

  return (
    <div className="p-4 border rounded-lg relative">
      <h4 className="font-bold mb-2">Árbol #{index}</h4>
      <button
        className="btn btn-xs btn-circle btn-outline absolute top-2 right-2"
        onClick={() => onRemove(zone.id)}
      >
        ✕
      </button>
      
      {/* Selector de tipo de poda */}
      <div className="form-control w-full">
        <label className="label">
          <span className="label-text flex items-center">
            Tipo de Poda
            <PruningTypeInfo type={zone.pruningType} />
          </span>
        </label>
        <select className="select select-bordered" value={zone.pruningType} onChange={handlePruningTypeChange}>
          <option value="estructural">Estructural</option>
          <option value="formacion">De formación</option>
        </select>
      </div>

      {/* Carga de fotos */}
      <div className="form-control w-full mt-4">
        <label className="label">
          <span className="label-text">Fotografías del árbol</span>
        </label>
        <input type="file" multiple className="file-input file-input-bordered w-full" onChange={handlePhotoUpload} accept="image/*" />
        {zone.photos.length > 0 && <span className="text-xs text-gray-500 mt-1">{zone.photos.length} foto(s) seleccionada(s).</span>}
      </div>
    </div>
  );
};


export default TreePruningBooking;
