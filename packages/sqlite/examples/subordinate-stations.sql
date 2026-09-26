-- Find all subordinate stations for a given reference station
SELECT s.station_id, s.name,
  o.height_type, o.height_high, o.height_low,
  o.time_high, o.time_low
FROM station_offsets o
JOIN stations s ON s.id = o.station_id
JOIN stations ref ON ref.id = o.reference_id
WHERE ref.station_id = 'noaa/8443970'
ORDER BY s.name;
