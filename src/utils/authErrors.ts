// Errores de acceso y registro, en español y con lo que hay que hacer (QA-039). Supabase Auth responde
// en inglés («Email not confirmed», «Invalid login credentials»…): la web nunca debe enseñarlo tal cual.

export type AuthErrorKind =
  | 'email_not_confirmed'
  | 'invalid_credentials'
  | 'already_registered'
  | 'rate_limited'
  | 'weak_password'
  | 'network'
  | 'unknown';

export interface ClassifiedAuthError {
  kind: AuthErrorKind;
  message: string;
}

interface AuthErrorLike {
  message?: unknown;
  code?: unknown;
  status?: unknown;
}

const MESSAGES: Record<Exclude<AuthErrorKind, 'unknown'>, string> = {
  email_not_confirmed:
    'Todavía tienes que confirmar tu correo. Te enviamos un mensaje al registrarte: ábrelo y pulsa el enlace. Si no lo encuentras, mira en spam o pide que te lo reenviemos.',
  invalid_credentials:
    'Este correo electrónico no parece estar registrado o la contraseña es incorrecta. Si aún no tienes cuenta, por favor regístrate.',
  already_registered: 'Esta cuenta ya está registrada. Por favor, inicia sesión simplemente.',
  rate_limited: 'Has hecho demasiados intentos seguidos. Espera un minuto y vuelve a intentarlo.',
  weak_password: 'La contraseña es demasiado débil. Usa al menos 8 caracteres.',
  network: 'No hemos podido conectar. Comprueba tu conexión y vuelve a intentarlo.',
};

const UNKNOWN = 'Ha ocurrido un error. Vuelve a intentarlo en unos segundos.';

// Un mensaje que ya está escrito en español (lo lanzamos nosotros) se respeta tal cual.
const looksSpanish = (text: string) => /[áéíóúñ¿¡]|\b(el|la|los|las|tu|tus|una|un|de|que|no|se|por)\b/i.test(text) && !/[a-z]+ (is|are|was|should|must|not|failed|error)\b/i.test(text);

export function classifyAuthError(error: unknown): ClassifiedAuthError {
  const e = (error ?? {}) as AuthErrorLike;
  const message = typeof e.message === 'string' ? e.message : '';
  const code = typeof e.code === 'string' ? e.code : '';
  const text = `${message} ${code}`.toLowerCase();

  if (code === 'email_not_confirmed' || /email not confirmed|verifica tu correo|confirma tu correo/.test(text)) {
    return { kind: 'email_not_confirmed', message: MESSAGES.email_not_confirmed };
  }
  if (/invalid login credentials|invalid_credentials/.test(text)) return { kind: 'invalid_credentials', message: MESSAGES.invalid_credentials };
  if (/user already registered|user_already_exists|already been registered/.test(text)) return { kind: 'already_registered', message: MESSAGES.already_registered };
  if (/rate limit|rate_limit|for security purposes|too many requests|over_email_send/.test(text) || e.status === 429) {
    return { kind: 'rate_limited', message: MESSAGES.rate_limited };
  }
  if (/weak_password|password should be at least/.test(text)) return { kind: 'weak_password', message: MESSAGES.weak_password };
  if (/failed to fetch|networkerror|network request failed|load failed/.test(text)) return { kind: 'network', message: MESSAGES.network };
  if (message && looksSpanish(message)) return { kind: 'unknown', message };
  return { kind: 'unknown', message: UNKNOWN };
}
