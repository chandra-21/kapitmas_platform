#include "wifi_manager.h"
#include "logger.h"
#include "app_config.h"

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/event_groups.h"
#include "esp_wifi.h"
#include "esp_netif.h"
#include "esp_event.h"
#include "esp_mac.h"
#include <string.h>
#include <stdio.h>

static const char* TAG = "WiFi";

static wifi_state_t  s_state            = WIFI_STATE_BOOT;
static uint32_t      s_attempts         = 0;
static uint32_t      s_backoff_ms       = 0;
static TickType_t    s_state_enter_tick = 0;
static uint32_t      s_dhcp_waits       = 0;

static uint8_t          s_avoid_bssid[6]    = {0};
static uint8_t          s_avoid_channel     = 0;
static bool             s_avoid_bssid_set   = false;
static wifi_ap_record_t s_scan_records[20];

static char s_ssid[64]     = {0};
static char s_password[64] = {0};

extern EventGroupHandle_t g_system_events;

static void set_state(wifi_state_t new_state) {
    s_state            = new_state;
    s_state_enter_tick = xTaskGetTickCount();

    switch (new_state) {
        case WIFI_STATE_BOOT:        LOG_I(TAG, "→ BOOT"); break;
        case WIFI_STATE_CONNECTING:  LOG_I(TAG, "→ CONNECTING (attempt %lu)", s_attempts + 1); break;
        case WIFI_STATE_CONNECTED:
            LOG_I(TAG, "→ CONNECTED");
            s_avoid_bssid_set = false;
            xEventGroupSetBits(g_system_events, SYS_EVENT_WIFI_CONNECTED);
            xEventGroupClearBits(g_system_events, SYS_EVENT_WIFI_DISCONNECTED);
            break;
        case WIFI_STATE_WAITING_BACKOFF:
            LOG_I(TAG, "→ BACKOFF (%lu ms)", s_backoff_ms);
            break;
        case WIFI_STATE_FAILED:
            LOG_E(TAG, "→ FAILED — restarting in 3s");
            xEventGroupClearBits(g_system_events, SYS_EVENT_WIFI_CONNECTED);
            xEventGroupSetBits(g_system_events, SYS_EVENT_WIFI_DISCONNECTED);
            break;
    }
}

static uint32_t calc_backoff(uint32_t attempt) {
    uint32_t b = WIFI_RECONNECT_BASE_MS * (1 << attempt);
    return (b > WIFI_RECONNECT_MAX_MS) ? WIFI_RECONNECT_MAX_MS : b;
}

static void do_connect(void) {
    esp_wifi_disconnect();
    vTaskDelay(pdMS_TO_TICKS(500));

    wifi_config_t cfg = {};
    strncpy((char*)cfg.sta.ssid,     s_ssid,     sizeof(cfg.sta.ssid) - 1);
    strncpy((char*)cfg.sta.password, s_password, sizeof(cfg.sta.password) - 1);
    cfg.sta.threshold.authmode = WIFI_AUTH_WPA2_PSK;
    cfg.sta.pmf_cfg.capable    = true;
    cfg.sta.pmf_cfg.required   = false;

    if (s_avoid_bssid_set) {
        s_avoid_bssid_set = false;
        wifi_scan_config_t scan_cfg = {};
        scan_cfg.channel = s_avoid_channel;
        if (esp_wifi_scan_start(&scan_cfg, true) == ESP_OK) {
            uint16_t count = 20;
            if (esp_wifi_scan_get_ap_records(&count, s_scan_records) == ESP_OK) {
                wifi_ap_record_t* best = NULL;
                for (uint16_t i = 0; i < count; i++) {
                    if (strncmp((char*)s_scan_records[i].ssid, s_ssid, 32) == 0 &&
                        memcmp(s_scan_records[i].bssid, s_avoid_bssid, 6) != 0) {
                        if (!best || s_scan_records[i].rssi > best->rssi)
                            best = &s_scan_records[i];
                    }
                }
                if (best) {
                    cfg.sta.bssid_set = 1;
                    memcpy(cfg.sta.bssid, best->bssid, 6);
                }
            }
        }
    }

    esp_wifi_set_config(WIFI_IF_STA, &cfg);
    esp_wifi_connect();
}

static void wifi_event_handler(void* arg, esp_event_base_t base,
                                int32_t event_id, void* event_data) {
    if (base == WIFI_EVENT) {
        switch (event_id) {
            case WIFI_EVENT_STA_DISCONNECTED: {
                wifi_event_sta_disconnected_t* disc =
                    (wifi_event_sta_disconnected_t*)event_data;
                LOG_W(TAG, "Disconnected — reason: %d", disc->reason);
                xEventGroupClearBits(g_system_events, SYS_EVENT_WIFI_CONNECTED);
                xEventGroupSetBits(g_system_events, SYS_EVENT_WIFI_DISCONNECTED);

                if (xEventGroupGetBits(g_system_events) & SYS_EVENT_BLE_PROVISIONING) {
                    LOG_I(TAG, "BLE active — skip reconnect");
                    break;
                }

                if (s_state == WIFI_STATE_CONNECTED) {
                    s_attempts = 0;
                    do_connect();
                    set_state(WIFI_STATE_CONNECTING);
                }
                break;
            }
            case WIFI_EVENT_STA_CONNECTED:
                LOG_I(TAG, "STA connected");
                break;
            default: break;
        }
    } else if (base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t* event = (ip_event_got_ip_t*)event_data;
        LOG_I(TAG, "Got IP: " IPSTR, IP2STR(&event->ip_info.ip));
        s_attempts   = 0;
        s_backoff_ms = 0;
        s_dhcp_waits = 0;
        set_state(WIFI_STATE_CONNECTED);
    }
}

