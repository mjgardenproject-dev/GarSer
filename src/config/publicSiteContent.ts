export type MarketingImageSlotKey =
  | 'home.hero.mobile'
  | 'home.hero.desktop'
  | 'home.services.lawn'
  | 'home.services.hedges'
  | 'home.services.plants'
  | 'home.services.trees'
  | 'home.services.palms'
  | 'home.services.weeding'
  | 'home.services.phyto'
  | 'home.marbella'
  | 'marbella.hero'
  | 'marbella.highlight'
  | 'costaDelSol.hero'
  | 'shared.og.home'
  | 'shared.og.marbella'
  | 'shared.og.costaDelSol'
  | 'shared.og.gardeners';

export type FaqItem = {
  question: string;
  answer: string;
};

export type HighlightedService = {
  id: string;
  title: string;
  description: string;
  imageSlot: MarketingImageSlotKey;
};

export type SeoPageData = {
  title: string;
  description: string;
  path: string;
  ogImageSlot: MarketingImageSlotKey;
};

export const SITE_URL = 'https://garser.es';
export const PUBLIC_CONTACT_EMAIL = 'info@garser.es';
/** WhatsApp de contacto y ayuda (bloque «Contacto y ayuda» del pie de las páginas públicas). */
export const PUBLIC_WHATSAPP_NUMBER = '+34 694 26 86 53';
export const PUBLIC_WHATSAPP_URL = 'https://wa.me/34694268653';
/** Ancla del bloque «Contacto y ayuda» del pie; la usa el botón de ayuda de la cabecera. */
export const PUBLIC_CONTACT_ANCHOR = 'contacto';

export const marketingImageSlots: Record<MarketingImageSlotKey, string> = {
  'home.hero.mobile': 'home/hero-mobile.webp',
  'home.hero.desktop': 'home/hero-desktop.webp',
  'home.services.lawn': 'home/services/lawn.webp',
  'home.services.hedges': 'home/services/hedges.webp',
  'home.services.plants': 'home/services/plants.webp',
  'home.services.trees': 'home/services/trees.webp',
  'home.services.palms': 'home/services/palms.webp',
  'home.services.weeding': 'home/services/weeding.webp',
  'home.services.phyto': 'home/services/phyto.webp',
  'home.marbella': 'home/marbella-highlight.webp',
  'marbella.hero': 'marbella/hero.webp',
  'marbella.highlight': 'marbella/highlight.webp',
  'costaDelSol.hero': 'costa-del-sol/hero.webp',
  'shared.og.home': 'shared/og/home.webp',
  'shared.og.marbella': 'shared/og/marbella.webp',
  'shared.og.costaDelSol': 'shared/og/costa-del-sol.webp',
  'shared.og.gardeners': 'shared/og/gardeners.webp',
};

export const serviceHighlights: HighlightedService[] = [
  {
    id: 'lawn',
    title: 'Corte de césped',
    description: 'Para jardines que necesitan un mantenimiento limpio, regular y sin complicaciones.',
    imageSlot: 'home.services.lawn',
  },
  {
    id: 'hedges',
    title: 'Poda de setos',
    description: 'Recortes precisos para recuperar forma, orden y buena presencia en la parcela.',
    imageSlot: 'home.services.hedges',
  },
  {
    id: 'plants',
    title: 'Poda de plantas',
    description: 'Recorte de plantas y arbustos para mantener volumen, salud y una imagen cuidada del jardín.',
    imageSlot: 'home.services.plants',
  },
  {
    id: 'trees',
    title: 'Poda de árboles',
    description: 'Trabajos de poda pensados para seguridad, volumen y mantenimiento del jardín.',
    imageSlot: 'home.services.trees',
  },
  {
    id: 'palms',
    title: 'Poda de palmeras',
    description: 'Servicio especializado para palmeras con retirada de hojas secas y restos.',
    imageSlot: 'home.services.palms',
  },
  {
    id: 'weeding',
    title: 'Desbroce',
    description: 'Limpieza de zonas con maleza para recuperar uso, orden y acceso.',
    imageSlot: 'home.services.weeding',
  },
  {
    id: 'phyto',
    title: 'Servicios fitosanitarios',
    description: 'Tratamientos cuando hace falta proteger plantas y césped con criterio profesional.',
    imageSlot: 'home.services.phyto',
  },
];

