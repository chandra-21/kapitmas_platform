#pragma once

// ==================== FIRMWARE ====================
#define FIRMWARE_VERSION        "v4.0.0-esp-idf"
#define FIRMWARE_BUILD          __DATE__ " " __TIME__

// ==================== HARDWARE PINS ====================
#define PIN_LED1                19
#define PIN_LED2                2
#define PIN_BOOT                27
#define PIN_UART2_RX            16
#define PIN_UART2_TX            17

// ==================== WIFI ====================
#define WIFI_CONNECT_TIMEOUT_MS     30000   // was 15s — DHCP on some APs needs more time
#define WIFI_MAX_DHCP_WAITS         0       // no extra wait — give up after WIFI_CONNECT_TIMEOUT_MS
#define WIFI_RECONNECT_BASE_MS      2000
#define WIFI_RECONNECT_MAX_MS       30000
#define WIFI_MAX_ATTEMPTS           10
#define WIFI_CHECK_INTERVAL_MS      1000
#define WIFI_MIN_RSSI               -90

// ==================== MQTT ====================
#define MQTT_PORT                   1883
#define MQTT_KEEPALIVE_SEC          60      // 60s — heartbeat (10s) keeps traffic flowing, PINGREQ is rare fallback
#define MQTT_RECONNECT_BASE_MS      5000
#define MQTT_RECONNECT_MAX_MS       30000
#define MQTT_NETWORK_TIMEOUT_MS     30000   // 30s — toleransi Deco yang flaky
#define MQTT_MAX_DISCONNECTED_MS    300000  // 5 min — last-resort restart jika stuck disconnected
#define MQTT_MAX_RECONNECTS         5       // max reconnect dalam window sebelum restart
#define MQTT_RECONNECT_WINDOW_MS    600000  // 10 min window untuk hitung reconnect
#define MQTT_REFRESH_CONNECTION_MS  900000  // 15 min — force reconnect sebelum NAT/broker expire (~20 min)
#define MQTT_BUFFER_SIZE            512
#define MQTT_TASK_STACK             6144
#define MQTT_TASK_PRIORITY          5

// MQTT Topic — format baru Kapitmas
// kapitmas/timbangan/{device_name}/{subtopic}
#define MQTT_TOPIC_PREFIX           "kapitmas/timbangan"
#define MQTT_TOPIC_OTA_PREFIX       "ota"

// ==================== HEARTBEAT ====================
// WAJIB < MQTT_KEEPALIVE_SEC: heartbeat harus mengirim PUBLISH sebelum keepalive timer habis
// agar PINGREQ tidak pernah terpicu dan ketergantungan pada PINGRESP dihilangkan
#define HEARTBEAT_IDLE_INTERVAL_MS  10000   // 10s — jauh di bawah keepalive 60s
#define HEARTBEAT_TASK_STACK        4096
#define HEARTBEAT_TASK_PRIORITY     3

// ==================== SERIAL (UART2) ====================
#define UART2_BAUD_RATE             9600
#define UART2_BUFFER_SIZE           256
#define UART2_TIMEOUT_MS            500
#define UART2_MIN_INTERVAL_MS       100
#define UART2_TASK_STACK            4096
#define UART2_TASK_PRIORITY         4

// ==================== LED ====================
#define LED_TASK_STACK              3072
#define LED_TASK_PRIORITY           2

// ==================== BUTTON ====================
#define BUTTON_TASK_STACK           3072
#define BUTTON_TASK_PRIORITY        6
#define BUTTON_BLE_PROV_MS          5000   // tahan 5 detik → BLE provisioning
#define BUTTON_FACTORY_RESET_MS     10000  // tahan 10 detik → factory reset

// ==================== BLE PROVISIONING ====================
#define BLE_DEVICE_NAME_PREFIX      "Kapitmas"
#define BLE_PROV_TIMEOUT_MS         300000  // 5 menit, lalu matikan BLE

// BLE GATT Service UUID
#define BLE_SERVICE_UUID            "4fafc201-1fb5-459e-8fcc-c5c9c331914b"

// BLE Characteristic UUIDs
#define BLE_CHAR_DEVICE_INFO_UUID   "beb5483e-36e1-4688-b7f5-ea07361b26a8"
#define BLE_CHAR_WIFI_CONFIG_UUID   "beb5483e-36e1-4688-b7f5-ea07361b26a9"
#define BLE_CHAR_DEVICE_CONFIG_UUID "beb5483e-36e1-4688-b7f5-ea07361b26aa"
#define BLE_CHAR_PROV_STATUS_UUID   "beb5483e-36e1-4688-b7f5-ea07361b26ab"

// ==================== PROVISIONING ====================
// URL backend untuk auto-register setelah WiFi connect
#define PROV_REGISTER_PATH          "/api/provisioning/complete"
#define PROV_HTTP_TIMEOUT_MS        10000
#define DEVICE_TYPE                 "timbangan"

// ==================== OTA ====================
#define OTA_TASK_STACK              10240
#define OTA_TASK_PRIORITY           3
#define OTA_URL_MAX_LEN             512

// ==================== SYSTEM ====================
#define WDT_TIMEOUT_SEC             30
#define LOW_MEMORY_THRESHOLD        50000
#define WEIGHT_QUEUE_SIZE           10
#define NTP_SERVER1                 "pool.ntp.org"
#define NTP_SERVER2                 "time.nist.gov"
#define NTP_SYNC_TIMEOUT_MS         10000

// ==================== NVS KEYS ====================
#define NVS_NAMESPACE               "kapitmas"
#define NVS_KEY_SSID                "ssid"
#define NVS_KEY_PASS                "pass"
#define NVS_KEY_DEVICE_NAME         "name"
#define NVS_KEY_MQTT_HOST           "mqtt_host"
#define NVS_KEY_BACKEND_HOST        "backend_host"
#define NVS_KEY_BACKEND_PORT        "backend_port"
#define NVS_KEY_PROVISIONED         "provisioned"

// ==================== DEBUG ====================
#define ENABLE_DEBUG                1