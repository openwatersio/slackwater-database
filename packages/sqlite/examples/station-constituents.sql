-- Get all harmonic constituents for a station, with speeds and descriptions
SELECT c.name, c.description, c.speed, sc.amplitude, sc.phase
FROM station_constituents sc
JOIN constituents c ON c.name = sc.constituent
JOIN stations s ON s.id = sc.station_id
WHERE s.station_id = 'noaa/9414290'
ORDER BY c.speed;
