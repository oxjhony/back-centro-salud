# Backlog — carga en GitHub Projects

Archivos para llevar el Product Backlog del proyecto a un GitHub Project.

| Archivo | Para qué sirve |
|---|---|
| `backlog.csv` | Las 54 historias con criterio de aceptación, épica, puntos y trazabilidad. Abrible en Excel o Sheets |
| `backlog.json` | Lo mismo en JSON, por si se prefiere automatizar contra la API |
| `importar-a-github-projects.ps1` | Crea un issue por historia y lo agrega al Project |

La fuente de verdad del backlog es
`Entregables/Semana-02/Product-Backlog.md`. Estos archivos se generan a partir de él; si el backlog
cambia, se regeneran, no se editan a mano.

---

## Por qué hace falta un script

GitHub Projects **no permite importar un CSV** desde la interfaz. Se puede pegar contenido en la vista
de tabla, pero eso crea elementos sueltos sin issue detrás: no quedan vinculados al repositorio, no se
pueden referenciar desde un commit y no sirven como trazabilidad.

El script crea un **issue real** por historia y luego lo agrega al Project. Así cada historia queda
enlazable desde los commits (`Closes #12`), que es lo que hace que la trazabilidad entre lo planeado y
lo construido quede registrada sola.

---

## Uso

### 1. Crear el Project

En GitHub: pestaña **Projects → New project → Board o Table**. Anota el número que aparece en la URL:

```
https://github.com/users/<usuario>/projects/<numero>
                                            ^^^^^^^^
```

### 2. Dar permiso de proyectos al CLI

El permiso de proyectos no viene en la autenticación por defecto:

```powershell
gh auth refresh -s project,read:project
```

### 3. Simular antes de crear

Siempre la primera vez. No crea nada, solo muestra qué haría:

```powershell
.\importar-a-github-projects.ps1 -Propietario <usuario> -Proyecto <numero> -Repo <usuario>/back-centro-salud -Simular
```

### 4. Ejecutar

```powershell
.\importar-a-github-projects.ps1 -Propietario <usuario> -Proyecto <numero> -Repo <usuario>/back-centro-salud
```

Crea una etiqueta por épica (`EP-01` … `EP-12`), luego los 54 issues, y los agrega al Project.

> **Se ejecuta una sola vez.** El script no detecta issues existentes: si lo corres dos veces, obtienes
> el backlog duplicado. Si algunas historias fallan, las reporta al final para crearlas a mano.

### 5. Configurar el Project

Una vez cargado, conviene agregar en el Project dos campos personalizados que el script no puede crear:

| Campo | Tipo | Valores |
|---|---|---|
| Puntos | Number | del cuerpo del issue |
| Unidad | Single select | Arquitectura · Construcción · Validación · Consolidación |

Con eso se puede agrupar por unidad y sumar puntos por sprint, que es lo que hace falta para medir la
velocidad real del equipo a partir de la semana 4.

---

## Estructura de una historia

```
Título:  [H-07] Crear una iniciativa en borrador
Etiqueta: EP-02

Cuerpo:
  Historia               Como autor, quiero crear una iniciativa en borrador,
                         para registrarla sin publicarla todavía
  Criterio de aceptación Se guarda con estado borrador; visible solo para su
                         autor y revisores
  Épica                  EP-02 — Iniciativas y flujo editorial
  Puntos                 5
  Requisitos             RF-03, RF-04
  Unidad del curso       Construcción (s. 5–8)
```

---

## Resumen del backlog

| Épica | Nombre | Historias | Puntos |
|---|---|---|---|
| EP-01 | Identidad y permisos | 6 | 21 |
| EP-02 | Iniciativas y flujo editorial | 9 | 34 |
| EP-03 | Recursos y archivos | 6 | 21 |
| EP-04 | Catálogo educativo | 6 | 21 |
| EP-05 | Búsqueda y filtros | 4 | 13 |
| EP-06 | Administración y auditoría | 5 | 21 |
| EP-07 | Agenda y noticias | 2 | 8 |
| EP-08 | Actores y redes | 3 | 13 |
| EP-09 | Participación moderada | 5 | 21 |
| EP-10 | Analítica y exportación | 3 | 13 |
| EP-11 | Notificaciones | 2 | 8 |
| EP-12 | Integraciones reales | 3 | 13 |
| | **Total** | **54** | **207** |
