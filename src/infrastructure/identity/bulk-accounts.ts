import { DevAccount } from './dev-accounts';

/**
 * Cuentas sinteticas de la semilla masiva (`npm run seed:bulk`), pensadas para leerse y recordarse:
 * el correo es `<rol>.<nombre>@cvsp.local` (por ejemplo `autor.valentina@cvsp.local`) y la
 * contrasena es la misma de las demas cuentas de desarrollo (LOCAL_IDENTITY_PASSWORD).
 *
 * El proveedor de identidad local las acepta siempre; las filas de `users` solo existen despues
 * de ejecutar la semilla masiva (o de que la persona entre por primera vez, como REGISTERED).
 */
export interface BulkAccount extends DevAccount {
  /** Estado inicial de la cuenta; la semilla lo aplica. */
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
}

/** Primeros nombres unicos: con uno solo basta para distinguir la cuenta dentro de su rol. */
const FIRST_NAMES = [
  'Valentina', 'Santiago', 'Sofía', 'Mateo', 'Isabella', 'Sebastián', 'Camila', 'Samuel', 'Mariana', 'Daniel',
  'Luciana', 'Nicolás', 'Gabriela', 'Felipe', 'Juliana', 'Esteban', 'Paula', 'Alejandro', 'Manuela', 'David',
  'Daniela', 'Emilio', 'Natalia', 'Julián', 'Carolina', 'Simón', 'Catalina', 'Mauricio', 'Sara', 'Diego',
  'Ximena', 'Cristian', 'Melissa', 'Jorge', 'Tatiana', 'Óscar', 'Viviana', 'Hernán', 'Marcela', 'Iván',
  'Paola', 'Rodrigo', 'Johana', 'Fernando', 'Adriana', 'Ricardo', 'Clara', 'Pablo', 'Beatriz', 'Héctor',
  'Alejandra', 'Jaime', 'Lorena', 'Álvaro', 'Diana', 'Leonardo', 'Yesenia', 'Wilson', 'Mónica', 'Gustavo',
];

const SURNAMES = [
  'Ramírez', 'Gómez', 'Restrepo', 'Londoño', 'Ospina', 'Giraldo', 'Cardona', 'Zapata', 'Arango', 'Jaramillo',
  'Henao', 'Marín', 'Orozco', 'Salazar', 'Vélez', 'Ríos', 'Duque', 'Montoya', 'Patiño', 'Betancur',
  'Quintero', 'Cifuentes', 'Echeverri', 'Gallego', 'Valencia',
];

/** Cuantas cuentas hay de cada rol, en el orden en que se reparten los nombres. */
const PLAN: { prefix: string; role: string; count: number; status?: BulkAccount['status'] }[] = [
  { prefix: 'admin', role: 'FUNCTIONAL_ADMIN', count: 2 },
  { prefix: 'tecnico', role: 'TECHNICAL_ADMIN', count: 1 },
  { prefix: 'revisor', role: 'REVIEWER', count: 5 },
  { prefix: 'gestor', role: 'ACADEMIC_MANAGER', count: 4 },
  { prefix: 'autor', role: 'AUTHOR', count: 12 },
  { prefix: 'usuario', role: 'REGISTERED', count: 24 },
  { prefix: 'inactivo', role: 'REGISTERED', count: 2, status: 'INACTIVE' },
  { prefix: 'suspendido', role: 'REGISTERED', count: 1, status: 'SUSPENDED' },
];

const withoutAccents = (text: string): string => text.normalize('NFD').replace(/[̀-ͯ]/g, '');

function buildAccounts(): BulkAccount[] {
  const accounts: BulkAccount[] = [];
  let index = 0;
  for (const { prefix, role, count, status } of PLAN) {
    for (let i = 0; i < count; i++, index++) {
      const first = FIRST_NAMES[index];
      const surname = `${SURNAMES[(index * 7) % SURNAMES.length]} ${SURNAMES[(index * 11 + 3) % SURNAMES.length]}`;
      const slug = withoutAccents(first).toLowerCase();
      accounts.push({
        subject: `bulk-${prefix}-${slug}`,
        email: `${prefix}.${slug}@cvsp.local`,
        displayName: `${first} ${surname}`,
        role,
        status: status ?? 'ACTIVE',
      });
    }
  }
  return accounts;
}

export const BULK_ACCOUNTS: BulkAccount[] = buildAccounts();
