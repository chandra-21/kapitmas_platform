#include "mqtt_manager.h"
#include "logger.h"
#include "app_config.h"

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/event_groups.h"
#include "freertos/semphr.h"
#include "mqtt_client.h"
#include "esp_wifi.h"
#include "esp_netif.h"
#include "cJSON.h"
#include <string.h>
#include <stdio.h>

static const char* TAG = "MQTT";

extern EventGroupHandle_t g_system_events;

// ==================== STATE ====================

static esp_mqtt_client_handle_t s_client  = NULL;
static mqtt_state_t              s_state   = MQTT_STATE_DISCONNECTED;
static SemaphoreHandle_t         s_pub_mtx = NULL;

static char s_device_name[32] = {0};
static char s_device_mac[18]  = {0};
static bool s_has_ac          = false;
static bool s_has_lamp        = false;

// Topics (built at init)
static char t_ac_control[96]  = {0};
static char t_ac_sync[96]     = {0};
static char t_lamp_control[96]= {0};
static char t_lamp_sync[96]   = {0};
static char t_schedule[96]    = {0};
static char t_ir_learn[96]    = {0};
static char t_ota[96]         = {0};
static char t_status[96]      = {0};
static char t_heartbeat[96]   = {0};
static char t_capabilities[96]= {0};
static char t_ac_state[96]    = {0};
static char t_lamp_state[96]  = {0};
static char t_pir[96]         = {0};
static char t_ir_result[96]   = {0};

// Callbacks
static void (*s_ac_cb)(const ac_state_t*)                    = NULL;
static void (*s_lamp_cb)(bool, lamp_mode_t, uint32_t)        = NULL;
static void (*s_schedule_cb)(const char*)                     = NULL;
static void (*s_ota_cb)(const char*)                          = NULL;
static void (*s_ir_learn_cb)(const char*)                     = NULL;

// Reconnect tracking
static uint32_t s_reconnect_count  = 0;
static uint32_t s_reconnect_window = 0;
static uint32_t s_last_connect_ms  = 0;

// ==================== TOPIC BUILDER ====================

static void build_topics(const char* device_name) {
    char base[80];
    snprintf(base, sizeof(base), "%s/%s", MQTT_TOPIC_PREFIX, device_name);

    snprintf(t_ac_control,  sizeof(t_ac_control),  "%s/ac/control",   base);
    snprintf(t_ac_sync,     sizeof(t_ac_sync),      "%s/ac/sync",      base);
    snprintf(t_lamp_control,sizeof(t_lamp_control), "%s/lamp/control", base);
    snprintf(t_lamp_sync,   sizeof(t_lamp_sync),    "%s/lamp/sync",    base);
    snprintf(t_schedule,    sizeof(t_schedule),     "%s/schedule",     base);
    snprintf(t_ir_learn,    sizeof(t_ir_learn),     "%s/ir/learn",     base);
    snprintf(t_ota,         sizeof(t_ota),          "%s/ota",          base);
    snprintf(t_status,      sizeof(t_status),       "%s/status",       base);
    snprintf(t_heartbeat,   sizeof(t_heartbeat),    "%s/heartbeat",    base);
    snprintf(t_capabilities,sizeof(t_capabilities), "%s/capabilities", base);
    snprintf(t_ac_state,    sizeof(t_ac_state),     "%s/ac/state",     base);
    snprintf(t_lamp_state,  sizeof(t_lamp_state),   "%s/lamp/state",   base);
    snprintf(t_pir,         sizeof(t_pir),          "%s/lamp/pir",     base);
    snprintf(t_ir_result,   sizeof(t_ir_result),    "%s/ir/result",    base);
}

// ==================== MESSAGE HANDLER ====================

static void parse_ac_command(const char* data) {
    if (!s_ac_cb) return;
    cJSON* json = cJSON_Parse(data);
    if (!json) return;

    ac_state_t cmd = {};
    cJSON* p = cJSON_GetObjectItem(json, "power");
    cJSON* m = cJSON_GetObjectItem(json, "mode");
    cJSON* t = cJSON_GetObjectItem(json, "temp");
    cJSON* f = cJSON_GetObjectItem(json, "fan");
    cJSON* s = cJSON_GetObjectItem(json, "swing_v");

    if (p) cmd.power   = cJSON_IsTrue(p);
    if (m && cJSON_IsNumber(m)) cmd.mode    = (ac_mode_t)m->valueint;
    if (t && cJSON_IsNumber(t)) cmd.temp    = (uint8_t)t->valueint;
    if (f && cJSON_IsNumber(f)) cmd.fan     = (ac_fan_t)f->valueint;
    if (s) cmd.swing_v = cJSON_IsTrue(s);

    // Validasi temp
    if (cmd.temp < 16 || cmd.temp > 30) cmd.temp = 25;

    cJSON_Delete(json);
    s_ac_cb(&cmd);
}

