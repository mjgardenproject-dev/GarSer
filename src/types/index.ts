export interface User {
  id: string;
  email: string;
  role: 'client' | 'gardener' | 'admin';
  created_at: string;
}

export interface Profile {
  id: string;
  user_id: string;
  full_name: string;
  phone: string;
  address: string;
  avatar_url?: string;
  role: 'client' | 'gardener' | 'admin';
  email?: string; // Email del usuario
  created_at: string;
  updated_at: string;
}

export interface GardenerProfile extends Profile {
  services: string[];
  max_distance: number;
  operational_latitude?: number | null;
  operational_longitude?: number | null;
  rating: number;
  total_reviews: number;
  description: string;
  is_available: boolean;
  has_phytosanitary_license?: boolean;
  license_verification_status?: 'pending' | 'approved' | 'rejected' | null;
  license_verified_at?: string | null;
  license_expires_at?: string | null;
}

export interface GardenerLicense {
  id: string;
  gardener_id: string;
  license_number?: string;
  document_url: string;
  status: 'pending' | 'approved' | 'rejected' | 'replaced';
  reviewed_at?: string;
  reviewed_by?: string;
  expires_at?: string;
  created_at: string;
}

export interface Service {
  id: string;
  name: string;
  description: string;
  pricing_method: 'per_hour' | 'per_quantity';
  precioPorHora?: number;
  hourly_rate?: number;
  icon: string;
  image_id?: string; // ID de imagen opcional
  image_url?: string;
  created_at: string;
}

export interface Availability {
  id: string;
  gardener_id: string;
  date: string;
  start_time: string;
  end_time: string;
  is_available: boolean;
  created_at: string;
}

// Nueva interfaz para bloques de disponibilidad
export interface AvailabilityBlock {
  id: string;
  gardener_id: string;
  date: string;
  hour_block: number; // 0-23
  is_available: boolean;
  created_at: string;
  updated_at: string;
}

