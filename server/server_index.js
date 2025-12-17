// server_index.js - VERSIÓN COMPLETA CON SISTEMA SIMPLE POR SSID/WIFI
const express = require("express");
const { createClient } = require("@supabase/supabase-js");

// ✅ CORRECTO - Usa variables de entorno
const SUPABASE_URL = process.env.SUPABASE_URL || "https://rrqxllucpihrcxeaossl.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Inicializar Supabase
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const app = express();
const PORT = process.env.PORT || 3000;

// Tiempo de espera para considerar OFFLINE (5 segundos)
const ONLINE_TIMEOUT_MS = 5000;

// 🔥 ESTRUCTURA MEJORADA CON SSID
const onlineDevices = {}; // { deviceId: { lastSeen, lastPower, energy, lastTs, wifiSsid, networkCode, ... } }

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

// 🔥 FUNCIÓN: Generar código de red simple
const generateNetworkCode = (ssid) => {
  if (!ssid || typeof ssid !== 'string') return null;
  
  // Toma las primeras 4 letras del SSID (sin espacios)
  const cleanSsid = ssid.replace(/\s+/g, '');
  const prefix = cleanSsid.substring(0, Math.min(4, cleanSsid.length)).toUpperCase();
  
  // Si el SSID es muy corto, usa "WIFI"
  const finalPrefix = prefix || 'WIFI';
  const randomNum = Math.floor(1000 + Math.random() * 9000);
  
  return `${finalPrefix}${randomNum}`; // Ej: "CASA5678"
};

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

