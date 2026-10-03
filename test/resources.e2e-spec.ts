import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { Account, createHarness, draftResource, Harness, PDF, resourceBody } from './support/harness';

/**
 * Repositorio de conocimiento (RF-05): el sistema valida formato y tamano, registra version
 * y autoriza la descarga solo segun la visibilidad.
 */
describe('Recursos y sus versiones', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h.close());

  const transition = async (account: Account, id: string, to: string, comment?: string) =>
    (await h.as(account)).post(`/editorial/resources/${id}/transitions`).send({ to, comment });

  const publish = async (id: string) => {
    for (const [account, to] of [['autor', 'SUBMITTED'], ['revisor', 'IN_REVIEW'], ['revisor', 'APPROVED'], ['revisor', 'PUBLISHED']] as const) {
      expect((await transition(account, id, to)).status).toBe(200);
    }
  };

  describe('carga de archivos', () => {
    let id: string;

    beforeAll(async () => {
      id = (await (await h.as('autor')).post('/resources').send(resourceBody({ termIds: [h.catalog.resourceTypeA] })).expect(201)).body.id;
    });

    it('el autor carga un PDF y queda como versión 1, con su huella SHA-256', async () => {
      const detail = (await (await h.as('autor')).post(`/resources/${id}/versions`).attach('file', PDF, 'Guía de vacunación.pdf').expect(201)).body;

      expect(detail.versions).toEqual([
        expect.objectContaining({
          versionNumber: 1,
          originalFilename: 'Guía de vacunación.pdf',
          mimeType: 'application/pdf',
          sizeBytes: PDF.length,
          checksum: createHash('sha256').update(PDF).digest('hex'),
          uploadedBy: 'Andrea Autora',
        }),
      ]);
      expect(detail.latestVersion.versionNumber).toBe(1);
    });

    it('una segunda carga crea la versión 2 y conserva la anterior', async () => {
      const otro = Buffer.from('%PDF-1.7\nsegunda version\n');
      const detail = (await (await h.as('autor')).post(`/resources/${id}/versions`).attach('file', otro, 'guia-v2.pdf').expect(201)).body;

      expect(detail.versions.map((v) => v.versionNumber)).toEqual([2, 1]);
      expect(detail.latestVersion.originalFilename).toBe('guia-v2.pdf');
    });

    it('el tipo MIME sale del contenido, no de lo que declare el navegador', async () => {
      const detail = (
        await (await h.as('autor'))
          .post(`/resources/${id}/versions`)
          .attach('file', Buffer.from('municipio;casos\nManizales;3\n'), { filename: 'datos.csv', contentType: 'application/x-msdownload' })
          .expect(201)
      ).body;
      expect(detail.latestVersion.mimeType).toBe('text/csv');
    });

    it.each([
      ['un formato no permitido', Buffer.from('MZ\x90\x00'), 'programa.exe', 'formato_no_permitido'],
      ['un ejecutable renombrado como PDF', Buffer.from('MZ\x90\x00'), 'guia.pdf', 'formato_no_coincide'],
      ['un archivo vacío', Buffer.alloc(0), 'vacio.txt', 'archivo_vacio'],
    ])('rechaza %s y no registra versión', async (_name, bytes, filename, code) => {
      const before = (await h.owner.query(`SELECT count(*)::int AS n FROM resource_versions`))[0].n;
      const response = await (await h.as('autor')).post(`/resources/${id}/versions`).attach('file', bytes, filename);
      expect(response.status).toBe(422);
      expect(response.body.code).toBe(code);
      expect((await h.owner.query(`SELECT count(*)::int AS n FROM resource_versions`))[0].n).toBe(before);
    });

    it('rechaza un archivo que supera el tamaño máximo antes de procesarlo', async () => {
      const big = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(60 * 1024, 0x20)]);
      await (await h.as('autor')).post(`/resources/${id}/versions`).attach('file', big, 'grande.pdf').expect(413);
    });

    it('sin archivo responde un error claro', async () => {
      const response = await (await h.as('autor')).post(`/resources/${id}/versions`).field('nota', 'sin archivo');
      expect(response.status).toBe(422);
      expect(response.body.code).toBe('archivo_requerido');
    });

    it('los bytes quedan en el almacenamiento con la clave que genera la plataforma, no con el nombre del archivo', async () => {
      const files = await readdir(`${process.env.STORAGE_DIR}/${id}`);
      expect(files).toHaveLength(3);
      expect(files.every((name) => /^[0-9a-f-]{36}$/.test(name))).toBe(true);
    });

    it('otro autor no carga versiones en un recurso ajeno', async () => {
      await (await h.as('autor2')).post(`/resources/${id}/versions`).attach('file', PDF, 'intruso.pdf').expect(404);
    });

    it('el autor descarga cualquiera de sus versiones; otro autor no', async () => {
      const detail = (await (await h.as('autor')).get(`/resources/${id}`).expect(200)).body;
      const v1 = detail.versions.find((v) => v.versionNumber === 1);

      const response = await (await h.as('autor')).get(`/resources/${id}/versions/${v1.id}/download`).buffer(true).expect(200);
      expect(Buffer.from(response.body).equals(PDF)).toBe(true);
      expect(response.headers['content-disposition']).toContain(`filename*=UTF-8''Gu%C3%ADa%20de%20vacunaci%C3%B3n.pdf`);
      expect(response.headers['x-content-type-options']).toBe('nosniff');

      await (await h.as('autor2')).get(`/resources/${id}/versions/${v1.id}/download`).expect(404);
    });
  });

  describe('flujo editorial del recurso', () => {
    it('un recurso sin archivo no se envía a revisión', async () => {
      const id = (await (await h.as('autor')).post('/resources').send(resourceBody({ title: 'Sin archivo' })).expect(201)).body.id;
      const response = await transition('autor', id, 'SUBMITTED');
      expect(response.status).toBe(409);
      expect(response.body.code).toBe('recurso_sin_archivo');
    });

    it('enviado a revisión, ya no admite versiones ni cambios', async () => {
      const id = await draftResource(await h.as('autor'), { title: 'En revisión' });
      await transition('autor', id, 'SUBMITTED');

      const upload = await (await h.as('autor')).post(`/resources/${id}/versions`).attach('file', PDF, 'nueva.pdf');
      expect(upload.status).toBe(409);
      expect(upload.body.code).toBe('no_editable');
      await (await h.as('autor')).put(`/resources/${id}`).send(resourceBody()).expect(409);
    });

    it('el revisor ve las versiones en la bandeja y puede descargarlas para evaluarlas', async () => {
      const id = await draftResource(await h.as('autor'), { title: 'Para revisar' });
      await transition('autor', id, 'SUBMITTED');

      const queue = (await (await h.as('revisor')).get('/editorial/queue').expect(200)).body;
      expect(queue).toEqual(expect.arrayContaining([expect.objectContaining({ entityType: 'resources', id, authorName: 'Andrea Autora' })]));

      const detail = (await (await h.as('revisor')).get(`/resources/${id}`).expect(200)).body;
      await (await h.as('revisor')).get(`/resources/${id}/versions/${detail.versions[0].id}/download`).expect(200);
    });
  });

  describe('descarga pública según visibilidad', () => {
    let publicId: string;
    let restrictedId: string;
    let draftId: string;

    beforeAll(async () => {
      const autor = await h.as('autor');
      publicId = await draftResource(autor, { title: 'Guía pública', termIds: [h.catalog.themeA] });
      restrictedId = await draftResource(autor, { title: 'Datos restringidos', visibility: 'RESTRICTED' });
      draftId = await draftResource(autor, { title: 'Borrador privado' });
      await publish(publicId);
      await publish(restrictedId);
    });

    it('el catálogo público lista lo publicado, con los datos del archivo pero sin quién lo cargó', async () => {
      const page = (await h.visitor().get('/public/resources').expect(200)).body;
      expect(page.items.map((r) => r.title).sort()).toEqual(['Datos restringidos', 'Guía pública']);

      const guia = page.items.find((r) => r.id === publicId);
      expect(guia).toMatchObject({ author: 'Andrea Autora', file: { versionNumber: 1, mimeType: 'application/pdf', sizeBytes: PDF.length } });
      expect(JSON.stringify(page)).not.toContain(h.userId('autor'));
      expect(JSON.stringify(page)).not.toContain('storage');
    });

    it('filtra por visibilidad y por término', async () => {
      const search = async (query: Record<string, string>) =>
        (await h.visitor().get('/public/resources').query(query).expect(200)).body.items.map((r) => r.title);
      expect(await search({ visibility: 'RESTRICTED' })).toEqual(['Datos restringidos']);
      expect(await search({ themeId: h.catalog.themeA })).toEqual(['Guía pública']);
    });

    it('un recurso PUBLIC se descarga sin sesión', async () => {
      const response = await h.visitor().get(`/public/resources/${publicId}/download`).buffer(true).expect(200);
      expect(response.headers['content-type']).toContain('application/pdf');
      expect(response.headers['content-disposition']).toMatch(/^attachment;/);
      expect(Buffer.from(response.body).equals(PDF)).toBe(true);
    });

    it('un recurso RESTRICTED se ve en el catálogo, pero descargarlo exige sesión', async () => {
      await h.visitor().get(`/public/resources/${restrictedId}`).expect(200);
      const anonymous = await h.visitor().get(`/public/resources/${restrictedId}/download`).expect(401);
      expect(anonymous.body.code).toBe('sesion_requerida');

      await (await h.as('usuario')).get(`/public/resources/${restrictedId}/download`).expect(200);
    });

    it('un recurso no publicado no se ve ni se descarga, aunque se conozca su URL', async () => {
      await h.visitor().get(`/public/resources/${draftId}`).expect(404);
      await h.visitor().get(`/public/resources/${draftId}/download`).expect(404);
      await (await h.as('usuario')).get(`/public/resources/${draftId}/download`).expect(404);
    });

    it('los recursos asociables son los propios y los publicados', async () => {
      const mine = (await (await h.as('autor')).get('/resources/linkable').expect(200)).body.map((r) => r.id);
      expect(mine).toEqual(expect.arrayContaining([publicId, restrictedId, draftId]));

      const others = (await (await h.as('autor2')).get('/resources/linkable').expect(200)).body.map((r) => r.id);
      expect(others).toEqual(expect.arrayContaining([publicId, restrictedId]));
      expect(others).not.toContain(draftId);
    });
  });
});
