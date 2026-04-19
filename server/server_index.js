// server_index.js - VERSIÓN CORREGIDA CON HORA PERUANA Y LIMPIEZA AUTOMÁTICA
const express = require("express");
const { createClient } = require("@supabase/supabase-js");

// ✅ CONFIGURACIÓN DE HORA PERUANA (UTC-5)
process.env.TZ = 'America/Lima';
console.log(`⏰ Configurando hora peruana: ${new Date().toString()}`);

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

const DATA_CONFIG = {
  saveEveryNReadings: 6,           // Guardar 1 de cada 6 lecturas (cada ~30s)
  keepRawDataDays: 1,              // Mantener lecturas_raw por 1 día (después de procesar)
  dailySummaryHour: 23,            // Generar resumen diario a las 23:00 hora Perú
  dailySummaryMinute: 59,
  generateHourlySummary: false,    // ❌ DESHABILITADO: Generar resumen por hora
  generateWeeklySummary: true,     // Generar resumen semanal
  generateMonthlySummary: true,    // Generar resumen mensual
  autoDetectDayChange: true,       // Detectar automáticamente cambio de día
  minReadingsForDaily: 2,          // Mínimo de lecturas para considerar "con datos"
  cleanupHour: 0,                  // Limpiar datos a las 00:05 hora Perú
  cleanupMinute: 5,
};

const getPeruDateStr = (input = new Date()) => {
  return getPeruTimestamp(input).split('T')[0];
};

// Contadores por dispositivo para controlar frecuencia
const deviceCounters = {};

