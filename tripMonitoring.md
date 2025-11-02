# Trip Monitoring System - Backend Implementation Guide

## Overview
This system tracks vehicle routes from planning to completion, comparing planned vs actual performance. The frontend handles route assignment and displays progress, while the backend monitors real-time execution.

## Database Schema

### Core Tables Structure
```
routes_new (Route Definitions)
    ↓
route_plans (Planned Trips) ← trip_id (UUID)
    ↓
assigned_customers (Planned Stops)
    ↓
trip_coordinates (Actual Path) + trip_audit (Performance Analysis)
```

## How Planned Trips Work

### 1. Route Definition (`routes_new`)
```sql
-- Route definitions with customers and service days
SELECT * FROM routes_new WHERE route = '845R1' AND service_days ILIKE '%Mon%';
```
- Contains route names (e.g., "845R1")
- Lists customers for each route
- Defines service days
- Includes priority flags

### 2. Trip Creation (`route_plans`)
When a route is assigned to a vehicle:
```sql
-- Example planned trip record
INSERT INTO route_plans (
  trip_id,                    -- UUID: "123e4567-e89b-12d3-a456-426614174000"
  vehicle_plate,              -- "ABC123"
  route_name,                 -- "845R1"
  total_stops,                -- 8
  route_coordinates,          -- JSONB: [[lng,lat], [lng,lat]...] (Mapbox road path)
  waypoint_coordinates,       -- JSONB: Customer sequence with ETAs
  total_distance_km,          -- 45.5
  estimated_duration_minutes  -- 280
);
```

### 3. Customer Sequence (`assigned_customers`)
Each customer stop is planned:
```sql
-- Example customer stops
INSERT INTO assigned_customers (
  trip_id,                           -- Links to route_plans
  customer_code,                     -- "CUST001"
  customer_name,                     -- "ABC Company"
  sequence_order,                    -- 1, 2, 3... (visit order)
  latitude, longitude,               -- Customer location
  planned_eta,                       -- "09:30:00"
  planned_travel_time_minutes,       -- 15
  planned_distance_from_previous_km  -- 5.2
);
```

## Backend Monitoring Implementation

### Phase 1: Trip Lifecycle Tracking

#### Start Trip Monitoring
```sql
-- When vehicle starts moving (speed > 0 for first time)
UPDATE route_plans 
SET actual_start_time = NOW() 
WHERE trip_id = ? AND actual_start_time IS NULL;
```

#### Store Real-time Coordinates
```sql
-- Store vehicle positions every 30-60 seconds
INSERT INTO trip_coordinates (trip_id, vehicle_plate, latitude, longitude, speed, timestamp)
VALUES (?, ?, ?, ?, ?, ?);
```

#### Mark Customer Completed
```sql
-- When customer visit is completed (manual or automatic)
UPDATE assigned_customers 
SET completed = TRUE,
    completed_at = NOW(),
    actual_arrival_time = ?,
    actual_departure_time = ?,
    actual_visit_duration_minutes = ?
WHERE trip_id = ? AND customer_code = ?;
```

#### End Trip
```sql
-- When all customers completed or trip cancelled
UPDATE route_plans 
SET actual_end_time = NOW(),
    actual_duration_minutes = EXTRACT(EPOCH FROM (NOW() - actual_start_time))/60,
    completed = TRUE
WHERE trip_id = ?;
```

### Phase 2: Performance Analysis

#### Calculate Actual Distance
```sql
-- Calculate total distance from coordinates using Haversine formula
WITH coordinate_pairs AS (
  SELECT 
    latitude, longitude,
    LAG(latitude) OVER (ORDER BY timestamp) as prev_lat,
    LAG(longitude) OVER (ORDER BY timestamp) as prev_lng
  FROM trip_coordinates 
  WHERE trip_id = ?
)
SELECT SUM(
  6371 * acos(
    cos(radians(prev_lat)) * cos(radians(latitude)) * 
    cos(radians(longitude) - radians(prev_lng)) + 
    sin(radians(prev_lat)) * sin(radians(latitude))
  )
) as actual_distance_km
FROM coordinate_pairs 
WHERE prev_lat IS NOT NULL;
```

