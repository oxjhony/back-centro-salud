/**
 * Cuentas sinteticas del proveedor de identidad local. No son personas reales (Playbook, seccion 6).
 * Todas comparten la contrasena definida en LOCAL_IDENTITY_PASSWORD, que vive en .env y no se versiona.
 * La semilla (`npm run seed`) les asigna el rol indicado (enumeracion RoleName).
 */
export interface DevAccount {
  subject: string;
  email: string;
  displayName: string;
  role: string;
}

export const DEV_ACCOUNTS: DevAccount[] = [
  { subject: 'dev-usuario', email: 'usuario@cvsp.local', displayName: 'Úrsula Usuario', role: 'REGISTERED' },
  { subject: 'dev-autor', email: 'autor@cvsp.local', displayName: 'Andrea Autora', role: 'AUTHOR' },
  { subject: 'dev-autor2', email: 'autor2@cvsp.local', displayName: 'Camilo Coautor', role: 'AUTHOR' },
  { subject: 'dev-usuario2', email: 'usuario2@cvsp.local', displayName: 'Ulises Usuario', role: 'REGISTERED' },
  { subject: 'dev-autor3', email: 'autor3@cvsp.local', displayName: 'Lucía Líder', role: 'AUTHOR' },
  { subject: 'dev-revisor2', email: 'revisor2@cvsp.local', displayName: 'Rosa Revisora', role: 'REVIEWER' },
  { subject: 'dev-gestor2', email: 'gestor2@cvsp.local', displayName: 'Germán Gestor', role: 'ACADEMIC_MANAGER' },
  { subject: 'dev-inactivo', email: 'inactivo@cvsp.local', displayName: 'Inés Inactiva', role: 'REGISTERED' },
  { subject: 'dev-revisor', email: 'revisor@cvsp.local', displayName: 'Ramiro Revisor', role: 'REVIEWER' },
  { subject: 'dev-gestor', email: 'gestor@cvsp.local', displayName: 'Gloria Gestora', role: 'ACADEMIC_MANAGER' },
  { subject: 'dev-admin', email: 'admin@cvsp.local', displayName: 'Fabiola Funcional', role: 'FUNCTIONAL_ADMIN' },
  { subject: 'dev-tecnico', email: 'tecnico@cvsp.local', displayName: 'Tomás Técnico', role: 'TECHNICAL_ADMIN' },
];
