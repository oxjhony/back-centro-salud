# Centro Virtual de Salud Pública — Backend

API del Centro Virtual de Salud Pública, plataforma de articulación y gestión del conocimiento para la
Universidad de Caldas.

Proyecto Integrador II · Ingeniería de Sistemas · agosto–diciembre 2026

| | |
|---|---|
| **Frontend** | [front-centro-salud](https://github.com/oxjhony/front-centro-salud) |
| **Equipo** | Juan Pablo Pulgarín ([@JuanIIDX](https://github.com/JuanIIDX)) · Jhony Alejandro Pérez ([@Oxjhony](https://github.com/Oxjhony)) |
| **Empresa aliada** | Universidad de Caldas |

---

## Qué resuelve

La Universidad presenta dispersión de experiencias, productos y recursos de salud pública entre
proyectos, grupos, cursos y territorios. Esa fragmentación reduce la visibilidad del trabajo, favorece
la duplicación de esfuerzos y dificulta encontrar evidencia y oportunidades formativas.

El problema no es la ausencia de sistemas sino la falta de articulación entre los que ya existen. Por
eso esta plataforma **conecta en lugar de reemplazar**: se integra con Moodle, con la identidad
institucional y con los repositorios existentes mediante catálogos, metadatos, enlaces y flujos de
publicación.

Consecuencia directa en el código: **Moodle es un sistema externo de solo lectura.** No se replica su
esquema ni se almacenan matrículas, progreso o calificaciones.

---

## Stack

| Capa | Tecnología |
|---|---|
| Framework | NestJS 10 · TypeScript |
| Base de datos | PostgreSQL 16 |
| Almacenamiento de objetos | MinIO en desarrollo |
| Identidad | OIDC — proveedor local en desarrollo |
| Pruebas | Jest |

---

## Requisitos previos

- Node.js 22 o superior
- Docker y Docker Compose
- Git

---

## Instalación

```bash
git clone https://github.com/oxjhony/back-centro-salud.git
cd back-centro-salud
npm install
```

### Variables de entorno

Copia el archivo de ejemplo y ajústalo:

```bash
cp .env.example .env
```

| Variable | Descripción | Ejemplo |
|---|---|---|
| `PORT` | Puerto de la API | `3000` |
| `DATABASE_URL` | Cadena de conexión a PostgreSQL | `postgresql://cvsp:cvsp@localhost:5432/cvsp` |
| `STORAGE_ENDPOINT` | Endpoint del almacenamiento de objetos | `http://localhost:9000` |
| `STORAGE_BUCKET` | Contenedor de recursos | `recursos` |
| `OIDC_ISSUER_URL` | Emisor del proveedor de identidad | `http://localhost:8080/realms/cvsp` |
| `OIDC_CLIENT_ID` | Identificador del cliente | `cvsp-api` |
| `OIDC_CLIENT_SECRET` | Secreto del cliente | — |
| `MOODLE_BASE_URL` | URL de la instancia de Moodle | `http://127.0.0.1:8090` |
| `MOODLE_WS_TOKEN` | Token de servicio web, solo lectura | — |
| `MOODLE_TIMEOUT_MS` | Tiempo máximo de espera al LMS | `5000` |
| `SMTP_HOST` | Servidor de correo | `localhost` |
| `SMTP_PORT` | Puerto SMTP | `1025` |

> **Nunca se versiona el archivo `.env`.** Los secretos van por variable de entorno o gestor de
> secretos, jamás en el repositorio ni en la base de datos. Esto incluye el token de Moodle.

---

## Ejecución

### Servicios de apoyo

```bash
docker compose up -d
```

Levanta PostgreSQL, MinIO, el proveedor de identidad de desarrollo y un servidor SMTP simulado.

| Servicio | URL |
|---|---|
| PostgreSQL | `localhost:5432` |
| MinIO — consola | http://localhost:9001 |
| Identidad | http://localhost:8080 |
| Bandeja de correo simulada | http://localhost:8025 |

> El servidor SMTP **captura** los correos en lugar de entregarlos y los muestra en esa bandeja web.
> No sale ningún mensaje real durante el desarrollo.

### API

```bash
npm run start:dev      # desarrollo, con recarga automática
npm run start          # ejecución normal
npm run build          # compilación
npm run start:prod     # ejecución del build
```

La API queda en `http://localhost:3000`.

| Endpoint | Para qué |
|---|---|
| `/health/live` | El proceso está vivo |
| `/health/ready` | Base de datos y almacenamiento responden |

`/health/ready` **no consulta Moodle** a propósito: si el LMS está caído la plataforma sigue operando
en modo degradado, y marcarla como no lista provocaría reinicios en cadena por una dependencia externa.

---

## Pruebas

```bash
npm test               # unitarias
npm run test:watch     # en modo observación
npm run test:cov       # con cobertura
npm run test:e2e       # extremo a extremo
```

---

## Base de datos

El modelo comprende 44 tablas en 13 módulos, con el orden de migración determinado por las
dependencias entre claves foráneas:

```
identidad → catálogos → editorial → iniciativas → recursos → cursos
→ operación → agenda → red → participación → analítica → notificaciones → integración LMS
```

Ese orden no es arbitrario: sale de un ordenamiento topológico sobre las claves foráneas. Alterarlo
obliga a crear tablas con dependencias sin resolver.

```bash
npm run migration:run       # aplicar migraciones
npm run migration:revert    # revertir la última
npm run seed                # datos de prueba
```

> **`synchronize` solo en local.** Sincronizar el esquema automáticamente contra una base compartida
> borra columnas sin aviso y produce condiciones de carrera entre réplicas. Fuera de `localhost`, solo
> migraciones.

### Extensión requerida

La búsqueda en español usa columnas generadas que dependen de `unaccent`. La primera migración debe
crear la extensión y una función envoltorio inmutable, porque `unaccent()` no lo es y PostgreSQL no la
admite en columnas generadas.

---

## Integración con Moodle

| Aspecto | Definición |
|---|---|
| Clave de unión | `mdl_course.idnumber`, no el identificador interno |
| Dirección | Solo lectura |
| Convención | `cvsp-<slug>` para cursos creados para el Centro |
| Modo degradado | El catálogo se sirve siempre desde la base local; nunca consulta el LMS en vivo |

Se usa `idnumber` porque es el campo que Moodle reserva para sistemas externos. El identificador
interno es autoincremental y cambia al restaurar o migrar; el nombre corto es editable por el gestor.

> Moodle no garantiza unicidad del `idnumber` en base de datos —solo la valida en su capa de
> aplicación— así que el adaptador rechaza duplicados y valores vacíos.

---

## Estructura

```
src/
├── modules/          # módulos de dominio
├── shared/           # utilidades transversales
└── infrastructure/   # adaptadores: base de datos, almacenamiento, Moodle, identidad, correo
docs/
└── backlog/          # backlog para cargar en GitHub Projects
```

Los adaptadores se implementan detrás de una interfaz con dos versiones: la real y un doble de prueba.
Eso permite desarrollar contra Moodle e identidad aunque la institución aún no habilite los accesos
definitivos.

---

## Flujo de trabajo

Ramas cortas y solicitudes de cambio con revisión por pares.

```
main                 # siempre desplegable
└── tipo/H-nn-descripcion-corta
```

| Prefijo | Para |
|---|---|
| `feat/` | Funcionalidad nueva |
| `fix/` | Corrección |
| `chore/` | Configuración, dependencias, herramientas |
| `docs/` | Documentación |

Ejemplo: `feat/H-07-crear-iniciativa-borrador`

### Commits

```
tipo(alcance): descripción en imperativo

feat(iniciativas): agregar transición de borrador a enviado
fix(auth): corregir validación de permisos en la API
```

### Solicitudes de cambio

Siendo un equipo de dos, **quien escribe no revisa**: toda rama se integra mediante solicitud de cambio
revisada por el otro integrante, sin excepción. Es la única mitigación real del riesgo de que un
componente quede en manos de una sola persona.

Una solicitud se puede integrar cuando:

- [ ] Está vinculada a una historia del backlog (`Closes #nn`)
- [ ] Las pruebas pasan
- [ ] El análisis estático pasa
- [ ] No introduce secretos
- [ ] La revisó el otro integrante
- [ ] La documentación y el contrato de API quedaron actualizados

---

## Documentación del proyecto

| Documento | Dónde |
|---|---|
| Especificación Ejecutable v1 | `Entregables/Semana-02/` |
| Project Charter | `Entregables/Semana-02/` |
| Product Backlog | `Entregables/Semana-02/` |
| Modelo de datos | `documentos/centro_virtual_salud_publica_modelo_datos_v2.json` |
| Guía de despliegue | `documentos/despliegue-azure.md` |
| Playbook de orquestación de IA | `Entregables/Semana-04/` |

La Especificación Ejecutable es la fuente de verdad del proyecto. Cuando el código la contradiga, se
corrige el código; si la equivocada es la especificación, se corrige allí primero.

---

## Alcance

**Incluye:** portal público, gestión editorial de iniciativas, repositorio de recursos, catálogo
educativo enlazado a Moodle, directorio de actores, participación moderada, administración, búsqueda,
bitácora de auditoría y analítica agregada.

**No incluye:** historias clínicas, datos de pacientes, diagnóstico, triaje o teleconsulta ·
construcción de un LMS · certificación o pagos · aplicación móvil nativa · chatbot en producción ·
operación continua tras el cierre del curso.
