import { supabase } from '../lib/supabase';
import { compressImage } from './imageCompressor';
import { reportBookingEvent } from './bookingTelemetry';
import { validateImageLocal, type ValidationResult } from './imageValidator';

export const DEFAULT_BOOKING_PHOTOS_BUCKET =
  (import.meta.env.VITE_BOOKING_PHOTOS_BUCKET as string | undefined) || 'booking-photos';
export const DEFAULT_BOOKING_PHOTO_LIMIT = 5;
export const DEFAULT_BOOKING_PHOTO_SIGNED_URL_TTL_SECONDS = 60 * 60 * 24;
export const DEFAULT_BOOKING_PHOTO_UPLOAD_ATTEMPTS = 3;
export const DEFAULT_BOOKING_PHOTO_RETRY_DELAY_MS = 300;

export type BookingPhotoValidationCode =
  | 'LIMIT_EXCEEDED'
  | 'UNSUPPORTED_TYPE'
  | 'FILE_TOO_LARGE'
  | ValidationResult['reason'];

export interface BookingPhotoSelectionRejection {
  file: File;
  code: BookingPhotoValidationCode;
  message: string;
  details?: string;
}

export interface BookingPhotoSelectionResult {
  acceptedFiles: File[];
  rejectedFiles: BookingPhotoSelectionRejection[];
}

type BookingPhotoTelemetryContext = Record<string, unknown>;

export interface BookingPhotoUploadAdapter {
  bucket?: string;
  createSignedUrl?: boolean;
  signedUrlTtlSeconds?: number;
  upsert?: boolean;
  buildPath: (params: {
    file: File;
    index: number;
    now: number;
    safeName: string;
  }) => string;
}

export interface BookingPhotoUploadResult {
  ok: boolean;
  uploadSucceeded: boolean;
  index: number;
  file: File;
  uploadedFile: File;
  url?: string;
  storageBucket?: string;
  storagePath?: string;
  attempts: number;
  validation?: ValidationResult;
  errorMessage?: string;
}

export interface BookingPhotoUploadHooks {
  onFileUploaded?: (result: BookingPhotoUploadResult) => void | Promise<void>;
  onFileFailed?: (result: BookingPhotoUploadResult) => void | Promise<void>;
  onComplete?: (results: BookingPhotoUploadResult[]) => void | Promise<void>;
}

function sanitizePhotoFileName(name: string, fallback: string) {
  return String(name || fallback)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9._-]/g, '_');
}

function wait(ms: number) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

function getValidationMessage(result: ValidationResult): string {
  switch (result.reason) {
    case 'TOO_SMALL':
      return 'La imagen no cumple la resolucion minima requerida.';
    case 'TOO_DARK':
      return 'La imagen es demasiado oscura para analizarla con fiabilidad.';
    case 'ERROR':
    default:
      return 'No se pudo validar la imagen seleccionada.';
  }
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error.trim();
  return 'Error desconocido en el pipeline de fotos.';
}

async function maybeCreateSignedUrl(
  bucket: string,
  path: string,
  ttlSeconds: number,
  telemetryContext?: BookingPhotoTelemetryContext,
) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, ttlSeconds);
  if (error || !data?.signedUrl) {
    reportBookingEvent('warn', {
      event: 'booking.photo_signed_url_failed',
      context: {
        bucket,
        path,
        message: error?.message || 'missing_signed_url',
        ...telemetryContext,
      },
    });
    return undefined;
  }
  return data.signedUrl;
}

export function buildDraftBookingPhotoUploadAdapter(params: {
  clientId: string;
  bucket?: string;
  pathPrefix?: string;
  signedUrlTtlSeconds?: number;
}): BookingPhotoUploadAdapter {
  return {
    bucket: params.bucket || DEFAULT_BOOKING_PHOTOS_BUCKET,
    createSignedUrl: true,
    signedUrlTtlSeconds: params.signedUrlTtlSeconds || DEFAULT_BOOKING_PHOTO_SIGNED_URL_TTL_SECONDS,
    upsert: false,
    buildPath: ({ index, now, safeName }) =>
      `${params.pathPrefix || 'drafts'}/${params.clientId}/${now}_${index}_${safeName}`,
  };
}

