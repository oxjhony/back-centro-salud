import { BULK_ACCOUNTS } from './bulk-accounts';
import { DEV_ACCOUNTS } from './dev-accounts';

describe('BULK_ACCOUNTS', () => {
  const all = [...DEV_ACCOUNTS, ...BULK_ACCOUNTS];

  it('no repite correos ni identificadores frente a las cuentas de desarrollo', () => {
    expect(new Set(all.map((a) => a.email)).size).toBe(all.length);
    expect(new Set(all.map((a) => a.subject)).size).toBe(all.length);
  });

  it('usa correos legibles: rol.nombre@cvsp.local, en minusculas y sin tildes', () => {
    for (const { email } of BULK_ACCOUNTS) expect(email).toMatch(/^[a-z]+\.[a-z]+@cvsp\.local$/);
  });

  it('cubre todos los roles asignables y deja cuentas inactivas y suspendidas para probar el rechazo', () => {
    const roles = new Set(BULK_ACCOUNTS.map((a) => a.role));
    expect([...roles].sort()).toEqual(
      ['ACADEMIC_MANAGER', 'AUTHOR', 'FUNCTIONAL_ADMIN', 'REGISTERED', 'REVIEWER', 'TECHNICAL_ADMIN'].sort(),
    );
    expect(BULK_ACCOUNTS.some((a) => a.status === 'INACTIVE')).toBe(true);
    expect(BULK_ACCOUNTS.some((a) => a.status === 'SUSPENDED')).toBe(true);
  });

  it('tiene suficientes revisores y autores para que nadie revise su propio contenido', () => {
    expect(BULK_ACCOUNTS.filter((a) => a.role === 'REVIEWER').length).toBeGreaterThanOrEqual(2);
    expect(BULK_ACCOUNTS.filter((a) => a.role === 'AUTHOR').length).toBeGreaterThanOrEqual(2);
  });
});
