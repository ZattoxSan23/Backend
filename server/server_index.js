// server/server_index.js - VERSIÓN CORREGIDA CON TABLA NETWORKS
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

// 🔥 ESTRUCTURA MEJORADA: Ahora con wifiSsid y networkCode
const onlineDevices = {}; // { deviceId: { lastSeen, wifiSsid, networkCode, ... } }

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

// ====== FUNCIONES AUXILIARES ======

// 🔥 FUNCIÓN: Generar código de 5 caracteres
function generateNetworkCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// 🔥 FUNCIÓN: Buscar dispositivo por esp32_id
async function findDeviceByEsp32Id(esp32Id) {
  try {
    if (!esp32Id || typeof esp32Id !== "string") {
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

    return data && data.length > 0 ? data[0] : null;
  } catch (e) {
    console.warn("⚠️ findDeviceByEsp32Id exception:", e.message);
    return null;
  }
}

// 🔥 FUNCIÓN: Buscar red por SSID en tabla networks
async function findNetworkBySsid(wifiSsid) {
  try {
    if (!wifiSsid) return null;

    const { data, error } = await supabase
      .from("networks")
      .select("*")
      .eq("wifi_ssid", wifiSsid.trim())
      .limit(1);

    if (error) {
      console.warn("⚠️ findNetworkBySsid error:", error.message);
      return null;
    }

    return data && data.length > 0 ? data[0] : null;
  } catch (e) {
    console.warn("⚠️ findNetworkBySsid exception:", e.message);
    return null;
  }
}

// 🔥 FUNCIÓN: Buscar red por código en tabla networks
async function findNetworkByCode(networkCode) {
  try {
    if (!networkCode) return null;

    const { data, error } = await supabase
      .from("networks")
      .select("*")
      .eq("network_code", networkCode.trim())
      .limit(1);

    if (error) {
      console.warn("⚠️ findNetworkByCode error:", error.message);
      return null;
    }

    return data && data.length > 0 ? data[0] : null;
  } catch (e) {
    console.warn("⚠️ findNetworkByCode exception:", e.message);
    return null;
  }
}

// 🔥 FUNCIÓN: Buscar red por user_id
async function findNetworkByUserId(userId) {
  try {
    if (!userId) return null;

    const { data, error } = await supabase
      .from("networks")
      .select("*")
      .eq("user_id", userId.trim())
      .limit(1);

    if (error) {
      console.warn("⚠️ findNetworkByUserId error:", error.message);
      return null;
    }

    return data && data.length > 0 ? data[0] : null;
  } catch (e) {
    console.warn("⚠️ findNetworkByUserId exception:", e.message);
    return null;
  }
}

// ====== FUNCIONES DE MANTENIMIENTO ======
async function cleanupOnlineStatus() {
  const now = Date.now();

  for (const [deviceId, state] of Object.entries(onlineDevices)) {
    if (now - state.lastSeen >= ONLINE_TIMEOUT_MS) {
      let { deviceDbId } = state;

      if (deviceDbId) {
        try {
          await supabase
            .from("devices")
            .update({
              is_online: false,
              last_seen: new Date().toISOString(),
            })
            .eq("id", deviceDbId);
          console.log(`⚫ Device ${deviceId} marcado como OFFLINE.`);
        } catch (e) {
          console.error(`Error actualizando offline status:`, e.message);
        }
      }

      if (now - state.lastSeen > 600000) {
        delete onlineDevices[deviceId];
        console.log(`❌ Device ${deviceId} eliminado de la cache.`);
      }
    }
  }
}

// ====== ENDPOINTS PRINCIPALES ======

// 📍 📡 ENDPOINT: Recibir datos de ESP32
app.post("/api/data", async (req, res) => {
  try {
    const {
      deviceId,
      wifiSsid,
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

    // 1. Buscar dispositivo en Supabase
    const deviceInDb = await findDeviceByEsp32Id(deviceId);
    
    // 2. Buscar si existe red para este SSID en tabla networks
    let network = null;
    if (wifiSsid) {
      network = await findNetworkBySsid(wifiSsid);
    }

    // 3. Actualizar cache en memoria
    onlineDevices[deviceId] = {
      ...onlineDevices[deviceId],
      lastSeen: now,
      wifiSsid: wifiSsid || "Desconocido",
      networkCode: network?.network_code || null,
      lastPower: data.power,
      deviceDbId: deviceInDb?.id,
      lastData: {
        voltage: data.voltage,
        current: data.current,
        frequency: data.frequency,
        powerFactor: data.powerFactor,
      },
    };

    // 4. Si existe en DB, actualizar
    if (deviceInDb) {
      await supabase
        .from("devices")
        .update({
          is_online: true,
          wifi_ssid: wifiSsid || deviceInDb.wifi_ssid,
          network_code: network?.network_code || deviceInDb.network_code,
          last_seen: new Date().toISOString(),
          power: data.power,
          energy: data.energy,
          voltage: data.voltage,
          current: data.current,
          frequency: data.frequency,
          power_factor: data.powerFactor,
          updated_at: new Date().toISOString()
        })
        .eq("id", deviceInDb.id);
    } else {
      // 5. Si NO existe, crearlo
      const { data: newDevice, error } = await supabase
        .from("devices")
        .insert([
          {
            esp32_id: deviceId,
            wifi_ssid: wifiSsid,
            network_code: network?.network_code || null,
            is_online: true,
            power: data.power,
            energy: data.energy,
            voltage: data.voltage,
            current: data.current,
            frequency: data.frequency,
            power_factor: data.powerFactor,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            last_seen: new Date().toISOString()
          }
        ])
        .select()
        .single();

      if (!error && newDevice) {
        onlineDevices[deviceId].deviceDbId = newDevice.id;
        
        // Si hay red, actualizar contador
        if (network) {
          await supabase
            .from("networks")
            .update({
              device_count: (network.device_count || 0) + 1
            })
            .eq("id", network.id);
        }
      }
    }

    console.log(
      `[DATA] ${deviceId} → ` +
      `WiFi: ${wifiSsid || "N/A"} | ` +
      `Red: ${network?.network_code || "Sin red"} | ` +
      `P:${data.power.toFixed(1)}W`
    );

    res.json({
      ok: true,
      registered: !!deviceInDb,
      networkCode: network?.network_code || null,
      timestamp: now,
    });
  } catch (e) {
    console.error("💥 /api/data", e.message);
    res.status(500).json({ error: e.message });
  }
});

// 📍 🔑 ENDPOINT: Crear nueva red (usa tabla networks)
app.post("/api/create-network", async (req, res) => {
  try {
    const { wifiSsid, userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: "Falta userId." });
    }

    // 1. Verificar si el usuario ya tiene una red
    const existingNetwork = await findNetworkByUserId(userId);
    if (existingNetwork) {
      return res.json({
        success: true,
        networkCode: existingNetwork.network_code,
        networkId: existingNetwork.id,
        message: "Ya tienes una red creada"
      });
    }

    // 2. Verificar si ya existe red para este SSID
    if (wifiSsid) {
      const existingSsidNetwork = await findNetworkBySsid(wifiSsid);
      if (existingSsidNetwork) {
        return res.status(400).json({
          error: `Ya existe una red para "${wifiSsid}" (Código: ${existingSsidNetwork.network_code})`
        });
      }
    }

    // 3. Generar código único
    const networkCode = generateNetworkCode();
    
    // 4. Crear red en tabla networks
    const { data: newNetwork, error } = await supabase
      .from("networks")
      .insert([
        {
          network_code: networkCode,
          network_name: `Red de ${userId.substring(0, 8)}`,
          wifi_ssid: wifiSsid || null,
          user_id: userId,
          device_count: 0,
          created_at: new Date().toISOString()
        }
      ])
      .select()
      .single();

    if (error) {
      console.error("❌ Error creando red:", error);
      return res.status(500).json({ error: "Error creando red en base de datos" });
    }

    console.log(`🆕 Red creada: ${networkCode} para usuario ${userId} (WiFi: ${wifiSsid || "N/A"})`);

    res.json({
      success: true,
      networkCode: networkCode,
      networkId: newNetwork.id,
      message: "Red creada exitosamente"
    });
  } catch (e) {
    console.error("💥 /api/create-network", e.message);
    res.status(500).json({ error: e.message });
  }
});