// Interfaz para solicitudes de reserva
export interface BookingRequest {
  id: string;
  client_id: string;
  service_id: string;
  date: string;
  start_hour: number; // 0-23
  duration_hours: number;
  client_address: string;
  notes?: string;
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
  accepted_by?: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

// Interfaz extendida para solicitudes de reserva con detalles
export interface BookingRequestWithDetails extends BookingRequest {
  total_price?: number; // Precio total calculado
  service?: Service; // Detalles del servicio
  client_profile?: Profile; // Perfil del cliente
}

// Interfaz para respuestas de jardineros
export interface BookingResponse {
  id: string;
  request_id: string;
  gardener_id: string;
  response_type: 'accept' | 'reject' | 'suggest_alternative';
  suggested_date?: string;
  suggested_start_hour?: number;
  message?: string;
  created_at: string;
}

// Interfaz para bloques de reserva
export interface BookingBlock {
  id: string;
  booking_id: string;
  date: string;
  hour_block: number; // 0-23
  created_at: string;
}

// Interfaz para chats de sugerencias
export interface SuggestionChat {
  id: string;
  request_id: string;
  gardener_id: string;
  client_id: string;
  status: 'active' | 'accepted' | 'rejected' | 'closed';
  suggested_date?: string;
  suggested_start_hour?: number;
  suggested_duration_hours?: number;
  created_at: string;
  updated_at: string;
}

// Interfaz para mensajes de sugerencias
export interface SuggestionMessage {
  id: string;
  chat_id: string;
  sender_id: string;
  message: string;
  message_type: 'text' | 'suggestion' | 'acceptance' | 'rejection';
  created_at: string;
}

export interface Booking {
  id: string;
  client_id: string;
  gardener_id: string;
  service_id: string;
  date: string;
  start_time: string;
  end_time?: string;
  duration_hours: number;
  status: 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled' | 'expired';
  price_change_status?: 'none' | 'pending_client_acceptance' | 'accepted' | 'rejected' | 'expired';
  proposed_total_price?: number | null;
  proposed_price_reason?: string | null;
  proposed_price_by?: string | null;
  proposed_price_at?: string | null;
  proposed_price_expires_at?: string | null;
  total_price: number;
  travel_fee: number;
  hourly_rate: number;
  client_address: string;
  notes?: string;
  media_urls?: string[];
  request_id?: string;
  buffer_applied?: boolean;
  services?: Service[]; // Servicios asociados
  gardener_profile?: GardenerProfile; // Perfil del jardinero
  client_profile?: Profile; // Perfil del cliente
  created_at: string;
  updated_at: string;
}

// Interfaz para bloques horarios seleccionables
export interface TimeBlock {
  id?: string; // ID opcional para identificación única
  hour: number;
  label: string;
  available: boolean;
  selected: boolean;
  hasBuffer?: boolean; // Indica si tiene buffer aplicado
  start_time?: string; // Hora de inicio en formato HH:MM
  end_time?: string; // Hora de fin en formato HH:MM
}

export interface Review {
  id: string;
  booking_id: string;
  client_id: string;
  gardener_id: string;
  rating: number;
  comment: string;
  created_at: string;
}

// --- Service Configuration Types ---

export type LawnSpecies = 
  | 'Bermuda (fina o gramilla)' 
  | 'Gramón (Kikuyu, San Agustín o similares)' 
  | 'Dichondra (oreja de ratón o similares)'
  | 'Césped Mixto (Festuca/Raygrass)';

export type LawnRange = '0-50' | '51-150' | '151-400' | '400+';

export interface LawnPricingConfig {
  price_per_m2: number;
  surface_prices?: Partial<Record<LawnRange, number>>;
  condition_surcharges: {
    descuidado: number;
    muy_descuidado: number;
  };
  waste_removal: {
    percentage: number;
  };
  minimum_price: number;
  selected_species?: LawnSpecies[];
  species_prices?: Record<string, any>;
  pricing_method?: 'per_quantity' | 'per_hour';
  precioPorHora?: number;
  hourly_rate?: number;
  yield_m2_per_hour?: number;
}

export type HedgeHeightBand = '0-2m' | '2-4m' | '4-6m';

export interface HedgePricingConfig {
  pricing_matrix: Record<HedgeHeightBand, number>;
  specialist_enabled?: boolean;
  condition_surcharges: {
    media: number;
    alta: number;
    descuidado?: number;
    muy_descuidado?: number;
  };
  waste_removal: {
    percentage: number;
  };
  minimum_price: number;
  category_prices?: Record<string, any>;
  selected_categories?: string[];
  species_prices?: Record<string, any>;
  selected_types?: string[];
  pricing_method?: 'per_quantity' | 'per_hour';
  precioPorHora?: number;
  hourly_rate?: number;
  yield_ml_per_hour?: Record<HedgeHeightBand, number>;
}

export type PalmSpecies = 
  | 'Phoenix canariensis'
  | 'Phoenix dactylifera'
  | 'Washingtonia robusta/filifera'
  | 'Syagrus romanzoffiana'
  | 'Trachycarpus fortunei'
  | 'Roystonea regia';

export type PalmCondition = 'normal' | 'descuidado' | 'muy_descuidado';
export type WasteRemovalOption = 'included' | 'extra_percentage' | 'not_included' | 'extra_fixed';

export interface PalmPricingConfig {
  species_prices: Record<PalmSpecies, number>; 
  height_prices: Record<PalmSpecies, Record<string, number>>; 
  condition_surcharges: Record<PalmCondition, number>; 
  access_difficulty: number;
  phytosanitary: number;
  trunk_finish: number;
  waste_removal: {
    option: WasteRemovalOption;
    fixed_price?: number;
    percentage?: number;
  };
  minimum_price: number;
  selected_species?: PalmSpecies[];
  pricing_method?: 'per_quantity' | 'per_hour';
  precioPorHora?: number;
  hourly_rate?: number;
  use_yield_calculation?: boolean; // Legacy flag superseded by pricing_method
  yield_units_per_hour: Record<PalmSpecies, Record<string, number>>;
}

export type ShrubSize = 'pequeñas' | 'medianas' | 'grandes';

export interface ShrubPricingConfig {
  prices_per_m2: {
    pequeñas: number;
    medianas: number;
    grandes: number;
  };
  waste_removal: {
    percentage: number;
  };
  minimum_price: number;
  pricing_method?: 'per_quantity' | 'per_hour';
  precioPorHora?: number;
  hourly_rate?: number;
  yield_m2_per_hour: {
    pequeñas: number;
    medianas: number;
    grandes: number;
  };
}

export interface WeedingPricingConfig {
  version: 'weeding_v1';
  importe_minimo: number;
  precio_desbroce_m2: number;
  precio_herbicida_m2?: number;
  suplementos: {
    dificultad_media: number;
    dificultad_alta: number;
    retirada_restos: number;
  };
  yield_m2_per_hour?: number;
}

export interface ChatMessage {
  id: string;
  booking_id: string;
  sender_id: string;
  message: string;
  created_at: string;
}

export interface PriceCalculation {
  basePrice: number;
  travelFee: number;
  hourlyRate: number;
  totalHours: number;
  totalPrice: number;
}

export type PhytosanitaryType = 'insecticida' | 'fungicida' | 'ecologico_preventivo' | 'endoterapia';
export type LegacyPhytosanitaryType = 'Insecticida' | 'Fungicida';
export type LegacyPhytosanitaryRange = '0-50' | '50-200' | '200+';
export type PhytosanitaryMatrixBase = Record<'insecticida' | 'fungicida' | 'ecologico_preventivo', number>;
export type PhytosanitaryMatrixNoHerb = Record<'insecticida' | 'fungicida' | 'ecologico_preventivo', number>;
export type PhytosanitaryDetailedCategoryKey = 'cesped' | 'setos' | 'palmeras' | 'arboles' | 'plantas';

export interface PhytosanitaryPricingModifiers {
  eco?: {
    percentage: number;
  };
  combo?: {
    two_treatments_percentage: number;
    three_plus_treatments_percentage: number;
  };
}

export interface PhytosanitaryDetailedPricing {
  cesped: {
    minimo: number;
    preventivo: number;
    curativo: number;
  };
  setos: {
    minimo: number;
    bajos_preventivo: number;
    bajos_curativo: number;
    altos_preventivo: number;
    altos_curativo: number;
  };
  palmeras: {
    minimo: number;
    pequenas_preventivo: number;
    pequenas_curativo: number;
    pequenas_cirugia: number;
    medianas_preventivo: number;
    medianas_curativo: number;
    medianas_cirugia: number;
    altas_preventivo: number;
    altas_curativo: number;
    altas_cirugia: number;
  };
  arboles: {
    minimo: number;
    pequenos_preventivo: number;
    pequenos_curativo: number;
    medianos_preventivo: number;
    medianos_curativo: number;
    grandes_preventivo: number;
    grandes_curativo: number;
  };
  plantas: {
    minimo: number;
    pequenas_preventivo: number;
    pequenas_curativo: number;
    medianas_preventivo: number;
    medianas_curativo: number;
    grandes_preventivo: number;
    grandes_curativo: number;
  };
}

export interface PhytosanitaryYields {
  cesped_m2_per_hour: number;
  setos_ml_per_hour: number;
  palmeras_units_per_hour: number;
  arboles_units_per_hour: number;
  plantas_m2_per_hour: number;
  endoterapia_units_per_hour: number;
}

export interface PhytosanitaryPricingConfig {
  version?: 'phytosanitary_v2';
  pricing_method?: 'per_quantity' | 'per_hour';
  precioPorHora?: number;
  hourly_rate?: number;
  importe_minimo?: number;
  tratamientos_activos?: PhytosanitaryType[];
  superficies_plantas?: {
    hasta_100m2: PhytosanitaryMatrixBase;
    mas_de_100m2: PhytosanitaryMatrixBase;
  };
  setos?: {
    hasta_2m: PhytosanitaryMatrixNoHerb;
    mas_de_2m: PhytosanitaryMatrixNoHerb;
  };
  arboles?: {
    hasta_3m: PhytosanitaryMatrixNoHerb;
    mas_de_3m: PhytosanitaryMatrixNoHerb;
  };
  palmeras?: {
    tradicional: { hasta_3m: number; mas_de_3m: number };
    endoterapia: { precio_unico: number };
  };
  recargo_retirada?: { percentage: number };
  type_prices?: Record<string, Partial<Record<LegacyPhytosanitaryRange, number>>>;
  waste_removal?: { percentage: number };
  minimum_price?: number;
  minimum_fee?: number;
  pricing_modifiers?: PhytosanitaryPricingModifiers;
  selected_types?: LegacyPhytosanitaryType[];
  detailed_pricing?: PhytosanitaryDetailedPricing;
  // Yields (mandatory for internal time calculation)
  yields: PhytosanitaryYields;
}
