# Energy — servidor de telemetría

Servicio Express que recibe lecturas de dispositivos ESP32/PZEM, mantiene su estado en memoria y guarda lecturas e históricos en Supabase. Este repositorio contiene el backend; no incluye la interfaz ni el firmware.

## Ejecutar

Requiere Node.js con soporte para `node --test` (20 o superior).

```sh
npm install
# Configurar SUPABASE_URL y SUPABASE_SERVICE_KEY en el entorno del proceso
npm start
```

`.env.example` enumera las variables. El servidor no carga archivos `.env` automáticamente: configúralas en tu terminal o proveedor de hosting. `PORT` es opcional (3000 por defecto). Comprueba `GET /api/health`.

## Organización y lógica

- `server/server_index.js`: rutas, acceso a Supabase, agregaciones y tareas periódicas.
- `server/lib/peru-time.js`: conversión explícita a UTC-05:00, independiente de la zona del servidor.
- `test/peru-time.test.js`: regresiones de cambio de día, año y equivalencia de instantes.

La hora de Perú define el día de las consultas actuales. Los timestamps conservan el offset. El estado online vive en memoria y se pierde al reiniciar; no se debe asumir que se comparte entre réplicas.

## Contratos principales

| Ruta | Uso |
| --- | --- |
| `POST /api/data` | Recepción de lecturas del dispositivo |
| `GET /api/realtime-data` | Estado reciente |
| `GET /api/current-day-stats/:deviceId` | Resumen del día local |
| `GET /api/health` | Estado del servicio |

Revisa los handlers antes de integrar: el repositorio aún no contiene un OpenAPI ni migraciones para reconstruir el esquema de Supabase.

## Verificación

```sh
npm run check
npm test
```

Las pruebas de tiempo no requieren credenciales ni conexión. No validan las operaciones contra Supabase.

## Estado y trabajo pendiente

El servicio es un prototipo de integración. Las rutas de escritura, simulación, limpieza y administración no tienen un control de acceso uniforme. No debe exponerse con una clave de servicio a usuarios no confiables hasta incorporar autenticación y autorización por dispositivo.

Queda separar rutas, repositorios y tareas programadas; versionar el esquema de datos; probar reinicios de contadores, concurrencia y agregados semanales/mensuales; unificar los demás cálculos históricos de fecha; y reemplazar estado en memoria si se usan varias instancias. Las tarifas y recomendaciones actuales son estimaciones, no facturación.
