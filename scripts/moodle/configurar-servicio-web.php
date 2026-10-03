<?php
/**
 * Prepara un Moodle de DESARROLLO para que la plataforma lo consulte en solo lectura:
 *
 *   1. Habilita los servicios web y el protocolo REST.
 *   2. Crea el rol "cvsp_lectura" (usar REST + ver cursos; ninguna capacidad de escritura).
 *   3. Crea el usuario de servicio "cvsp_servicio" y le asigna ese rol.
 *   4. Crea el servicio externo "cvsp_lectura" con las tres funciones del contrato de integracion.
 *   5. Emite (o reutiliza) el token del servicio.
 *   6. Asigna idnumber "cvsp-<slug>" a los cursos de demostracion que aun no lo tengan.
 *
 * Es idempotente: se puede ejecutar varias veces. En el Moodle institucional estos pasos los
 * hace TI, no este script.
 *
 * Uso:    php configurar-servicio-web.php <ruta a config.php de Moodle>
 * Salida: UNICAMENTE el token por la salida estandar, para guardarlo en MOODLE_WS_TOKEN sin
 *         mostrarlo. El diagnostico va por la salida de error.
 */

define('CLI_SCRIPT', true);

$configpath = $argv[1] ?? '';
if (!is_file($configpath)) {
    fwrite(STDERR, "Uso: php configurar-servicio-web.php <ruta a config.php de Moodle>\n");
    exit(1);
}

require($configpath);
require_once($CFG->dirroot . '/webservice/lib.php');
require_once($CFG->dirroot . '/user/lib.php');
require_once($CFG->dirroot . '/course/lib.php');

const CVSP_SERVICE = 'cvsp_lectura';
const CVSP_ROLE = 'cvsp_lectura';
const CVSP_USER = 'cvsp_servicio';
const CVSP_FUNCTIONS = [
    'core_course_get_courses_by_field',
    'core_course_get_courses',
    'core_course_get_categories',
];
// Cursos de demostracion (_courses.csv): nombre corto => idnumber con la convencion del Centro.
const CVSP_DEMO_COURSES = [
    'salud-basica' => 'cvsp-salud-basica',
    'primeros-auxilios' => 'cvsp-primeros-auxilios',
];

$log = fn(string $message) => fwrite(STDERR, $message . PHP_EOL);

// Las API de Moodle registran quien hizo cada cambio: se actua como el administrador del sitio.
\core\session\manager::set_user(get_admin());
$system = context_system::instance();

// 1. Servicios web y protocolo REST.
set_config('enablewebservices', 1);
$protocols = array_filter(explode(',', (string) ($CFG->webserviceprotocols ?? '')));
if (!in_array('rest', $protocols)) {
    $protocols[] = 'rest';
    set_config('webserviceprotocols', implode(',', $protocols));
}
$log('Servicios web y protocolo REST habilitados.');

// 2. Rol de solo lectura.
$roleid = $DB->get_field('role', 'id', ['shortname' => CVSP_ROLE]);
if (!$roleid) {
    $roleid = create_role(
        'CVSP - lectura de catálogo',
        CVSP_ROLE,
        'Solo lectura del catálogo de cursos para el Centro Virtual de Salud Pública.'
    );
    $log('Rol creado: ' . CVSP_ROLE);
}
set_role_contextlevels($roleid, [CONTEXT_SYSTEM]);
foreach (['webservice/rest:use', 'moodle/course:view'] as $capability) {
    assign_capability($capability, CAP_ALLOW, $roleid, $system->id, true);
}

// 3. Usuario de servicio. Su contrasena es aleatoria y no se usa: entra solo por token.
$userid = $DB->get_field('user', 'id', ['username' => CVSP_USER, 'mnethostid' => $CFG->mnet_localhost_id]);
if (!$userid) {
    $userid = user_create_user((object) [
        'username' => CVSP_USER,
        'auth' => 'manual',
        'password' => bin2hex(random_bytes(24)) . 'aA1#',
        'firstname' => 'CVSP',
        'lastname' => 'Servicio',
        'email' => 'cvsp-servicio@centrosalud.local',
        'confirmed' => 1,
        'mnethostid' => $CFG->mnet_localhost_id,
    ]);
    $log('Usuario de servicio creado: ' . CVSP_USER);
}
role_assign($roleid, $userid, $system->id);

// 4. Servicio externo restringido a ese usuario.
$manager = new webservice();
$service = $manager->get_external_service_by_shortname(CVSP_SERVICE);
if (!$service) {
    $manager->add_external_service((object) [
        'name' => 'CVSP - catálogo (solo lectura)',
        'shortname' => CVSP_SERVICE,
        'enabled' => 1,
        'restrictedusers' => 1,
        'downloadfiles' => 0,
        'uploadfiles' => 0,
        'requiredcapability' => '',
    ]);
    $service = $manager->get_external_service_by_shortname(CVSP_SERVICE, MUST_EXIST);
    $log('Servicio externo creado: ' . CVSP_SERVICE);
}
foreach (CVSP_FUNCTIONS as $function) {
    if (!$manager->service_function_exists($function, $service->id)) {
        $manager->add_external_function_to_service($function, $service->id);
    }
}
if (!$DB->record_exists('external_services_users', ['externalserviceid' => $service->id, 'userid' => $userid])) {
    $manager->add_ws_authorised_user((object) ['externalserviceid' => $service->id, 'userid' => $userid]);
}

// 5. Token permanente del servicio.
$token = $DB->get_field('external_tokens', 'token', [
    'userid' => $userid,
    'externalserviceid' => $service->id,
    'tokentype' => EXTERNAL_TOKEN_PERMANENT,
]);
if (!$token) {
    $token = \core_external\util::generate_token(EXTERNAL_TOKEN_PERMANENT, $service, $userid, $system, 0, '');
    $log('Token emitido.');
} else {
    $log('Se reutiliza el token existente.');
}

// 6. idnumber de los cursos de demostracion. Un idnumber ya asignado se respeta.
foreach (CVSP_DEMO_COURSES as $shortname => $idnumber) {
    $course = $DB->get_record('course', ['shortname' => $shortname]);
    if (!$course) {
        $log("Curso de demostración no encontrado: {$shortname}");
    } else if ($course->idnumber === '') {
        update_course((object) ['id' => $course->id, 'idnumber' => $idnumber]);
        $log("idnumber asignado: {$shortname} -> {$idnumber}");
    } else {
        $log("El curso {$shortname} ya tiene idnumber: {$course->idnumber}");
    }
}

purge_all_caches();
echo $token;
