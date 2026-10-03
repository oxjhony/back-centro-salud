import { DevAccount } from './dev-accounts';
import { LocalIdentityProvider } from './local-identity.provider';

const ACCOUNTS: DevAccount[] = [
  { subject: 'sub-autor', email: 'autor@prueba.local', displayName: 'Autora de Prueba', role: 'AUTHOR' },
];

describe('proveedor de identidad local', () => {
  const provider = new LocalIdentityProvider(ACCOUNTS, 'clave-correcta');

  it('autentica una cuenta conocida y devuelve solo su identidad mínima', async () => {
    expect(await provider.authenticate('autor@prueba.local', 'clave-correcta')).toEqual({
      subject: 'sub-autor',
      email: 'autor@prueba.local',
      displayName: 'Autora de Prueba',
    });
  });

  it('no distingue mayúsculas en el correo', async () => {
    expect(await provider.authenticate('Autor@Prueba.LOCAL', 'clave-correcta')).not.toBeNull();
  });

  it('rechaza una contraseña incorrecta', async () => {
    expect(await provider.authenticate('autor@prueba.local', 'otra')).toBeNull();
  });

  it('rechaza una cuenta desconocida aunque la contraseña sea la correcta', async () => {
    expect(await provider.authenticate('nadie@prueba.local', 'clave-correcta')).toBeNull();
  });

  it('sin contraseña configurada no entra nadie, ni siquiera con la cadena vacía', async () => {
    const unconfigured = new LocalIdentityProvider(ACCOUNTS, '');
    expect(await unconfigured.authenticate('autor@prueba.local', '')).toBeNull();
  });
});
