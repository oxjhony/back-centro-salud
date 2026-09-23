<#
.SYNOPSIS
    Crea las historias del backlog como issues de GitHub y las agrega a un GitHub Project.

.DESCRIPTION
    GitHub Projects no admite importar un CSV directamente desde la interfaz.
    Este script recorre backlog.csv, crea un issue por historia y lo agrega al proyecto.

.PARAMETER Proyecto
    Número del GitHub Project (se ve en la URL: /users/<usuario>/projects/<numero>).

.PARAMETER Propietario
    Usuario u organización dueña del Project.

.PARAMETER Repo
    Repositorio donde se crean los issues, en formato usuario/repositorio.

.PARAMETER Simular
    Muestra lo que haría sin crear nada. Úsalo siempre la primera vez.

.EXAMPLE
    .\importar-a-github-projects.ps1 -Propietario oxjhony -Proyecto 1 -Repo oxjhony/back-centro-salud -Simular
    .\importar-a-github-projects.ps1 -Propietario oxjhony -Proyecto 1 -Repo oxjhony/back-centro-salud

.NOTES
    Requiere GitHub CLI autenticado con permiso sobre proyectos:
        gh auth refresh -s project,read:project
#>

param(
    [Parameter(Mandatory = $true)][string]$Propietario,
    [Parameter(Mandatory = $true)][int]$Proyecto,
    [Parameter(Mandatory = $true)][string]$Repo,
    [switch]$Simular
)

$ErrorActionPreference = 'Stop'
$csv = Join-Path $PSScriptRoot 'backlog.csv'

if (-not (Test-Path $csv)) { throw "No se encontro $csv" }
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw "GitHub CLI (gh) no esta instalado" }

$filas = Import-Csv -Path $csv -Encoding UTF8
Write-Host "Historias en el CSV: $($filas.Count)" -ForegroundColor Cyan
if ($Simular) { Write-Host "MODO SIMULACION - no se crea nada" -ForegroundColor Yellow }

# Etiquetas: una por epica. Se crean si no existen.
if (-not $Simular) {
    $epicas = $filas | Select-Object -ExpandProperty Epica -Unique
    foreach ($e in $epicas) {
        gh label create $e --repo $Repo --color "1F4E5F" --description "Epica $e" 2>$null
        if ($?) { Write-Host "  etiqueta creada: $e" -ForegroundColor DarkGray }
    }
}

$creados = 0
$fallidos = @()

foreach ($f in $filas) {
    $cuerpo = @"
**Historia**

$($f.Historia)

**Criterio de aceptación**

$($f.'Criterio de aceptacion')

---

| Campo | Valor |
|---|---|
| Épica | $($f.Epica) — $($f.'Nombre epica') |
| Puntos | $($f.Puntos) |
| Requisitos | $($f.Requisitos) |
| Unidad del curso | $($f.Unidad) |

> Trazabilidad: esta historia deriva de los requisitos indicados en la Especificación Ejecutable v1.
"@

    if ($Simular) {
        Write-Host "[$($f.ID)] $($f.Titulo)  ($($f.Puntos) pts, $($f.Epica))"
        continue
    }

    try {
        $url = gh issue create --repo $Repo --title $f.Titulo --body $cuerpo --label $f.Epica
        gh project item-add $Proyecto --owner $Propietario --url $url | Out-Null
        Write-Host "[$($f.ID)] creado -> $url" -ForegroundColor Green
        $creados++
    }
    catch {
        Write-Warning "[$($f.ID)] fallo: $_"
        $fallidos += $f.ID
    }
}

if (-not $Simular) {
    Write-Host ""
    Write-Host "Creados: $creados de $($filas.Count)" -ForegroundColor Cyan
    if ($fallidos.Count -gt 0) {
        Write-Host "Fallidos: $($fallidos -join ', ')" -ForegroundColor Red
        Write-Host "Reintenta solo esos; los ya creados se duplicarian si repites todo el script." -ForegroundColor Yellow
    }
}
