package io.openwaters.slackwater.database

import com.google.flatbuffers.FlatBufferBuilder
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.time.LocalDate
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class StationDatabaseTest {
    private val db = openFixture()

    @Test
    fun opensAMappedFileAndReadsTheVersion() {
        assertEquals("0.0.0-fixture", db.version)
        assertEquals(7, db.size)
    }

    @Test
    fun readsBytesAlreadyInMemoryAtAnyBufferPosition() {
        val bytes = fixture.readBytes()
        assertEquals(fixtureIds, StationDatabase(ByteBuffer.wrap(bytes)).map { it.id })

        // A buffer whose file starts past index 0, as a caller's slice of a
        // larger download would be.
        val padded = ByteBuffer.allocate(bytes.size + 16)
        padded.position(16)
        padded.put(bytes)
        padded.position(16)
        val shifted = StationDatabase(padded)
        assertEquals("Reference", shifted.station("test/reference")?.name)
        assertEquals(16, padded.position())
    }

    @Test
    fun mapsARangeOfAChannel() {
        val bytes = fixture.readBytes()
        val file = File.createTempFile("padded", ".tcdb").apply { deleteOnExit() }
        file.writeBytes(ByteArray(32) + bytes)
        val db = RandomAccessFile(file, "r").use { StationDatabase.open(it.channel, 32, bytes.size.toLong()) }
        assertEquals("Reference", db.station("test/reference")?.name)
    }

    @Test
    fun rejectsBytesWithoutTheFileIdentifier() {
        assertFailsWith<InvalidStationDatabaseException> { StationDatabase(ByteBuffer.wrap("not a database".toByteArray())) }
        assertFailsWith<InvalidStationDatabaseException> { StationDatabase(ByteBuffer.allocate(0)) }
        assertFailsWith<IndexOutOfBoundsException> { db[7] }
    }

    @Test
    fun refusesANewerFormatVersion() {
        fun file(formatVersion: Int): ByteBuffer {
            val builder = FlatBufferBuilder()
            Slackwater.Root.startRoot(builder)
            Slackwater.Root.addFormatVersion(builder, formatVersion.toUShort())
            Slackwater.Root.finishRootBuffer(builder, Slackwater.Root.endRoot(builder))
            return builder.dataBuffer()
        }
        assertEquals(StationDatabase.FORMAT_VERSION, db.root.formatVersion.toInt())
        // 0 is a file written before the field existed.
        StationDatabase(file(0))
        StationDatabase(file(StationDatabase.FORMAT_VERSION))
        val newer = StationDatabase.FORMAT_VERSION + 1
        val error = assertFailsWith<UnsupportedStationDatabaseException> { StationDatabase(file(newer)) }
        assertEquals(newer, error.formatVersion)

        // A header whose root table lies past the end.
        assertFailsWith<InvalidStationDatabaseException> { StationDatabase(ByteBuffer.wrap(fixture.readBytes().copyOf(8))) }
        // One byte short of the root table's end, past its format version.
        val bytes = fixture.readBytes()
        val header = ByteBuffer.wrap(bytes).order(java.nio.ByteOrder.LITTLE_ENDIAN)
        val table = header.getInt(0)
        val tableSize = header.getShort(table - header.getInt(table) + 2).toUShort().toInt()
        assertFailsWith<InvalidStationDatabaseException> { StationDatabase(ByteBuffer.wrap(bytes.copyOf(table + tableSize - 1))) }
    }

    @Test
    fun iteratesIdentityInIdOrder() {
        assertEquals(fixtureIds, db.map { it.id })
        assertEquals(
            listOf(
                "A current", "Reference", "Subordinate", "Subordinate with fixed offsets",
                "A bounded gate", "An online gate", "An unknown-tier gate",
            ),
            db.map { it.name },
        )

        val reference = db[1]
        assertEquals(47.6, reference.latitude, 1e-9)
        assertEquals(-122.3, reference.longitude, 1e-9)
        assertEquals("America/Los_Angeles", reference.timezone)
        assertEquals("WA", reference.region)
        assertEquals("United States", reference.country)
        assertEquals("Americas", reference.continent)
        assertEquals(listOf("elliott bay", "seattle"), reference.aliases)
        assertEquals(StationKind.TIDE, reference.kind)
        assertEquals(StationType.REFERENCE, reference.type)
        assertEquals(StationType.SUBORDINATE, db[2].type)
        assertEquals(StationKind.CURRENT, db[0].kind)
    }

    @Test
    fun looksUpById() {
        assertEquals("Reference", db.station("test/reference")?.name)
        assertEquals("Subordinate", db.station("test/subordinate")?.name)
        assertNull(db.station("test/nowhere"))
    }

    @Test
    fun keepsTheListContractForStationsReadTwice() {
        val reference = db.require("test/reference")
        assertEquals(db[1], reference)
        assertEquals(db[1].hashCode(), reference.hashCode())
        assertTrue(reference in db)
        assertEquals(1, db.indexOf(reference))
        assertTrue(db.containsAll(db.toList()))
        assertEquals(db.size, (db + db).toSet().size)
        assertNotEquals(db[0], db[1])

        // A record read from another database instance is a different station.
        assertFalse(reference in openFixture())
    }

    @Test
    fun readsTheSourcesDisclaimers() {
        assertEquals("Dries out at low water.", db.require("test/reference").disclaimers)
        assertNull(db.require("test/current").disclaimers)
    }

    @Test
    fun readsConstituentsThroughTheNameTable() {
        val constituents = db.require("test/reference").constituents
        assertEquals(listOf("M2", "S2"), constituents.map { it.name })
        assertEquals(1.063, constituents[0].amplitude, 1e-6)
        assertEquals(10.8, constituents[0].phase, 1e-5)

        // A subordinate's record holds no constituents of its own; the accessor
        // reports the reference's, which its prediction starts from.
        val subordinate = db.require("test/subordinate")
        assertEquals(0, subordinate.raw.constituentsLength)
        assertEquals(constituents, subordinate.constituents)
        val offsets = assertNotNull(subordinate.tideOffsets)
        assertEquals("test/reference", offsets.reference)
        assertEquals(12, offsets.timeHigh)
        assertEquals(-6, offsets.timeLow)
        assertEquals(1.1, offsets.heightHigh, 1e-6)
    }

    @Test
    fun readsDatumsAndDerivesTheChartDatumShift() {
        val station = db.require("test/reference")
        assertEquals("MLLW", station.chartDatum)
        assertEquals(2.419, station.datums.getValue("MLLW"), 1e-6)
        assertEquals(4.443, station.datums.getValue("MSL"), 1e-6)
        assertEquals(4.443 - 2.419, assertNotNull(station.chartDatumShift), 1e-6)

        // A subordinate reports its reference's datums, unreduced, against its
        // own chart datum.
        val subordinate = db.require("test/subordinate")
        assertEquals(0, subordinate.raw.datumsLength)
        assertEquals(station.datums, subordinate.datums)
        assertEquals(4.443 - 2.419, assertNotNull(subordinate.chartDatumShift), 1e-6)

        // No chart datum of its own, so no shift to take.
        assertNull(db.require("test/subordinate-fixed").chartDatumShift)
    }

    @Test
    fun derivesAstronomicalBoundsAboveChartDatum() {
        val lat = 1.8 - 2.419
        val hat = 6.1 - 2.419

        val reference = assertNotNull(db.require("test/reference").astronomicalBounds)
        assertEquals(lat, reference.lat, 1e-5)
        assertEquals(hat, reference.hat, 1e-5)

        val ratio = assertNotNull(db.require("test/subordinate").astronomicalBounds)
        assertEquals(lat * 0.9, ratio.lat, 1e-5)
        assertEquals(hat * 1.1, ratio.hat, 1e-5)

        val fixed = assertNotNull(db.require("test/subordinate-fixed").astronomicalBounds)
        assertEquals(lat - 0.2, fixed.lat, 1e-5)
        assertEquals(hat + 0.3, fixed.hat, 1e-5)

        // No LAT and HAT to reduce: the current station carries no datums.
        assertNull(db.require("test/current").astronomicalBounds)
    }

    @Test
    fun readsTheQualityGateInline() {
        val accepted = db.require("test/reference")
        assertTrue(accepted.accepted)
        assertEquals(87, accepted.score)
        assertEquals("MLW (3.827) < LAT (3.831)", accepted.raw.quality?.issues(0))
        assertNull(accepted.qualityReason)
        assertFalse(accepted.seasonalDominant)

        val rejected = db.require("test/subordinate")
        assertFalse(rejected.accepted)
        assertEquals(0, rejected.score)
        assertEquals("duplicate", rejected.qualityReason)
        assertEquals("test/reference", rejected.raw.quality?.redundant)

        // No quality table at all.
        assertNull(db.require("test/current").qualityReason)
        assertFalse(db.require("test/current").seasonalDominant)
    }

    @Test
    fun readsTypedMetadata() {
        val reference = db.require("test/reference")
        assertEquals("Seattle", reference.locality)
        assertEquals("US-WA", reference.regionCode)
        assertEquals("US", reference.countryCode)
        assertEquals("Seattle, WA", reference.context)
        assertFalse(reference.contextDerived)
        assertEquals(listOf("Seattle"), reference.cities)
        assertEquals(
            StationSource("Test Source", "9447130", "https://example.com/9447130", publishedHarmonics = true),
            reference.source,
        )
        assertEquals(
            StationLicense("public domain", "https://example.com/license", null, commercialUse = true),
            reference.license,
        )
        assertEquals(StationEpoch(LocalDate.of(2007, 1, 1), LocalDate.of(2026, 1, 1)), reference.epoch)
        assertEquals(StationEpoch(LocalDate.of(2020, 1, 1), LocalDate.of(2021, 12, 31)), reference.datumEpoch)
        assertEquals(StationDatumFrame.GAUGE, reference.datumFrame)
        assertEquals(StationDatumCoverage(24, 17520, 24), reference.datumCoverage)

        // A subordinate inherits its reference's datum metadata with its datums.
        val subordinate = db.require("test/subordinate")
        assertEquals(reference.epoch, subordinate.epoch)
        assertEquals(reference.datumEpoch, subordinate.datumEpoch)
        assertEquals(StationDatumFrame.GAUGE, subordinate.datumFrame)
        assertEquals(reference.datumCoverage, subordinate.datumCoverage)
        assertEquals(HeightOffsetType.RATIO, subordinate.tideOffsets?.heightType)
        assertEquals(HeightOffsetType.FIXED, db.require("test/subordinate-fixed").tideOffsets?.heightType)

        val current = db.require("test/current")
        assertNull(current.epoch)
        assertNull(current.datumEpoch)
        assertNull(current.datumFrame)
        assertNull(current.datumCoverage)
        assertNull(current.tideOffsets)
        assertNull(reference.current)
    }

    @Test
    fun readsCurrentDetails() {
        val current = assertNotNull(db.require("test/current").current)
        assertEquals(90.0, assertNotNull(current.floodDirection), 1e-6)
        assertEquals(270.0, assertNotNull(current.ebbDirection), 1e-6)
        assertEquals(0.4, assertNotNull(current.meanFlow), 1e-6)
        assertEquals("test/reference", current.tideReference)
        assertNull(current.magnitudeNote)
        assertNull(current.derived)
        assertNull(current.chsFit)

        val offsets = assertNotNull(current.offsets)
        assertEquals("test/reference", offsets.reference)
        assertEquals(-30, offsets.slackBeforeFlood)
        assertNull(offsets.slackBeforeEbb)
        assertEquals(0, offsets.floodTime)
        assertNull(offsets.ebbTime)
        assertEquals(0.8, assertNotNull(offsets.floodSpeedRatio), 1e-6)
        assertNull(offsets.ebbSpeedRatio)

        // Directions and mean flow the source left out read as unknown.
        val gate = assertNotNull(db.require("test/zfit-bounded").current)
        assertNull(gate.ebbDirection)
        assertNull(gate.meanFlow)
        assertNull(gate.offsets)
    }

    @Test
    fun readsAFittedGatesChsFit() {
        val evidence = "fit-2026-10-22-8f85912-r2"
        assertEquals(
            ChsFit(ChsFit.Tier.BOUNDED, 210, 40, 45, miss = null, missContext = null, evidence = evidence),
            db.require("test/zfit-bounded").current?.chsFit,
        )

        val online = assertNotNull(db.require("test/zfit-online").current?.chsFit)
        assertEquals(ChsFit.Tier.ONLINE, online.tier)
        assertNull(online.days)
        assertEquals(ChsFitMiss("slack_median", value = null, nearBar = true), online.miss)
        assertEquals("rapids", online.missContext)
    }

    @Test
    fun readsAnUnknownChsFitTierAsOnlineWithoutMeasuredNumbers() {
        val fit = assertNotNull(db.require("test/zfit-unknown").current?.chsFit)
        assertEquals(ChsFit.Tier.ONLINE, fit.tier)
        assertNull(fit.days)
        assertNull(fit.slackBoundMinutes)
        assertEquals("fit-2026-10-22-8f85912-r2", fit.evidence)
    }

    @Test
    fun readsMinorCurrentConstantsAndMeasuredZeros() {
        val current = assertNotNull(db.require("test/current").current)
        val minor = assertNotNull(current.minorConstituents)
        assertEquals(listOf("Q1", "K1"), minor.map { it.name })
        assertEquals(0.001, minor[0].amplitude, 1e-8)
        assertEquals(12.3, minor[0].phase, 1e-5)
        assertEquals(0.0, minor[1].amplitude)
        assertEquals(45.6, minor[1].phase, 1e-5)
        assertEquals(0.0, current.minorMeanFlow)
        assertEquals(0.0, current.azimuth)

        val scalar = assertNotNull(db.require("test/zfit-bounded").current)
        assertNull(scalar.minorConstituents)
        assertNull(scalar.minorMeanFlow)
        assertNull(scalar.azimuth)
    }

    @Test
    fun readsAFileWrittenBeforeMinorFieldsExisted() {
        val old = StationDatabase.open(File(System.getProperty("preMinorFixture")))
        val current = assertNotNull(old.require("test/current").current)
        assertEquals(0.4, assertNotNull(current.meanFlow), 1e-6)
        assertNull(current.minorConstituents)
        assertNull(current.minorMeanFlow)
        assertNull(current.azimuth)
    }

    @Test
    fun looksUpStableRoutes() {
        assertEquals(
            StationRoute("reference", listOf("test/reference"), listOf("old-reference")),
            db.stationRoute(StationRouteKind.TIDE, "reference"),
        )
        assertNull(db.stationRoute(StationRouteKind.CURRENT, "missing"))
        assertNull(db.stationRoute(StationRouteKind.TIDE, "a-current"))
        assertEquals(listOf("a-current"), db.stationRoutes(StationRouteKind.CURRENT).map { it.slug })
        assertEquals(listOf("reference"), db.stationRoutes(StationRouteKind.TIDE).map { it.slug })
        assertEquals(emptyList(), db.stationRoute(StationRouteKind.CURRENT, "a-current")?.formerPaths)
    }

    @Test
    fun opensTheShippedDatabase() {
        val db = openShippedDatabase()
        assertNotNull(db.version)
        assertTrue(db.size > 1000)
        // Every id and slug binary-searches back to its own record, so the
        // byte order flatc's Java runtime compares in agrees with the builder's sort.
        for (station in db) assertEquals(station, db.station(station.id), station.id)
        for (kind in StationRouteKind.values()) {
            for (route in db.stationRoutes(kind)) assertEquals(route, db.stationRoute(kind, route.slug), route.slug)
        }
        // Reference type alone does not imply harmonics: identity-only registry
        // ports and current stations are reference-type records without any.
        val reference = db.require("noaa/9447130")
        assertEquals(StationKind.TIDE, reference.kind)
        assertEquals(StationType.REFERENCE, reference.type)
        assertTrue(reference.accepted)
        assertTrue(reference.constituents.isNotEmpty())
        assertTrue(reference.datums.isNotEmpty())

        // Every subordinate in the file resolves its reference, so no read of
        // prediction data comes back empty on real data.
        val subordinates = db.filter { it.kind == StationKind.TIDE && it.type == StationType.SUBORDINATE }
        assertTrue(subordinates.size > 1000)
        assertEquals(0, subordinates.count { it.constituents.isEmpty() })
        assertEquals(0, subordinates.count { it.astronomicalBounds == null })
    }
}
