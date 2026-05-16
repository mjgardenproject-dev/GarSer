import { normalizePhytosanitaryTreatment } from './serviceValidation';
import { getAllowedPhytosanitaryTreatments, PhytosanitaryAffectedType, PhytosanitaryRequestTreatment, PhytosanitaryTreatmentValue } from './phytosanitaryHelpers';

export const getPhytosanitarySelectedPhotoCount = (zone: { photoUrls?: string[]; selectedIndices?: number[] }) => {
  const total = zone.photoUrls?.length || 0;
  const selected = zone.selectedIndices ?? Array.from({ length: total }, (_, i) => i);
  return selected.length;
};

export const getPhytosanitaryValidation = (zone: {
  scope?: string | string[];
  requestedTreatment?: PhytosanitaryRequestTreatment;
  wantsEco?: boolean;
  affectedType?: PhytosanitaryAffectedType;
  type?: string;
  area?: number;
  photoUrls?: string[];
  selectedIndices?: number[];
  aboveTwoMeters?: boolean;
  aboveThreeMeters?: boolean;
}) => {
  const issues: string[] = [];
  const warnings: string[] = [];
  const selectedPhotoCount = getPhytosanitarySelectedPhotoCount(zone);
  const normalizedTreatment = normalizePhytosanitaryTreatment(zone.type || '');
  const allowedTreatments = getAllowedPhytosanitaryTreatments(zone.affectedType);

  const scopeArray = Array.isArray(zone.scope) ? zone.scope : [zone.scope].filter(Boolean) as string[];

  if (scopeArray.length === 0) issues.push('Selecciona el alcance del tratamiento.');
  if (!zone.requestedTreatment) {
    issues.push('Selecciona el tipo de tratamiento contextual.');
  }
  if (!zone.affectedType) issues.push('Selecciona la vegetación afectada.');
  if (!zone.type) issues.push('Selecciona el tratamiento solicitado.');
  if (selectedPhotoCount < 1) issues.push('Selecciona al menos 1 foto para analizar esta zona.');
  if (selectedPhotoCount > 5) issues.push('No puedes analizar más de 5 fotos por zona.');
  if (zone.type && zone.affectedType && !allowedTreatments.includes(normalizedTreatment as PhytosanitaryTreatmentValue)) {
    issues.push('El tratamiento no es compatible con la vegetación seleccionada.');
  }
  if ((zone.type || '').includes('endoterapia') && zone.wantsEco) {
    warnings.push('La opción ecológica no aplica cuando se solicita endoterapia.');
  }

  return { issues, warnings };
};
