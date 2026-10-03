import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { MoodleWsGateway } from './moodle-ws.gateway';

/**
 * Prueba de contrato del adaptador real. Un servidor HTTP local hace de Moodle y responde lo que
 * cada escenario necesita: los cinco del Plan de pruebas (5.3) mas token invalido y demora.
 * La prueba contra el Moodle de verdad esta en test/live/moodle.live-spec.ts.
 */

const TOKEN = 'token-secreto-de-prueba-0123456789';

type Handler = (request: IncomingMessage, response: ServerResponse, body: string) => void;

describe('MoodleWsGateway (contrato del servicio web de Moodle)', () => {
  let server: Server;
  let baseUrl: string;
  let handler: Handler;
  let received: { method: string; url: string; body: URLSearchParams }[];

  beforeAll(async () => {
    server = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => (body += chunk));
      request.on('end', () => {
        received.push({ method: request.method, url: request.url, body: new URLSearchParams(body) });
        handler(request, response, body);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise((resolve) => server.close(resolve)));

  beforeEach(() => {
    received = [];
  });

  const json = (payload: unknown, status = 200): Handler => (_request, response) => {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(payload));
  };
  const gateway = (timeoutMs = 2000) => new MoodleWsGateway(baseUrl, TOKEN, timeoutMs);

  it('llama a core_course_get_courses_by_field por idnumber, con el token en el cuerpo y no en la URL', async () => {
    handler = json({ courses: [], warnings: [] });

    await gateway().findCoursesByIdnumber('cvsp-salud-basica');

    expect(received).toHaveLength(1);
    const [call] = received;
    expect(call.method).toBe('POST');
    expect(call.url).toBe('/webservice/rest/server.php');
    expect(call.url).not.toContain(TOKEN);
    expect(Object.fromEntries(call.body)).toEqual({
      wstoken: TOKEN,
      wsfunction: 'core_course_get_courses_by_field',
      moodlewsrestformat: 'json',
      field: 'idnumber',
      value: 'cvsp-salud-basica',
    });
  });

  it('curso encontrado: devuelve su id, nombre corto y nombre completo', async () => {
    handler = json({
      courses: [{ id: 7, shortname: 'salud-basica', fullname: 'Curso Básico de Salud', categoryid: 1, visible: 1 }],
      warnings: [],
    });

    expect(await gateway().findCoursesByIdnumber('cvsp-salud-basica')).toEqual({
      ok: true,
      courses: [{ id: 7, shortname: 'salud-basica', fullname: 'Curso Básico de Salud' }],
    });
  });

  it('identificador inexistente: respuesta válida con cero cursos', async () => {
    handler = json({ courses: [], warnings: [] });
    expect(await gateway().findCoursesByIdnumber('cvsp-no-existe')).toEqual({ ok: true, courses: [] });
  });

  it('identificador duplicado: devuelve todos los cursos para que el dominio lo rechace', async () => {
    handler = json({
      courses: [
        { id: 7, shortname: 'a', fullname: 'A' },
        { id: 8, shortname: 'b', fullname: 'B' },
      ],
    });
    const lookup = await gateway().findCoursesByIdnumber('repetido');
    expect(lookup.ok && lookup.courses.map((c) => c.id)).toEqual([7, 8]);
  });

  it('LMS inalcanzable: nadie escucha en la dirección', async () => {
    const closed = new MoodleWsGateway('http://127.0.0.1:9', TOKEN, 2000);
    expect(await closed.findCoursesByIdnumber('cvsp-x')).toMatchObject({ ok: false, errorCode: 'lms_inalcanzable' });
  });

  it('LMS que no responde a tiempo: inalcanzable, marcado como demora', async () => {
    handler = () => undefined; // nunca responde
    const lookup = await gateway(150).findCoursesByIdnumber('cvsp-x');
    expect(lookup).toMatchObject({ ok: false, errorCode: 'lms_inalcanzable', timedOut: true });
  });

  it('error HTTP del LMS: inalcanzable, con el código de estado', async () => {
    handler = json({ error: 'mantenimiento' }, 503);
    expect(await gateway().findCoursesByIdnumber('cvsp-x')).toMatchObject({
      ok: false,
      errorCode: 'lms_inalcanzable',
      httpStatus: 503,
    });
  });

  it('token inválido: Moodle responde 200 con una excepción en el cuerpo', async () => {
    handler = json({
      exception: 'moodle_exception',
      errorcode: 'invalidtoken',
      message: 'Invalid token - token not found',
    });
    expect(await gateway().findCoursesByIdnumber('cvsp-x')).toMatchObject({ ok: false, errorCode: 'token_invalido' });
  });

  describe('respuesta con estructura inesperada', () => {
    it.each([
      ['no es JSON', (_q, response) => response.end('<html>Error</html>')],
      ['no trae la lista de cursos', json({ warnings: [] })],
      ['la lista de cursos no es una lista', json({ courses: 'ninguno' })],
      ['un curso no trae id', json({ courses: [{ shortname: 'a' }] })],
      ['el id no es numérico', json({ courses: [{ id: '7', shortname: 'a' }] })],
      ['un curso no trae nombre corto', json({ courses: [{ id: 7 }] })],
      ['el cuerpo es null', json(null)],
      ['una excepción desconocida de Moodle', json({ exception: 'dml_exception', errorcode: 'dmlreadexception' })],
    ] as [string, Handler][])('%s', async (_name, scenario) => {
      handler = scenario;
      expect(await gateway().findCoursesByIdnumber('cvsp-x')).toMatchObject({
        ok: false,
        errorCode: 'respuesta_invalida',
      });
    });
  });

  it('sin token configurado no llama al LMS', async () => {
    handler = json({ courses: [] });
    const lookup = await new MoodleWsGateway(baseUrl, '', 2000).findCoursesByIdnumber('cvsp-x');
    expect(lookup).toMatchObject({ ok: false, errorCode: 'token_invalido' });
    expect(received).toHaveLength(0);
  });

  it('ningún mensaje de error contiene el token (los mensajes terminan en el registro de integraciones)', async () => {
    const scenarios: Handler[] = [
      json({ exception: 'moodle_exception', errorcode: 'invalidtoken', message: `Invalid token ${TOKEN}` }),
      json({ exception: 'x', errorcode: TOKEN }),
      json({ error: TOKEN }, 500),
      (_q, response) => response.end(TOKEN),
    ];
    for (const scenario of scenarios) {
      handler = scenario;
      const lookup = await gateway().findCoursesByIdnumber('cvsp-x');
      expect(lookup.ok).toBe(false);
      expect(JSON.stringify(lookup)).not.toContain(TOKEN);
    }
  });
});