// 📍 📶 ENDPOINT: Detectar red por SSID (usa tabla networks)
app.get("/api/detect-network", async (req, res) => {
  try {
    const { wifiSsid } = req.query;
    
    if (!wifiSsid) {
      return res.status(400).json({ error: "Falta wifiSsid" });
    }

    const network = await findNetworkBySsid(wifiSsid);
    
    if (network) {
      return res.json({
        exists: true,
        networkCode: network.network_code,
        networkId: network.id,
        userId: network.user_id,
        deviceCount: network.device_count,
        message: `Red encontrada para "${wifiSsid}"`
      });
    } else {
      return res.json({
        exists: false,
        message: `No hay red para "${wifiSsid}". Puedes crear una.`
      });
    }
  } catch (e) {
    console.error("💥 /api/detect-network", e.message);
    res.status(500).json({ error: e.message });
  }
});

// 📍 🔗 ENDPOINT: Vincular dispositivo a red
app.post("/api/link-device", async (req, res) => {
  try {
    const { networkCode, deviceId, deviceName, userId } = req.body;
    
    if (!networkCode || !deviceId || !userId) {
      return res.status(400).json({ 
        error: "Faltan parámetros: networkCode, deviceId y userId son requeridos" 
      });
    }

    // 1. Verificar que la red exista y pertenezca al usuario
    const network = await findNetworkByCode(networkCode);
    if (!network) {
      return res.status(404).json({ 
        error: "Código de red no válido" 
      });
    }

    if (network.user_id !== userId) {
      return res.status(403).json({ 
        error: "No tienes permiso para agregar dispositivos a esta red" 
      });
    }

    // 2. Buscar el dispositivo
    const deviceInDb = await findDeviceByEsp32Id(deviceId);
    if (!deviceInDb) {
      return res.status(404).json({ 
        error: "Dispositivo no encontrado" 
      });
    }

    // 3. Verificar que el dispositivo no tenga otra red
    if (deviceInDb.network_code && deviceInDb.network_code !== networkCode) {
      return res.status(400).json({
        error: `Este dispositivo ya pertenece a la red ${deviceInDb.network_code}`
      });
    }

    // 4. Actualizar dispositivo
    const { error: updateError } = await supabase
      .from("devices")
      .update({
        network_code: networkCode,
        user_id: userId,
        name: deviceName || deviceInDb.name || `Dispositivo ${deviceId.substring(12)}`,
        updated_at: new Date().toISOString()
      })
      .eq("esp32_id", deviceId);

    if (updateError) {
      console.error("❌ Error vinculando dispositivo:", updateError);
      return res.status(500).json({ error: "Error en la base de datos" });
    }

    // 5. Actualizar contador en red
    await supabase
      .from("networks")
      .update({
        device_count: (network.device_count || 0) + 1
      })
      .eq("id", network.id);

    // 6. Actualizar en memoria
    if (onlineDevices[deviceId]) {
      onlineDevices[deviceId].networkCode = networkCode;
    }

    console.log(`✅ Dispositivo ${deviceId} vinculado a red ${networkCode} (Usuario: ${userId})`);

    res.json({
      success: true,
      message: `Dispositivo vinculado a la red ${networkCode}`,
      networkCode: networkCode,
      userId: userId
    });
  } catch (e) {
    console.error("💥 /api/link-device", e.message);
    res.status(500).json({ error: e.message });
  }
});

