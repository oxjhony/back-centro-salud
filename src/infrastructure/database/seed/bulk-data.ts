import { deflateSync } from 'node:zlib';
import { csv, simplePdf } from './demo-files';
import { TaxonomySeed } from './taxonomy-data';

/** Vocabulario y generadores de la semilla masiva. Todo es sintetico y reproducible. */

// --- Azar reproducible ----------------------------------------------------------------------------

export type Random = () => number;

/** mulberry32: misma semilla, mismos datos en cada ejecucion. */
export function createRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = <T>(rng: Random, items: readonly T[]): T => items[Math.floor(rng() * items.length)];
export const int = (rng: Random, min: number, max: number): number => min + Math.floor(rng() * (max - min + 1));
export const chance = (rng: Random, probability: number): boolean => rng() < probability;

/** `count` elementos distintos, sin alterar el arreglo original. */
export function sample<T>(rng: Random, items: readonly T[], count: number): T[] {
  const pool = [...items];
  const out: T[] = [];
  while (out.length < count && pool.length > 0) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return out;
}

/** Elige segun pesos relativos: `[[valor, peso], ...]`. */
export function weighted<T>(rng: Random, options: readonly (readonly [T, number])[]): T {
  const total = options.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rng() * total;
  for (const [value, weight] of options) {
    roll -= weight;
    if (roll < 0) return value;
  }
  return options[options.length - 1][0];
}

// --- Taxonomia adicional --------------------------------------------------------------------------

/** Se suma a la taxonomia base; los terminos que ya existen se respetan. */
export const EXTRA_TAXONOMY: TaxonomySeed = {
  THEME: [
    'Salud sexual y reproductiva',
    'Enfermedades crónicas no transmisibles',
    'Salud oral',
    'Salud laboral',
    'Zoonosis y control vectorial',
    'Envejecimiento y vejez',
    'Primera infancia',
    'Gestión del riesgo de desastres',
  ],
  TERRITORY: [
    ['Caldas', ['Aguadas', 'Anserma', 'Aranzazu', 'Belalcázar', 'Filadelfia', 'Neira', 'Pácora', 'Salamina', 'Supía']],
    ['Risaralda', ['Pereira', 'Dosquebradas', 'Santa Rosa de Cabal', 'Marsella']],
    ['Quindío', ['Armenia', 'Calarcá', 'Montenegro']],
    ['Tolima', ['Ibagué', 'Honda', 'Mariquita']],
  ],
  POPULATION: [
    'Niñas y niños',
    'Adolescentes y jóvenes',
    'Mujeres gestantes',
    'Personas mayores',
    'Cuidadores familiares',
    'Docentes de básica y media',
    'Pueblos indígenas',
    'Población campesina',
    'Personal de enfermería',
  ],
  RESOURCE_TYPE: ['Protocolo', 'Cartilla', 'Boletín epidemiológico', 'Póster'],
  TAG: [
    'Prevención',
    'Género',
    'Territorio',
    'Participación',
    'Evaluación',
    'Buenas prácticas',
    'Innovación',
    'Primera línea',
    'Educación en salud',
    'Alianzas',
  ],
};

// --- Temas ----------------------------------------------------------------------------------------

/** Asunto de salud publica y el tema de la taxonomia con el que se clasifica. */
export const SUBJECTS: readonly (readonly [subject: string, theme: string])[] = [
  ['dengue', 'Vigilancia epidemiológica'],
  ['tuberculosis', 'Vigilancia epidemiológica'],
  ['infecciones respiratorias agudas', 'Vigilancia epidemiológica'],
  ['calidad del agua de consumo', 'Salud ambiental'],
  ['manejo de residuos', 'Salud ambiental'],
  ['calidad del aire', 'Salud ambiental'],
  ['salud mental en adolescentes', 'Salud mental comunitaria'],
  ['duelo y acompañamiento psicosocial', 'Salud mental comunitaria'],
  ['prevención del suicidio', 'Salud mental comunitaria'],
  ['huertas comunitarias', 'Seguridad alimentaria y nutricional'],
  ['lactancia materna', 'Seguridad alimentaria y nutricional'],
  ['alimentación escolar', 'Seguridad alimentaria y nutricional'],
  ['hipertensión y diabetes', 'Enfermedades crónicas no transmisibles'],
  ['riesgo cardiovascular', 'Enfermedades crónicas no transmisibles'],
  ['vacunación', 'Atención primaria en salud'],
  ['rutas de atención integral', 'Atención primaria en salud'],
  ['atención domiciliaria', 'Atención primaria en salud'],
  ['actividad física', 'Promoción de la salud'],
  ['entornos saludables', 'Promoción de la salud'],
  ['estilos de vida saludable', 'Promoción de la salud'],
  ['planificación familiar', 'Salud sexual y reproductiva'],
  ['control prenatal', 'Salud sexual y reproductiva'],
  ['salud bucal infantil', 'Salud oral'],
  ['riesgos laborales en el campo', 'Salud laboral'],
  ['control de vectores', 'Zoonosis y control vectorial'],
  ['tenencia responsable de mascotas', 'Zoonosis y control vectorial'],
  ['envejecimiento activo', 'Envejecimiento y vejez'],
  ['crianza y desarrollo en la primera infancia', 'Primera infancia'],
  ['preparación ante deslizamientos', 'Gestión del riesgo de desastres'],
  ['primeros auxilios comunitarios', 'Gestión del riesgo de desastres'],
];

