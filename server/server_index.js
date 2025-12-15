// server/server_index.js - VERSIÓN MEJORADA CON CÁLCULO PRECISO
const express = require("express");
const { createClient } = require("@supabase/supabase-js");

// 🔥 CONFIGURACIÓN SUPABASE CON TU SECRET KEY REAL
const SUPABASE_URL = "https://rrqxllucpihrcxeaossl.supabase.co";
const SUPABASE_SERVICE_KEY = "sb_secret_2f8kVfmJIe4GlUZ1WMyITQ_CBttbzsa";

// Inicializar Supabase
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const app = express();
const PORT = process.env.PORT || 3000;

// Tiempo de espera para considerar OFFLINE (5 segundos)
const ONLINE_TIMEOUT_MS = 5000;

// 🔥 ESTRUCTURA MEJORADA: Más datos para cálculo preciso
const onlineDevices = {}; // { deviceId: { lastSeen, lastPower, energy, lastTs, calculationData, ... } }

app.use(express.json());
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );
  res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, PUT, OPTIONS");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

// ====== FUNCIONES AUXILIARES MEJORADAS ======

// 🔥 FUNCIÓN MEJORADA: Cálculo de energía MUCHO más preciso
const calculateEnergyAccumulated = (prevState, currentPower, currentTime) => {
  if (!prevState || !prevState.lastTs || currentTime <= prevState.lastTs) {
    return prevState?.energy || 0;
  }

  const prevPower = prevState.lastPower || 0;
  const prevEnergy = prevState.energy || 0;

  // 🔥 CÁLCULO PRECISO: Tiempo en horas (con más decimales)
  const timeElapsedHours = (currentTime - prevState.lastTs) / 3600000; // ms a horas

  if (timeElapsedHours <= 0 || (prevPower === 0 && currentPower === 0)) {
    return prevEnergy;
  }

  // 🔥 MÉTODO TRAPEZOIDAL MEJORADO: Promedio de potencia × tiempo
  const averagePower = (prevPower + currentPower) / 2;

  // Energía en kWh = Potencia (kW) × Tiempo (horas)
  const energyIncrement = (averagePower / 1000) * timeElapsedHours;

  // 🔥 PRECISIÓN MEJORADA: Más decimales
  const newEnergy = prevEnergy + energyIncrement;

  console.log(
    `⚡ [CALC] ${prevEnergy.toFixed(6)} + ${energyIncrement.toFixed(
      8
    )} = ${newEnergy.toFixed(6)} kWh`
  );

  return newEnergy;
};

// 🔥 NUEVA FUNCIÓN: Inicializar dispositivo con estructura mejorada
const initializeDeviceState = (deviceId, deviceInDb) => {
  if (!onlineDevices[deviceId]) {
    onlineDevices[deviceId] = {
      lastSeen: Date.now(),
      lastTs: Date.now(),
      lastPower: 0,
      energy: deviceInDb?.energy || 0,
      userId: deviceInDb?.user_id,
      deviceDbId: deviceInDb?.id,
      totalCalculations: 0,
      lastData: {
        voltage: 0,
        current: 0,
        frequency: 0,
        powerFactor: 0,
      },
      // 🔥 NUEVO: Datos para cálculo continuo
      calculationData: {
        lastSavedEnergy: deviceInDb?.energy || 0,
        totalEnergyAccumulated: deviceInDb?.energy || 0,
        calculationInterval: null,
      },
    };
  }
  return onlineDevices[deviceId];
};

// 🔥 CORRECCIÓN MEJORADA: Buscar dispositivo por esp32_id en Supabase
async function findDeviceByEsp32Id(esp32Id) {
  try {
    if (!esp32Id || typeof esp32Id !== "string") {
      console.warn("⚠️ findDeviceByEsp32Id: esp32Id inválido", esp32Id);
      return null;
    }

    const { data, error } = await supabase
      .from("devices")
      .select("*")
      .eq("esp32_id", esp32Id.trim())
      .limit(1);

    if (error) {
      console.warn("⚠️ findDeviceByEsp32Id error:", error.message);
      return null;
    }

    if (!data || data.length === 0) {
      return null;
    }

    return data[0];
  } catch (e) {
    console.warn("⚠️ findDeviceByEsp32Id exception:", e.message);
    return null;
  }
}

// 🔥 CORRECCIÓN: Función para crear dispositivo
async function createDeviceInSupabase(deviceData) {
  try {
    const { data, error } = await supabase
      .from("devices")
      .insert([deviceData])
      .select()
      .single();

    if (error) {
      console.error("❌ Error creando dispositivo:", error.message);
      return null;
    }
    return data;
  } catch (e) {
    console.error("❌ Error en createDeviceInSupabase:", e.message);
    return null;
  }
}

