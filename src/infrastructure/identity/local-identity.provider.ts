import { createHash, timingSafeEqual } from 'node:crypto';
import { ExternalIdentity, IdentityProvider } from '../../modules/identity/application/ports';
import { DevAccount } from './dev-accounts';

/**
 * Proveedor de identidad de desarrollo: hace el papel del proveedor institucional mientras
 * este no exista. La contrasena no se guarda en la base de datos de la plataforma.
 */
export class LocalIdentityProvider implements IdentityProvider {
  constructor(
    private readonly accounts: DevAccount[],
    private readonly sharedPassword: string,
  ) {}

  async authenticate(email: string, password: string): Promise<ExternalIdentity | null> {
    // Sin contrasena configurada no entra nadie: nunca se acepta la cadena vacia.
    if (!this.sharedPassword) return null;

    const account = this.accounts.find((a) => a.email === email.toLowerCase());
    const passwordMatches = constantTimeEquals(password, this.sharedPassword);
    if (!account || !passwordMatches) return null;

    return { subject: account.subject, email: account.email, displayName: account.displayName };
  }
}

/** Compara sin revelar por tiempo de respuesta cuantos caracteres coinciden. */
function constantTimeEquals(a: string, b: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(a), digest(b));
}
