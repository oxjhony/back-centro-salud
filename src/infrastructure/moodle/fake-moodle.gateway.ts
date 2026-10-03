import { MoodleGateway } from '../../modules/courses/application/ports';
import { MoodleCourse, MoodleErrorCode, MoodleLookup } from '../../modules/courses/domain/lms-link';

/**
 * Doble de prueba del LMS. Permite desarrollar y probar sin Moodle, y simular lo que con el real
 * es dificil de provocar: caidas, respuestas invalidas e idnumber duplicados.
 */
export class FakeMoodleGateway implements MoodleGateway {
  readonly baseUrl = 'http://moodle.prueba';
  readonly lookupOperation = 'core_course_get_courses_by_field';

  /** Cursos por idnumber. Varios cursos bajo el mismo idnumber simulan un duplicado. */
  private courses = new Map<string, MoodleCourse[]>();
  private failing: { errorCode: MoodleErrorCode; timedOut?: boolean } | null = null;
  calls = 0;

  addCourse(idnumber: string, course: MoodleCourse): this {
    this.courses.set(idnumber, [...(this.courses.get(idnumber) ?? []), course]);
    return this;
  }

  removeCourse(idnumber: string): this {
    this.courses.delete(idnumber);
    return this;
  }

  /** A partir de ahora toda consulta falla como si el LMS estuviera caido o respondiera mal. */
  failWith(errorCode: MoodleErrorCode, timedOut = false): this {
    this.failing = { errorCode, timedOut };
    return this;
  }

  reset(): this {
    this.courses.clear();
    this.failing = null;
    this.calls = 0;
    return this;
  }

  async findCoursesByIdnumber(idnumber: string): Promise<MoodleLookup> {
    this.calls++;
    if (this.failing) {
      return { ok: false, errorCode: this.failing.errorCode, message: 'Fallo simulado del LMS.', timedOut: this.failing.timedOut };
    }
    return { ok: true, courses: this.courses.get(idnumber) ?? [] };
  }
}
