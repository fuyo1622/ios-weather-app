plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// The app runs ../TaiwanWeather.js, the same file as the iPhone's Scriptable script: it is copied in at build time.
abstract class CopyScript : DefaultTask() {
    @get:InputFile abstract val script: RegularFileProperty
    @get:OutputDirectory abstract val outputDir: DirectoryProperty

    @TaskAction
    fun copy() {
        val out = outputDir.get().asFile
        out.mkdirs()
        script.get().asFile.copyTo(out.resolve("TaiwanWeather.js"), overwrite = true)
    }
}
val copyScript = tasks.register<CopyScript>("copyScript") {
    script.set(rootProject.file("../TaiwanWeather.js"))
}

// GitHub Actions numbers each build, so each APK installs over the one before.
val buildNumber = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()
val keystore = System.getenv("ANDROID_KEYSTORE")

android {
    namespace = "com.fuyo1622.taiwanweather"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.fuyo1622.taiwanweather"
        minSdk = 26
        targetSdk = 35
        versionCode = buildNumber
        versionName = "1.0.$buildNumber"
    }

    // The release key lives in GitHub's secrets (never in the repository); without it, release builds use the debug key.
    signingConfigs {
        create("release") {
            if (keystore != null) {
                storeFile = file(keystore)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName(if (keystore != null) "release" else "debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        buildConfig = true
    }
    lint {
        checkReleaseBuilds = false
        abortOnError = false
    }
}

androidComponents {
    onVariants { variant -> variant.sources.assets?.addGeneratedSourceDirectory(copyScript, CopyScript::outputDir) }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.work:work-runtime-ktx:2.9.1")
}