export const MUNICIPALITIES = [
  'Manizales', 'Chinchiná', 'Villamaría', 'La Dorada', 'Riosucio', 'Aguadas', 'Anserma', 'Aranzazu', 'Belalcázar',
  'Filadelfia', 'Neira', 'Pácora', 'Salamina', 'Supía', 'Pereira', 'Dosquebradas', 'Santa Rosa de Cabal', 'Marsella',
  'Armenia', 'Calarcá', 'Montenegro', 'Ibagué', 'Honda', 'Mariquita',
] as const;

export const POPULATIONS = [
  'Líderes comunitarios', 'Personal de salud', 'Docentes', 'Estudiantes de pregrado', 'Gestores territoriales',
  'Niñas y niños', 'Adolescentes y jóvenes', 'Mujeres gestantes', 'Personas mayores', 'Cuidadores familiares',
  'Docentes de básica y media', 'Pueblos indígenas', 'Población campesina', 'Personal de enfermería',
] as const;

export const TAGS = [
  'Comunidad', 'Ruralidad', 'Datos abiertos', 'Prevención', 'Género', 'Territorio', 'Participación', 'Evaluación',
  'Buenas prácticas', 'Innovación', 'Primera línea', 'Educación en salud', 'Alianzas',
] as const;

export const LICENSES = ['CC BY 4.0', 'CC BY-NC 4.0', 'CC BY-NC-SA 4.0', 'CC BY-SA 4.0', 'CC0 1.0', 'Uso institucional'] as const;

export const AFFILIATIONS = [
  'Secretaría de Salud de Manizales', 'Universidad de Caldas', 'ESE Hospital San Félix', 'Dirección Territorial de Salud de Caldas',
  'Junta de Acción Comunal Villa Kempis', 'Red de Mujeres de Riosucio', 'Hospital Santa Sofía', 'Secretaría de Salud de Pereira',
  'Colegio Rural La Esperanza', 'Fundación Salud para Todos', 'Centro de Salud de Chinchiná', 'Universidad Nacional, sede Manizales',
] as const;

// --- Redaccion ------------------------------------------------------------------------------------

export const RETURN_COMMENTS = [
  'Falta precisar los objetivos y el alcance territorial.',
  'Anonimiza los datos antes de reenviar.',
  'Agrega la licencia y las fuentes consultadas.',
  'El resumen es muy extenso; redúcelo a un párrafo.',
  'Revisa la ortografía y los nombres de los municipios.',
  'Incluye las fechas de inicio y de cierre.',
  'Describe a quién está dirigido y cómo se participa.',
];

export const ARCHIVE_PUBLISHED_COMMENTS = [
  'Concluyó el periodo de vigencia.',
  'Reemplazado por una versión más reciente.',
  'Se retira a solicitud del equipo autor.',
  'La información quedó desactualizada.',
];

export const REJECT_COMMENTS = [
  'Fuera del alcance de la plataforma.',
  'Duplica un contenido ya publicado.',
  'No cumple los criterios de calidad editorial.',
];

const METHODS = [
  'talleres participativos con la comunidad',
  'visitas domiciliarias y jornadas en las veredas',
  'mesas de trabajo con las secretarías de salud',
  'formación de promotores y líderes locales',
  'campañas de comunicación y educación en salud',
  'el análisis de datos de vigilancia con enfoque territorial',
  'prácticas de estudiantes acompañadas por docentes',
  'alianzas con instituciones educativas y centros de salud',
];