#### Create Audit Record
```sql
-- Generate performance comparison
INSERT INTO trip_audit (
  trip_id, vehicle_plate, route_name,
  planned_duration_minutes, actual_duration_minutes, duration_variance_minutes,
  planned_distance_km, actual_distance_km, distance_variance_km,
  total_customers, completed_customers, completion_rate,
  time_efficiency, distance_efficiency, trip_status
)
SELECT 
  rp.trip_id, rp.vehicle_plate, rp.route_name,
  rp.estimated_duration_minutes, rp.actual_duration_minutes, 
  (rp.actual_duration_minutes - rp.estimated_duration_minutes),
  rp.total_distance_km, rp.actual_distance_km,
  (rp.actual_distance_km - rp.total_distance_km),
  rp.total_stops,
  (SELECT COUNT(*) FROM assigned_customers WHERE trip_id = rp.trip_id AND completed = TRUE),
  (SELECT COUNT(*) FROM assigned_customers WHERE trip_id = rp.trip_id AND completed = TRUE) * 100.0 / rp.total_stops,
  CASE WHEN rp.actual_duration_minutes > 0 THEN (rp.estimated_duration_minutes * 100.0 / rp.actual_duration_minutes) ELSE 0 END,
  CASE WHEN rp.actual_distance_km > 0 THEN (rp.total_distance_km * 100.0 / rp.actual_distance_km) ELSE 0 END,
  'completed'
FROM route_plans rp 
WHERE rp.trip_id = ?;
```

## Backend Implementation Steps

### Step 1: Vehicle Data Processing
```python
# Process incoming vehicle GPS data
def process_vehicle_data(vehicle_data):
    # 1. Check if vehicle has active trip
    active_trip = get_active_trip(vehicle_data['plate'])
    
    if active_trip:
        # 2. Store coordinates
        store_coordinates(active_trip['trip_id'], vehicle_data)
        
        # 3. Check if trip should start
        if not active_trip['actual_start_time'] and vehicle_data['speed'] > 0:
            start_trip(active_trip['trip_id'])
        
        # 4. Check customer proximity (optional auto-completion)
        check_customer_visits(active_trip['trip_id'], vehicle_data)
```

### Step 2: Trip Status Management
```python
def check_trip_completion(trip_id):
    # Count completed customers
    completed = count_completed_customers(trip_id)
    total = count_total_customers(trip_id)
    
    # If all customers completed, end trip
    if completed == total:
        end_trip(trip_id)
        calculate_actual_distance(trip_id)
        create_audit_record(trip_id)
```

### Step 3: Performance Queries

#### Get Active Trips
```sql
SELECT trip_id, vehicle_plate, route_name, actual_start_time
FROM route_plans 
WHERE actual_start_time IS NOT NULL 
  AND actual_end_time IS NULL;
```

#### Get Trip Progress
```sql
SELECT 
  rp.trip_id,
  rp.vehicle_plate,
  rp.route_name,
  rp.total_stops,
  COUNT(ac.id) FILTER (WHERE ac.completed = TRUE) as completed_stops,
  (COUNT(ac.id) FILTER (WHERE ac.completed = TRUE) * 100.0 / rp.total_stops) as progress_percentage
FROM route_plans rp
LEFT JOIN assigned_customers ac ON rp.trip_id = ac.trip_id
WHERE rp.trip_id = ?
GROUP BY rp.trip_id, rp.vehicle_plate, rp.route_name, rp.total_stops;
```

#### Get Performance Analytics
```sql
SELECT 
  route_name,
  AVG(time_efficiency) as avg_time_efficiency,
  AVG(distance_efficiency) as avg_distance_efficiency,
  AVG(completion_rate) as avg_completion_rate,
  COUNT(*) as total_trips
FROM trip_audit 
WHERE trip_status = 'completed'
  AND audit_created_at >= NOW() - INTERVAL '30 days'
GROUP BY route_name
ORDER BY avg_time_efficiency DESC;
```

## Data Flow Summary

1. **Route Assignment** → Creates `route_plans` + `assigned_customers`
2. **Vehicle Movement** → Stores `trip_coordinates` + Updates trip status
3. **Customer Visits** → Updates `assigned_customers.completed`
4. **Trip Completion** → Creates `trip_audit` record

## Key Metrics to Track

- **Time Efficiency**: `planned_duration / actual_duration * 100`
- **Distance Efficiency**: `planned_distance / actual_distance * 100`
- **Completion Rate**: `completed_customers / total_customers * 100`
- **Route Deviation**: Average distance from planned route path

## Integration Points

- **Vehicle GPS Stream**: Process every 30-60 seconds
- **Customer Completion**: Manual via frontend or automatic via geofencing
- **Trip Analytics**: Generate on trip completion
- **Performance Reports**: Query `trip_audit` for historical analysis

This system provides complete trip monitoring from planning to execution with detailed performance analytics for route optimization.