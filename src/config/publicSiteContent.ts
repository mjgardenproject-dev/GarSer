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
  | 'costaDelSol.hero'
  | 'gardeners.hero'
  | 'gardeners.process'
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
  'costaDelSol.hero': 'costa-del-sol/hero.webp',
  'gardeners.hero': 'gardeners/hero.webp',
  'gardeners.process': 'gardeners/process.webp',
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

export const costaDelSolZones = [
  'Marbella',
  'Estepona',
  'San Pedro de Alcántara',
  'Guadalmina',
  'Benahavís',
  'Los Monteros',
  'Nueva Andalucía',
  'La Quinta',
  'Costa del Sol',
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
    answer: 'GarSer no está limitado a una única zona: cualquier jardinero de España puede unirse a la plataforma. Hoy la mayor disponibilidad está en la Costa del Sol, que es donde estamos lanzando el servicio, y vamos ampliando a más ciudades.',
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
    question: '¿En qué municipios de la Costa del Sol trabaja GarSer?',
    answer: 'GarSer opera en Marbella, Estepona, San Pedro de Alcántara, Guadalmina, Benahavís, Los Monteros, Nueva Andalucía, La Quinta y alrededores. Cada jardinero define su propio radio de trabajo, así que la disponibilidad real depende de tu dirección exacta.',
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
    answer: 'Sí. La reserva, el seguimiento y el pago se gestionan online, así que puedes contratar el servicio sin estar presente el día del trabajo.',
  },
];

export const gardenersFaqs: FaqItem[] = [
  {
    question: '¿Qué es GarSer para un jardinero?',
    answer: 'Es un portal para jardineros donde el cliente describe su jardín con fotos y medidas, GarSer calcula el precio con las tarifas que tú configuras, y tú decides si aceptas el trabajo. No pagas por darte de alta: GarSer se queda una comisión de gestión del 12,5% sobre las reservas que completas.',
  },
  {
    question: '¿Cómo consigo clientes de jardinería con GarSer?',
    answer: 'No tienes que buscarlos. Los clientes entran a reservar un servicio concreto, y GarSer les muestra los jardineros disponibles en su zona según tu radio de trabajo y tu disponibilidad. Cuantas más reseñas acumulas, más peso tiene tu perfil.',
  },
  {
    question: '¿Quién puede registrarse como jardinero?',
    answer: 'La página está pensada para autónomos y empresas de jardinería que quieran recibir nuevas reservas a través de GarSer.',
  },
  {
    question: '¿Cómo funciona el alta profesional?',
    answer: 'Creas tu cuenta, completas la información solicitada y el equipo revisa la solicitud antes de activar el perfil.',
  },
  {
    question: '¿Qué servicios puede ofrecer un jardinero en GarSer?',
    answer: 'La plataforma está orientada a servicios habituales de jardinería residencial, poda, mantenimiento, palmeras y otros trabajos relacionados.',
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
    title: 'Portal para jardineros | Consigue clientes con GarSer',
    description:
      'GarSer es el portal para jardineros autónomos y empresas de jardinería: presupuesta sin desplazarte, cobra online con tus tarifas y llena tu agenda con clientes que ya quieren reservar.',
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
  coverageTitle: 'Encuentra jardineros en tu zona',
  coverageDescription:
    'Indica tu dirección al reservar y te mostramos qué jardineros profesionales están disponibles cerca de ti.',
  findGardenersCtaLabel: 'Buscar jardineros en mi zona',
  faqTitle: 'Preguntas frecuentes',
  gardenerCtaBadge: '¿Eres jardinero?',
  gardenerCtaTitle: 'Descubre las ventajas de trabajar con GarSer',
  gardenerCtaDescription:
    'Recibe clientes reales en tu zona, gestiona tu agenda y cobra de forma segura, sin tener que buscar trabajo uno a uno.',
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
  coverageTitle: 'Cobertura orientada a la Costa del Sol',
  coverageDescription:
    'La propuesta está pensada para propietarios de viviendas con jardín en zonas residenciales y urbanizaciones de la Costa del Sol.',
  finalCtaTitle: 'Si necesitas un trabajo de jardinería en Marbella, empieza por aquí',
  finalCtaDescription:
    'Desde esta página puedes ir directo al flujo de reserva o volver a la portada general si prefieres una vista más amplia de GarSer.',
};

export const costaDelSolContent = {
  eyebrow: 'Jardinería en la Costa del Sol',
  title: 'Jardineros en la Costa del Sol: mira el precio y la disponibilidad antes de reservar',
  description:
    'De Estepona a Marbella, muchas viviendas y urbanizaciones necesitan mantenimiento puntual de jardín sin atarse a un contrato anual. Aquí describes tu jardín, ves el precio calculado con las tarifas reales de los jardineros de tu zona y eliges día.',
  coverageTitle: 'Municipios y urbanizaciones donde ya trabajamos',
  coverageDescription:
    'Estas son las zonas de la Costa del Sol con jardineros dados de alta en GarSer. Cada profesional fija su propio radio de trabajo, así que al indicar tu dirección verás exactamente quién llega hasta tu jardín.',
  finalCtaTitle: '¿Tienes un jardín en la Costa del Sol? Empieza por el precio',
  finalCtaDescription:
    'Sin visitas comerciales ni llamadas para pedir presupuesto: describes el jardín, ves el precio y la disponibilidad real, y reservas si te encaja.',
};

export const gardenersContent = {
  eyebrow: 'Portal para jardineros y empresas',
  title: 'El portal para jardineros que te ahorra tiempo y dinero en cada presupuesto',
  description:
    'Deja de perder mañanas enteras visitando jardines solo para dar un precio. En GarSer el cliente sube las fotos, el trabajo te llega ya valorado en euros y horas, y cobras por la plataforma sin perseguir a nadie.',
  benefits: [
    {
      icon: 'camera',
      title: 'Presupuesta sin desplazarte',
      description:
        'El cliente sube fotos y medidas de su jardín y GarSer calcula el precio y las horas con tus propias tarifas. Tú ves el trabajo ya valorado antes de aceptarlo.',
    },
    {
      icon: 'shield-check',
      title: 'Cobra siempre, sin perseguir pagos',
      description:
        'El pago se gestiona online dentro de la plataforma. Se acabó el "ya te haré una transferencia", el efectivo y las facturas que nadie paga.',
    },
    {
      icon: 'calendar-check',
      title: 'Tu agenda se llena sola',
      description:
        'Configuras tus días, horarios y radio de trabajo una vez. GarSer solo te ofrece trabajos que encajan en tus huecos libres, sin llamadas para cuadrar horarios.',
    },
    {
      icon: 'star',
      title: 'Tu reputación, por escrito',
      description:
        'Cada trabajo terminado suma reseñas reales a tu perfil público. Lo que en el boca a boca se pierde, aquí queda y te trae al siguiente cliente.',
    },
    {
      icon: 'message-circle',
      title: 'Habla con el cliente sin dar tu número',
      description:
        'Chat integrado para resolver dudas antes y durante el trabajo. Tu teléfono personal sigue siendo tuyo.',
    },
    {
      icon: 'percent',
      title: 'Comisión clara desde el minuto uno',
      description:
        'GarSer se queda un 12,5% de gestión, ya contemplado en lo que ve el cliente. Sabes exactamente cuánto cobras antes de aceptar cada trabajo.',
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
  finalCtaTitle: 'Si ofreces servicios de jardinería, entra por la vía profesional',
  finalCtaDescription:
    'La página para jardineros está separada de la portada de cliente para que el mensaje, el alta y la conversión tengan sentido.',
};
