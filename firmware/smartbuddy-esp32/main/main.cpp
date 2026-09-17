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
#include "esp_task_wdt.h"

#include "app_config.h"
#include "app_types.h"
#include "logger.h"
#include "wifi/wifi_manager.h"
#include "mqtt/mqtt_manager.h"
#include "ble/ble_manager.h"
#include "ir/ir_driver.h"
#include "ir/ir_brands.h"
#include "relay/relay_manager.h"
#include "pir/pir_sensor.h"
#include "ac/ac_manager.h"
#include "lamp/lamp_manager.h"
#include "schedule/schedule_manager.h"
#include "provisioning/device_provisioning.h"
#include "ota/ota_manager.h"
#include "led/led_manager.h"
#include "button/button_manager.h"

// ==================== GLOBALS ====================

EventGroupHandle_t g_system_events = NULL;
QueueHandle_t      g_ir_cmd_queue  = NULL;
char               g_device_name[32] = {0};
char               g_device_mac[18]  = {0};

static const char*   TAG            = "Main";
static device_config_t g_cfg        = {};
static bool          s_ble_initialized = false;

// ==================== NVS HELPERS ====================

static bool load_config(device_config_t* cfg) {
    nvs_handle_t nvs;
    if (nvs_open(NVS_NAMESPACE, NVS_READONLY, &nvs) != ESP_OK) return false;

    bool ok = true;
    size_t len;

    len = sizeof(cfg->ssid);
    if (nvs_get_str(nvs, NVS_KEY_SSID, cfg->ssid, &len) != ESP_OK) ok = false;

    len = sizeof(cfg->password);
    if (nvs_get_str(nvs, NVS_KEY_PASS, cfg->password, &len) != ESP_OK) ok = false;

    len = sizeof(cfg->device_name);
    if (nvs_get_str(nvs, NVS_KEY_DEVICE_NAME, cfg->device_name, &len) != ESP_OK) ok = false;

    len = sizeof(cfg->room_id);
    nvs_get_str(nvs, NVS_KEY_ROOM_ID, cfg->room_id, &len);

    len = sizeof(cfg->mqtt_host);
    if (nvs_get_str(nvs, NVS_KEY_MQTT_HOST, cfg->mqtt_host, &len) != ESP_OK) ok = false;

    len = sizeof(cfg->backend_host);
    nvs_get_str(nvs, NVS_KEY_BACKEND_HOST, cfg->backend_host, &len);

    int32_t port = 8000;
    nvs_get_i32(nvs, NVS_KEY_BACKEND_PORT, &port);
    cfg->backend_port = (int)port;

    uint8_t val;
    if (nvs_get_u8(nvs, NVS_KEY_HAS_AC,   &val) == ESP_OK) cfg->has_ac   = (bool)val;
    else cfg->has_ac = true;

    if (nvs_get_u8(nvs, NVS_KEY_HAS_LAMP, &val) == ESP_OK) cfg->has_lamp = (bool)val;
    else cfg->has_lamp = true;

    len = sizeof(cfg->ac_brand);
    if (nvs_get_str(nvs, NVS_KEY_AC_BRAND, cfg->ac_brand, &len) != ESP_OK) {
        strncpy(cfg->ac_brand, "daikin", sizeof(cfg->ac_brand) - 1);
    }

    nvs_close(nvs);
    return ok;
}

// ==================== NTP ====================

static void ntp_sync_cb(struct timeval* tv) {
    LOG_I(TAG, "NTP synced: %lld", (long long)tv->tv_sec);
    xEventGroupSetBits(g_system_events, SYS_EVENT_NTP_SYNCED);
}

static void init_ntp(void) {
    // Set timezone ke WIB/WITA sesuai lokasi device (UTC+8 = Makassar)
    // POSIX format "WITA-8" = local time is UTC+8
    setenv("TZ", NTP_TIMEZONE, 1);
    tzset();

    esp_sntp_setoperatingmode(SNTP_OPMODE_POLL);
    esp_sntp_setservername(0, NTP_SERVER1);
    esp_sntp_setservername(1, NTP_SERVER2);
    esp_sntp_set_time_sync_notification_cb(ntp_sync_cb);
    esp_sntp_init();
    LOG_I(TAG, "NTP initialized (TZ=%s)", NTP_TIMEZONE);

    // Tunggu sync (non-blocking, schedule manager cek NTP_SYNCED sebelum execute)
}

