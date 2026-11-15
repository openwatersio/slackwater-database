package io.openwaters.slackwater.database

import java.time.LocalDate
import java.time.format.DateTimeParseException

/**
 * One station, read lazily from the buffer. Each property decodes on access
 * and nothing is cached, so keep a value you use repeatedly in a local.
 *
 * Identity, quality, provenance, tide/current data, and subordinate offsets
 * have typed accessors. The generated FlatBuffers accessors are internal.
 *
 * Two stations are equal when they are the same record read from the same
 * [StationDatabase] instance.
 */
class Station internal constructor(
    internal val raw: Slackwater.Station,
    private val root: Slackwater.Root,
) {
    // Identity

    val id: String get() = raw.id
    val name: String get() = raw.name
    val kind: StationKind get() = if (raw.kind == Slackwater.Kind.Current) StationKind.CURRENT else StationKind.TIDE
    val type: StationType
        get() = if (raw.type == Slackwater.StationType.Subordinate) StationType.SUBORDINATE else StationType.REFERENCE
    val latitude: Double get() = raw.latitude
    val longitude: Double get() = raw.longitude

    /** IANA timezone identifier, e.g. "America/Los_Angeles". */
    val timezone: String? get() = raw.timezone

    /** Upstream's region as published ("NJ", "Nova Scotia"). */
    val region: String? get() = raw.region
    val country: String get() = raw.country
    val continent: String? get() = raw.continent
    val locality: String? get() = raw.locality
    val regionCode: String? get() = raw.regionCode
    val countryCode: String get() = raw.countryCode
    val context: String? get() = raw.context
    val contextDerived: Boolean get() = raw.contextDerived
    val cities: List<String> get() = (0 until raw.citiesLength).mapNotNull { raw.cities(it) }

    /** Alternate names and slugs for search. Lower-cased, deduplicated. */
    val aliases: List<String> get() = (0 until raw.aliasesLength).mapNotNull { raw.aliases(it) }

    // Quality gate

    /** Whether the station passes the database's default quality filter. */
    val accepted: Boolean get() = raw.accepted

    /** Quality score, 0–100. */
    val score: Int get() = raw.score.toInt()
    val qualityReason: String? get() = raw.quality?.reason

    /**
     * Whether the peak of the seasonal curve (SA and SSA with their phases)
     * exceeds the principal tide M2+S2+K1+O1 by more than 3 mm, so the yearly
     * swing exceeds the daily one: a Great Lakes gauge, a river reach, a Baltic
     * bodden.
     *
     * Accepted rather than rejected: the predictions are correct and only the
     * frame is wrong. A view quoting a high and a low should read this and say
     * what the water is, because an entire day can sit below the annual mean
     * and read as a broken tide table.
     */
    val seasonalDominant: Boolean get() = raw.quality?.seasonalDominant ?: false

    // Typed metadata

    val source: StationSource?
        get() = raw.source?.let { StationSource(it.name, it.id, it.url, it.publishedHarmonics) }

    val license: StationLicense?
        get() = raw.license?.let { StationLicense(it.type, it.url, it.notes, it.commercialUse) }

    /** Source-reported analysis or datum period; TICON uses its constituent fit period. */
    val epoch: StationEpoch? get() = (raw.epoch ?: predictionSource.raw.epoch)?.let(::epochOf)

    /** Mean-datum reduction period, which can differ from the constituent fit. */
    val datumEpoch: StationEpoch? get() = predictionSource.raw.datumEpoch?.let(::epochOf)

    /** Zero of the stored datum values; null means unspecified, including older files. */
    val datumFrame: StationDatumFrame?
        get() = when (predictionSource.raw.datumFrame) {
            Slackwater.DatumFrame.Gauge -> StationDatumFrame.GAUGE
            Slackwater.DatumFrame.Constituent -> StationDatumFrame.CONSTITUENT
            else -> null
        }

    /** Hourly bins in the reference's observed reduction; null means unspecified. */
    val datumCoverage: StationDatumCoverage?
        get() = predictionSource.raw.datumCoverage?.let {
            StationDatumCoverage(it.months.toLong(), it.observedHours.toLong(), it.inferredHours.toLong())
        }

    val tideOffsets: TideOffsets?
        get() = raw.offsets?.let {
            TideOffsets(
                reference = it.reference,
                timeHigh = it.timeHigh,
                timeLow = it.timeLow,
                heightType = if (it.heightType == Slackwater.HeightOffsetType.Fixed) HeightOffsetType.FIXED else HeightOffsetType.RATIO,
                heightHigh = it.heightHigh.toDouble(),
                heightLow = it.heightLow.toDouble(),
            )
        }

    val current: CurrentRecord?
        get() = raw.current?.let { current ->
            CurrentRecord(
                floodDirection = if (current.floodDirectionMissing) null else current.floodDirection.toDouble(),
                ebbDirection = if (current.ebbDirectionMissing) null else current.ebbDirection.toDouble(),
                meanFlow = if (current.meanFlowMissing) null else current.meanFlow.toDouble(),
                minorConstituents = if (current.minorConstituentsLength == 0) {
                    null
                } else {
                    (0 until current.minorConstituentsLength).mapNotNull { constituentOf(current.minorConstituents(it)) }
                },
                minorMeanFlow = current.minorMeanFlow?.toDouble(),
                azimuth = current.azimuth?.toDouble(),
                tideReference = current.tideReference,
                offsets = current.offsets?.let {
                    CurrentOffsets(
                        reference = it.reference,
                        slackBeforeFlood = if (it.slackBeforeFloodMissing) null else it.slackBeforeFlood,
                        slackBeforeEbb = if (it.slackBeforeEbbMissing) null else it.slackBeforeEbb,
                        floodTime = if (it.floodTimeMissing) null else it.floodTime,
                        ebbTime = if (it.ebbTimeMissing) null else it.ebbTime,
                        floodSpeedRatio = if (it.floodSpeedRatioMissing) null else it.floodSpeedRatio.toDouble(),
                        ebbSpeedRatio = if (it.ebbSpeedRatioMissing) null else it.ebbSpeedRatio.toDouble(),
                    )
                },
                magnitudeNote = current.magnitudeNote,
                derived = current.derived?.let {
                    TideDerivedCurrent(it.reference, it.highWaterLagMinutes, it.lowWaterLagMinutes)
                },
                chsFit = current.chsFit?.let(::chsFitOf),
            )
        }

    /**
     * Free text from the station's source record: caveats such as a gauge that
     * dries out at low water, notes on how its datums were derived, and for
     * some sources a credit that [attribution] already carries.
     */
    val disclaimers: String? get() = raw.disclaimers

    // Prediction data

    /**
     * The station whose record holds the prediction data this one predicts
     * from: a tide subordinate's reference, otherwise itself. A current
     * subordinate names its reference in `current.offsets.reference` and is
     * not resolved here. One hop: a reference
     * that is itself subordinate is not resolved again, and neither is a
     * station whose reference is missing from the file.
     */
    private val predictionSource: Station
        get() = raw.offsets?.reference?.let { root.stationsByKey(it) }?.let { Station(it, root) } ?: this

    /** Amplitude in metres (tides) or knots (currents); phase in degrees. */
    data class Constituent(val name: String, val amplitude: Double, val phase: Double)

    /**
     * Harmonic constituents, names resolved through the file's name table. A
     * tide subordinate carries none of its own and reports its reference's,
     * which are the ones its prediction starts from. A current subordinate
     * reports none: look up `current.offsets.reference` for its reference's.
     */
    val constituents: List<Constituent>
        get() {
            val raw = predictionSource.raw
            return (0 until raw.constituentsLength).mapNotNull { constituentOf(raw.constituents(it)) }
        }

    /** A constituent's line, as @slackwater/engine's `ConstituentDefinition` holds it. */
    data class ConstituentDefinition(
        val name: String,
        /** Degrees per hour. */
        val speed: Double,
        /**
         * Doodson numbers for τ, s, h, p, N′ and p′, then the multiple of 90°
         * in the phase. Null for a compound whose argument is the sum of its
         * members'.
         */
        val coefficients: List<Int>?,
        /** Other spellings of [name], such as "MM" for "Mm". */
        val aliases: List<String> = emptyList(),
        /**
         * Constituents whose nodal corrections combine into this one's. Empty
         * for no correction, and ignored for a name the nodal formulas cover.
         */
        val members: List<Member> = emptyList(),
    ) {
        /**
         * A compound member: [factor] times the member's argument and nodal
         * phase correction, and the member's node factor to the power |factor|.
         */
        data class Member(val name: String, val factor: Double)
    }

    /** The nodal correction formulas a source's constants were analyzed with. */
    enum class NodeCorrections { IHO, SCHUREMAN }

    /**
     * The definitions to hand the prediction engine for this station's
     * constituents and minor current constituents: each name and every member
     * it leads to, once each. The source's own definition wins when it defines
     * the name or any spelling of the shared definition's; names nothing
     * defines are left out. Null for a file written before definitions, which
     * leaves every name to the engine's own catalog. A tide subordinate
     * reports its reference's, like [constituents].
     */
    val constituentDefinitions: List<ConstituentDefinition>?
        get() {
            val record = predictionSource.raw
            val source = record.source
            val ownCount = source?.constituentDefinitionsLength ?: 0
            if (root.constituentDefinitionsLength == 0 && ownCount == 0) return null
            val own = definitionIndex(ownCount) { source!!.constituentDefinitions(it) }
            val shared = definitionIndex(root.constituentDefinitionsLength) { root.constituentDefinitions(it) }
            // A definition's position, and whether it is the source's own.
            fun pick(name: Int): Pair<Boolean, Int>? {
                own[name]?.let { return true to it }
                val at = shared[name] ?: return null
                val common = root.constituentDefinitions(at) ?: return null
                for (spelling in spellings(common)) own[spelling]?.let { return true to it }
                return false to at
            }
            val pending = ArrayList<Int>()
            for (i in 0 until record.constituentsLength) record.constituents(i)?.let { pending += it.name.toInt() }
            record.current?.let { current ->
                for (i in 0 until current.minorConstituentsLength) {
                    current.minorConstituents(i)?.let { pending += it.name.toInt() }
                }
            }
            val seen = HashSet<Pair<Boolean, Int>>()
            val result = ArrayList<ConstituentDefinition>()
            // Last first, as the TypeScript reader walks them, so the readers list them in one order.
            while (pending.isNotEmpty()) {
                val key = pick(pending.removeAt(pending.size - 1)) ?: continue
                if (!seen.add(key)) continue
                val raw = (if (key.first) source!!.constituentDefinitions(key.second) else root.constituentDefinitions(key.second))
                    ?: continue
                result += definitionOf(raw) ?: continue
                for (i in 0 until raw.membersLength) raw.members(i)?.let { pending += it.name.toInt() }
            }
            return result
        }

    /**
     * The nodal correction formulas this station's constants were analyzed
     * with, from its source; IHO when the file does not say. A tide
     * subordinate reports its reference's.
     */
    val nodeCorrections: NodeCorrections
        get() = if (predictionSource.raw.source?.nodeCorrections == Slackwater.NodeCorrections.Schureman) {
            NodeCorrections.SCHUREMAN
        } else {
            NodeCorrections.IHO
        }

    /**
     * Vertical datums in metres above the station's zero, keyed by name
     * ("MLLW", "MSL", ...), in file order. A tide subordinate reports its
     * reference's, which describe the reference's water: they are not reduced
     * through its offsets, because the extreme corrections have no principled
     * meaning for a mean level like MSL or MTL. For the pair that does reduce,
     * see [astronomicalBounds].
     */
    val datums: Map<String, Double>
        get() {
            val raw = predictionSource.raw
            val values = LinkedHashMap<String, Double>()
            for (index in 0 until raw.datumsLength) {
                val datum = raw.datums(index) ?: continue
                val name = root.datumNames(datum.name.toInt()) ?: continue
                values[name] = datum.value.toDouble()
            }
            return values
        }

    /** The datum key heights on charts are referenced to, e.g. "MLLW". */
    val chartDatum: String? get() = raw.chartDatum

    // Attribution

    /**
     * The complete notice to display when showing or redistributing this
     * station: the creator credit and, where a Creative Commons licence
     * applies, the licence and a pointer to what was modified. Displaying it
     * is the whole of the obligation. Written into the file by the builder, so
     * this package keeps no table of sources; a file predating the field falls
     * back to the project credit.
     */
    val attribution: String get() = raw.attribution ?: PROJECT_CREDIT

    /**
     * Height of mean sea level above the chart datum
     * (`datums[MSL] - datums[chartDatum]`): add it to a prediction about MSL
     * to reference the height to the chart datum. Null when either datum is
     * absent.
     */
    val chartDatumShift: Double?
        get() {
            val chartDatum = raw.chartDatum ?: return null
            val datums = this.datums
            val msl = datums["MSL"] ?: return null
            val zero = datums[chartDatum] ?: return null
            return msl - zero
        }

    // Astronomical range

    /** The floor and ceiling of this station's predictions, in metres above its chart datum. */
    data class AstronomicalBounds(
        /** Lowest Astronomical Tide. */
        val lat: Double,
        /** Highest Astronomical Tide. */
        val hat: Double,
    )

    /**
     * Lowest and highest astronomical tide, in metres above this station's
     * chart datum. Null when the station predicting for this one has no LAT
     * and HAT.
     *
     * For a subordinate this is the reference's range reduced through its
     * offsets: the same correction the predictor applies to the extremes
     * themselves, and exact for both offset kinds because each is monotonic in
     * the reference height. The result is the floor of a prediction rather
     * than a hydrographic datum, which is why it is not in [datums]
     * (docs/datums.md).
     */
    val astronomicalBounds: AstronomicalBounds?
        get() {
            // The datums are in the prediction source's frame, so its own chart
            // datum is the zero they sit above, not this station's, which can
            // name a different datum than the record the values came from.
            val source = predictionSource
            val datums = source.datums
            val zero = source.raw.chartDatum?.let { datums[it] } ?: return null
            val lat = datums["LAT"] ?: return null
            val hat = datums["HAT"] ?: return null
            val offsets = raw.offsets ?: return AstronomicalBounds(lat - zero, hat - zero)
            val low = offsets.heightLow.toDouble()
            val high = offsets.heightHigh.toDouble()
            return if (offsets.heightType == Slackwater.HeightOffsetType.Ratio) {
                AstronomicalBounds((lat - zero) * low, (hat - zero) * high)
            } else {
                AstronomicalBounds((lat - zero) + low, (hat - zero) + high)
            }
        }

    /** Two reads of the same record in the same [StationDatabase] are equal. */
    override fun equals(other: Any?): Boolean = other is Station && other.root === root && other.id == id

    override fun hashCode(): Int = id.hashCode()

    override fun toString(): String = "Station($id)"

    private fun constituentOf(raw: Slackwater.Constituent?): Constituent? {
        raw ?: return null
        val name = root.constituentNames(raw.name.toInt()) ?: return null
        return Constituent(name, raw.amplitude.toDouble(), raw.phase.toDouble())
    }

    private fun definitionOf(raw: Slackwater.ConstituentDefinition): ConstituentDefinition? {
        fun name(index: UShort) = root.constituentNames(index.toInt())
        return ConstituentDefinition(
            name = name(raw.name) ?: return null,
            speed = raw.speed,
            // The generated accessors can't tell an absent vector from an empty one; builders write neither empty.
            coefficients = if (raw.coefficientsLength == 0) null else (0 until raw.coefficientsLength).map { raw.coefficients(it).toInt() },
            aliases = (0 until raw.aliasesLength).mapNotNull { name(raw.aliases(it)) },
            members = (0 until raw.membersLength).mapNotNull { i ->
                raw.members(i)?.let { m -> name(m.name)?.let { ConstituentDefinition.Member(it, m.factor.toDouble()) } }
            },
        )
    }

    companion object {
        private fun spellings(d: Slackwater.ConstituentDefinition) =
            listOf(d.name.toInt()) + (0 until d.aliasesLength).map { d.aliases(it).toInt() }

        /**
         * A definitions vector's positions by the name index of each
         * definition's name and aliases. The first wins; the builders write
         * each spelling once.
         */
        private fun definitionIndex(count: Int, at: (Int) -> Slackwater.ConstituentDefinition?): Map<Int, Int> {
            val index = HashMap<Int, Int>()
            for (position in 0 until count) {
                val definition = at(position) ?: continue
                for (spelling in spellings(definition)) index.putIfAbsent(spelling, position)
            }
            return index
        }

        /**
         * The project half of every station credit, and the fallback for a
         * file written before credits were stored in it.
         */
        const val PROJECT_CREDIT = "Slackwater database (https://github.com/openwatersio/slackwater-database)"

        private fun epochOf(raw: Slackwater.Epoch) = StationEpoch(dateOf(raw.start), dateOf(raw.end))

        private fun dateOf(text: String?): LocalDate? = text?.let {
            try {
                LocalDate.parse(it)
            } catch (_: DateTimeParseException) {
                null
            }
        }

        private fun chsFitOf(fit: Slackwater.ChsFit): ChsFit {
            // A tier this reader does not know reads as online, with no measured numbers.
            val tier = when (fit.tier) {
                Slackwater.ChsFitTier.Final -> ChsFit.Tier.FINAL
                Slackwater.ChsFitTier.Bounded -> ChsFit.Tier.BOUNDED
                Slackwater.ChsFitTier.Online -> ChsFit.Tier.ONLINE
                else -> null
            }
            // Zero in a ushort field means absent.
            fun measured(value: UShort) = if (tier == null || value.toInt() == 0) null else value.toInt()
            return ChsFit(
                tier = tier ?: ChsFit.Tier.ONLINE,
                days = measured(fit.days),
                slackBoundMinutes = measured(fit.slackBoundMinutes),
                provisionalSlackMinutes = measured(fit.provisionalSlackMinutes),
                miss = fit.miss?.let { ChsFitMiss(it.clause, if (it.valueMissing) null else it.value, it.nearBar) },
                missContext = fit.missContext,
                evidence = fit.evidence,
            )
        }
    }
}