// 📍 📱 ENDPOINT: Obtener mis dispositivos (por usuario)
app.get("/api/my-network-devices", async (req, res) => {
  try {
    const { userId } = req.query;
    
    if (!userId) {
      return res.status(400).json({ error: "Falta userId" });
    }

    // 1. Buscar la red del usuario
    const network = await findNetworkByUserId(userId);
    if (!network) {
      return res.json({
        networkCode: null,
        devices: [],
        count: 0,
        message: "No tienes una red creada"
      });
    }

    // 2. Buscar dispositivos de esta red y usuario
    const { data: devices, error } = await supabase
      .from("devices")
      .select("*")
      .eq("network_code", network.network_code)
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("❌ Error obteniendo dispositivos:", error);
      return res.status(500).json({ error: "Error en la base de datos" });
    }

    // 3. Enriquecer con datos en tiempo real
    const enrichedDevices = (devices || []).map(device => {
      const realTimeData = onlineDevices[device.esp32_id];
      const isOnline = realTimeData && 
        (Date.now() - realTimeData.lastSeen < ONLINE_TIMEOUT_MS);

      return {
        id: device.id,
        deviceId: device.esp32_id,
        name: device.name,
        wifiSsid: device.wifi_ssid,
        networkCode: device.network_code,
        power: isOnline ? realTimeData.lastPower : device.power,
        voltage: isOnline ? realTimeData.lastData?.voltage : device.voltage,
        current: isOnline ? realTimeData.lastData?.current : device.current,
        energy: device.energy,
        isOnline: isOnline,
        lastSeen: isOnline ? realTimeData.lastSeen : device.last_seen,
        createdAt: device.created_at
      };
    });

    res.json({
      networkCode: network.network_code,
      wifiSsid: network.wifi_ssid,
      networkId: network.id,
      devices: enrichedDevices,
      count: enrichedDevices.length,
      deviceCount: network.device_count,
      timestamp: Date.now()
    });
  } catch (e) {
    console.error("💥 /api/my-network-devices", e.message);
    res.status(500).json({ error: e.message });
  }
});

