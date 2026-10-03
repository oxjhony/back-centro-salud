import { DomainError } from '../../../shared/errors';

/**
 * Formatos admitidos para los recursos (RF-05). Se comprueban la extension y la firma del
 * contenido: un ejecutable renombrado a .pdf no pasa. El tipo MIME guardado sale de esta tabla,
 * nunca de lo que declare el navegador.
 */
type Signature = 'pdf' | 'zip' | 'ole' | 'png' | 'jpeg' | 'text';

const FORMATS: Record<string, { mimeType: string; signature: Signature }> = {
  pdf: { mimeType: 'application/pdf', signature: 'pdf' },
  docx: { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', signature: 'zip' },
  xlsx: { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', signature: 'zip' },
  pptx: { mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', signature: 'zip' },
  odt: { mimeType: 'application/vnd.oasis.opendocument.text', signature: 'zip' },
  ods: { mimeType: 'application/vnd.oasis.opendocument.spreadsheet', signature: 'zip' },
  odp: { mimeType: 'application/vnd.oasis.opendocument.presentation', signature: 'zip' },
  doc: { mimeType: 'application/msword', signature: 'ole' },
  xls: { mimeType: 'application/vnd.ms-excel', signature: 'ole' },
  ppt: { mimeType: 'application/vnd.ms-powerpoint', signature: 'ole' },
  png: { mimeType: 'image/png', signature: 'png' },
  jpg: { mimeType: 'image/jpeg', signature: 'jpeg' },
  jpeg: { mimeType: 'image/jpeg', signature: 'jpeg' },
  csv: { mimeType: 'text/csv', signature: 'text' },
  txt: { mimeType: 'text/plain', signature: 'text' },
};

export const ALLOWED_EXTENSIONS = Object.keys(FORMATS);

const MAGIC: Record<Exclude<Signature, 'text'>, number[]> = {
  pdf: [0x25, 0x50, 0x44, 0x46, 0x2d], // %PDF-
  zip: [0x50, 0x4b, 0x03, 0x04], // PK: formatos de Office y OpenDocument
  ole: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], // Office 97-2003
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  jpeg: [0xff, 0xd8, 0xff],
};

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(dot + 1).toLowerCase() : '';
}

function matches(signature: Signature, bytes: Buffer): boolean {
  if (signature === 'text') {
    // Texto: sin bytes nulos en el comienzo del archivo.
    return !bytes.subarray(0, 8192).includes(0);
  }
  const magic = MAGIC[signature];
  return bytes.length >= magic.length && magic.every((byte, i) => bytes[i] === byte);
}

export function detectFormat(filename: string, bytes: Buffer): { extension: string; mimeType: string } {
  const extension = extensionOf(filename);
  const format = FORMATS[extension];
  if (!format) {
    throw DomainError.invalid('formato_no_permitido', `Formato no permitido. Se aceptan: ${ALLOWED_EXTENSIONS.join(', ')}.`);
  }
  if (bytes.length === 0) {
    throw DomainError.invalid('archivo_vacio', 'El archivo está vacío.');
  }
  if (!matches(format.signature, bytes)) {
    throw DomainError.invalid('formato_no_coincide', 'El contenido del archivo no corresponde a su extensión.');
  }
  return { extension, mimeType: format.mimeType };
}

/**
 * Los navegadores envian el nombre en UTF-8, pero el lector multipart lo decodifica como latin1:
 * se recupera el texto original cuando la conversion es reversible.
 */
export function decodeUploadName(name: string): string {
  if (![...name].every((char) => char.charCodeAt(0) <= 0xff)) return name;
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes('�') ? name : decoded;
}

/** Nombre seguro para guardar y para Content-Disposition: sin rutas ni caracteres de control. */
export function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f"<>:|?*]/g, '')
    .trim();
  return (cleaned.length > 200 ? cleaned.slice(cleaned.length - 200) : cleaned) || 'archivo';
}