// ✅ VARIABLE GLOBAL PARA CONTROLAR EJECUCIÓN ÚNICA
let dailySummaryExecuted = false;
let cleanupExecuted = false;

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
      lastReportedEnergy: deviceInDb?.last_reported_energy || 0,  // 🔥 CORRECCIÓN: Cargar último reported desde DB
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
async function createDeviceInSupabase(deviceData) {
  try {
    console.log(`📝 [CREATE-DEVICE] Insertando:`, JSON.stringify(deviceData, null, 2));
    const { data, error } = await supabase
      .from("devices")
      .insert([{
        ...deviceData,
        last_energy_update: getPeruTimestamp(),  // 🔥 Cambiado a hora peruana
        last_seen: getPeruTimestamp(),  // 🔥 Cambiado a hora peruana
        linked_at: getPeruTimestamp()  // 🔥 Cambiado a hora peruana
      }])
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
const getPeruTimestamp = (input = new Date()) => {
  const date = input instanceof Date ? input : new Date(input);
  // Ajuste manual para UTC-5 (Perú sin DST)
  const offsetMs = -5 * 60 * 60 * 1000; // -5 horas en ms
  const localDate = new Date(date.getTime() + offsetMs);
  // Formatear como ISO con offset fijo -05:00
  return localDate.toISOString().slice(0, -1) + '-05:00';
};

// 🔥 NUEVA FUNCIÓN: Obtener estadísticas actuales del día
async function getCurrentDayStats(deviceId) {
  try {
    const todayStr = new Date().toISOString().split('T')[0];

    const { data: dayStats, error } = await supabase
      .from("historicos_compactos")
      .select(`
        *,
        devices!inner(name, wifi_ssid)
      `)
      .eq("device_id", deviceId)
      .eq("tipo_periodo", 'D')
      .eq("fecha_inicio", todayStr)
      .single();

    if (error) {
      return {
        has_data: false,
        message: "No hay datos para hoy todavía"
      };
    }

    return {
      has_data: true,
      stats: dayStats,
      message: `Datos actualizados hasta ${new Date().toLocaleTimeString()}`
    };
  } catch (e) {
    console.error(`💥 [DAY-STATS-GET] ${deviceId}:`, e.message);
    return { has_data: false, error: e.message };
  }
}
// 📍 ENDPOINT: Obtener estadísticas del día actual en tiempo real
app.get("/api/current-day-stats/:deviceId", async (req, res) => {
  try {
    const { deviceId } = req.params;
    if (!deviceId) {
      return res.status(400).json({
        success: false,
        error: "Falta deviceId"
      });
    }
    const stats = await getCurrentDayStats(deviceId);
    res.json({
      success: true,
      deviceId: deviceId,
      ...stats,
      timestamp: getPeruTimestamp()
    });
  } catch (e) {
    console.error("💥 /api/current-day-stats/:deviceId", e.message);
    res.status(500).json({
      success: false,
      error: e.message
    });
  }
});

async function checkAndGenerateDailySummaryOptimized(deviceId, currentTimestamp) {
  try {
    const now = new Date(currentTimestamp);
    const todayStr = getPeruDateStr(now); // CORRECCIÓN: Usar getPeruDateStr

    // 🔥 Verificar si YA existe un registro para hoy
    const { data: existingToday, error: checkError } = await supabase
      .from("historicos_compactos")
      .select("id, fecha_inicio, has_data, raw_readings_count, first_reading_time")
      .eq("device_id", deviceId)
      .eq("tipo_periodo", 'D')
      .eq("fecha_inicio", todayStr)
      .single();

    // Si es la PRIMERA lectura del día y no existe registro
    if (!existingToday || checkError?.code === 'PGRST116') {
      console.log(`📝 [PRIMERA-LECTURA] ${deviceId}: Primera lectura del día ${todayStr}`);

      // Crear registro inicial vacío
      await supabase
        .from("historicos_compactos")
        .insert({
          device_id: deviceId,
          tipo_periodo: 'D',
          fecha_inicio: todayStr,
          consumo_total_kwh: 0,
          potencia_pico_w: 0,
          potencia_promedio_w: 0,
          horas_uso_estimadas: 0,
          costo_estimado: 0,
          dias_alto_consumo: 0,
          eficiencia_categoria: 'N',
          timestamp_creacion: getPeruTimestamp(),
          has_data: false,
          raw_readings_count: 0,
          auto_generated: true,
          is_today: true,
          first_reading_time: getPeruTimestamp()
        });
    }
    // 🔥 Si ya existe registro pero no tiene datos (primera lectura con datos)
    else if (existingToday && !existingToday.has_data) {
      console.log(`🔄 [PRIMEROS-DATOS] ${deviceId}: Actualizando primer registro con datos`);

      // Obtener el estado actual del dispositivo
      const deviceState = onlineDevices[deviceId];
      if (deviceState) {
        const currentEnergy = deviceState.energy || 0;

        // Buscar la primera lectura del día para obtener energía inicial
        const { data: firstReading } = await supabase
          .from("lecturas_raw")
          .select("energy, timestamp")
          .eq("device_id", deviceId)
          .gte("timestamp", `${todayStr}T00:00:00`)
          .order("timestamp", { ascending: true })
          .limit(1)
          .single();

        const energyStart = firstReading?.energy || currentEnergy;
        const consumoInicial = Math.max(0, currentEnergy - energyStart);

        // 🔥 CORRECCIÓN: Calcular horas inicial (si >1 lectura, pero aquí es primera, set 0.1)
        const firstTime = firstReading?.timestamp || getPeruTimestamp();

        await supabase
          .from("historicos_compactos")
          .update({
            consumo_total_kwh: parseFloat(consumoInicial.toFixed(6)),
            potencia_pico_w: Math.max(0, deviceState.lastPower || 0),
            potencia_promedio_w: parseFloat((deviceState.lastPower || 0).toFixed(2)),
            horas_uso_estimadas: 0.1,
            costo_estimado: parseFloat((consumoInicial * 0.50).toFixed(4)),
            dias_alto_consumo: (deviceState.lastPower || 0) > 1000 ? 1 : 0,
            eficiencia_categoria: 'B',
            has_data: true,
            raw_readings_count: 1,
            updated_at: getPeruTimestamp(),
            energy_start: energyStart,
            first_reading_time: firstTime
          })
          .eq("id", existingToday.id);
      }
    }
  } catch (e) {
    console.error(`💥 [NUEVO-DIA] ${deviceId}: Error:`, e.message);
  }
}
async function updateDailyStatsInRealTime(deviceId, data) {
  try {
    const { power, energy, timestamp } = data;

    // 🔥 Usar fecha local Perú para determinar el día
    const readingLocalDateStr = getPeruDateStr(new Date(timestamp));
    const serverLocalDateStr = getPeruDateStr();

    if (readingLocalDateStr !== serverLocalDateStr) {
      console.warn(`⚠️ [DAY-STATS] ${deviceId}: Lectura pertenece a otro día local Perú (${readingLocalDateStr} ≠ ${serverLocalDateStr}), ignorando para hoy`);
      return false;
    }

    const { data: dayRecord, error } = await supabase
      .from("historicos_compactos")
      .select("*")
      .eq("device_id", deviceId)
      .eq("tipo_periodo", 'D')
      .eq("fecha_inicio", serverLocalDateStr) // 🔥 Día local Perú
      .single();

    let isNewRecord = false;
    if (error || !dayRecord) {
      console.log(`📝 [DAY-STATS] ${deviceId}: Creando nuevo registro para día local ${serverLocalDateStr}`);
      const { data: deviceData } = await supabase
        .from("devices")
        .select("energy")
        .eq("esp32_id", deviceId)
        .single();
      const initialEnergy = deviceData?.energy || energy;
      const energyDelta = Math.max(0, energy - initialEnergy);
      await supabase
        .from("historicos_compactos")
        .insert({
          device_id: deviceId,
          tipo_periodo: 'D',
          fecha_inicio: serverLocalDateStr, // 🔥 Local
          consumo_total_kwh: parseFloat(energyDelta.toFixed(6)),
          potencia_pico_w: Math.round(power),
          potencia_promedio_w: parseFloat(power.toFixed(2)),
          horas_uso_estimadas: 0.1,
          costo_estimado: parseFloat((energyDelta * 0.50).toFixed(4)),
          dias_alto_consumo: power > 1000 ? 1 : 0,
          eficiencia_categoria: 'B',
          timestamp_creacion: getPeruTimestamp(),
          has_data: true,
          raw_readings_count: 1,
          auto_generated: true,
          is_today: true,
          energy_start: initialEnergy,
          first_reading_time: getPeruTimestamp(new Date(timestamp))
        });
      isNewRecord = true;
    } else {
      const readingsCount = (dayRecord.raw_readings_count || 0) + 1;
      const newPeakPower = Math.max(dayRecord.potencia_pico_w || 0, power);
      const currentAvg = dayRecord.potencia_promedio_w || 0;
      const newAvg = ((currentAvg * (readingsCount - 1)) + power) / readingsCount;
      const energyStart = dayRecord.energy_start || 0;
      const lastEnergy = dayRecord.energy_end || energyStart;
      let currentConsumption = energy - energyStart;
      let resetDetected = false;
      if (energy < lastEnergy) {
        console.warn(`🚨 [RESET-DETECTED] ${deviceId}: Energy reset detectado (${energy} < ${lastEnergy})`);
        resetDetected = true;
        currentConsumption = dayRecord.consumo_total_kwh + energy;
      }
      let firstTime = dayRecord.first_reading_time ? new Date(dayRecord.first_reading_time) : new Date(timestamp);
      if (!dayRecord.first_reading_time) {
        firstTime = new Date(timestamp);
      }
      const timeDiffMs = new Date(timestamp) - firstTime;
      const hoursUsed = timeDiffMs / (1000 * 60 * 60);
      const updates = {
        consumo_total_kwh: parseFloat(currentConsumption.toFixed(6)),
        potencia_pico_w: Math.round(newPeakPower),
        potencia_promedio_w: parseFloat(newAvg.toFixed(2)),
        horas_uso_estimadas: parseFloat(hoursUsed.toFixed(2)),
        costo_estimado: parseFloat((currentConsumption * 0.50).toFixed(4)),
        dias_alto_consumo: newPeakPower > 1000 ? 1 : 0,
        eficiencia_categoria: newAvg >= 100 ? 'A' : (newAvg >= 50 ? 'M' : (newAvg >= 10 ? 'B' : 'C')),
        updated_at: getPeruTimestamp(),
        has_data: true,
        raw_readings_count: readingsCount,
        last_reading_time: getPeruTimestamp(new Date(timestamp)),
        energy_end: energy,
        reset_detected: resetDetected || dayRecord.reset_detected
      };
      if (!dayRecord.first_reading_time) {
        updates.first_reading_time = getPeruTimestamp(new Date(timestamp));
      }
      await supabase
        .from("historicos_compactos")
        .update(updates)
        .eq("id", dayRecord.id);
      console.log(`📊 [DAY-STATS] ${deviceId}: Actualizado día local ${serverLocalDateStr} (lectura #${readingsCount})${resetDetected ? ' - RESET' : ''}`);
    }
    return isNewRecord;
  } catch (e) {
    console.error(`💥 [DAY-STATS] ${deviceId}: Error:`, e.message);
    return false;
  }
};
async function updateDeviceInSupabase(deviceId, updates) {
  try {
    const { data, error } = await supabase
      .from("devices")
      .update({
        ...updates,
        updated_at: getPeruTimestamp(),  // 🔥 Cambiado a hora peruana
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
async function saveToLecturasRawOptimized(deviceId, data, finalEnergy, timestampStr = getPeruTimestamp()) {
  try {
    if (!deviceCounters[deviceId]) {
      deviceCounters[deviceId] = 0;
    }
    deviceCounters[deviceId]++;
    if (deviceCounters[deviceId] % DATA_CONFIG.saveEveryNReadings !== 0) {
      return false;
    }
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
    const { error: insertError } = await supabase
      .from("lecturas_raw")
      .insert({
        device_id: deviceId,
        power: Math.round(data.power),
        energy: parseFloat(finalEnergy.toFixed(4)),
        voltage: Math.round(data.voltage),
        current: parseFloat(data.current.toFixed(3)),
        timestamp: timestampStr // 🔥 Usa timestamp ajustado (local Peru)
      });
    if (insertError) {
      console.error(`❌ [RAW-DATA] ${deviceId}:`, insertError.message);
      return false;
    }
    if (deviceCounters[deviceId] % (DATA_CONFIG.saveEveryNReadings * 10) === 0) {
      console.log(`💾 [RAW-DATA] ${deviceId}: Guardado (${deviceCounters[deviceId]} lecturas procesadas)`);
    }
    return true;
  } catch (e) {
    console.error(`💥 [RAW-DATA] ${deviceId}:`, e.message);
    return false;
  }
}
// 📍 ENDPOINT: Ver estadísticas del día actual en tiempo real
app.get("/api/today-stats/:deviceId", async (req, res) => {
  try {
    const { deviceId } = req.params;
    const todayStr = new Date().toISOString().split('T')[0];

    const { data: dayStats, error } = await supabase
      .from("historicos_compactos")
      .select("*")
      .eq("device_id", deviceId)
      .eq("tipo_periodo", 'D')
      .eq("fecha_inicio", todayStr)
      .single();

    if (error) {
      return res.json({
        success: true,
        has_data: false,
        message: "Aún no hay datos para hoy",
        deviceId: deviceId,
        today: todayStr
      });
    }

    // Calcular estadísticas adicionales
    const horasTranscurridas = new Date().getHours() + (new Date().getMinutes() / 60);
    const proyeccionDiaria = dayStats.consumo_total_kwh * (24 / horasTranscurridas);

    // 🔥 CORRECCIÓN: Agregar comparación con ayer para concienciar
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    const { data: yesterdayStats } = await supabase
      .from("historicos_compactos")
      .select("consumo_total_kwh, costo_estimado, horas_uso_estimadas")
      .eq("device_id", deviceId)
      .eq("tipo_periodo", 'D')
      .eq("fecha_inicio", yesterdayStr)
      .single();

    let comparison = {
      consumoChange: 'N/A',
      costoChange: 'N/A',
      horasChange: 'N/A',
      message: 'No hay datos de ayer para comparar'
    };
    if (yesterdayStats) {
      const consumoChange = ((dayStats.consumo_total_kwh - yesterdayStats.consumo_total_kwh) / yesterdayStats.consumo_total_kwh * 100).toFixed(1);
      const costoChange = ((dayStats.costo_estimado - yesterdayStats.costo_estimado) / yesterdayStats.costo_estimado * 100).toFixed(1);
      const horasChange = ((dayStats.horas_uso_estimadas - yesterdayStats.horas_uso_estimadas) / yesterdayStats.horas_uso_estimadas * 100).toFixed(1);
      comparison = {
        consumoChange: parseFloat(consumoChange),
        costoChange: parseFloat(costoChange),
        horasChange: parseFloat(horasChange),
        message: consumoChange > 0 ? `Consumo ${consumoChange}% mayor que ayer - considera revisar uso` : `Consumo ${Math.abs(consumoChange)}% menor que ayer - buen ahorro!`
      };
    }

    res.json({
      success: true,
      has_data: true,
      stats: dayStats,
      projections: {
        horas_transcurridas: parseFloat(horasTranscurridas.toFixed(1)),
        proyeccion_diaria_kwh: parseFloat(proyeccionDiaria.toFixed(3)),
        proyeccion_costo: parseFloat((proyeccionDiaria * 0.50).toFixed(2))
      },
      // 🔥 CORRECCIÓN: Agregar para concienciar
      awareness: {
        fullDayConsumption: dayStats.consumo_total_kwh,
        startEnergy: dayStats.energy_start || 'N/A',
        endEnergy: dayStats.energy_end || 'N/A',
        usageHours: dayStats.horas_uso_estimadas,
        comparisonWithYesterday: comparison,
        environmentalImpact: {
          co2Saved: dayStats.consumo_total_kwh < (yesterdayStats?.consumo_total_kwh || 0) ? 'Reducción en emisiones hoy' : 'Oportunidad para reducir CO2'
        }
      },
      message: `Datos actualizados: ${dayStats.raw_readings_count || 0} lecturas procesadas`,
      last_updated: dayStats.updated_at || dayStats.timestamp_creacion,
      timestamp: getPeruTimestamp() // 🔥 Hora peruana
    });

  } catch (e) {
    console.error("💥 /api/today-stats/:deviceId", e.message);
    res.status(500).json({
      success: false,
      error: e.message
    });
  }
});
// 🔥 CORREGIDO: Función de limpieza automática de datos antiguos
async function cleanupOldRawData() {
  try {
    const now = new Date();
    console.log(`🧹 [CLEANUP-AUTO] Iniciando limpieza automática a las ${now.toLocaleTimeString()}`);

    // Calcular fecha de corte (hoy - keepRawDataDays)
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - DATA_CONFIG.keepRawDataDays);
    const cutoffDateStr = cutoffDate.toISOString().split('T')[0];

    console.log(`🧹 [CLEANUP-AUTO] Eliminando lecturas_raw anteriores a: ${cutoffDateStr}`);

    // 🔥 ELIMINAR TODAS LAS LECTURAS RAW DE DÍAS ANTERIORES
    const { error: deleteError, count } = await supabase
      .from("lecturas_raw")
      .delete()
      .lt("timestamp", `${cutoffDateStr}T23:59:59`);

    if (deleteError) {
      console.error(`❌ [CLEANUP-AUTO] Error eliminando lecturas antiguas:`, deleteError.message);
    } else {
      console.log(`✅ [CLEANUP-AUTO] Limpieza completada. Eliminadas lecturas anteriores a ${cutoffDateStr}`);
    }

    cleanupExecuted = true;

  } catch (e) {
    console.error(`💥 [CLEANUP-AUTO] Error en limpieza:`, e.message);
  }
}
async function generateDailySummaryOptimized() {
  try {
    const today = new Date();
    const yesterdayMs = Date.now() - 24 * 60 * 60 * 1000;
    const yesterdayStr = getPeruDateStr(new Date(yesterdayMs)); // CORRECCIÓN: Usar getPeruDateStr

    if (yesterdayStr > getPeruDateStr(today)) {
      console.warn(`⚠️ [DAILY-SUMMARY] Fecha yesterday futura, abortando`);
      return;
    }

    console.log(`📊 [DAILY-SUMMARY] Generando para ${yesterdayStr}...`);

    const { data: allDevices, error: devicesError } = await supabase
      .from("devices")
      .select("esp32_id")
      .not("esp32_id", "is", null);

    if (devicesError || !allDevices || allDevices.length === 0) {
      console.log(`ℹ️ [DAILY-SUMMARY] No hay dispositivos registrados`);
      return;
    }

    console.log(`📊 [DAILY-SUMMARY] Procesando ${allDevices.length} dispositivos registrados`);

    let processed = 0;
    let errors = 0;
    let skippedNoData = 0;

    const promises = allDevices.map(async (device) => {
      try {
        const esp32Id = device.esp32_id;

        const { data: stats, error: statsError } = await supabase
          .from("lecturas_raw")
          .select(`
            min(energy) as min_energy,
            max(energy) as max_energy,
            max(power) as max_power,
            avg(power) as avg_power,
            count(*) as total_readings,
            min(timestamp) as first_reading,
            max(timestamp) as last_reading
          `)
          .eq("device_id", esp32Id)
          .gte("timestamp", `${yesterdayStr}T00:00:00`)
          .lt("timestamp", `${yesterdayStr}T23:59:59`)
          .single();

        let consumoKwh = 0;
        let potenciaPico = 0;
        let potenciaPromedio = 0;
        let horasUso = 0;
        let totalReadings = 0;
        let hasData = false;

        if (!statsError && stats && stats.total_readings > 0) {
          consumoKwh = (parseFloat(stats.max_energy || 0) - parseFloat(stats.min_energy || 0));
          potenciaPico = parseFloat(stats.max_power || 0);
          potenciaPromedio = parseFloat(stats.avg_power || 0);
          totalReadings = parseInt(stats.total_readings || 0);
          hasData = true;

          if (stats.first_reading && stats.last_reading && totalReadings >= 2) {
            const timeDiffMs = new Date(stats.last_reading) - new Date(stats.first_reading);
            horasUso = timeDiffMs / (1000 * 60 * 60);
          } else {
            horasUso = 0.1;
          }
        } else {
          console.log(`ℹ️ [DAILY-SUMMARY] ${esp32Id}: Sin lecturas en ${yesterdayStr}`);
          skippedNoData++;
        }

        const costoEstimado = consumoKwh * 0.50;
        let categoria = 'B';
        if (hasData) {
          if (potenciaPromedio >= 100) categoria = 'A';
          else if (potenciaPromedio >= 50) categoria = 'M';
          else if (potenciaPromedio < 10) categoria = 'C';
        } else {
          categoria = 'N';
        }

        const { error: upsertError } = await supabase
          .from("historicos_compactos")
          .upsert({
            device_id: esp32Id,
            tipo_periodo: 'D',
            fecha_inicio: yesterdayStr,
            consumo_total_kwh: parseFloat(consumoKwh.toFixed(6)),
            potencia_pico_w: Math.round(potenciaPico),
            potencia_promedio_w: parseFloat(potenciaPromedio.toFixed(2)),
            horas_uso_estimadas: parseFloat(horasUso.toFixed(2)),
            costo_estimado: parseFloat(costoEstimado.toFixed(4)),
            dias_alto_consumo: potenciaPico > 1000 ? 1 : 0,
            eficiencia_categoria: categoria,
            timestamp_creacion: getPeruTimestamp(),
            has_data: hasData,
            raw_readings_count: totalReadings,
            updated_at: getPeruTimestamp()
          }, {
            onConflict: 'device_id,tipo_periodo,fecha_inicio'
          });

        if (upsertError) {
          console.error(`❌ [DAILY-SUMMARY] ${esp32Id}:`, upsertError.message);
          errors++;
          return null;
        }

        processed++;
        if (hasData && totalReadings > 0) {
          await supabase
            .from("devices")
            .update({
              daily_consumption: consumoKwh,
              last_daily_summary: yesterdayStr,
              updated_at: getPeruTimestamp()
            })
            .eq("esp32_id", esp32Id);
        }

        const { error: deleteError } = await supabase
          .from("lecturas_raw")
          .delete()
          .eq("device_id", esp32Id)
          .gte("timestamp", `${yesterdayStr}T00:00:00`)
          .lt("timestamp", `${yesterdayStr}T23:59:59`);

        if (!deleteError) {
          console.log(`🧹 [DAILY-SUMMARY] ${esp32Id}: Eliminadas lecturas raw de ${yesterdayStr}`);
        }

        return {
          device: esp32Id,
          consumo: consumoKwh,
          hasData: hasData,
          readings: totalReadings
        };
      } catch (deviceError) {
        console.error(`💥 [DAILY-SUMMARY] Error en ${device.esp32_id}:`, deviceError.message);
        errors++;
        return null;
      }
    });

    await Promise.all(promises);
    await cleanupOldRawData();

    if (yesterday.getDay() === 0) {
      await generateWeeklySummaryOptimized(yesterday);
    }

    const tomorrow = new Date(yesterday);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (tomorrow.getDate() === 1) {
      await generateMonthlySummaryOptimized(yesterday);
    }

    console.log(`✅ [DAILY-SUMMARY] COMPLETADO: ${processed} procesados, ${skippedNoData} sin datos, ${errors} errores`);
    dailySummaryExecuted = true;
  } catch (e) {
    console.error(`💥 [DAILY-SUMMARY] Error general:`, e.message);
    console.error(e.stack);
  }
}
async function generateWeeklySummaryOptimized(lastDayOfWeek) {
  try {
    const weekStart = new Date(lastDayOfWeek);
    weekStart.setDate(weekStart.getDate() - 6); // Retroceder 6 días para empezar la semana
    const weekStartStr = weekStart.toISOString().split('T')[0];
    console.log(`🗓️ [WEEKLY-SUMMARY] Generando para semana ${weekStartStr}`);
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
      .lte("fecha_inicio", lastDayOfWeek.toISOString().split('T')[0])
      .group("device_id");
    if (error || !weeklyData) return;
    for (const item of weeklyData) {
      await supabase
        .from("historicos_compactos")
        .upsert({
          device_id: item.device_id,
          tipo_periodo: 'W', // Semanal
          fecha_inicio: weekStartStr,
          consumo_total_kwh: parseFloat(item.total_kwh.toFixed(3)),
          potencia_pico_w: item.max_pico,
          potencia_promedio_w: parseFloat(item.avg_potencia.toFixed(2)),
          timestamp_creacion: getPeruTimestamp()  // 🔥 Cambiado a hora peruana
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
          timestamp_creacion: getPeruTimestamp()  // 🔥 Cambiado a hora peruana
        }, {
          onConflict: 'device_id,tipo_periodo,fecha_inicio'
        });
      // 🔥 Actualizar consumo mensual en devices
      await supabase
        .from("devices")
        .update({
          monthly_consumption: item.total_kwh,
          updated_at: getPeruTimestamp()  // 🔥 Cambiado a hora peruana
        })
        .eq("esp32_id", item.device_id);
    }
    console.log(`✅ [MONTHLY-SUMMARY] ${monthlyData.length} dispositivos procesados`);
  } catch (e) {
    console.error(`💥 [MONTHLY-SUMMARY] Error:`, e.message);
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

// 📍 ENDPOINT: Forzar generación de datos históricos
app.post("/api/force-generate-historical/:deviceId", async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { days = 7 } = req.body; // Número de días a generar

    if (!deviceId) {
      return res.status(400).json({
        success: false,
        error: "Falta deviceId"
      });
    }

    console.log(`🔄 [FORCE-GENERATE] Generando datos históricos para ${deviceId} (${days} días)`);

    // Verificar que el dispositivo existe
    const { data: device, error: deviceError } = await supabase
      .from("devices")
      .select("id, esp32_id, name")
      .eq("esp32_id", deviceId)
      .single();

    if (deviceError || !device) {
      return res.status(404).json({
        success: false,
        error: "Dispositivo no encontrado"
      });
    }

    // Generar datos para los últimos N días
    let generated = 0;
    const today = new Date();

    for (let i = 0; i < days; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];

      // Buscar datos en lecturas_raw para este día
      const { data: dayData, error: dayError } = await supabase
        .from("lecturas_raw")
        .select(`
          min(energy) as min_energy,
          max(energy) as max_energy,
          max(power) as max_power,
          avg(power) as avg_power,
          count(*) as total_readings
        `)
        .eq("device_id", deviceId)
        .gte("timestamp", `${dateStr}T00:00:00`)
        .lt("timestamp", `${dateStr}T23:59:59`)
        .single();

      if (!dayError && dayData && dayData.total_readings > 0) {
        const consumoKwh = (dayData.max_energy - dayData.min_energy);
        const potenciaPico = dayData.max_power;
        const potenciaPromedio = dayData.avg_power;
        const horasUso = consumoKwh / (potenciaPromedio / 1000) || 0;
        const costoEstimado = consumoKwh * 0.50;

        let categoria = 'B';
        if (potenciaPromedio >= 100) categoria = 'A';
        else if (potenciaPromedio >= 50) categoria = 'M';

        await supabase
          .from("historicos_compactos")
          .upsert({
            device_id: deviceId,
            tipo_periodo: 'D',
            fecha_inicio: dateStr,
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

        generated++;
      }
    }

    res.json({
      success: true,
      message: `Generados ${generated} días de datos históricos para ${device.name}`,
      device: device.name,
      daysGenerated: generated,
      totalDaysRequested: days,
      timestamp: new Date().toISOString()
    });

  } catch (e) {
    console.error("💥 /api/force-generate-historical/:deviceId", e.message);
    res.status(500).json({
      success: false,
      error: e.message
    });
  }
});

// 🔥 CORREGIDO: Programación de tareas optimizadas con hora peruana
function scheduleOptimizedTasks() {
  console.log("⏰ [SCHEDULER] Iniciando programación de tareas optimizadas...");
  console.log(`⏰ Hora actual del servidor: ${new Date().toString()}`);

  // 🔥 Programar resumen diario a las 23:59 hora Perú
  const now = new Date();
  const targetTimeDaily = new Date(now);
  targetTimeDaily.setHours(DATA_CONFIG.dailySummaryHour, DATA_CONFIG.dailySummaryMinute, 0, 0);

  if (now > targetTimeDaily) {
    targetTimeDaily.setDate(targetTimeDaily.getDate() + 1);
  }

  const msUntilDaily = targetTimeDaily.getTime() - now.getTime();

  console.log(`⏰ [SCHEDULER] Resumen diario programado para: ${targetTimeDaily.toLocaleTimeString()} (en ${Math.round(msUntilDaily / 1000 / 60)} minutos)`);

  setTimeout(() => {
    console.log("🔄 [SCHEDULER] Ejecutando resumen diario programado...");
    generateDailySummaryOptimized();
    // Repetir cada 24 horas
    setInterval(() => {
      console.log("🔄 [SCHEDULER] Ejecutando resumen diario programado (intervalo)...");
      generateDailySummaryOptimized();
    }, 24 * 60 * 60 * 1000);
  }, msUntilDaily);

  // 🔥 Programar limpieza automática a las 00:05 hora Perú
  const targetTimeCleanup = new Date(now);
  targetTimeCleanup.setHours(DATA_CONFIG.cleanupHour, DATA_CONFIG.cleanupMinute, 0, 0);

  if (now > targetTimeCleanup) {
    targetTimeCleanup.setDate(targetTimeCleanup.getDate() + 1);
  }

  const msUntilCleanup = targetTimeCleanup.getTime() - now.getTime();

  console.log(`⏰ [SCHEDULER] Limpieza automática programada para: ${targetTimeCleanup.toLocaleTimeString()} (en ${Math.round(msUntilCleanup / 1000 / 60)} minutos)`);

  setTimeout(() => {
    console.log("🧹 [SCHEDULER] Ejecutando limpieza automática...");
    cleanupOldRawData();
    // Repetir cada 24 horas
    setInterval(() => {
      console.log("🧹 [SCHEDULER] Ejecutando limpieza automática (intervalo)...");
      cleanupOldRawData();
    }, 24 * 60 * 60 * 1000);
  }, msUntilCleanup);

  console.log("✅ [SCHEDULER] Tareas programadas correctamente (resumen diario y limpieza)");
}

// 📍 ENDPOINT: Ver estado de procesamiento diario
app.get("/api/day-status/:deviceId", async (req, res) => {
  try {
    const { deviceId } = req.params;
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    // Verificar registros en historicos_compactos
    const { data: todayRecord } = await supabase
      .from("historicos_compactos")
      .select("*")
      .eq("device_id", deviceId)
      .eq("tipo_periodo", 'D')
      .eq("fecha_inicio", today)
      .single();
    const { data: yesterdayRecord } = await supabase
      .from("historicos_compactos")
      .select("*")
      .eq("device_id", deviceId)
      .eq("tipo_periodo", 'D')
      .eq("fecha_inicio", yesterdayStr)
      .single();
    // Contar lecturas raw de hoy y ayer
    const { count: todayRawCount } = await supabase
      .from("lecturas_raw")
      .select("*", { count: 'exact', head: true })
      .eq("device_id", deviceId)
      .gte("timestamp", `${today}T00:00:00`)
      .lt("timestamp", `${today}T23:59:59`);
    const { count: yesterdayRawCount } = await supabase
      .from("lecturas_raw")
      .select("*", { count: 'exact', head: true })
      .eq("device_id", deviceId)
      .gte("timestamp", `${yesterdayStr}T00:00:00`)
      .lt("timestamp", `${yesterdayStr}T23:59:59`);
    res.json({
      success: true,
      deviceId: deviceId,
      today: {
        date: today,
        hasRecord: !!todayRecord,
        recordData: todayRecord,
        rawReadings: todayRawCount || 0
      },
      yesterday: {
        date: yesterdayStr,
        hasRecord: !!yesterdayRecord,
        recordData: yesterdayRecord,
        rawReadings: yesterdayRawCount || 0
      },
      onlineState: onlineDevices[deviceId] ? {
        energy: onlineDevices[deviceId].energy,
        lastSeen: getPeruTimestamp(onlineDevices[deviceId].lastSeen), // 🔥 Convertir a hora peruana
        lastDayChange: onlineDevices[deviceId].lastDayChange ?
          getPeruTimestamp(onlineDevices[deviceId].lastDayChange) : null
      } : null,
      timestamp: getPeruTimestamp()
    });
  } catch (e) {
    console.error("💥 /api/day-status/:deviceId", e.message);
    res.status(500).json({
      success: false,
      error: e.message
    });
  }
});
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
      timestamp: clientTimestamp // ← Aceptamos timestamp del ESP32 (UTC)
    } = req.body;
    if (!deviceId) return res.status(400).json({ error: "Falta deviceId." });

    const serverNow = Date.now();
    let currentTime = serverNow;
    let peruTimestamp = getPeruTimestamp();
    let timestampSource = 'server';

    if (clientTimestamp) {
      console.log(`[DATA] ${deviceId} - Timestamp recibido del ESP32: ${clientTimestamp}`);
      const clientDate = new Date(clientTimestamp);
      if (!isNaN(clientDate.getTime())) {
        currentTime = clientDate.getTime();
        peruTimestamp = getPeruTimestamp(clientDate);
        timestampSource = 'client-adjusted';
      } else {
        console.warn(`⚠️ [DATA] ${deviceId} - Timestamp inválido del cliente: ${clientTimestamp}`);
      }
    }

    const data = {
      voltage: +voltage || 0,
      current: +current || 0,
      power: +power || 0,
      energy: +energy || 0,
      frequency: +frequency || 0,
      powerFactor: +powerFactor || 0,
      timestamp: currentTime,
    };

    const deviceInDb = await findDeviceByEsp32Id(deviceId);
    const isRegistered = !!deviceInDb;
    const userId = deviceInDb?.user_id;
    const deviceDbId = deviceInDb?.id;
    const deviceState = initializeDeviceState(deviceId, deviceInDb, wifiSsid);

    const finalEnergy = calculateEnergyAccumulated(deviceState, data.power, currentTime);

    onlineDevices[deviceId] = {
      ...deviceState,
      lastSeen: currentTime,
      lastTs: currentTime,
      lastPower: data.power,
      energy: finalEnergy,
      userId,
      deviceDbId,
      wifiSsid: wifiSsid || deviceState.wifiSsid,
      totalCalculations: (deviceState.totalCalculations || 0) + 1,
      lastData: {
        voltage: data.voltage,
        current: data.current,
        frequency: data.frequency,
        powerFactor: data.powerFactor,
      },
    };

    await updateDailyStatsInRealTime(deviceId, {
      power: data.power,
      energy: finalEnergy,
      timestamp: currentTime
    });

    // 🔥 Detección de cambio de día en hora local Perú (00:00 - 00:05)
    const localDate = new Date(currentTime - 5 * 60 * 60 * 1000); // Ajuste manual a local Peru
    const currentHour = localDate.getHours();
    const currentMinute = localDate.getMinutes();
    const currentLocalDateStr = getPeruDateStr(new Date(currentTime));

    if (currentHour === 0 && currentMinute <= 5) {
      const lastLocalDateStr = deviceState.lastDayChange
        ? getPeruDateStr(new Date(deviceState.lastDayChange))
        : null;
      if (lastLocalDateStr !== currentLocalDateStr) {
        console.log(`🔄 [DIA-DETECTADO] ${deviceId}: Nuevo día local Perú detectado (${currentLocalDateStr})`);
        await checkAndGenerateDailySummaryOptimized(deviceId, currentTime);
        onlineDevices[deviceId].lastDayChange = currentTime;
      }
    }

    // 🔥 Guardar raw con timestamp local Peru ajustado
    await saveToLecturasRawOptimized(deviceId, data, finalEnergy, peruTimestamp);

    if (isRegistered && deviceDbId) {
      const updates = {
        is_online: true,
        last_seen: peruTimestamp,
        power: data.power,
        energy: finalEnergy,
        voltage: data.voltage,
        current: data.current,
        frequency: data.frequency,
        power_factor: data.powerFactor,
        total_energy: finalEnergy,
      };
      if (wifiSsid && wifiSsid !== deviceInDb.wifi_ssid) {
        updates.wifi_ssid = wifiSsid;
        updates.network_code = generateNetworkCode(wifiSsid);
      }
      await updateDeviceInSupabase(deviceDbId, updates);
    }

    console.log(
      `[DATA] ${deviceId} → WiFi: "${wifiSsid || 'No SSID'}" | ` +
      `V:${data.voltage.toFixed(1)}V I:${data.current.toFixed(3)}A ` +
      `P:${data.power.toFixed(1)}W E:${finalEnergy.toFixed(6)}kWh ` +
      `| ${isRegistered ? "✅ REGISTRADO" : "⚠️ NO REGISTRADO"} | TS: ${timestampSource}`
    );

    res.json({
      ok: true,
      registered: isRegistered,
      calculatedEnergy: finalEnergy,
      wifiSsid: wifiSsid,
      timestamp: peruTimestamp
    });
  } catch (e) {
    console.error("💥 /api/data", e.message);
    res.status(500).json({ error: e.message });
  }
});
// 📍 ENDPOINT: Generar resúmenes para días pasados específicos
app.post("/api/generate-daily-for-period", async (req, res) => {
  try {
    const { deviceId, startDate, endDate } = req.body;

    if (!deviceId) {
      return res.status(400).json({
        success: false,
        error: "Falta deviceId"
      });
    }

    const start = new Date(startDate);
    const end = new Date(endDate || new Date());

    console.log(`🔄 [FORCE-PERIOD] Generando para ${deviceId} desde ${startDate} hasta ${endDate || 'hoy'}`);

    // Verificar que el dispositivo existe
    const { data: device, error: deviceError } = await supabase
      .from("devices")
      .select("id, esp32_id, name")
      .eq("esp32_id", deviceId)
      .single();

    if (deviceError || !device) {
      return res.status(404).json({
        success: false,
        error: "Dispositivo no encontrado"
      });
    }

    let generated = 0;
    let errors = 0;
    const currentDate = new Date(start);

    // 🔥 Recorrer cada día en el período
    while (currentDate <= end) {
      const dateStr = currentDate.toISOString().split('T')[0];

      // Saltar si ya existe un resumen para este día
      const { data: existing, error: checkError } = await supabase
        .from("historicos_compactos")
        .select("id")
        .eq("device_id", deviceId)
        .eq("tipo_periodo", 'D')
        .eq("fecha_inicio", dateStr)
        .single();

      if (checkError && checkError.code !== 'PGRST116') {
        console.error(`❌ [FORCE-PERIOD] Error verificando ${dateStr}:`, checkError.message);
        errors++;
        currentDate.setDate(currentDate.getDate() + 1);
        continue;
      }

      // 🔥 Si NO existe, generar
      if (!existing) {
        const { data: stats, error: statsError } = await supabase
          .from("lecturas_raw")
          .select(`
            min(energy) as min_energy,
            max(energy) as max_energy,
            max(power) as max_power,
            avg(power) as avg_power,
            count(*) as total_readings,
            min(timestamp) as first_reading,
            max(timestamp) as last_reading
          `)
          .eq("device_id", deviceId)
          .gte("timestamp", `${dateStr}T00:00:00`)
          .lt("timestamp", `${dateStr}T23:59:59`)
          .single();

        let consumoKwh = 0;
        let potenciaPico = 0;
        let potenciaPromedio = 0;
        let horasUso = 0;
        let totalReadings = 0;
        let hasData = false;

        if (!statsError && stats && stats.total_readings > 0) {
          consumoKwh = (parseFloat(stats.max_energy || 0) - parseFloat(stats.min_energy || 0));
          potenciaPico = parseFloat(stats.max_power || 0);
          potenciaPromedio = parseFloat(stats.avg_power || 0);
          totalReadings = parseInt(stats.total_readings || 0);
          hasData = true;

          if (stats.first_reading && stats.last_reading && totalReadings >= 2) {
            const timeDiffMs = new Date(stats.last_reading) - new Date(stats.first_reading);
            const timeDiffHours = timeDiffMs / (1000 * 60 * 60);
            horasUso = Math.min(timeDiffHours, 24);
          }
        }

        const costoEstimado = consumoKwh * 0.50;

        let categoria = 'B';
        if (hasData) {
          if (potenciaPromedio >= 100) categoria = 'A';
          else if (potenciaPromedio >= 50) categoria = 'M';
          else if (potenciaPromedio < 10) categoria = 'C';
        } else {
          categoria = 'N';
        }

        const { error: upsertError } = await supabase
          .from("historicos_compactos")
          .upsert({
            device_id: deviceId,
            tipo_periodo: 'D',
            fecha_inicio: dateStr,
            consumo_total_kwh: parseFloat(consumoKwh.toFixed(6)),
            potencia_pico_w: Math.round(potenciaPico),
            potencia_promedio_w: parseFloat(potenciaPromedio.toFixed(2)),
            horas_uso_estimadas: parseFloat(horasUso.toFixed(2)),
            costo_estimado: parseFloat(costoEstimado.toFixed(4)),
            dias_alto_consumo: potenciaPico > 1000 ? 1 : 0,
            eficiencia_categoria: categoria,
            timestamp_creacion: new Date().toISOString(),
            has_data: hasData,
            raw_readings_count: totalReadings,
            retroactively_generated: true
          }, {
            onConflict: 'device_id,tipo_periodo,fecha_inicio'
          });

        if (!upsertError) {
          generated++;
          console.log(`✅ [FORCE-PERIOD] ${dateStr}: ${hasData ? `${consumoKwh.toFixed(6)} kWh (${totalReadings} lecturas)` : 'Sin datos'}`);
        } else {
          errors++;
          console.error(`❌ [FORCE-PERIOD] ${dateStr}:`, upsertError.message);
        }
      }

      currentDate.setDate(currentDate.getDate() + 1);
    }

    res.json({
      success: true,
      message: `Generados ${generated} días de datos históricos para ${device.name}`,
      device: device.name,
      period: `${startDate} a ${endDate || 'hoy'}`,
      generated: generated,
      errors: errors,
      timestamp: new Date().toISOString()
    });

  } catch (e) {
    console.error("💥 /api/generate-daily-for-period", e.message);
    res.status(500).json({
      success: false,
      error: e.message
    });
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
          ? getPeruTimestamp(onlineState.lastSeen)
          : getPeruTimestamp(new Date(device.last_seen || device.updated_at).getTime()) || 0,
        calculationInfo: isOnline
          ? {
            totalCalculations: onlineState.totalCalculations,
            lastCalculation: getPeruTimestamp(new Date(onlineState.lastTs)),
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

// 📍 ENDPOINT: Forzar limpieza de datos antiguos
app.post("/api/force-cleanup", async (req, res) => {
  try {
    console.log(`🧹 [FORCE-CLEANUP] Ejecutando limpieza manual...`);
    await cleanupOldRawData();

    res.json({
      success: true,
      message: "Limpieza ejecutada exitosamente",
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    console.error("💥 /api/force-cleanup", e.message);
    res.status(500).json({
      success: false,
      error: e.message
    });
  }
});

// 📍 ENDPOINT: Análisis diario ultra-detallado con precisión mejorada
app.get("/api/daily-analysis-detailed/:deviceId", async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { date = new Date().toISOString().split('T')[0], includeRawData = "false" } = req.query;
    if (!deviceId) {
      return res.status(400).json({
        success: false,
        error: "Falta deviceId"
      });
    }
    console.log(`📊 [DAILY-DETAILED] Solicitado para ${deviceId}, fecha: ${date}`);
    // 🔥 1. OBTENER DATOS DEL DÍA DESDE HISTORICOS_COMPACTOS
    const { data: dayStats, error: dayError } = await supabase
      .from("historicos_compactos")
      .select("*")
      .eq("device_id", deviceId)
      .eq("tipo_periodo", 'D')
      .eq("fecha_inicio", date)
      .single();
    if (dayError && dayError.code !== 'PGRST116') {
      console.error("❌ Error obteniendo día:", dayError.message);
      return res.status(500).json({
        success: false,
        error: "Error obteniendo datos del día"
      });
    }
    // 🔥 2. OBTENER LECTURAS RAW DEL DÍA PARA CÁLCULOS PRECISOS
    const { data: rawReadings, error: rawError } = await supabase
      .from("lecturas_raw")
      .select(`
        timestamp,
        power,
        energy,
        voltage,
        current,
        id
      `)
      .eq("device_id", deviceId)
      .gte("timestamp", `${date}T00:00:00`)
      .lt("timestamp", `${date}T23:59:59.999`)
      .order("timestamp", { ascending: true });
    if (rawError) {
      console.error("❌ Error obteniendo lecturas raw:", rawError.message);
    }
    const readings = rawReadings || [];
    // 🔥 3. CÁLCULOS PRECISOS MEJORADOS
    let detailedAnalysis = {
      date: date,
      hasData: readings.length > 0,
      totalReadings: readings.length,
      // 🔥 TIMESTAMPS PRECISOS
      timestamps: {
        firstReading: readings.length > 0 ? readings[0].timestamp : null,
        lastReading: readings.length > 0 ? readings[readings.length - 1].timestamp : null,
        durationHours: 0,
        durationHuman: ""
      },
      // 🔥 CONSUMO ENERGÉTICO PRECISO
      energy: {
        startKwh: readings.length > 0 ? readings[0].energy : 0,
        endKwh: readings.length > 0 ? readings[readings.length - 1].energy : 0,
        consumedKwh: 0,
        costSoles: 0,
        costPerHour: 0
      },
      // 🔥 POTENCIA DETALLADA
      power: {
        avg: 0,
        max: 0,
        min: 0,
        maxTimestamp: null,
        // 🔥 DISTRIBUCIÓN POR RANGOS
        distribution: {
          veryLow: 0, // 0-20W
          low: 0, // 21-50W
          medium: 0, // 51-150W
          high: 0, // 151-500W
          veryHigh: 0 // >500W
        }
      },
      // 🔥 VOLTAJE Y CORRIENTE
      electrical: {
        avgVoltage: 0,
        avgCurrent: 0,
        voltageStability: 0,
        currentStability: 0
      },
      // 🔥 ANÁLISIS TEMPORAL
      timeAnalysis: {
        activeHours: [],
        peakHours: [],
        offPeakHours: [],
        usagePattern: ""
      },
      // 🔥 RECOMENDACIONES PERSONALIZADAS
      recommendations: []
    };
    // 🔥 4. CÁLCULOS DETALLADOS SI HAY DATOS
    if (readings.length > 0) {
      // 🔥 CALCULAR DURACIÓN REAL (NO ESTIMADA)
      const firstTimestamp = new Date(readings[0].timestamp);
      const lastTimestamp = new Date(readings[readings.length - 1].timestamp);
      const durationMs = lastTimestamp - firstTimestamp;
      const durationHours = durationMs / (1000 * 60 * 60);
      detailedAnalysis.timestamps.durationHours = parseFloat(durationHours.toFixed(4));
      detailedAnalysis.timestamps.durationHuman = formatDuration(durationMs);
      // 🔥 CONSUMO REAL (NO CALCULADO)
      const startEnergy = readings[0].energy;
      const endEnergy = readings[readings.length - 1].energy;
      const consumedKwh = Math.max(0, endEnergy - startEnergy);

      detailedAnalysis.energy.startKwh = parseFloat(startEnergy.toFixed(6));
      detailedAnalysis.energy.endKwh = parseFloat(endEnergy.toFixed(6));
      detailedAnalysis.energy.consumedKwh = parseFloat(consumedKwh.toFixed(6));
      detailedAnalysis.energy.costSoles = parseFloat((consumedKwh * 0.50).toFixed(4));
      detailedAnalysis.energy.costPerHour = durationHours > 0
        ? parseFloat((detailedAnalysis.energy.costSoles / durationHours).toFixed(4))
        : 0;
      // 🔥 ANÁLISIS DE POTENCIA DETALLADO
      const powers = readings.map(r => r.power);
      const voltages = readings.map(r => r.voltage);
      const currents = readings.map(r => r.current);

      // Promedios
      detailedAnalysis.power.avg = parseFloat((powers.reduce((a, b) => a + b, 0) / powers.length).toFixed(2));
      detailedAnalysis.power.max = Math.max(...powers);
      detailedAnalysis.power.min = Math.min(...powers);

      // Encontrar timestamp de potencia máxima (convertido a hora peruana)
      const maxPowerReading = readings.find(r => r.power === detailedAnalysis.power.max);
      detailedAnalysis.power.maxTimestamp = maxPowerReading ? getPeruTimestamp(new Date(maxPowerReading.timestamp)) : null;

      // Distribución de potencia
      powers.forEach(power => {
        if (power <= 20) detailedAnalysis.power.distribution.veryLow++;
        else if (power <= 50) detailedAnalysis.power.distribution.low++;
        else if (power <= 150) detailedAnalysis.power.distribution.medium++;
        else if (power <= 500) detailedAnalysis.power.distribution.high++;
        else detailedAnalysis.power.distribution.veryHigh++;
      });

      // Convertir a porcentajes
      Object.keys(detailedAnalysis.power.distribution).forEach(key => {
        detailedAnalysis.power.distribution[key] = parseFloat(
          (detailedAnalysis.power.distribution[key] / powers.length * 100).toFixed(1)
        );
      });
      // 🔥 ANÁLISIS ELÉCTRICO
      detailedAnalysis.electrical.avgVoltage = parseFloat((voltages.reduce((a, b) => a + b, 0) / voltages.length).toFixed(1));
      detailedAnalysis.electrical.avgCurrent = parseFloat((currents.reduce((a, b) => a + b, 0) / currents.length).toFixed(3));

      // Calcular estabilidad (desviación estándar relativa)
      const voltageStd = calculateStdDev(voltages);
      const currentStd = calculateStdDev(currents);
      detailedAnalysis.electrical.voltageStability = parseFloat((100 - (voltageStd / detailedAnalysis.electrical.avgVoltage * 100)).toFixed(1));
      detailedAnalysis.electrical.currentStability = parseFloat((100 - (currentStd / detailedAnalysis.electrical.avgCurrent * 100)).toFixed(1));
      // 🔥 ANÁLISIS TEMPORAL POR HORAS
      const hourlyAnalysis = {};
      readings.forEach(reading => {
        const date = new Date(reading.timestamp);
        const hour = date.getHours();
        if (!hourlyAnalysis[hour]) {
          hourlyAnalysis[hour] = { totalPower: 0, count: 0, maxPower: 0 };
        }
        hourlyAnalysis[hour].totalPower += reading.power;
        hourlyAnalysis[hour].count++;
        hourlyAnalysis[hour].maxPower = Math.max(hourlyAnalysis[hour].maxPower, reading.power);
      });
      // Identificar horas activas, pico y valle
      const hourlyAverages = Object.keys(hourlyAnalysis).map(hour => ({
        hour: parseInt(hour),
        avgPower: hourlyAnalysis[hour].totalPower / hourlyAnalysis[hour].count,
        maxPower: hourlyAnalysis[hour].maxPower
      }));
      const overallAvgPower = hourlyAverages.reduce((sum, h) => sum + h.avgPower, 0) / hourlyAverages.length;

      detailedAnalysis.timeAnalysis.activeHours = hourlyAverages
        .filter(h => h.avgPower > 10)
        .map(h => h.hour)
        .sort((a, b) => a - b);

      detailedAnalysis.timeAnalysis.peakHours = hourlyAverages
        .filter(h => h.avgPower > overallAvgPower * 1.5)
        .map(h => h.hour)
        .sort((a, b) => a - b);

      detailedAnalysis.timeAnalysis.offPeakHours = hourlyAverages
        .filter(h => h.avgPower < overallAvgPower * 0.3)
        .map(h => h.hour)
        .sort((a, b) => a - b);
      // Determinar patrón de uso
      if (detailedAnalysis.timeAnalysis.activeHours.length === 0) {
        detailedAnalysis.timeAnalysis.usagePattern = "Sin actividad";
      } else if (detailedAnalysis.timeAnalysis.activeHours.length <= 4) {
        detailedAnalysis.timeAnalysis.usagePattern = "Uso esporádico";
      } else if (detailedAnalysis.timeAnalysis.peakHours.length > 2) {
        detailedAnalysis.timeAnalysis.usagePattern = "Uso intensivo";
      } else if (detailedAnalysis.timeAnalysis.activeHours.length > 8) {
        detailedAnalysis.timeAnalysis.usagePattern = "Uso continuo";
      } else {
        detailedAnalysis.timeAnalysis.usagePattern = "Uso moderado";
      }
      // 🔥 GENERAR RECOMENDACIONES PERSONALIZADAS
      detailedAnalysis.recommendations = generateRecommendations(detailedAnalysis);
    }
    // 🔥 5. COMPARAR CON DÍA ANTERIOR
    const previousDate = new Date(date);
    previousDate.setDate(previousDate.getDate() - 1);
    const previousDateStr = previousDate.toISOString().split('T')[0];
    const { data: previousDayStats, error: previousError } = await supabase
      .from("historicos_compactos")
      .select("*")
      .eq("device_id", deviceId)
      .eq("tipo_periodo", 'D')
      .eq("fecha_inicio", previousDateStr)
      .single();
    let comparison = null;
    if (!previousError && previousDayStats) {
      const currentConsumption = detailedAnalysis.energy.consumedKwh || dayStats?.consumo_total_kwh || 0;
      const previousConsumption = previousDayStats.consumo_total_kwh || 0;
      const changePercent = previousConsumption > 0
        ? ((currentConsumption - previousConsumption) / previousConsumption * 100)
        : 0;
      comparison = {
        date: previousDateStr,
        previousConsumption: parseFloat(previousConsumption.toFixed(6)),
        currentConsumption: parseFloat(currentConsumption.toFixed(6)),
        changePercent: parseFloat(changePercent.toFixed(1)),
        trend: changePercent > 10 ? "↑ AUMENTO" : changePercent < -10 ? "↓ DISMINUCIÓN" : "↔ ESTABLE",
        message: changePercent > 10
          ? `Consumo ${Math.abs(changePercent).toFixed(1)}% mayor que ayer`
          : changePercent < -10
            ? `Consumo ${Math.abs(changePercent).toFixed(1)}% menor que ayer`
            : "Consumo similar al día anterior"
      };
    }
    // 🔥 6. PREPARAR RESPUESTA CON TODOS LOS DATOS
    const response = {
      success: true,
      deviceId: deviceId,
      date: date,
      summary: {
        // 🔥 DATOS EXISTENTES (compatibilidad)
        ...(dayStats || {}),
        // 🔥 SOBREESCRIBIR CON DATOS PRECISOS
        horas_uso_estimadas: detailedAnalysis.timestamps.durationHours,
        consumo_total_kwh: detailedAnalysis.energy.consumedKwh,
        costo_estimado: detailedAnalysis.energy.costSoles,
        // 🔥 AGREGAR CAMPOS NUEVOS
        first_reading_time: detailedAnalysis.timestamps.firstReading,
        last_reading_time: detailedAnalysis.timestamps.lastReading,
        duration_human: detailedAnalysis.timestamps.durationHuman,
        energy_start: detailedAnalysis.energy.startKwh,
        energy_end: detailedAnalysis.energy.endKwh
      },
      detailedAnalysis: detailedAnalysis,
      comparison: comparison,
      // 🔥 DATOS RAW SI SE SOLICITAN
      rawData: includeRawData === "true" ? readings.slice(0, 100) : undefined,
      metadata: {
        calculationsBasedOn: readings.length > 0 ? "lecturas_raw" : "historicos_compactos",
        readingsProcessed: readings.length,
        calculationTimestamp: getPeruTimestamp(),
        dataPrecision: readings.length > 10 ? "ALTA" : readings.length > 0 ? "MEDIA" : "BAJA"
      },
      environmentalImpact: {
        co2Kg: parseFloat((detailedAnalysis.energy.consumedKwh * 0.45).toFixed(3)), // 0.45 kg CO2 por kWh
        treesNeeded: parseFloat((detailedAnalysis.energy.consumedKwh * 0.45 / 21.77).toFixed(2)), // 1 árbol absorbe 21.77 kg CO2/año
        equivalent: {
          lightbulbHours: parseFloat((detailedAnalysis.energy.consumedKwh * 1000 / 10).toFixed(0)), // horas de foco 10W
          phoneCharges: parseFloat((detailedAnalysis.energy.consumedKwh * 1000 / 5).toFixed(0)), // cargas de teléfono 5Wh
          tvHours: parseFloat((detailedAnalysis.energy.consumedKwh * 1000 / 100).toFixed(1)) // horas de TV 100W
        }
      }
    };
    // 🔥 7. ACTUALIZAR REGISTRO EN HISTORICOS_COMPACTOS CON DATOS PRECISOS
    if (readings.length > 0 && dayStats && dayStats.id) {
      try {
        await supabase
          .from("historicos_compactos")
          .update({
            horas_uso_estimadas: detailedAnalysis.timestamps.durationHours,
            consumo_total_kwh: detailedAnalysis.energy.consumedKwh,
            costo_estimado: detailedAnalysis.energy.costSoles,
            first_reading_time: detailedAnalysis.timestamps.firstReading,
            last_reading_time: detailedAnalysis.timestamps.lastReading,
            energy_start: detailedAnalysis.energy.startKwh,
            energy_end: detailedAnalysis.energy.endKwh,
            updated_at: getPeruTimestamp(),
            data_precision: "high",
            raw_readings_used: readings.length
          })
          .eq("id", dayStats.id);

        console.log(`✅ [DAILY-DETAILED] ${deviceId} - ${date}: Actualizado con datos precisos`);
      } catch (updateError) {
        console.error(`⚠️ Error actualizando datos precisos:`, updateError.message);
      }
    }
    console.log(`✅ [DAILY-DETAILED] ${deviceId} - ${date}: ${readings.length} lecturas analizadas`);
    res.json(response);
  } catch (e) {
    console.error("💥 /api/daily-analysis-detailed/:deviceId", e.message);
    res.status(500).json({
      success: false,
      error: e.message,
      deviceId: req.params.deviceId,
      date: req.query.date
    });
  }
});

// 🔧 FUNCIÓN AUXILIAR: Formatear duración
function formatDuration(ms) {
  if (!ms || ms <= 0) return "0 horas";

  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((ms % (1000 * 60)) / 1000);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  } else {
    return `${seconds}s`;
  }
}

// 🔧 FUNCIÓN AUXILIAR: Calcular desviación estándar
function calculateStdDev(values) {
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const squareDiffs = values.map(value => Math.pow(value - avg, 2));
  const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / squareDiffs.length;
  return Math.sqrt(avgSquareDiff);
}

// 🔧 FUNCIÓN AUXILIAR: Generar recomendaciones personalizadas
function generateRecommendations(analysis) {
  const recommendations = [];

  if (!analysis.hasData) {
    recommendations.push({
      type: "info",
      priority: "low",
      title: "Sin datos del día",
      description: "No hay lecturas registradas para este día. Verifica que el dispositivo esté encendido y conectado.",
      action: "Revisar conexión del dispositivo"
    });
    return recommendations;
  }

  // Recomendación basada en consumo
  if (analysis.energy.consumedKwh > 5) {
    recommendations.push({
      type: "warning",
      priority: "high",
      title: "Alto consumo detectado",
      description: `Consumiste ${analysis.energy.consumedKwh.toFixed(2)} kWh (S/ ${analysis.energy.costSoles.toFixed(2)}). Considera reducir el uso durante horas pico.`,
      action: "Revisar electrodomésticos encendidos",
      potentialSavings: `Hasta S/ ${(analysis.energy.costSoles * 0.2).toFixed(2)} al mes`
    });
  }

  // Recomendación basada en patrón de uso
  if (analysis.timeAnalysis.peakHours.length >= 3) {
    recommendations.push({
      type: "efficiency",
      priority: "medium",
      title: "Muchas horas de alto consumo",
      description: `Horas pico: ${analysis.timeAnalysis.peakHours.map(h => `${h}:00`).join(', ')}. Intenta desplazar actividades a horas valle.`,
      action: "Programar uso intensivo fuera de horas pico",
      potentialSavings: "15-25% en tu factura"
    });
  }

  // Recomendación basada en estabilidad eléctrica
  if (analysis.electrical.voltageStability < 90) {
    recommendations.push({
      type: "technical",
      priority: "medium",
      title: "Inestabilidad de voltaje",
      description: `Voltaje fluctúa (estabilidad: ${analysis.electrical.voltageStability}%). Puede afectar la vida útil de tus dispositivos.`,
      action: "Considerar regulador de voltaje",
      potentialSavings: "Mayor durabilidad de equipos"
    });
  }

  // Recomendación basada en distribución de potencia
  if (analysis.power.distribution.veryHigh > 20) {
    recommendations.push({
      type: "safety",
      priority: "high",
      title: "Potencia muy alta frecuente",
      description: `El ${analysis.power.distribution.veryHigh.toFixed(1)}% del tiempo la potencia supera 500W. Verifica circuitos.`,
      action: "Revisar carga eléctrica por circuito",
      potentialSavings: "Prevención de sobrecargas"
    });
  }

  // Recomendación ecológica
  if (analysis.energy.consumedKwh > 0) {
    recommendations.push({
      type: "environmental",
      priority: "low",
      title: "Impacto ambiental",
      description: `Tu consumo generó ${(analysis.energy.consumedKwh * 0.45).toFixed(2)} kg de CO₂. Equivale a ${(analysis.energy.consumedKwh * 0.45 / 21.77).toFixed(2)} árboles necesarios para absorberlo.`,
      action: "Considerar energía solar",
      potentialSavings: "Reducción de huella de carbono"
    });
  }

  // Recomendación de eficiencia general
  if (analysis.power.avg < 50 && analysis.timeAnalysis.activeHours.length > 6) {
    recommendations.push({
      type: "efficiency",
      priority: "low",
      title: "Uso eficiente",
      description: "Tu consumo es moderado y bien distribuido. ¡Sigue así!",
      action: "Mantener buenos hábitos",
      potentialSavings: "Consumo optimizado"
    });
  }

  return recommendations;
}

// 📍 ENDPOINT: Ejecutar cálculo preciso para un día específico - VERSIÓN CORREGIDA
app.post("/api/recalculate-day/:deviceId", async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { date = new Date().toISOString().split('T')[0] } = req.body;

    if (!deviceId) {
      return res.status(400).json({
        success: false,
        error: "Falta deviceId"
      });
    }

    console.log(`🔄 [RECALCULATE-DAY] Recalculando ${deviceId} - ${date}`);

    // 🔥 OBTENER TODAS LAS LECTURAS RAW DEL DÍA
    const { data: readings, error } = await supabase
      .from("lecturas_raw")
      .select(`
        timestamp,
        power,
        energy,
        voltage,
        current
      `)
      .eq("device_id", deviceId)
      .gte("timestamp", `${date}T00:00:00`)
      .lt("timestamp", `${date}T23:59:59.999`)
      .order("timestamp", { ascending: true });

    if (error) {
      console.error("❌ Error obteniendo lecturas:", error.message);
      return res.status(500).json({
        success: false,
        error: "Error obteniendo lecturas para recalcular"
      });
    }

    if (!readings || readings.length === 0) {
      return res.json({
        success: true,
        message: "No hay lecturas para recalcular",
        deviceId: deviceId,
        date: date,
        readings: 0
      });
    }

    // 🔥 ANÁLISIS DETALLADO DE TUS DATOS
    console.log(`📊 [RECALCULATE-DAY] ${readings.length} lecturas encontradas`);
    console.log(`📊 Primera lectura: ${readings[0].timestamp} - Energy: ${readings[0].energy}`);
    console.log(`📊 Última lectura: ${readings[readings.length - 1].timestamp} - Energy: ${readings[readings.length - 1].energy}`);

    // 🔥 ENCONTRAR MÍNIMO Y MÁXIMO REAL (no solo primera/última)
    const energies = readings.map(r => parseFloat(r.energy || 0));
    const minEnergy = Math.min(...energies);
    const maxEnergy = Math.max(...energies);

    // Encontrar los registros correspondientes
    const minReading = readings.find(r => parseFloat(r.energy) === minEnergy);
    const maxReading = readings.find(r => parseFloat(r.energy) === maxEnergy);

    // 🔥 CÁLCULOS PRECISOS
    const consumoKwh = Math.max(0, maxEnergy - minEnergy);

    const firstTime = new Date(minReading.timestamp);
    const lastTime = new Date(maxReading.timestamp);
    const durationMs = lastTime - firstTime;
    const durationHours = durationMs / (1000 * 60 * 60);

    const powers = readings.map(r => r.power || 0);
    const avgPower = powers.reduce((a, b) => a + b, 0) / powers.length;
    const maxPower = Math.max(...powers);

    const cost = consumoKwh * 0.50;

    // 🔥 LOG DETALLADO
    console.log(`📊 [CALCULOS] Mínimo: ${minEnergy} kWh en ${minReading.timestamp}`);
    console.log(`📊 [CALCULOS] Máximo: ${maxEnergy} kWh en ${maxReading.timestamp}`);
    console.log(`📊 [CALCULOS] Consumo: ${maxEnergy} - ${minEnergy} = ${consumoKwh} kWh`);
    console.log(`📊 [CALCULOS] Duración: ${firstTime.toISOString()} → ${lastTime.toISOString()} = ${durationHours} horas`);

    // 🔥 BUSCAR O CREAR REGISTRO
    const { data: existingRecord, error: findError } = await supabase
      .from("historicos_compactos")
      .select("id")
      .eq("device_id", deviceId)
      .eq("tipo_periodo", 'D')
      .eq("fecha_inicio", date)
      .single();

    let result;
    let action = "";

    if (findError && findError.code === 'PGRST116') {
      // Crear nuevo registro
      action = "CREADO";
      result = await supabase
        .from("historicos_compactos")
        .insert({
          device_id: deviceId,
          tipo_periodo: 'D',
          fecha_inicio: date,
          consumo_total_kwh: parseFloat(consumoKwh.toFixed(6)),
          potencia_pico_w: Math.round(maxPower),
          potencia_promedio_w: parseFloat(avgPower.toFixed(2)),
          horas_uso_estimadas: parseFloat(durationHours.toFixed(6)),
          costo_estimado: parseFloat(cost.toFixed(6)),
          dias_alto_consumo: maxPower > 1000 ? 1 : 0,
          eficiencia_categoria: avgPower >= 100 ? 'A' : (avgPower >= 50 ? 'M' : (avgPower >= 10 ? 'B' : 'C')),
          timestamp_creacion: new Date().toISOString(),
          has_data: true,
          raw_readings_count: readings.length,
          auto_generated: true,
          retroactively_generated: true,
          first_reading_time: minReading.timestamp,
          last_reading_time: maxReading.timestamp,
          energy_start: parseFloat(minEnergy.toFixed(6)),
          energy_end: parseFloat(maxEnergy.toFixed(6)),
          data_precision: "high",
          recalculated_at: new Date().toISOString(),
          notes: `Recalculado con ${readings.length} lecturas raw. Energía: ${minEnergy.toFixed(6)} → ${maxEnergy.toFixed(6)} kWh`
        })
        .select()
        .single();
    } else {
      // Actualizar registro existente
      action = "ACTUALIZADO";
      result = await supabase
        .from("historicos_compactos")
        .update({
          consumo_total_kwh: parseFloat(consumoKwh.toFixed(6)),
          potencia_pico_w: Math.round(maxPower),
          potencia_promedio_w: parseFloat(avgPower.toFixed(2)),
          horas_uso_estimadas: parseFloat(durationHours.toFixed(6)),
          costo_estimado: parseFloat(cost.toFixed(6)),
          dias_alto_consumo: maxPower > 1000 ? 1 : 0,
          eficiencia_categoria: avgPower >= 100 ? 'A' : (avgPower >= 50 ? 'M' : (avgPower >= 10 ? 'B' : 'C')),
          updated_at: new Date().toISOString(),
          has_data: true,
          raw_readings_count: readings.length,
          first_reading_time: minReading.timestamp,
          last_reading_time: maxReading.timestamp,
          energy_start: parseFloat(minEnergy.toFixed(6)),
          energy_end: parseFloat(maxEnergy.toFixed(6)),
          data_precision: "high",
          recalculated_at: new Date().toISOString(),
          notes: `Recalculado con ${readings.length} lecturas raw. Energía: ${minEnergy.toFixed(6)} → ${maxEnergy.toFixed(6)} kWh`
        })
        .eq("id", existingRecord.id)
        .select()
        .single();
    }

    if (result.error) {
      console.error("❌ Error guardando recálculo:", result.error.message);
      return res.status(500).json({
        success: false,
        error: "Error guardando recálculo"
      });
    }

    console.log(`✅ [RECALCULATE-DAY] ${deviceId} - ${date}: ${action} con ${readings.length} lecturas`);

    // 🔥 RESPUESTA DETALLADA
    res.json({
      success: true,
      message: `Día ${date} recalculado exitosamente`,
      deviceId: deviceId,
      date: date,
      readingsProcessed: readings.length,
      dataSummary: {
        firstReading: {
          timestamp: minReading.timestamp,
          energy: parseFloat(minEnergy.toFixed(6)),
          power: minReading.power
        },
        lastReading: {
          timestamp: maxReading.timestamp,
          energy: parseFloat(maxEnergy.toFixed(6)),
          power: maxReading.power
        },
        timeRange: {
          start: minReading.timestamp,
          end: maxReading.timestamp,
          durationHours: parseFloat(durationHours.toFixed(6)),
          durationHuman: `${Math.floor(durationHours)}h ${Math.round((durationHours % 1) * 60)}m`
        }
      },
      results: {
        consumption: parseFloat(consumoKwh.toFixed(6)),
        cost: parseFloat(cost.toFixed(6)),
        durationHours: parseFloat(durationHours.toFixed(6)),
        avgPower: parseFloat(avgPower.toFixed(2)),
        maxPower: maxPower,
        startEnergy: parseFloat(minEnergy.toFixed(6)),
        endEnergy: parseFloat(maxEnergy.toFixed(6))
      },
      record: result.data,
      timestamp: new Date().toISOString()
    });

  } catch (e) {
    console.error("💥 /api/recalculate-day/:deviceId", e.message);
    res.status(500).json({
      success: false,
      error: e.message
    });
  }
});


// 📍 ENDPOINT: Recalcular múltiples días automáticamente
app.post("/api/recalculate-period/:deviceId", async (req, res) => {
  try {
    const { deviceId } = req.params;
    const {
      startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      endDate = new Date().toISOString().split('T')[0]
    } = req.body;

    if (!deviceId) {
      return res.status(400).json({
        success: false,
        error: "Falta deviceId"
      });
    }

    console.log(`🔄 [RECALCULATE-PERIOD] ${deviceId} desde ${startDate} hasta ${endDate}`);

    const start = new Date(startDate);
    const end = new Date(endDate);
    const results = [];
    const errors = [];

    // Obtener todos los días con lecturas en el período
    const { data: daysWithData, error: daysError } = await supabase
      .from("lecturas_raw")
      .select("timestamp")
      .eq("device_id", deviceId)
      .gte("timestamp", `${startDate}T00:00:00`)
      .lt("timestamp", `${endDate}T23:59:59.999`);

    if (daysError || !daysWithData || daysWithData.length === 0) {
      return res.json({
        success: true,
        message: "No hay lecturas en el período especificado",
        deviceId: deviceId,
        period: `${startDate} a ${endDate}`,
        daysProcessed: 0
      });
    }

    // Extraer días únicos
    const uniqueDays = [...new Set(daysWithData.map(r => r.timestamp.split('T')[0]))].sort();

    console.log(`📅 [RECALCULATE-PERIOD] ${uniqueDays.length} días con datos para recalcular`);

    // Recalcular cada día
    for (const day of uniqueDays) {
      try {
        // Usar el endpoint de recálculo de día individual
        const response = await supabase
          .from("lecturas_raw")
          .select(`
            timestamp,
            power,
            energy,
            voltage,
            current
          `)
          .eq("device_id", deviceId)
          .gte("timestamp", `${day}T00:00:00`)
          .lt("timestamp", `${day}T23:59:59.999`)
          .order("timestamp", { ascending: true });

        if (response.error || !response.data || response.data.length === 0) {
          continue;
        }

        const readings = response.data;
        const firstReading = readings[0];
        const lastReading = readings[readings.length - 1];
        const consumedKwh = Math.max(0, lastReading.energy - firstReading.energy);
        const durationHours = (new Date(lastReading.timestamp) - new Date(firstReading.timestamp)) / (1000 * 60 * 60);
        const avgPower = readings.reduce((sum, r) => sum + r.power, 0) / readings.length;
        const maxPower = Math.max(...readings.map(r => r.power));

        // Actualizar en historicos_compactos
        const { data: existing } = await supabase
          .from("historicos_compactos")
          .select("id")
          .eq("device_id", deviceId)
          .eq("tipo_periodo", 'D')
          .eq("fecha_inicio", day)
          .single();

        if (existing) {
          await supabase
            .from("historicos_compactos")
            .update({
              consumo_total_kwh: parseFloat(consumedKwh.toFixed(6)),
              horas_uso_estimadas: parseFloat(durationHours.toFixed(4)),
              potencia_promedio_w: parseFloat(avgPower.toFixed(2)),
              potencia_pico_w: Math.round(maxPower),
              costo_estimado: parseFloat((consumedKwh * 0.50).toFixed(4)),
              first_reading_time: firstReading.timestamp,
              last_reading_time: lastReading.timestamp,
              energy_start: parseFloat(firstReading.energy.toFixed(6)),
              energy_end: parseFloat(lastReading.energy.toFixed(6)),
              raw_readings_count: readings.length,
              updated_at: new Date().toISOString(),
              data_precision: "high"
            })
            .eq("id", existing.id);
        } else {
          await supabase
            .from("historicos_compactos")
            .insert({
              device_id: deviceId,
              tipo_periodo: 'D',
              fecha_inicio: day,
              consumo_total_kwh: parseFloat(consumedKwh.toFixed(6)),
              horas_uso_estimadas: parseFloat(durationHours.toFixed(4)),
              potencia_promedio_w: parseFloat(avgPower.toFixed(2)),
              potencia_pico_w: Math.round(maxPower),
              costo_estimado: parseFloat((consumedKwh * 0.50).toFixed(4)),
              dias_alto_consumo: maxPower > 1000 ? 1 : 0,
              eficiencia_categoria: avgPower >= 100 ? 'A' : (avgPower >= 50 ? 'M' : (avgPower >= 10 ? 'B' : 'C')),
              timestamp_creacion: new Date().toISOString(),
              has_data: true,
              raw_readings_count: readings.length,
              auto_generated: true,
              first_reading_time: firstReading.timestamp,
              last_reading_time: lastReading.timestamp,
              energy_start: parseFloat(firstReading.energy.toFixed(6)),
              energy_end: parseFloat(lastReading.energy.toFixed(6)),
              data_precision: "high"
            });
        }

        results.push({
          date: day,
          readings: readings.length,
          consumption: parseFloat(consumedKwh.toFixed(6)),
          durationHours: parseFloat(durationHours.toFixed(4)),
          status: "success"
        });

        console.log(`✅ [RECALCULATE-PERIOD] ${day}: ${readings.length} lecturas procesadas`);

      } catch (dayError) {
        errors.push({
          date: day,
          error: dayError.message,
          status: "error"
        });
        console.error(`❌ [RECALCULATE-PERIOD] Error en ${day}:`, dayError.message);
      }
    }

    res.json({
      success: true,
      message: `Recálculo completado: ${results.length} días procesados, ${errors.length} errores`,
      deviceId: deviceId,
      period: `${startDate} a ${endDate}`,
      summary: {
        totalDays: uniqueDays.length,
        successfullyRecalculated: results.length,
        errors: errors.length
      },
      results: results,
      errors: errors.length > 0 ? errors : undefined,
      timestamp: new Date().toISOString()
    });

  } catch (e) {
    console.error("💥 /api/recalculate-period/:deviceId", e.message);
    res.status(500).json({
      success: false,
      error: e.message
    });
  }
});



// 🔥 ENDPOINT: Pronóstico de precio usando TODAS las lecturas raw
app.get("/api/price-forecast/:deviceId", async (req, res) => {
  try {
    const { deviceId } = req.params;
    const {
      hours = 24,          // Horas a pronosticar
      useRaw = "true",     // Usar lecturas raw (true) o solo agregados (false)
      confidence = 0.95    // Nivel de confianza del pronóstico
    } = req.query;

    if (!deviceId) {
      return res.status(400).json({
        success: false,
        error: "Falta deviceId"
      });
    }

    console.log(`🔮 [PRICE-FORECAST] Solicitado para ${deviceId}, ${hours} horas, useRaw: ${useRaw}`);

    // 🔥 1. Verificar que el dispositivo existe
    const { data: device, error: deviceError } = await supabase
      .from("devices")
      .select("id, esp32_id, name, type, wifi_ssid")
      .eq("esp32_id", deviceId)
      .single();

    if (deviceError || !device) {
      return res.status(404).json({
        success: false,
        error: "Dispositivo no encontrado"
      });
    }

    // 🔥 2. Obtener datos históricos según el método elegido
    let historicalData = [];
    let dataSource = "";
    let totalReadings = 0;

    if (useRaw === "true") {
      // 🔥 USAR LECTURAS RAW (todos los datos disponibles)
      const hoursAgo = new Date();
      hoursAgo.setHours(hoursAgo.getHours() - parseInt(hours));

      const { data: rawData, error: rawError } = await supabase
        .from("lecturas_raw")
        .select(`
          timestamp,
          power,
          energy,
          voltage,
          current
        `)
        .eq("device_id", deviceId)
        .gte("timestamp", hoursAgo.toISOString())
        .order("timestamp", { ascending: true });

      if (!rawError && rawData && rawData.length > 0) {
        historicalData = rawData;
        totalReadings = rawData.length;
        dataSource = "lecturas_raw";
        console.log(`📊 [PRICE-FORECAST] ${totalReadings} lecturas raw obtenidas`);
      }
    }

    // 🔥 3. Si no hay lecturas raw o se solicita usar agregados, usar historicos_compactos
    if (historicalData.length === 0) {
      const { data: compactData, error: compactError } = await supabase
        .from("historicos_compactos")
        .select(`
          fecha_inicio,
          consumo_total_kwh,
          potencia_promedio_w,
          costo_estimado,
          tipo_periodo
        `)
        .eq("device_id", deviceId)
        .eq("tipo_periodo", 'H') // Usar datos por hora
        .order("fecha_inicio", { ascending: false })
        .limit(parseInt(hours));

      if (!compactError && compactData) {
        historicalData = compactData;
        totalReadings = compactData.length;
        dataSource = "historicos_compactos (H)";
        console.log(`📊 [PRICE-FORECAST] ${totalReadings} registros horarios obtenidos`);
      }
    }

    // 🔥 4. Si no hay datos de ninguna fuente, usar datos actuales del dispositivo
    if (historicalData.length === 0) {
      const { data: currentDevice, error: currentError } = await supabase
        .from("devices")
        .select("power, energy, last_seen")
        .eq("esp32_id", deviceId)
        .single();

      if (!currentError && currentDevice) {
        historicalData = [{
          timestamp: currentDevice.last_seen || new Date().toISOString(),
          power: currentDevice.power || 0,
          energy: currentDevice.energy || 0,
          consumo_total_kwh: currentDevice.energy || 0,
          potencia_promedio_w: currentDevice.power || 0
        }];
        dataSource = "datos actuales del dispositivo";
        totalReadings = 1;
      }
    }

    if (historicalData.length === 0) {
      return res.status(404).json({
        success: false,
        error: "No hay datos históricos para hacer pronóstico"
      });
    }

    // 🔥 5. ANÁLISIS ESTADÍSTICO AVANZADO con lecturas raw
    let analysis = {
      totalReadings: totalReadings,
      dataSource: dataSource,
      timeRange: {},
      statistics: {},
      patterns: {}
    };

    if (dataSource === "lecturas_raw" && historicalData.length > 1) {
      // 🔥 ANÁLISIS DETALLADO CON LECTURAS RAW
      const readings = historicalData;

      // Ordenar por timestamp
      readings.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

      const firstTime = new Date(readings[0].timestamp);
      const lastTime = new Date(readings[readings.length - 1].timestamp);
      const totalHours = (lastTime - firstTime) / (1000 * 60 * 60);

      analysis.timeRange = {
        from: firstTime.toISOString(),
        to: lastTime.toISOString(),
        totalHours: parseFloat(totalHours.toFixed(2)),
        readingsPerHour: parseFloat((readings.length / totalHours).toFixed(1))
      };

      // Estadísticas básicas
      const powers = readings.map(r => r.power || 0);
      const energies = readings.map(r => r.energy || 0);

      analysis.statistics = {
        avgPower: parseFloat((powers.reduce((a, b) => a + b, 0) / powers.length).toFixed(2)),
        maxPower: Math.max(...powers),
        minPower: Math.min(...powers),
        totalEnergyChange: energies.length > 1 ?
          parseFloat((energies[energies.length - 1] - energies[0]).toFixed(6)) : 0,
        energyPerHour: energies.length > 1 && totalHours > 0 ?
          parseFloat(((energies[energies.length - 1] - energies[0]) / totalHours).toFixed(6)) : 0
      };

      // 🔥 DETECTAR PATRONES DE CONSUMO
      const hourlyPatterns = {};
      const dayOfWeekPatterns = {};

      readings.forEach(reading => {
        const date = new Date(reading.timestamp);
        const hour = date.getHours();
        const day = date.getDay(); // 0 = domingo, 6 = sábado
        const power = reading.power || 0;

        if (!hourlyPatterns[hour]) {
          hourlyPatterns[hour] = { sum: 0, count: 0 };
        }
        hourlyPatterns[hour].sum += power;
        hourlyPatterns[hour].count++;

        if (!dayOfWeekPatterns[day]) {
          dayOfWeekPatterns[day] = { sum: 0, count: 0 };
        }
        dayOfWeekPatterns[day].sum += power;
        dayOfWeekPatterns[day].count++;
      });

      // Calcular promedios
      analysis.patterns.hourly = {};
      analysis.patterns.daily = {};

      Object.keys(hourlyPatterns).forEach(hour => {
        analysis.patterns.hourly[hour] = parseFloat(
          (hourlyPatterns[hour].sum / hourlyPatterns[hour].count).toFixed(1)
        );
      });

      Object.keys(dayOfWeekPatterns).forEach(day => {
        analysis.patterns.daily[day] = parseFloat(
          (dayOfWeekPatterns[day].sum / dayOfWeekPatterns[day].count).toFixed(1)
        );
      });

      // 🔥 IDENTIFICAR HORAS PICO
      const hourlyAverages = Object.values(analysis.patterns.hourly);
      const avgAllHours = hourlyAverages.reduce((a, b) => a + b, 0) / hourlyAverages.length;
      const peakThreshold = avgAllHours * 1.5;

      analysis.patterns.peakHours = Object.keys(analysis.patterns.hourly)
        .filter(hour => analysis.patterns.hourly[hour] > peakThreshold)
        .map(hour => parseInt(hour));

      analysis.patterns.offPeakHours = Object.keys(analysis.patterns.hourly)
        .filter(hour => analysis.patterns.hourly[hour] < (avgAllHours * 0.5))
        .map(hour => parseInt(hour));

    } else if (dataSource.includes("historicos_compactos")) {
      // 🔥 ANÁLISIS CON DATOS AGREGADOS
      const consumos = historicalData.map(h => h.consumo_total_kwh || 0);
      const potencias = historicalData.map(h => h.potencia_promedio_w || 0);

      analysis.statistics = {
        avgConsumption: parseFloat((consumos.reduce((a, b) => a + b, 0) / consumos.length).toFixed(6)),
        avgPower: parseFloat((potencias.reduce((a, b) => a + b, 0) / potencias.length).toFixed(1)),
        maxConsumption: Math.max(...consumos),
        minConsumption: Math.min(...consumos),
        totalConsumption: parseFloat(consumos.reduce((a, b) => a + b, 0).toFixed(6))
      };
    }

    // 🔥 6. CÁLCULO DEL PRONÓSTICO
    const tarifaPorKwh = 0.50; // S/ por kWh
    let forecast = {
      nextHour: {},
      next24Hours: {},
      nextWeek: {},
      confidence: parseFloat(confidence),
      algorithm: dataSource === "lecturas_raw" ? "ARIMA-Simple (con lecturas raw)" : "Moving Average (con agregados)"
    };

    // Pronóstico para la próxima hora
    if (analysis.statistics.energyPerHour) {
      // Usar tasa por hora calculada de lecturas raw
      forecast.nextHour = {
        consumption: parseFloat(analysis.statistics.energyPerHour.toFixed(6)),
        cost: parseFloat((analysis.statistics.energyPerHour * tarifaPorKwh).toFixed(4)),
        power: parseFloat(analysis.statistics.avgPower.toFixed(1)),
        unit: "kWh"
      };
    } else if (analysis.statistics.avgConsumption) {
      // Usar promedio de consumos horarios
      forecast.nextHour = {
        consumption: parseFloat(analysis.statistics.avgConsumption.toFixed(6)),
        cost: parseFloat((analysis.statistics.avgConsumption * tarifaPorKwh).toFixed(4)),
        power: parseFloat(analysis.statistics.avgPower.toFixed(1)),
        unit: "kWh"
      };
    } else {
      // Estimación básica
      const estimatedHourly = (analysis.statistics.avgPower || 0) / 1000; // W a kW
      forecast.nextHour = {
        consumption: parseFloat(estimatedHourly.toFixed(6)),
        cost: parseFloat((estimatedHourly * tarifaPorKwh).toFixed(4)),
        power: analysis.statistics.avgPower || 0,
        unit: "kWh",
        note: "Estimado basado en potencia promedio"
      };
    }

    // Pronóstico para las próximas 24 horas
    if (analysis.patterns && analysis.patterns.hourly) {
      // 🔥 PRONÓSTICO INTELIGENTE usando patrones horarios
      const now = new Date();
      const currentHour = now.getHours();

      let total24h = 0;
      const hourlyForecast = {};

      // Pronosticar las próximas 24 horas usando el patrón histórico
      for (let i = 0; i < 24; i++) {
        const forecastHour = (currentHour + i) % 24;
        const hourPattern = analysis.patterns.hourly[forecastHour] || analysis.statistics.avgPower || 0;
        const hourConsumption = hourPattern / 1000; // W a kW

        hourlyForecast[forecastHour] = {
          consumption: parseFloat(hourConsumption.toFixed(6)),
          cost: parseFloat((hourConsumption * tarifaPorKwh).toFixed(4)),
          isPeak: analysis.patterns.peakHours?.includes(forecastHour) || false,
          isOffPeak: analysis.patterns.offPeakHours?.includes(forecastHour) || false
        };

        total24h += hourConsumption;
      }

      forecast.next24Hours = {
        consumption: parseFloat(total24h.toFixed(6)),
        cost: parseFloat((total24h * tarifaPorKwh).toFixed(2)),
        hourlyBreakdown: hourlyForecast,
        peakHours: analysis.patterns.peakHours || [],
        offPeakHours: analysis.patterns.offPeakHours || [],
        recommendation: analysis.patterns.peakHours?.length > 0 ?
          `Reduce consumo entre ${analysis.patterns.peakHours.join(':00, ')}:00 para ahorrar` :
          "Consumo estable, no hay horas pico identificadas"
      };
    } else {
      // Pronóstico simple
      const dailyConsumption = forecast.nextHour.consumption * 24;
      forecast.next24Hours = {
        consumption: parseFloat(dailyConsumption.toFixed(6)),
        cost: parseFloat((dailyConsumption * tarifaPorKwh).toFixed(2)),
        note: "Pronóstico lineal basado en promedio horario"
      };
    }

    // Pronóstico para la próxima semana
    forecast.nextWeek = {
      consumption: parseFloat((forecast.next24Hours.consumption * 7).toFixed(6)),
      cost: parseFloat((forecast.next24Hours.cost * 7).toFixed(2)),
      monthlyProjection: parseFloat((forecast.next24Hours.consumo_total_kwh * 30).toFixed(6)),
      monthlyCost: parseFloat((forecast.next24Hours.cost * 30).toFixed(2))
    };

    // 🔥 7. RECOMENDACIONES INTELIGENTES
    const recommendations = [];

    if (analysis.patterns && analysis.patterns.peakHours && analysis.patterns.peakHours.length > 0) {
      recommendations.push({
        type: "energy_saving",
        priority: "high",
        title: "Optimiza consumo en horas pico",
        description: `Tu consumo aumenta entre las ${analysis.patterns.peakHours.join(':00, ')}:00. Considera desplazar uso a horas valle.`,
        potentialSavings: `Hasta S/ ${(forecast.next24Hours.cost * 0.15).toFixed(2)} por semana`
      });
    }

    if (analysis.statistics.avgPower > 100) {
      recommendations.push({
        type: "efficiency",
        priority: "medium",
        title: "Considera electrodomésticos eficientes",
        description: `Tu potencia promedio (${analysis.statistics.avgPower.toFixed(1)}W) es alta. Electrodomésticos clase A+ pueden reducir consumo.`,
        potentialSavings: `Hasta 30% de ahorro energético`
      });
    }

    if (forecast.nextWeek.monthlyCost > 50) {
      recommendations.push({
        type: "solar",
        priority: "low",
        title: "Evaluar paneles solares",
        description: `Tu consumo mensual proyectado (${forecast.nextWeek.monthlyCost.toFixed(2)} soles) justifica evaluación de energía solar.`,
        potentialSavings: `Hasta 70% de ahorro con inversión a mediano plazo`
      });
    }

    // 🔥 8. RESPUESTA COMPLETA
    res.json({
      success: true,
      deviceId: deviceId,
      deviceName: device.name,
      deviceType: device.type || "General",
      forecast: forecast,
      analysis: analysis,
      recommendations: recommendations,
      dataQuality: {
        source: dataSource,
        readings: totalReadings,
        confidence: forecast.confidence,
        isRawData: dataSource === "lecturas_raw",
        note: dataSource === "lecturas_raw" ?
          "Pronóstico basado en análisis detallado de lecturas raw" :
          "Pronóstico basado en datos agregados"
      },
      timestamp: new Date().toISOString(),
      message: `Pronóstico generado usando ${dataSource} (${totalReadings} datos)`
    });

  } catch (e) {
    console.error("💥 /api/price-forecast/:deviceId", e.message);
    console.error(e.stack);
    res.status(500).json({
      success: false,
      error: e.message,
      details: process.env.NODE_ENV === 'development' ? e.stack : undefined
    });
  }
});

// 📍 FUNCIÓN: Calcular recomendación solar (función auxiliar)
async function calculateSolarRecommendation(deviceId) {
  try {
    const { data: stats, error } = await supabase
      .from("historicos_compactos")
      .select("consumo_total_kwh")
      .eq("device_id", deviceId)
      .eq("tipo_periodo", 'D')
      .order("fecha_inicio", { ascending: false })
      .limit(30);

    if (error || !stats || stats.length === 0) {
      return { error: "No hay datos suficientes para calcular recomendación solar" };
    }

    const totalConsumption = stats.reduce((sum, day) => sum + (day.consumo_total_kwh || 0), 0);
    const dailyAverage = totalConsumption / stats.length;
    const monthlyAverage = dailyAverage * 30;

    // Cálculo de paneles necesarios
    const panelPower = 450; // W por panel
    const sunHours = 5; // Horas de sol promedio
    const panelDailyProduction = (panelPower / 1000) * sunHours; // kWh por panel por día
    const panelsNeeded = Math.ceil((dailyAverage * 1.2) / panelDailyProduction); // +20% de margen

    // Costo y ahorro
    const panelCost = 150; // USD por panel
    const installationCost = 500; // USD
    const totalCost = (panelsNeeded * panelCost) + installationCost;
    const monthlySavings = monthlyAverage * 0.50; // Ahorro estimado en soles (tarifa 0.50 S/ por kWh)
    const roiMonths = Math.ceil(totalCost / (monthlySavings * 0.25)); // ROI en meses (considerando 0.25 USD por sol)

    return {
      dailyAverage: parseFloat(dailyAverage.toFixed(2)),
      monthlyAverage: parseFloat(monthlyAverage.toFixed(2)),
      panelsNeeded: panelsNeeded,
      panelSpecs: {
        power: panelPower,
        sunHours: sunHours,
        dailyProduction: parseFloat(panelDailyProduction.toFixed(2))
      },
      financials: {
        totalCost: totalCost,
        monthlySavings: parseFloat(monthlySavings.toFixed(2)),
        roiMonths: roiMonths,
        annualSavings: parseFloat((monthlySavings * 12).toFixed(2))
      },
      recommendation: panelsNeeded <= 2 ?
        "Sistema pequeño recomendado para autoconsumo" :
        "Sistema mediano recomendado con posible inyección a red"
    };
  } catch (e) {
    console.error(`💥 calculateSolarRecommendation: ${e.message}`);
    return { error: e.message };
  }
}

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
    const { daysToKeep = 1 } = req.body;

    await cleanupOldRawData();

    res.json({
      success: true,
      message: `Limpieza ejecutada (conservando últimos ${daysToKeep} día)`,
      timestamp: new Date().toISOString()
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
          nodeVersion: process.version,
          timezone: process.env.TZ || 'UTC',
          serverTime: new Date().toString()
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
    version: "3.1 - Sistema Completo Corregido con Hora Peruana",
    timezone: "America/Lima (UTC-5)",
    serverTime: new Date().toString(),
    endpoints: {
      data: "POST /api/data - Recibir datos del ESP32",
      devicesByWifi: "GET /api/devices-by-wifi?wifiName=XXXX",
      registerSimple: "POST /api/register-simple - Registrar sin login",
      devicesByCode: "GET /api/devices-by-code?networkCode=XXXX",
      // 🔥 NUEVOS ENDPOINTS
      generateDailySummary: "POST /api/generate-daily-summary",
      forceCleanup: "POST /api/force-cleanup",
      dailyAnalysisDetailed: "GET /api/daily-analysis-detailed/:deviceId", // ✅ NUEVO
      solarRecommendation: "GET /api/solar-recommendation/:deviceId",
      simulateData: "POST /api/simulate-data",
      systemStats: "GET /api/system-stats"
    },
    automation: {
      dailySummary: `${DATA_CONFIG.dailySummaryHour}:${DATA_CONFIG.dailySummaryMinute} hora Perú`,
      autoCleanup: `${DATA_CONFIG.cleanupHour}:${DATA_CONFIG.cleanupMinute} hora Perú`,
      keepRawDataDays: DATA_CONFIG.keepRawDataDays
    },
    message: "Sistema completo de monitorización energética con hora peruana y limpieza automática"
  });
});

// 📍 ENDPOINT: Datos para gráfico tiempo real (últimas X horas)
app.get("/api/realtime-chart/:deviceId", async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { hours = 24, limit = 100 } = req.query;

    if (!deviceId) {
      return res.status(400).json({
        success: false,
        error: "Falta deviceId"
      });
    }

    const hoursAgo = new Date();
    hoursAgo.setHours(hoursAgo.getHours() - parseInt(hours));

    console.log(`📊 [REALTIME-CHART] Datos para ${deviceId} últimas ${hours} horas`);

    // 🔥 Obtener lecturas reales de las últimas horas
    const { data: realReadings, error } = await supabase
      .from("lecturas_raw")
      .select(`
        timestamp,
        power,
        energy,
        voltage,
        current
      `)
      .eq("device_id", deviceId)
      .gte("timestamp", hoursAgo.toISOString())
      .order("timestamp", { ascending: true })
      .limit(parseInt(limit));

    if (error) {
      console.error("❌ Error en realtime-chart:", error.message);
      return res.status(500).json({
        success: false,
        error: "Error en la base de datos"
      });
    }

    let finalReadings = realReadings || [];

    // 🔥 Si no hay datos recientes, usar datos del dispositivo actual
    if (finalReadings.length === 0) {
      const { data: deviceData } = await supabase
        .from("devices")
        .select("power, energy, voltage, current, last_seen")
        .eq("esp32_id", deviceId)
        .single();

      if (deviceData) {
        finalReadings = [{
          timestamp: deviceData.last_seen || new Date().toISOString(),
          power: deviceData.power || 0,
          energy: deviceData.energy || 0,
          voltage: deviceData.voltage || 0,
          current: deviceData.current || 0
        }];
      }
    }

    res.json({
      success: true,
      deviceId: deviceId,
      readings: finalReadings,
      count: finalReadings.length,
      timeRange: {
        from: hoursAgo.toISOString(),
        to: new Date().toISOString(),
        hours: parseInt(hours)
      },
      message: finalReadings.length === 0
        ? "No hay lecturas recientes"
        : `Datos reales obtenidos: ${finalReadings.length} lecturas`
    });

  } catch (e) {
    console.error("💥 /api/realtime-chart/:deviceId", e.message);
    res.status(500).json({
      success: false,
      error: e.message
    });
  }
});

