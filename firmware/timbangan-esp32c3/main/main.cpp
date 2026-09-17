#include <stdio.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/event_groups.h"
#include "freertos/queue.h"
#include "nvs_flash.h"
#include "nvs.h"
#include "esp_log.h"
#include "esp_sntp.h"
#include "esp_mac.h"
#include "esp_wifi.h"

#include "app_config.h"
#include "app_types.h"
#include "logger.h"
#include "wifi_manager.h"
#include "mqtt_manager.h"
#include "serial_reader.h"
#include "led_manager.h"
#include "button_manager.h"
#include "ota_manager.h"
#include "ble_manager.h"
#include "device_provisioning.h"

// ==================== GLOBALS ====================

EventGroupHandle_t g_system_events   = NULL;
QueueHandle_t      g_weight_queue    = NULL;
char               g_device_name[32] = {0};
char               g_device_mac[18]  = {0};

static const char* TAG              = "Main";
static device_config_t g_cfg        = {};
static bool s_ble_initialized       = false;

// ==================== NVS HELPERS ====================

static bool load_config(device_config_t* cfg) {
    nvs_handle_t nvs;
    if (nvs_open(NVS_NAMESPACE, NVS_READONLY, &nvs) != ESP_OK) return false;

    size_t len;
    bool ok = true;

    len = sizeof(cfg->ssid);
    if (nvs_get_str(nvs, NVS_KEY_SSID, cfg->ssid, &len) != ESP_OK) ok = false;

    len = sizeof(cfg->password);
    if (nvs_get_str(nvs, NVS_KEY_PASS, cfg->password, &len) != ESP_OK) ok = false;

    len = sizeof(cfg->device_name);
    if (nvs_get_str(nvs, NVS_KEY_DEVICE_NAME, cfg->device_name, &len) != ESP_OK) ok = false;

    len = sizeof(cfg->mqtt_host);
    if (nvs_get_str(nvs, NVS_KEY_MQTT_HOST, cfg->mqtt_host, &len) != ESP_OK) ok = false;

    len = sizeof(cfg->backend_host);
    nvs_get_str(nvs, NVS_KEY_BACKEND_HOST, cfg->backend_host, &len);

    int32_t port = 8000;
    nvs_get_i32(nvs, NVS_KEY_BACKEND_PORT, &port);
    cfg->backend_port = (int)port;

    nvs_close(nvs);
    return ok;
}

// ==================== NTP ====================

static void ntp_sync_cb(struct timeval* tv) {
    LOG_I(TAG, "NTP synced: %lld", (long long)tv->tv_sec);
    xEventGroupSetBits(g_system_events, SYS_EVENT_NTP_SYNCED);
}

static void init_ntp(void) {
    esp_sntp_setoperatingmode(SNTP_OPMODE_POLL);
    esp_sntp_setservername(0, NTP_SERVER1);
    esp_sntp_setservername(1, NTP_SERVER2);
    esp_sntp_set_time_sync_notification_cb(ntp_sync_cb);
    esp_sntp_init();
    LOG_I(TAG, "NTP initialized");
}

// ==================== REGISTRATION ====================

static void register_to_backend(void) {
    char ip[16] = {0};
    wifi_manager_get_ip(ip, sizeof(ip));

    LOG_I(TAG, "Registering device to backend...");
    bool ok = device_provisioning_register(&g_cfg, ip);

    if (ok) {
        xEventGroupSetBits(g_system_events, SYS_EVENT_REGISTERED);
        LOG_I(TAG, "Device registered successfully");
    } else {
        LOG_W(TAG, "Registration failed — will retry next boot");
    }
}

// ==================== BLE PROV CALLBACK ====================

