-- Get everything needed for tide prediction at a station for a given year:
-- constituent amplitudes, phases, speeds, equilibrium arguments, and node factors
--
-- This query returns all the data needed to compute tide heights using:
--   h(t) = Z₀ + Σ f·H·cos(ωt + V₀+u - κ)
-- where:
--   f = node factor (from node_factors table)
--   H = amplitude (from station_constituents)
--   ω = speed in deg/hr (from constituents)
--   V₀+u = equilibrium argument (from equilibrium_arguments)
--   κ = phase (from station_constituents)
--   Z₀ = datum offset (MSL - MLLW, from station_datums)

SELECT
  sc.constituent,
  c.speed AS speed_deg_per_hr,
  sc.amplitude AS amplitude_m,
  sc.phase AS phase_deg,
  ea.value AS eq_argument_deg,
  nf.value AS node_factor
FROM station_constituents sc
JOIN stations s ON s.id = sc.station_id
JOIN constituents c ON c.name = sc.constituent
LEFT JOIN equilibrium_arguments ea
  ON ea.constituent = sc.constituent AND ea.year = 2026
LEFT JOIN node_factors nf
  ON nf.constituent = sc.constituent AND nf.year = 2026
WHERE s.station_id = 'noaa/9414290'
ORDER BY c.speed;
