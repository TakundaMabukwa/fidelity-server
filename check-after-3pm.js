require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const distance = require('@turf/distance').default;

// Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY
);

async function checkAfter3PM() {
  try {
    console.log('🔍 Checking remaining customers after 3 PM...');
    
    // Get today's date
    const today = new Date().toISOString().split('T')[0];
    console.log(`📅 Processing trips created on: ${today}`);
    
    // Get all trips created today
    const { data: trips } = await supabase
      .from('route_plans')
      .select('trip_id, vehicle_plate, created_at')
      .gte('created_at', today)
      .lt('created_at', today + 'T23:59:59');
    
    if (!trips || trips.length === 0) {
      console.log('❌ No trips found for today');
      return;
    }
    
    console.log(`📋 Found ${trips.length} trips created today`);
    
    let totalWouldComplete = 0;
    
    for (const trip of trips) {
      console.log(`\n🚛 Processing trip ${trip.trip_id} for vehicle ${trip.vehicle_plate}`);
      
      // Get trip coordinates AFTER 3:00 PM today
      const after3pm = today + 'T15:00:00';
      const { data: coordinates } = await supabase
        .from('trip_coordinates')
        .select('latitude, longitude, timestamp')
        .eq('trip_id', trip.trip_id)
        .gte('timestamp', after3pm)
        .order('timestamp', { ascending: true });
      
      if (!coordinates || coordinates.length === 0) {
        console.log(`⏰ No coordinates found after 3:00 PM for trip ${trip.trip_id}`);
        continue;
      }
      
      console.log(`📍 Found ${coordinates.length} coordinates after 3:00 PM`);
      
      // Get remaining incomplete customers for this trip
      const { data: customers } = await supabase
        .from('assigned_customers')
        .select('customer_code, latitude, longitude, completed')
        .eq('trip_id', trip.trip_id)
        .eq('completed', false);
      
      if (!customers || customers.length === 0) {
        console.log(`✅ No remaining incomplete customers for trip ${trip.trip_id}`);
        continue;
      }
      
      console.log(`👥 Checking ${customers.length} remaining incomplete customers`);
      
      // Check each customer against all coordinates
      for (const customer of customers) {
        if (!customer.latitude || !customer.longitude) {
          console.log(`⚠️ Customer ${customer.customer_code} missing coordinates`);
          continue;
        }
        
        const customerPoint = [parseFloat(customer.longitude), parseFloat(customer.latitude)];
        let minDistance = Infinity;
        let closestCoordinate = null;
        
        // Find closest vehicle position to this customer
        for (const coord of coordinates) {
          const vehiclePoint = [parseFloat(coord.longitude), parseFloat(coord.latitude)];
          const dist = distance(vehiclePoint, customerPoint, { units: 'kilometers' });
          
          if (dist < minDistance) {
            minDistance = dist;
            closestCoordinate = coord;
          }
        }
        
        console.log(`📏 Customer ${customer.customer_code}: closest distance ${minDistance.toFixed(3)}km`);
        
        // Check if customer would be completed (within 5km) after 3 PM
        if (minDistance <= 5) {
          console.log(`🎯 WOULD COMPLETE: Customer ${customer.customer_code} - ${minDistance.toFixed(3)}km away at ${closestCoordinate.timestamp}`);
          totalWouldComplete++;
        }
      }
    }
    
    console.log(`\n📊 AFTER 3 PM RESULTS:`);
    console.log(`Total remaining customers that WOULD be completed: ${totalWouldComplete}`);
    
  } catch (error) {
    console.error('💥 Script error:', error);
  }
}

// Run the script
checkAfter3PM();