export const generalHomeFaqs: FaqItem[] = [
  {
    question: '¿Cómo empiezo una reserva en GarSer?',
    answer: 'Indicas tu dirección, eliges el servicio y avanzas por un proceso guiado hasta confirmar la reserva.',
  },
  {
    question: '¿Puedo continuar una reserva que dejé a medias?',
    answer: 'Si existe un borrador guardado, la portada te muestra la opción de continuar desde el mismo flujo.',
  },
  {
    question: '¿En qué zonas trabaja GarSer?',
    answer: 'GarSer no está limitado a una única zona: cualquier jardinero de España puede unirse a la plataforma, y estamos empezando por la Costa del Sol. Al indicar tu dirección te mostramos los profesionales que llegan hasta tu jardín.',
  },
  {
    question: '¿Qué tipo de servicios puedo reservar?',
    answer: 'Puedes solicitar trabajos habituales de jardinería como corte de césped, poda, desbroce o servicios fitosanitarios.',
  },
];

export const marbellaFaqs: FaqItem[] = [
  {
    question: '¿Buscáis jardineros en Marbella para trabajos puntuales?',
    answer: 'Sí. La página de Marbella está pensada para clientes que quieren reservar trabajos concretos de jardinería en la zona.',
  },
  {
    question: '¿Puedo reservar mantenimiento de jardín en Marbella?',
    answer: 'Puedes iniciar una reserva desde la propia landing y completar el flujo con los detalles de tu jardín.',
  },
  {
    question: '¿GarSer trabaja solo en Marbella?',
    answer: 'No. Marbella es una zona prioritaria, pero GarSer también orienta su servicio a otras áreas de la Costa del Sol.',
  },
];

export const costaDelSolFaqs: FaqItem[] = [
  {
    question: '¿Hay jardineros en mi zona de la Costa del Sol?',
    answer: 'Depende de tu dirección: cada jardinero fija hasta dónde se desplaza. Al indicarla al reservar te mostramos los profesionales que llegan hasta tu jardín.',
  },
  {
    question: '¿Cuánto cuesta un jardinero en la Costa del Sol?',
    answer: 'No hay una tarifa única: cada jardinero configura sus precios. Al describir tu jardín con fotos o medidas, GarSer te muestra el precio calculado con las tarifas reales de los profesionales disponibles en tu zona, antes de reservar y sin compromiso.',
  },
  {
    question: '¿Qué diferencia hay entre esta página y la de Marbella?',
    answer: 'Esta página cubre toda la Costa del Sol. Si tu vivienda está en Marbella, la página específica de Marbella tiene la información centrada en ese municipio.',
  },
  {
    question: '¿Puedo reservar si no estoy en la vivienda?',
    answer: 'Sí. La reserva y el seguimiento se hacen online y hablas con el profesional por el chat. El servicio se lo pagas directamente a él, de la manera que acordéis.',
  },
];

export const gardenersFaqs: FaqItem[] = [
  {
    question: '¿Cuánto me cuesta?',
    answer: 'Nada. No hay cuota ni comisión: cobras el 100 % de tu precio.',
  },
  {
    question: '¿Mis clientes pagan algo por reservar conmigo?',
    answer: 'No. Si reservan desde tu enlace o vuelven a reservar contigo, pagan tu precio y nada más.',
  },
  {
    question: '¿Y los clientes nuevos que me mande GarSer?',
    answer: 'Esos pagan unos gastos de gestión a GarSer al reservar. Los paga el cliente, aparte: a ti no se te descuenta nada.',
  },
  {
    question: '¿Cómo me pagan mis clientes?',
    answer: 'Directamente a ti al terminar el trabajo, de la manera que acordéis. GarSer no toca tu dinero.',
  },
  {
    question: '¿Mis clientes tienen que registrarse?',
    answer: 'Solo para confirmar. Ven tu precio y tus huecos sin cuenta, y en el último paso crean una con su correo. Así siguen la reserva y hablan contigo por el chat.',
  },
  {
    question: '¿Sirve para empresas con empleados?',
    answer: 'Sí. Das de alta tu empresa, añades a tu equipo y cada empleado ve sus trabajos en su app. GarSer reparte los trabajos o eliges tú quién va.',
  },
  {
    question: '¿Necesito instalar algo?',
    answer: 'No. Funciona en el navegador del móvil o del ordenador. Si quieres, la añades a tu pantalla de inicio desde Safari o Chrome y activas los avisos en el móvil.',
  },
];

