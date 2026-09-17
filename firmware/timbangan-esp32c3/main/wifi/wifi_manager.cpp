#include "wifi_manager.h"
#include "logger.h"

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/event_groups.h"
#include "esp_wifi.h"
#include "esp_netif.h"
#include "esp_event.h"
#include "esp_mac.h"
#include "nvs_flash.h"
#include <stdio.h>
#include <string.h>

static const char* TAG = "WiFi";

static wifi_state_t  s_state            = WIFI_STATE_BOOT;
static uint32_t      s_attempts         = 0;
static uint32_t      s_backoff_ms       = 0;
static TickType_t    s_state_enter_tick = 0;
static uint32_t      s_dhcp_waits       = 0;

// BSSID avoidance: after DHCP failure on a mesh node, skip it on next attempt
static uint8_t          s_avoid_bssid[6]    = {0};
static uint8_t          s_avoid_channel     = 0;
static bool             s_avoid_bssid_set   = false;
static wifi_ap_record_t s_scan_records[20]; // static — avoids stack overflow in wifi_task

static char s_ssid[64]     = {0};
static char s_password[64] = {0};

extern EventGroupHandle_t g_system_events;

#if WIFI_SCAN_DIAGNOSTIC
// ==================== SCAN DIAGNOSTIK ====================
// Dipakai untuk membedakan penyebab WIFI_REASON_AUTH_EXPIRE (reason 2):
//   - RSSI lemah (< -80 dBm)          → masalah RF/antena, bukan konfigurasi
//   - authmode WPA3_PSK / WPA2_WPA3   → AP minta SAE, Open auth dari ESP diabaikan
//   - SSID tidak muncul sama sekali   → SSID hidden / band 5GHz / salah ketik
//   - beberapa BSSID untuk satu SSID  → mesh, mungkin node terdekat yang bermasalah

static const char* authmode_str(wifi_auth_mode_t m) {
    switch (m) {
        case WIFI_AUTH_OPEN:            return "OPEN";
        case WIFI_AUTH_WEP:             return "WEP";
        case WIFI_AUTH_WPA_PSK:         return "WPA_PSK";
        case WIFI_AUTH_WPA2_PSK:        return "WPA2_PSK";
        case WIFI_AUTH_WPA_WPA2_PSK:    return "WPA_WPA2_PSK";
        case WIFI_AUTH_ENTERPRISE:      return "ENTERPRISE";
        case WIFI_AUTH_WPA3_PSK:        return "WPA3_PSK  <-- butuh SAE";
        case WIFI_AUTH_WPA2_WPA3_PSK:   return "WPA2_WPA3_PSK";
        case WIFI_AUTH_WAPI_PSK:        return "WAPI_PSK";
        case WIFI_AUTH_OWE:             return "OWE";
        case WIFI_AUTH_WPA3_ENT_192:    return "WPA3_ENT_192";
        case WIFI_AUTH_WPA3_EXT_PSK:    return "WPA3_EXT_PSK <-- butuh SAE";
        case WIFI_AUTH_WPA3_EXT_PSK_MIXED_MODE: return "WPA3_EXT_PSK_MIXED";
        case WIFI_AUTH_DPP:             return "DPP";
        case WIFI_AUTH_WPA3_ENTERPRISE: return "WPA3_ENTERPRISE";
        case WIFI_AUTH_WPA2_WPA3_ENTERPRISE: return "WPA2_WPA3_ENTERPRISE";
        case WIFI_AUTH_WPA_ENTERPRISE:  return "WPA_ENTERPRISE";
        default:                        return "UNKNOWN";
    }
}

static void scan_report(const char* target_ssid) {
    wifi_scan_config_t scan_cfg = {};
    scan_cfg.show_hidden = true;

    LOG_I(TAG, "=== SCAN DIAGNOSTIK — mencari '%s' ===", target_ssid);

    esp_err_t err = esp_wifi_scan_start(&scan_cfg, true);   // blocking
    if (err != ESP_OK) {
        LOG_W(TAG, "Scan gagal: %s", esp_err_to_name(err));
        return;
    }

    uint16_t count = sizeof(s_scan_records) / sizeof(s_scan_records[0]);
    if (esp_wifi_scan_get_ap_records(&count, s_scan_records) != ESP_OK) {
        LOG_W(TAG, "Gagal ambil hasil scan");
        return;
    }

    int matches = 0;
    LOG_I(TAG, "Terlihat %u AP:", count);
    for (uint16_t i = 0; i < count; i++) {
        wifi_ap_record_t* r = &s_scan_records[i];
        bool match = (strncmp((char*)r->ssid, target_ssid, 32) == 0);
        if (match) matches++;
        LOG_I(TAG, " %s ch:%2d rssi:%4d auth:%-22s " MACSTR " \"%s\"",
              match ? "->" : "  ",
              r->primary, r->rssi, authmode_str(r->authmode),
              MAC2STR(r->bssid), (char*)r->ssid);
    }

    if (matches == 0) {
        LOG_W(TAG, "SSID '%s' TIDAK ditemukan — cek ejaan, SSID hidden, "
                   "atau AP hanya 5GHz (ESP32-C3 hanya 2.4GHz)", target_ssid);
    } else {
        LOG_I(TAG, "SSID '%s' ditemukan di %d BSSID", target_ssid, matches);
    }
    LOG_I(TAG, "=== SELESAI SCAN ===");
}
#endif  // WIFI_SCAN_DIAGNOSTIC

