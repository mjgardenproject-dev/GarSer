import { loadStripe, type Stripe } from '@stripe/stripe-js';

let stripePromise: Promise<Stripe | null> | null = null;
let stripePublishableKey: string | null = null;

export function resolveStripePublishableKey(
  env: Record<string, unknown>,
  fallbackPublishableKey?: string | null,
) {
  const publishableKey = String(env.VITE_STRIPE_PUBLISHABLE_KEY || fallbackPublishableKey || '').trim();

  if (!publishableKey) {
    throw new Error('Falta la publishable key de Stripe para inicializar Stripe Elements.');
  }

  return publishableKey;
}

export function getStripePromise(options?: { publishableKey?: string | null }) {
  const publishableKey = resolveStripePublishableKey(import.meta.env, options?.publishableKey);

  if (!stripePromise || stripePublishableKey !== publishableKey) {
    stripePublishableKey = publishableKey;
    stripePromise = loadStripe(publishableKey);
  }

  return stripePromise;
}
