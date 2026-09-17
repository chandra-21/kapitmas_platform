#include "mqtt_manager.h"
#include "logger.h"

#include "esp_idf_version.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/event_groups.h"
#include "mqtt_client.h"
#include "cJSON.h"
#include "esp_timer.h"
#include <string.h>
#include <stdio.h>

static const char* TAG = "MQTT";

static esp_mqtt_client_handle_t s_client        = NULL;
static mqtt_state_t             s_state         = MQTT_STATE_DISCONNECTED;
static TickType_t               s_disconnect_at = 0;
static char s_device_name[32]  = {0};
static char s_device_mac[18]   = {0};
static char s_topic_weight[96] = {0};
static char s_topic_status[96] = {0};
static char s_topic_ota[96]    = {0};

static void (*s_ota_callback)(const char* url) = NULL;

static uint32_t   s_reconnect_count    = 0;
static TickType_t s_window_start_tick  = 0;

extern EventGroupHandle_t g_system_events;

// ==================== HELPER ====================

static void make_safe_name(const char* name, char* out, size_t len) {
    strncpy(out, name, len - 1);
    out[len - 1] = '\0';
    for (int i = 0; out[i]; i++) {
        if (out[i] == ' ' || out[i] == '#' ||
            out[i] == '+' || out[i] == '/') {
            out[i] = '_';
        }
    }
}

static void publish_status(const char* status) {
    if (s_state != MQTT_STATE_CONNECTED) return;

    char payload[256];
    snprintf(payload, sizeof(payload),
        "{\"name\":\"%s\",\"mac\":\"%s\",\"status\":\"%s\","
        "\"firmware\":\"%s\",\"heap\":%lu}",
        s_device_name, s_device_mac, status, FIRMWARE_VERSION,
        (unsigned long)esp_get_free_heap_size());

    esp_mqtt_client_publish(s_client, s_topic_status, payload, 0, 0, 1);
}

// ==================== EVENT HANDLER ====================

static void mqtt_event_handler(void* arg, esp_event_base_t base,
                                int32_t event_id, void* event_data) {
    esp_mqtt_event_handle_t event = (esp_mqtt_event_handle_t)event_data;

    switch (event->event_id) {

        case MQTT_EVENT_CONNECTED:
            LOG_I(TAG, "Connected");
            s_state = MQTT_STATE_CONNECTED;

            if (s_window_start_tick != 0) {
                uint32_t elapsed_ms = (xTaskGetTickCount() - s_window_start_tick) * portTICK_PERIOD_MS;
                if (elapsed_ms > MQTT_RECONNECT_WINDOW_MS) {
                    s_reconnect_count   = 0;
                    s_window_start_tick = 0;
                } else {
                    s_reconnect_count++;
                    LOG_W(TAG, "Reconnect #%lu dalam %lu s",
                          (unsigned long)s_reconnect_count, elapsed_ms / 1000);
                    if (s_reconnect_count >= MQTT_MAX_RECONNECTS) {
                        LOG_E(TAG, "Terlalu banyak reconnect (%lu kali dalam %lu s) — restart",
                              (unsigned long)s_reconnect_count, elapsed_ms / 1000);
                        vTaskDelay(pdMS_TO_TICKS(500));
                        esp_restart();
                    }
                }
            }

            s_disconnect_at = 0;
            xEventGroupSetBits(g_system_events, SYS_EVENT_MQTT_CONNECTED);
            xEventGroupClearBits(g_system_events, SYS_EVENT_MQTT_DISCONNECTED);

            esp_mqtt_client_subscribe(s_client, s_topic_ota, 0);
            LOG_I(TAG, "Subscribed OTA: %s", s_topic_ota);

            publish_status("online");
            break;

        case MQTT_EVENT_DISCONNECTED:
            LOG_W(TAG, "Disconnected");
            s_state = MQTT_STATE_DISCONNECTED;
            s_disconnect_at = xTaskGetTickCount();
            if (s_window_start_tick == 0) {
                s_window_start_tick = xTaskGetTickCount();
            }
            xEventGroupClearBits(g_system_events, SYS_EVENT_MQTT_CONNECTED);
            xEventGroupSetBits(g_system_events, SYS_EVENT_MQTT_DISCONNECTED);
            break;

        case MQTT_EVENT_DATA:
            if (event->topic_len > 0) {
                char topic[128]   = {0};
                char payload[512] = {0};

                strncpy(topic, event->topic,
                    (event->topic_len < 127) ? event->topic_len : 127);
                strncpy(payload, event->data,
                    (event->data_len < 511) ? event->data_len : 511);

                LOG_I(TAG, "Message: %s", topic);

                if (strcmp(topic, s_topic_ota) == 0 && s_ota_callback) {
                    cJSON* json = cJSON_Parse(payload);
                    if (json) {
                        cJSON* url = cJSON_GetObjectItem(json, "url");
                        if (url && cJSON_IsString(url)) {
                            LOG_I(TAG, "OTA URL: %s", url->valuestring);
                            s_ota_callback(url->valuestring);
                        }
                        cJSON_Delete(json);
                    }
                }
            }
            break;

        case MQTT_EVENT_ERROR:
            LOG_E(TAG, "Error");
            s_state = MQTT_STATE_ERROR;
            break;

        default:
            break;
    }
}

// ==================== PUBLIC API ====================

