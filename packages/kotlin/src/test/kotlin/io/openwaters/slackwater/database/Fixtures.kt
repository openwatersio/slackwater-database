package io.openwaters.slackwater.database

import java.io.File
import org.junit.jupiter.api.Assumptions.assumeTrue

/**
 * The fixture ../swift/scripts/generate-fixture.ts writes through the
 * TypeScript buildDatabase, the same builder that produces the shipped file.
 * `npm run test:kotlin -w kotlin` regenerates it first.
 */
internal val fixture: File by lazy {
    val file = File(requireNotNull(System.getProperty("fixture")) { "run through Gradle, which sets -Dfixture" })
    check(file.isFile) { "$file is missing; run `npm run test:kotlin -w kotlin`, whose pretest writes it" }
    file
}

internal fun openFixture() = StationDatabase.open(fixture)

internal fun StationDatabase.require(id: String) = requireNotNull(station(id)) { "no station $id" }

/**
 * The real database, not the fixture. Opt-in because the file is generated:
 * SLACKWATER_TCDB=../database/src/generated/slackwater.tcdb
 */
internal fun openShippedDatabase(): StationDatabase {
    val path = System.getProperty("shippedDatabase")
    assumeTrue(path != null, "Set SLACKWATER_TCDB to a database file to run")
    return StationDatabase.open(File(path!!))
}

internal val fixtureIds = listOf(
    "test/current", "test/reference", "test/subordinate", "test/subordinate-fixed",
    "test/zfit-bounded", "test/zfit-online", "test/zfit-unknown",
)