static void wifi_task(void* arg) {
    const TickType_t CHECK = pdMS_TO_TICKS(WIFI_CHECK_INTERVAL_MS);

    do_connect();
    set_state(WIFI_STATE_CONNECTING);

    while (true) {
        if (xEventGroupGetBits(g_system_events) & SYS_EVENT_BLE_PROVISIONING) {
            s_state_enter_tick = xTaskGetTickCount();
            vTaskDelay(CHECK);
            continue;
        }

        TickType_t now        = xTaskGetTickCount();
        uint32_t   elapsed_ms = (now - s_state_enter_tick) * portTICK_PERIOD_MS;

        switch (s_state) {
            case WIFI_STATE_CONNECTING: {
                wifi_ap_record_t ap;
                bool l2_up  = (esp_wifi_sta_get_ap_info(&ap) == ESP_OK);
                bool timeout = (elapsed_ms >= WIFI_CONNECT_TIMEOUT_MS);

                if (l2_up && timeout) {
                    s_dhcp_waits++;
                    esp_netif_t* netif = esp_netif_get_handle_from_ifkey("WIFI_STA_DEF");
                    if (netif && s_dhcp_waits == 1) {
                        esp_netif_dhcpc_stop(netif);
                        esp_netif_dhcpc_start(netif);
                        LOG_W(TAG, "DHCP restart");
                    }
                    s_state_enter_tick = now;
                    break;
                }

                bool timed_out = (!l2_up && timeout);
                bool l2_lost   = (!l2_up && !timeout && elapsed_ms > 3000);

                if (timed_out || l2_lost) {
                    s_dhcp_waits = 0;
                    s_attempts++;
                    if (s_attempts >= WIFI_MAX_ATTEMPTS) {
                        set_state(WIFI_STATE_FAILED);
                    } else {
                        s_backoff_ms = calc_backoff(s_attempts - 1);
                        set_state(WIFI_STATE_WAITING_BACKOFF);
                    }
                }
                break;
            }

            case WIFI_STATE_CONNECTED:
                if (elapsed_ms >= 30000) {
                    s_state_enter_tick = now;
                }
                break;

            case WIFI_STATE_WAITING_BACKOFF:
                if (elapsed_ms >= s_backoff_ms) {
                    do_connect();
                    set_state(WIFI_STATE_CONNECTING);
                }
                break;

            case WIFI_STATE_FAILED:
                if (elapsed_ms >= 3000) {
                    LOG_E(TAG, "Restarting...");
                    vTaskDelay(pdMS_TO_TICKS(100));
                    esp_restart();
                }
                break;

            default: break;
        }

        vTaskDelay(CHECK);
    }
}

void wifi_manager_init(void) {
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_t* netif = esp_netif_create_default_wifi_sta();

    uint8_t mac[6];
    esp_read_mac(mac, ESP_MAC_WIFI_STA);
    char hostname[48];
    snprintf(hostname, sizeof(hostname), "SmartBuddy-%02X%02X%02X",
             mac[3], mac[4], mac[5]);
    esp_netif_set_hostname(netif, hostname);

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_ps(WIFI_PS_NONE));

    ESP_ERROR_CHECK(esp_event_handler_register(
        WIFI_EVENT, ESP_EVENT_ANY_ID, wifi_event_handler, NULL));
    ESP_ERROR_CHECK(esp_event_handler_register(
        IP_EVENT, IP_EVENT_STA_GOT_IP, wifi_event_handler, NULL));

    LOG_I(TAG, "WiFi manager initialized (hostname: %s)", hostname);
}

void wifi_manager_start(const char* ssid, const char* password) {
    strncpy(s_ssid,     ssid,     sizeof(s_ssid) - 1);
    strncpy(s_password, password, sizeof(s_password) - 1);
    ESP_ERROR_CHECK(esp_wifi_start());

    xTaskCreatePinnedToCore(wifi_task, "wifi_task", 4096, NULL, 5, NULL, 0);
    LOG_I(TAG, "WiFi started — SSID: %s", ssid);
}

wifi_state_t wifi_manager_get_state(void) { return s_state; }

int wifi_manager_get_rssi(void) {
    int rssi = 0;
    esp_wifi_sta_get_rssi(&rssi);
    return rssi;
}

void wifi_manager_get_ip(char* buf, size_t len) {
    esp_netif_ip_info_t ip_info;
    esp_netif_t* netif = esp_netif_get_handle_from_ifkey("WIFI_STA_DEF");
    if (netif && esp_netif_get_ip_info(netif, &ip_info) == ESP_OK) {
        snprintf(buf, len, IPSTR, IP2STR(&ip_info.ip));
    } else {
        snprintf(buf, len, "0.0.0.0");
    }
}
