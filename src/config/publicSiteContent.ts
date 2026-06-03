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
  | 'home.coverage'
  | 'home.marbella'
  | 'marbella.hero'
  | 'marbella.highlight'
  | 'gardeners.hero'
  | 'gardeners.process'
  | 'shared.og.home'
  | 'shared.og.marbella'
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
export const PUBLIC_CONTACT_EMAIL = '';

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
  'home.coverage': 'home/coverage/costa-del-sol.webp',
  'home.marbella': 'home/marbella-highlight.webp',
  'marbella.hero': 'marbella/hero.webp',
  'marbella.highlight': 'marbella/highlight.webp',
  'gardeners.hero': 'gardeners/hero.webp',
  'gardeners.process': 'gardeners/process.webp',
  'shared.og.home': 'shared/og/home.webp',
  'shared.og.marbella': 'shared/og/marbella.webp',
  'shared.og.gardeners': 'shared/og/gardeners.webp',
};

export const serviceHighlights: HighlightedService[] = [
  {
    id: 'lawn',
    title: 'Corte de cesped',
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
    description: 'Recorte de plantas y arbustos para mantener volumen, salud y una imagen cuidada del jardin.',
    imageSlot: 'home.services.plants',
  },
  {
    id: 'trees',
    title: 'Poda de arboles',
    description: 'Trabajos de poda pensados para seguridad, volumen y mantenimiento del jardin.',
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
    description: 'Tratamientos cuando hace falta proteger plantas y cesped con criterio profesional.',
    imageSlot: 'home.services.phyto',
  },
];

export const costaDelSolZones = [
  'Marbella',
  'Estepona',
  'San Pedro de Alcantara',
  'Guadalmina',
  'Benahavis',
  'Los Monteros',
  'Nueva Andalucia',
  'La Quinta',
  'Costa del Sol',
];

export const generalHomeFaqs: FaqItem[] = [
  {
    question: 'Como empiezo una reserva en GarSer',
    answer: 'Indicas tu direccion, eliges el servicio y avanzas por un proceso guiado hasta confirmar la reserva.',
  },
  {
    question: 'Puedo continuar una reserva que deje a medias',
    answer: 'Si existe un borrador guardado, la portada te muestra la opcion de continuar desde el mismo flujo.',
  },
  {
    question: 'En que zonas trabaja GarSer',
    answer: 'La web esta orientada a clientes de Marbella, Estepona y otras zonas de la Costa del Sol.',
  },
  {
    question: 'Que tipo de servicios puedo reservar',
    answer: 'Puedes solicitar trabajos habituales de jardineria como corte de cesped, poda, desbroce o servicios fitosanitarios.',
  },
];

export const marbellaFaqs: FaqItem[] = [
  {
    question: 'Buscais jardineros en Marbella para trabajos puntuales',
    answer: 'Si. La pagina de Marbella esta pensada para clientes que quieren reservar trabajos concretos de jardineria en la zona.',
  },
  {
    question: 'Puedo reservar mantenimiento de jardin en Marbella',
    answer: 'Puedes iniciar una reserva desde la propia landing y completar el flujo con los detalles de tu jardin.',
  },
  {
    question: 'GarSer trabaja solo en Marbella',
    answer: 'No. Marbella es una zona prioritaria, pero GarSer tambien orienta su servicio a otras areas de la Costa del Sol.',
  },
];

export const gardenersFaqs: FaqItem[] = [
  {
    question: 'Quien puede registrarse como jardinero',
    answer: 'La pagina esta pensada para autonomos y empresas de jardineria que quieran recibir nuevas reservas a traves de GarSer.',
  },
  {
    question: 'Como funciona el alta profesional',
    answer: 'Creas tu cuenta, completas la informacion solicitada y el equipo revisa la solicitud antes de activar el perfil.',
  },
  {
    question: 'Que servicios puede ofrecer un jardinero en GarSer',
    answer: 'La plataforma esta orientada a servicios habituales de jardineria residencial, poda, mantenimiento, palmeras y otros trabajos relacionados.',
  },
];