static void parse_lamp_command(const char* data) {
    if (!s_lamp_cb) return;
    cJSON* json = cJSON_Parse(data);
    if (!json) return;

    bool      power   = false;
    lamp_mode_t mode  = LAMP_MODE_MANUAL;
    uint32_t timeout  = 0;

    cJSON* p = cJSON_GetObjectItem(json, "power");
    cJSON* m = cJSON_GetObjectItem(json, "mode");
    cJSON* t = cJSON_GetObjectItem(json, "pir_timeout");

    if (p) power = cJSON_IsTrue(p);
    if (m && cJSON_IsNumber(m)) mode = (lamp_mode_t)m->valueint;
    if (t && cJSON_IsNumber(t)) timeout = (uint32_t)(t->valuedouble * 1000);

    cJSON_Delete(json);
    s_lamp_cb(power, mode, timeout);
}

static void on_message(const char* topic, const char* data) {
    LOG_D(TAG, "MSG [%s]: %.100s", topic, data);

    if (strcmp(topic, t_ac_control) == 0 ||
        strcmp(topic, t_ac_sync)    == 0) {
        parse_ac_command(data);
    } else if (strcmp(topic, t_lamp_control) == 0 ||
               strcmp(topic, t_lamp_sync)    == 0) {
        parse_lamp_command(data);
    } else if (strcmp(topic, t_schedule) == 0) {
        if (s_schedule_cb) s_schedule_cb(data);
    } else if (strcmp(topic, t_ota) == 0) {
        cJSON* json = cJSON_Parse(data);
        if (json) {
            cJSON* url = cJSON_GetObjectItem(json, "url");
            if (url && cJSON_IsString(url) && s_ota_cb) {
                s_ota_cb(url->valuestring);
            }
            cJSON_Delete(json);
        }
    } else if (strcmp(topic, t_ir_learn) == 0) {
        cJSON* json = cJSON_Parse(data);
        if (json) {
            cJSON* slot = cJSON_GetObjectItem(json, "slot");
            if (slot && cJSON_IsString(slot) && s_ir_learn_cb) {
                s_ir_learn_cb(slot->valuestring);
            }
            cJSON_Delete(json);
        }
    }
}

// ==================== MQTT EVENT HANDLER ====================

static void mqtt_event_handler(void* arg, esp_event_base_t base,
                                 int32_t event_id, void* event_data) {
    esp_mqtt_event_handle_t event = (esp_mqtt_event_handle_t)event_data;

    switch ((esp_mqtt_event_id_t)event_id) {
        case MQTT_EVENT_CONNECTED:
            LOG_I(TAG, "Connected");
            s_state = MQTT_STATE_CONNECTED;
            s_reconnect_count = 0;
            s_last_connect_ms = xTaskGetTickCount() * portTICK_PERIOD_MS;
            xEventGroupSetBits(g_system_events, SYS_EVENT_MQTT_CONNECTED);

            // Subscribe ke topics yang relevan
            if (s_has_ac) {
                esp_mqtt_client_subscribe(s_client, t_ac_control, 1);
                esp_mqtt_client_subscribe(s_client, t_ac_sync,    1);
            }
            if (s_has_lamp) {
                esp_mqtt_client_subscribe(s_client, t_lamp_control, 1);
                esp_mqtt_client_subscribe(s_client, t_lamp_sync,    1);
            }
            esp_mqtt_client_subscribe(s_client, t_schedule, 1);
            esp_mqtt_client_subscribe(s_client, t_ota,      1);
            esp_mqtt_client_subscribe(s_client, t_ir_learn, 1);
            break;

        case MQTT_EVENT_DISCONNECTED: {
            LOG_W(TAG, "Disconnected");
            s_state = MQTT_STATE_DISCONNECTED;
            xEventGroupClearBits(g_system_events, SYS_EVENT_MQTT_CONNECTED);
            s_reconnect_count++;

            uint32_t now = xTaskGetTickCount() * portTICK_PERIOD_MS;
            if ((now - s_reconnect_window) > MQTT_RECONNECT_WINDOW_MS) {
                s_reconnect_window = now;
                s_reconnect_count  = 0;
            }
            if (s_reconnect_count > MQTT_MAX_RECONNECTS) {
                LOG_E(TAG, "Too many reconnects — restarting");
                vTaskDelay(pdMS_TO_TICKS(1000));
                esp_restart();
            }
            break;
        }

        case MQTT_EVENT_DATA: {
            char topic[128] = {0};
            char data[512]  = {0};
            int  tlen = event->topic_len  < 127 ? event->topic_len  : 127;
            int  dlen = event->data_len   < 511 ? event->data_len   : 511;
            memcpy(topic, event->topic, tlen);
            memcpy(data,  event->data,  dlen);
            on_message(topic, data);
            break;
        }

        case MQTT_EVENT_ERROR:
            LOG_E(TAG, "MQTT error type: %d",
                  event->error_handle ? event->error_handle->error_type : -1);
            break;

        // Explicitly handle remaining enum values to satisfy -Werror=switch
        case MQTT_EVENT_ANY:
        case MQTT_EVENT_SUBSCRIBED:
        case MQTT_EVENT_UNSUBSCRIBED:
        case MQTT_EVENT_PUBLISHED:
        case MQTT_EVENT_BEFORE_CONNECT:
        case MQTT_EVENT_DELETED:
        case MQTT_USER_EVENT:
            break;
    }
}

