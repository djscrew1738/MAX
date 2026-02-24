package com.ctlplumbing.max.data.repository

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.*
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.runBlocking
import com.ctlplumbing.max.BuildConfig

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "max_settings")

class SettingsRepository(private val context: Context) {

    companion object {
        val SERVER_URL = stringPreferencesKey("server_url")
        val WS_URL = stringPreferencesKey("ws_url")
        val API_KEY = stringPreferencesKey("api_key")
        val EMAIL_TO = stringPreferencesKey("email_to")
        val WAKE_WORD_ENABLED = booleanPreferencesKey("wake_word_enabled")
        val AUTO_UPLOAD = booleanPreferencesKey("auto_upload")
        val VIBRATE_ON_COMMAND = booleanPreferencesKey("vibrate_on_command")
        val PORCUPINE_ACCESS_KEY = stringPreferencesKey("porcupine_access_key")
        val OFFLINE_MODE = booleanPreferencesKey("offline_mode")
        val LAST_SYNC = stringPreferencesKey("last_sync")
    }

    val serverUrl: Flow<String> = context.dataStore.data.map { prefs ->
        prefs[SERVER_URL] ?: BuildConfig.API_BASE_URL
    }

    val wsUrl: Flow<String> = context.dataStore.data.map { prefs ->
        prefs[WS_URL] ?: BuildConfig.WS_URL
    }

    val apiKey: Flow<String> = context.dataStore.data.map { prefs ->
        prefs[API_KEY] ?: BuildConfig.API_KEY
    }

    val emailTo: Flow<String> = context.dataStore.data.map { prefs ->
        prefs[EMAIL_TO] ?: ""
    }

    val wakeWordEnabled: Flow<Boolean> = context.dataStore.data.map { prefs ->
        prefs[WAKE_WORD_ENABLED] ?: true
    }

    val autoUpload: Flow<Boolean> = context.dataStore.data.map { prefs ->
        prefs[AUTO_UPLOAD] ?: true
    }

    val vibrateOnCommand: Flow<Boolean> = context.dataStore.data.map { prefs ->
        prefs[VIBRATE_ON_COMMAND] ?: true
    }

    val porcupineAccessKey: Flow<String> = context.dataStore.data.map { prefs ->
        prefs[PORCUPINE_ACCESS_KEY] ?: ""
    }

    val offlineMode: Flow<Boolean> = context.dataStore.data.map { prefs ->
        prefs[OFFLINE_MODE] ?: false
    }

    val lastSync: Flow<String?> = context.dataStore.data.map { prefs ->
        prefs[LAST_SYNC]
    }

    // Sync getters for services
    fun getServerUrlSync(): String = runBlocking { serverUrl.first() }
    fun getWsUrlSync(): String = runBlocking { wsUrl.first() }
    fun getApiKeySync(): String = runBlocking { apiKey.first() }
    fun getPorcupineKeySync(): String = runBlocking { porcupineAccessKey.first() }
    fun getOfflineModeSync(): Boolean = runBlocking { offlineMode.first() }

    suspend fun <T> update(key: Preferences.Key<T>, value: T) {
        context.dataStore.edit { prefs ->
            prefs[key] = value
        }
    }

    suspend fun updateServerConfig(serverUrl: String, wsUrl: String, apiKey: String) {
        context.dataStore.edit { prefs ->
            prefs[SERVER_URL] = serverUrl
            prefs[WS_URL] = wsUrl
            prefs[API_KEY] = apiKey
        }
    }

    suspend fun setLastSync(timestamp: String) {
        context.dataStore.edit { prefs ->
            prefs[LAST_SYNC] = timestamp
        }
    }

    suspend fun resetToDefaults() {
        context.dataStore.edit { prefs ->
            prefs[SERVER_URL] = BuildConfig.API_BASE_URL
            prefs[WS_URL] = BuildConfig.WS_URL
            prefs[API_KEY] = BuildConfig.API_KEY
            prefs[WAKE_WORD_ENABLED] = true
            prefs[AUTO_UPLOAD] = true
            prefs[VIBRATE_ON_COMMAND] = true
            prefs[OFFLINE_MODE] = false
        }
    }
}
