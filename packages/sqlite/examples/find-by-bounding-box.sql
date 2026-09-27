-- Find all stations within a bounding box
-- Example: San Francisco Bay area (roughly 37.4°N to 38.0°N, -122.6°W to -122.0°W)
SELECT station_id, name, latitude, longitude, type
FROM stations
WHERE latitude BETWEEN 37.4 AND 38.0
  AND longitude BETWEEN -122.6 AND -122.0
ORDER BY name;
