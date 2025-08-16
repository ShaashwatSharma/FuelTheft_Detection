# Fuel Theft Detection API - Postman Collection

This repository contains a complete Postman collection for testing the Fuel Theft Detection Backend API.

## 📁 Files

- **`Fuel_Theft_Detection_API.postman_collection.json`** - Main Postman collection with all API endpoints
- **`Fuel_Theft_Detection_Environment.postman_environment.json`** - Environment variables for testing
- **`POSTMAN_SETUP_README.md`** - This setup guide

## 🚀 Quick Start

### 1. Import Collection
1. Open Postman
2. Click **Import** button
3. Drag and drop `Fuel_Theft_Detection_API.postman_collection.json` or click to browse and select the file
4. The collection will appear in your Postman sidebar

### 2. Import Environment
1. In Postman, click **Import** again
2. Select `Fuel_Theft_Detection_Environment.postman_environment.json`
3. The environment will be available in the environment dropdown

### 3. Select Environment
1. In the top-right corner of Postman, select **"Fuel Theft Detection Environment"** from the environment dropdown
2. This will enable all the variables like `{{base_url}}`, `{{vehicle_id}}`, etc.

## 🔧 Environment Variables

| Variable | Default Value | Description |
|----------|---------------|-------------|
| `base_url` | `http://localhost:3000` | API server base URL |
| `vehicle_id` | `sample-vehicle-id` | Vehicle ID for testing |
| `sensor_id` | `sample-sensor-id` | Sensor ID for testing |
| `from_date` | `2025-01-01T00:00:00.000Z` | Default start date |
| `to_date` | `2025-01-31T23:59:59.999Z` | Default end date |

## 📋 API Endpoints

### Health Check
- **GET** `/health` - Check API server status

### Vehicle Management
- **GET** `/vehicles` - List all vehicles
- **GET** `/vehicles/:id/details` - Get detailed vehicle information

### Sensor Management
- **GET** `/sensor` - Get all sensor statuses
- **GET** `/sensor?busId={id}` - Get sensor status for specific vehicle
- **GET** `/sensor?status={status}` - Filter sensors by status

### Fuel Usage
- **GET** `/fuelusage?busId={id}` - Get fuel usage statistics

### History & Events
- **GET** `/history` - Get all history records
- **GET** `/history?type={types}` - Filter by event types
- **GET** `/history?sensorId={id}` - Filter by sensor

### Summary Metrics
- **GET** `/summarymatrix?busId={id}&generate=true` - Get aggregated metrics (auto-generates if none exist)
- **GET** `/summarymatrix?busId={id}&generate=false` - Get existing metrics only (no auto-generation)

## 🧪 Testing Workflow

### 1. Start with Health Check
First, test the `/health` endpoint to ensure your API server is running.

### 2. Get Vehicle Information
1. Use `/vehicles` to get a list of available vehicles
2. Copy a vehicle ID from the response
3. Update the `vehicle_id` environment variable with the real ID

### 3. Test Vehicle Details
Use `/vehicles/{id}/details` with different `include` parameters:
- `include=alerts` - Get alerts for the vehicle
- `include=readings` - Get sensor readings
- `include=histories` - Get history records
- `include=events` - Get events

### 4. Test Sensor Status
Use `/sensor?busId={vehicle_id}` to check sensor health for your vehicle.

### 5. Test Fuel Usage
Use `/fuelusage?busId={vehicle_id}` to get comprehensive fuel statistics.

### 6. Test History
Use `/history` with different filters to explore historical data.

## 🔍 Query Parameters

### Date Ranges
Most endpoints support date filtering:
- `fromDate` - Start date (ISO format)
- `toDate` - End date (ISO format)

### Pagination
History endpoint supports pagination:
- `limit` - Number of records to return
- `offset` - Number of records to skip
- `sort` - Sort order (`asc` or `desc`)

### Filtering
- `type` - Filter by event types (comma-separated)
- `sensorId` - Filter by specific sensor
- `status` - Filter by sensor status
- `include` - Include related data (comma-separated)
- `generate` - Auto-generate summary metrics if none exist (true/false, defaults to true)

## 📊 Sample Responses

### Vehicle List Response
```json
[
  {
    "id": "vehicle-id-1",
    "registrationNo": "MH12-FT0001",
    "driver": "John Doe",
    "route": "Route 1",
    "sensorStatus": "OK",
    "sensorLastSeen": "2025-01-01T10:00:00.000Z"
  }
]
```

### Fuel Usage Response
```json
{
  "totalFuelConsumed": 45.67,
  "totalFuelStolen": 12.34,
  "totalFuelRefueled": 58.01,
  "distanceTravelled": 234.56,
  "fuelEfficiency": 5.14,
  "message": null
}
```

### History Response
```json
[
  {
    "id": "history-id-1",
    "type": "THEFT",
    "timestamp": "2025-01-01T10:00:00.000Z",
    "description": "Fuel theft detected",
    "fuelLevel": 45.67,
    "fuelDropLitres": 12.34,
    "location": {
      "lat": 12.9716,
      "long": 77.5946
    },
    "bus": {
      "id": "vehicle-id-1",
      "registrationNo": "MH12-FT0001",
      "driver": "John Doe",
      "route": "Route 1"
    }
  }
]
```

## 🚨 Troubleshooting

### Common Issues

1. **Connection Refused**
   - Ensure your backend server is running on port 3000
   - Check if Docker containers are up: `docker-compose ps`

2. **404 Errors**
   - Verify the vehicle ID exists in your database
   - Check if the endpoint path is correct

3. **Empty Responses**
   - Ensure you have data in your database
   - Check date ranges - they might be filtering out all results
   - Verify sensor status - offline sensors won't have recent data

4. **Environment Variables Not Working**
   - Make sure you've selected the correct environment
   - Check that variables are properly set in the environment

### Debugging Tips

1. **Check Server Logs**
   ```bash
   docker-compose logs backend
   ```

2. **Verify Database Data**
   ```bash
   docker-compose exec postgres psql -U fueladmin -d fueltheftdb -c "SELECT COUNT(*) FROM \"Vehicle\";"
   ```

3. **Test Individual Endpoints**
   - Start with simple endpoints like `/health`
   - Gradually add complexity with query parameters

## 🔄 Updating the Collection

If you add new endpoints to your API:

1. Export the updated collection from Postman
2. Replace the existing `Fuel_Theft_Detection_API.postman_collection.json` file
3. Commit the changes to your repository

## 📚 Additional Resources

- [Postman Learning Center](https://learning.postman.com/)
- [Postman Environment Variables](https://learning.postman.com/docs/sending-requests/managing-environments/)
- [Postman Collection Variables](https://learning.postman.com/docs/sending-requests/variables/)

## 🤝 Support

If you encounter issues with the Postman collection:

1. Check the troubleshooting section above
2. Verify your API server is running correctly
3. Check the backend logs for errors
4. Ensure your database has the required data

---

**Happy Testing! 🚀**