void mqtt_manager_init(const char* host, int port, const char* device_name, const char* device_mac) {
    strncpy(s_device_name, device_name, sizeof(s_device_name) - 1);
    strncpy(s_device_mac,  device_mac,  sizeof(s_device_mac)  - 1);

    // Build topics — format baru: kapitmas/timbangan/{name}/{subtopic}
    char safe_name[32] = {0};
    make_safe_name(device_name, safe_name, sizeof(safe_name));

    snprintf(s_topic_weight, sizeof(s_topic_weight),
             "%s/%s/weight", MQTT_TOPIC_PREFIX, safe_name);
    snprintf(s_topic_status, sizeof(s_topic_status),
             "%s/%s/status", MQTT_TOPIC_PREFIX, safe_name);
    snprintf(s_topic_ota,    sizeof(s_topic_ota),
             "%s/%s", MQTT_TOPIC_OTA_PREFIX, safe_name);

    LOG_I(TAG, "Topics:");
    LOG_I(TAG, "  weight: %s", s_topic_weight);
    LOG_I(TAG, "  status: %s", s_topic_status);
    LOG_I(TAG, "  ota:    %s", s_topic_ota);

    char uri[128];
    snprintf(uri, sizeof(uri), "mqtt://%s:%d", host, port);

    char lwt_payload[128];
    snprintf(lwt_payload, sizeof(lwt_payload),
             "{\"name\":\"%s\",\"mac\":\"%s\",\"status\":\"offline\"}",
             device_name, s_device_mac);

    esp_mqtt_client_config_t mqtt_cfg          = {};
    mqtt_cfg.broker.address.uri                = uri;
    mqtt_cfg.credentials.client_id             = device_name;
    mqtt_cfg.session.keepalive                 = MQTT_KEEPALIVE_SEC;
    mqtt_cfg.session.last_will.topic           = s_topic_status;
    mqtt_cfg.session.last_will.msg             = lwt_payload;
    mqtt_cfg.session.last_will.qos             = 1;
    mqtt_cfg.session.last_will.retain          = 1;
    mqtt_cfg.network.reconnect_timeout_ms      = MQTT_RECONNECT_BASE_MS;
    mqtt_cfg.network.timeout_ms                = MQTT_NETWORK_TIMEOUT_MS;
    // Force reconnect setiap 15 menit agar tidak terjebak half-open TCP connection
    // (NAT/broker biasanya expire session setelah ~20 menit tanpa TCP-level keepalive)
    mqtt_cfg.network.refresh_connection_after_ms = MQTT_REFRESH_CONNECTION_MS;

    mqtt_cfg.buffer.size                       = MQTT_BUFFER_SIZE;

    s_client = esp_mqtt_client_init(&mqtt_cfg);
    esp_mqtt_client_register_event(s_client, MQTT_EVENT_ANY,
                                   mqtt_event_handler, NULL);

    LOG_I(TAG, "Initialized — broker: %s", uri);
}

static void mqtt_wifi_monitor_task(void* arg) {
    while (true) {
        xEventGroupWaitBits(g_system_events, SYS_EVENT_WIFI_CONNECTED,
                            pdFALSE, pdTRUE, portMAX_DELAY);

        LOG_I(TAG, "WiFi up — connecting MQTT");
        esp_mqtt_client_start(s_client);
        s_disconnect_at = 0;

        // Monitor loop: handle both WiFi loss and MQTT stuck reconnect
        while (true) {
            EventBits_t bits = xEventGroupWaitBits(
                g_system_events, SYS_EVENT_WIFI_DISCONNECTED,
                pdFALSE, pdTRUE, pdMS_TO_TICKS(10000)
            );

            if (bits & SYS_EVENT_WIFI_DISCONNECTED) {
                break;
            }

            // Last resort: if MQTT can't reconnect for 5 min while WiFi is up,
            // something is truly stuck — restart device to recover clean state.
            // Do NOT use stop+start here: it races with ESP-IDF's internal reconnect
            // and causes a reconnect storm ("already connected" loop on broker).
            if (s_state != MQTT_STATE_CONNECTED && s_disconnect_at != 0) {
                uint32_t stuck_ms = (xTaskGetTickCount() - s_disconnect_at) * portTICK_PERIOD_MS;
                if (stuck_ms >= MQTT_MAX_DISCONNECTED_MS) {
                    LOG_E(TAG, "MQTT unreachable for %lu s — restarting device",
                          stuck_ms / 1000);
                    vTaskDelay(pdMS_TO_TICKS(500));
                    esp_restart();
                }
            }
        }

        LOG_I(TAG, "WiFi down — stopping MQTT");
        esp_mqtt_client_stop(s_client);
        s_state = MQTT_STATE_DISCONNECTED;
        s_disconnect_at = 0;
        xEventGroupClearBits(g_system_events,
                             SYS_EVENT_MQTT_CONNECTED | SYS_EVENT_MQTT_DISCONNECTED);
    }
}

void mqtt_manager_start(void) {
    if (!s_client) { LOG_E(TAG, "Not initialized!"); return; }
    // ESP32-C3 single-core — tidak ada core affinity
    xTaskCreate(mqtt_wifi_monitor_task, "mqtt_monitor",
                MQTT_TASK_STACK, NULL, MQTT_TASK_PRIORITY, NULL);
    LOG_I(TAG, "Started");
}

mqtt_state_t mqtt_manager_get_state(void) { return s_state; }

bool mqtt_manager_publish(const char* topic, const char* payload,
                           int qos, bool retain) {
    if (s_state != MQTT_STATE_CONNECTED) {
        LOG_W(TAG, "Cannot publish — not connected");
        return false;
    }
    int id = esp_mqtt_client_publish(s_client, topic, payload, 0,
                                      qos, retain ? 1 : 0);
    if (id < 0) { LOG_E(TAG, "Publish failed"); return false; }
    return true;
}

void mqtt_manager_set_ota_callback(void (*cb)(const char* url)) {
    s_ota_callback = cb;
}

const char* mqtt_manager_get_weight_topic(void) { return s_topic_weight; }
const char* mqtt_manager_get_status_topic(void) { return s_topic_status; }