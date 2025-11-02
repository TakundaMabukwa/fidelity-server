require('dotenv').config();
const express = require('express');
const WebSocket = require('ws');
const { createClient } = require('@supabase/supabase-js');
const distance = require('@turf/distance').default;

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(express.json());

// Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY
);

// Track active trips and their intervals
const activeTrips = new Map();

// Monitor trip without duplicate coordinate logging
function startTripMonitoring(tripId, vehiclePlate) {
  if (activeTrips.has(tripId)) return;
  
  activeTrips.set(tripId, { vehiclePlate });
  console.log(`Started monitoring trip ${tripId} for vehicle ${vehiclePlate}`);
}

function stopTripMonitoring(tripId) {
  if (activeTrips.has(tripId)) {
    activeTrips.delete(tripId);
    console.log(`Stopped monitoring trip ${tripId}`);
  }
}

// Cache latest vehicle data
const vehicleDataCache = new Map();

// Track vehicle stops
const vehicleStops = new Map(); // plate -> { stopStart, location, lastLocTime }

function getLatestVehicleData(plate) {
  return vehicleDataCache.get(plate);
}

async function logCoordinates(tripId, vehiclePlate, vehicleData) {
  try {
    await supabase
      .from('trip_coordinates')
      .insert({
        trip_id: tripId,
        vehicle_plate: vehiclePlate,
        latitude: parseFloat(vehicleData.Latitude),
        longitude: parseFloat(vehicleData.Longitude),
        speed: vehicleData.Speed || 0,
        timestamp: new Date().toISOString()
      });
  } catch (error) {
    console.error(`Error logging coordinates for trip ${tripId}:`, error);
  }
}

async function checkTripCompletion(tripId) {
  const { data: customers } = await supabase
    .from('assigned_customers')
    .select('completed')
    .eq('trip_id', tripId);
  
  if (customers && customers.length > 0) {
    const allCompleted = customers.every(c => c.completed);
    
    if (allCompleted) {
      // Calculate duration using SQL
      await supabase.rpc('complete_trip', { p_trip_id: tripId });
      
      console.log(`Trip ${tripId} completed - all customers visited`);
    }
  }
}

async function handleLongStop(vehiclePlate, location) {
  // Find active trip for this vehicle
  const { data: trips } = await supabase
    .from('route_plans')
    .select('trip_id')
    .eq('vehicle_plate', vehiclePlate)
    .not('actual_start_time', 'is', null)
    .is('actual_end_time', null);
  
  if (!trips || trips.length === 0) return;
  
  const { trip_id } = trips[0];
  
  // Get incomplete customers for this trip
  const { data: customers } = await supabase
    .from('assigned_customers')
    .select('customer_code, latitude, longitude')
    .eq('trip_id', trip_id)
    .eq('completed', false);
  
  if (customers) {
    for (const customer of customers) {
      const vehiclePoint = [parseFloat(location.lng), parseFloat(location.lat)];
      const customerPoint = [customer.longitude, customer.latitude];
      const distanceKm = distance(vehiclePoint, customerPoint, { units: 'kilometers' });
      
      if (distanceKm <= 1.0) {
        await supabase
          .from('assigned_customers')
          .update({ 
            completed: true, 
            completed_at: new Date().toISOString() 
          })
          .eq('trip_id', trip_id)
          .eq('customer_code', customer.customer_code);
        
        console.log(`Customer ${customer.customer_code} auto-completed after 5min stop - ${distanceKm.toFixed(2)}km away`);
      }
    }
    
    // Check if trip is now complete
    await checkTripCompletion(trip_id);
  }
}