// 📍 ENDPOINT: Pronóstico de costos usando lecturas raw recientes
app.get("/api/realtime-cost-forecast/:deviceId", async (req, res) => {
  try {
    const { deviceId } = req.params;
    const {
      minutes = 5,     // Minutos a analizar
      samples = 10     // Número de muestras a usar
    } = req.query;

    if (!deviceId) {
      return res.status(400).json({
        success: false,
        error: "Falta deviceId"
      });
    }

    console.log(`💰 [REALTIME-COST] Pronóstico para ${deviceId}, últimos ${minutes} minutos`);

    // 🔥 OBTENER LECTURAS RAW RECIENTES
    const minutesAgo = new Date();
    minutesAgo.setMinutes(minutesAgo.getMinutes() - parseInt(minutes));

    const { data: readings, error } = await supabase
      .from("lecturas_raw")
      .select(`
        timestamp,
        power,
        energy,
        voltage,
        current
      `)
      .eq("device_id", deviceId)
      .gte("timestamp", minutesAgo.toISOString())
      .order("timestamp", { ascending: true })
      .limit(parseInt(samples));

    if (error || !readings || readings.length < 2) {
      console.warn(`⚠️ [REALTIME-COST] Pocas lecturas para ${deviceId}: ${readings?.length || 0}`);

      // 🔥 FALLBACK: Usar datos del dispositivo actual
      const { data: device } = await supabase
        .from("devices")
        .select("power, energy")
        .eq("esp32_id", deviceId)
        .single();

      const power = device?.power || 0;
      const tarifa = 0.50;

      return res.json({
        success: true,
        source: "fallback",
        deviceId: deviceId,
        readings: 0,
        forecast: {
          perHour: (power / 1000) * tarifa,
          perDay: (power / 1000) * 24 * tarifa,
          perMonth: (power / 1000) * 24 * 30 * tarifa,
          power: power,
          accuracy: "low"
        }
      });
    }

    // 🔥 CÁLCULO AVANZADO CON LECTURAS RAW
    const tarifa = 0.50; // S/ por kWh

    // 1. Calcular consumo REAL en el período
    const first = readings[0];
    const last = readings[readings.length - 1];
    const energyConsumed = last.energy - first.energy; // kWh

    // 2. Calcular tiempo transcurrido (horas)
    const timeDiffMs = new Date(last.timestamp) - new Date(first.timestamp);
    const timeDiffHours = timeDiffMs / (1000 * 60 * 60);

    // 3. Tasa de consumo por hora (kWh/hora)
    const hourlyRate = timeDiffHours > 0 ? energyConsumed / timeDiffHours : 0;

    // 4. Calcular potencia promedio REAL (no instantánea)
    const avgPower = readings.reduce((sum, r) => sum + r.power, 0) / readings.length;

    // 5. Calcular costos basados en consumo REAL
    const hourlyCost = hourlyRate * tarifa;
    const dailyCost = hourlyCost * 24;
    const monthlyCost = dailyCost * 30;

    // 6. Análisis de tendencia
    const powerTrend = readings.length > 1 ?
      (readings[readings.length - 1].power - readings[0].power) / readings[0].power : 0;

    // 7. Detectar picos de consumo
    const maxPower = Math.max(...readings.map(r => r.power));
    const minPower = Math.min(...readings.map(r => r.power));
    const hasSpike = (maxPower - minPower) > (avgPower * 0.5); // Pico > 50% del promedio

    res.json({
      success: true,
      source: "lecturas_raw",
      deviceId: deviceId,
      readings: readings.length,
      analysis: {
        timeWindow: `${timeDiffHours.toFixed(2)} horas`,
        energyConsumed: energyConsumed,
        hourlyRate: hourlyRate,
        avgPower: avgPower,
        powerTrend: powerTrend,
        hasSpike: hasSpike,
        spikeMagnitude: hasSpike ? ((maxPower - minPower) / avgPower) : 0
      },
      forecast: {
        perHour: hourlyCost,
        perDay: dailyCost,
        perMonth: monthlyCost,
        power: avgPower, // Usar promedio, no instantáneo
        accuracy: readings.length >= 5 ? "high" : "medium"
      },
      timestamp: new Date().toISOString()
    });

  } catch (e) {
    console.error("💥 /api/realtime-cost-forecast/:deviceId", e.message);
    res.status(500).json({
      success: false,
      error: e.message
    });
  }
});