static void on_ble_prov_requested(void) {
    LOG_I(TAG, "BLE provisioning requested by button");

    // Set event BLE_PROVISIONING DULU
    // agar wifi_task langsung pause
    xEventGroupSetBits(g_system_events, SYS_EVENT_BLE_PROVISIONING);
    vTaskDelay(pdMS_TO_TICKS(300));

    // Stop WiFi
    EventBits_t bits = xEventGroupGetBits(g_system_events);
    if (bits & SYS_EVENT_WIFI_CONNECTED) {
        LOG_I(TAG, "Stopping WiFi before BLE...");
        esp_wifi_disconnect();
        vTaskDelay(pdMS_TO_TICKS(200));
        esp_wifi_stop();
        xEventGroupClearBits(g_system_events,
            SYS_EVENT_WIFI_CONNECTED | SYS_EVENT_MQTT_CONNECTED);
        vTaskDelay(pdMS_TO_TICKS(500));
    }

    // Init BLE kalau belum
    if (!s_ble_initialized) {
        LOG_I(TAG, "Initializing BLE...");
        ble_manager_init();
        s_ble_initialized = true;
        vTaskDelay(pdMS_TO_TICKS(200));
    }

    ble_manager_start_provisioning();
}

// ==================== MQTT PUBLISH TASK ====================

static void mqtt_publish_task(void* arg) {
    weight_data_t data;
    char          payload[256];

    while (true) {
        EventBits_t bits = xEventGroupWaitBits(
            g_system_events,
            SYS_EVENT_WIFI_CONNECTED | SYS_EVENT_MQTT_CONNECTED,
            pdFALSE, pdTRUE, pdMS_TO_TICKS(5000)
        );

        if (!(bits & SYS_EVENT_WIFI_CONNECTED) ||
            !(bits & SYS_EVENT_MQTT_CONNECTED)) {
            vTaskDelay(pdMS_TO_TICKS(1000));
            continue;
        }

        if (bits & SYS_EVENT_OTA_IN_PROGRESS) {
            vTaskDelay(pdMS_TO_TICKS(1000));
            continue;
        }

        if (xQueueReceive(g_weight_queue, &data, pdMS_TO_TICKS(500)) == pdTRUE) {
            snprintf(payload, sizeof(payload),
                "{\"name\":\"%s\",\"mac\":\"%s\","
                "\"weight\":%s,\"weight_str\":\"%s\","
                "\"unit\":\"%s\",\"timestamp\":%lld,\"rssi\":%d,"
                "\"firmware\":\"%s\",\"heap\":%lu}",
                data.device_name, g_device_mac,
                data.weight_str, data.weight_str,
                data.unit,
                (long long)data.timestamp, data.rssi,
                FIRMWARE_VERSION,
                (unsigned long)esp_get_free_heap_size()
            );

            bool ok = mqtt_manager_publish(
                mqtt_manager_get_weight_topic(), payload, 0, false
            );

            if (ok) {
                led_manager_set(LED_DOUBLE_BLINK);
                LOG_I(TAG, "Published: %s %s", data.weight_str, data.unit);
            }
        }

        vTaskDelay(pdMS_TO_TICKS(100));
    }
}

// ==================== HEARTBEAT TASK ====================

static void heartbeat_task(void* arg) {
    char     payload[256];
    uint32_t last_active_ms = 0;

    while (true) {
        vTaskDelay(pdMS_TO_TICKS(HEARTBEAT_IDLE_INTERVAL_MS));

        EventBits_t bits = xEventGroupGetBits(g_system_events);

        bool mqtt_ready = (bits & SYS_EVENT_WIFI_CONNECTED) &&
                          (bits & SYS_EVENT_MQTT_CONNECTED) &&
                          !(bits & SYS_EVENT_OTA_IN_PROGRESS) &&
                          !(bits & SYS_EVENT_BLE_PROVISIONING);

        if (!mqtt_ready) continue;

        if (uxQueueMessagesWaiting(g_weight_queue) > 0) {
            last_active_ms = xTaskGetTickCount() * portTICK_PERIOD_MS;
            continue;
        }

        uint32_t now_ms  = xTaskGetTickCount() * portTICK_PERIOD_MS;
        bool     is_idle = (now_ms - last_active_ms) >= HEARTBEAT_IDLE_INTERVAL_MS;

        if (!is_idle) continue;

        snprintf(payload, sizeof(payload),
            "{\"name\":\"%s\",\"mac\":\"%s\",\"status\":\"alive\","
            "\"uptime\":%lu,\"heap\":%lu,"
            "\"rssi\":%d,\"firmware\":\"%s\"}",
            g_device_name, g_device_mac,
            (unsigned long)(now_ms / 1000),
            (unsigned long)esp_get_free_heap_size(),
            wifi_manager_get_rssi(),
            FIRMWARE_VERSION
        );

        mqtt_manager_publish(
            mqtt_manager_get_status_topic(), payload, 0, false
        );

        LOG_I(TAG, "Heartbeat sent");
    }
}

