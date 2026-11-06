package io.openwaters.slackwater.database

import java.time.LocalDate

enum class StationKind { TIDE, CURRENT }

enum class StationType { REFERENCE, SUBORDINATE }

enum class StationDatumFrame { GAUGE, CONSTITUENT }

enum class HeightOffsetType { RATIO, FIXED }

enum class StationRouteKind { TIDE, CURRENT }

data class StationDatumCoverage(val months: Long, val observedHours: Long, val inferredHours: Long)

data class StationRoute(val slug: String, val stationIds: List<String>, val formerPaths: List<String>) {
    internal constructor(raw: Slackwater.StationRoute) : this(
        raw.slug,
        (0 until raw.stationIdsLength).map { raw.stationIds(it) },
        (0 until raw.formerPathsLength).mapNotNull { raw.formerPaths(it) },
    )
}

data class StationSource(val name: String?, val id: String?, val url: String?, val publishedHarmonics: Boolean)

data class StationLicense(val type: String?, val url: String?, val notes: String?, val commercialUse: Boolean)

/** A period the file stores as `YYYY-MM-DD`; a missing or unparseable date is null. */
data class StationEpoch(val start: LocalDate?, val end: LocalDate?)

data class TideOffsets(
    val reference: String,
    val timeHigh: Int,
    val timeLow: Int,
    val heightType: HeightOffsetType,
    val heightHigh: Double,
    val heightLow: Double,
)

data class CurrentOffsets(
    val reference: String,
    val slackBeforeFlood: Int?,
    val slackBeforeEbb: Int?,
    val floodTime: Int?,
    val ebbTime: Int?,
    val floodSpeedRatio: Double?,
    val ebbSpeedRatio: Double?,
)

data class TideDerivedCurrent(val reference: String, val highWaterLagMinutes: Int, val lowWaterLagMinutes: Int)

/**
 * A fitted CHS gate's measured tier, from the results release [evidence] names.
 * [days], the bounds and [miss] are null when the gate has none.
 */
data class ChsFit(
    val tier: Tier,
    val days: Int?,
    val slackBoundMinutes: Int?,
    val provisionalSlackMinutes: Int?,
    val miss: ChsFitMiss?,
    val missContext: String?,
    val evidence: String,
) {
    enum class Tier { FINAL, BOUNDED, ONLINE }
}

/**
 * The release-check clause an online gate missed. [value] is in the clause's
 * unit: percent of extrema for `reversed_axis`, slacks for `invented_slack` and
 * `missed_slack`, knots for `peak_speed`, minutes for the rest. It is null when
 * a quarter had nothing to measure, never 0.
 */
data class ChsFitMiss(val clause: String, val value: Double?, val nearBar: Boolean)

data class CurrentRecord(
    val floodDirection: Double?,
    val ebbDirection: Double?,
    val meanFlow: Double?,
    /** Minor-axis constants in knots and Greenwich degrees; null when not published. */
    val minorConstituents: List<Station.Constituent>?,
    val minorMeanFlow: Double?,
    /** Major-axis bearing in degrees true; null when unknown. */
    val azimuth: Double?,
    val tideReference: String?,
    val offsets: CurrentOffsets?,
    val magnitudeNote: String?,
    val derived: TideDerivedCurrent?,
    val chsFit: ChsFit?,
)