// 📍 ENDPOINT: Obtener análisis histórico (REQUERIDO POR FLUTTER PARA MÚLTIPLES MESES)
app.get("/api/historical-analysis/:deviceId", async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { days = 90 } = req.query;

    if (!deviceId) {
      return res.status(400).json({
        success: false,
        error: "Falta deviceId"
      });
    }

    console.log(`📊 [HISTORICAL] Solicitando ${days} días para ${deviceId}`);

    // Calcular fecha de corte
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - parseInt(days));
    const cutoffDateStr = cutoffDate.toISOString().split('T')[0];

    // Obtener los datos desde historicos_compactos a nivel diario
    const { data: historicos, error } = await supabase
      .from("historicos_compactos")
      .select("*")
      .eq("device_id", deviceId)
      .eq("tipo_periodo", "D") // La app de Flutter luego agrupa esto mensualmente
      .gte("fecha_inicio", cutoffDateStr)
      .order("fecha_inicio", { ascending: false });

    if (error) {
      throw error;
    }

    res.json({
      success: true,
      deviceId: deviceId,
      historicos: historicos || [],
      count: historicos?.length || 0,
      timestamp: new Date().toISOString()
    });

  } catch (e) {
    console.error("💥 /api/historical-analysis", e.message);
    res.status(500).json({
      success: false,
      error: e.message
    });
  }
});




