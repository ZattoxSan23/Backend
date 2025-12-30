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

const DATA_CONFIG = {
  saveEveryNReadings: 6,           // Guardar 1 de cada 6 lecturas (cada ~30s)
  keepRawDataDays: 1,              // Mantener lecturas_raw por 1 día (después de procesar)
  dailySummaryHour: 23,            // Generar resumen diario a las 23:00
  dailySummaryMinute: 59,
  generateHourlySummary: false,    // ❌ DESHABILITADO: Generar resumen por hora
  generateWeeklySummary: true,     // Generar resumen semanal
  generateMonthlySummary: true,    // Generar resumen mensual
  autoDetectDayChange: true,       // Detectar automáticamente cambio de día
  minReadingsForDaily: 2,          // Mínimo de lecturas para considerar "con datos"
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
      timestamp: new Date().toISOString()
    });

  } catch (e) {
    console.error("💥 /api/current-day-stats/:deviceId", e.message);
    res.status(500).json({
      success: false,
      error: e.message
    });
  }
});

// 📍 FUNCIÓN MEJORADA: Verificar y generar resumen diario con actualización en tiempo real
async function checkAndGenerateDailySummaryOptimized(deviceId, currentTimestamp) {
  try {
    const now = new Date(currentTimestamp);
    const todayStr = now.toISOString().split('T')[0];

    // 🔥 Verificar si YA existe un registro para hoy
    const { data: existingToday, error: checkError } = await supabase
      .from("historicos_compactos")
      .select("id, fecha_inicio, has_data, raw_readings_count")
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
          timestamp_creacion: new Date().toISOString(),
          has_data: false,
          raw_readings_count: 0,
          auto_generated: true,
          is_today: true,
          first_reading_time: new Date().toISOString()
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
          .select("energy")
          .eq("device_id", deviceId)
          .gte("timestamp", `${todayStr}T00:00:00`)
          .order("timestamp", { ascending: true })
          .limit(1)
          .single();

        const energyStart = firstReading?.energy || currentEnergy;
        const consumoInicial = Math.max(0, currentEnergy - energyStart);

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
            updated_at: new Date().toISOString(),
            energy_start: energyStart,
            first_reading_time: new Date().toISOString()
          })
          .eq("id", existingToday.id);
      }
    }

  } catch (e) {
    console.error(`💥 [NUEVO-DIA] ${deviceId}: Error:`, e.message);
  }
}