export const pageSeo = {
  general: {
    title: 'Servicios de jardineria en Costa del Sol | GarSer',
    description:
      'Reserva servicios de jardineria para tu vivienda en Marbella, Estepona y Costa del Sol con un proceso claro y pensado para clientes reales.',
    path: '/',
    ogImageSlot: 'shared.og.home',
  } satisfies SeoPageData,
  marbella: {
    title: 'Jardineria en Marbella | Reserva online con GarSer',
    description:
      'Reserva trabajos de jardineria en Marbella con una experiencia clara, mobile first y enfocada a viviendas particulares.',
    path: '/marbella',
    ogImageSlot: 'shared.og.marbella',
  } satisfies SeoPageData,
  gardeners: {
    title: 'Trabaja como jardinero en Costa del Sol | GarSer',
    description:
      'Descubre lo que ofrece GarSer a jardineros y empresas de jardineria que quieren captar nuevas reservas en Costa del Sol.',
    path: '/para-jardineros',
    ogImageSlot: 'shared.og.gardeners',
  } satisfies SeoPageData,
};

export const generalHomeContent = {
  eyebrow: 'Reserva jardineria a domicilio',
  title: 'Servicios de jardineria en Marbella, Estepona y Costa del Sol',
  description:
    'GarSer te ayuda a reservar trabajos de jardineria para tu vivienda con un proceso claro, sin vueltas y pensado para quien solo quiere resolver bien su jardin.',
  primaryCtaLabel: 'Empezar nueva reserva',
  resumeCtaLabel: 'Continuar reserva',
  accessCtaLabel: 'Acceder',
  bookingsCtaLabel: 'Ver mis reservas',
  howItWorks: [
    {
      title: 'Indica tu jardin',
      description: 'Empiezas con la direccion, el servicio y los detalles que hacen falta para valorar bien el trabajo.',
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
  coverageTitle: 'Cobertura orientada a la Costa del Sol',
  coverageDescription:
    'La propuesta esta pensada para propietarios de viviendas con jardin en zonas residenciales y urbanizaciones de la Costa del Sol.',
  faqTitle: 'Preguntas frecuentes',
  finalCtaTitle: 'Reserva cuando te venga bien, sin perder el hilo del proceso',
  finalCtaDescription:
    'La portada te lleva directamente al flujo de reserva y, si ya habias empezado, te permite retomar donde lo dejaste.',
};

export const marbellaContent = {
  eyebrow: 'Jardineria en Marbella',
  title: 'Reserva servicios de jardineria en Marbella con una experiencia clara',
  description:
    'Una pagina pensada para propietarios de viviendas que buscan resolver mantenimiento, poda o trabajos de jardin en Marbella sin perder tiempo.',
  highlightTitle: 'Una landing especifica para quien busca jardineria en Marbella',
  highlightDescription:
    'El objetivo aqui no es vender humo. Es dejar claro que puedes empezar una reserva, describir tu caso y avanzar por un proceso sencillo desde el movil.',
  finalCtaTitle: 'Si necesitas un trabajo de jardineria en Marbella, empieza por aqui',
  finalCtaDescription:
    'Desde esta pagina puedes ir directo al flujo de reserva o volver a la portada general si prefieres una vista mas amplia de GarSer.',
};

export const gardenersContent = {
  eyebrow: 'Para jardineros y empresas',
  title: 'GarSer para jardineros que quieren captar nuevas reservas en Costa del Sol',
  description:
    'Una pagina dirigida a autonomos y empresas de jardineria que buscan una via digital para recibir nuevas oportunidades de trabajo.',
  benefits: [
    {
      title: 'Clientes con intencion de reservar',
      description: 'La propuesta gira alrededor de reservas reales y no de un simple directorio sin contexto.',
    },
    {
      title: 'Proceso claro de alta',
      description: 'El registro esta pensado para revisar bien la informacion del profesional antes de activar el perfil.',
    },
    {
      title: 'Cobertura local',
      description: 'El foco esta puesto en Costa del Sol y en zonas donde el trabajo residencial de jardin tiene demanda real.',
    },
  ],
  process: [
    {
      title: 'Crea tu cuenta',
      description: 'Empiezas el alta desde la web y eliges el perfil de jardinero.',
    },
    {
      title: 'Completa la solicitud',
      description: 'Aportas los datos necesarios para que el equipo pueda revisar tu perfil con criterio.',
    },
    {
      title: 'Activa tu perfil',
      description: 'Cuando la cuenta queda validada, puedes operar dentro de GarSer como profesional.',
    },
  ],
  finalCtaTitle: 'Si ofreces servicios de jardineria, entra por la via profesional',
  finalCtaDescription:
    'La pagina para jardineros esta separada de la portada de cliente para que el mensaje, el alta y la conversion tengan sentido.',
};