// ==================== PUBLIC API ====================

void mqtt_manager_init(const char* host, int port,
                        const char* device_name, const char* device_mac,
                        bool has_ac, bool has_lamp) {
    strncpy(s_device_name, device_name, sizeof(s_device_name) - 1);
    strncpy(s_device_mac,  device_mac,  sizeof(s_device_mac)  - 1);
    s_has_ac   = has_ac;
    s_has_lamp = has_lamp;

    build_topics(device_name);

    s_pub_mtx = xSemaphoreCreateMutex();

    // LWT — auto-publish "offline" jika koneksi putus mendadak
    char lwt_payload[128];
    snprintf(lwt_payload, sizeof(lwt_payload),
             "{\"name\":\"%s\",\"status\":\"offline\"}", device_name);

    char broker_uri[128];
    snprintf(broker_uri, sizeof(broker_uri), "mqtt://%s:%d", host, port);

    esp_mqtt_client_config_t cfg = {};
    cfg.broker.address.uri          = broker_uri;
    cfg.session.keepalive           = MQTT_KEEPALIVE_SEC;
    cfg.session.last_will.topic     = t_status;
    cfg.session.last_will.msg       = lwt_payload;
    cfg.session.last_will.msg_len   = strlen(lwt_payload);
    cfg.session.last_will.qos       = 1;
    cfg.session.last_will.retain    = 1;
    cfg.network.timeout_ms          = MQTT_NETWORK_TIMEOUT_MS;
    cfg.buffer.size                 = MQTT_BUFFER_SIZE;

    s_client = esp_mqtt_client_init(&cfg);
    esp_mqtt_client_register_event(s_client, MQTT_EVENT_ANY,
                                    mqtt_event_handler, NULL);

    LOG_I(TAG, "MQTT init: %s (device: %s)", broker_uri, device_name);
}

void mqtt_manager_start(void) {
    if (s_client) {
        esp_mqtt_client_start(s_client);
        s_state = MQTT_STATE_CONNECTING;
        LOG_I(TAG, "MQTT started");
    }
}

mqtt_state_t mqtt_manager_get_state(void) { return s_state; }

bool mqtt_manager_publish(const char* topic, const char* payload, int qos, bool retain) {
    if (!s_client || s_state != MQTT_STATE_CONNECTED) return false;

    if (!xSemaphoreTake(s_pub_mtx, pdMS_TO_TICKS(500))) return false;

    int msg_id = esp_mqtt_client_publish(s_client, topic, payload,
                                          strlen(payload), qos, retain ? 1 : 0);
    xSemaphoreGive(s_pub_mtx);

    return (msg_id >= 0);
}

void mqtt_manager_publish_status(const char* status) {
    char ip[16] = {0};
    esp_netif_ip_info_t ip_info;
    esp_netif_t* netif = esp_netif_get_handle_from_ifkey("WIFI_STA_DEF");
    if (netif && esp_netif_get_ip_info(netif, &ip_info) == ESP_OK) {
        snprintf(ip, sizeof(ip), IPSTR, IP2STR(&ip_info.ip));
    }

    char payload[256];
    snprintf(payload, sizeof(payload),
             "{\"name\":\"%s\",\"mac\":\"%s\",\"status\":\"%s\","
             "\"firmware\":\"%s\",\"ip\":\"%s\",\"rssi\":%d}",
             s_device_name, s_device_mac, status,
             FIRMWARE_VERSION, ip, (int)0);

    int rssi = 0;
    esp_wifi_sta_get_rssi(&rssi);
    // rebuild with real rssi
    snprintf(payload, sizeof(payload),
             "{\"name\":\"%s\",\"mac\":\"%s\",\"status\":\"%s\","
             "\"firmware\":\"%s\",\"ip\":\"%s\",\"rssi\":%d}",
             s_device_name, s_device_mac, status,
             FIRMWARE_VERSION, ip, rssi);

    mqtt_manager_publish(t_status, payload, 1, true);
}

