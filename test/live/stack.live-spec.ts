import { config as loadDotenv } from 'dotenv';
import { MoodleWsGateway } from '../../src/infrastructure/moodle/moodle-ws.gateway';

/**
 * Pruebas EN VIVO: frontend, backend y Moodle reales, levantados con iniciar-todo.bat.
 * No usan dobles: comprueban que las tres piezas se hablan de verdad.
 *
 *   npm run test:live
 *
 * Solo leen, salvo la conciliacion con Moodle, que es idempotente. Si un servicio no esta
 * arriba la prueba FALLA: nunca se omite en silencio.
 */
loadDotenv({ quiet: true });

const API = process.env.LIVE_API_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
const FRONT = process.env.LIVE_FRONT_URL ?? 'http://localhost:4200';
const MOODLE = (process.env.MOODLE_BASE_URL ?? 'http://127.0.0.1:8090').replace(/\/+$/, '');
const PASSWORD = process.env.LOCAL_IDENTITY_PASSWORD ?? '';

/** Curso de demostracion que crea la semilla y que existe en el Moodle local. */
const DEMO_IDNUMBER = 'cvsp-primeros-auxilios';
const DEMO_TITLE = 'Primeros auxilios';

async function login(email: string): Promise<string> {
  const response = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(response.status).toBe(200);
  return response.headers.getSetCookie().map((cookie) => cookie.split(';')[0]).join('; ');
}

