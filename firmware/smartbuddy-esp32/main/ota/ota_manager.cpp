#include "ota_manager.h"
#include "logger.h"
#include "app_config.h"
#include "app_types.h"

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/event_groups.h"
#include "esp_https_ota.h"
#include "esp_http_client.h"
#include "esp_ota_ops.h"
#include "esp_system.h"
#include <string.h>

static const char* TAG = "OTA";

#define OTA_URL_MAX_LEN 512

static volatile bool s_ota_running = false;
static char          s_ota_url[OTA_URL_MAX_LEN] = {0};

extern EventGroupHandle_t g_system_events;

static void ota_task(void* arg) {
    LOG_I(TAG, "Starting OTA: %s", s_ota_url);
    xEventGroupSetBits(g_system_events, SYS_EVENT_OTA_IN_PROGRESS);

    esp_http_client_config_t http_cfg = {};
    http_cfg.url              = s_ota_url;
    http_cfg.timeout_ms       = 30000;
    http_cfg.keep_alive_enable = true;

    esp_https_ota_config_t ota_cfg = {};
    ota_cfg.http_config = &http_cfg;

    esp_err_t ret = esp_https_ota(&ota_cfg);

    if (ret == ESP_OK) {
        LOG_I(TAG, "OTA success — restarting...");
        vTaskDelay(pdMS_TO_TICKS(1000));
        esp_restart();
    } else {
        LOG_E(TAG, "OTA failed: %s", esp_err_to_name(ret));
        xEventGroupClearBits(g_system_events, SYS_EVENT_OTA_IN_PROGRESS);
        s_ota_running = false;
    }

    vTaskDelete(NULL);
}

void ota_manager_init(void) {
    const esp_partition_t* running = esp_ota_get_running_partition();
    LOG_I(TAG, "Running partition: %s — OTA ready", running->label);
}

void ota_manager_trigger(const char* url) {
    if (s_ota_running) { LOG_W(TAG, "OTA already running"); return; }
    if (!url || strlen(url) == 0) { LOG_E(TAG, "Invalid OTA URL"); return; }

    strncpy(s_ota_url, url, sizeof(s_ota_url) - 1);
    s_ota_running = true;

    xTaskCreatePinnedToCore(ota_task, "ota_task",
                             OTA_TASK_STACK, NULL,
                             OTA_TASK_PRIORITY, NULL, 1);
    LOG_I(TAG, "OTA triggered: %s", url);
}

bool ota_manager_is_running(void) { return s_ota_running; }
