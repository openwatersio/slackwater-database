// Mirrors the examples in README.md. Typechecked with the rest of the package,
// so the documented API can't drift away from the real signatures.
import { stations, near, nearest, bbox, search } from "@slackwater/database";

console.log("Total stations:", stations.length);

const nearbyStations = near({
  lon: -122,
  lat: 37,
  maxDistance: 10,
  maxResults: 50,
});
console.log(
  "Within 10 km of 37, -122:",
  nearbyStations.map(
    ([s, distance]) => `${s.name} (${distance.toFixed(2)} km)`,
  ),
);

const result = nearest({ longitude: -75.5, latitude: 22 });
if (result) {
  const [station, distance] = result;
  console.log("Nearest station:", station.name, "is", distance, "km away");
}

const bostonStations = bbox([-71.5, 42, -70.5, 42.8]);
console.log("Stations in the Boston area:", bostonStations.length);

const referenceOnly = bbox([-72, 41, -70, 43], {
  filter: (station) => station.type === "reference",
});
console.log("Reference stations in bounds:", referenceOnly.length);

console.log(
  "Text search for Boston:",
  search("Boston").map((s) => s.name),
);

const usStations = search("harbor", {
  filter: (station) => station.country === "United States",
  maxResults: 10,
});
console.log("US harbor stations:", usStations.length);
