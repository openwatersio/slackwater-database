-- Get all datum values for a station (in meters)
SELECT d.datum, d.value
FROM station_datums d
JOIN stations s ON s.id = d.station_id
WHERE s.station_id = 'noaa/9414290'
ORDER BY d.value DESC;
