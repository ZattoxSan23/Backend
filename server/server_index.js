// server_index.js - VERSIÓN COMPLETA CON RECOLECCIÓN AUTOMÁTICA
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

// ====== CONFIGURACIÓN DE RECOLECCIÓN ======
const DATA_CONFIG = {
  saveEveryNReadings: 6,           // Guardar 1 de cada 6 lecturas (cada ~30s)
  keepRawDataDays: 2,              // Mantener lecturas_raw por 2 días
  dailySummaryHour: 23,            // Generar resumen a las 23:00
  dailySummaryMinute: 59,
  generateWeeklySummary: true,     // Generar resumen semanal
  generateMonthlySummary: true,    // Generar resumen mensual
};

// Contadores por dispositivo para controlar frecuencia
const deviceCounters = {};

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

// 🔥 FUNCIÓN CORREGIDA: Generar código de red de 5-8 caracteres
const generateNetworkCode = (ssid) => {
  if (!ssid || typeof ssid !== 'string') return "WIFI001";
  
  // Tomar primeras 4 letras del SSID (solo letras/números)
  const cleanSsid = ssid.replace(/\s+/g, '').replace(/[^a-zA-Z0-9]/g, '');
  let prefix = cleanSsid.substring(0, Math.min(4, cleanSsid.length)).toUpperCase();
  
  // Si es muy corto, completar con "W"
  while (prefix.length < 4) {
    prefix += "W";
  }
  
  // 🔥 CORRECCIÓN: Generar número de 3-4 dígitos para total de 7-8 caracteres
  const randomNum = Math.floor(100 + Math.random() * 9000); // 100-9999
  
  return `${prefix}${randomNum}`; // Ej: "SANT1234" (8 caracteres)
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
    console.log(`📝 [CREATE-DEVICE] Insertando:`, JSON.stringify(deviceData, null, 2));
    
    const { data, error } = await supabase
      .from("devices")
      .insert([deviceData])
      .select()
      .single();

    if (error) {
      console.error("❌ Error creando dispositivo:", error.message);
      console.error("❌ Detalles del error:", error);
      return null;
    }
    
    console.log(`✅ [CREATE-DEVICE] Dispositivo creado exitosamente`);
    return data;
  } catch (e) {
    console.error("❌ Error en createDeviceInSupabase:", e.message);
    console.error("❌ Stack trace:", e.stack);
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

// ====== FUNCIONES DE RECOLECCIÓN AUTOMÁTICA ======

// 📍 FUNCIÓN OPTIMIZADA: Guardar lectura con frecuencia controlada
async function saveToLecturasRawOptimized(deviceId, data, finalEnergy) {
  try {
    // 🔥 CONTROL DE FRECUENCIA: Solo guardar 1 de cada N lecturas
    if (!deviceCounters[deviceId]) {
      deviceCounters[deviceId] = 0;
    }
    
    deviceCounters[deviceId]++;
    
    if (deviceCounters[deviceId] % DATA_CONFIG.saveEveryNReadings !== 0) {
      // No guardar esta vez
      return false;
    }
    
    // Resetear contador si es muy grande
    if (deviceCounters[deviceId] > 1000) {
      deviceCounters[deviceId] = 0;
    }

    const { data: device, error } = await supabase
      .from("devices")
      .select("id")
      .eq("esp32_id", deviceId)
      .single();

    if (error || !device) {
      console.warn(`⚠️ [RAW-DATA] ${deviceId} no encontrado`);
      return false;
    }

    // 🔥 GUARDAR con campos optimizados
    const { error: insertError } = await supabase
      .from("lecturas_raw")
      .insert({
        device_id: deviceId,
        power: Math.round(data.power),      // SMALLINT
        energy: parseFloat(finalEnergy.toFixed(4)), // 4 decimales
        voltage: Math.round(data.voltage),  // SMALLINT
        current: parseFloat(data.current.toFixed(3)), // 3 decimales
        timestamp: new Date().toISOString()
      });

    if (insertError) {
      console.error(`❌ [RAW-DATA] ${deviceId}:`, insertError.message);
      return false;
    }

    // 🔥 LOG reducido (solo cada 10 inserciones)
    if (deviceCounters[deviceId] % (DATA_CONFIG.saveEveryNReadings * 10) === 0) {
      console.log(`💾 [RAW-DATA] ${deviceId}: Guardado (${deviceCounters[deviceId]} lecturas procesadas)`);
    }

    return true;
  } catch (e) {
    console.error(`💥 [RAW-DATA] ${deviceId}:`, e.message);
    return false;
  }
}

// 📍 FUNCIÓN MEJORADA: Generar resumen diario con estadísticas
async function generateDailySummaryOptimized() {
  try {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    
    console.log(`📊 [DAILY-SUMMARY] Generando para ${yesterdayStr}...`);
    
    // 🔥 Obtener dispositivos que tuvieron actividad ayer
    const { data: activeDevices, error } = await supabase
      .from("lecturas_raw")
      .select("device_id")
      .distinct()
      .gte("timestamp", `${yesterdayStr}T00:00:00`)
      .lt("timestamp", `${yesterdayStr}T23:59:59`);

    if (error || !activeDevices || activeDevices.length === 0) {
      console.log(`ℹ️ [DAILY-SUMMARY] No hay dispositivos con actividad ayer`);
      return;
    }

    console.log(`📊 [DAILY-SUMMARY] ${activeDevices.length} dispositivos con actividad`);

    let processed = 0;
    let errors = 0;

    // 🔥 Procesar en PARALELO (más rápido)
    const promises = activeDevices.map(async (item) => {
      try {
        const esp32Id = item.device_id;
        
        // 🔥 CONSULTA EFICIENTE: Todos los cálculos en una query
        const { data: stats, error: statsError } = await supabase
          .from("lecturas_raw")
          .select(`
            min(energy) as min_energy,
            max(energy) as max_energy,
            max(power) as max_power,
            avg(power) as avg_power,
            count(*) as total_readings
          `)
          .eq("device_id", esp32Id)
          .gte("timestamp", `${yesterdayStr}T00:00:00`)
          .lt("timestamp", `${yesterdayStr}T23:59:59`)
          .single();

        if (statsError || !stats) {
          console.warn(`⚠️ [DAILY-SUMMARY] ${esp32Id}: Sin datos suficientes`);
          return null;
        }

        const consumoKwh = (stats.max_energy - stats.min_energy);
        const potenciaPico = stats.max_power;
        const potenciaPromedio = stats.avg_power;
        const horasUso = consumoKwh / (potenciaPromedio / 1000) || 0;
        const costoEstimado = consumoKwh * 0.50;
        
        // 🔥 Categoría inteligente (basada en percentiles)
        let categoria = 'B';
        if (potenciaPromedio >= 100) categoria = 'A';
        else if (potenciaPromedio >= 50) categoria = 'M';

        // 🔥 INSERT/UPDATE eficiente
        const { error: upsertError } = await supabase
          .from("historicos_compactos")
          .upsert({
            device_id: esp32Id,
            tipo_periodo: 'D',
            fecha_inicio: yesterdayStr,
            consumo_total_kwh: parseFloat(consumoKwh.toFixed(3)),
            potencia_pico_w: Math.round(potenciaPico),
            potencia_promedio_w: parseFloat(potenciaPromedio.toFixed(2)),
            horas_uso_estimadas: parseFloat(horasUso.toFixed(1)),
            costo_estimado: parseFloat(costoEstimado.toFixed(2)),
            dias_alto_consumo: potenciaPico > 1000 ? 1 : 0,
            eficiencia_categoria: categoria,
            timestamp_creacion: new Date().toISOString()
          }, {
            onConflict: 'device_id,tipo_periodo,fecha_inicio'
          });

        if (upsertError) {
          console.error(`❌ [DAILY-SUMMARY] ${esp32Id}:`, upsertError.message);
          errors++;
          return null;
        }

        processed++;
        
        // 🔥 Actualizar devices
        await supabase
          .from("devices")
          .update({ 
            daily_consumption: consumoKwh,
            updated_at: new Date().toISOString()
          })
          .eq("esp32_id", esp32Id);

        return { device: esp32Id, consumo: consumoKwh };

      } catch (deviceError) {
        console.error(`💥 [DAILY-SUMMARY] Error:`, deviceError.message);
        errors++;
        return null;
      }
    });

    // Esperar todas las promesas
    const results = await Promise.all(promises);
    const successful = results.filter(r => r !== null);

    // 🔥 Generar resumen SEMANAL si es domingo
    if (yesterday.getDay() === 0) { // 0 = domingo
      await generateWeeklySummaryOptimized(yesterday);
    }

    // 🔥 Generar resumen MENSUAL si es último día del mes
    const tomorrow = new Date(yesterday);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (tomorrow.getDate() === 1) { // Mañana es día 1
      await generateMonthlySummaryOptimized(yesterday);
    }

    // 🔥 LIMPIEZA: Borrar lecturas_raw antiguas
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - DATA_CONFIG.keepRawDataDays);
    
    const { error: deleteError } = await supabase
      .from("lecturas_raw")
      .delete()
      .lt("timestamp", cutoffDate.toISOString());

    if (!deleteError) {
      console.log(`🧹 [CLEANUP] Lecturas_raw > ${DATA_CONFIG.keepRawDataDays} días eliminadas`);
    }

    console.log(`✅ [DAILY-SUMMARY] COMPLETADO: ${processed} exitos, ${errors} errores`);

  } catch (e) {
    console.error(`💥 [DAILY-SUMMARY] Error general:`, e.message);
  }
}