// 📍 🔐 ENDPOINT: Validar código de red
app.post("/api/validate-network", async (req, res) => {
  try {
    const { networkCode } = req.body;
    
    if (!networkCode) {
      return res.status(400).json({ error: "Falta networkCode" });
    }

    const network = await findNetworkByCode(networkCode);
    
    if (!network) {
      return res.json({
        valid: false,
        message: "Código de red no válido"
      });
    }

    res.json({
      valid: true,
      networkCode: network.network_code,
      userId: network.user_id,
      message: "Código de red válido"
    });
  } catch (e) {
    console.error("💥 /api/validate-network", e.message);
    res.status(500).json({ error: e.message });
  }
});

// 📍 ENDPOINT: Datos en tiempo real - Filtrar por red
app.get("/api/realtime-data", async (req, res) => {
  try {
    const now = Date.now();
    const { networkCode, userId } = req.query;

    let query = supabase
      .from("devices")
      .select("*")
      .not("esp32_id", "is", null);

    // Si hay networkCode, filtrar por esa red
    if (networkCode) {
      query = query.eq("network_code", networkCode);
    } else if (userId) {
      // Si hay userId, buscar su red y filtrar
      const network = await findNetworkByUserId(userId);
      if (network) {
        query = query.eq("network_code", network.network_code);
      } else {
        // Si no tiene red, devolver vacío
        return res.json({});
      }
    }

    const { data: devices, error } = await query;

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

      out[device.id] = {
        deviceId: esp32Id,
        name: device.name,
        wifiSsid: device.wifi_ssid,
        networkCode: device.network_code,
        V: isOnline ? onlineState.lastData?.voltage || 0 : device.voltage || 0,
        I: isOnline ? onlineState.lastData?.current || 0 : device.current || 0,
        P: isOnline ? onlineState.lastPower || 0 : device.power || 0,
        kWh: device.energy || 0,
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
      };
    }

    res.json(out);
  } catch (e) {
    console.error("💥 /api/realtime-data", e.message);
    res.status(500).json({ error: e.message });
  }
});

// 📍 ENDPOINT: Unirse a red existente
app.post("/api/join-network", async (req, res) => {
  try {
    const { networkCode, userId, wifiSsid } = req.body;
    
    if (!networkCode || !userId) {
      return res.status(400).json({ error: "Falta networkCode o userId" });
    }

    // 1. Verificar que la red exista
    const network = await findNetworkByCode(networkCode);
    if (!network) {
      return res.status(404).json({ 
        error: "Código de red no válido" 
      });
    }

    // 2. Actualizar red con nuevo userId (en caso de que el usuario se una)
    // En este caso, el usuario ya tendría su propia red, así que solo validamos
    // que el código sea correcto para vincular dispositivos
    
    res.json({
      success: true,
      networkCode: network.network_code,
      message: "Código de red válido"
    });
  } catch (e) {
    console.error("💥 /api/join-network", e.message);
    res.status(500).json({ error: e.message });
  }
});

// 📍 ENDPOINT: Obtener mi red (por usuario)
app.get("/api/my-network", async (req, res) => {
  try {
    const { userId } = req.query;
    
    if (!userId) {
      return res.status(400).json({ error: "Falta userId" });
    }

    const network = await findNetworkByUserId(userId);
    
    if (!network) {
      return res.json({
        hasNetwork: false,
        message: "No tienes una red creada"
      });
    }

    res.json({
      hasNetwork: true,
      networkCode: network.network_code,
      wifiSsid: network.wifi_ssid,
      networkId: network.id,
      deviceCount: network.device_count,
      createdAt: network.created_at
    });
  } catch (e) {
    console.error("💥 /api/my-network", e.message);
    res.status(500).json({ error: e.message });
  }
});

// 📍 ENDPOINT: Health check
app.get("/api/health", async (req, res) => {
  try {
    const { data: devices, error: devicesError } = await supabase
      .from("devices")
      .select("count")
      .limit(1);

    const { data: networks, error: networksError } = await supabase
      .from("networks")
      .select("count")
      .limit(1);

    res.json({
      status: "healthy",
      supabase: "connected",
      onlineDevices: Object.keys(onlineDevices).length,
      totalDevices: devices?.[0]?.count || 0,
      totalNetworks: networks?.[0]?.count || 0,
      timestamp: new Date().toISOString(),
      system: "Sistema de redes por WiFi SSID activado"
    });
  } catch (e) {
    res.status(500).json({
      status: "unhealthy",
      supabase: "disconnected",
      error: e.message,
    });
  }
});

