pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolution {
    repositories {
        google()
        mavenCentral()
        maven { url = uri("https://repo.picovoice.ai/android") }
    }
}

rootProject.name = "Max"
include(":app")
