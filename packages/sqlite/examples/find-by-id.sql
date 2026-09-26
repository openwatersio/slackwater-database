-- Find a station by its text ID
SELECT s.*, src.name AS source_name, src.url AS source_url
FROM stations s
JOIN sources src ON src.id = s.source_id
WHERE s.station_id = 'noaa/9414290';
