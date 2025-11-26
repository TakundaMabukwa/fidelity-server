require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const distance = require('@turf/distance').default;

// Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY
);

async function updateCompletionTimes() {
  try {
    console.log('🕐 Updating completion times to actual vehicle location times...');
    
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
    
    let totalUpdated = 0;
    
    for (const trip of trips) {
      console.log(`\n🚛 Processing trip ${trip.trip_id} for vehicle ${trip.vehicle_plate}`);
      
      // Get trip coordinates between 11:11 AM and 3:00 PM today
      const after1111 = today + 'T11:11:00';
      const before3pm = today + 'T15:00:00';
      const { data: coordinates } = await supabase
        .from('trip_coordinates')
        .select('latitude, longitude, timestamp')
        .eq('trip_id', trip.trip_id)
        .gte('timestamp', after1111)
        .lt('timestamp', before3pm)
        .order('timestamp', { ascending: true });
      
      if (!coordinates || coordinates.length === 0) {
        console.log(`⏰ No coordinates found between 11:11 AM - 3:00 PM for trip ${trip.trip_id}`);
        continue;
      }
      
      console.log(`📍 Found ${coordinates.length} coordinates between 11:11 AM - 3:00 PM`);
      
      // Get completed customers for this trip (that we just marked complete)
      const { data: customers } = await supabase
        .from('assigned_customers')
        .select('customer_code, latitude, longitude, completed_at')
        .eq('trip_id', trip.trip_id)
        .eq('completed', true)
        .not('completed_at', 'is', null);
      
      if (!customers || customers.length === 0) {
        console.log(`✅ No completed customers for trip ${trip.trip_id}`);
        continue;
      }
      
      console.log(`👥 Updating ${customers.length} completed customers`);
      
      // Update each completed customer with actual vehicle location time
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
        
        // Update completion time to actual vehicle location time
        if (closestCoordinate && minDistance <= 5) {
          const { error } = await supabase
            .from('assigned_customers')
            .update({ 
              completed_at: closestCoordinate.timestamp
            })
            .eq('trip_id', trip.trip_id)
            .eq('customer_code', customer.customer_code);
          
          if (error) {
            console.error(`❌ Error updating customer ${customer.customer_code}:`, error);
          } else {
            console.log(`✅ Updated ${customer.customer_code}: completed_at = ${closestCoordinate.timestamp} (${minDistance.toFixed(3)}km away)`);
            totalUpdated++;
          }
        }
      }
    }
    
    console.log(`\n🎉 Update completed! Total customers updated: ${totalUpdated}`);
    
  } catch (error) {
    console.error('💥 Script error:', error);
  }
}

// Run the script
updateCompletionTimes();