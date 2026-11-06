package io.openwaters.slackwater.database

import java.nio.ByteBuffer
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.test.Test
import kotlin.test.assertEquals

class ConcurrencyTest {
    @Test
    fun sharesMappedAndInMemoryReadersAcrossThreads() {
        val pool = Executors.newFixedThreadPool(8)
        try {
            for (db in listOf(openFixture(), StationDatabase(ByteBuffer.wrap(fixture.readBytes())))) {
                val subordinate = db.require("test/subordinate")
                val tasks = List(32) {
                    Callable {
                        assertEquals(fixtureIds, db.map { it.id })
                        assertEquals(listOf("test/reference"), db.stationRoute(StationRouteKind.TIDE, "reference")?.stationIds)
                        assertEquals(listOf("a-current"), db.stationRoutes(StationRouteKind.CURRENT).map { it.slug })
                        assertEquals(listOf("M2", "S2"), subordinate.constituents.map { it.name })
                        assertEquals(4.443, subordinate.datums.getValue("MSL"), 1e-6)
                        assertEquals((6.1 - 2.419) * 1.1, subordinate.astronomicalBounds!!.hat, 1e-5)
                        db.toList()
                    }
                }
                val results = pool.invokeAll(tasks).map { it.get() }
                assertEquals(32, results.size)
                for (stations in results) {
                    assertEquals("Reference", stations[1].name)
                    assertEquals(90.0, stations[0].current?.floodDirection)
                }
            }
        } finally {
            pool.shutdown()
            pool.awaitTermination(10, TimeUnit.SECONDS)
        }
    }
}