// Process vehicle data from WebSocket
async function processVehicleData(vehicleData) {
  try {
    const { Plate, Speed, Latitude, Longitude } = vehicleData;
    
    if (!Plate || !Latitude || !Longitude) return;
    
    // Find trip for this vehicle (created or active)
    const { data: trips } = await supabase
      .from('route_plans')
      .select('trip_id, vehicle_plate, actual_start_time')
      .eq('vehicle_plate', Plate)
      .is('actual_end_time', null);
    
    if (!trips || trips.length === 0) return;
    
    let { trip_id, actual_start_time } = trips[0];
    
    // Start trip when vehicle starts moving
    if (!actual_start_time && Speed > 0) {
      await supabase
        .from('route_plans')
        .update({ actual_start_time: new Date().toISOString() })
        .eq('trip_id', trip_id);
      console.log(`Trip ${trip_id} started - vehicle moving at ${Speed} km/h`);
      actual_start_time = new Date().toISOString(); // Update local variable
    }
    
    // Only process if trip has started
    if (!actual_start_time) return;
    
    // Store coordinates
    await supabase
      .from('trip_coordinates')
      .insert({
        trip_id,
        vehicle_plate: Plate,
        latitude: parseFloat(Latitude),
        longitude: parseFloat(Longitude),
        speed: Speed || 0,
        timestamp: new Date().toISOString()
      });
    
    // Check customers within 1km and mark as complete
    const { data: customers } = await supabase
      .from('assigned_customers')
      .select('customer_code, latitude, longitude')
      .eq('trip_id', trip_id)
      .eq('completed', false);
    
    if (customers) {
      for (const customer of customers) {
        const vehiclePoint = [parseFloat(Longitude), parseFloat(Latitude)];
        const customerPoint = [customer.longitude, customer.latitude];
        const distanceKm = distance(vehiclePoint, customerPoint, { units: 'kilometers' });
        
        if (distanceKm <= 1.0) { // Within 1km
          await supabase
            .from('assigned_customers')
            .update({ 
              completed: true, 
              completed_at: new Date().toISOString() 
            })
            .eq('trip_id', trip_id)
            .eq('customer_code', customer.customer_code);
          
          console.log(`Customer ${customer.customer_code} marked complete - vehicle within ${distanceKm.toFixed(2)}km`);
          
          // Check if trip is now complete
          await checkTripCompletion(trip_id);
        }
      }
    }
    
  } catch (error) {
    console.error('Error processing vehicle data:', error);
    // Cleanup on error
    if (trip_id) {
      stopTripMonitoring(trip_id);
    }
  }
}

// WebSocket client connection
const ws = new WebSocket(process.env.WEBSOCKET_URL);

ws.on('open', async () => {
  console.log('Connected to WebSocket:', process.env.WEBSOCKET_URL);
  
  // Start monitoring existing active trips on server startup
  try {
    const { data: activeTrips } = await supabase
      .from('route_plans')
      .select('trip_id, vehicle_plate')
      .not('actual_start_time', 'is', null)
      .is('actual_end_time', null);
    
    if (activeTrips) {
      for (const trip of activeTrips) {
        startTripMonitoring(trip.trip_id, trip.vehicle_plate);
      }
      console.log(`Resumed monitoring ${activeTrips.length} active trips`);
    }
  } catch (error) {
    console.error('Error loading active trips:', error);
  }
  
  // Initialize subscriptions after WebSocket ready
  initializeSubscriptions();
});

ws.on('message', async (data) => {
  try {
    const vehicleData = JSON.parse(data.toString());
    
    // Cache latest vehicle data
    vehicleDataCache.set(vehicleData.Plate, vehicleData);
    
    // Validate coordinates
    if (!vehicleData.Latitude || !vehicleData.Longitude) {
      console.error(`Missing coordinates for vehicle ${vehicleData.Plate}`);
      return;
    }
    
    // Track vehicle stops using GPS LocTime
    if (!vehicleData.LocTime) return;
    
    const locTime = new Date(vehicleData.LocTime);
    if (isNaN(locTime.getTime())) {
      console.error(`Invalid LocTime format: ${vehicleData.LocTime}`);
      return;
    }
    
    if (vehicleData.Speed === 0) {
      if (!vehicleStops.has(vehicleData.Plate)) {
        vehicleStops.set(vehicleData.Plate, {
          stopStart: locTime,
          location: { lat: vehicleData.Latitude, lng: vehicleData.Longitude },
          lastLocTime: locTime
        });
        console.log(`Vehicle ${vehicleData.Plate} stopped at ${vehicleData.LocTime}`);
      } else {
        // Update last seen time while stopped
        const stopInfo = vehicleStops.get(vehicleData.Plate);
        stopInfo.lastLocTime = locTime;
        
        // Check if stopped for 5+ minutes
        const stopDuration = (locTime - stopInfo.stopStart) / 1000 / 60; // minutes
        if (stopDuration >= 5 && !stopInfo.processed) {
          await handleLongStop(vehicleData.Plate, stopInfo.location);
          stopInfo.processed = true;
        }
      }
    } else {
      // Vehicle moving, clear stop tracking
      vehicleStops.delete(vehicleData.Plate);
    }
    
    await processVehicleData(vehicleData);
  } catch (error) {
    console.error('Error parsing WebSocket data:', error);
  }
});