// ==================== BLE MONITOR TASK ====================

static void ble_monitor_task(void* arg) {
    LOG_I(TAG, "BLE monitor started");

    while (true) {
        // Tunggu event BLE provisioning
        xEventGroupWaitBits(
            g_system_events,
            SYS_EVENT_BLE_PROVISIONING,
            pdFALSE, pdTRUE,
            portMAX_DELAY
        );

        LOG_I(TAG, "BLE provisioning active — waiting for config...");

        // Polling sampai config tersimpan atau timeout
        while (!ble_manager_is_provisioning_done()) {
            if (ble_manager_is_timeout()) {
                LOG_W(TAG, "BLE provisioning timeout — resuming WiFi");
                ble_manager_stop();

                // Shutdown BLE
                ble_manager_shutdown();
                s_ble_initialized = false;

                // Clear event dan resume WiFi
                xEventGroupClearBits(g_system_events, SYS_EVENT_BLE_PROVISIONING);

                // Restart WiFi
                esp_wifi_start();
                LOG_I(TAG, "WiFi restarted after BLE timeout");
                break;
            }
            vTaskDelay(pdMS_TO_TICKS(500));
        }

        if (ble_manager_is_provisioning_done()) {
            LOG_I(TAG, "BLE provisioning done — restarting...");
            vTaskDelay(pdMS_TO_TICKS(2000));
            esp_restart();
        }

        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}

// ==================== APP MAIN ====================

extern "C" void app_main(void) {
    printf("\n========================================\n");
    printf("  KAPITMAS IoT - Timbangan\n");
    printf("  Firmware: %s\n", FIRMWARE_VERSION);
    printf("  Chip    : %s\n", DEVICE_CHIP);
    printf("  Build   : %s\n", FIRMWARE_BUILD);
    printf("  PT. Kapitmas - 2025\n");
    printf("========================================\n\n");

    // Init NVS
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES ||
        ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        nvs_flash_erase();
        nvs_flash_init();
    }

    // FreeRTOS objects
    g_system_events = xEventGroupCreate();
    g_weight_queue  = xQueueCreate(WEIGHT_QUEUE_SIZE, sizeof(weight_data_t));

    if (!g_system_events || !g_weight_queue) {
        LOG_E(TAG, "Failed to create FreeRTOS objects!");
        esp_restart();
    }

    // Init hardware
    led_manager_init();
    led_manager_start();
    button_manager_init();

    // Init WiFi stack
    wifi_manager_init();

    // Load config dari NVS
    bool has_config = load_config(&g_cfg);

    if (!has_config || strlen(g_cfg.ssid) == 0) {
        // =============================================
        // MODE PROVISIONING — belum ada config
        // BLE aktif, WiFi tidak dipakai
        // =============================================
        LOG_W(TAG, "No config — starting BLE provisioning...");

        ble_manager_init();
        s_ble_initialized = true;

        button_manager_start(on_ble_prov_requested);

        xTaskCreate(ble_monitor_task, "ble_monitor", 4096, NULL, 4, NULL);

        ble_manager_start_provisioning();

        while (true) {
            vTaskDelay(pdMS_TO_TICKS(60000));
            LOG_I(TAG, "Waiting for BLE provisioning...");
        }

        return;
    }

    // =============================================
    // MODE NORMAL — config sudah ada
    // BLE tidak diaktifkan, WiFi langsung jalan
    // =============================================
    strncpy(g_device_name, g_cfg.device_name, sizeof(g_device_name) - 1);

    // Baca MAC address dari hardware (tersedia segera setelah wifi_manager_init)
    {
        uint8_t mac[6];
        esp_read_mac(mac, ESP_MAC_WIFI_STA);
        snprintf(g_device_mac, sizeof(g_device_mac),
                 "%02X:%02X:%02X:%02X:%02X:%02X",
                 mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    }

    LOG_I(TAG, "Device  : %s", g_device_name);
    LOG_I(TAG, "MAC     : %s", g_device_mac);
    LOG_I(TAG, "SSID    : %s", g_cfg.ssid);
    LOG_I(TAG, "MQTT    : %s:%d", g_cfg.mqtt_host, MQTT_PORT);
    LOG_I(TAG, "Backend : %s:%d", g_cfg.backend_host, g_cfg.backend_port);

    // BLE tidak di-init — hanya saat button ditekan
    s_ble_initialized = false;

    // Start button
    button_manager_start(on_ble_prov_requested);

    // BLE monitor task
    xTaskCreate(ble_monitor_task, "ble_monitor", 4096, NULL, 4, NULL);

    // Init modul
    serial_reader_init();
    ota_manager_init();

    // Init MQTT
    mqtt_manager_init(g_cfg.mqtt_host, MQTT_PORT, g_device_name, g_device_mac);
    mqtt_manager_set_ota_callback(ota_manager_trigger);

    // Start WiFi — tanpa BLE, tidak ada coexistence issue
    wifi_manager_start(g_cfg.ssid, g_cfg.password);

    // Tunggu WiFi
    LOG_I(TAG, "Waiting for WiFi...");
    EventBits_t bits = xEventGroupWaitBits(
        g_system_events, SYS_EVENT_WIFI_CONNECTED,
        pdFALSE, pdTRUE, pdMS_TO_TICKS(30000)
    );

    if (bits & SYS_EVENT_WIFI_CONNECTED) {
        LOG_I(TAG, "WiFi connected");
        init_ntp();
        register_to_backend();
    } else {
        LOG_W(TAG, "WiFi timeout — continuing without registration");
    }

    // Start MQTT
    mqtt_manager_start();

    // Start serial reader
    serial_reader_start(g_weight_queue);

    // Start tasks
    // ESP32-C3 single-core — semua task pakai xTaskCreate (tanpa core affinity)
    xTaskCreate(mqtt_publish_task, "mqtt_pub",
                MQTT_TASK_STACK, NULL, MQTT_TASK_PRIORITY, NULL);

    xTaskCreate(heartbeat_task, "heartbeat",
                HEARTBEAT_TASK_STACK, NULL, HEARTBEAT_TASK_PRIORITY, NULL);

    LOG_I(TAG, "All systems started!");
    printf("\n========================================\n");
    printf("  SYSTEM READY\n");
    printf("  Device : %s\n", g_device_name);
    printf("  Heap   : %lu bytes\n",
           (unsigned long)esp_get_free_heap_size());
    printf("========================================\n\n");

    // Main loop
    while (true) {
        vTaskDelay(pdMS_TO_TICKS(60000));
        LOG_I(TAG, "=== STATS ===");
        LOG_I(TAG, "Uptime : %lu s",
              (unsigned long)(xTaskGetTickCount() * portTICK_PERIOD_MS / 1000));
        LOG_I(TAG, "Heap   : %lu bytes",
              (unsigned long)esp_get_free_heap_size());
        LOG_I(TAG, "RSSI   : %d dBm", wifi_manager_get_rssi());
        LOG_I(TAG, "Queue  : %d/%d",
              (int)uxQueueMessagesWaiting(g_weight_queue), WEIGHT_QUEUE_SIZE);
    }
}