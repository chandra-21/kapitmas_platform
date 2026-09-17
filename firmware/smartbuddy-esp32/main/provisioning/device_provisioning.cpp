#include "device_provisioning.h"
#include "logger.h"
#include "app_config.h"

#include "esp_http_client.h"
#include "cJSON.h"
#include <string.h>
#include <stdio.h>

static const char* TAG = "Provisioning";

static char s_response_buf[512] = {0};
static int  s_response_len      = 0;

static esp_err_t http_event_handler(esp_http_client_event_t* evt) {
    if (evt->event_id == HTTP_EVENT_ON_DATA) {
        if (s_response_len + evt->data_len < (int)sizeof(s_response_buf)) {
            memcpy(s_response_buf + s_response_len, evt->data, evt->data_len);
            s_response_len += evt->data_len;
        }
    }
    return ESP_OK;
}

bool device_provisioning_register(const device_config_t* cfg, const char* ip,
                                   const char* mac_str) {
    if (!cfg || strlen(cfg->backend_host) == 0) {
        LOG_W(TAG, "No backend host — skipping registration");
        return false;
    }

    char url[256];
    const char* host = cfg->backend_host;
    if (strncmp(host, "http://", 7) == 0 || strncmp(host, "https://", 8) == 0) {
        snprintf(url, sizeof(url), "%s%s", host, PROV_REGISTER_PATH);
    } else {
        int port = cfg->backend_port > 0 ? cfg->backend_port : 8000;
        snprintf(url, sizeof(url), "http://%s:%d%s", host, port, PROV_REGISTER_PATH);
    }

    // Build JSON payload dengan SmartBuddy fields
    cJSON* json = cJSON_CreateObject();
    cJSON_AddStringToObject(json, "mac",      mac_str ? mac_str : "");
    cJSON_AddStringToObject(json, "name",     cfg->device_name);
    cJSON_AddStringToObject(json, "type",     DEVICE_TYPE);
    cJSON_AddStringToObject(json, "room_id",  cfg->room_id);
    cJSON_AddStringToObject(json, "firmware", FIRMWARE_VERSION);
    cJSON_AddStringToObject(json, "chip",     "ESP32");
    cJSON_AddStringToObject(json, "ip",       ip ? ip : "");
    cJSON_AddBoolToObject  (json, "has_ac",   cfg->has_ac);
    cJSON_AddBoolToObject  (json, "has_lamp", cfg->has_lamp);
    cJSON_AddStringToObject(json, "ac_brand", cfg->ac_brand);

    char* payload = cJSON_PrintUnformatted(json);
    cJSON_Delete(json);

    if (!payload) {
        LOG_E(TAG, "Failed to build payload");
        return false;
    }

    LOG_I(TAG, "Registering: %s", url);
    LOG_D(TAG, "Payload: %s", payload);

    memset(s_response_buf, 0, sizeof(s_response_buf));
    s_response_len = 0;

    esp_http_client_config_t http_cfg = {};
    http_cfg.url           = url;
    http_cfg.method        = HTTP_METHOD_POST;
    http_cfg.timeout_ms    = PROV_HTTP_TIMEOUT_MS;
    http_cfg.event_handler = http_event_handler;

    esp_http_client_handle_t client = esp_http_client_init(&http_cfg);
    if (!client) {
        LOG_E(TAG, "HTTP init failed");
        free(payload);
        return false;
    }

    esp_http_client_set_header(client, "Content-Type", "application/json");
    esp_http_client_set_post_field(client, payload, strlen(payload));

    esp_err_t err = esp_http_client_perform(client);
    free(payload);

    bool success = false;
    if (err == ESP_OK) {
        int status = esp_http_client_get_status_code(client);
        LOG_I(TAG, "HTTP %d: %s", status, s_response_buf);
        success = (status == 200 || status == 201);
    } else {
        LOG_E(TAG, "HTTP error: %s", esp_err_to_name(err));
    }

    esp_http_client_cleanup(client);
    return success;
}