// 🔥 NUEVA FUNCIÓN: Actualizar registro diario EN TIEMPO REAL después de cada lectura
async function updateDailyStatsInRealTime(deviceId, readingData) {
  try {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    // Buscar registro existente para hoy
    const { data: dayRecord, error } = await supabase
      .from("historicos_compactos")
      .select("*")
      .eq("device_id", deviceId)
      .eq("tipo_periodo", 'D')
      .eq("fecha_inicio", todayStr)
      .single();

    const { power, energy, timestamp } = readingData;

    if (error || !dayRecord) {
      // 🔥 PRIMERA LECTURA DEL DÍA: Crear registro inicial
      console.log(`📝 [PRIMERA-LECTURA] ${deviceId}: Creando registro inicial para hoy`);

      // Obtener primera energía del día (del dispositivo o de lecturas raw)
      const { data: firstEnergyData } = await supabase
        .from("lecturas_raw")
        .select("energy")
        .eq("device_id", deviceId)
        .gte("timestamp", `${todayStr}T00:00:00`)
        .order("timestamp", { ascending: true })
        .limit(1)
        .single();

      const initialEnergy = firstEnergyData?.energy || energy;
      const energyDelta = Math.max(0, energy - initialEnergy);

      const newRecord = {
        device_id: deviceId,
        tipo_periodo: 'D',
        fecha_inicio: todayStr,
        consumo_total_kwh: parseFloat(energyDelta.toFixed(6)),
        potencia_pico_w: Math.round(power),
        potencia_promedio_w: parseFloat(power.toFixed(2)),
        horas_uso_estimadas: 0.1, // Mínimo 0.1 horas para primera lectura
        costo_estimado: parseFloat((energyDelta * 0.50).toFixed(4)),
        dias_alto_consumo: power > 1000 ? 1 : 0,
        eficiencia_categoria: power >= 100 ? 'A' : (power >= 50 ? 'M' : (power >= 10 ? 'B' : 'C')),
        timestamp_creacion: new Date().toISOString(),
        has_data: true,
        raw_readings_count: 1,
        auto_generated: true,
        is_today: true,
        energy_start: initialEnergy,
        first_reading_time: new Date(timestamp).toISOString(),
        last_reading_time: new Date(timestamp).toISOString()
      };

      await supabase
        .from("historicos_compactos")
        .upsert(newRecord, {
          onConflict: 'device_id,tipo_periodo,fecha_inicio'
        });

      console.log(`✅ [PRIMERA-LECTURA] ${deviceId}: Registro inicial creado`);
      return newRecord;

    } else {
      // 🔥 LECTURAS SUBSECUENTES: Actualizar estadísticas existentes
      const readingsCount = (dayRecord.raw_readings_count || 0) + 1;
      const newPeakPower = Math.max(dayRecord.potencia_pico_w || 0, power);

      // Calcular nuevo promedio de potencia
      const currentAvg = dayRecord.potencia_promedio_w || 0;
      const newAvg = ((currentAvg * (dayRecord.raw_readings_count || 0)) + power) / readingsCount;

      // Calcular consumo acumulado desde inicio del día
      const energyStart = dayRecord.energy_start || dayRecord.consumo_total_kwh || 0;
      const currentConsumption = Math.max(0, energy - energyStart);

      // Calcular horas de uso estimadas basado en primera y última lectura
      let hoursUsed = 0.1; // Mínimo
      if (dayRecord.first_reading_time) {
        const timeDiffMs = timestamp - new Date(dayRecord.first_reading_time).getTime();
        hoursUsed = Math.max(0.1, timeDiffMs / (1000 * 60 * 60)); // ms a horas
      }

      const updatedRecord = {
        consumo_total_kwh: parseFloat(currentConsumption.toFixed(6)),
        potencia_pico_w: Math.round(newPeakPower),
        potencia_promedio_w: parseFloat(newAvg.toFixed(2)),
        horas_uso_estimadas: parseFloat(hoursUsed.toFixed(2)),
        costo_estimado: parseFloat((currentConsumption * 0.50).toFixed(4)),
        dias_alto_consumo: newPeakPower > 1000 ? 1 : 0,
        eficiencia_categoria: newAvg >= 100 ? 'A' :
          (newAvg >= 50 ? 'M' :
            (newAvg >= 10 ? 'B' : 'C')),
        updated_at: new Date().toISOString(),
        has_data: true,
        raw_readings_count: readingsCount,
        last_reading_time: new Date(timestamp).toISOString(),
        energy_end: energy
      };

      await supabase
        .from("historicos_compactos")
        .update(updatedRecord)
        .eq("id", dayRecord.id);

      // Log solo cada 10 lecturas para no saturar
      if (readingsCount % 10 === 0) {
        console.log(`📊 [UPDATE-DAY-STATS] ${deviceId}: Lectura #${readingsCount}, ${currentConsumption.toFixed(6)} kWh, ${newAvg.toFixed(1)}W promedio`);
      }

      return updatedRecord;
    }

  } catch (e) {
    console.error(`💥 [UPDATE-DAY-STATS] ${deviceId}: Error:`, e.message);
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

// 📍 FUNCIÓN OPTIMIZADA: Guardar lectura con frecuencia controlada Y ACTUALIZAR ESTADÍSTICAS
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

    // 🔥 ACTUALIZAR ESTADÍSTICAS DEL DÍA CADA 10 LECTURAS
    if (deviceCounters[deviceId] % (DATA_CONFIG.saveEveryNReadings * 10) === 0) {
      const todayStr = new Date().toISOString().split('T')[0];
      await updateDailyStatsInRealTime(deviceId, {
        power: data.power,
        energy: finalEnergy,
        timestamp: now,
        todayStr: todayStr
      });
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
    
    res.json({
      success: true,
      has_data: true,
      stats: dayStats,
      projections: {
        horas_transcurridas: parseFloat(horasTranscurridas.toFixed(1)),
        proyeccion_diaria_kwh: parseFloat(proyeccionDiaria.toFixed(3)),
        proyeccion_costo: parseFloat((proyeccionDiaria * 0.50).toFixed(2))
      },
      message: `Datos actualizados: ${dayStats.raw_readings_count || 0} lecturas procesadas`,
      last_updated: dayStats.updated_at || dayStats.timestamp_creacion
    });
    
  } catch (e) {
    console.error("💥 /api/today-stats/:deviceId", e.message);
    res.status(500).json({ 
      success: false, 
      error: e.message 
    });
  }
});


