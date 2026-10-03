import {
  assertIdnumberFormat,
  isPublishable,
  LmsLink,
  MoodleLookup,
  normalizeIdnumber,
  NOT_LINKED,
  publicAccess,
  resolveLink,
} from './lms-link';

const BASE_URL = 'http://moodle.prueba';
const NOW = new Date('2026-10-02T15:00:00Z');
const IDNUMBER = 'cvsp-atencion-primaria-2026';

const found = (id = 42): MoodleLookup => ({
  ok: true,
  courses: [{ id, shortname: 'aps-2026', fullname: 'Atención primaria' }],
});
const none: MoodleLookup = { ok: true, courses: [] };
const duplicated: MoodleLookup = {
  ok: true,
  courses: [
    { id: 42, shortname: 'aps-a', fullname: 'A' },
    { id: 43, shortname: 'aps-b', fullname: 'B' },
  ],
};
const down: MoodleLookup = { ok: false, errorCode: 'lms_inalcanzable', message: 'sin respuesta' };

const VERIFIED: LmsLink = {
  externalId: IDNUMBER,
  url: `${BASE_URL}/course/view.php?id=42`,
  status: 'VERIFIED',
  verifiedAt: new Date('2026-09-01T00:00:00Z'),
  error: null,
};

function resolve(lookup: MoodleLookup, previous: LmsLink = NOT_LINKED, mode: 'guardar' | 'conciliar' = 'guardar') {
  return resolveLink({ idnumber: IDNUMBER, lookup, previous, moodleBaseUrl: BASE_URL, now: NOW, mode });
}