// ==================== REGISTRATION ====================

static void register_to_backend(void) {
    char ip[16] = {0};
    wifi_manager_get_ip(ip, sizeof(ip));

    bool ok = device_provisioning_register(&g_cfg, ip, g_device_mac);
    if (ok) {
        xEventGroupSetBits(g_system_events, SYS_EVENT_REGISTERED);
        LOG_I(TAG, "Device registered");
    } else {
        LOG_W(TAG, "Registration failed — will retry next boot");
    }
}

// ==================== BLE PROV CALLBACK ====================

static void on_ble_prov_requested(void) {
    LOG_I(TAG, "BLE provisioning requested");
    xEventGroupSetBits(g_system_events, SYS_EVENT_BLE_PROVISIONING);
    vTaskDelay(pdMS_TO_TICKS(300));

    EventBits_t bits = xEventGroupGetBits(g_system_events);
    if (bits & SYS_EVENT_WIFI_CONNECTED) {
        esp_wifi_disconnect();
        vTaskDelay(pdMS_TO_TICKS(200));
        esp_wifi_stop();
        xEventGroupClearBits(g_system_events,
            SYS_EVENT_WIFI_CONNECTED | SYS_EVENT_MQTT_CONNECTED);
        vTaskDelay(pdMS_TO_TICKS(500));
    }

    if (!s_ble_initialized) {
        ble_manager_init();
        s_ble_initialized = true;
        vTaskDelay(pdMS_TO_TICKS(200));
    }
    ble_manager_start_provisioning();
}

// Forward declarations untuk callbacks yang saling mereferensi
static void on_lamp_command(bool power, lamp_mode_t mode, uint32_t pir_timeout_ms);

// ==================== SCHEDULE LAMP WRAPPER ====================
static void on_schedule_lamp(bool power) {
    on_lamp_command(power, LAMP_MODE_SCHEDULE, 0);
}

// ==================== MQTT CALLBACKS ====================

static void on_ac_command(const ac_state_t* cmd) {
    if (!g_cfg.has_ac) return;
    ac_manager_apply(cmd);
    // Publish state update setelah apply
    // (IR command dieksekusi di ir_task, state dipublish di sana)
}

static void on_lamp_state_changed(const lamp_state_t* state) {
    if (xEventGroupGetBits(g_system_events) & SYS_EVENT_MQTT_CONNECTED) {
        mqtt_manager_publish_lamp_state(state);
    }
}

static void on_lamp_command(bool power, lamp_mode_t mode, uint32_t pir_timeout_ms) {
    if (!g_cfg.has_lamp) return;
    if (pir_timeout_ms > 0) lamp_manager_set_pir_timeout(pir_timeout_ms);
    lamp_manager_set_mode(mode);
    lamp_manager_set_power(power);
    // State dipublish via callback (on_lamp_state_changed), tidak perlu manual di sini
}

static void on_schedule(const char* json) {
    schedule_manager_set_from_json(json);
}

static void on_ir_learn(const char* slot) {
    if (!g_cfg.has_ac) return;
    LOG_I(TAG, "IR learn requested for slot: %s", slot);
    xEventGroupSetBits(g_system_events, SYS_EVENT_IR_LEARNING);

    // Capture slot name untuk callback
    static char s_learn_slot[32];
    strncpy(s_learn_slot, slot, sizeof(s_learn_slot) - 1);

    ir_driver_learn_start(
        [](const uint16_t* timings, size_t count, void* ctx) {
            // Learning done callback
            xEventGroupClearBits(g_system_events, SYS_EVENT_IR_LEARNING);
            const char* sl = (const char*)ctx;

            if (timings && count > 0) {
                // Simpan ke NVS
                // Key: slot name, Value: binary timing array
                nvs_handle_t nvs;
                if (nvs_open(NVS_NS_IR_LEARNED, NVS_READWRITE, &nvs) == ESP_OK) {
                    nvs_set_blob(nvs, sl, timings, count * sizeof(uint16_t));
                    nvs_commit(nvs);
                    nvs_close(nvs);
                    LOG_I("Main", "IR learned slot '%s' saved (%d pulses)", sl, (int)count);
                }
                mqtt_manager_publish_ir_learn_result(sl, true, timings, count);
            } else {
                LOG_W("Main", "IR learning failed for slot '%s'", sl);
                mqtt_manager_publish_ir_learn_result(sl, false, NULL, 0);
            }
        },
        (void*)s_learn_slot
    );
}

