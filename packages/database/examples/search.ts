import { near, nearest } from "@neaps/tide-database";
console.log(
  "all stations within 10 km of 37.7749, -122.4194:",
  near({
    lat: 37.7749,
    lon: -122.4194,
    maxDistance: 10,
    maxResults: Infinity,
  }).map(([s, distance]) => `${s.name} (${distance.toFixed(2)} km)`),
);

const [station, distance] = nearest({ lon: -75.5, lat: 22 }) || [];
console.log(
  "Nearest station to [-75.5, 22]:",
  `${station!.name} (${distance} km)`,
);
