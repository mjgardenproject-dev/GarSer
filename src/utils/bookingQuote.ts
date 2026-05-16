import type { BookingData } from '../contexts/BookingContext';
import {
  buildAuthoritativeBookingQuote,
  type BookingQuoteLine,
  type BookingQuoteResult,
} from '../shared/bookingQuoteCore';

export type { BookingQuoteLine, BookingQuoteResult };

export function buildBookingQuote(params: {
  bookingData: BookingData;
  providerConfig: any;
  globalMinPrice?: number;
}): BookingQuoteResult {
  return buildAuthoritativeBookingQuote(params);
}
