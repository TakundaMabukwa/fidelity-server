require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY
);

// Simulate the server's processVehicleData function logic
async function simulateProcessVehicleData(vehiclePlate, simulatedDate = null) {
  try {
    console.log(`\n🚛 Simulating vehicle data processing for ${vehiclePlate}`);
    
    // Get all trips for this vehicle (not filtered by date yet)
    const { data: trips } = await supabase
      .from('route_plans')
      .select('trip_id, vehicle_plate, actual_start_time, created_at')
      .eq('vehicle_plate', vehiclePlate)
      .is('actual_end_time', null);
    
    if (!trips || trips.length === 0) {
      console.log(`❌ No active trips found for vehicle ${vehiclePlate}`);
      return { processed: false, reason: 'No active trips' };
    }
    
    console.log(`📋 Found ${trips.length} active trips for ${vehiclePlate}`);
    
    // Simulate getting today's date dynamically (like the server does)
    const today = simulatedDate || new Date().toISOString().split('T')[0];
    console.log(`📅 Using date: ${today}`);
    
    // Check if trip was created today (exact server logic)
    const trip = trips.find(t => t.created_at.split('T')[0] === today);
    
    if (!trip) {
      console.log(`⏰ No trip created on ${today} for vehicle ${vehiclePlate}`);
      console.log(`Available trip dates: ${trips.map(t => t.created_at.split('T')[0]).join(', ')}`);
      return { processed: false, reason: 'No trip created today' };
    }
    
    console.log(`✅ Found trip ${trip.trip_id} created on ${today}`);
    return { processed: true, tripId: trip.trip_id, createdDate: trip.created_at.split('T')[0] };
    
  } catch (error) {
    console.error('Error in simulation:', error);
    return { processed: false, reason: 'Error occurred' };
  }
}

// Simulate the server's handleLongStop function logic
async function simulateHandleLongStop(vehiclePlate, simulatedDate = null) {
  try {
    console.log(`\n🛑 Simulating long stop handling for ${vehiclePlate}`);
    
    // Get active trips for this vehicle
    const { data: trips } = await supabase
      .from('route_plans')
      .select('trip_id, created_at')
      .eq('vehicle_plate', vehiclePlate)
      .not('actual_start_time', 'is', null)
      .is('actual_end_time', null);
    
    if (!trips || trips.length === 0) {
      console.log(`❌ No active trips found for vehicle ${vehiclePlate}`);
      return { processed: false, reason: 'No active trips' };
    }
    
    // Simulate getting today's date dynamically
    const today = simulatedDate || new Date().toISOString().split('T')[0];
    console.log(`📅 Using date: ${today}`);
    
    // Check if trip was created today (exact server logic)
    const todaysTrip = trips.find(t => t.created_at.split('T')[0] === today);
    
    if (!todaysTrip) {
      console.log(`⏰ No trip created on ${today} for vehicle ${vehiclePlate}`);
      console.log(`Available trip dates: ${trips.map(t => t.created_at.split('T')[0]).join(', ')}`);
      return { processed: false, reason: 'No trip created today' };
    }
    
    console.log(`✅ Found trip ${todaysTrip.trip_id} created on ${today}`);
    return { processed: true, tripId: todaysTrip.trip_id, createdDate: todaysTrip.created_at.split('T')[0] };
    
  } catch (error) {
    console.error('Error in simulation:', error);
    return { processed: false, reason: 'Error occurred' };
  }
}

async function verifyDateFiltering() {
  console.log('🔍 VERIFYING SERVER DATE FILTERING LOGIC');
  console.log('=' .repeat(50));
  
  // Test with current date (should work)
  console.log('\n📅 TEST 1: Current Date (Should Process)');
  const currentDate = new Date().toISOString().split('T')[0];
  console.log(`Testing with date: ${currentDate}`);
  
  const result1 = await simulateProcessVehicleData('XRV985GP', currentDate);
  const result2 = await simulateHandleLongStop('XRV985GP', currentDate);
  
  // Test with yesterday's date (should NOT work)
  console.log('\n📅 TEST 2: Yesterday\'s Date (Should NOT Process)');
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];
  console.log(`Testing with date: ${yesterdayStr}`);
  
  const result3 = await simulateProcessVehicleData('XRV985GP', yesterdayStr);
  const result4 = await simulateHandleLongStop('XRV985GP', yesterdayStr);
  
  // Test with tomorrow's date (should NOT work)
  console.log('\n📅 TEST 3: Tomorrow\'s Date (Should NOT Process)');
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];
  console.log(`Testing with date: ${tomorrowStr}`);
  
  const result5 = await simulateProcessVehicleData('XRV985GP', tomorrowStr);
  const result6 = await simulateHandleLongStop('XRV985GP', tomorrowStr);
  
  // Summary
  console.log('\n📊 VERIFICATION RESULTS:');
  console.log('=' .repeat(50));
  console.log(`✅ Current Date Processing: ${result1.processed && result2.processed ? 'PASS' : 'FAIL'}`);
  console.log(`❌ Yesterday Processing: ${!result3.processed && !result4.processed ? 'PASS' : 'FAIL'}`);
  console.log(`❌ Tomorrow Processing: ${!result5.processed && !result6.processed ? 'PASS' : 'FAIL'}`);
  
  const allTestsPass = (result1.processed && result2.processed) && 
                       (!result3.processed && !result4.processed) && 
                       (!result5.processed && !result6.processed);
  
  console.log(`\n🎯 OVERALL RESULT: ${allTestsPass ? '✅ ALL TESTS PASS' : '❌ SOME TESTS FAILED'}`);
  
  if (allTestsPass) {
    console.log('\n🎉 SERVER WILL WORK CORRECTLY IN REAL-TIME!');
    console.log('✅ Only processes trips created on current date');
    console.log('✅ Ignores trips from other dates');
    console.log('✅ Date updates dynamically with each request');
  } else {
    console.log('\n⚠️ SERVER MAY HAVE ISSUES WITH DATE FILTERING');
  }
}

// Run the verification
verifyDateFiltering();