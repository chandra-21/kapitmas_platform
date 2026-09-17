#include "device_provisioning.h"
#include "logger.h"
#include "app_config.h"

#include "esp_http_client.h"
#include "esp_mac.h"
#include "cJSON.h"
#include <string.h>
#include <stdio.h>

static const char* TAG = "Provisioning";

static char s_response_buf[512] = {0};
static int  s_response_len      = 0;

static esp_err_t http_event_handler(esp_http_client_event_t* evt) {
    switch (evt->event_id) {
        case HTTP_EVENT_ON_DATA:
            if (s_response_len + evt->data_len < sizeof(s_response_buf)) {
                memcpy(s_response_buf + s_response_len,
                       evt->data, evt->data_len);
                s_response_len += evt->data_len;
            }
            break;
        default:
            break;
    }
    return ESP_OK;
}

bool device_provisioning_register(const device_config_t* cfg, const char* ip) {
    if (!cfg || strlen(cfg->backend_host) == 0) {
        LOG_W(TAG, "No backend host configured, skip registration");
        return false;
    }

    // Build URL — handle both "192.168.x.x" and "http://192.168.x.x:port"
    char url[256];
    const char* host = cfg->backend_host;
    if (strncmp(host, "http://", 7) == 0 || strncmp(host, "https://", 8) == 0) {
        snprintf(url, sizeof(url), "%s%s", host, PROV_REGISTER_PATH);
    } else {
        int port = cfg->backend_port > 0 ? cfg->backend_port : 8000;
        snprintf(url, sizeof(url), "http://%s:%d%s", host, port, PROV_REGISTER_PATH);
    }

    // Get MAC address
    uint8_t mac[6];
    esp_read_mac(mac, ESP_MAC_WIFI_STA);
    char mac_str[18];
    snprintf(mac_str, sizeof(mac_str),
             "%02X:%02X:%02X:%02X:%02X:%02X",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);

    // Build JSON payload
    cJSON* json = cJSON_CreateObject();
    cJSON_AddStringToObject(json, "mac",      mac_str);
    cJSON_AddStringToObject(json, "name",     cfg->device_name);
    cJSON_AddStringToObject(json, "type",     DEVICE_TYPE);
    cJSON_AddStringToObject(json, "location", "");
    cJSON_AddStringToObject(json, "firmware", FIRMWARE_VERSION);
    cJSON_AddStringToObject(json, "chip",     DEVICE_CHIP);
    cJSON_AddStringToObject(json, "ip",       ip ? ip : "");

    char* payload = cJSON_PrintUnformatted(json);
    cJSON_Delete(json);

    if (!payload) {
        LOG_E(TAG, "Failed to create JSON payload");
        return false;
    }

    LOG_I(TAG, "Registering to: %s", url);
    LOG_I(TAG, "Payload: %s", payload);

    // HTTP POST
    memset(s_response_buf, 0, sizeof(s_response_buf));
    s_response_len = 0;

    esp_http_client_config_t http_cfg = {};
    http_cfg.url            = url;
    http_cfg.method         = HTTP_METHOD_POST;
    http_cfg.timeout_ms     = PROV_HTTP_TIMEOUT_MS;
    http_cfg.event_handler  = http_event_handler;

    esp_http_client_handle_t client = esp_http_client_init(&http_cfg);
    if (!client) {
        LOG_E(TAG, "Failed to init HTTP client — URL may be invalid: %s", url);
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
        LOG_I(TAG, "HTTP status: %d", status);
        LOG_I(TAG, "Response: %s", s_response_buf);

        if (status == 200 || status == 201) {
            success = true;
            LOG_I(TAG, "Device registered successfully");
        } else {
            LOG_W(TAG, "Registration failed with status: %d", status);
        }
    } else {
        LOG_E(TAG, "HTTP request failed: %s", esp_err_to_name(err));
    }

    esp_http_client_cleanup(client);
    return success;
}