# AtlasClima — observatorio climático

Aplicación para registrar sensores, consultar mediciones, generar informes, atender alertas, intercambiar mensajes y administrar facturas. Incluye una interfaz React y una API Java 21 con Spring Boot 3.5.

Para conocer el objetivo del proyecto, las tecnologías elegidas y los temas que se practican, consultá la [presentación del proyecto](docs/PROYECTO.md).

## Probar la aplicación como administrador

Quien clone este repositorio puede ejecutar una **demostración local independiente** y entrar al panel de Administrador sin conocer mis credenciales. Cada copia genera su propia contraseña administrativa y usa contenedores y volúmenes separados de la instalación habitual. GitHub muestra el código y esta guía; para usar la interfaz hay que ejecutar la aplicación en un equipo.

Se necesitan Java 21, Maven, Node.js 22 o superior, Docker Desktop y PowerShell. Desde la raíz del proyecto:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-demo.ps1
```

El script crea `.env.demo` con contraseñas aleatorias, inicia PostgreSQL, Cassandra, MongoDB y Redis para esta demostración y prepara el esquema de mediciones. **No modifica `.env` ni sus bases de datos.** Después, abrir tres terminales en la raíz del proyecto:

```powershell
# Terminal 1: backend de la demostración
$env:APP_ENV_FILE = '.env.demo'
mvn spring-boot:run
```

```powershell
# Terminal 2: datos de ejemplo, con el backend ya iniciado
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\seed-demo.ps1 -Demo
```

```powershell
# Terminal 3: interfaz de la demostración
cd frontend
npm.cmd ci
npm.cmd run dev:demo
```

Abrir `http://127.0.0.1:5174`. Para ver las credenciales **del administrador de esta copia**, ejecutar en otra terminal desde la raíz:

```powershell
Select-String -Path .env.demo -Pattern '^BOOTSTRAP_ADMIN_(EMAIL|PASSWORD)='
```

Para entrar como Usuario o Técnico, las credenciales generadas están en `demo-credentials-public.json`. Ambos archivos son locales y están ignorados por Git. La primera carga de datos puede tardar porque crea más de 500 mediciones. Si se reinician los contenedores, las bases conservan sus volúmenes; el script reutiliza las mismas credenciales. Para detener las bases de demostración sin borrar sus datos, ejecutar `docker compose --project-name atlasclima-demo --env-file .env.demo down`.

## Puesta en marcha local

1. Instalar Java 21, Maven, Node.js 22 o superior y Docker Compose.
2. Copiar `.env.example` a `.env` y cambiar **todas** las contraseñas. El usuario administrador inicial se crea solo cuando se definen `BOOTSTRAP_ADMIN_EMAIL` y `BOOTSTRAP_ADMIN_PASSWORD` (mínimo 6 caracteres). No subir `.env` al repositorio.
3. Ejecutar `docker compose up -d` y esperar a que Cassandra responda (`docker compose ps`).
4. Crear el esquema Cassandra: `docker compose exec cassandra cqlsh -f /schema.cql`.
5. Ejecutar `mvn spring-boot:run` desde este directorio. Flyway crea las tablas PostgreSQL y la aplicación crea los índices de MongoDB. La API escucha en `http://localhost:8080`.
6. En otra terminal, ejecutar `cd frontend`, `npm install` y `npm run dev`. En PowerShell con la ejecución de scripts restringida, usar `npm.cmd` en lugar de `npm`. Abrir `http://localhost:5173`. Vite envía las llamadas `/api` al backend local. Para compilar el frontend, usar `npm run build`.

### Datos de demostración

