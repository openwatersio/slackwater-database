package io.openwaters.slackwater.database

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class AttributionTest {
    @Test
    fun everyStationCarriesACredit() {
        for (station in openFixture()) {
            assertTrue(station.attribution.startsWith(Station.PROJECT_CREDIT), station.id)
        }
    }

    // The fixture's source requires no credit of its own, so the project line
    // stands alone.
    @Test
    fun aSourceRequiringNoCreditGetsTheProjectLineAlone() {
        assertEquals(Station.PROJECT_CREDIT, openFixture().station("test/reference")?.attribution)
    }

    // Opt-in like opensTheShippedDatabase: a CC BY station only exists in the
    // real database. Checks the whole notice a redistributor must pass on.
    @Test
    fun aCcByStationGetsACompleteNotice() {
        val db = openShippedDatabase()
        val notice = assertNotNull(db.station("ticon/newlyn-new-gbr-bodc")?.attribution)
        assertTrue(notice.startsWith("${Station.PROJECT_CREDIT}. "))
        assertTrue("Hart-Davis" in notice)
        assertTrue("https://doi.org/10.17882/109129" in notice)
        assertTrue("Licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)" in notice)
        assertTrue("Modified: see" in notice)

        // Licence varies inside TICON, so the notice has to follow the station.
        val nc = assertNotNull(db.station("ticon/newlyn-new-gbr-cmems")?.attribution)
        assertTrue("Licensed CC BY-NC 4.0" in nc)
    }
}