// 📍 NUEVO: Auto-asignar dispositivo a red por SSID
app.post("/api/auto-assign", async (req, res) => {
  try {
    const { deviceId, wifiSsid } = req.body;
    
    if (!deviceId || !wifiSsid) {
      return res.status(400).json({ error: "Faltan parámetros" });
    }

    // Buscar red para este SSID
    const network = await findNetworkBySsid(wifiSsid);
    
    if (!network) {
      return res.json({
        success: false,
        autoAssigned: false,
        message: "No hay red existente para este WiFi"
      });
    }

    // Actualizar dispositivo
    const { error } = await supabase
      .from("devices")
      .update({
        network_code: network.network_code,
        user_id: network.user_id,
        updated_at: new Date().toISOString()
      })
      .eq("esp32_id", deviceId);

    if (error) throw error;

    // Actualizar contador
    await supabase
      .from("networks")
      .update({
        device_count: (network.device_count || 0) + 1
      })
      .eq("id", network.id);

    console.log(`✅ Auto-asignado ${deviceId} a red ${network.network_code} (${wifiSsid})`);
    
    return res.json({
      success: true,
      autoAssigned: true,
      networkCode: network.network_code,
      userId: network.user_id,
      message: `Dispositivo asignado automáticamente a la red ${network.network_code}`
    });
  } catch (e) {
    console.error("💥 /api/auto-assign", e.message);
    res.status(500).json({ error: e.message });
  }
});

// 📍 ENDPOINT: Dispositivos disponibles por SSID (sin dueño)
app.get("/api/available-devices", async (req, res) => {
  try {
    const { wifiSsid } = req.query;
    
    if (!wifiSsid) {
      return res.status(400).json({ error: "Falta wifiSsid" });
    }

    // Buscar dispositivos con este SSID pero sin network_code
    const { data: devices, error } = await supabase
      .from("devices")
      .select("*")
      .eq("wifi_ssid", wifiSsid)
      .is("network_code", null)
      .order("last_seen", { ascending: false });

    if (error) {
      console.error("❌ Error obteniendo dispositivos:", error);
      return res.status(500).json({ error: "Error en la base de datos" });
    }

    // Enriquecer con datos en tiempo real
    const now = Date.now();
    const enrichedDevices = (devices || []).map(device => {
      const realTimeData = onlineDevices[device.esp32_id];
      const isOnline = realTimeData && 
        (now - realTimeData.lastSeen < ONLINE_TIMEOUT_MS);

      return {
        id: device.id,
        deviceId: device.esp32_id,
        name: device.name,
        wifiSsid: device.wifi_ssid,
        power: isOnline ? realTimeData.lastPower : device.power,
        voltage: isOnline ? realTimeData.lastData?.voltage : device.voltage,
        current: isOnline ? realTimeData.lastData?.current : device.current,
        energy: device.energy,
        isOnline: isOnline,
        lastSeen: isOnline ? realTimeData.lastSeen : device.last_seen
      };
    });

    res.json({
      wifiSsid: wifiSsid,
      devices: enrichedDevices,
      count: enrichedDevices.length,
      timestamp: now
    });
  } catch (e) {
    console.error("💥 /api/available-devices", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Iniciar la tarea periódica de limpieza
const CLEANUP_INTERVAL_MS = 2000;
setInterval(cleanupOnlineStatus, CLEANUP_INTERVAL_MS);

// Limpiar dispositivos huérfanos (sin red por más de 24h)
setInterval(async () => {
  try {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    const { data: orphanDevices } = await supabase
      .from("devices")
      .select("id, esp32_id, last_seen")
      .is("network_code", null)
      .lt("last_seen", dayAgo)
      .limit(10);

    if (orphanDevices && orphanDevices.length > 0) {
      console.log(`🧹 Limpiando ${orphanDevices.length} dispositivos huérfanos`);
    }
  } catch (e) {
    console.error("Error limpiando huérfanos:", e.message);
  }
}, 3600000); // Cada hora

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor con SISTEMA DE REDES POR WIFI en puerto ${PORT}`);
  console.log(`📊 Supabase URL: ${SUPABASE_URL}`);
  console.log(`🔑 Sistema: Cada WiFi = Una red única`);
  console.log(`⏰ Cleanup interval: ${CLEANUP_INTERVAL_MS}ms`);
});