// 📍 FUNCIÓN: Generar resumen semanal
async function generateWeeklySummaryOptimized(lastDayOfWeek) {
  try {
    const weekStart = new Date(lastDayOfWeek);
    weekStart.setDate(weekStart.getDate() - 6); // Retroceder 6 días para inicio de semana
    
    const weekStartStr = weekStart.toISOString().split('T')[0];
    const weekEndStr = lastDayOfWeek.toISOString().split('T')[0];
    
    console.log(`📅 [WEEKLY-SUMMARY] Generando para semana ${weekStartStr} a ${weekEndStr}`);
    
    // 🔥 Agregar datos semanales
    const { data: weeklyData, error } = await supabase
      .from("historicos_compactos")
      .select(`
        device_id,
        sum(consumo_total_kwh) as total_kwh,
        max(potencia_pico_w) as max_pico,
        avg(potencia_promedio_w) as avg_potencia
      `)
      .eq("tipo_periodo", 'D')
      .gte("fecha_inicio", weekStartStr)
      .lte("fecha_inicio", weekEndStr)
      .group("device_id");

    if (error || !weeklyData) return;

    for (const item of weeklyData) {
      await supabase
        .from("historicos_compactos")
        .upsert({
          device_id: item.device_id,
          tipo_periodo: 'S', // Semanal
          fecha_inicio: weekStartStr,
          consumo_total_kwh: parseFloat(item.total_kwh.toFixed(3)),
          potencia_pico_w: item.max_pico,
          potencia_promedio_w: parseFloat(item.avg_potencia.toFixed(2)),
          timestamp_creacion: new Date().toISOString()
        }, {
          onConflict: 'device_id,tipo_periodo,fecha_inicio'
        });
    }

    console.log(`✅ [WEEKLY-SUMMARY] ${weeklyData.length} dispositivos procesados`);

  } catch (e) {
    console.error(`💥 [WEEKLY-SUMMARY] Error:`, e.message);
  }
}

