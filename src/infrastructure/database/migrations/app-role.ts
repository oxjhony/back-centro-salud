/**
 * Rol con el que se conecta la aplicacion. Las migraciones las ejecuta el rol propietario
 * y aqui se le conceden a la aplicacion solo los privilegios que necesita: asi la bitacora
 * queda inalterable desde la aplicacion por la base de datos y no por convencion (RF-14).
 */
const role = process.env.DATABASE_APP_ROLE?.trim() || 'cvsp_app';

if (!/^[a-z_][a-z0-9_]*$/.test(role)) {
  throw new Error(`DATABASE_APP_ROLE no es un identificador valido: ${role}`);
}

export const APP_ROLE = role;