export const pageSeo = {
  general: {
    title: 'Servicios de jardinería a domicilio | GarSer',
    description:
      'Reserva servicios de jardinería para tu vivienda con precios claros y disponibilidad real de jardineros profesionales, con un proceso pensado para clientes reales.',
    path: '/',
    ogImageSlot: 'shared.og.home',
  } satisfies SeoPageData,
  marbella: {
    title: 'Jardinería en Marbella | Reserva online con GarSer',
    description:
      'Reserva trabajos de jardinería en Marbella con una experiencia clara, mobile first y enfocada a viviendas particulares.',
    path: '/marbella',
    ogImageSlot: 'shared.og.marbella',
  } satisfies SeoPageData,
  costaDelSol: {
    title: 'Jardinería en la Costa del Sol | Precios y disponibilidad | GarSer',
    description:
      'Servicios de jardinería en la Costa del Sol: corte de césped, poda de setos, árboles y palmeras, desbroce y tratamientos. Consulta precio y disponibilidad de jardineros en Marbella, Estepona, Benahavís y alrededores.',
    path: '/costa-del-sol',
    ogImageSlot: 'shared.og.costaDelSol',
  } satisfies SeoPageData,
  gardeners: {
    title: 'Portal para jardineros gratis: reservas y clientes | GarSer',
    description:
      'Portal y app gratis para jardineros y empresas: tus clientes reservan con tu enlace, tus precios y tu agenda, sin comisión. Y GarSer te trae clientes nuevos.',
    path: '/para-jardineros',
    ogImageSlot: 'shared.og.gardeners',
  } satisfies SeoPageData,
};

export const generalHomeContent = {
  eyebrow: 'Reserva jardinería a domicilio',
  title: 'Descubre cuánto cuesta y cuándo hay disponibilidad para tu jardín',
  primaryCtaLabel: 'Empezar nueva reserva',
  resumeCtaLabel: 'Continuar reserva',
  bookingsCtaLabel: 'Ver mis reservas',
  howItWorks: [
    {
      title: 'Indica tu jardín',
      description: 'Empiezas con la dirección, el servicio y los detalles que hacen falta para valorar bien el trabajo.',
    },
    {
      title: 'Elige disponibilidad',
      description: 'El flujo te lleva hasta fecha, horario y profesional disponible sin tener que improvisar pasos.',
    },
    {
      title: 'Confirma la reserva',
      description: 'Terminas la reserva dentro del mismo proceso y mantienes el seguimiento desde tu cuenta si ya eres cliente.',
    },
  ],
  faqTitle: 'Preguntas frecuentes',
  gardenerCtaBadge: '¿Eres jardinero?',
  gardenerCtaTitle: 'Descubre las ventajas de trabajar con GarSer',
  gardenerCtaDescription:
    'Tus clientes te reservan con tu enlace, sin comisión, y GarSer te trae clientes nuevos. Gratis para ti.',
  gardenerCtaButtonLabel: 'Ver ventajas para jardineros',
};

export const marbellaContent = {
  eyebrow: 'Jardinería en Marbella',
  title: 'Reserva servicios de jardinería en Marbella con una experiencia clara',
  description:
    'Una página pensada para propietarios de viviendas que buscan resolver mantenimiento, poda o trabajos de jardín en Marbella sin perder tiempo.',
  highlightTitle: 'Una landing específica para quien busca jardinería en Marbella',
  highlightDescription:
    'El objetivo aquí no es vender humo. Es dejar claro que puedes empezar una reserva, describir tu caso y avanzar por un proceso sencillo desde el móvil.',
  finalCtaTitle: 'Si necesitas un trabajo de jardinería en Marbella, empieza por aquí',
  finalCtaDescription:
    'Desde esta página puedes ir directo al flujo de reserva o volver a la portada general si prefieres una vista más amplia de GarSer.',
};

export const costaDelSolContent = {
  eyebrow: 'Jardinería en la Costa del Sol',
  title: 'Jardineros en la Costa del Sol: mira el precio y la disponibilidad antes de reservar',
  description:
    'De Estepona a Marbella, muchas viviendas y urbanizaciones necesitan mantenimiento puntual de jardín sin atarse a un contrato anual. Aquí describes tu jardín, ves el precio calculado con las tarifas reales de los jardineros de tu zona y eliges día.',
  finalCtaTitle: '¿Tienes un jardín en la Costa del Sol? Empieza por el precio',
  finalCtaDescription:
    'Sin visitas comerciales ni llamadas para pedir presupuesto: describes el jardín, ves el precio y la disponibilidad real, y reservas si te encaja.',
};

/** Captura de la app que acompaña a cada paso de «Así funciona» (la pinta GardenersLandingPage). */
export type GardenersStepMockup = 'agenda' | 'link' | 'client';
/** Icono de cada línea de «Y además» (la página la traduce a un icono de Lucide). */
export type GardenersExtraIcon = 'chat' | 'reviews' | 'repeat' | 'price' | 'multiday' | 'done' | 'alerts';

/**
 * Textos de /para-jardineros. Modelo que se explica (decisión del dueño, 2026-10-16): el
 * profesional no paga nada; sus clientes (los de su enlace y los que vuelven con él) tampoco;
 * los clientes que trae GarSer pagan ellos los gastos de gestión. Lo aplica el servidor con el
 * interruptor de Ajustes del admin (migración 20261019120000_own_clients_fee_waiver): mientras esté
 * apagado, todos los clientes siguen pagando gastos de gestión.
 */
