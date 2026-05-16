import { persistBookingMedia, uploadBookingPhotos } from './bookingMediaService';
import { createAtomicBooking } from './bookingAtomicService';
import { createBroadcastBookingRequests } from './bookingRequestService';
import { reportBookingEvent } from './bookingTelemetry';

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
  operationId?: string;
}

export async function broadcastBookingRequest(params: BroadcastParams): Promise<void> {
  const startTime = `${String(params.startHour).padStart(2,'0')}:00`;
  let notesWithPhotos = params.notes || '';
  let uploadedMedia: Array<{ storageBucket?: string; storagePath?: string }> = [];

  if (params.photoFiles && params.photoFiles.length > 0) {
    try {
      uploadedMedia = await uploadBookingPhotos({
        clientId: params.clientId,
        date: params.date,
        startHour: params.startHour,
        files: params.photoFiles,
      });
    } catch (e) {
      console.warn('Error subiendo foto, continuando sin bloquear:', e);
      reportBookingEvent('warn', {
        event: 'booking.photo_upload_failed',
        context: {
          clientId: params.clientId,
          serviceId: params.primaryServiceId,
          message: e instanceof Error ? e.message : 'unknown',
        },
      });
    }
  }

  const travelFee = 15;
  const hourlyRate = typeof params.hourlyRate === 'number' && params.hourlyRate > 0
    ? params.hourlyRate
    : Math.max(1, Math.round(((params.totalPrice - travelFee) / Math.max(params.durationHours,1)) * 100) / 100);

  if (params.gardenerIds.length === 1) {
    const booking = await createAtomicBooking({
      providerId: params.gardenerIds[0],
      serviceId: params.primaryServiceId,
      date: params.date,
      startTime: `${startTime}:00`,
      durationHours: params.durationHours,
      totalPrice: params.totalPrice,
      clientAddress: params.clientAddress,
      notes: notesWithPhotos,
      pricingContext: { source: 'legacy-checkout' },
      travelFee,
      hourlyRate,
      operationId: params.operationId,
    });

    if (booking?.booking_id && uploadedMedia.length > 0) {
      await persistBookingMedia({
        bookingId: booking.booking_id,
        uploaderId: params.clientId,
        mediaItems: uploadedMedia,
      });
    }
    return;
  }

  const result = await createBroadcastBookingRequests({
    gardenerIds: params.gardenerIds,
    serviceId: params.primaryServiceId,
    date: params.date,
    startTime,
    durationHours: params.durationHours,
    totalPrice: params.totalPrice,
    clientAddress: params.clientAddress,
    notes: notesWithPhotos,
    pricingContext: { source: 'broadcast-request' },
    travelFee,
    hourlyRate,
    operationId: params.operationId,
  });

  if (result?.booking_ids?.length > 0 && params.photoFiles && params.photoFiles.length > 0) {
    await Promise.allSettled(
      result.booking_ids.map((bookingId: string) =>
        persistBookingMedia({
          bookingId,
          uploaderId: params.clientId,
          mediaItems: uploadedMedia,
        })
      )
    );
  }
}
