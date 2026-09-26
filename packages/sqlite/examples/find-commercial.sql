-- Find all stations with commercially-usable licenses
SELECT s.station_id, s.name, s.country, s.license
FROM stations s
WHERE s.commercial_use = 1
ORDER BY s.country, s.name;

-- Count stations by license type
SELECT license, commercial_use, count(*) AS station_count
FROM stations
GROUP BY license, commercial_use
ORDER BY station_count DESC;