const OUTCOMES = [
  'Se alcanzaron más de {n} personas en {k} sesiones y se publicó una guía de apoyo.',
  'Se formaron {n} personas y se consolidó una red local de {subject}.',
  'Se documentaron {k} lecciones aprendidas y se presentaron a las secretarías de salud.',
  'Se redujo el tiempo de respuesta en {subject} y se instaló una mesa permanente de seguimiento.',
];

const INITIATIVE_TITLES: Record<string, ((s: string, m: string, p: string) => string)[]> = {
  PROJECT: [(s, m) => `Proyecto de ${s} en ${m}`, (s, m) => `Estrategia comunitaria de ${s} en ${m}`],
  PROGRAM: [(s, _m, p) => `Programa de ${s} para ${p.toLowerCase()}`, (s) => `Programa territorial de ${s}`],
  RESEARCH: [(s, m) => `Investigación sobre ${s} en ${m}`, (s, m) => `Línea base de ${s} en ${m}`],
  EXTENSION: [(s, _m, p) => `Extensión en ${s} con ${p.toLowerCase()}`, (s, m) => `Jornadas de ${s} en ${m}`],
  TRAINING_PRACTICE: [(s, m) => `Prácticas formativas en ${s} (${m})`],
  COMMUNITY_EXPERIENCE: [(s, m) => `Experiencia comunitaria de ${s} en ${m}`, (s, m) => `Saberes locales sobre ${s} en ${m}`],
};

export function initiativeTitle(rng: Random, type: string, subject: string, municipality: string, population: string): string {
  return pick(rng, INITIATIVE_TITLES[type])(subject, municipality, population);
}

export function initiativeSummary(rng: Random, type: string, subject: string, municipality: string, population: string): string {
  const intro: Record<string, string> = {
    PROJECT: `Proyecto que busca fortalecer ${subject} en ${municipality}`,
    PROGRAM: `Programa permanente de ${subject} dirigido a ${population.toLowerCase()}`,
    RESEARCH: `Estudio sobre ${subject} en ${municipality} con enfoque territorial`,
    EXTENSION: `Iniciativa de extensión universitaria sobre ${subject} en ${municipality}`,
    TRAINING_PRACTICE: `Escenario de práctica formativa en ${subject}, con sede en ${municipality}`,
    COMMUNITY_EXPERIENCE: `Experiencia comunitaria de ${subject} recogida en ${municipality}`,
  };
  return `${intro[type]}, mediante ${pick(rng, METHODS)}. Participan ${population.toLowerCase()} y equipos de la institución. Todos los datos son agregados y sin información personal.`;
}

export function initiativeResults(rng: Random, subject: string): string {
  return pick(rng, OUTCOMES)
    .replace('{n}', String(int(rng, 25, 600)))
    .replace('{k}', String(int(rng, 3, 24)))
    .replace('{subject}', subject);
}

export function resourceDescription(rng: Random, format: string, subject: string, municipality: string): string {
  const base = `${format} sobre ${subject} elaborado para ${municipality} y su área de influencia.`;
  return `${base} ${pick(rng, [
    'Pensado para consulta rápida en terreno.',
    'Incluye recomendaciones prácticas y fuentes verificadas.',
    'Se actualiza cada vez que se carga una nueva versión.',
    'Documento sintético de demostración.',
  ])}`;
}

export function courseSummary(rng: Random, subject: string, population: string): string {
  return `Formación sobre ${subject} dirigida a ${population.toLowerCase()}. ${pick(rng, [
    'Combina lecturas breves, casos reales y una evaluación final.',
    'Incluye actividades prácticas y acompañamiento de docentes.',
    'Se cursa a tu ritmo, con certificado de participación.',
    'Parte de los saberes de la comunidad y los lleva a la práctica.',
  ])}`;
}

// --- Cursos de Moodle -----------------------------------------------------------------------------

/**
 * Cursos que cargo `cargar-datos-demo.php` en el Moodle de desarrollo y que la semilla base aun no
 * enlazo. El idnumber sigue la convencion `cvsp-<nombre corto>`.
 */
