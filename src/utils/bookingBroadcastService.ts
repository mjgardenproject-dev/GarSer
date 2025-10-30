import { supabase } from '../lib/supabase';

interface BroadcastParams {
  clientId: string;
  gardenerIds: string[];
  primaryServiceId: string;
  date: string; // yyyy-MM-dd
  startHour: number; // 0-23
  durationHours: number;
  clientAddress: string;
  notes?: string;
  totalPrice: number;
  hourlyRate?: number;
  photoFiles?: File[];
}

export async function broadcastBookingRequest(params: BroadcastParams): Promise<void> {
  const startTime = `${String(params.startHour).padStart(2,'0')}:00`;

  // Subir fotos opcionalmente y añadir URLs a notas (con nombres sanitizados)
  let notesWithPhotos = params.notes || '';
  const bucket = (import.meta.env.VITE_BOOKING_PHOTOS_BUCKET as string | undefined) || 'booking-photos';
  const now = Date.now();

  const sanitizeFileName = (name: string) => {
    const base = name.trim().toLowerCase().replace(/\s+/g, '_');
    return base.replace(/[^a-z0-9._-]/g, '_');
  };

  if (params.photoFiles && params.photoFiles.length > 0) {
    const uploadedUrls: string[] = [];
    for (let i = 0; i < params.photoFiles.length; i++) {
      const file = params.photoFiles[i];
      try {
        const safeName = sanitizeFileName(file.name || `foto_${i}.jpg`);
        const path = `bookings/${params.clientId}/${params.date}_${params.startHour}_${now}_${i}_${safeName}`;
        const { error: uploadError } = await supabase.storage
          .from(bucket)
          .upload(path, file, { upsert: true, contentType: file.type || 'image/jpeg' });
        if (!uploadError) {
          const { data } = supabase.storage.from(bucket).getPublicUrl(path);
          if (data?.publicUrl) uploadedUrls.push(data.publicUrl);
          else {
            const { data: signed } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
            if (signed?.signedUrl) uploadedUrls.push(signed.signedUrl);
          }
        } else {
          console.warn('Error subiendo foto de reserva:', uploadError.message);
        }
      } catch (e) {
        console.warn('Error subiendo foto, continuando sin bloquear:', e);
      }
    }
    if (uploadedUrls.length > 0) {
      notesWithPhotos = `${notesWithPhotos || ''}\nFotos: ${uploadedUrls.join(', ')}`.trim();
    }
  }

  const travelFee = 15;
  const hourlyRate = typeof params.hourlyRate === 'number' && params.hourlyRate > 0
    ? params.hourlyRate
    : Math.max(1, Math.round(((params.totalPrice - travelFee) / Math.max(params.durationHours,1)) * 100) / 100);

  const rows = params.gardenerIds.map(gardenerId => ({
    client_id: params.clientId,
    gardener_id: gardenerId,
    service_id: params.primaryServiceId,
    date: params.date,
    start_time: startTime,
    duration_hours: params.durationHours,
    status: 'pending',
    total_price: params.totalPrice,
    travel_fee: travelFee,
    hourly_rate: hourlyRate,
    client_address: params.clientAddress,
    notes: notesWithPhotos,
  }));

  const { error } = await supabase.from('bookings').insert(rows);
  if (error) throw error;
}