static void on_pir_motion(bool motion) {
    lamp_manager_on_pir(motion);
    if (xEventGroupGetBits(g_system_events) & SYS_EVENT_MQTT_CONNECTED) {
        mqtt_manager_publish_pir(motion);
    }
}

// ==================== INITIAL PUBLISH TASK ====================

static void initial_publish_task(void* arg) {
    xEventGroupWaitBits(g_system_events, SYS_EVENT_MQTT_CONNECTED,
                         pdFALSE, pdTRUE, pdMS_TO_TICKS(30000));
    vTaskDelay(pdMS_TO_TICKS(500));

    mqtt_manager_publish_status("online");
    mqtt_manager_publish_capabilities(g_cfg.has_ac, g_cfg.has_lamp, g_cfg.ac_brand);

    if (g_cfg.has_ac) {
        ac_state_t state = ac_manager_get_state();
        mqtt_manager_publish_ac_state(&state);
    }
    if (g_cfg.has_lamp) {
        lamp_state_t state = lamp_manager_get_state();
        mqtt_manager_publish_lamp_state(&state);
    }

    vTaskDelete(NULL);
}

// ==================== IR COMMAND TASK ====================
// Eksekusi IR command dari queue — satu per satu agar tidak overlap

static void ir_task(void* arg) {
    ir_command_t cmd;

    while (true) {
        if (xQueueReceive(g_ir_cmd_queue, &cmd, pdMS_TO_TICKS(1000)) == pdTRUE) {
            LOG_I(TAG, "IR send: brand=%d power=%d mode=%d temp=%d",
                  cmd.brand, cmd.state.power, cmd.state.mode, cmd.state.temp);

            // Set carrier untuk brand
            uint32_t carrier = ir_brand_carrier_hz(cmd.brand);
            ir_driver_tx_set_carrier(carrier);

            static uint16_t timings[IR_MAX_TIMINGS];

            if (cmd.brand == IR_BRAND_LEARNED) {
                // Load dari NVS
                // (slot name tidak ada di command — ac_manager perlu kirim slot)
                // Untuk sementara, skip learned IR via queue
                LOG_W(TAG, "Learned IR via queue not yet implemented");
            } else {
                size_t count = ir_brand_encode(cmd.brand, &cmd.state,
                                                timings, IR_MAX_TIMINGS);
                if (count > 0) {
                    for (int r = 0; r < IR_SEND_REPEAT; r++) {
                        ir_driver_send_raw(timings, count);
                        if (r < IR_SEND_REPEAT - 1) vTaskDelay(pdMS_TO_TICKS(50));
                    }
                    led_manager_set(LED_DOUBLE_BLINK);
                    LOG_I(TAG, "IR sent (%d timings)", (int)count);
                } else {
                    LOG_W(TAG, "Brand encode failed");
                }
            }

            // Publish updated AC state ke MQTT
            ac_state_t state = ac_manager_get_state();
            mqtt_manager_publish_ac_state(&state);
        }
    }
}

// ==================== HEARTBEAT TASK ====================

static void heartbeat_task(void* arg) {
    while (true) {
        vTaskDelay(pdMS_TO_TICKS(HEARTBEAT_INTERVAL_MS));

        EventBits_t bits = xEventGroupGetBits(g_system_events);
        if (!(bits & SYS_EVENT_WIFI_CONNECTED) ||
            !(bits & SYS_EVENT_MQTT_CONNECTED) ||
             (bits & SYS_EVENT_OTA_IN_PROGRESS) ||
             (bits & SYS_EVENT_BLE_PROVISIONING)) continue;

        mqtt_manager_publish_heartbeat();
    }
}

// ==================== SCHEDULE TASK ====================

static void schedule_task(void* arg) {
    while (true) {
        vTaskDelay(pdMS_TO_TICKS(SCHEDULE_CHECK_INTERVAL_MS));

        EventBits_t bits = xEventGroupGetBits(g_system_events);
        if (!(bits & SYS_EVENT_NTP_SYNCED))  continue;
        if (!(bits & SYS_EVENT_MQTT_CONNECTED)) continue;

        schedule_manager_check();

        // Auto-off PIR check
        if (g_cfg.has_lamp) {
            lamp_manager_check_auto_off();
        }
    }
}

