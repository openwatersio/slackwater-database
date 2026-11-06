import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    kotlin("jvm") version "2.4.21"
}

group = "io.openwaters"
version = "0.1.0"
repositories { mavenCentral() }
kotlin {
    jvmToolchain(17)
    compilerOptions { jvmTarget = JvmTarget.JVM_1_8 }
}
java {
    sourceCompatibility = JavaVersion.VERSION_1_8
    targetCompatibility = JavaVersion.VERSION_1_8
}
dependencies {
    // The flatc pin in .mise.toml is 25.9.23, but Maven Central's newest Java
    // runtime is 25.2.10; ./generate explains why the pair is compatible.
    implementation("com.google.flatbuffers:flatbuffers-java:25.2.10")
    testImplementation(platform("org.junit:junit-bom:5.14.4"))
    testImplementation(kotlin("test-junit5"))
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}
tasks.test {
    useJUnitPlatform()
    // Declared as inputs as well as passed as paths, so a regenerated file
    // reruns the tests instead of leaving them up to date.
    val fixture = file("src/test/fixture.tcdb") // written by `npm run test:kotlin -w kotlin`'s pretest
    val preMinorFixture = file("../database/test/fixtures/pre-minor-current.tcdb")
    inputs.file(fixture).withPropertyName("fixture")
    inputs.file(preMinorFixture).withPropertyName("preMinorFixture")
    systemProperty("fixture", fixture.absolutePath)
    systemProperty("preMinorFixture", preMinorFixture.absolutePath)
    System.getenv("SLACKWATER_TCDB")?.let {
        inputs.file(it).withPropertyName("shippedDatabase")
        systemProperty("shippedDatabase", it)
    }
}