// 📍 FUNCIÓN: Generar resumen mensual
async function generateMonthlySummaryOptimized(lastDayOfMonth) {
  try {
    const monthStart = new Date(lastDayOfMonth.getFullYear(), lastDayOfMonth.getMonth(), 1);
    const monthStartStr = monthStart.toISOString().split('T')[0];
    
    console.log(`🗓️ [MONTHLY-SUMMARY] Generando para mes ${monthStartStr}`);
    
    // 🔥 Agregar datos mensuales
    const { data: monthlyData, error } = await supabase
      .from("historicos_compactos")
      .select(`
        device_id,
        sum(consumo_total_kwh) as total_kwh,
        max(potencia_pico_w) as max_pico,
        avg(potencia_promedio_w) as avg_potencia
      `)
      .eq("tipo_periodo", 'D')
      .gte("fecha_inicio", monthStartStr)
      .lte("fecha_inicio", lastDayOfMonth.toISOString().split('T')[0])
      .group("device_id");

    if (error || !monthlyData) return;

    for (const item of monthlyData) {
      await supabase
        .from("historicos_compactos")
        .upsert({
          device_id: item.device_id,
          tipo_periodo: 'M', // Mensual
          fecha_inicio: monthStartStr,
          consumo_total_kwh: parseFloat(item.total_kwh.toFixed(3)),
          potencia_pico_w: item.max_pico,
          potencia_promedio_w: parseFloat(item.avg_potencia.toFixed(2)),
          timestamp_creacion: new Date().toISOString()
        }, {
          onConflict: 'device_id,tipo_periodo,fecha_inicio'
        });
      
      // 🔥 Actualizar consumo mensual en devices
      await supabase
        .from("devices")
        .update({ 
          monthly_consumption: item.total_kwh,
          updated_at: new Date().toISOString()
        })
        .eq("esp32_id", item.device_id);
    }

    console.log(`✅ [MONTHLY-SUMMARY] ${monthlyData.length} dispositivos procesados`);

  } catch (e) {
    console.error(`💥 [MONTHLY-SUMMARY] Error:`, e.message);
  }
}

