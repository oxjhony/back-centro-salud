import { Identidad1791000000001 } from './1791000000001-Identidad';
import { Taxonomia1791000000002 } from './1791000000002-Taxonomia';
import { Contenidos1791000000003 } from './1791000000003-Contenidos';
import { Incrementos1791000000004 } from './1791000000004-Incrementos';
import { Editorial1791000000005 } from './1791000000005-Editorial';
import { Operacion1791000000006 } from './1791000000006-Operacion';

/**
 * Esquema del modelo de datos v3 (documentos/centro_virtual_salud_publica_modelo_datosV3.json).
 * El orden respeta las claves foraneas: cada migracion solo referencia tablas de las anteriores.
 */
export const MIGRATIONS = [
  Identidad1791000000001,
  Taxonomia1791000000002,
  Contenidos1791000000003,
  Incrementos1791000000004,
  Editorial1791000000005,
  Operacion1791000000006,
];