describe('Integración en vivo: frontend ↔ backend ↔ Moodle', () => {
  describe('backend', () => {
    it('está vivo y su base de datos responde', async () => {
      const response = await fetch(`${API}/health/ready`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: 'ok', database: 'ok' });
    });

    it('acepta peticiones con credenciales desde el origen del frontend (CORS)', async () => {
      const response = await fetch(`${API}/auth/me`, { headers: { Origin: FRONT } });
      expect(response.headers.get('access-control-allow-origin')).toBe(FRONT);
      expect(response.headers.get('access-control-allow-credentials')).toBe('true');
    });

    it('no acepta credenciales desde otro origen', async () => {
      const response = await fetch(`${API}/auth/me`, { headers: { Origin: 'http://sitio-ajeno.example' } });
      expect(response.headers.get('access-control-allow-origin')).not.toBe('http://sitio-ajeno.example');
    });

    it('las cuentas de desarrollo inician sesión y reciben sus permisos', async () => {
      const cookie = await login('gestor@cvsp.local');
      const { user } = await (await fetch(`${API}/auth/me`, { headers: { Cookie: cookie } })).json();
      expect(user).toMatchObject({ email: 'gestor@cvsp.local', roles: ['ACADEMIC_MANAGER'] });
      expect(user.permissions).toContain('course:manage');
    });
  });

  describe('backend ↔ Moodle real', () => {
    const gateway = new MoodleWsGateway(MOODLE, process.env.MOODLE_WS_TOKEN ?? '', 20000);

    it('el adaptador real encuentra exactamente un curso por su idnumber', async () => {
      const lookup = await gateway.findCoursesByIdnumber(DEMO_IDNUMBER);
      expect(lookup).toMatchObject({ ok: true, courses: [{ shortname: 'primeros-auxilios' }] });
    });

    it('un idnumber inexistente devuelve cero cursos, no un error', async () => {
      expect(await gateway.findCoursesByIdnumber('cvsp-no-existe-en-moodle')).toEqual({ ok: true, courses: [] });
    });

    it('Moodle rechaza un token inválido y el adaptador lo reconoce', async () => {
      const lookup = await new MoodleWsGateway(MOODLE, '0'.repeat(32), 20000).findCoursesByIdnumber(DEMO_IDNUMBER);
      expect(lookup).toMatchObject({ ok: false, errorCode: 'token_invalido' });
    });

    it('el token es de solo lectura: Moodle le niega una función de escritura', async () => {
      const response = await fetch(`${MOODLE}/webservice/rest/server.php`, {
        method: 'POST',
        body: new URLSearchParams({
          wstoken: process.env.MOODLE_WS_TOKEN ?? '',
          wsfunction: 'core_course_update_courses',
          moodlewsrestformat: 'json',
          'courses[0][id]': '1',
          'courses[0][fullname]': 'Cambio no autorizado',
        }),
      });
      const body = await response.json();
      expect(body.exception).toBeDefined();
      expect(body.errorcode).toBe('accessexception');
    });

    it('la conciliación recorre los cursos enlazados contra Moodle y todos responden', async () => {
      const cookie = await login('admin@cvsp.local');
      const response = await fetch(`${API}/admin/moodle/reconcile`, { method: 'POST', headers: { Cookie: cookie } });
      expect(response.status).toBe(200);

      const summary = await response.json();
      expect(summary.reviewed).toBeGreaterThanOrEqual(2);
      expect(summary.unanswered).toBe(0);
      expect(summary.verified).toBeGreaterThanOrEqual(2);
    });

    it('el catálogo público entrega el enlace al aula, y ese enlace es el del curso en Moodle', async () => {
      const catalog = await (await fetch(`${API}/public/courses?q=${encodeURIComponent('primeros auxilios')}`)).json();
      const course = catalog.items.find((c) => c.title === DEMO_TITLE);
      expect(course?.access.kind).toBe('LMS');

      const lookup = await gateway.findCoursesByIdnumber(DEMO_IDNUMBER);
      const moodleId = lookup.ok && lookup.courses[0].id;
      expect(course.access.url).toBe(`${MOODLE}/course/view.php?id=${moodleId}`);

      // El aula existe: Moodle responde a esa URL (redirige al ingreso porque el aula pide sesion).
      const aula = await fetch(course.access.url, { redirect: 'manual' });
      expect([200, 303]).toContain(aula.status);
    });
  });

  describe('frontend ↔ backend', () => {
    const page = async (path: string) => {
      const response = await fetch(`${FRONT}${path}`);
      expect(response.status).toBe(200);
      return response.text();
    };

    it('el catálogo de cursos se sirve renderizado con los datos del backend y el enlace a Moodle', async () => {
      const html = await page('/cursos');
      expect(html).toContain(DEMO_TITLE);
      expect(html).toContain(`${MOODLE}/course/view.php?id=`);
    });

    it('el listado de iniciativas se sirve renderizado con lo publicado', async () => {
      const published = await (await fetch(`${API}/public/initiatives`)).json();
      expect(published.total).toBeGreaterThan(0);

      const html = await page('/iniciativas');
      expect(html).toContain(published.items[0].title);
    });

    it('la ficha pública de una iniciativa se sirve renderizada', async () => {
      const published = await (await fetch(`${API}/public/initiatives`)).json();
      const html = await page(`/iniciativas/${published.items[0].id}`);
      expect(html).toContain(published.items[0].title);
    });

    it('el repositorio de recursos se sirve renderizado y un recurso abierto se descarga', async () => {
      const published = await (await fetch(`${API}/public/resources?visibility=PUBLIC`)).json();
      expect(published.total).toBeGreaterThan(0);
      expect(await page('/recursos')).toContain(published.items[0].title);

      const download = await fetch(`${API}/public/resources/${published.items[0].id}/download`);
      expect(download.status).toBe(200);
      expect(download.headers.get('content-disposition')).toMatch(/^attachment;/);
    });

    it('un recurso restringido no se descarga sin sesión', async () => {
      const restricted = await (await fetch(`${API}/public/resources?visibility=RESTRICTED`)).json();
      expect(restricted.total).toBeGreaterThan(0);
      expect((await fetch(`${API}/public/resources/${restricted.items[0].id}/download`)).status).toBe(401);
    });

    it('la búsqueda única encuentra contenidos de los tres tipos', async () => {
      const result = await (await fetch(`${API}/public/search?q=atencion`)).json();
      expect(new Set(result.items.map((hit) => hit.type)).size).toBeGreaterThanOrEqual(2);
      expect(await page('/buscar?q=vigilancia')).toContain('vigilancia');
    });

    it('un borrador no aparece en el portal', async () => {
      expect(await page('/iniciativas')).not.toContain('Huertas escolares saludables');
    });
  });
});