export function buildBookingMediaPhotoUploadAdapter(params: {
  clientId: string;
  date: string;
  startHour: number;
  bucket?: string;
  bookingId?: string;
  operationId?: string;
}): BookingPhotoUploadAdapter {
  return {
    bucket: params.bucket || DEFAULT_BOOKING_PHOTOS_BUCKET,
    createSignedUrl: false,
    upsert: true,
    buildPath: ({ index, now, safeName }) => {
      if (params.bookingId) {
        return `bookings/${params.clientId}/${params.bookingId}/${params.date}_${params.startHour}_${index}_${safeName}`;
      }

      if (params.operationId) {
        return `bookings/${params.clientId}/operations/${params.operationId}/${params.date}_${params.startHour}_${index}_${safeName}`;
      }

      return `bookings/${params.clientId}/${params.date}_${params.startHour}_${now}_${index}_${safeName}`;
    },
  };
}

export async function getCurrentUserDraftBookingPhotoUploadAdapter(params?: {
  bucket?: string;
  pathPrefix?: string;
  signedUrlTtlSeconds?: number;
  telemetryContext?: BookingPhotoTelemetryContext;
}): Promise<BookingPhotoUploadAdapter | null> {
  const { data, error } = await supabase.auth.getUser();
  const clientId = data?.user?.id;
  if (error || !clientId) {
    reportBookingEvent('warn', {
      event: 'booking.photo_upload_skipped_missing_user',
      context: {
        message: error?.message || 'anonymous_user',
        ...params?.telemetryContext,
      },
    });
    return null;
  }

  return buildDraftBookingPhotoUploadAdapter({
    clientId,
    bucket: params?.bucket,
    pathPrefix: params?.pathPrefix,
    signedUrlTtlSeconds: params?.signedUrlTtlSeconds,
  });
}

export async function validateBookingPhotoSelection(params: {
  files: File[];
  existingCount?: number;
  maxTotalPhotos?: number;
  maxFileSizeBytes?: number;
  validateLocally?: boolean;
  telemetryContext?: BookingPhotoTelemetryContext;
}): Promise<BookingPhotoSelectionResult> {
  const acceptedFiles: File[] = [];
  const rejectedFiles: BookingPhotoSelectionRejection[] = [];
  const maxTotalPhotos = params.maxTotalPhotos ?? DEFAULT_BOOKING_PHOTO_LIMIT;
  const existingCount = params.existingCount ?? 0;
  const validateLocally = params.validateLocally ?? true;

  for (const file of params.files) {
    if (!file.type.startsWith('image/')) {
      rejectedFiles.push({
        file,
        code: 'UNSUPPORTED_TYPE',
        message: 'Solo se permiten archivos de imagen.',
      });
      continue;
    }

    if (typeof params.maxFileSizeBytes === 'number' && file.size > params.maxFileSizeBytes) {
      rejectedFiles.push({
        file,
        code: 'FILE_TOO_LARGE',
        message: `La imagen supera el tamano maximo permitido de ${Math.round(params.maxFileSizeBytes / (1024 * 1024))} MB.`,
      });
      continue;
    }

    if (existingCount + acceptedFiles.length >= maxTotalPhotos) {
      rejectedFiles.push({
        file,
        code: 'LIMIT_EXCEEDED',
        message: `Maximo ${maxTotalPhotos} fotos permitidas.`,
      });
      continue;
    }

    if (validateLocally) {
      const validation = await validateImageLocal(file);
      if (!validation.isValid) {
        rejectedFiles.push({
          file,
          code: validation.reason,
          message: getValidationMessage(validation),
          details: validation.details,
        });
        continue;
      }
    }

    acceptedFiles.push(file);
  }

  if (rejectedFiles.length > 0) {
    const reasonSummary = Array.from(new Set(rejectedFiles.map((item) => item.code))).join(',');
    reportBookingEvent('warn', {
      event: 'booking.photo_selection_rejected',
      context: {
        rejectedCount: rejectedFiles.length,
        acceptedCount: acceptedFiles.length,
        reasons: reasonSummary,
        ...params.telemetryContext,
      },
    });
  }

  return { acceptedFiles, rejectedFiles };
}

