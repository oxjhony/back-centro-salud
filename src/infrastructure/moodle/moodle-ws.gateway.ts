import { MoodleGateway } from '../../modules/courses/application/ports';
import { MoodleCourse, MoodleErrorCode, MoodleLookup } from '../../modules/courses/domain/lms-link';

const LOOKUP_FUNCTION = 'core_course_get_courses_by_field';

/** Errores de Moodle que significan que el token no sirve o no esta autorizado. */
const TOKEN_ERRORS = ['invalidtoken', 'accessexception', 'webservicenotavailable', 'servicenotavailable'];

/**
 * Adaptador real: servicios web REST de Moodle, solo lectura.
 *
 * Nunca lanza y nunca incluye el token en un mensaje: los mensajes de error se arman con textos
 * fijos mas el codigo que devuelve Moodle, porque terminan en el registro de integraciones.
 */
export class MoodleWsGateway implements MoodleGateway {
  readonly lookupOperation = LOOKUP_FUNCTION;

  constructor(
    readonly baseUrl: string,
    private readonly token: string,
    private readonly timeoutMs: number,
  ) {}

  async findCoursesByIdnumber(idnumber: string): Promise<MoodleLookup> {
    if (!this.token) {
      return failure('token_invalido', 'No hay token de servicio web configurado (MOODLE_WS_TOKEN).');
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/webservice/rest/server.php`, {
        method: 'POST',
        // El token viaja en el cuerpo y no en la URL, para que no quede en registros de acceso.
        body: new URLSearchParams({
          wstoken: this.token,
          wsfunction: LOOKUP_FUNCTION,
          moodlewsrestformat: 'json',
          field: 'idnumber',
          value: idnumber,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const timedOut = (error as Error)?.name === 'TimeoutError';
      return {
        ...failure(
          'lms_inalcanzable',
          timedOut ? `Moodle no respondió en ${this.timeoutMs} ms.` : 'No fue posible conectar con Moodle.',
        ),
        timedOut,
      };
    }

    if (!response.ok) {
      return { ...failure('lms_inalcanzable', `Moodle respondió HTTP ${response.status}.`), httpStatus: response.status };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return failure('respuesta_invalida', 'La respuesta de Moodle no es JSON.');
    }
    return parseLookup(body);
  }
}

function failure(errorCode: MoodleErrorCode, message: string): Extract<MoodleLookup, { ok: false }> {
  return { ok: false, errorCode, message };
}

/** Valida la forma de la respuesta: una actualizacion de Moodle no debe colarse como dato valido. */
export function parseLookup(body: unknown): MoodleLookup {
  if (!body || typeof body !== 'object') {
    return failure('respuesta_invalida', 'La respuesta de Moodle no tiene la estructura esperada.');
  }

  const payload = body as { exception?: unknown; errorcode?: unknown; courses?: unknown };
  if (payload.exception) {
    const moodleCode = typeof payload.errorcode === 'string' ? payload.errorcode.replace(/[^a-z0-9_]/gi, '') : 'desconocido';
    return TOKEN_ERRORS.includes(moodleCode)
      ? failure('token_invalido', `Moodle rechazó el token del servicio web (${moodleCode}).`)
      : failure('respuesta_invalida', `Moodle devolvió un error (${moodleCode}).`);
  }

  if (!Array.isArray(payload.courses)) {
    return failure('respuesta_invalida', 'La respuesta de Moodle no trae la lista de cursos.');
  }

  const courses: MoodleCourse[] = [];
  for (const course of payload.courses as Record<string, unknown>[]) {
    if (!Number.isInteger(course?.id) || typeof course.shortname !== 'string') {
      return failure('respuesta_invalida', 'Un curso de la respuesta de Moodle no trae id o nombre corto.');
    }
    courses.push({
      id: course.id as number,
      shortname: course.shortname,
      fullname: typeof course.fullname === 'string' ? course.fullname : course.shortname,
    });
  }
  return { ok: true, courses };
}