describe('enlace de una ficha de curso con Moodle', () => {
  describe('al guardar la ficha', () => {
    it('exactamente un curso: enlace verificado, con la URL construida a partir del id', () => {
      expect(resolve(found())).toEqual({
        externalId: IDNUMBER,
        url: 'http://moodle.prueba/course/view.php?id=42',
        status: 'VERIFIED',
        verifiedAt: NOW,
        error: null,
      });
    });

    it('idnumber inexistente: la ficha queda con el enlace en error, no verificado', () => {
      const link = resolve(none);
      expect(link).toMatchObject({ status: 'ERROR', error: 'curso_no_encontrado', url: null, verifiedAt: null });
    });

    it('idnumber duplicado en Moodle: error; no se elige un curso al azar', () => {
      expect(resolve(duplicated)).toMatchObject({ status: 'ERROR', error: 'idnumber_duplicado', url: null });
    });

    it('LMS inalcanzable y enlace nunca verificado: queda pendiente', () => {
      expect(resolve(down)).toMatchObject({ status: 'PENDING', error: 'lms_inalcanzable', externalId: IDNUMBER });
    });

    it('cambiar el idnumber descarta la URL del curso anterior', () => {
      const link = resolveLink({
        idnumber: 'cvsp-otro-curso',
        lookup: none,
        previous: VERIFIED,
        moodleBaseUrl: BASE_URL,
        now: NOW,
        mode: 'guardar',
      });
      expect(link).toMatchObject({ externalId: 'cvsp-otro-curso', url: null, status: 'ERROR' });
    });
  });

  describe('modo degradado', () => {
    it.each(['lms_inalcanzable', 'token_invalido', 'respuesta_invalida'] as const)(
      'un enlace ya verificado se conserva si el LMS falla con %s',
      (errorCode) => {
        expect(resolve({ ok: false, errorCode, message: 'x' }, VERIFIED, 'conciliar')).toEqual(VERIFIED);
      },
    );
  });

  describe('en la conciliación', () => {
    it('el aula de un enlace verificado desapareció: huérfano', () => {
      expect(resolve(none, VERIFIED, 'conciliar')).toMatchObject({ status: 'ORPHAN', error: 'curso_no_encontrado' });
    });

    it('un huérfano sigue siendo huérfano mientras el aula no vuelva', () => {
      const orphan: LmsLink = { ...VERIFIED, status: 'ORPHAN', verifiedAt: null, error: 'curso_no_encontrado' };
      expect(resolve(none, orphan, 'conciliar').status).toBe('ORPHAN');
    });

    it('un enlace que nunca se verificó no se vuelve huérfano: sigue en error', () => {
      const failed: LmsLink = { ...NOT_LINKED, externalId: IDNUMBER, status: 'ERROR', error: 'curso_no_encontrado' };
      expect(resolve(none, failed, 'conciliar').status).toBe('ERROR');
    });

    it('el id interno cambió tras restaurar Moodle: se actualiza la URL', () => {
      const link = resolve(found(907), VERIFIED, 'conciliar');
      expect(link).toMatchObject({ url: 'http://moodle.prueba/course/view.php?id=907', status: 'VERIFIED' });
    });

    it('el aula de un huérfano reaparece: vuelve a verificado', () => {
      const orphan: LmsLink = { ...VERIFIED, status: 'ORPHAN', verifiedAt: null, error: 'curso_no_encontrado' };
      expect(resolve(found(), orphan, 'conciliar')).toMatchObject({ status: 'VERIFIED', error: null });
    });
  });

  describe('formato del idnumber', () => {
    it('trata el idnumber vacío de Moodle como ausente', () => {
      expect(normalizeIdnumber('')).toBeNull();
      expect(normalizeIdnumber('   ')).toBeNull();
      expect(normalizeIdnumber(null)).toBeNull();
      expect(normalizeIdnumber('  cvsp-a  ')).toBe('cvsp-a');
    });

    it.each(['cvsp-atencion-primaria-2026', 'cvsp-a', 'cvsp-salud-basica'])('acepta %s', (idnumber) => {
      expect(() => assertIdnumberFormat(idnumber)).not.toThrow();
    });

    it.each(['cvsp-Atencion', 'cvsp_atencion', 'cvsp-', 'cvsp-atencion primaria', 'CVSP-atencion', 'cvsp--doble'])(
      'rechaza %s: no cumple la convención cvsp-<slug>',
      (idnumber) => {
        expect(() => assertIdnumberFormat(idnumber)).toThrow(/cvsp-<slug>/);
      },
    );

    it('respeta un idnumber heredado de otro sistema institucional', () => {
      expect(() => assertIdnumberFormat('SIA-2026-1-SP101')).not.toThrow();
    });

    it('rechaza más de 100 caracteres, el máximo de Moodle', () => {
      expect(() => assertIdnumberFormat('x'.repeat(101))).toThrow(/100/);
    });
  });

  describe('qué ve el visitante (RF-06)', () => {
    it('enlace verificado: el botón lleva al aula', () => {
      expect(publicAccess(VERIFIED, 'Instrucción')).toEqual({ kind: 'LMS', url: VERIFIED.url });
    });

    it.each(['ERROR', 'ORPHAN', 'PENDING'] as const)(
      'enlace en %s: se muestra la instrucción de acceso y nunca la URL guardada',
      (status) => {
        const access = publicAccess({ ...VERIFIED, status }, 'Escribe a la coordinación.');
        expect(access).toEqual({ kind: 'INSTRUCTIONS', text: 'Escribe a la coordinación.' });
      },
    );

    it('sin enlace verificado ni instrucción: acceso no disponible', () => {
      expect(publicAccess({ ...VERIFIED, status: 'ORPHAN' }, null)).toEqual({ kind: 'UNAVAILABLE' });
    });
  });

  describe('regla de publicación', () => {
    it('es publicable con enlace verificado', () => {
      expect(isPublishable({ status: 'VERIFIED' }, null)).toBe(true);
    });

    it('es publicable sin enlace si explica cómo acceder', () => {
      expect(isPublishable({ status: 'NOT_LINKED' }, 'Inscripción presencial en la sede.')).toBe(true);
    });

    it.each(['NOT_LINKED', 'PENDING', 'ERROR', 'ORPHAN'] as const)('no es publicable en %s sin instrucción de acceso', (status) => {
      expect(isPublishable({ status }, null)).toBe(false);
      expect(isPublishable({ status }, '   ')).toBe(false);
    });
  });
});