Con la API y las cuatro bases activas, ejecutar desde la raíz del proyecto:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\seed-demo.ps1
```

El script crea un cliente y un técnico de demostración, nueve estaciones en distintas zonas climáticas y más de 500 mediciones espaciadas cada tres horas durante la última semana. Sus temperaturas y humedades siguen ciclos diarios y rangos propios de cada ciudad; incluye un pico de calor en Madrid y una falla de estación en Nairobi para mostrar alertas. También crea procesos, solicitudes, informes, facturas, un pago y conversaciones. Las credenciales generadas se guardan en `demo-credentials.json`, archivo local ignorado por Git. El script deja un marcador en `demo-seed-state.json` para evitar duplicar datos; `-Force` genera otra tanda si se desea.

La sección **Acerca de** se puede abrir desde la pantalla de acceso o el menú. Explica qué hace React, TypeScript, Vite, Recharts y Spring Boot; cómo se reparten los datos entre PostgreSQL, Cassandra, MongoDB y Redis; y qué ocurre con ellos al reiniciar los servicios. Para recorrer la interfaz con Chrome o Edge en modo automático, ejecutar `cd frontend` y `npm run test:ui` después de cargar los datos de demostración.

### Usuarios y roles

El registro público crea cuentas con el rol **Usuario**. Esto evita que cualquiera se otorgue acceso técnico o administrativo. El primer administrador se crea con `BOOTSTRAP_ADMIN_EMAIL` y `BOOTSTRAP_ADMIN_PASSWORD` de `.env` al iniciar el backend. Después, ese administrador puede entrar en **Usuarios**, buscar una cuenta registrada y cambiar su rol a **Técnico** o **Administrador**. Cada cuenta tiene un solo rol; al cambiarlo se cierran sus sesiones abiertas y deberá ingresar de nuevo. El rol se obtiene de la cuenta al iniciar sesión, sin elegirlo en el formulario. Las cuentas con rol Administrador no pueden solicitar informes. La migración V2 conserva el rol de mayor acceso en cuentas existentes con varios roles: Administrador, Técnico y luego Usuario.

Con la API activa, `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\smoke.ps1` recorre registro, sesión, sensor, medición, informe, factura, pago, mensaje y alerta usando datos de prueba. El script lee la contraseña administrativa de `.env`, crea registros con identificadores únicos y no borra esos datos.

En Windows, Docker Desktop debe estar iniciado. Cassandra suele tardar más que los demás servicios. Si se cambia la contraseña de una base después de crear los volúmenes, hay que actualizar la credencial almacenada en esa base o crear volúmenes nuevos deliberadamente. Para configurar un MongoDB remoto, definir `MONGO_URI` en `.env` (escapar caracteres especiales de la contraseña en la URI). Los servicios de Compose se publican solo en `127.0.0.1`.
PostgreSQL usa el puerto local `15432`, configurable con `POSTGRES_PORT` y `JDBC_URL`. El administrador de `.env` se crea al iniciar por primera vez; cambiar después `BOOTSTRAP_ADMIN_PASSWORD` no modifica la contraseña ya guardada.

## Modelo físico y criterio de elección

| Almacén | Estructura física | Uso y motivo | Costo o límite |
|---|---|---|---|
| PostgreSQL | `users`, `roles`, `user_roles`, `sessions`, `sensors`, `sensor_credentials`, `sensor_controls`, `processes`, `process_roles`, `process_requests`, `executions`, `invoices`, `invoice_items`, `payments`, `current_accounts`, `account_movements`, `message_groups`, `group_members`. Claves UUID, foráneas, restricciones e índices en [V1__schema.sql](src/main/resources/db/migration/V1__schema.sql); rol único por cuenta en [V2__single_user_role.sql](src/main/resources/db/migration/V2__single_user_role.sql). | Identidad, permisos, catálogo, auditoría, facturación y saldos necesitan integridad referencial y transacciones. | Las series temporales grandes y los documentos cambiantes no son su carga principal aquí. |
| Cassandra | `clima.measurements_by_scope_month`, clave de partición `(scope_type,scope_key,bucket_month)` y orden por `measured_at DESC,sensor_id,measurement_id`. Definición en [cassandra.cql](db/cassandra.cql). Una medición se escribe tres veces: ciudad, zona y país. La clave de ciudad es `país/zona/ciudad` y la de zona `país/zona`. | Permite escrituras frecuentes y consultas de series por localización y mes sin filtrado global. | Denormalización, consistencia eventual y consultas limitadas a localización más rango temporal. Esta versión limita consultas a 24 meses y 10 000 mediciones; para mayor volumen hacen falta tablas de agregados y paginación. |
| MongoDB | Colecciones `alerts` (`type,sensorId,measurementId,status,createdAt,description`), `reports` (`requestId,executionId,userId,parameters,result,createdAt`) y `messages` (`type,senderId,recipientId/groupId,content,createdAt`). Índices declarados en `MonitoringConfig`. | Informes y mensajes tienen contenido variable; alertas requieren búsquedas flexibles. | No hay claves foráneas con PostgreSQL; los IDs y permisos se comprueban en la aplicación. |
| Redis | Claves `session:<sha256(token)>` con valor `sessionId:userId:role` y TTL de 12 horas. | Validación rápida y vencimiento automático de sesiones. La tabla SQL conserva el historial y el cierre. | Si Redis se vacía, las sesiones dejan de funcionar y hay que iniciar sesión de nuevo. |

Las facturas y pagos se cierran en una transacción SQL. La generación de un informe cruza Cassandra, MongoDB y PostgreSQL y por ello no es atómica entre bases; si la etapa SQL falla se elimina el informe recién generado y la ejecución queda `FAILED`. Para producción conviene agregar una cola, reintentos idempotentes y reconciliación de documentos huérfanos. `invoice_items.execution_id` es único para evitar doble facturación.

## API principal

Todas las rutas empiezan por `/api`. Salvo `POST /auth/register` y `POST /auth/login`, requieren `Authorization: Bearer <token>`. El rol de la sesión se toma del único rol asignado a la cuenta.

| Ruta | Acción | Acceso |
|---|---|---|
| `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/sessions` | Alta, inicio, cierre e historial de sesiones | Público para alta e inicio; usuario autenticado para el resto |
| `GET /users/me`, `GET /users/directory`, `GET /users`, `POST /users/{id}/roles`, `PATCH /users/{id}/active?value=false` | Perfil, directorio de contactos y cambio de rol único | Perfil y directorio autenticados; administración solo ADMIN |
| `POST /sensors`, `GET /sensors`, `POST /sensors/{id}/key`, `POST /sensors/{id}/controls`, `GET /sensors/{id}/controls` | Sensores, clave de dispositivo y controles | Lectura autenticada; escritura TECHNICIAN o ADMIN |
| `POST /measurements/sensors/{sensorId}`, `POST /measurements/sensors/{sensorId}/ingest`, `GET /measurements?scopeType=CITY&scopeKey=...&from=...&to=...` | Ingesta y consulta | Ingesta manual TECHNICIAN o ADMIN; ingesta de dispositivo con `X-Sensor-Key`; consulta autenticada |
| `POST /processes`, `GET /processes`, `POST /processes/{id}/requests`, `GET /processes/requests`, `GET /processes/admin/requests` | Catálogo y solicitudes | Alta ADMIN; solicitudes según `allowedRoles`, excepto cuentas con ADMIN; listado global para TECHNICIAN o ADMIN |
| `POST /processes/requests/{id}/execute`, `POST /processes/requests/{id}/retry`, `GET /processes/requests/{id}/executions`, `GET /processes/reports/{id}` | Ejecución, reintento, historial e informe | Ejecutar o reintentar TECHNICIAN o ADMIN; historial e informe propios o accesibles al personal |
| `POST /billing/account`, `GET /billing/account`, `GET /billing/account/movements`, `GET /billing/invoices`, `GET /billing/invoices/{id}/items`, `GET /billing/invoices/{id}/payments` | Cuenta corriente, facturas y pagos | Usuario propietario |
| `GET /billing/admin/invoices`, `POST /billing/invoices/{id}/payments` | Vista global de facturas y registro de pago verificado externamente | ADMIN |
| `POST /messages/private`, `GET /messages/private/{otherId}`, `POST /messages/groups/{id}`, `GET /messages/groups/{id}` | Mensajería | Usuario; grupos exigen membresía |
| `POST /messages/groups`, `POST /messages/groups/{id}/members/{userId}`, `GET /messages/groups` | Grupos | Alta y membresía ADMIN; listado propio |
| `GET /alerts`, `POST /alerts/{id}/resolve` | Alertas | TECHNICIAN o ADMIN |

Una solicitud de informe entra en estado `PENDING`. Un técnico o administrador la atiende con **Ejecutar**, que genera el informe y emite la factura; si falla, puede usar **Reintentar**. No existe una aprobación o rechazo separado. Los procesos periódicos se ejecutan automáticamente al llegar su siguiente fecha.

### Formatos clave

Registrar usuario: `{"fullName":"Ana Pérez","email":"ana@example.com","password":"contraseña-larga"}`. Iniciar sesión: `{"email":"ana@example.com","password":"contraseña-larga"}`. Cambiar el rol: `POST /users/{id}/roles` con `{"role":"TECHNICIAN"}`; reemplaza el rol anterior.

Crear un proceso: `{"name":"Promedios","description":"Promedios mensuales","type":"AVERAGE","price":10.00,"allowedRoles":["USER","TECHNICIAN"]}`. Tipos: `MIN_MAX`, `AVERAGE`, `THRESHOLD`, `RAW`, `PERIODIC_AVERAGE`.

Solicitarlo: `{"scopeType":"CITY","scopeKey":"Argentina/Buenos Aires/Buenos Aires","from":"2026-01-01T00:00:00Z","to":"2026-02-01T00:00:00Z","granularity":"DAY"}`. Para `ZONE`, usar `país/zona`; para `COUNTRY`, solo `país`. La granularidad puede ser `DAY`, `MONTH` o `YEAR`. Para `THRESHOLD` se indican límites `minTemperature`, `maxTemperature`, `minHumidity`, `maxHumidity`; el informe muestra valores fuera de ellos. `PERIODIC_AVERAGE` exige `repeatHours` y usa una ventana móvil del mismo tamaño que `from` a `to`. El planificador comprueba vencimientos cada minuto.

Ingestar una medición: `{"measurementId":"550e8400-e29b-41d4-a716-446655440000","measuredAt":"2026-01-15T12:00:00Z","temperature":22.5,"humidity":61.2}`. `measurementId` es opcional y permite repetir la escritura Cassandra con la misma clave en caso de reintento. Al crear un sensor se devuelve `sensorKey` una sola vez; para renovarla se usa `POST /sensors/{id}/key`. El dispositivo envía esa clave en `X-Sensor-Key` a la ruta `/ingest`. El tipo del sensor determina qué campos admite. La consulta en línea y los informes leen Cassandra. Los umbrales configurados en el sensor producen alertas climáticas; un sensor sin reportar durante una hora produce una alerta de funcionamiento. El control técnico permite marcarlo activo, inactivo o en falla.

La cuenta corriente es opcional. Abrirla incorpora el saldo pendiente previo. La factura de cada ejecución guarda el precio al ejecutarla y vence en 30 días. El endpoint de pagos **registra un pago que un administrador ya verificó por fuera**; todavía no existe una pasarela de cobro.

## Seguridad y límites de esta etapa

Las contraseñas se guardan con BCrypt y las nuevas contraseñas se limitan a 72 bytes UTF-8 para evitar el truncamiento de BCrypt. Los tokens son aleatorios y en Redis solo se guarda su hash como clave. Las claves de sensores también se guardan solo como hash SHA-256. Cada petición autenticada comprueba en PostgreSQL que la cuenta esté activa, que la sesión siga abierta y que el rol coincida con el guardado en Redis. La interfaz pública no devuelve hashes de contraseñas. Las credenciales locales están fuera de Git.

Redis limita el registro a 10 intentos por IP y hora, el inicio de sesión a 100 por IP y 20 por correo cada 15 minutos, la ingesta de sensores a 300 por IP y 120 por sensor cada minuto, y las solicitudes de informes a 30 por usuario y hora. Un límite temprano de 200 peticiones por IP y 15 minutos cubre también las solicitudes de acceso con JSON inválido. Si Redis falla, estos endpoints devuelven 503 para no perder el límite. Se usa la IP de la conexión; al instalar un proxy, este debe aplicar límites propios y reenviar la IP real solo desde una fuente confiable. Las peticiones con `Content-Length` superior a 1 MiB reciben 413; las peticiones de transferencia fragmentada requieren también un límite en el proxy. Las respuestas de la API incluyen encabezados de seguridad y no se almacenan en caché. Los eventos de acceso, cambios de rol, pagos y fallas programadas se registran sin contraseñas ni tokens.