// 🔥 ACTUALIZACIÓN MEJORADA: Más campos y precisión
async function updateDeviceInSupabase(deviceId, updates) {
  try {
    const { data, error } = await supabase
      .from("devices")
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq("id", deviceId)
      .select();

    if (error) {
      console.error("❌ Error actualizando dispositivo:", error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error("❌ Error en updateDeviceInSupabase:", e.message);
    return false;
  }
}

// ====== FUNCIONES DE MANTENIMIENTO ======
async function cleanupOnlineStatus() {
  const now = Date.now();

  for (const [deviceId, state] of Object.entries(onlineDevices)) {
    if (now - state.lastSeen >= ONLINE_TIMEOUT_MS) {
      let { userId, deviceDbId } = state;

      if (deviceDbId) {
        try {
          await updateDeviceInSupabase(deviceDbId, {
            is_online: false,
            last_seen: new Date().toISOString(),
          });
          console.log(
            `⚫ Device ${deviceId} marcado como OFFLINE en Supabase.`
          );
        } catch (e) {
          console.error(
            `Error actualizando offline status para ${deviceId}:`,
            e.message
          );
        }
      }

      if (now - state.lastSeen > 600000) {
        delete onlineDevices[deviceId];
        console.log(`❌ Device ${deviceId} eliminado de la cache en memoria.`);
      }
    }
  }
}

// ====== ENDPOINTS MEJORADOS ======

// 📍 ENDPOINT: Recibir datos de ESP32 - VERSIÓN MEJORADA
app.post("/api/data", async (req, res) => {
  try {
    const {
      deviceId,
      voltage,
      current,
      power,
      energy,
      frequency,
      powerFactor,
    } = req.body;

    if (!deviceId) return res.status(400).json({ error: "Falta deviceId." });

    const now = Date.now();

    const data = {
      voltage: +voltage || 0,
      current: +current || 0,
      power: +power || 0,
      energy: +energy || 0,
      frequency: +frequency || 0,
      powerFactor: +powerFactor || 0,
      timestamp: now,
    };

    // Buscar si el dispositivo está registrado en Supabase
    const deviceInDb = await findDeviceByEsp32Id(deviceId);
    const isRegistered = !!deviceInDb;
    const userId = deviceInDb?.user_id;
    const deviceDbId = deviceInDb?.id;

    // 🔥 INICIALIZAR O ACTUALIZAR ESTADO DEL DISPOSITIVO
    const deviceState = initializeDeviceState(deviceId, deviceInDb);

    // 🔥 CÁLCULO PRECISO DE ENERGÍA ACUMULADA
    const finalEnergy = calculateEnergyAccumulated(
      deviceState,
      data.power,
      now
    );

    // 🔥 ACTUALIZAR CACHE EN MEMORIA CON MÁS PRECISIÓN
    onlineDevices[deviceId] = {
      ...deviceState,
      lastSeen: now,
      lastTs: now,
      lastPower: data.power,
      energy: finalEnergy,
      userId: userId,
      deviceDbId: deviceDbId,
      totalCalculations: (deviceState.totalCalculations || 0) + 1,
      lastData: {
        voltage: data.voltage,
        current: data.current,
        frequency: data.frequency,
        powerFactor: data.powerFactor,
      },
    };

    // 🔥 SI ESTÁ REGISTRADO, ACTUALIZAR EN SUPABASE CON MÁS PRECISIÓN
    if (isRegistered && deviceDbId) {
      await updateDeviceInSupabase(deviceDbId, {
        is_online: true,
        last_seen: new Date().toISOString(),
        power: data.power,
        energy: finalEnergy, // 🔥 ENERGÍA CALCULADA PRECISAMENTE
        voltage: data.voltage,
        current: data.current,
        frequency: data.frequency,
        power_factor: data.powerFactor,
        // 🔥 NUEVO: Guardar energía total para consistencia
        total_energy: finalEnergy,
      });
    }

    // 🔥 LOG MEJORADO: Mostrar más decimales y información
    console.log(
      `[DATA] ${deviceId} → ` +
        `V:${data.voltage.toFixed(1)}V  I:${data.current.toFixed(
          3
        )}A  P:${data.power.toFixed(1)}W  ` +
        `E:${finalEnergy.toFixed(6)}kWh  F:${data.frequency.toFixed(
          1
        )}Hz  PF:${data.powerFactor.toFixed(2)} ` +
        `| ${isRegistered ? "✅ REGISTRADO" : "⚠️ NO REGISTRADO"}`
    );

    res.json({
      ok: true,
      registered: isRegistered,
      calculatedEnergy: finalEnergy,
      timestamp: now,
    });
  } catch (e) {
    console.error("💥 /api/data", e.message);
    res.status(500).json({ error: e.message });
  }
});

// 📍 ENDPOINT: Registrar dispositivo - VERSIÓN MEJORADA
app.post("/api/register", async (req, res) => {
  try {
    const { deviceId, name, userId, artifactId } = req.body;
    console.log("📝 [REGISTER] Datos recibidos:", {
      deviceId,
      name,
      userId,
      artifactId,
    });

    if (!deviceId || !name || !userId) {
      return res.status(400).json({
        error: "Faltan campos requeridos: deviceId, name, userId",
      });
    }

    // Validar que userId sea string
    if (typeof userId !== "string") {
      return res.status(400).json({
        error: "userId debe ser un string válido",
      });
    }

    // 🔥 CORRECCIÓN: Si NO tenemos artifactId, CREAR un nuevo dispositivo
    if (!artifactId) {
      console.log("🆕 [REGISTER] Creando nuevo dispositivo...");

      const newDeviceData = {
        user_id: userId,
        name: name,
        esp32_id: deviceId,
        power: 0,
        energy: 0,
        is_online: true,
        voltage: 0,
        current: 0,
        frequency: 0,
        power_factor: 0,
        daily_consumption: 0,
        monthly_consumption: 0,
        total_consumption: 0,
        last_reset_date: new Date().toDateString(),
        monthly_reset_date: new Date().getMonth(),
        energy_at_day_start: 0,
        energy_at_month_start: 0,
        total_energy: 0,
      };

      const createdDevice = await createDeviceInSupabase(newDeviceData);

      if (!createdDevice) {
        return res.status(500).json({
          error: "Error creando dispositivo en Supabase",
        });
      }

      console.log(
        `✅ [REGISTER] Nuevo dispositivo creado: ${createdDevice.id}`
      );

      // Actualizar cache en memoria
      onlineDevices[deviceId] = {
        ...onlineDevices[deviceId],
        userId: userId,
        deviceDbId: createdDevice.id,
      };

      return res.json({
        success: true,
        device: createdDevice,
        message: "Dispositivo registrado exitosamente",
      });
    }

    // 🔥 Si tenemos artifactId, ACTUALIZAR el dispositivo existente
    console.log("🔄 [REGISTER] Actualizando dispositivo existente...");
    const { data, error } = await supabase
      .from("devices")
      .update({
        esp32_id: deviceId,
        name: name,
        is_online: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", artifactId)
      .eq("user_id", userId)
      .select();

    if (error) {
      console.error("❌ Error en registro:", error.message);
      return res.status(500).json({ error: error.message });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({ error: "Dispositivo no encontrado" });
    }

    console.log(
      `✅ [REGISTER] Dispositivo ${deviceId} registrado con artifact ${artifactId}`
    );

    // Actualizar cache en memoria
    onlineDevices[deviceId] = {
      ...onlineDevices[deviceId],
      userId: userId,
      deviceDbId: artifactId,
    };

    res.json({
      success: true,
      device: data[0],
      message: "Dispositivo vinculado exitosamente",
    });
  } catch (e) {
    console.error("💥 /api/register", e.message);
    res.status(500).json({ error: e.message });
  }
});

// 📍 ENDPOINT: Sincronizar datos
app.post("/api/sync", async (req, res) => {
  try {
    let { artifactId, esp32Id, userId } = req.body;
    if (!esp32Id) return res.status(400).json({ error: "Falta esp32Id" });

    const deviceInDb = await findDeviceByEsp32Id(esp32Id);
    if (!deviceInDb) {
      return res
        .status(400)
        .json({ error: "Dispositivo no encontrado en Supabase." });
    }

    const realTimeData = onlineDevices[esp32Id];
    let power = realTimeData?.lastPower || deviceInDb.power || 0;
    let energy = realTimeData?.energy || deviceInDb.energy || 0;

    const updateResult = await updateDeviceInSupabase(deviceInDb.id, {
      is_online: true,
      power: power,
      energy: energy,
      last_seen: new Date().toISOString(),
    });

    if (!updateResult) {
      return res.status(500).json({ error: "Error actualizando en Supabase" });
    }

    console.log(`🔄 Sincronizado ${esp32Id} -> artifact ${deviceInDb.id}`);
    res.json({ ok: true, power, energy });
  } catch (e) {
    console.error("💥 /api/sync", e.message);
    res.status(500).json({ error: e.message });
  }
});

// 📍 ENDPOINT: Obtener dispositivos no registrados
app.get("/api/unregistered", async (req, res) => {
  try {
    const now = Date.now();
    const result = Object.entries(onlineDevices)
      .filter(([id, state]) => {
        return now - state.lastSeen < ONLINE_TIMEOUT_MS && !state.userId;
      })
      .map(([id, state]) => ({
        deviceId: id,
        lastSeen: new Date(state.lastSeen),
        power: state.lastPower,
        voltage: state.lastData?.voltage || 0,
        current: state.lastData?.current || 0,
        energy: state.energy || 0, // 🔥 NUEVO: Incluir energía calculada
      }));

    res.json(result);
  } catch (e) {
    console.error("💥 /api/unregistered", e.message);
    res.status(500).json({ error: e.message });
  }
});

// 📍 ENDPOINT: Datos en tiempo real - VERSIÓN MEJORADA
app.get("/api/realtime-data", async (req, res) => {
  try {
    const now = Date.now();

    const { data: devices, error } = await supabase
      .from("devices")
      .select("*")
      .not("esp32_id", "is", null)
      .not("user_id", "is", null);

    if (error) {
      console.error("❌ Error obteniendo dispositivos:", error.message);
      return res.status(500).json({ error: error.message });
    }

    const out = {};

    for (const device of devices || []) {
      const esp32Id = device.esp32_id;
      const onlineState = onlineDevices[esp32Id];
      const isOnline =
        onlineState && now - onlineState.lastSeen < ONLINE_TIMEOUT_MS;

      // 🔥 USAR ENERGÍA CALCULADA EN TIEMPO REAL SI ESTÁ DISPONIBLE
      const currentEnergy = isOnline
        ? onlineState.energy || 0
        : device.energy || 0;

      out[device.id] = {
        deviceId: esp32Id,
        name: device.name,
        V: isOnline ? onlineState.lastData?.voltage || 0 : device.voltage || 0,
        I: isOnline ? onlineState.lastData?.current || 0 : device.current || 0,
        P: isOnline ? onlineState.lastPower || 0 : device.power || 0,
        kWh: currentEnergy, // 🔥 ENERGÍA CALCULADA PRECISAMENTE
        Hz: isOnline
          ? onlineState.lastData?.frequency || 0
          : device.frequency || 0,
        PF: isOnline
          ? onlineState.lastData?.powerFactor || 0
          : device.power_factor || 0,
        status: isOnline ? "online" : "offline",
        timestamp: isOnline
          ? onlineState.lastSeen
          : new Date(device.last_seen || device.updated_at).getTime() || 0,
        // 🔥 NUEVO: Información adicional de cálculo
        calculationInfo: isOnline
          ? {
              totalCalculations: onlineState.totalCalculations,
              lastCalculation: new Date(onlineState.lastTs).toISOString(),
            }
          : null,
      };
    }

    res.json(out);
  } catch (e) {
    console.error("💥 /api/realtime-data", e.message);
    res.status(500).json({ error: e.message });
  }
});

// 📍 ENDPOINT: Desvincular dispositivo
app.post("/api/unregister", async (req, res) => {
  try {
    const { deviceId } = req.body;
    if (!deviceId) return res.status(400).json({ error: "Falta deviceId" });

    const deviceInDb = await findDeviceByEsp32Id(deviceId);
    if (deviceInDb) {
      await updateDeviceInSupabase(deviceInDb.id, {
        esp32_id: null,
        is_online: false,
        updated_at: new Date().toISOString(),
      });
      console.log(`✅ Dispositivo ${deviceId} desvinculado`);
    }

    if (onlineDevices[deviceId]) {
      delete onlineDevices[deviceId];
    }

    res.json({ success: true, message: "Dispositivo desvinculado" });
  } catch (e) {
    console.error("💥 /api/unregister", e.message);
    res.status(500).json({ error: e.message });
  }
});

// 📍 ENDPOINT: Health check mejorado
app.get("/api/health", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("devices")
      .select("count")
      .limit(1);

    if (error) throw error;

    // 🔥 INFORMACIÓN ADICIONAL SOBRE CÁLCULOS
    const deviceStats = Object.entries(onlineDevices).map(([id, state]) => ({
      deviceId: id,
      energy: state.energy,
      calculations: state.totalCalculations,
      lastSeen: new Date(state.lastSeen).toISOString(),
    }));

    res.json({
      status: "healthy",
      supabase: "connected",
      onlineDevices: Object.keys(onlineDevices).length,
      deviceStats: deviceStats,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({
      status: "unhealthy",
      supabase: "disconnected",
      error: e.message,
    });
  }
});

// Iniciar la tarea periódica de limpieza de estado
const CLEANUP_INTERVAL_MS = 2000;
setInterval(cleanupOnlineStatus, CLEANUP_INTERVAL_MS);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor Supabase MEJORADO corriendo en puerto ${PORT}`);
  console.log(`📊 Supabase URL: ${SUPABASE_URL}`);
  console.log(`🔑 API Key configurada correctamente`);
  console.log(`⏰ Cleanup interval: ${CLEANUP_INTERVAL_MS}ms`);
  
});