void mqtt_manager_publish_heartbeat(void) {
    char payload[128];
    int rssi = 0;
    esp_wifi_sta_get_rssi(&rssi);
    snprintf(payload, sizeof(payload),
             "{\"name\":\"%s\",\"status\":\"alive\","
             "\"uptime\":%lu,\"heap\":%lu,\"rssi\":%d,\"firmware\":\"%s\"}",
             s_device_name,
             (unsigned long)(xTaskGetTickCount() * portTICK_PERIOD_MS / 1000),
             (unsigned long)esp_get_free_heap_size(),
             rssi, FIRMWARE_VERSION);
    mqtt_manager_publish(t_heartbeat, payload, 0, false);
}

void mqtt_manager_publish_capabilities(bool has_ac, bool has_lamp,
                                        const char* ac_brand) {
    char payload[256];
    snprintf(payload, sizeof(payload),
             "{\"name\":\"%s\",\"firmware\":\"%s\","
             "\"has_ac\":%s,\"has_lamp\":%s,\"ac_brand\":\"%s\"}",
             s_device_name, FIRMWARE_VERSION,
             has_ac   ? "true" : "false",
             has_lamp ? "true" : "false",
             ac_brand ? ac_brand : "");
    mqtt_manager_publish(t_capabilities, payload, 0, true);
}

void mqtt_manager_publish_ac_state(const ac_state_t* state) {
    if (!state) return;
    char payload[256];
    snprintf(payload, sizeof(payload),
             "{\"name\":\"%s\",\"power\":%s,\"mode\":%d,"
             "\"temp\":%d,\"fan\":%d,\"swing_v\":%s}",
             s_device_name,
             state->power   ? "true" : "false",
             state->mode, state->temp, state->fan,
             state->swing_v ? "true" : "false");
    mqtt_manager_publish(t_ac_state, payload, 0, true);
}

void mqtt_manager_publish_lamp_state(const lamp_state_t* state) {
    if (!state) return;
    char payload[256];
    snprintf(payload, sizeof(payload),
             "{\"name\":\"%s\",\"power\":%s,\"mode\":%d,"
             "\"pir_motion\":%s,\"pir_timeout\":%lu}",
             s_device_name,
             state->power      ? "true" : "false",
             state->mode,
             state->pir_motion ? "true" : "false",
             (unsigned long)(state->pir_timeout_ms / 1000));
    mqtt_manager_publish(t_lamp_state, payload, 0, true);
}

void mqtt_manager_publish_pir(bool motion) {
    char payload[128];
    snprintf(payload, sizeof(payload),
             "{\"name\":\"%s\",\"motion\":%s}",
             s_device_name, motion ? "true" : "false");
    mqtt_manager_publish(t_pir, payload, 0, false);
}

void mqtt_manager_publish_ir_learn_result(const char* slot, bool success,
                                           const uint16_t* timings, size_t count) {
    cJSON* root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "name",    s_device_name);
    cJSON_AddStringToObject(root, "slot",    slot ? slot : "");
    cJSON_AddBoolToObject  (root, "success", success);

    if (success && timings && count > 0) {
        cJSON* arr = cJSON_CreateArray();
        for (size_t i = 0; i < count && i < 256; i++) {
            cJSON_AddItemToArray(arr, cJSON_CreateNumber(timings[i]));
        }
        cJSON_AddItemToObject(root, "timings", arr);
    }

    char* payload = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);

    if (payload) {
        mqtt_manager_publish(t_ir_result, payload, 1, false);
        free(payload);
    }
}

void mqtt_manager_set_ac_callback(void (*cb)(const ac_state_t*))          { s_ac_cb       = cb; }
void mqtt_manager_set_lamp_callback(void (*cb)(bool, lamp_mode_t, uint32_t)) { s_lamp_cb   = cb; }
void mqtt_manager_set_schedule_callback(void (*cb)(const char*))           { s_schedule_cb = cb; }
void mqtt_manager_set_ota_callback(void (*cb)(const char*))                { s_ota_cb      = cb; }
void mqtt_manager_set_ir_learn_callback(void (*cb)(const char*))           { s_ir_learn_cb = cb; }