// ==================== BLE MONITOR TASK ====================

static void ble_monitor_task(void* arg) {
    while (true) {
        xEventGroupWaitBits(g_system_events, SYS_EVENT_BLE_PROVISIONING,
                             pdFALSE, pdTRUE, portMAX_DELAY);

        LOG_I(TAG, "BLE provisioning active — waiting...");

        while (!ble_manager_is_provisioning_done()) {
            if (ble_manager_is_timeout()) {
                LOG_W(TAG, "BLE timeout — resuming WiFi");
                ble_manager_stop();
                ble_manager_shutdown();
                s_ble_initialized = false;
                xEventGroupClearBits(g_system_events, SYS_EVENT_BLE_PROVISIONING);
                esp_wifi_start();
                break;
            }
            vTaskDelay(pdMS_TO_TICKS(500));
        }

        if (ble_manager_is_provisioning_done()) {
            LOG_I(TAG, "Provisioning done — restarting...");
            vTaskDelay(pdMS_TO_TICKS(2000));
            esp_restart();
        }

        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}

// ==================== APP MAIN ====================

extern "C" void app_main(void) {
    printf("\n========================================\n");
    printf("  KAPITMAS IoT — SmartBuddy\n");
    printf("  Firmware  : %s\n", FIRMWARE_VERSION);
    printf("  Build     : %s\n", FIRMWARE_BUILD);
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
    g_ir_cmd_queue  = xQueueCreate(IR_CMD_QUEUE_SIZE, sizeof(ir_command_t));

    if (!g_system_events || !g_ir_cmd_queue) {
        LOG_E(TAG, "FreeRTOS object creation failed!");
        esp_restart();
    }

    // Hardware watchdog
    esp_task_wdt_config_t wdt_cfg = {
        .timeout_ms     = WDT_TIMEOUT_SEC * 1000,
        .idle_core_mask = 0,
        .trigger_panic  = true,
    };
    esp_task_wdt_init(&wdt_cfg);

    // Init hardware
    led_manager_init();
    led_manager_start();
    button_manager_init();
    relay_manager_init();

    // Init IR TX (carrier default, akan diubah per brand)
    ir_driver_tx_init(IR_CARRIER_HZ_DEFAULT);
    ir_driver_rx_init();

    // Init WiFi stack (harus sebelum load_config pakai wifi mac)
    wifi_manager_init();

    // MAC address
    {
        uint8_t mac[6];
        esp_read_mac(mac, ESP_MAC_WIFI_STA);
        snprintf(g_device_mac, sizeof(g_device_mac),
                 "%02X:%02X:%02X:%02X:%02X:%02X",
                 mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    }

    // Load config dari NVS
    bool has_config = load_config(&g_cfg);

    if (!has_config || strlen(g_cfg.ssid) == 0) {
        // =============================================
        // MODE PROVISIONING — belum ada config
        // =============================================
        LOG_W(TAG, "No config — starting BLE provisioning...");

        ble_manager_init();
        s_ble_initialized = true;
        button_manager_start(on_ble_prov_requested);

        xTaskCreatePinnedToCore(ble_monitor_task, "ble_monitor",
                                 4096, NULL, 4, NULL, 1);
        ble_manager_start_provisioning();

        while (true) {
            vTaskDelay(pdMS_TO_TICKS(60000));
            LOG_I(TAG, "Waiting for BLE provisioning...");
        }
        return;
    }

    // =============================================
    // MODE NORMAL
    // =============================================
    strncpy(g_device_name, g_cfg.device_name, sizeof(g_device_name) - 1);

    LOG_I(TAG, "Device  : %s", g_device_name);
    LOG_I(TAG, "MAC     : %s", g_device_mac);
    LOG_I(TAG, "Room    : %s", g_cfg.room_id);
    LOG_I(TAG, "SSID    : %s", g_cfg.ssid);
    LOG_I(TAG, "MQTT    : %s:%d", g_cfg.mqtt_host, MQTT_PORT);
    LOG_I(TAG, "Backend : %s:%d", g_cfg.backend_host, g_cfg.backend_port);
    LOG_I(TAG, "Has AC  : %s (brand: %s)", g_cfg.has_ac  ? "yes" : "no", g_cfg.ac_brand);
    LOG_I(TAG, "Has Lamp: %s", g_cfg.has_lamp ? "yes" : "no");

    // Init AC manager (jika ada AC)
    ir_brand_t brand = ir_brand_from_string(g_cfg.ac_brand);
    if (g_cfg.has_ac) {
        ac_manager_init(brand, g_ir_cmd_queue);
        // Set carrier sesuai brand
        ir_driver_tx_set_carrier(ir_brand_carrier_hz(brand));
    }

    // Init lamp manager (jika ada lamp)
    if (g_cfg.has_lamp) {
        lamp_manager_init();
        lamp_manager_set_state_callback(on_lamp_state_changed);
    }

    // Init schedule manager
    schedule_manager_init();
    schedule_manager_set_callbacks(
        g_cfg.has_ac   ? on_ac_command    : NULL,
        g_cfg.has_lamp ? on_schedule_lamp : NULL
    );

    // BLE tidak di-init — hanya saat button ditekan
    s_ble_initialized = false;
    button_manager_start(on_ble_prov_requested);

    xTaskCreatePinnedToCore(ble_monitor_task, "ble_monitor",
                             4096, NULL, 4, NULL, 1);

    // PIR sensor (jika ada lamp)
    if (g_cfg.has_lamp) {
        pir_sensor_init();
        pir_sensor_start(on_pir_motion);
    }

    // OTA manager
    ota_manager_init();

    // Init MQTT
    mqtt_manager_init(g_cfg.mqtt_host, MQTT_PORT,
                       g_device_name, g_device_mac,
                       g_cfg.has_ac, g_cfg.has_lamp);

    mqtt_manager_set_ac_callback(on_ac_command);
    mqtt_manager_set_lamp_callback(on_lamp_command);
    mqtt_manager_set_schedule_callback(on_schedule);
    mqtt_manager_set_ota_callback(ota_manager_trigger);
    mqtt_manager_set_ir_learn_callback(on_ir_learn);

    // Start WiFi
    wifi_manager_start(g_cfg.ssid, g_cfg.password);

    // Tunggu WiFi
    LOG_I(TAG, "Waiting for WiFi...");
    EventBits_t bits = xEventGroupWaitBits(
        g_system_events, SYS_EVENT_WIFI_CONNECTED,
        pdFALSE, pdTRUE, pdMS_TO_TICKS(30000));

    if (bits & SYS_EVENT_WIFI_CONNECTED) {
        LOG_I(TAG, "WiFi connected");
        init_ntp();
        register_to_backend();
    } else {
        LOG_W(TAG, "WiFi timeout — continuing");
    }

    // Start MQTT
    mqtt_manager_start();

    // Publish initial state setelah MQTT connect
    xTaskCreatePinnedToCore(initial_publish_task, "init_pub",
                             4096, NULL, 3, NULL, 0);

    // Start IR command task
    if (g_cfg.has_ac) {
        xTaskCreatePinnedToCore(ir_task, "ir_task",
                                 4096, NULL, 5, NULL, 1);
    }

    // Start heartbeat task
    xTaskCreatePinnedToCore(heartbeat_task, "heartbeat",
                             HEARTBEAT_TASK_STACK, NULL,
                             HEARTBEAT_TASK_PRIORITY, NULL, 0);

    // Start schedule task
    xTaskCreatePinnedToCore(schedule_task, "schedule",
                             SCHEDULE_TASK_STACK, NULL,
                             SCHEDULE_TASK_PRIORITY, NULL, 0);

    LOG_I(TAG, "All systems started!");
    printf("\n========================================\n");
    printf("  SYSTEM READY\n");
    printf("  Device : %s\n", g_device_name);
    printf("  Heap   : %lu bytes\n", (unsigned long)esp_get_free_heap_size());
    printf("========================================\n\n");

    // Main loop — stats periodik
    while (true) {
        vTaskDelay(pdMS_TO_TICKS(60000));
        LOG_I(TAG, "=== STATS ===");
        LOG_I(TAG, "Uptime: %lu s",
              (unsigned long)(xTaskGetTickCount() * portTICK_PERIOD_MS / 1000));
        LOG_I(TAG, "Heap  : %lu bytes",
              (unsigned long)esp_get_free_heap_size());
        LOG_I(TAG, "RSSI  : %d dBm", wifi_manager_get_rssi());
        LOG_I(TAG, "IR Q  : %d/%d",
              (int)uxQueueMessagesWaiting(g_ir_cmd_queue), IR_CMD_QUEUE_SIZE);
    }
}