export const MOODLE_COURSES: readonly { idnumber: string; title: string; summary: string; theme: string }[] = [
  { idnumber: 'cvsp-enf-cuidados-basicos', title: 'Cuidados básicos de enfermería', summary: 'Fundamentos de enfermería: signos vitales e higiene y confort del paciente.', theme: 'Atención primaria en salud' },
  { idnumber: 'cvsp-enf-farmacologia', title: 'Farmacología aplicada', summary: 'Administración segura de medicamentos y cálculo de dosis.', theme: 'Atención primaria en salud' },
  { idnumber: 'cvsp-enf-bioseguridad', title: 'Bioseguridad hospitalaria', summary: 'Normas de bioseguridad, manejo de residuos y control de infecciones.', theme: 'Salud ambiental' },
  { idnumber: 'cvsp-urg-svb', title: 'Soporte vital básico (SVB)', summary: 'Reanimación cardiopulmonar y manejo de la vía aérea.', theme: 'Gestión del riesgo de desastres' },
  { idnumber: 'cvsp-urg-triaje', title: 'Triaje y clasificación de pacientes', summary: 'Metodología de triaje en urgencias.', theme: 'Atención primaria en salud' },
  { idnumber: 'cvsp-urg-desastres', title: 'Manejo de desastres y emergencias masivas', summary: 'Planes de contingencia y atención en emergencias masivas.', theme: 'Gestión del riesgo de desastres' },
  { idnumber: 'cvsp-adm-historias', title: 'Gestión de historias clínicas', summary: 'Manejo documental y digital de historias clínicas.', theme: 'Atención primaria en salud' },
  { idnumber: 'cvsp-adm-atencion-usuario', title: 'Atención al usuario en salud', summary: 'Habilidades de comunicación y servicio al paciente.', theme: 'Promoción de la salud' },
  { idnumber: 'cvsp-adm-normatividad', title: 'Normatividad en salud pública', summary: 'Marco legal y normativo del sistema de salud.', theme: 'Vigilancia epidemiológica' },
];

// --- Archivos de ejemplo --------------------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const PALETTES = [
  [[0, 105, 92], [38, 166, 154], [224, 242, 241]],
  [[21, 101, 192], [66, 165, 245], [227, 242, 253]],
  [[230, 126, 34], [255, 183, 77], [255, 243, 224]],
  [[106, 27, 154], [171, 71, 188], [243, 229, 245]],
];

/** PNG valido de 480x320 con bandas de color y bloques: una "infografia" sintetica. */
export function bandsPng(rng: Random): Buffer {
  const width = 480;
  const height = 320;
  const palette = pick(rng, PALETTES);
  const blocks = Array.from({ length: 6 }, () => ({
    x: int(rng, 20, 360), y: int(rng, 70, 250), w: int(rng, 40, 100), h: int(rng, 24, 60), color: int(rng, 0, 2),
  }));
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0; // sin filtro
    for (let x = 0; x < width; x++) {
      let color = y < 56 ? palette[0] : palette[2];
      for (const b of blocks) if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) color = palette[b.color];
      raw.set(color, row + 1 + x * 3);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // profundidad
  header[9] = 2; // RGB
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

export interface SampleFile {
  name: string;
  bytes: Buffer;
}

const slug = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

/** Todo el texto va en latin1: sin comillas tipograficas ni simbolos fuera de ese juego. */
export function sampleFile(rng: Random, format: string, title: string, version: number, municipality: string): SampleFile {
  const base = slug(title);
  if (format === 'Conjunto de datos') {
    const rows = int(rng, 15, 60);
    return {
      name: `${base}-v${version}.csv`,
      bytes: csv([
        ['municipio', 'anio', 'indicador', 'valor'],
        ...Array.from({ length: rows }, (_, i) => [
          pick(rng, MUNICIPALITIES),
          String(2020 + (i % 6)),
          pick(rng, ['cobertura', 'tasa_x_1000', 'casos', 'porcentaje']),
          (rng() * 100).toFixed(1),
        ]),
      ]),
    };
  }
  if (format === 'Infografía' || format === 'Póster') return { name: `${base}-v${version}.png`, bytes: bandsPng(rng) };
  if (format === 'Boletín epidemiológico' && chance(rng, 0.4)) {
    return {
      name: `${base}-v${version}.txt`,
      bytes: Buffer.from(
        [title, `Version ${version}`, `Municipio: ${municipality}`, 'Resumen semanal de eventos notificados.', 'Documento sintetico de demostracion.'].join('\n'),
        'utf8',
      ),
    };
  }
  return {
    name: `${base}-v${version}.pdf`,
    bytes: simplePdf(title, [
      `Version ${version} - ${format}`,
      `Territorio: ${municipality}`,
      '',
      '1. Contexto: por que importa este tema para la comunidad.',
      '2. Recomendaciones: acciones concretas para el equipo y las familias.',
      '3. Seguimiento: indicadores agregados, sin datos personales.',
      '',
      'Documento sintetico de demostracion - Centro Virtual de Salud Publica.',
    ]),
  };
}
