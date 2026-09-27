-- Find all stations in a country
SELECT s.station_id, s.name, s.type, s.latitude, s.longitude
FROM stations s
WHERE s.country = 'United States'
ORDER BY s.name;

-- Count stations by continent
SELECT continent, count(*) AS station_count
FROM stations
GROUP BY continent
ORDER BY station_count DESC;

-- Count stations by country within Europe
SELECT country, count(*) AS station_count
FROM stations
WHERE continent = 'Europe'
GROUP BY country
ORDER BY station_count DESC;