static void set_state(wifi_state_t new_state) {
    s_state            = new_state;
    s_state_enter_tick = xTaskGetTickCount();

    switch (new_state) {
        case WIFI_STATE_BOOT:
            LOG_I(TAG, "→ BOOT");
            break;
        case WIFI_STATE_CONNECTING:
            LOG_I(TAG, "→ CONNECTING (attempt %lu)", s_attempts + 1);
            break;
        case WIFI_STATE_CONNECTED:
            LOG_I(TAG, "→ CONNECTED");
            s_avoid_bssid_set = false;  // successful connection — clear avoidance
            xEventGroupSetBits(g_system_events, SYS_EVENT_WIFI_CONNECTED);
            xEventGroupClearBits(g_system_events, SYS_EVENT_WIFI_DISCONNECTED);
            break;
        case WIFI_STATE_WAITING_BACKOFF:
            LOG_I(TAG, "→ WAITING_BACKOFF (%lu ms)", s_backoff_ms);
            break;
        case WIFI_STATE_FAILED:
            LOG_E(TAG, "→ FAILED — restarting in 3s");
            xEventGroupClearBits(g_system_events, SYS_EVENT_WIFI_CONNECTED);
            xEventGroupSetBits(g_system_events, SYS_EVENT_WIFI_DISCONNECTED);
            break;
    }
}

static uint32_t calculate_backoff(uint32_t attempt) {
    uint32_t backoff = WIFI_RECONNECT_BASE_MS * (1 << attempt);
    return (backoff > WIFI_RECONNECT_MAX_MS) ? WIFI_RECONNECT_MAX_MS : backoff;
}

static void do_connect(void) {
    esp_wifi_disconnect();
    vTaskDelay(pdMS_TO_TICKS(500));

    wifi_config_t wifi_cfg = {};
    strncpy((char*)wifi_cfg.sta.ssid,     s_ssid,     sizeof(wifi_cfg.sta.ssid) - 1);
    strncpy((char*)wifi_cfg.sta.password, s_password, sizeof(wifi_cfg.sta.password) - 1);
    wifi_cfg.sta.threshold.authmode = WIFI_AUTH_WPA2_PSK;
    wifi_cfg.sta.pmf_cfg.capable    = true;
    wifi_cfg.sta.pmf_cfg.required   = false;

    // wifi_config_t di-zero-init, jadi sae_pwe_h2e = 0 (WPA3_SAE_PWE_UNSPECIFIED)
    // padahal header IDF menyebut default-nya WPA3_SAE_PWE_BOTH. Kalau AP memakai
    // WPA3-SAE, PWE method yang tidak ditentukan bisa membuat SAE gagal dan
    // gejalanya sama persis dengan reason 2 (AUTH_EXPIRE). Set eksplisit — tidak
    // berpengaruh pada AP WPA2 karena field ini hanya dipakai saat SAE.
    wifi_cfg.sta.sae_pwe_h2e = WPA3_SAE_PWE_BOTH;

    // After a DHCP failure on a mesh node, scan the same channel and pick
    // the best alternative node. Avoids reconnecting to the broken node.
    if (s_avoid_bssid_set) {
        s_avoid_bssid_set = false;  // one-shot: clear before connecting
        wifi_scan_config_t scan_cfg = {};
        scan_cfg.channel = s_avoid_channel;  // single-channel scan — fast (~200ms)
        if (esp_wifi_scan_start(&scan_cfg, true) == ESP_OK) {
            uint16_t count = 20;
            if (esp_wifi_scan_get_ap_records(&count, s_scan_records) == ESP_OK) {
                wifi_ap_record_t* best = NULL;
                for (uint16_t i = 0; i < count; i++) {
                    if (strncmp((char*)s_scan_records[i].ssid, s_ssid, 32) == 0 &&
                        memcmp(s_scan_records[i].bssid, s_avoid_bssid, 6) != 0) {
                        if (!best || s_scan_records[i].rssi > best->rssi) {
                            best = &s_scan_records[i];
                        }
                    }
                }
                if (best) {
                    wifi_cfg.sta.bssid_set = 1;
                    memcpy(wifi_cfg.sta.bssid, best->bssid, 6);
                    LOG_I(TAG, "Scan: skip " MACSTR " → " MACSTR " (%d dBm)",
                          MAC2STR(s_avoid_bssid),
                          MAC2STR(wifi_cfg.sta.bssid), best->rssi);
                } else {
                    LOG_W(TAG, "Scan: no alternative to " MACSTR " found",
                          MAC2STR(s_avoid_bssid));
                }
            }
        }
    }

    esp_wifi_set_config(WIFI_IF_STA, &wifi_cfg);
    esp_wifi_connect();
}