// Initialize subscriptions after WebSocket connects
let subscriptionsInitialized = false;

function initializeSubscriptions() {
  if (subscriptionsInitialized) return;
  
  supabase
    .channel('route_plans_changes')
    .on('postgres_changes', 
      { event: 'INSERT', schema: 'public', table: 'route_plans' },
      (payload) => {
        console.log('New trip created:', payload.new);
        startTripMonitoring(payload.new.trip_id, payload.new.vehicle_plate);
      }
    )
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'route_plans' },
      (payload) => {
        if (payload.new.actual_end_time && !payload.old.actual_end_time) {
          stopTripMonitoring(payload.new.trip_id);
        }
      }
    )
    .subscribe();
  
  subscriptionsInitialized = true;
  console.log('Database subscriptions initialized');
}

ws.on('error', (error) => {
  console.error('WebSocket error:', error);
});

ws.on('close', () => {
  console.log('WebSocket connection closed');
});

// Basic Express route
app.get('/', (req, res) => {
  res.json({ message: 'Trip monitoring server running' });
});

// Test simulation endpoint
app.post('/test/simulate-trip', async (req, res) => {
  try {
    const vehiclePlate = 'BH47JSGP';
    const tripId = 'test-trip-' + Date.now();
    
    // 1. Create test trip
    await supabase
      .from('route_plans')
      .insert({
        trip_id: tripId,
        vehicle_plate: vehiclePlate,
        route_name: 'TEST_ROUTE',
        total_stops: 2,
        estimated_duration_minutes: 60
      });
    
    // 2. Add test customers
    await supabase
      .from('assigned_customers')
      .insert([
        {
          trip_id: tripId,
          customer_code: 'TEST_CUST_001',
          customer_name: 'Test Customer 1',
          sequence_order: 1,
          latitude: -26.1440,
          longitude: 28.0436,
          completed: false
        },
        {
          trip_id: tripId,
          customer_code: 'TEST_CUST_002', 
          customer_name: 'Test Customer 2',
          sequence_order: 2,
          latitude: -26.1450,
          longitude: 28.0446,
          completed: false
        }
      ]);
    
    console.log(`Test trip created: ${tripId} for vehicle ${vehiclePlate}`);
    res.json({ success: true, tripId, vehiclePlate });
    
  } catch (error) {
    console.error('Error creating test trip:', error);
    res.status(500).json({ error: error.message });
  }
});

// Simulate GPS data
app.post('/test/simulate-gps', async (req, res) => {
  try {
    const { speed = 0, latitude = -26.1439, longitude = 28.0434 } = req.body;
    
    const testGPSData = {
      Plate: 'BH47JSGP',
      Speed: speed,
      Latitude: latitude,
      Longitude: longitude,
      LocTime: new Date().toISOString().slice(0, 19).replace('T', ' '),
      Quality: '',
      Mileage: 12345,
      Head: 'N',
      Address: 'Test Location'
    };
    
    console.log('Simulating GPS data:', testGPSData);
    await processVehicleData(testGPSData);
    
    res.json({ success: true, data: testGPSData });
    
  } catch (error) {
    console.error('Error simulating GPS:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Express server running on port ${PORT}`);
});