// 🔥 NUEVA FUNCIÓN: Inicializar dispositivo con SSID
const initializeDeviceState = (deviceId, deviceInDb, wifiSsid = null) => {
  if (!onlineDevices[deviceId]) {
    const networkCode = wifiSsid ? generateNetworkCode(wifiSsid) : null;
    
    onlineDevices[deviceId] = {
      lastSeen: Date.now(),
      lastTs: Date.now(),
      lastPower: 0,
      energy: deviceInDb?.energy || 0,
      userId: deviceInDb?.user_id,
      deviceDbId: deviceInDb?.id,
      wifiSsid: wifiSsid || deviceInDb?.wifi_ssid,
      networkCode: networkCode || deviceInDb?.network_code,
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
  
  // Actualizar SSID si es nuevo
  if (wifiSsid && !onlineDevices[deviceId].wifiSsid) {
    onlineDevices[deviceId].wifiSsid = wifiSsid;
    onlineDevices[deviceId].networkCode = generateNetworkCode(wifiSsid);
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

// 🔥 NUEVA: Buscar dispositivos por SSID
async function findDevicesByWifiSsid(wifiSsid) {
  try {
    if (!wifiSsid || typeof wifiSsid !== "string") {
      return [];
    }

    const { data, error } = await supabase
      .from("devices")
      .select("*")
      .eq("wifi_ssid", wifiSsid.trim());

    if (error) {
      console.warn("⚠️ findDevicesByWifiSsid error:", error.message);
      return [];
    }

    return data || [];
  } catch (e) {
    console.warn("⚠️ findDevicesByWifiSsid exception:", e.message);
    return [];
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

// ====== ENDPOINTS MEJORADOS CON SSID ======

// 📍 ENDPOINT: Recibir datos de ESP32 - CON SSID
app.post("/api/data", async (req, res) => {
  try {
    const {
      deviceId,
      wifiSsid,  // 🔥 NUEVO: Recibir el SSID del ESP32
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

    // 🔥 INICIALIZAR O ACTUALIZAR ESTADO DEL DISPOSITIVO CON SSID
    const deviceState = initializeDeviceState(deviceId, deviceInDb, wifiSsid);

    // 🔥 CÁLCULO PRECISO DE ENERGÍA ACUMULADA
    const finalEnergy = calculateEnergyAccumulated(
      deviceState,
      data.power,
      now
    );

    // 🔥 ACTUALIZAR CACHE EN MEMORIA
    onlineDevices[deviceId] = {
      ...deviceState,
      lastSeen: now,
      lastTs: now,
      lastPower: data.power,
      energy: finalEnergy,
      userId: userId,
      deviceDbId: deviceDbId,
      wifiSsid: wifiSsid || deviceState.wifiSsid,
      totalCalculations: (deviceState.totalCalculations || 0) + 1,
      lastData: {
        voltage: data.voltage,
        current: data.current,
        frequency: data.frequency,
        powerFactor: data.powerFactor,
      },
    };

    // 🔥 SI ESTÁ REGISTRADO, ACTUALIZAR EN SUPABASE CON SSID
    if (isRegistered && deviceDbId) {
      const updates = {
        is_online: true,
        last_seen: new Date().toISOString(),
        power: data.power,
        energy: finalEnergy,
        voltage: data.voltage,
        current: data.current,
        frequency: data.frequency,
        power_factor: data.powerFactor,
        total_energy: finalEnergy,
      };
      
      // 🔥 ACTUALIZAR SSID si es diferente
      if (wifiSsid && wifiSsid !== deviceInDb.wifi_ssid) {
        updates.wifi_ssid = wifiSsid;
        updates.network_code = generateNetworkCode(wifiSsid);
      }
      
      await updateDeviceInSupabase(deviceDbId, updates);
    }

    // 🔥 LOG MEJORADO CON SSID
    console.log(
      `[DATA] ${deviceId} → ` +
      `WiFi: "${wifiSsid || 'No SSID'}" | ` +
      `V:${data.voltage.toFixed(1)}V  I:${data.current.toFixed(3)}A  ` +
      `P:${data.power.toFixed(1)}W  E:${finalEnergy.toFixed(6)}kWh  ` +
      `| ${isRegistered ? "✅ REGISTRADO" : "⚠️ NO REGISTRADO"}`
    );

    res.json({
      ok: true,
      registered: isRegistered,
      calculatedEnergy: finalEnergy,
      wifiSsid: wifiSsid,
      timestamp: now,
    });
  } catch (e) {
    console.error("💥 /api/data", e.message);
    res.status(500).json({ error: e.message });
  }
});

// 📍 ENDPOINT: Buscar dispositivos por nombre de WiFi (SISTEMA SIMPLE)
app.get("/api/devices-by-wifi", async (req, res) => {
  try {
    const { wifiName } = req.query;
    
    if (!wifiName) {
      return res.status(400).json({ 
        success: false, 
        error: "Por favor, escribe el nombre de tu WiFi" 
      });
    }

    const cleanWifiName = wifiName.trim();
    
    console.log(`🔍 [WIFI-SEARCH] Buscando dispositivos en WiFi: "${cleanWifiName}"`);

    // 🔥 Buscar en dispositivos registrados en Supabase
    const registeredDevices = await findDevicesByWifiSsid(cleanWifiName);

    // 🔥 Buscar dispositivos NO registrados que estén en ese WiFi (en cache)
    const now = Date.now();
    const unregisteredDevices = Object.entries(onlineDevices)
      .filter(([deviceId, state]) => {
        return (
          now - state.lastSeen < ONLINE_TIMEOUT_MS &&
          state.wifiSsid === cleanWifiName &&
          !state.userId // Solo no registrados
        );
      })
      .map(([deviceId, state]) => ({
        deviceId: deviceId,
        esp32_id: deviceId,
        name: `Dispositivo ${deviceId.substring(0, 8)}`,
        is_online: true,
        wifi_ssid: state.wifiSsid,
        network_code: state.networkCode,
        is_temporary: true, // Indica que no está registrado aún
        power: state.lastPower || 0,
        voltage: state.lastData?.voltage || 0,
        current: state.lastData?.current || 0,
        energy: state.energy || 0,
        status: "online",
        last_seen: new Date(state.lastSeen).toISOString(),
      }));

    // Combinar resultados
    const allDevices = [
      ...registeredDevices.map(device => ({
        ...device,
        is_temporary: false,
        status: device.is_online ? "online" : "offline"
      })),
      ...unregisteredDevices
    ];

    console.log(`✅ [WIFI-SEARCH] "${cleanWifiName}" → ${allDevices.length} dispositivos encontrados`);
    
    res.json({
      success: true,
      wifiName: cleanWifiName,
      devices: allDevices,
      count: allDevices.length,
      message: allDevices.length === 0 
        ? "No hay dispositivos conectados a este WiFi. Verifica el nombre."
        : `Encontré ${allDevices.length} dispositivo(s)`
    });

  } catch (e) {
    console.error("💥 /api/devices-by-wifi", e.message);
    res.status(500).json({ 
      success: false, 
      error: "Error buscando dispositivos" 
    });
  }
});

// 📍 ENDPOINT: Registrar dispositivo simple por SSID (SIN LOGIN)
app.post("/api/register-simple", async (req, res) => {
  try {
    const { deviceId, deviceName, wifiSsid } = req.body;

    if (!deviceId || !wifiSsid) {
      return res.status(400).json({ 
        success: false,
        error: "Necesito: deviceId y nombre de WiFi" 
      });
    }

    // Generar código de red automático
    const networkCode = generateNetworkCode(wifiSsid);
    
    // Crear usuario automático basado en el WiFi
    const autoUserId = `user_${networkCode}`;

    // Verificar si el dispositivo ya existe
    const existingDevice = await findDeviceByEsp32Id(deviceId);
    
    if (existingDevice) {
      // Actualizar dispositivo existente
      await updateDeviceInSupabase(existingDevice.id, {
        name: deviceName || existingDevice.name,
        wifi_ssid: wifiSsid,
        network_code: networkCode,
        user_id: autoUserId,
        is_online: true,
        last_seen: new Date().toISOString(),
      });
      
      // Actualizar cache
      if (onlineDevices[deviceId]) {
        onlineDevices[deviceId].userId = autoUserId;
        onlineDevices[deviceId].deviceDbId = existingDevice.id;
        onlineDevices[deviceId].wifiSsid = wifiSsid;
        onlineDevices[deviceId].networkCode = networkCode;
      }
      
      console.log(`✅ [SIMPLE-REG] ${deviceId} actualizado en WiFi "${wifiSsid}"`);
      
      return res.json({
        success: true,
        device: existingDevice,
        networkCode: networkCode,
        message: "¡Dispositivo actualizado!",
        instructions: `Usa el código ${networkCode} para ver tus dispositivos desde cualquier lugar`
      });
    }

    // Crear nuevo dispositivo
    const newDeviceData = {
      esp32_id: deviceId,
      name: deviceName || `Dispositivo ${deviceId.substring(0, 8)}`,
      wifi_ssid: wifiSsid,
      network_code: networkCode,
      user_id: autoUserId,
      power: onlineDevices[deviceId]?.lastPower || 0,
      energy: onlineDevices[deviceId]?.energy || 0,
      is_online: true,
      voltage: onlineDevices[deviceId]?.lastData?.voltage || 0,
      current: onlineDevices[deviceId]?.lastData?.current || 0,
      frequency: onlineDevices[deviceId]?.lastData?.frequency || 0,
      power_factor: onlineDevices[deviceId]?.lastData?.powerFactor || 0,
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
        success: false,
        error: "Error creando dispositivo"
      });
    }

    // Actualizar cache
    if (onlineDevices[deviceId]) {
      onlineDevices[deviceId].userId = autoUserId;
      onlineDevices[deviceId].deviceDbId = createdDevice.id;
      onlineDevices[deviceId].wifiSsid = wifiSsid;
      onlineDevices[deviceId].networkCode = networkCode;
    }

    console.log(`✅ [SIMPLE-REG] Nuevo dispositivo ${deviceId} en WiFi "${wifiSsid}"`);

    res.json({
      success: true,
      device: createdDevice,
      networkCode: networkCode,
      message: "¡Listo! Dispositivo registrado",
      instructions: `Guarda este código: ${networkCode}. Lo necesitarás para ver tus dispositivos desde otros lugares.`
    });

  } catch (e) {
    console.error("💥 /api/register-simple", e.message);
    res.status(500).json({ 
      success: false, 
      error: e.message 
    });
  }
});

// 📍 ENDPOINT: Obtener dispositivos por código de red
app.get("/api/devices-by-code", async (req, res) => {
  try {
    const { networkCode } = req.query;
    
    if (!networkCode) {
      return res.status(400).json({ 
        success: false, 
        error: "Falta el código de red" 
      });
    }

    const { data: devices, error } = await supabase
      .from("devices")
      .select("*")
      .eq("network_code", networkCode.trim());

    if (error) {
      console.error("❌ Error buscando por código:", error.message);
      return res.status(500).json({ 
        success: false, 
        error: "Error en la búsqueda" 
      });
    }

    console.log(`🔑 [CODE-SEARCH] Código ${networkCode} → ${devices?.length || 0} dispositivos`);
    
    res.json({
      success: true,
      networkCode: networkCode,
      devices: devices || [],
      count: devices?.length || 0,
      message: devices?.length === 0 
        ? "No hay dispositivos con este código"
        : `Encontré ${devices.length} dispositivo(s)`
    });

  } catch (e) {
    console.error("💥 /api/devices-by-code", e.message);
    res.status(500).json({ 
      success: false, 
      error: "Error buscando por código" 
    });
  }
});

// 📍 ENDPOINT: Registrar dispositivo (original - mantenido por compatibilidad)
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
        success: false,
        error: "Faltan campos requeridos: deviceId, name, userId",
      });
    }

    // Validar que userId sea string
    if (typeof userId !== "string") {
      return res.status(400).json({
        success: false,
        error: "userId debe ser un string válido",
      });
    }

    // 🔥 CORRECCIÓN: Si NO tenemos artifactId, CREAR un nuevo dispositivo
    if (!artifactId) {
      console.log("🆕 [REGISTER] Creando nuevo dispositivo...");

      // Obtener SSID del dispositivo si está en cache
      const wifiSsid = onlineDevices[deviceId]?.wifiSsid;
      const networkCode = wifiSsid ? generateNetworkCode(wifiSsid) : null;

      const newDeviceData = {
        user_id: userId,
        name: name,
        esp32_id: deviceId,
        wifi_ssid: wifiSsid,
        network_code: networkCode,
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
          success: false,
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
        wifiSsid: wifiSsid,
        networkCode: networkCode,
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
      return res.status(500).json({ 
        success: false,
        error: error.message 
      });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({ 
        success: false,
        error: "Dispositivo no encontrado" 
      });
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
    res.status(500).json({ 
      success: false,
      error: e.message 
    });
  }
});

// 📍 ENDPOINT: Sincronizar datos
app.post("/api/sync", async (req, res) => {
  try {
    let { artifactId, esp32Id, userId } = req.body;
    if (!esp32Id) return res.status(400).json({ 
      success: false,
      error: "Falta esp32Id" 
    });

    const deviceInDb = await findDeviceByEsp32Id(esp32Id);
    if (!deviceInDb) {
      return res.status(400).json({ 
        success: false,
        error: "Dispositivo no encontrado en Supabase." 
      });
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
      return res.status(500).json({ 
        success: false,
        error: "Error actualizando en Supabase" 
      });
    }

    console.log(`🔄 Sincronizado ${esp32Id} -> artifact ${deviceInDb.id}`);
    res.json({ 
      success: true, 
      power, 
      energy 
    });
  } catch (e) {
    console.error("💥 /api/sync", e.message);
    res.status(500).json({ 
      success: false,
      error: e.message 
    });
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
        energy: state.energy || 0,
        wifiSsid: state.wifiSsid, // 🔥 NUEVO: Incluir SSID
        networkCode: state.networkCode, // 🔥 NUEVO: Incluir código
      }));

    res.json({
      success: true,
      devices: result,
      count: result.length
    });
  } catch (e) {
    console.error("💥 /api/unregistered", e.message);
    res.status(500).json({ 
      success: false,
      error: e.message 
    });
  }
});