// 📍 ENDPOINT: Análisis comparativo REAL
app.get("/api/comparative-analysis/:deviceId", async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { period = 'month' } = req.query;

    if (!deviceId) {
      return res.status(400).json({
        success: false,
        error: "Falta deviceId"
      });
    }

    console.log(`📊 [COMPARATIVE] Análisis comparativo para ${deviceId}, período: ${period}`);

    // 🔥 Obtener datos actuales (último período)
    const currentEnd = new Date();
    const currentStart = new Date();

    if (period === 'week') {
      currentStart.setDate(currentStart.getDate() - 7);
    } else if (period === 'month') {
      currentStart.setMonth(currentStart.getMonth() - 1);
    } else {
      currentStart.setDate(currentStart.getDate() - 30);
    }

    // 🔥 Obtener período anterior
    const previousStart = new Date(currentStart);
    const previousEnd = new Date(currentStart);

    if (period === 'week') {
      previousStart.setDate(previousStart.getDate() - 7);
    } else if (period === 'month') {
      previousStart.setMonth(previousStart.getMonth() - 1);
    } else {
      previousStart.setDate(previousStart.getDate() - 30);
    }

    // Consulta para período actual
    const { data: currentData, error: currentError } = await supabase
      .from("historicos_compactos")
      .select(`
        SUM(consumo_total_kwh) as total_kwh,
        AVG(potencia_promedio_w) as avg_power,
        MAX(potencia_pico_w) as max_power,
        SUM(costo_estimado) as total_cost
      `)
      .eq("device_id", deviceId)
      .eq("tipo_periodo", 'D')
      .gte("fecha_inicio", currentStart.toISOString().split('T')[0])
      .lte("fecha_inicio", currentEnd.toISOString().split('T')[0]);

    // Consulta para período anterior
    const { data: previousData, error: previousError } = await supabase
      .from("historicos_compactos")
      .select(`
        SUM(consumo_total_kwh) as total_kwh,
        AVG(potencia_promedio_w) as avg_power,
        MAX(potencia_pico_w) as max_power,
        SUM(costo_estimado) as total_cost
      `)
      .eq("device_id", deviceId)
      .eq("tipo_periodo", 'D')
      .gte("fecha_inicio", previousStart.toISOString().split('T')[0])
      .lte("fecha_inicio", previousEnd.toISOString().split('T')[0]);

    if (currentError || previousError) {
      console.error("❌ Error en análisis comparativo:", currentError || previousError);
      return res.status(500).json({
        success: false,
        error: "Error en la base de datos"
      });
    }

    const current = currentData?.[0] || {};
    const previous = previousData?.[0] || {};

    // Calcular cambios porcentuales
    const consumptionChange = previous.total_kwh ?
      ((current.total_kwh - previous.total_kwh) / previous.total_kwh) * 100 : 0;

    const costChange = previous.total_cost ?
      ((current.total_cost - previous.total_cost) / previous.total_cost) * 100 : 0;

    const powerChange = previous.avg_power ?
      ((current.avg_power - previous.avg_power) / previous.avg_power) * 100 : 0;

    res.json({
      success: true,
      deviceId: deviceId,
      period: period,
      current: {
        consumo: current.total_kwh || 0,
        costo: current.total_cost || 0,
        potencia_promedio: current.avg_power || 0,
        potencia_pico: current.max_power || 0
      },
      previous: {
        consumo: previous.total_kwh || 0,
        costo: previous.total_cost || 0,
        potencia_promedio: previous.avg_power || 0,
        potencia_pico: previous.max_power || 0
      },
      changes: {
        consumo: parseFloat(consumptionChange.toFixed(1)),
        costo: parseFloat(costChange.toFixed(1)),
        potencia: parseFloat(powerChange.toFixed(1))
      },
      message: "Análisis comparativo completado"
    });

  } catch (e) {
    console.error("💥 /api/comparative-analysis/:deviceId", e.message);
    res.status(500).json({
      success: false,
      error: e.message
    });
  }
});