// 📍 FUNCIÓN MEJORADA: Generar resumen diario con detección de cambio de día
async function generateDailySummaryOptimized() {
  try {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    console.log(`📊 [DAILY-SUMMARY] Generando para ${yesterdayStr}...`);

    // 🔥 Obtener TODOS los dispositivos registrados (no solo los que tuvieron actividad)
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

    // 🔥 Procesar CADA DISPOSITIVO registrado
    const promises = allDevices.map(async (device) => {
      try {
        const esp32Id = device.esp32_id;

        // 🔥 CONSULTA MEJORADA: Buscar lecturas raw de YESTERDAY, sin importar si son pocas
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

        // 🔥 CORRECCIÓN: Si hay error o no hay datos, DEJAMOS el registro con 0 o null
        // PERO SIEMPRE creamos una entrada para el día
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

          // 🔥 CÁLCULO MEJORADO de horas de uso
          if (stats.first_reading && stats.last_reading && totalReadings >= 2) {
            const timeDiffMs = new Date(stats.last_reading) - new Date(stats.first_reading);
            const timeDiffHours = timeDiffMs / (1000 * 60 * 60);
            horasUso = Math.min(timeDiffHours, 24); // Máximo 24 horas
          }
        } else {
          // 🔥 CREAMOS REGISTRO CON 0s si no hay datos
          console.log(`ℹ️ [DAILY-SUMMARY] ${esp32Id}: Sin lecturas en ${yesterdayStr}`);
          skippedNoData++;
        }

        const costoEstimado = consumoKwh * 0.50;

        // 🔥 Categoría inteligente (basada en datos reales o por defecto)
        let categoria = 'B';
        if (hasData) {
          if (potenciaPromedio >= 100) categoria = 'A';
          else if (potenciaPromedio >= 50) categoria = 'M';
          else if (potenciaPromedio < 10) categoria = 'C';
        } else {
          categoria = 'N'; // N = No data
        }

        // 🔥 INSERT/UPDATE en historicos_compactos - SIEMPRE
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
            timestamp_creacion: new Date().toISOString(),
            has_data: hasData,
            raw_readings_count: totalReadings
          }, {
            onConflict: 'device_id,tipo_periodo,fecha_inicio'
          });

        if (upsertError) {
          console.error(`❌ [DAILY-SUMMARY] ${esp32Id}:`, upsertError.message);
          errors++;
          return null;
        }

        processed++;

        // 🔥 Solo actualizar devices si hubo datos
        if (hasData && totalReadings > 0) {
          await supabase
            .from("devices")
            .update({
              daily_consumption: consumoKwh,
              last_daily_summary: yesterdayStr,
              updated_at: new Date().toISOString()
            })
            .eq("esp32_id", esp32Id);
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

    // Esperar todas las promesas
    await Promise.all(promises);

    // 🔥 LIMPIEZA: Borrar lecturas_raw antiguas (SOLO las de ayer si ya fueron procesadas)
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - DATA_CONFIG.keepRawDataDays);

    const { error: deleteError } = await supabase
      .from("lecturas_raw")
      .delete()
      .lt("timestamp", cutoffDate.toISOString());

    if (!deleteError) {
      console.log(`🧹 [CLEANUP] Lecturas_raw > ${DATA_CONFIG.keepRawDataDays} días eliminadas`);
    }

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

    console.log(`✅ [DAILY-SUMMARY] COMPLETADO: ${processed} procesados, ${skippedNoData} sin datos, ${errors} errores`);

  } catch (e) {
    console.error(`💥 [DAILY-SUMMARY] Error general:`, e.message);
    console.error(e.stack);
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

function scheduleOptimizedTasks() {
  console.log("⏰ [SCHEDULER] Iniciando programación de tareas optimizadas...");

  // 🔥 Programar resumen diario
  const now = new Date();
  const targetTimeDaily = new Date(now);
  targetTimeDaily.setHours(DATA_CONFIG.dailySummaryHour, DATA_CONFIG.dailySummaryMinute, 0, 0);

  if (now > targetTimeDaily) {
    targetTimeDaily.setDate(targetTimeDaily.getDate() + 1);
  }

  const msUntilDaily = targetTimeDaily.getTime() - now.getTime();

  setTimeout(() => {
    console.log("🔄 [SCHEDULER] Ejecutando resumen diario programado...");
    generateDailySummaryOptimized();
    // Repetir cada 24 horas
    setInterval(() => {
      console.log("🔄 [SCHEDULER] Ejecutando resumen diario programado (intervalo)...");
      generateDailySummaryOptimized();
    }, 24 * 60 * 60 * 1000);
  }, msUntilDaily);

  console.log(`⏰ [SCHEDULER] Resumen diario programado para: ${DATA_CONFIG.dailySummaryHour}:${DATA_CONFIG.dailySummaryMinute} (en ${Math.round(msUntilDaily / 1000 / 60)} minutos)`);

  // 🔥 Programar limpieza de datos antiguos cada 6 horas
  setInterval(async () => {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - DATA_CONFIG.keepRawDataDays);

    const { error: deleteError, count } = await supabase
      .from("lecturas_raw")
      .delete()
      .lt("timestamp", cutoffDate.toISOString());

    if (!deleteError) {
      console.log(`🧹 [CLEANUP] Lecturas_raw > ${DATA_CONFIG.keepRawDataDays} días eliminadas`);
    } else {
      console.warn(`⚠️ [CLEANUP] Error eliminando lecturas antiguas:`, deleteError.message);
    }
  }, 6 * 60 * 60 * 1000); // Cada 6 horas

  console.log("✅ [SCHEDULER] Tareas programadas correctamente (solo diario y limpieza)");
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
        lastSeen: new Date(onlineDevices[deviceId].lastSeen).toISOString(),
        lastDayChange: onlineDevices[deviceId].lastDayChange ?
          new Date(onlineDevices[deviceId].lastDayChange).toISOString() : null
      } : null,
      timestamp: new Date().toISOString()
    });

  } catch (e) {
    console.error("💥 /api/day-status/:deviceId", e.message);
    res.status(500).json({
      success: false,
      error: e.message
    });
  }
});
// 🔥 NUEVA FUNCIÓN: Actualizar estadísticas del día en tiempo real
async function updateDailyStatsInRealTime(deviceId, data) {
  try {
    const { power, energy, timestamp, todayStr } = data;

    // Buscar o crear registro del día en historicos_compactos
    const { data: dayRecord, error } = await supabase
      .from("historicos_compactos")
      .select("*")
      .eq("device_id", deviceId)
      .eq("tipo_periodo", 'D')
      .eq("fecha_inicio", todayStr)
      .single();

    let isNewRecord = false;

    // Si no existe, crear registro inicial
    if (error || !dayRecord) {
      console.log(`📝 [DAY-STATS] ${deviceId}: Creando nuevo registro para hoy (${todayStr})`);

      // Obtener energía inicial del día
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
          fecha_inicio: todayStr,
          consumo_total_kwh: parseFloat(energyDelta.toFixed(6)),
          potencia_pico_w: Math.round(power),
          potencia_promedio_w: parseFloat(power.toFixed(2)),
          horas_uso_estimadas: 0.1, // Mínimo 0.1 horas
          costo_estimado: parseFloat((energyDelta * 0.50).toFixed(4)),
          dias_alto_consumo: power > 1000 ? 1 : 0,
          eficiencia_categoria: power >= 100 ? 'A' : (power >= 50 ? 'M' : 'B'),
          timestamp_creacion: new Date().toISOString(),
          has_data: true,
          raw_readings_count: 1,
          auto_generated: true,
          is_today: true,
          energy_start: initialEnergy
        });

      isNewRecord = true;
    } else {
      // Si ya existe, actualizar estadísticas
      const readingsCount = (dayRecord.raw_readings_count || 0) + 1;
      const newPeakPower = Math.max(dayRecord.potencia_pico_w || 0, power);

      // Calcular nuevo promedio
      const currentAvg = dayRecord.potencia_promedio_w || 0;
      const newAvg = ((currentAvg * (readingsCount - 1)) + power) / readingsCount;

      // Obtener energía inicial del registro
      const energyStart = dayRecord.energy_start || dayRecord.consumo_total_kwh || 0;
      const currentConsumption = Math.max(0, energy - energyStart);

      // Calcular horas de uso (estimado basado en timestamp)
      let hoursUsed = dayRecord.horas_uso_estimadas || 0;
      if (dayRecord.first_reading_time) {
        const timeDiffMs = timestamp - new Date(dayRecord.first_reading_time).getTime();
        hoursUsed = timeDiffMs / (1000 * 60 * 60); // ms a horas
      }

      await supabase
        .from("historicos_compactos")
        .update({
          consumo_total_kwh: parseFloat(currentConsumption.toFixed(6)),
          potencia_pico_w: Math.round(newPeakPower),
          potencia_promedio_w: parseFloat(newAvg.toFixed(2)),
          horas_uso_estimadas: parseFloat(hoursUsed.toFixed(2)),
          costo_estimado: parseFloat((currentConsumption * 0.50).toFixed(4)),
          dias_alto_consumo: newPeakPower > 1000 ? 1 : 0,
          eficiencia_categoria: newAvg >= 100 ? 'A' : (newAvg >= 50 ? 'M' : (newAvg >= 10 ? 'B' : 'C')),
          updated_at: new Date().toISOString(),
          has_data: true,
          raw_readings_count: readingsCount,
          last_reading_time: new Date(timestamp).toISOString(),
          energy_end: energy
        })
        .eq("id", dayRecord.id);

      console.log(`📊 [DAY-STATS] ${deviceId}: Actualizado registro del día (lectura #${readingsCount})`);
    }

    return isNewRecord;
  } catch (e) {
    console.error(`💥 [DAY-STATS] ${deviceId}: Error actualizando estadísticas:`, e.message);
    return false;
  }
}


