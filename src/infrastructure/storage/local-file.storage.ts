import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { FileStorage } from '../../modules/resources/application/ports';

/**
 * Almacenamiento de desarrollo: una carpeta local. La clave la genera la plataforma
 * (<recurso>/<version>), nunca el nombre que trae el archivo, y aun asi se comprueba
 * que no escape de la carpeta raiz.
 */
export class LocalFileStorage implements FileStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async put(key: string, bytes: Buffer): Promise<void> {
    const path = this.pathOf(key);
    await mkdir(dirname(path), { recursive: true });
    // wx: una version no sobrescribe a otra.
    await writeFile(path, bytes, { flag: 'wx' });
  }

  get(key: string): Promise<Buffer> {
    return readFile(this.pathOf(key));
  }

  async remove(key: string): Promise<void> {
    await rm(this.pathOf(key), { force: true });
  }

  private pathOf(key: string): string {
    if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}$/.test(key)) {
      throw new Error('Clave de almacenamiento inválida.');
    }
    const path = resolve(join(this.root, key));
    if (!path.startsWith(this.root + sep)) {
      throw new Error('Clave de almacenamiento fuera de la carpeta raíz.');
    }
    return path;
  }
}