// 📍 ENDPOINT: Datos en tiempo real - VERSIÓN MEJORADA CON SSID
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
      return res.status(500).json({ 
        success: false,
        error: error.message 
      });
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
        kWh: currentEnergy,
        Hz: isOnline
          ? onlineState.lastData?.frequency || 0
          : device.frequency || 0,
        PF: isOnline
          ? onlineState.lastData?.powerFactor || 0
          : device.power_factor || 0,
        wifiSsid: device.wifi_ssid, // 🔥 NUEVO
        networkCode: device.network_code, // 🔥 NUEVO
        status: isOnline ? "online" : "offline",
        timestamp: isOnline
          ? onlineState.lastSeen
          : new Date(device.last_seen || device.updated_at).getTime() || 0,
        calculationInfo: isOnline
          ? {
              totalCalculations: onlineState.totalCalculations,
              lastCalculation: new Date(onlineState.lastTs).toISOString(),
            }
          : null,
      };
    }

    res.json({
      success: true,
      data: out,
      count: Object.keys(out).length
    });
  } catch (e) {
    console.error("💥 /api/realtime-data", e.message);
    res.status(500).json({ 
      success: false,
      error: e.message 
    });
  }
});

// 📍 ENDPOINT: Desvincular dispositivo
app.post("/api/unregister", async (req, res) => {
  try {
    const { deviceId } = req.body;
    if (!deviceId) return res.status(400).json({ 
      success: false,
      error: "Falta deviceId" 
    });

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

    res.json({ 
      success: true, 
      message: "Dispositivo desvinculado" 
    });
  } catch (e) {
    console.error("💥 /api/unregister", e.message);
    res.status(500).json({ 
      success: false,
      error: e.message 
    });
  }
});