export const gardenersContent = {
  hero: {
    eyebrow: 'Para jardineros y empresas de jardinería',
    title: 'La app gratis para gestionar las reservas de tus clientes',
    description:
      'Mandas tu enlace y tus clientes te reservan solos, con tus precios y en tus huecos libres. Además, GarSer te trae clientes nuevos.',
    highlights: [
      'Gratis para ti: sin cuota ni comisión',
      'Tus clientes reservan sin pagar comisión',
      'Cobras el 100 % de tu precio',
    ],
    primaryCtaLabel: 'Crear mi cuenta gratis',
    primaryCtaNote: 'Sin tarjeta ni permanencia. Revisamos tu alta en menos de 24 h.',
    companiesLinkLabel: '¿Tienes una empresa con empleados? Mira cómo funciona para equipos',
  },
  feeSplit: {
    title: 'Para ti es gratis. Para tus clientes, sin comisión.',
    intro: 'Nunca pagas nada a GarSer. Lo único que cambia es quién trae al cliente:',
    rows: [
      {
        id: 'own',
        label: 'Tus clientes',
        who: 'Reservan con tu enlace o vuelven a reservar contigo.',
        badge: 'Sin comisión',
        result: 'Pagan tu precio y nada más.',
      },
      {
        id: 'garser',
        label: 'Clientes nuevos de GarSer',
        who: 'Te encuentran buscando jardinero en garser.es.',
        badge: 'Gastos de gestión',
        result: 'Esos gastos los paga el cliente, aparte. Tú cobras tu precio entero.',
      },
    ],
    loyaltyNote:
      'Y si un cliente que te trajo GarSer vuelve a reservar contigo, pasa a ser tuyo: deja de pagar gastos de gestión.',
  },
  stepsTitle: 'Así funciona',
  steps: [
    {
      title: 'Crea tu cuenta y pon tus precios',
      description:
        'Para cada servicio: por m², por metro o por hora, con precio mínimo y recargos. Y tu horario y hasta dónde te desplazas.',
      mockup: 'agenda',
      caption: 'Tu horario de la semana',
    },
    {
      title: 'Manda tu enlace a tus clientes',
      description:
        'Lo tienes en «Mi cuenta». Pégalo en WhatsApp o en tu Instagram: quien reserve desde ahí, reserva contigo.',
      mockup: 'link',
      caption: 'Tu enlace, en «Mi cuenta»',
    },
    {
      title: 'Ellos reservan, tú aceptas',
      description:
        'Eligen servicios, mandan fotos o responden unas preguntas y ven tu precio y tus huecos libres. Te llega la solicitud y la aceptas.',
      mockup: 'client',
      caption: 'Tu cliente, reservando desde el móvil',
    },
  ] satisfies { title: string; description: string; mockup: GardenersStepMockup; caption: string }[],
  extrasTitle: 'Y además, en la misma app',
  extras: [
    { icon: 'chat', text: 'Chat con el cliente sin dar tu teléfono' },
    { icon: 'reviews', text: 'Reseñas reales en tu perfil público' },
    { icon: 'repeat', text: 'Mantenimientos cada semana, cada 2 semanas o cada mes' },
    { icon: 'price', text: '¿No es como en las fotos? Antes de aceptar, propones otro precio' },
    { icon: 'multiday', text: 'Trabajos grandes repartidos en varios días' },
    { icon: 'done', text: 'Pulsas «He terminado» y el cliente lo confirma' },
    { icon: 'alerts', text: 'Avisos por correo y en el móvil' },
  ] satisfies { icon: GardenersExtraIcon; text: string }[],
  companies: {
    eyebrow: 'Empresas de jardinería',
    title: '¿Tienes equipo? GarSer reparte el trabajo',
    intro: 'Lo mismo que para un autónomo, con tu enlace incluido, y además:',
    points: [
      'Cada empleado tiene su horario y su app, «Mi trabajo», con sus trabajos del día.',
      'GarSer asigna cada trabajo a quien está libre, o eliges tú quién va. Si hace falta, van varios a la vez.',
      'Ves la agenda de todo el equipo, cambias quién va o propones otra fecha al cliente.',
    ],
    ctaLabel: 'Dar de alta mi empresa',
    ctaNote: 'También gratis. Revisamos la solicitud en menos de 24 h.',
  },
  faqTitle: 'Preguntas frecuentes',
  finalCta: {
    title: 'Empieza con los clientes que ya tienes',
    description: 'Crea tu cuenta, pon tus precios y manda tu enlace.',
  },
};