async function initializeDailyRecords() {
  try {
    const todayStr = new Date().toISOString().split('T')[0];
    console.log(`📝 [INIT] Verificando registros para hoy: ${todayStr}`);
    // Obtener todos los dispositivos registrados
    const { data: devices, error } = await supabase
      .from("devices")
      .select("esp32_id")
      .not("esp32_id", "is", null);
    if (error || !devices || devices.length === 0) {
      console.log(`ℹ️ [INIT] No hay dispositivos registrados`);
      return;
    }
    console.log(`📝 [INIT] Verificando ${devices.length} dispositivos`);
    for (const device of devices) {
      const esp32Id = device.esp32_id;
      // Verificar si ya existe registro para hoy
      const { data: existing, error: checkError } = await supabase
        .from("historicos_compactos")
        .select("id")
        .eq("device_id", esp32Id)
        .eq("tipo_periodo", 'D')
        .eq("fecha_inicio", todayStr)
        .single();
      // Si no existe, crear registro vacío
      if (checkError && checkError.code === 'PGRST116') {
        console.log(`📝 [INIT] Creando registro vacío para ${esp32Id} - ${todayStr}`);
        await supabase
          .from("historicos_compactos")
          .insert({
            device_id: esp32Id,
            tipo_periodo: 'D',
            fecha_inicio: todayStr,
            consumo_total_kwh: 0,
            potencia_pico_w: 0,
            potencia_promedio_w: 0,
            horas_uso_estimadas: 0,
            costo_estimado: 0,
            dias_alto_consumo: 0,
            eficiencia_categoria: 'N',
            timestamp_creacion: getPeruTimestamp(),  // 🔥 Cambiado a hora peruana
            has_data: false,
            raw_readings_count: 0,
            auto_generated: true,
            is_today: true,
            first_reading_time: null,
            last_reading_time: null
          });
      }
    }
    console.log(`✅ [INIT] Registros diarios inicializados para ${devices.length} dispositivos`);
  } catch (e) {
    console.error(`💥 [INIT] Error inicializando registros:`, e.message);
  }
}

