// Test script to simulate 5+ minute stop
const axios = require('axios');

async function test5MinuteStop() {
  try {
    console.log('Testing 5-minute stop detection...');
    
    // Simulate GPS data with LocTime 6 minutes ago (past timestamp)
    const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000);
    const locTimeString = sixMinutesAgo.toISOString().slice(0, 19).replace('T', ' ');
    
    const gpsData = {
      Plate: 'BH47JSGP',
      Speed: 0,
      Latitude: -26.1440,
      Longitude: 28.0436,
      LocTime: locTimeString,
      Quality: '',
      Mileage: 12345,
      Head: 'N',
      Address: 'Test Location - 6 minutes ago'
    };
    
    console.log('Sending GPS data with LocTime:', locTimeString);
    
    const response = await axios.post('http://localhost:3001/test/simulate-gps', gpsData);
    console.log('Response:', response.data);
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

test5MinuteStop();