// 📍 ENDPOINT: Obtener todos los SSIDs disponibles
app.get("/api/available-wifis", async (req, res) => {
  try {
    const now = Date.now();
    
    // Obtener SSIDs únicos de dispositivos en cache
    const uniqueSsids = [...new Set(
      Object.values(onlineDevices)
        .filter(state => now - state.lastSeen < ONLINE_TIMEOUT_MS)
        .map(state => state.wifiSsid)
        .filter(Boolean)
    )];

    // Obtener SSIDs únicos de la base de datos
    const { data: dbDevices, error } = await supabase
      .from("devices")
      .select("wifi_ssid")
      .not("wifi_ssid", "is", null);

    if (!error && dbDevices) {
      dbDevices.forEach(device => {
        if (device.wifi_ssid && !uniqueSsids.includes(device.wifi_ssid)) {
          uniqueSsids.push(device.wifi_ssid);
        }
      });
    }

    console.log(`📶 [WIFI-LIST] ${uniqueSsids.length} SSIDs únicos encontrados`);
    
    res.json({
      success: true,
      wifis: uniqueSsids.sort(),
      count: uniqueSsids.length,
      message: uniqueSsids.length === 0 
        ? "No hay redes WiFi registradas"
        : "Redes WiFi disponibles"
    });

  } catch (e) {
    console.error("💥 /api/available-wifis", e.message);
    res.status(500).json({ 
      success: false,
      error: e.message 
    });
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

    // Estadísticas por SSID
    const ssidStats = {};
    Object.values(onlineDevices).forEach(state => {
      if (state.wifiSsid) {
        ssidStats[state.wifiSsid] = (ssidStats[state.wifiSsid] || 0) + 1;
      }
    });

    res.json({
      success: true,
      status: "healthy",
      supabase: "connected",
      onlineDevices: Object.keys(onlineDevices).length,
      byWifiSsid: ssidStats,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({
      success: false,
      status: "unhealthy",
      supabase: "disconnected",
      error: e.message,
    });
  }
});

// 📍 ENDPOINT: Raíz - Info del sistema
app.get("/", (req, res) => {
  res.json({
    service: "ESP32 Energy Monitor API",
    version: "2.0 - Sistema Simple por SSID",
    endpoints: {
      data: "POST /api/data - Recibir datos del ESP32",
      devicesByWifi: "GET /api/devices-by-wifi?wifiName=XXXX - Sistema simple",
      registerSimple: "POST /api/register-simple - Registrar sin login",
      devicesByCode: "GET /api/devices-by-code?networkCode=XXXX - Por código",
      availableWifis: "GET /api/available-wifis - Listar WiFi disponibles",
      health: "GET /api/health - Estado del servidor"
    },
    message: "Sistema simple: 'Dime tu nombre de WiFi y ves tus dispositivos'"
  });
});

// Iniciar la tarea periódica de limpieza de estado
const CLEANUP_INTERVAL_MS = 2000;
setInterval(cleanupOnlineStatus, CLEANUP_INTERVAL_MS);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
  console.log(`📡 Sistema SIMPLE por SSID/WIFI`);
  console.log(`🔗 Endpoints principales:`);
  console.log(`   GET  /api/devices-by-wifi?wifiName=TU_WIFI`);
  console.log(`   POST /api/register-simple (deviceId, deviceName, wifiSsid)`);
  console.log(`   GET  /api/devices-by-code?networkCode=XXXX`);
  console.log(`⏰ Cleanup interval: ${CLEANUP_INTERVAL_MS}ms`);
});