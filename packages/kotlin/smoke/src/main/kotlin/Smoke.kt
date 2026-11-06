import io.openwaters.slackwater.database.StationDatabase
import java.io.File

// A separate build that depends on the reader through includeBuild, as an app
// would. Pass a database file: the test fixture or a release's .tcdb.
fun main(args: Array<String>) {
    val db = StationDatabase.open(File(args.single()))
    val station = db.firstOrNull { it.constituents.isNotEmpty() } ?: error("no station with constituents")
    check(db.station(station.id)?.name == station.name)
    println("${db.version}: ${db.size} stations; ${station.id} has ${station.constituents.size} constituents")
}