static void wifi_event_handler(void* arg, esp_event_base_t base,
                                int32_t event_id, void* event_data) {
    if (base == WIFI_EVENT) {
        switch (event_id) {
            case WIFI_EVENT_STA_DISCONNECTED: {
                wifi_event_sta_disconnected_t* disc =
                    (wifi_event_sta_disconnected_t*)event_data;
                LOG_W(TAG, "STA disconnected — reason: %d (0x%02x)",
                      disc->reason, disc->reason);
                xEventGroupClearBits(g_system_events, SYS_EVENT_WIFI_CONNECTED);
                xEventGroupSetBits(g_system_events, SYS_EVENT_WIFI_DISCONNECTED);

                // Jangan reconnect kalau BLE provisioning aktif
                if (xEventGroupGetBits(g_system_events) & SYS_EVENT_BLE_PROVISIONING) {
                    LOG_I(TAG, "BLE provisioning active — skip reconnect");
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
                LOG_I(TAG, "STA connected to AP");
                break;

            default:
                break;
        }
    } else if (base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t* event = (ip_event_got_ip_t*)event_data;
        LOG_I(TAG, "Got IP: " IPSTR, IP2STR(&event->ip_info.ip));
        s_attempts   = 0;
        s_backoff_ms = 0;
        set_state(WIFI_STATE_CONNECTED);
    }
}

static void wifi_task(void* arg) {
    const TickType_t CHECK_INTERVAL = pdMS_TO_TICKS(WIFI_CHECK_INTERVAL_MS);

    do_connect();
    set_state(WIFI_STATE_CONNECTING);

    while (true) {
        // Pause semua WiFi activity saat BLE provisioning aktif
        if (xEventGroupGetBits(g_system_events) & SYS_EVENT_BLE_PROVISIONING) {
            // Reset state timer agar tidak timeout saat resume
            s_state_enter_tick = xTaskGetTickCount();
            vTaskDelay(CHECK_INTERVAL);
            continue;
        }

        TickType_t now        = xTaskGetTickCount();
        uint32_t   elapsed_ms = (now - s_state_enter_tick) * portTICK_PERIOD_MS;

        switch (s_state) {

            case WIFI_STATE_CONNECTING: {
                wifi_ap_record_t ap_info;
                bool l2_up  = (esp_wifi_sta_get_ap_info(&ap_info) == ESP_OK);
                bool timeout = (elapsed_ms >= WIFI_CONNECT_TIMEOUT_MS);

                if (l2_up && timeout) {
                    s_dhcp_waits++;
                    if (s_dhcp_waits <= WIFI_MAX_DHCP_WAITS) {
                        if (s_dhcp_waits == 1) {
                            // First timeout: restart DHCP client to send a fresh DISCOVER.
                            // AP may have missed the initial broadcast.
                            esp_netif_t* netif = esp_netif_get_handle_from_ifkey("WIFI_STA_DEF");
                            if (netif) {
                                esp_netif_dhcpc_stop(netif);
                                esp_netif_dhcpc_start(netif);
                            }
                            LOG_W(TAG, "DHCP restart (RSSI:%d dBm)", ap_info.rssi);
                        } else {
                            LOG_W(TAG, "DHCP pending (RSSI:%d dBm, wait %lu/%d)",
                                  ap_info.rssi, s_dhcp_waits, WIFI_MAX_DHCP_WAITS);
                        }
                        s_state_enter_tick = now;
                        break;
                    }
                    // Max waits exceeded — AP's DHCP is unresponsive, force reconnect.
                    // Save this BSSID so do_connect() can scan for a different mesh node.
                    memcpy(s_avoid_bssid, ap_info.bssid, 6);
                    s_avoid_channel   = ap_info.primary;
                    s_avoid_bssid_set = true;
                    LOG_W(TAG, "DHCP failed after %lu s — blacklisting " MACSTR " (ch%d)",
                          (s_dhcp_waits * WIFI_CONNECT_TIMEOUT_MS) / 1000,
                          MAC2STR(s_avoid_bssid), s_avoid_channel);
                    s_dhcp_waits = 0;
                    l2_up = false;
                }

                // Detect L2 drop before timeout (guard 3s for initial association)
                bool timed_out     = (!l2_up && timeout);
                bool l2_lost_early = (!l2_up && !timeout && elapsed_ms > 3000);

                if (timed_out || l2_lost_early) {
                    s_dhcp_waits = 0;
                    if (l2_lost_early) {
                        LOG_W(TAG, "L2 lost (attempt %lu)", s_attempts + 1);
                    } else {
                        LOG_W(TAG, "Connect timeout (attempt %lu)", s_attempts + 1);
                    }
                    s_attempts++;
                    if (s_attempts >= WIFI_MAX_ATTEMPTS) {
                        set_state(WIFI_STATE_FAILED);
                    } else {
                        s_backoff_ms = calculate_backoff(s_attempts - 1);
                        set_state(WIFI_STATE_WAITING_BACKOFF);
                    }
                }
                break;
            }

            case WIFI_STATE_CONNECTED:
                if (elapsed_ms >= 30000) {
                    int rssi = 0;
                    esp_wifi_sta_get_rssi(&rssi);
                    if (rssi < WIFI_MIN_RSSI) {
                        LOG_W(TAG, "Weak signal: %d dBm", rssi);
                    }
                    s_state_enter_tick = now;
                }
                break;

            case WIFI_STATE_WAITING_BACKOFF:
                if (elapsed_ms >= s_backoff_ms) {
                    LOG_I(TAG, "Backoff done, retrying (%lu/%d)",
                          s_attempts + 1, WIFI_MAX_ATTEMPTS);
                    do_connect();
                    set_state(WIFI_STATE_CONNECTING);
                }
                break;

            case WIFI_STATE_FAILED:
                if (elapsed_ms >= 3000) {
                    LOG_E(TAG, "Restarting ESP32...");
                    vTaskDelay(pdMS_TO_TICKS(100));
                    esp_restart();
                }
                break;

            default:
                break;
        }

        vTaskDelay(CHECK_INTERVAL);
    }
}

void wifi_manager_init(void) {
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_t* netif = esp_netif_create_default_wifi_sta();

    // Set unique hostname — same format as BLE advertising name
    uint8_t mac[6];
    esp_read_mac(mac, ESP_MAC_WIFI_STA);
    char hostname[48];
    snprintf(hostname, sizeof(hostname),
             "%s-timbangan-%02X%02X%02X",
             BLE_DEVICE_NAME_PREFIX, mac[3], mac[4], mac[5]);
    esp_netif_set_hostname(netif, hostname);
    LOG_I(TAG, "Hostname: %s", hostname);

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_ps(WIFI_PS_NONE));

    ESP_ERROR_CHECK(esp_event_handler_register(
        WIFI_EVENT, ESP_EVENT_ANY_ID, wifi_event_handler, NULL));
    ESP_ERROR_CHECK(esp_event_handler_register(
        IP_EVENT, IP_EVENT_STA_GOT_IP, wifi_event_handler, NULL));

    LOG_I(TAG, "WiFi manager initialized");
}

void wifi_manager_start(const char* ssid, const char* password) {
    strncpy(s_ssid,     ssid,     sizeof(s_ssid) - 1);
    strncpy(s_password, password, sizeof(s_password) - 1);

    ESP_ERROR_CHECK(esp_wifi_start());

#if WIFI_SCAN_DIAGNOSTIC
    scan_report(s_ssid);
#endif

    // ESP32-C3 single-core — tidak ada core affinity
    xTaskCreate(wifi_task, "wifi_task", 4096, NULL, 5, NULL);

    LOG_I(TAG, "WiFi manager started — SSID: %s", ssid);
}

wifi_state_t wifi_manager_get_state(void) { return s_state; }

int wifi_manager_get_rssi(void) {
    int rssi = 0;
    esp_wifi_sta_get_rssi(&rssi);
    return (int)rssi;
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

