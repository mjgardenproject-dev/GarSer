import { persistBookingMedia, prepareBookingMediaForPersistence } from './bookingMediaService';
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

const randomUuid = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `booking-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export async function broadcastBookingRequest(params: BroadcastParams): Promise<void> {
  const startTime = `${String(params.startHour).padStart(2,'0')}:00`;
  const operationId = params.operationId || randomUuid();
  const bookingId = params.gardenerIds.length === 1 ? randomUuid() : undefined;
  const notesWithPhotos = params.notes || '';
  let uploadedMedia: Array<{ storageBucket?: string; storagePath?: string }> = [];

  if (params.photoFiles && params.photoFiles.length > 0) {
    try {
      uploadedMedia = await prepareBookingMediaForPersistence({
        clientId: params.clientId,
        date: params.date,
        startHour: params.startHour,
        localFiles: params.photoFiles,
        bookingId,
        operationId,
        telemetryContext: {
          scope: 'booking_broadcast_service',
          clientId: params.clientId,
          serviceId: params.primaryServiceId,
          gardenerCount: params.gardenerIds.length,
        },
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
      bookingId,
      providerId: params.gardenerIds[0],
      serviceId: params.primaryServiceId,
      date: params.date,
      startTime: `${startTime}:00`,
      durationHours: params.durationHours,
      totalPrice: params.totalPrice,
      clientAddress: params.clientAddress,
      notes: notesWithPhotos,
      pricingContext: { source: 'single-provider-booking' },
      travelFee,
      hourlyRate,
      operationId,
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
    operationId,
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
