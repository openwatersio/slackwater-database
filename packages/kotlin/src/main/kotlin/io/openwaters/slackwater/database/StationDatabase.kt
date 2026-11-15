package io.openwaters.slackwater.database

import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.channels.FileChannel

/**
 * The bytes are not a station database: too short, the "TCDB" file
 * identifier is missing, or the root table lies past the end.
 */
class InvalidStationDatabaseException : IllegalArgumentException("Not a station database: missing the TCDB file identifier or root table")

/**
 * The bytes are a station database in a newer format than this reader knows.
 * Upgrade the reader to open it.
 */
class UnsupportedStationDatabaseException(
    /** The file's format major version. */
    val formatVersion: Int,
) : IllegalArgumentException(
    "Unsupported station database: format version $formatVersion, this reader knows ${StationDatabase.FORMAT_VERSION}",
)

/**
 * A station database file (`.tcdb`, schemas/database.fbs in
 * openwatersio/slackwater-database), read in place.
 *
 * The buffer is never decoded up front. Opening a memory-mapped file and
 * iterating identity (id, name, coordinates) touches only the head pages of
 * the file, because the builder writes every station table before any
 * prediction data. Reading one station's constituents faults in only the
 * pages that hold them.
 *
 *     val db = StationDatabase.open(file)
 *     val nearest = db.minBy { distanceTo(it) }
 *     val station = db.station("noaa/9447130")
 *     val m2 = station?.constituents?.firstOrNull { it.name == "M2" }
 *
 * A list of [Station] in id order. Reads are safe from any thread: every read
 * is an absolute get. The buffer is read in place, not copied, so its bytes
 * must not change while the database is in use.
 */
class StationDatabase(buffer: ByteBuffer) : AbstractList<Station>(), RandomAccess {
    internal val root: Slackwater.Root

    init {
        // slice() so the file starts at index 0 and capacity is its length:
        // the generated key lookups address the buffer from its capacity.
        // getRootAsRoot sets the byte order on the slice, never the caller's.
        val bytes = buffer.slice()
        // The "TCDB" file identifier occupies bytes 4..<8 of every database
        // file. Checked directly instead of running a verifier, which would
        // walk, and page in, the entire buffer.
        if (bytes.remaining() < 8 || !Slackwater.Root.RootBufferHasIdentifier(bytes)) {
            throw InvalidStationDatabaseException()
        }
        // Files written before the field existed read as 0. The accessors
        // read without bounds checks, so a cut-off root table throws here.
        val format: Int
        try {
            root = Slackwater.Root.getRootAsRoot(bytes)
            format = root.formatVersion.toInt()
            // The vtable's second entry is the root table's size.
            val table = bytes.getInt(0)
            val vtable = table - bytes.getInt(table)
            // Subtracted, not added, so a table offset near Int.MAX_VALUE can't wrap.
            if (bytes.getShort(vtable + 2).toUShort().toInt() > bytes.limit() - table) {
                throw InvalidStationDatabaseException()
            }
        } catch (e: IndexOutOfBoundsException) {
            throw InvalidStationDatabaseException()
        }
        if (format > FORMAT_VERSION) throw UnsupportedStationDatabaseException(format)
    }

    /** Release tag of the database that produced the file, e.g. "0.9.20260801". */
    val version: String? get() = root.version

    override val size: Int get() = root.stationsLength

    override fun get(index: Int): Station {
        if (index !in 0 until size) throw IndexOutOfBoundsException("index $index, size $size")
        return Station(root.stations(index)!!, root)
    }

    /** Binary search on the id-sorted stations vector; no scan, no decode. */
    fun station(id: String): Station? = root.stationsByKey(id)?.let { Station(it, root) }

    /** Binary search on the slug-sorted route vector. */
    fun stationRoute(kind: StationRouteKind, slug: String): StationRoute? = when (kind) {
        StationRouteKind.TIDE -> root.tideRoutesByKey(slug)
        StationRouteKind.CURRENT -> root.currentRoutesByKey(slug)
    }?.let(::StationRoute)

    /** Every route of one kind, in slug order. */
    fun stationRoutes(kind: StationRouteKind): List<StationRoute> = when (kind) {
        StationRouteKind.TIDE -> (0 until root.tideRoutesLength).mapNotNull { root.tideRoutes(it) }
        StationRouteKind.CURRENT -> (0 until root.currentRoutesLength).mapNotNull { root.currentRoutes(it) }
    }.map(::StationRoute)

    companion object {
        /**
         * The newest format major version this reader knows (`Root.format_version`
         * in schemas/database.fbs). It opens files up to this version.
         */
        const val FORMAT_VERSION = 1

        /** Memory-map a database file. Pages fault in as they are read. */
        @JvmStatic
        fun open(file: File): StationDatabase =
            RandomAccessFile(file, "r").use { open(it.channel) }

        /**
         * Memory-map [size] bytes of [channel] from [position], such as an
         * uncompressed Android asset's `AssetFileDescriptor` range. The mapping
         * outlives the channel, so the caller may close it once this returns.
         */
        @JvmStatic
        @JvmOverloads
        fun open(channel: FileChannel, position: Long = 0, size: Long = channel.size() - position): StationDatabase =
            StationDatabase(channel.map(FileChannel.MapMode.READ_ONLY, position, size))
    }
}