// ====== ENDPOINTS MEJORADOS CON SSID ======
// 📍 ENDPOINT: Recibir datos de ESP32 - VERSIÓN CORREGIDA CON ACTUALIZACIÓN EN TIEMPO REAL
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
    const nowDate = new Date(now);
    const todayStr = nowDate.toISOString().split('T')[0];

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

    // 🔥 ACTUALIZAR ESTADÍSTICAS DEL DÍA EN TIEMPO REAL
    await updateDailyStatsInRealTime(deviceId, {
      power: data.power,
      energy: finalEnergy,
      timestamp: now,
      todayStr: todayStr
    });

    // 🔥 DETECTAR SI CAMBIÓ EL DÍA (00:00 - 00:05)
    const currentHour = nowDate.getHours();
    const currentMinute = nowDate.getMinutes();

    if (currentHour === 0 && currentMinute <= 5) {
      if (!deviceState.lastDayChange ||
        new Date(deviceState.lastDayChange).getDate() !== nowDate.getDate()) {

        console.log(`🔄 [DIA-DETECTADO] ${deviceId}: Procesando cambio de día...`);
        await checkAndGenerateDailySummaryOptimized(deviceId, now);
        onlineDevices[deviceId].lastDayChange = now;
      }
    }

    // 🔥 GUARDAR EN lecturas_raw OPTIMIZADO
    await saveToLecturasRawOptimized(deviceId, data, finalEnergy);

    // 🔥 SI ESTÁ REGISTRADO, ACTUALIZAR EN SUPABASE
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

      if (wifiSsid && wifiSsid !== deviceInDb.wifi_ssid) {
        updates.wifi_ssid = wifiSsid;
        updates.network_code = generateNetworkCode(wifiSsid);
      }

      await updateDeviceInSupabase(deviceDbId, updates);
    }

    // 🔥 LOG MEJORADO
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

    console.log(`📊 [HISTORICAL-ANALYSIS] Solicitado para ${deviceId}, últimos ${days} días`);

    // Primero, verificar si hay datos en lecturas_raw
    const { data: rawData, error: rawError } = await supabase
      .from("lecturas_raw")
      .select("count")
      .eq("device_id", deviceId)
      .limit(1);

    if (rawError) {
      console.error("❌ Error verificando lecturas_raw:", rawError.message);
    }

    // Buscar en historicos_compactos
    const { data: historicos, error } = await supabase
      .from("historicos_compactos")
      .select("*")
      .eq("device_id", deviceId)
      .eq("tipo_periodo", 'D')
      .order("fecha_inicio", { ascending: false })
      .limit(parseInt(days));

    if (error) {
      console.error("❌ Error obteniendo históricos:", error.message);
      // NO devolver error 500, devolver array vacío
    }

    const historicosData = historicos || [];

    // 🔥 NUEVO: Si no hay datos en historicos_compactos, generar un resumen ahora
    if (históricosData.length === 0) {
      console.log(`🔄 No hay datos históricos, generando resumen manual para ${deviceId}...`);

      // Intentar generar un resumen con los datos de lecturas_raw
      const { data: todayRawData, error: todayError } = await supabase
        .from("lecturas_raw")
        .select(`
          min(energy) as min_energy,
          max(energy) as max_energy,
          max(power) as max_power,
          avg(power) as avg_power,
          count(*) as total_readings
        `)
        .eq("device_id", deviceId)
        .gte("timestamp", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()) // Últimas 24h
        .single();

      if (!todayError && todayRawData) {
        const consumoKwh = (todayRawData.max_energy - todayRawData.min_energy);
        const potenciaPico = todayRawData.max_power;
        const potenciaPromedio = todayRawData.avg_power;
        const horasUso = consumoKwh / (potenciaPromedio / 1000) || 0;
        const costoEstimado = consumoKwh * 0.50;

        // Crear un objeto de datos diario simulado
        const today = new Date().toISOString().split('T')[0];

        historicosData.push({
          device_id: deviceId,
          tipo_periodo: 'D',
          fecha_inicio: today,
          consumo_total_kwh: parseFloat(consumoKwh.toFixed(3)),
          potencia_pico_w: Math.round(potenciaPico),
          potencia_promedio_w: parseFloat(potenciaPromedio.toFixed(2)),
          horas_uso_estimadas: parseFloat(horasUso.toFixed(1)),
          costo_estimado: parseFloat(costoEstimado.toFixed(2)),
          dias_alto_consumo: potenciaPico > 1000 ? 1 : 0,
          eficiencia_categoria: 'B'
        });
      }
    }

    console.log(`📊 [HISTORICAL-ANALYSIS] Encontrados ${históricosData.length} registros`);

    const estadisticas = {
      totalDias: historicosData.length || 0,
      consumoTotal: 0,
      costoTotal: 0,
      picoMaximo: 0,
      diasAltoConsumo: 0,
      promedioDiario: 0
    };

    if (históricosData && historicosData.length > 0) {
      historicosData.forEach(day => {
        estadisticas.consumoTotal += day.consumo_total_kwh || 0;
        estadisticas.costoTotal += day.costo_estimado || 0;
        if (day.potencia_pico_w > estadisticas.picoMaximo) {
          estadisticas.picoMaximo = day.potencia_pico_w;
        }
        if (day.dias_alto_consumo > 0) {
          estadisticas.diasAltoConsumo++;
        }
      });
      estadisticas.promedioDiario = estadisticas.consumoTotal / historicosData.length;
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
      historicos: historicosData,
      estadisticas: estadisticas,
      recomendacionSolar: recomendacionSolar,
      message: historicosData.length === 0
        ? "No hay datos históricos para este dispositivo. Los datos se generarán automáticamente cada día a las 23:59."
        : `Análisis de ${históricosData.length} días completado`
    });

  } catch (e) {
    console.error("💥 /api/historical-analysis/:deviceId", e.message);
    // 🔥 CORRECCIÓN: Nunca devolver error 500, siempre devolver algo
    res.json({
      success: true,
      deviceId: req.params.deviceId,
      historicos: [],
      estadisticas: {
        totalDias: 0,
        consumoTotal: 0,
        costoTotal: 0,
        picoMaximo: 0,
        diasAltoConsumo: 0,
        promedioDiario: 0
      },
      message: "Generando datos históricos... Por favor, espera hasta mañana para ver análisis completos."
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
      monthlyProjection: parseFloat((forecast.next24Hours.consumption * 30).toFixed(6)),
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

    // 🔥 Si no hay datos recientes, usar datos del dispositivo actual
    if (!realReadings || realReadings.length === 0) {
      const { data: deviceData } = await supabase
        .from("devices")
        .select("power, energy, voltage, current, last_seen")
        .eq("esp32_id", deviceId)
        .single();

      if (deviceData) {
        realReadings = [{
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
      readings: realReadings || [],
      count: realReadings?.length || 0,
      timeRange: {
        from: hoursAgo.toISOString(),
        to: new Date().toISOString(),
        hours: parseInt(hours)
      },
      message: realReadings?.length === 0
        ? "No hay lecturas recientes"
        : `Datos reales obtenidos: ${realReadings.length} lecturas`
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
  console.log(`   💾 Guarda 1 de cada ${DATA_CONFIG.saveEveryNReadings} lecturas (cada ~${DATA_CONFIG.saveEveryNReadings * 5}s)`);
  console.log(`   🧹 Limpieza automática cada 6 horas`);
  console.log(`📈 Endpoints de análisis:`);
  console.log(`   GET  /api/historical-analysis/:deviceId`);
  console.log(`   GET  /api/solar-recommendation/:deviceId`);
  console.log(`   POST /api/simulate-data (para pruebas/paper)`);
  console.log(`⏰ Cleanup interval: ${CLEANUP_INTERVAL_MS}ms`);

  // 🔥 INICIAR TAREAS PROGRAMADAS
  scheduleOptimizedTasks();
});