// 📍 FUNCIÓN: Cálculo solar mejorado
async function calculateSolarRecommendation(deviceId) {
  try {
    // 🔥 Obtener consumo de los últimos 30 días
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const { data: monthlyData, error } = await supabase
      .from("historicos_compactos")
      .select("consumo_total_kwh")
      .eq("device_id", deviceId)
      .eq("tipo_periodo", 'D')
      .gte("fecha_inicio", thirtyDaysAgo.toISOString().split('T')[0]);

    if (error || !monthlyData || monthlyData.length === 0) {
      return { error: "No hay datos suficientes" };
    }

    const consumoTotal = monthlyData.reduce((sum, day) => sum + day.consumo_total_kwh, 0);
    const consumoPromedioDiario = consumoTotal / monthlyData.length;
    
    // 🔥 CÁLCULO SOLAR MEJORADO
    const porcentajeCubrir = 0.7; // 70%
    const hsCajamarca = 4.5; // Horas sol pico
    const eficienciaSistema = 0.8; // 80% eficiencia
    const tarifa = 0.50; // S/ por kWh
    const costoPanelW = 4.0; // S/ por watt instalado
    
    const energiaCubrir = consumoPromedioDiario * 30 * porcentajeCubrir;
    const potenciaNecesaria = energiaCubrir / (hsCajamarca * 30 * eficienciaSistema);
    const potenciaW = potenciaNecesaria * 1000;
    
    // 🔥 Recomendación realista
    const panelesRecomendados = Math.ceil(potenciaW / 100); // Paneles de 100W
    const potenciaInstalada = panelesRecomendados * 100;
    const inversion = potenciaInstalada * costoPanelW;
    const ahorroMensual = energiaCubrir * tarifa;
    const periodoRetorno = inversion / (ahorroMensual * 12);
    const co2Evitado = energiaCubrir * 0.5; // kg CO2 por kWh

    return {
      consumoPromedioDiario: parseFloat(consumoPromedioDiario.toFixed(2)),
      consumoMensual: parseFloat((consumoPromedioDiario * 30).toFixed(2)),
      panelesRecomendados,
      potenciaInstalada: `${potenciaInstalada}W`,
      inversion: `S/ ${inversion.toFixed(2)}`,
      ahorroMensual: `S/ ${ahorroMensual.toFixed(2)}`,
      periodoRetorno: `${periodoRetorno.toFixed(1)} años`,
      co2Evitado: `${co2Evitado.toFixed(1)} kg/mes`,
      recomendacion: `Con ${panelesRecomendados} paneles de 100W cubrirías el ${(porcentajeCubrir * 100).toFixed(0)}% de tu consumo`
    };

  } catch (e) {
    console.error(`💥 [SOLAR-CALC] ${deviceId}:`, e.message);
    return { error: "Error en cálculo" };
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

// ====== PROGRAMAR TAREAS AUTOMÁTICAS ======

function scheduleOptimizedTasks() {
  // 🔥 Programar resumen diario
  const now = new Date();
  const targetTime = new Date(now);
  targetTime.setHours(DATA_CONFIG.dailySummaryHour, DATA_CONFIG.dailySummaryMinute, 0, 0);
  
  if (now > targetTime) {
    targetTime.setDate(targetTime.getDate() + 1);
  }
  
  const timeUntilTarget = targetTime.getTime() - now.getTime();
  
  setTimeout(() => {
    generateDailySummaryOptimized();
    // Repetir cada 24 horas
    setInterval(generateDailySummaryOptimized, 24 * 60 * 60 * 1000);
  }, timeUntilTarget);
  
  console.log(`⏰ [SCHEDULER] Resumen diario a las ${targetTime.getHours()}:${targetTime.getMinutes()}`);
  
  // 🔥 Limpieza cada 6 horas
  setInterval(async () => {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - DATA_CONFIG.keepRawDataDays);
    
    await supabase
      .from("lecturas_raw")
      .delete()
      .lt("timestamp", cutoffDate.toISOString());
    
    console.log(`🧹 [AUTO-CLEANUP] Lecturas_raw > ${DATA_CONFIG.keepRawDataDays} días`);
  }, 6 * 60 * 60 * 1000); // Cada 6 horas
}

// ====== ENDPOINTS MEJORADOS CON SSID ======

// 📍 ENDPOINT: Recibir datos de ESP32 - CON SSID Y RECOLECCIÓN
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

    // 🔥 🔥 🔥 ¡GUARDAR EN lecturas_raw OPTIMIZADO!
    await saveToLecturasRawOptimized(deviceId, data, finalEnergy);

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

// 📍 ENDPOINT MEJORADO: Buscar dispositivos por nombre de WiFi
app.get("/api/devices-by-wifi", async (req, res) => {
  try {
    const { wifiName, fuzzy = "true" } = req.query;
    
    if (!wifiName) {
      return res.status(400).json({ 
        success: false, 
        error: "Por favor, escribe el nombre de tu WiFi" 
      });
    }

    const cleanWifiName = wifiName.trim();
    console.log(`🔍 [WIFI-SEARCH] Buscando: "${cleanWifiName}" (fuzzy: ${fuzzy})`);

    // 1. Buscar EXACTO en Supabase
    const exactDevices = await findDevicesByWifiSsid(cleanWifiName);

    // 2. Buscar dispositivos NO registrados en cache (exacto)
    const now = Date.now();
    const unregisteredExact = Object.entries(onlineDevices)
      .filter(([deviceId, state]) => {
        return (
          now - state.lastSeen < ONLINE_TIMEOUT_MS &&
          state.wifiSsid === cleanWifiName &&
          !state.userId
        );
      })
      .map(([deviceId, state]) => ({
        deviceId: deviceId,
        esp32_id: deviceId,
        name: `Dispositivo ${deviceId.substring(0, 8)}`,
        is_online: true,
        wifi_ssid: state.wifiSsid,
        network_code: state.networkCode,
        is_temporary: true,
        power: state.lastPower || 0,
        voltage: state.lastData?.voltage || 0,
        current: state.lastData?.current || 0,
        energy: state.energy || 0,
        status: "online",
        last_seen: new Date(state.lastSeen).toISOString(),
      }));

    let allDevices = [
      ...exactDevices.map(d => ({ ...d, is_temporary: false, matchType: "exact" })),
      ...unregisteredExact.map(d => ({ ...d, matchType: "exact" }))
    ];

    // 3. 🔥 NUEVO: Si fuzzy=true, buscar COINCIDENCIAS PARCIALES
    if (fuzzy === "true" && allDevices.length === 0) {
      console.log(`🤔 [FUZZY-SEARCH] Intentando búsqueda difusa...`);
      
      // Buscar SSIDs similares en cache
      const similarSsids = Object.values(onlineDevices)
        .filter(state => state.wifiSsid && now - state.lastSeen < ONLINE_TIMEOUT_MS)
        .map(state => state.wifiSsid)
        .filter(ssid => {
          const cleanSearch = cleanWifiName.toLowerCase().replace(/[^a-z0-9]/g, '');
          const cleanSsid = ssid.toLowerCase().replace(/[^a-z0-9]/g, '');
          
          return cleanSsid.includes(cleanSearch) || 
                 cleanSearch.includes(cleanSsid) ||
                 ssid.toLowerCase().replace(/_5g|5g|_5ghz/gi, '') === cleanWifiName.toLowerCase();
        });
      
      const uniqueSimilar = [...new Set(similarSsids)];
      
      if (uniqueSimilar.length > 0) {
        console.log(`🔍 [FUZZY-SEARCH] SSIDs similares encontrados:`, uniqueSimilar);
        
        const similarDevices = [];
        
        for (const similarSsid of uniqueSimilar) {
          if (similarSsid !== cleanWifiName) {
            const devicesInSimilar = Object.entries(onlineDevices)
              .filter(([deviceId, state]) => {
                return (
                  now - state.lastSeen < ONLINE_TIMEOUT_MS &&
                  state.wifiSsid === similarSsid
                );
              })
              .map(([deviceId, state]) => ({
                deviceId: deviceId,
                esp32_id: deviceId,
                name: `Dispositivo en "${similarSsid}"`,
                is_online: true,
                wifi_ssid: state.wifiSsid,
                network_code: state.networkCode,
                is_temporary: true,
                power: state.lastPower || 0,
                voltage: state.lastData?.voltage || 0,
                current: state.lastData?.current || 0,
                energy: state.energy || 0,
                status: "online",
                last_seen: new Date(state.lastSeen).toISOString(),
                matchType: "similar",
                originalSearch: cleanWifiName,
                foundIn: similarSsid
              }));
            
            similarDevices.push(...devicesInSimilar);
          }
        }
        
        allDevices = [...allDevices, ...similarDevices];
      }
    }

    console.log(`✅ [WIFI-SEARCH] "${cleanWifiName}" → ${allDevices.length} dispositivos`);
    
    res.json({
      success: true,
      wifiName: cleanWifiName,
      devices: allDevices,
      count: allDevices.length,
      hasExactMatches: allDevices.some(d => d.matchType === "exact"),
      hasSimilarMatches: allDevices.some(d => d.matchType === "similar"),
      message: allDevices.length === 0 
        ? "No hay dispositivos conectados a este WiFi. Verifica el nombre."
        : allDevices.some(d => d.matchType === "similar")
          ? `No encontramos en "${cleanWifiName}" pero sí en "${allDevices[0].wifi_ssid}". ¿Quizás es esa tu red?`
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

// 📍 ENDPOINT CORREGIDO: Registrar dispositivo simple por SSID
app.post("/api/register-simple", async (req, res) => {
  try {
    const { deviceId, deviceName, wifiSsid } = req.body;

    console.log(`📝 [REGISTER-SIMPLE] Datos recibidos:`, {
      deviceId,
      deviceName,
      wifiSsid,
    });

    if (!deviceId || !wifiSsid) {
      return res.status(400).json({ 
        success: false,
        error: "Necesito: deviceId y nombre de WiFi" 
      });
    }

    // 🔥 CORRECCIÓN: Generar código de red
    const networkCode = generateNetworkCode(wifiSsid);
    const autoUserId = `user_${networkCode}`.toLowerCase();
    
    console.log(`🔑 [REGISTER-SIMPLE] Código generado: ${networkCode}, User: ${autoUserId}`);

    const existingDevice = await findDeviceByEsp32Id(deviceId);
    
    if (existingDevice) {
      console.log(`🔄 [REGISTER-SIMPLE] Dispositivo existente encontrado: ${existingDevice.id}`);
      
      const updateResult = await updateDeviceInSupabase(existingDevice.id, {
        name: deviceName || existingDevice.name,
        wifi_ssid: wifiSsid,
        network_code: networkCode,
        user_id: autoUserId,
        is_online: true,
        last_seen: new Date().toISOString(),
      });
      
      if (!updateResult) {
        throw new Error("Error actualizando dispositivo existente");
      }
      
      if (onlineDevices[deviceId]) {
        onlineDevices[deviceId].userId = autoUserId;
        onlineDevices[deviceId].deviceDbId = existingDevice.id;
        onlineDevices[deviceId].wifiSsid = wifiSsid;
        onlineDevices[deviceId].networkCode = networkCode;
      }
      
      console.log(`✅ [REGISTER-SIMPLE] ${deviceId} actualizado en WiFi "${wifiSsid}"`);
      
      return res.json({
        success: true,
        device: existingDevice,
        networkCode: networkCode,
        message: "¡Dispositivo actualizado!",
        instructions: `Usa el código ${networkCode} para ver tus dispositivos desde cualquier lugar`
      });
    }

    console.log(`🆕 [REGISTER-SIMPLE] Creando nuevo dispositivo...`);
    
    const deviceState = onlineDevices[deviceId] || {};
    
    const newDeviceData = {
      esp32_id: deviceId,
      name: deviceName || `Dispositivo ${deviceId.substring(0, 8)}`,
      wifi_ssid: wifiSsid,
      network_code: networkCode,
      user_id: autoUserId,
      power: deviceState.lastPower || 0,
      energy: deviceState.energy || 0,
      is_online: true,
      voltage: deviceState.lastData?.voltage || 0,
      current: deviceState.lastData?.current || 0,
      frequency: deviceState.lastData?.frequency || 0,
      power_factor: deviceState.lastData?.powerFactor || 0,
      daily_consumption: 0,
      monthly_consumption: 0,
      total_consumption: 0,
      last_reset_date: new Date().toDateString(),
      monthly_reset_date: new Date().getMonth(),
      energy_at_day_start: 0,
      energy_at_month_start: 0,
      total_energy: deviceState.energy || 0,
      last_energy_update: new Date().toISOString(),
      last_seen: new Date().toISOString(),
      type: 'General',
      linked_at: new Date().toISOString(),
    };

    console.log(`📋 [REGISTER-SIMPLE] Datos a insertar:`, JSON.stringify(newDeviceData, null, 2));

    const createdDevice = await createDeviceInSupabase(newDeviceData);

    if (!createdDevice) {
      console.error(`❌ [REGISTER-SIMPLE] Error creando dispositivo en Supabase`);
      return res.status(500).json({
        success: false,
        error: "Error creando dispositivo en la base de datos. Verifica los logs."
      });
    }

    if (onlineDevices[deviceId]) {
      onlineDevices[deviceId].userId = autoUserId;
      onlineDevices[deviceId].deviceDbId = createdDevice.id;
      onlineDevices[deviceId].wifiSsid = wifiSsid;
      onlineDevices[deviceId].networkCode = networkCode;
    } else {
      onlineDevices[deviceId] = {
        lastSeen: Date.now(),
        lastTs: Date.now(),
        lastPower: 0,
        energy: 0,
        userId: autoUserId,
        deviceDbId: createdDevice.id,
        wifiSsid: wifiSsid,
        networkCode: networkCode,
        totalCalculations: 0,
        lastData: {
          voltage: 0,
          current: 0,
          frequency: 0,
          powerFactor: 0,
        },
      };
    }

    console.log(`✅ [REGISTER-SIMPLE] Nuevo dispositivo creado: ${deviceId} en WiFi "${wifiSsid}" - ID: ${createdDevice.id}`);

    res.json({
      success: true,
      device: createdDevice,
      networkCode: networkCode,
      message: "¡Listo! Dispositivo registrado",
      instructions: `Guarda este código: ${networkCode}. Lo necesitarás para ver tus dispositivos desde otros lugares.`
    });

  } catch (e) {
    console.error("💥 /api/register-simple ERROR COMPLETO:", e.message);
    console.error("💥 Stack trace:", e.stack);
    
    let errorMessage = e.message;
    if (e.message.includes('network_code')) {
      errorMessage = "El código de red debe tener máximo 8 caracteres";
    } else if (e.message.includes('user_id')) {
      errorMessage = "Error con el ID de usuario";
    } else if (e.message.includes('null value')) {
      errorMessage = "Faltan datos requeridos para crear el dispositivo";
    }
    
    res.status(500).json({ 
      success: false, 
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? e.message : undefined
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

// 📍 ENDPOINT: Registrar dispositivo (original)
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

    if (typeof userId !== "string") {
      return res.status(400).json({
        success: false,
        error: "userId debe ser un string válido",
      });
    }

    if (!artifactId) {
      console.log("🆕 [REGISTER] Creando nuevo dispositivo...");

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

      console.log(`✅ [REGISTER] Nuevo dispositivo creado: ${createdDevice.id}`);

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

    console.log(`✅ [REGISTER] Dispositivo ${deviceId} registrado con artifact ${artifactId}`);

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
        wifiSsid: state.wifiSsid,
        networkCode: state.networkCode,
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

// 📍 ENDPOINT: Datos en tiempo real
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
        wifiSsid: device.wifi_ssid,
        networkCode: device.network_code,
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
    
    const uniqueSsids = [...new Set(
      Object.values(onlineDevices)
        .filter(state => now - state.lastSeen < ONLINE_TIMEOUT_MS)
        .map(state => state.wifiSsid)
        .filter(Boolean)
    )];

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

// 📍 ENDPOINT: Escaneo activo de dispositivos
app.get("/api/active-scan", async (req, res) => {
  try {
    const now = Date.now();
    const timeout = 10000;
    
    const activeDevices = Object.entries(onlineDevices)
      .filter(([deviceId, state]) => {
        return now - state.lastSeen < timeout;
      })
      .map(([deviceId, state]) => ({
        deviceId: deviceId,
        mac: deviceId,
        name: state.userId ? "Registrado" : "Dispositivo disponible",
        wifiSsid: state.wifiSsid || "Desconocido",
        networkCode: state.networkCode,
        power: state.lastPower || 0,
        voltage: state.lastData?.voltage || 0,
        isRegistered: !!state.userId,
        lastSeen: new Date(state.lastSeen).toISOString(),
        ageSeconds: Math.floor((now - state.lastSeen) / 1000),
        signal: "excelente"
      }));
    
    console.log(`🔍 [ACTIVE-SCAN] ${activeDevices.length} dispositivos activos`);
    
    res.json({
      success: true,
      scanId: `scan_${Date.now()}`,
      devices: activeDevices,
      count: activeDevices.length,
      timestamp: now,
      message: activeDevices.length === 0 
        ? "No hay dispositivos enviando datos. Verifica que estén encendidos."
        : `Escaneo completado: ${activeDevices.length} dispositivo(s) encontrado(s)`
    });
    
  } catch (e) {
    console.error("💥 /api/active-scan", e.message);
    res.status(500).json({ 
      success: false, 
      error: e.message 
    });
  }
});

// 📍 ENDPOINT: Eliminar dispositivo completamente
app.delete("/api/delete-device/:deviceId", async (req, res) => {
  try {
    const { deviceId } = req.params;
    
    if (!deviceId) {
      return res.status(400).json({ 
        success: false,
        error: "Falta deviceId" 
      });
    }

    console.log(`🗑️ [DELETE-COMPLETE] Eliminando dispositivo completamente: ${deviceId}`);

    const { data: devices, error: findError } = await supabase
      .from("devices")
      .select("id, esp32_id, user_id, name, wifi_ssid")
      .eq("esp32_id", deviceId)
      .limit(1);

    if (findError) {
      console.error("❌ Error buscando dispositivo:", findError.message);
      return res.status(500).json({ 
        success: false,
        error: "Error buscando dispositivo" 
      });
    }

    if (!devices || devices.length === 0) {
      console.log(`ℹ️ [DELETE-COMPLETE] Dispositivo ${deviceId} no encontrado en Supabase`);
      return res.json({ 
        success: true,
        message: "Dispositivo no encontrado (posiblemente ya fue eliminado)" 
      });
    }

    const device = devices[0];
    
    console.log(`📋 [DELETE-COMPLETE] Encontrado: ID ${device.id}, ${device.name}, WiFi: ${device.wifi_ssid}`);

    const { data: deletedData, error: deleteError } = await supabase
      .from("devices")
      .delete()
      .eq("esp32_id", deviceId)
      .select();

    if (deleteError) {
      console.error("❌ Error eliminando dispositivo:", deleteError.message);
      return res.status(500).json({ 
        success: false,
        error: "Error eliminando dispositivo de la base de datos" 
      });
    }

    if (onlineDevices[deviceId]) {
      delete onlineDevices[deviceId];
      console.log(`🧹 [DELETE-COMPLETE] Eliminado de cache en memoria`);
    }

    console.log(`✅ [DELETE-COMPLETE] Dispositivo ${deviceId} (${device.name}) eliminado completamente de Supabase`);
    
    res.json({
      success: true,
      message: `Dispositivo ${device.name} eliminado completamente`,
      deletedDevice: deletedData?.[0],
      timestamp: new Date().toISOString()
    });

  } catch (e) {
    console.error("💥 /api/delete-device/:deviceId ERROR:", e.message);
    res.status(500).json({ 
      success: false,
      error: e.message 
    });
  }
});

// ====== 🔥 ENDPOINTS NUEVOS DE RECOLECCIÓN ======

// 📍 ENDPOINT: Generar reporte diario manual
app.post("/api/generate-daily-summary", async (req, res) => {
  try {
    console.log(`🔄 [MANUAL-TRIGGER] Generando resumen diario por solicitud...`);
    await generateDailySummaryOptimized();
    
    res.json({
      success: true,
      message: "Resumen diario generado exitosamente",
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    console.error("💥 /api/generate-daily-summary", e.message);
    res.status(500).json({ 
      success: false, 
      error: e.message 
    });
  }
});

// 📍 ENDPOINT: Obtener análisis histórico
app.get("/api/historical-analysis/:deviceId", async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { days = 30 } = req.query;
    
    if (!deviceId) {
      return res.status(400).json({ 
        success: false, 
        error: "Falta deviceId" 
      });
    }
    
    const { data: historicos, error } = await supabase
      .from("historicos_compactos")
      .select("*")
      .eq("device_id", deviceId)
      .eq("tipo_periodo", 'D')
      .order("fecha_inicio", { ascending: false })
      .limit(parseInt(days));
    
    if (error) {
      console.error("❌ Error obteniendo históricos:", error.message);
      return res.status(500).json({ 
        success: false, 
        error: "Error obteniendo datos históricos" 
      });
    }
    
    const estadisticas = {
      totalDias: historicos?.length || 0,
      consumoTotal: 0,
      costoTotal: 0,
      picoMaximo: 0,
      diasAltoConsumo: 0,
      promedioDiario: 0
    };
    
    if (históricos && historicos.length > 0) {
      historicos.forEach(day => {
        estadisticas.consumoTotal += day.consumo_total_kwh || 0;
        estadisticas.costoTotal += day.costo_estimado || 0;
        if (day.potencia_pico_w > estadisticas.picoMaximo) {
          estadisticas.picoMaximo = day.potencia_pico_w;
        }
        if (day.dias_alto_consumo > 0) {
          estadisticas.diasAltoConsumo++;
        }
      });
      estadisticas.promedioDiario = estadisticas.consumoTotal / historicos.length;
    }
    
    const recomendacionSolar = estadisticas.promedioDiario > 0 ? {
      consumoMensual: estadisticas.promedioDiario * 30,
      panelesRecomendados: Math.ceil((estadisticas.promedioDiario * 30 * 0.7) / (4.5 * 30 * 0.1)),
      ahorroMensual: estadisticas.promedioDiario * 30 * 0.7 * 0.50,
      periodoRetorno: 36
    } : null;
    
    res.json({
      success: true,
      deviceId: deviceId,
      periodosAnalizados: days,
      historicos: historicos || [],
      estadisticas: estadisticas,
      recomendacionSolar: recomendacionSolar,
      message: historicos?.length === 0 
        ? "No hay datos históricos para este dispositivo"
        : `Análisis de ${históricos.length} días completado`
    });
    
  } catch (e) {
    console.error("💥 /api/historical-analysis/:deviceId", e.message);
    res.status(500).json({ 
      success: false, 
      error: e.message 
    });
  }
});

// 📍 ENDPOINT: Recomendación solar mejorada
app.get("/api/solar-recommendation/:deviceId", async (req, res) => {
  try {
    const { deviceId } = req.params;
    
    if (!deviceId) {
      return res.status(400).json({ 
        success: false, 
        error: "Falta deviceId" 
      });
    }
    
    const recommendation = await calculateSolarRecommendation(deviceId);
    
    if (recommendation.error) {
      return res.status(404).json({
        success: false,
        error: recommendation.error
      });
    }
    
    res.json({
      success: true,
      deviceId,
      recommendation,
      timestamp: new Date().toISOString(),
      note: "Basado en los últimos 30 días de consumo"
    });
    
  } catch (e) {
    console.error("💥 /api/solar-recommendation/:deviceId", e.message);
    res.status(500).json({ 
      success: false, 
      error: e.message 
    });
  }
});

// 📍 ENDPOINT: Simular datos para pruebas/paper
app.post("/api/simulate-data", async (req, res) => {
  try {
    const { deviceId, days = 7 } = req.body;
    
    if (!deviceId) {
      return res.status(400).json({ 
        success: false, 
        error: "Falta deviceId" 
      });
    }
    
    const existingDevice = await findDeviceByEsp32Id(deviceId);
    if (!existingDevice) {
      return res.status(404).json({ 
        success: false, 
        error: "Dispositivo no encontrado. Regístralo primero." 
      });
    }
    
    console.log(`🎮 [SIMULATE-API] Simulando ${days} días para ${deviceId}...`);
    
    for (let i = 0; i < days; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      
      const consumoKwh = 0.8 + Math.random() * 0.8;
      const potenciaPico = 80 + Math.random() * 60;
      const potenciaPromedio = 50 + Math.random() * 40;
      
      await supabase
        .from("historicos_compactos")
        .insert({
          device_id: deviceId,
          tipo_periodo: 'D',
          fecha_inicio: dateStr,
          consumo_total_kwh: consumoKwh,
          potencia_pico_w: Math.round(potenciaPico),
          potencia_promedio_w: parseFloat(potenciaPromedio.toFixed(2)),
          horas_uso_estimadas: parseFloat((consumoKwh / (potenciaPromedio / 1000)).toFixed(1)),
          costo_estimado: parseFloat((consumoKwh * 0.50).toFixed(2)),
          eficiencia_categoria: potenciaPromedio < 80 ? 'B' : 'M'
        })
        .select();
    }
    
    console.log(`✅ [SIMULATE-API] ${days} días simulados para ${deviceId}`);
    
    res.json({
      success: true,
      message: `${days} días de datos simulados para ${deviceId}`,
      device: existingDevice.name,
      daysSimulated: days,
      timestamp: new Date().toISOString(),
      note: "Datos generados en tabla historicos_compactos para análisis"
    });
    
  } catch (e) {
    console.error("💥 /api/simulate-data", e.message);
    res.status(500).json({ 
      success: false, 
      error: e.message 
    });
  }
});

// 📍 ENDPOINT: Limpiar datos antiguos
app.post("/api/cleanup-old-data", async (req, res) => {
  try {
    const { daysToKeep = 2 } = req.body;
    
    const cutoffDate = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);
    
    const { count: rawDeleted } = await supabase
      .from("lecturas_raw")
      .delete()
      .lt("timestamp", cutoffDate.toISOString());
    
    console.log(`🧹 [CLEANUP] Eliminadas ${rawDeleted} lecturas_raw > ${daysToKeep} días`);
    
    res.json({
      success: true,
      message: `Datos antiguos limpiados (conservando últimos ${daysToKeep} días)`,
      lecturas_raw_eliminadas: rawDeleted || 0,
      cutoffDate: cutoffDate.toISOString()
    });
    
  } catch (e) {
    console.error("💥 /api/cleanup-old-data", e.message);
    res.status(500).json({ 
      success: false, 
      error: e.message 
    });
  }
});

// 📍 ENDPOINT: Estadísticas del sistema
app.get("/api/system-stats", async (req, res) => {
  try {
    const { data: devicesStats } = await supabase
      .from("devices")
      .select("count, is_online")
      .single();
    
    const { data: rawStats } = await supabase
      .from("lecturas_raw")
      .select("count, min(timestamp), max(timestamp)")
      .single();
    
    const { data: historicosStats } = await supabase
      .from("historicos_compactos")
      .select("count, tipo_periodo")
      .group("tipo_periodo");
    
    const activeInCache = Object.values(onlineDevices).filter(
      state => Date.now() - state.lastSeen < ONLINE_TIMEOUT_MS
    ).length;
    
    res.json({
      success: true,
      stats: {
        devices: {
          total: devicesStats?.count || 0,
          online: devicesStats?.is_online || 0,
          inCache: Object.keys(onlineDevices).length,
          activeInCache: activeInCache
        },
        lecturas_raw: {
          total: rawStats?.count || 0,
          desde: rawStats?.min || null,
          hasta: rawStats?.max || null
        },
        historicos: historicosStats || [],
        system: {
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          nodeVersion: process.version
        }
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (e) {
    console.error("💥 /api/system-stats", e.message);
    res.status(500).json({ 
      success: false, 
      error: e.message 
    });
  }
});

// 📍 ENDPOINT: Raíz - Info del sistema
app.get("/", (req, res) => {
  res.json({
    service: "ESP32 Energy Monitor API",
    version: "3.0 - Sistema Completo con Recolección Automática",
    endpoints: {
      data: "POST /api/data - Recibir datos del ESP32",
      devicesByWifi: "GET /api/devices-by-wifi?wifiName=XXXX",
      registerSimple: "POST /api/register-simple - Registrar sin login",
      devicesByCode: "GET /api/devices-by-code?networkCode=XXXX",
      // 🔥 NUEVOS ENDPOINTS
      generateDailySummary: "POST /api/generate-daily-summary",
      historicalAnalysis: "GET /api/historical-analysis/:deviceId",
      solarRecommendation: "GET /api/solar-recommendation/:deviceId",
      simulateData: "POST /api/simulate-data",
      systemStats: "GET /api/system-stats"
    },
    message: "Sistema completo de monitorización energética con recolección automática"
  });
});

// Iniciar la tarea periódica de limpieza de estado
const CLEANUP_INTERVAL_MS = 2000;
setInterval(cleanupOnlineStatus, CLEANUP_INTERVAL_MS);

// 🔥 INICIAR SERVIDOR
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
  console.log(`📡 Sistema COMPLETO por SSID/WIFI con RECOLECCIÓN AUTOMÁTICA`);
  console.log(`🔗 Endpoints principales:`);
  console.log(`   GET  /api/devices-by-wifi?wifiName=TU_WIFI`);
  console.log(`   POST /api/register-simple (deviceId, deviceName, wifiSsid)`);
  console.log(`   GET  /api/devices-by-code?networkCode=XXXX`);
  console.log(`   POST /api/data (para ESP32)`);
  console.log(`📊 Sistema de RECOLECCIÓN AUTOMÁTICA activado`);
  console.log(`   ⏰ Resumen diario: ${DATA_CONFIG.dailySummaryHour}:${DATA_CONFIG.dailySummaryMinute} cada día`);
  console.log(`   💾 Guarda 1 de cada ${DATA_CONFIG.saveEveryNReadings} lecturas (cada ~${DATA_CONFIG.saveEveryNReadings*5}s)`);
  console.log(`   🧹 Limpieza automática cada 6 horas`);
  console.log(`📈 Endpoints de análisis:`);
  console.log(`   GET  /api/historical-analysis/:deviceId`);
  console.log(`   GET  /api/solar-recommendation/:deviceId`);
  console.log(`   POST /api/simulate-data (para pruebas/paper)`);
  console.log(`⏰ Cleanup interval: ${CLEANUP_INTERVAL_MS}ms`);
  
  // 🔥 INICIAR TAREAS PROGRAMADAS
  scheduleOptimizedTasks();
});