-- Find the 10 nearest stations to a point
-- Example: near San Francisco (37.7749°N, -122.4194°W)
--
-- Uses the equirectangular approximation which is fast and accurate
-- enough for nearby stations. For exact distances, use the full haversine formula.

WITH nearby AS (
  SELECT station_id, name, type, latitude, longitude,
    (latitude - 37.7749) * (latitude - 37.7749) +
    ((longitude - (-122.4194)) * cos(37.7749 * 3.14159265 / 180)) *
    ((longitude - (-122.4194)) * cos(37.7749 * 3.14159265 / 180))
    AS dist_sq
  FROM stations
  WHERE latitude BETWEEN 37.7749 - 2 AND 37.7749 + 2
    AND longitude BETWEEN -122.4194 - 2 AND -122.4194 + 2
)
SELECT station_id, name, type, latitude, longitude,
  round(sqrt(dist_sq) * 111.32, 2) AS approx_distance_km
FROM nearby
ORDER BY dist_sq
LIMIT 10;
