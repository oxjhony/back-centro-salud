import { decodeUploadName, detectFormat, safeFilename } from './file-format';

const bytes = (...values: (number | string)[]) =>
  Buffer.concat(values.map((v) => (typeof v === 'string' ? Buffer.from(v) : Buffer.from([v]))));

/** RF-05: el sistema valida formato y tamaño antes de registrar una versión. */
describe('formato de los archivos de un recurso', () => {
  it('acepta un PDF real y le asigna el tipo MIME de la tabla, no el que declare el navegador', () => {
    expect(detectFormat('guia.PDF', bytes('%PDF-1.4\n...'))).toEqual({ extension: 'pdf', mimeType: 'application/pdf' });
  });

  it('acepta documentos de Office y OpenDocument (contenedores ZIP)', () => {
    for (const name of ['informe.docx', 'datos.xlsx', 'charla.pptx', 'acta.odt']) {
      expect(() => detectFormat(name, bytes(0x50, 0x4b, 0x03, 0x04, 'resto'))).not.toThrow();
    }
  });

  it('acepta imágenes PNG y JPEG, y texto plano o CSV', () => {
    expect(detectFormat('mapa.png', bytes(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a)).mimeType).toBe('image/png');
    expect(detectFormat('foto.jpg', bytes(0xff, 0xd8, 0xff, 0xe0)).mimeType).toBe('image/jpeg');
    expect(detectFormat('datos.csv', bytes('municipio;casos\nManizales;3')).mimeType).toBe('text/csv');
  });

  it.each(['programa.exe', 'script.js', 'pagina.html', 'sin-extension', 'archivo.'])('rechaza %s', (name) => {
    expect(() => detectFormat(name, bytes('contenido'))).toThrow(expect.objectContaining({ code: 'formato_no_permitido' }));
  });

  it('rechaza un ejecutable renombrado como PDF', () => {
    expect(() => detectFormat('guia.pdf', bytes('MZ', 0x90, 0x00))).toThrow(expect.objectContaining({ code: 'formato_no_coincide' }));
  });

  it('rechaza un binario disfrazado de texto', () => {
    expect(() => detectFormat('datos.csv', bytes('a;b', 0x00, 'c'))).toThrow(expect.objectContaining({ code: 'formato_no_coincide' }));
  });

  it('rechaza un archivo vacío', () => {
    expect(() => detectFormat('vacio.txt', Buffer.alloc(0))).toThrow(expect.objectContaining({ code: 'archivo_vacio' }));
  });
});

describe('nombre del archivo', () => {
  it('quita rutas y caracteres que romperían la cabecera de descarga', () => {
    expect(safeFilename('C:\\Users\\x\\..\\guía "final".pdf')).toBe('guía final.pdf');
    expect(safeFilename('../../etc/passwd')).toBe('passwd');
    expect(safeFilename('   ')).toBe('archivo');
  });

  it('recupera los nombres con tildes que el lector multipart decodifica como latin1', () => {
    const latin1 = Buffer.from('Guía de vacunación.pdf', 'utf8').toString('latin1');
    expect(decodeUploadName(latin1)).toBe('Guía de vacunación.pdf');
    expect(decodeUploadName('plano.pdf')).toBe('plano.pdf');
  });
});