// Iniciar la tarea periódica de limpieza de estado
const CLEANUP_INTERVAL_MS = 2000;
setInterval(cleanupOnlineStatus, CLEANUP_INTERVAL_MS);

// 🔥 INICIAR SERVIDOR CON INICIALIZACIÓN
app.listen(PORT, "0.0.0.0", async () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
  console.log(`⏰ Hora peruana configurada: ${new Date().toString()}`);
  console.log(`📡 Sistema COMPLETO por SSID/WIFI con RECOLECCIÓN AUTOMÁTICA`);

  // 🔥 INICIALIZAR REGISTROS DIARIOS
  await initializeDailyRecords();

  // 🔥 EJECUTAR LIMPIEZA INICIAL DE DATOS ANTERIORES
  console.log("🧹 [INIT] Ejecutando limpieza inicial de datos antiguos...");
  await cleanupOldRawData();

  console.log(`🔗 Endpoints principales:`);
  console.log(`   GET  /api/devices-by-wifi?wifiName=TU_WIFI`);
  console.log(`   POST /api/register-simple (deviceId, deviceName, wifiSsid)`);
  console.log(`   GET  /api/devices-by-code?networkCode=XXXX`);
  console.log(`   POST /api/data (para ESP32)`);
  console.log(`📊 Sistema de RECOLECCIÓN AUTOMÁTICA activado`);
  console.log(`   ⏰ Resumen diario: ${DATA_CONFIG.dailySummaryHour}:${DATA_CONFIG.dailySummaryMinute} hora Perú`);
  console.log(`   🧹 Limpieza automática: ${DATA_CONFIG.cleanupHour}:${DATA_CONFIG.cleanupMinute} hora Perú`);
  console.log(`   💾 Guarda 1 de cada ${DATA_CONFIG.saveEveryNReadings} lecturas (cada ~${DATA_CONFIG.saveEveryNReadings * 5}s)`);
  console.log(`   📅 Mantiene ${DATA_CONFIG.keepRawDataDays} día(s) de lecturas raw`);
  console.log(`📈 Endpoints de análisis:`);
  console.log(`GET /api/daily-analysis-detailed/88:57:21:47:AD:24?date=2026-01-03&includeRawData=true   `);
  console.log(`   GET  /api/solar-recommendation/:deviceId`);
  console.log(`   POST /api/force-cleanup (limpieza manual)`);
  console.log(`⏰ Cleanup interval: ${CLEANUP_INTERVAL_MS}ms`);

  // 🔥 INICIAR TAREAS PROGRAMADAS
  scheduleOptimizedTasks();
});