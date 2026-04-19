type PersistedWeedingSwitchMap = Record<string, boolean>;

const STORAGE_KEY = 'weeding:applyHerbicideByZone';

const safeReadStore = (): PersistedWeedingSwitchMap => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as PersistedWeedingSwitchMap;
  } catch {
    return {};
  }
};

const safeWriteStore = (value: PersistedWeedingSwitchMap): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Storage quota or browser restrictions should not break booking flow.
  }
};

export const buildWeedingZonePersistKey = (serviceId: string, zoneId: string): string => {
  return `${serviceId}::${zoneId}`;
};

export const readWeedingHerbicideState = (serviceId: string, zoneId: string): boolean | null => {
  if (!serviceId || !zoneId) return null;
  const store = safeReadStore();
  const key = buildWeedingZonePersistKey(serviceId, zoneId);
  return typeof store[key] === 'boolean' ? store[key] : null;
};

export const writeWeedingHerbicideState = (serviceId: string, zoneId: string, value: boolean): void => {
  if (!serviceId || !zoneId) return;
  const store = safeReadStore();
  const key = buildWeedingZonePersistKey(serviceId, zoneId);
  store[key] = Boolean(value);
  safeWriteStore(store);
};