export function buildBookingPhotoSelectionErrorMessage(
  rejectedFiles: BookingPhotoSelectionRejection[],
  fallbackMessage = 'No se pudieron procesar algunas fotos.'
): string {
  if (rejectedFiles.length === 0) return '';
  const uniqueMessages = Array.from(new Set(rejectedFiles.map((item) => item.message).filter(Boolean)));
  if (uniqueMessages.length === 1) return uniqueMessages[0];
  return `${uniqueMessages[0]} (+${uniqueMessages.length - 1} validacion(es) adicional(es))`;
}

export async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('FILE_READER_FAILED'));
    reader.readAsDataURL(file);
  });
}

export async function resolveAnalysisPhotoSources(params: {
  photoUrls: string[];
  selectedIndices: number[];
  files?: File[];
}): Promise<string[]> {
  let remoteSourceCount = 0;
  let fileSourceCount = 0;
  let missingSourceCount = 0;

  const resolved = await Promise.all(
    params.selectedIndices.map(async (index) => {
      const url = params.photoUrls[index];
      if (
        typeof url === 'string' &&
        (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:'))
      ) {
        remoteSourceCount += 1;
        return url;
      }

      const file = params.files?.[index];
      if (file instanceof File) {
        try {
          const dataUrl = await fileToDataUrl(file);
          fileSourceCount += 1;
          return dataUrl;
        } catch (error) {
          reportBookingEvent('warn', {
            event: 'booking.photo_analysis_source_failed',
            context: {
              phase: 'analysis_source',
              status: 'failed',
              errorType: 'analysis_source_error',
              index,
              sourceType: 'file',
              message: formatErrorMessage(error),
            },
          });
          return null;
        }
      }

      missingSourceCount += 1;
      reportBookingEvent('warn', {
        event: 'booking.photo_analysis_source_missing',
        context: {
          phase: 'analysis_source',
          status: 'missing',
          errorType: 'analysis_source_error',
          index,
          sourceType: typeof url === 'string' && url.startsWith('blob:') ? 'blob_url_without_file' : 'missing',
        },
      });
      return null;
    })
  );

  const sources = resolved.filter((value): value is string => Boolean(value));
  reportBookingEvent('info', {
    event: 'booking.photo_analysis_source_resolved',
    context: {
      phase: 'analysis_source',
      status: 'resolved',
      requestedCount: params.selectedIndices.length,
      resolvedCount: sources.length,
      remoteSourceCount,
      fileSourceCount,
      missingSourceCount,
    },
  });

  return sources;
}

export async function uploadBookingPhotoBatch(params: {
  files: File[];
  adapter: BookingPhotoUploadAdapter;
  startIndex?: number;
  retryAttempts?: number;
  retryDelayMs?: number;
  validateBeforeUpload?: boolean;
  telemetryContext?: BookingPhotoTelemetryContext;
  hooks?: BookingPhotoUploadHooks;
}): Promise<BookingPhotoUploadResult[]> {
  const adapter = params.adapter;
  const bucket = adapter.bucket || DEFAULT_BOOKING_PHOTOS_BUCKET;
  const retryAttempts = Math.max(1, params.retryAttempts || DEFAULT_BOOKING_PHOTO_UPLOAD_ATTEMPTS);
  const retryDelayMs = Math.max(0, params.retryDelayMs || DEFAULT_BOOKING_PHOTO_RETRY_DELAY_MS);
  const startIndex = params.startIndex || 0;
  const now = Date.now();

  const results = await Promise.all(
    params.files.map(async (file, relativeIndex) => {
      const index = startIndex + relativeIndex;
      const safeName = sanitizePhotoFileName(file.name, `foto_${index}.jpg`);
      let validation: ValidationResult | undefined;

      if (params.validateBeforeUpload) {
        validation = await validateImageLocal(file);
        if (!validation.isValid) {
          const failedResult: BookingPhotoUploadResult = {
            ok: false,
            uploadSucceeded: false,
            index,
            file,
            uploadedFile: file,
            attempts: 0,
            validation,
            errorMessage: getValidationMessage(validation),
          };
          reportBookingEvent('warn', {
            event: 'booking.photo_upload_validation_failed',
            context: {
              phase: 'upload',
              status: 'failed',
              errorType: 'photo_upload_error',
              index,
              fileName: file.name,
              reason: validation.reason,
              details: validation.details,
            },
          });
          await params.hooks?.onFileFailed?.(failedResult);
          return failedResult;
        }
      }

      let uploadedFile = file;
      try {
        uploadedFile = await compressImage(file);
      } catch (error) {
        reportBookingEvent('warn', {
          event: 'booking.photo_compression_failed',
          context: {
            index,
            fileName: file.name,
            message: formatErrorMessage(error),
            ...params.telemetryContext,
          },
        });
      }

      const path = adapter.buildPath({ file: uploadedFile, index, now, safeName });
      let attempts = 0;
      let uploadError: unknown;

      while (attempts < retryAttempts) {
        attempts += 1;

        const { error } = await supabase.storage
          .from(bucket)
          .upload(path, uploadedFile, {
            upsert: adapter.upsert ?? false,
            contentType: uploadedFile.type || 'image/jpeg',
          });

        if (!error) {
          const url = adapter.createSignedUrl
            ? await maybeCreateSignedUrl(
                bucket,
                path,
                adapter.signedUrlTtlSeconds || DEFAULT_BOOKING_PHOTO_SIGNED_URL_TTL_SECONDS,
                params.telemetryContext,
              )
            : undefined;

          const ok = adapter.createSignedUrl ? Boolean(url) : true;
          const result: BookingPhotoUploadResult = {
            ok,
            uploadSucceeded: true,
            index,
            file,
            uploadedFile,
            url,
            storageBucket: bucket,
            storagePath: path,
            attempts,
            validation,
            errorMessage: ok ? undefined : 'No se pudo generar una URL temporal para la imagen subida.',
          };

          if (ok) {
            reportBookingEvent('info', {
              event: 'booking.photo_upload_succeeded',
              context: {
                phase: 'upload',
                status: 'succeeded',
                index,
                attempts,
                bucket,
                path,
                ...params.telemetryContext,
              },
            });
            await params.hooks?.onFileUploaded?.(result);
          } else {
            await params.hooks?.onFileFailed?.(result);
          }

          return result;
        }

        uploadError = error;
        if (attempts < retryAttempts) {
          reportBookingEvent('warn', {
            event: 'booking.photo_upload_retry',
            context: {
              phase: 'upload',
              status: 'retry',
              index,
              attempt: attempts,
              bucket,
              path,
              message: formatErrorMessage(error),
              ...params.telemetryContext,
            },
          });
          await wait(retryDelayMs * attempts);
        }
      }

      const failedResult: BookingPhotoUploadResult = {
        ok: false,
        uploadSucceeded: false,
        index,
        file,
        uploadedFile,
        storageBucket: bucket,
        storagePath: path,
        attempts,
        validation,
        errorMessage: formatErrorMessage(uploadError),
      };

      reportBookingEvent('warn', {
        event: 'booking.photo_upload_failed',
        context: {
          phase: 'upload',
          status: 'failed',
          index,
          attempts,
          bucket,
          path,
          message: failedResult.errorMessage,
          ...params.telemetryContext,
        },
      });
      await params.hooks?.onFileFailed?.(failedResult);
      return failedResult;
    })
  );

  await params.hooks?.onComplete?.(results);
  return results;
}

export async function uploadCurrentUserDraftBookingPhotos(params: {
  files: File[];
  startIndex?: number;
  retryAttempts?: number;
  retryDelayMs?: number;
  validateBeforeUpload?: boolean;
  telemetryContext?: BookingPhotoTelemetryContext;
  hooks?: BookingPhotoUploadHooks;
}): Promise<BookingPhotoUploadResult[]> {
  const adapter = await getCurrentUserDraftBookingPhotoUploadAdapter({
    telemetryContext: params.telemetryContext,
  });

  if (!adapter) {
    const failedResults = params.files.map((file, relativeIndex) => ({
      ok: false,
      uploadSucceeded: false,
      index: (params.startIndex || 0) + relativeIndex,
      file,
      uploadedFile: file,
      attempts: 0,
      errorMessage: 'No hay un usuario autenticado para subir fotos de borrador.',
    }));
    await params.hooks?.onComplete?.(failedResults);
    return failedResults;
  }

  return uploadBookingPhotoBatch({
    files: params.files,
    adapter,
    startIndex: params.startIndex,
    retryAttempts: params.retryAttempts,
    retryDelayMs: params.retryDelayMs,
    validateBeforeUpload: params.validateBeforeUpload,
    telemetryContext: params.telemetryContext,
    hooks: params.hooks,
  });
}
