#pragma once

// ==================== FIRMWARE ====================
#define FIRMWARE_VERSION        "2.0.0"
#define FIRMWARE_BUILD          __DATE__ " " __TIME__
#define DEVICE_TYPE             "smartbuddy"

// ==================== HARDWARE PINS ====================
#define PIN_IR_TX               27
#define PIN_IR_RX               14
#define PIN_RELAY               25
#define PIN_PIR                 13
#define PIN_LED1                19
#define PIN_LED2                2
#define PIN_BOOT                0

// ==================== IR ====================
#define IR_TX_RESOLUTION_HZ     1000000     // 1MHz → 1us per tick
// TSOP38238 = active LOW saat ada sinyal → invert_in = false (default)
// Jika saat learning first_level=1 di log, ganti ke 1
#define IR_RX_INVERT_INPUT      0
#define IR_RX_RESOLUTION_HZ     1000000
#define IR_TX_MEM_SYMBOLS       320  // 5 RMT channels (320/64) — cukup untuk Daikin 3-frame (640 timings = 320 symbols)
#define IR_RX_MEM_SYMBOLS       128  // 2 RMT channels — total 7/8 used, aman
#define IR_TX_QUEUE_DEPTH       4
#define IR_SEND_REPEAT          3           // kirim 3x untuk keandalan
#define IR_LEARN_TIMEOUT_MS     10000       // 10 detik untuk capture
#define IR_CARRIER_HZ_DEFAULT   38000
#define IR_CARRIER_HZ_PANASONIC 36700

// ==================== WIFI ====================
#define WIFI_CONNECT_TIMEOUT_MS     30000
#define WIFI_RECONNECT_BASE_MS      2000
#define WIFI_RECONNECT_MAX_MS       30000
#define WIFI_MAX_ATTEMPTS           10
#define WIFI_CHECK_INTERVAL_MS      1000
#define WIFI_MIN_RSSI               -90

// ==================== MQTT ====================
#define MQTT_PORT                   1883
#define MQTT_KEEPALIVE_SEC          120
#define MQTT_RECONNECT_BASE_MS      5000
#define MQTT_RECONNECT_MAX_MS       30000
#define MQTT_NETWORK_TIMEOUT_MS     30000
#define MQTT_MAX_DISCONNECTED_MS    300000
#define MQTT_MAX_RECONNECTS         5
#define MQTT_RECONNECT_WINDOW_MS    600000
#define MQTT_REFRESH_CONNECTION_MS  900000
#define MQTT_BUFFER_SIZE            1024
#define MQTT_TASK_STACK             6144
#define MQTT_TASK_PRIORITY          5

// MQTT topic format: kapitmas/smartbuddy/{device_name}/{subtopic}
#define MQTT_TOPIC_PREFIX           "kapitmas/smartbuddy"

// ==================== HEARTBEAT ====================
#define HEARTBEAT_INTERVAL_MS       10000
#define HEARTBEAT_TASK_STACK        4096
#define HEARTBEAT_TASK_PRIORITY     3

// ==================== PIR ====================
#define PIR_CHECK_INTERVAL_MS       100
#define PIR_DEBOUNCE_MS             500
#define PIR_TASK_STACK              3072
#define PIR_TASK_PRIORITY           4
#define PIR_TIMEOUT_DEFAULT_MS      300000  // 5 menit

// ==================== SCHEDULE ====================
#define SCHEDULE_CHECK_INTERVAL_MS  30000   // cek jadwal setiap 30 detik
#define SCHEDULE_TASK_STACK         4096
#define SCHEDULE_TASK_PRIORITY      3
#define SCHEDULE_MAX_ENTRIES        8
#define SCHEDULE_VALID_WINDOW_SEC   300     // command expired setelah 5 menit

// ==================== LED ====================
#define LED_TASK_STACK              3072
#define LED_TASK_PRIORITY           2

// ==================== BUTTON ====================
#define BUTTON_TASK_STACK           3072
#define BUTTON_TASK_PRIORITY        6
#define BUTTON_BLE_PROV_MS          5000    // tahan 5 detik → BLE provisioning
#define BUTTON_FACTORY_RESET_MS     10000   // tahan 10 detik → factory reset

// ==================== BLE PROVISIONING ====================
#define BLE_DEVICE_NAME_PREFIX      "SmartBuddy"
#define BLE_PROV_TIMEOUT_MS         300000  // 5 menit

#define BLE_SERVICE_UUID            "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define BLE_CHAR_DEVICE_INFO_UUID   "beb5483e-36e1-4688-b7f5-ea07361b26a8"
#define BLE_CHAR_WIFI_CONFIG_UUID   "beb5483e-36e1-4688-b7f5-ea07361b26a9"
#define BLE_CHAR_DEVICE_CONFIG_UUID "beb5483e-36e1-4688-b7f5-ea07361b26aa"
#define BLE_CHAR_PROV_STATUS_UUID   "beb5483e-36e1-4688-b7f5-ea07361b26ab"

// ==================== PROVISIONING ====================
#define PROV_REGISTER_PATH          "/api/provisioning/smartbuddy"
#define PROV_HTTP_TIMEOUT_MS        10000

// ==================== OTA ====================
#define OTA_TASK_STACK              10240
#define OTA_TASK_PRIORITY           3

// ==================== SYSTEM ====================
#define WDT_TIMEOUT_SEC             30
#define LOW_MEMORY_THRESHOLD        50000
#define IR_CMD_QUEUE_SIZE           5
#define NTP_SERVER1                 "pool.ntp.org"
#define NTP_SERVER2                 "time.nist.gov"
#define NTP_SYNC_TIMEOUT_MS         15000
// Timezone POSIX: "WITA-8" = UTC+8 (Makassar/WITA). Ganti ke "WIB-7" untuk Jakarta.
#define NTP_TIMEZONE                "WITA-8"

// ==================== NVS KEYS ====================
#define NVS_NAMESPACE               "smartbuddy"
#define NVS_KEY_SSID                "ssid"
#define NVS_KEY_PASS                "pass"
#define NVS_KEY_DEVICE_NAME         "name"
#define NVS_KEY_ROOM_ID             "room_id"
#define NVS_KEY_MQTT_HOST           "mqtt_host"
#define NVS_KEY_BACKEND_HOST        "backend_host"
#define NVS_KEY_BACKEND_PORT        "backend_port"
#define NVS_KEY_HAS_AC              "has_ac"
#define NVS_KEY_HAS_LAMP            "has_lamp"
#define NVS_KEY_AC_BRAND            "ac_brand"
#define NVS_KEY_PROVISIONED         "provisioned"

// NVS namespace lain
#define NVS_NS_AC                   "ac_state"
#define NVS_NS_LAMP                 "lamp_state"
#define NVS_NS_SCHEDULE             "schedule"
#define NVS_NS_IR_LEARNED           "ir_learned"

// ==================== DEBUG ====================
#define ENABLE_DEBUG                1
