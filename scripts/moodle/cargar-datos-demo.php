<?php
/**
 * Carga en un Moodle de DESARROLLO recien instalado los datos de demostracion del proyecto:
 * categorias, cursos, usuarios (docente y estudiante) y sus matriculas.
 *
 * Es idempotente: lo que ya existe se deja como esta. En el Moodle institucional estos datos
 * los administra TI; este script solo existe para reconstruir el entorno local desde cero.
 *
 * Uso: php cargar-datos-demo.php <ruta a config.php de Moodle>
 */

define('CLI_SCRIPT', true);

$configpath = $argv[1] ?? '';
if (!is_file($configpath)) {
    fwrite(STDERR, "Uso: php cargar-datos-demo.php <ruta a config.php de Moodle>\n");
    exit(1);
}

require($configpath);
require_once($CFG->dirroot . '/course/lib.php');
require_once($CFG->dirroot . '/user/lib.php');
require_once($CFG->libdir . '/enrollib.php');

// categoria => [ nombre corto => [ nombre completo, resumen ] ]. La categoria por defecto de Moodle
// ("Category 1") aloja los dos cursos de la plantilla inicial.
const CVSP_DEMO_CATALOG = [
    'Category 1' => [
        'salud-basica' => ['Curso Basico de Salud', 'Curso introductorio sobre atencion primaria en salud'],
        'primeros-auxilios' => ['Primeros Auxilios', 'Curso de primeros auxilios para personal del centro de salud'],
    ],
    'Enfermeria' => [
        'enf-cuidados-basicos' => ['Cuidados Basicos de Enfermeria', 'Fundamentos de enfermeria: signos vitales e higiene y confort del paciente'],
        'enf-farmacologia' => ['Farmacologia Aplicada', 'Administracion segura de medicamentos y calculo de dosis'],
        'enf-bioseguridad' => ['Bioseguridad Hospitalaria', 'Normas de bioseguridad y manejo de residuos y control de infecciones'],
    ],
    'Emergencias y Urgencias' => [
        'urg-svb' => ['Soporte Vital Basico (SVB)', 'Reanimacion cardiopulmonar y manejo de via aerea'],
        'urg-triaje' => ['Triaje y Clasificacion de Pacientes', 'Metodologia de triaje en urgencias'],
        'urg-desastres' => ['Manejo de Desastres y Emergencias Masivas', 'Planes de contingencia y atencion en emergencias masivas'],
    ],
    'Administracion en Salud' => [
        'adm-historias' => ['Gestion de Historias Clinicas', 'Manejo documental y digital de historias clinicas'],
        'adm-atencion-usuario' => ['Atencion al Usuario en Salud', 'Habilidades de comunicacion y servicio al paciente'],
        'adm-normatividad' => ['Normatividad en Salud Publica', 'Marco legal y normativo del sistema de salud'],
    ],
];

// Usuarios de demostracion (los mismos de moodle\_users.csv) y su rol en todos los cursos.
const CVSP_DEMO_USERS = [
    ['docente1', 'Docente#2026', 'Ana', 'Martinez', 'docente1@centrosalud.local', 'editingteacher'],
    ['estudiante1', 'Estudiante#2026', 'Luis', 'Gomez', 'estudiante1@centrosalud.local', 'student'],
];

$log = fn(string $message) => fwrite(STDERR, $message . PHP_EOL);

// Las API de Moodle registran quien hizo cada cambio: se actua como el administrador del sitio.
\core\session\manager::set_user(get_admin());

// 1. Categorias y cursos.
$courseids = [];
foreach (CVSP_DEMO_CATALOG as $categoryname => $courses) {
    $categoryid = $DB->get_field('course_categories', 'id', ['name' => $categoryname, 'parent' => 0]);
    if (!$categoryid) {
        $categoryid = core_course_category::create(['name' => $categoryname, 'parent' => 0])->id;
        $log("Categoria creada: $categoryname");
    }

    foreach ($courses as $shortname => [$fullname, $summary]) {
        $existing = $DB->get_field('course', 'id', ['shortname' => $shortname]);
        if ($existing) {
            $courseids[$shortname] = (int) $existing;
            // El idnumber es la clave con la que la plataforma enlaza su ficha: convencion cvsp-<nombre corto>.
            if (trim((string) $DB->get_field('course', 'idnumber', ['id' => $existing])) === '') {
                $DB->set_field('course', 'idnumber', "cvsp-$shortname", ['id' => $existing]);
                $log("idnumber asignado: cvsp-$shortname");
            }
            continue;
        }
        $course = create_course((object) [
            'fullname' => $fullname,
            'shortname' => $shortname,
            'idnumber' => "cvsp-$shortname",
            'category' => $categoryid,
            'summary' => $summary,
            'summaryformat' => FORMAT_MOODLE,
            'format' => 'topics',
            'numsections' => 4,
            'visible' => 1,
            'enablecompletion' => 1,
        ]);
        $courseids[$shortname] = (int) $course->id;
        $log("Curso creado: $shortname");
    }
}

// 2. Usuarios y matriculas manuales.
$manual = enrol_get_plugin('manual');
foreach (CVSP_DEMO_USERS as [$username, $password, $firstname, $lastname, $email, $roleshortname]) {
    $userid = $DB->get_field('user', 'id', ['username' => $username, 'mnethostid' => $CFG->mnet_localhost_id]);
    if (!$userid) {
        $userid = user_create_user((object) [
            'username' => $username,
            'password' => hash_internal_user_password($password),
            'firstname' => $firstname,
            'lastname' => $lastname,
            'email' => $email,
            'auth' => 'manual',
            'confirmed' => 1,
            'mnethostid' => $CFG->mnet_localhost_id,
        ], false, false);
        $log("Usuario creado: $username");
    }

    $roleid = $DB->get_field('role', 'id', ['shortname' => $roleshortname], MUST_EXIST);
    foreach ($courseids as $shortname => $courseid) {
        $instance = $DB->get_record('enrol', ['courseid' => $courseid, 'enrol' => 'manual'], '*', MUST_EXIST);
        if (!$DB->record_exists('user_enrolments', ['enrolid' => $instance->id, 'userid' => $userid])) {
            $manual->enrol_user($instance, $userid, $roleid);
        }
    }
}
// 3. Ajustes del sitio: catalogo privado (sin acceso de invitados), como en el Moodle institucional.
set_config('forcelogin', 1);
set_config('guestloginbutton', 0);
set_config('autologinguests', 0);

$log('Datos de demostracion listos: ' . count($courseids) . ' cursos.');
