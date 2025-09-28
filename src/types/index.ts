export interface User {
  id: string;
  email: string;
  role: 'client' | 'gardener';
  created_at: string;
}

export interface Profile {
  id: string;
  user_id: string;
  full_name: string;
  phone: string;
  address: string;
  avatar_url?: string;
  role: 'client' | 'gardener';
  created_at: string;
  updated_at: string;
}

export interface GardenerProfile extends Profile {
  services: string[];
  max_distance: number;
  rating: number;
  total_reviews: number;
  description: string;
  is_available: boolean;
}

export interface Service {
  id: string;
  name: string;
  description: string;
  base_price: number;
  icon: string;
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

export interface Booking {
  id: string;
  client_id: string;
  gardener_id: string;
  service_id: string;
  date: string;
  start_time: string;
  duration_hours: number;
  status: 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';
  total_price: number;
  travel_fee: number;
  hourly_rate: number;
  client_address: string;
  notes?: string;
  created_at: string;
  updated_at: string;
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