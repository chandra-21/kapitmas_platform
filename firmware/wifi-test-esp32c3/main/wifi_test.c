// ============================================================================
//  KAPITMAS — Firmware Tes WiFi untuk ESP32-C3 Super Mini
//
//  Tujuan: memisahkan penyebab WIFI_REASON_AUTH_EXPIRE (reason 2) antara
//    (a) sinyal/antena lemah, (b) AP menolak metode auth (WPA3/PMF),
//    (c) AP memblokir MAC, (d) masalah konfigurasi driver.
//
//  Tidak ada BLE, MQTT, UART, NVS config, OTA — murni WiFi.
// ============================================================================

#include <stdio.h>
#include <string.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/event_groups.h"

#include "nvs_flash.h"
#include "esp_wifi.h"
#include "esp_wifi_default.h"
#include "esp_netif.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_mac.h"

// ==================== EDIT DI SINI ====================
#define TEST_SSID           "iOT"
#define TEST_PASSWORD       "kapitmas.com"

// Jaringan pembanding — ISI DENGAN HOTSPOT HP ANDA.
// Ini tes paling menentukan: board yang sama, AP berbeda.
//   berhasil di hotspot  -> TX board sehat, masalah ada di kebijakan AP "iOT"
//   gagal di hotspot juga -> TX board bermasalah (hardware)
// Kosongkan ("") untuk melewati tes ini.
#define TEST_SSID_ALT       "opoo"
#define TEST_PASSWORD_ALT   "sawan2020"

// SSID yang dipancarkan board saat tes TX (mode SoftAP, tanpa password)
#define TX_TEST_AP_SSID     "KAPITMAS-TXTEST"
// ======================================================

#define CONNECT_TIMEOUT_MS  15000
#define MAX_AP              32

static const char* TAG = "wifitest";

#define BIT_GOT_IP  BIT0
#define BIT_FAILED  BIT1

static EventGroupHandle_t s_events;

static volatile uint8_t s_last_reason = 0;
static volatile int8_t  s_last_rssi   = 0;
static char             s_ip[16]      = {0};

static wifi_ap_record_t s_aps[MAX_AP];

// Info AP target hasil scan
static bool             s_target_found   = false;
static uint8_t          s_target_bssid[6];
static uint8_t          s_target_channel = 0;
static int8_t           s_target_rssi    = 0;
static wifi_auth_mode_t s_target_auth    = WIFI_AUTH_OPEN;
static int              s_target_count   = 0;

// ==================== PENERJEMAH KODE ====================

static const char* auth_str(wifi_auth_mode_t m) {
    switch (m) {
        case WIFI_AUTH_OPEN:                    return "OPEN";
        case WIFI_AUTH_WEP:                     return "WEP";
        case WIFI_AUTH_WPA_PSK:                 return "WPA_PSK";
        case WIFI_AUTH_WPA2_PSK:                return "WPA2_PSK";
        case WIFI_AUTH_WPA_WPA2_PSK:            return "WPA_WPA2_PSK";
        case WIFI_AUTH_ENTERPRISE:              return "ENTERPRISE";
        case WIFI_AUTH_WPA3_PSK:                return "WPA3_PSK";
        case WIFI_AUTH_WPA2_WPA3_PSK:           return "WPA2_WPA3_PSK";
        case WIFI_AUTH_WAPI_PSK:                return "WAPI_PSK";
        case WIFI_AUTH_OWE:                     return "OWE";
        case WIFI_AUTH_WPA3_ENT_192:            return "WPA3_ENT_192";
        case WIFI_AUTH_WPA3_EXT_PSK:            return "WPA3_EXT_PSK";
        case WIFI_AUTH_WPA3_EXT_PSK_MIXED_MODE: return "WPA3_EXT_PSK_MIXED";
        case WIFI_AUTH_DPP:                     return "DPP";
        case WIFI_AUTH_WPA3_ENTERPRISE:         return "WPA3_ENTERPRISE";
        case WIFI_AUTH_WPA2_WPA3_ENTERPRISE:    return "WPA2_WPA3_ENTERPRISE";
        case WIFI_AUTH_WPA_ENTERPRISE:          return "WPA_ENTERPRISE";
        default:                                return "UNKNOWN";
    }
}

static const char* reason_str(uint8_t r) {
    switch (r) {
        case WIFI_REASON_AUTH_EXPIRE:
            return "AUTH_EXPIRE — auth frame dikirim, AP tidak membalas";
        case WIFI_REASON_AUTH_LEAVE:
            return "AUTH_LEAVE";
        case WIFI_REASON_ASSOC_EXPIRE:
            return "ASSOC_EXPIRE";
        case WIFI_REASON_ASSOC_TOOMANY:
            return "ASSOC_TOOMANY — AP penuh / batas jumlah client";
        case WIFI_REASON_NOT_AUTHED:
            return "NOT_AUTHED";
        case WIFI_REASON_NOT_ASSOCED:
            return "NOT_ASSOCED";
        case WIFI_REASON_ASSOC_LEAVE:
            return "ASSOC_LEAVE";
        case WIFI_REASON_4WAY_HANDSHAKE_TIMEOUT:
            return "4WAY_HANDSHAKE_TIMEOUT — password kemungkinan salah";
        case WIFI_REASON_NO_AP_FOUND:
            return "NO_AP_FOUND — SSID tidak terlihat";
        case WIFI_REASON_HANDSHAKE_TIMEOUT:
            return "HANDSHAKE_TIMEOUT — password kemungkinan salah";
        case WIFI_REASON_CONNECTION_FAIL:
            return "CONNECTION_FAIL";
        case WIFI_REASON_NO_AP_FOUND_W_COMPATIBLE_SECURITY:
            return "NO_AP_FOUND_W_COMPATIBLE_SECURITY — security AP tidak cocok";
        case WIFI_REASON_NO_AP_FOUND_IN_AUTHMODE_THRESHOLD:
            return "NO_AP_FOUND_IN_AUTHMODE_THRESHOLD — threshold authmode terlalu tinggi";
        case WIFI_REASON_NO_AP_FOUND_IN_RSSI_THRESHOLD:
            return "NO_AP_FOUND_IN_RSSI_THRESHOLD — sinyal di bawah ambang";
        default:
            return "(lihat esp_wifi_types_generic.h)";
    }
}

// Penilaian kualitas sinyal — dipakai untuk kesimpulan otomatis
static const char* rssi_verdict(int rssi) {
    if (rssi == 0)    return "tidak diketahui";
    if (rssi > -60)   return "SANGAT BAIK";
    if (rssi > -70)   return "baik";
    if (rssi > -80)   return "cukup";
    if (rssi > -88)   return "LEMAH";
    return "SANGAT LEMAH";
}

// ==================== EVENT ====================

static void on_event(void* arg, esp_event_base_t base,
                     int32_t id, void* data) {
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        wifi_event_sta_disconnected_t* d = (wifi_event_sta_disconnected_t*)data;
        s_last_reason = d->reason;
        s_last_rssi   = d->rssi;
        xEventGroupSetBits(s_events, BIT_FAILED);
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_AP_START) {
        printf("  [event] AP_START — beacon MULAI dipancarkan\n");
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_AP_STOP) {
        printf("  [event] AP_STOP\n");
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_AP_STACONNECTED) {
        wifi_event_ap_staconnected_t* s = (wifi_event_ap_staconnected_t*)data;
        printf("  [event] AP_STACONNECTED " MACSTR
               " — TX BOARD TERBUKTI BERFUNGSI\n", MAC2STR(s->mac));
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t* e = (ip_event_got_ip_t*)data;
        snprintf(s_ip, sizeof(s_ip), IPSTR, IP2STR(&e->ip_info.ip));
        xEventGroupSetBits(s_events, BIT_GOT_IP);
    }
}

// ==================== SCAN ====================

static void do_scan(void) {
    printf("\n===================== SCAN =====================\n");

    wifi_scan_config_t cfg = {0};
    cfg.show_hidden = true;

    esp_err_t err = esp_wifi_scan_start(&cfg, true);
    if (err != ESP_OK) {
        printf("Scan GAGAL: %s\n", esp_err_to_name(err));
        return;
    }

    uint16_t count = MAX_AP;
    if (esp_wifi_scan_get_ap_records(&count, s_aps) != ESP_OK) {
        printf("Gagal mengambil hasil scan\n");
        return;
    }

    s_target_found = false;
    s_target_count = 0;
    s_target_rssi  = -127;

    printf("%-3s %-24s %5s %4s %-22s %s\n",
           "", "SSID", "RSSI", "CH", "AUTH", "BSSID");
    printf("------------------------------------------------"
           "------------------------------\n");

    for (uint16_t i = 0; i < count; i++) {
        wifi_ap_record_t* a = &s_aps[i];
        bool match = (strncmp((char*)a->ssid, TEST_SSID, 32) == 0);

        printf("%-3s %-24s %5d %4d %-22s " MACSTR "\n",
               match ? "-->" : "", (char*)a->ssid, a->rssi, a->primary,
               auth_str(a->authmode), MAC2STR(a->bssid));

        if (match) {
            s_target_count++;
            // simpan BSSID dengan RSSI terkuat
            if (a->rssi > s_target_rssi) {
                s_target_found   = true;
                s_target_rssi    = a->rssi;
                s_target_channel = a->primary;
                s_target_auth    = a->authmode;
                memcpy(s_target_bssid, a->bssid, 6);
            }
        }
    }

    printf("------------------------------------------------"
           "------------------------------\n");
    printf("Total AP terlihat : %u\n", count);

    if (!s_target_found) {
        printf("\n!! SSID \"%s\" TIDAK DITEMUKAN.\n", TEST_SSID);
        printf("   Kemungkinan: salah ejaan (huruf besar/kecil berpengaruh),\n");
        printf("   SSID hidden, atau AP hanya 5GHz (ESP32-C3 hanya 2.4GHz).\n");
    } else {
        printf("\nAP target \"%s\":\n", TEST_SSID);
        printf("  BSSID   : " MACSTR "\n", MAC2STR(s_target_bssid));
        printf("  Channel : %d\n", s_target_channel);
        printf("  RSSI    : %d dBm  (%s)\n",
               s_target_rssi, rssi_verdict(s_target_rssi));
        printf("  Auth    : %s\n", auth_str(s_target_auth));
        printf("  Jumlah BSSID dengan SSID ini: %d%s\n", s_target_count,
               s_target_count > 1 ? "  (mesh / multi-AP)" : "");
    }
    printf("================================================\n\n");
}

// ==================== VARIAN KONEKSI ====================

typedef struct {
    const char*           name;
    wifi_auth_mode_t      threshold;
    bool                  pmf_capable;
    bool                  pmf_required;
    wifi_sae_pwe_method_t sae;
    bool                  lock_bssid;
    bool                  disable_11b;   // matikan rate 802.11b (1/2/5.5/11 Mbps)
    bool                  spoof_mac;     // pakai MAC lain (uji MAC filter)
} variant_t;

// MAC pengganti untuk varian H — OUI 24:0A:C4 milik Espressif, sama seperti
// modul ESP32 yang sudah jalan di jaringan ini. Unicast + universal (bit 0 dan 1
// pada oktet pertama = 0), jadi tidak ditolak sebagai locally-administered.
static const uint8_t ALT_MAC[6] = { 0x24, 0x0A, 0xC4, 0x5A, 0x11, 0x07 };

static const variant_t VARIANTS[] = {
    { "A. Default (sama dgn firmware timbangan)",
      WIFI_AUTH_WPA2_PSK, true,  false, WPA3_SAE_PWE_BOTH,           false, false, false },
    { "B. Threshold OPEN (terima semua authmode)",
      WIFI_AUTH_OPEN,     true,  false, WPA3_SAE_PWE_BOTH,           false, false, false },
    { "C. PMF required (AP WPA3 ketat)",
      WIFI_AUTH_OPEN,     true,  true,  WPA3_SAE_PWE_BOTH,           false, false, false },
    { "D. SAE hunt-and-peck (WPA3 lama)",
      WIFI_AUTH_OPEN,     true,  false, WPA3_SAE_PWE_HUNT_AND_PECK,  false, false, false },
    { "E. Tanpa PMF sama sekali",
      WIFI_AUTH_OPEN,     false, false, WPA3_SAE_PWE_BOTH,           false, false, false },
    { "F. Kunci BSSID + channel hasil scan",
      WIFI_AUTH_OPEN,     true,  false, WPA3_SAE_PWE_BOTH,           true,  false, false },

    // ---- dua varian penentu ----
    { "G. Rate 802.11b DIMATIKAN",
      WIFI_AUTH_WPA2_PSK, true,  false, WPA3_SAE_PWE_BOTH,           false, true,  false },
    { "H. MAC diganti (uji MAC filter)",
      WIFI_AUTH_WPA2_PSK, true,  false, WPA3_SAE_PWE_BOTH,           false, false, true  },
};

#define N_VARIANTS (sizeof(VARIANTS) / sizeof(VARIANTS[0]))

static bool    s_result_ok[N_VARIANTS];
static uint8_t s_result_reason[N_VARIANTS];
static int8_t  s_result_rssi[N_VARIANTS];

static bool try_connect(const variant_t* v) {
    printf("\n--- VARIAN %s ---\n", v->name);
    printf("    threshold=%s pmf_capable=%d pmf_required=%d sae=%d lock_bssid=%d\n",
           auth_str(v->threshold), v->pmf_capable, v->pmf_required,
           (int)v->sae, v->lock_bssid);

    if (v->lock_bssid && !s_target_found) {
        printf("    DILEWATI — BSSID target belum diketahui (scan gagal)\n");
        return false;
    }

    // esp_wifi_config_11b_rate() harus dipanggil sebelum esp_wifi_start(),
    // dan esp_wifi_set_mac() hanya boleh saat interface disabled — jadi kedua
    // varian ini perlu siklus stop/start.
    if (v->disable_11b || v->spoof_mac) {
        esp_wifi_stop();
        vTaskDelay(pdMS_TO_TICKS(300));

        if (v->disable_11b) {
            esp_err_t e = esp_wifi_config_11b_rate(WIFI_IF_STA, true);
            printf("    matikan rate 802.11b: %s\n", esp_err_to_name(e));
        }
        if (v->spoof_mac) {
            esp_err_t e = esp_wifi_set_mac(WIFI_IF_STA, ALT_MAC);
            printf("    ganti MAC ke " MACSTR " : %s\n",
                   MAC2STR(ALT_MAC), esp_err_to_name(e));
        }

        esp_wifi_start();
        vTaskDelay(pdMS_TO_TICKS(400));
    }

    wifi_config_t cfg = {0};
    strncpy((char*)cfg.sta.ssid,     TEST_SSID,     sizeof(cfg.sta.ssid) - 1);
    strncpy((char*)cfg.sta.password, TEST_PASSWORD, sizeof(cfg.sta.password) - 1);
    cfg.sta.threshold.authmode = v->threshold;
    cfg.sta.pmf_cfg.capable    = v->pmf_capable;
    cfg.sta.pmf_cfg.required   = v->pmf_required;
    cfg.sta.sae_pwe_h2e        = v->sae;

    if (v->lock_bssid) {
        cfg.sta.bssid_set = 1;
        memcpy(cfg.sta.bssid, s_target_bssid, 6);
        cfg.sta.channel = s_target_channel;
        printf("    dikunci ke " MACSTR " ch%d\n",
               MAC2STR(s_target_bssid), s_target_channel);
    }

    s_last_reason = 0;
    s_last_rssi   = 0;
    s_ip[0]       = '\0';
    xEventGroupClearBits(s_events, BIT_GOT_IP | BIT_FAILED);

    esp_err_t err = esp_wifi_set_config(WIFI_IF_STA, &cfg);
    if (err != ESP_OK) {
        printf("    set_config gagal: %s\n", esp_err_to_name(err));
        return false;
    }

    err = esp_wifi_connect();
    if (err != ESP_OK) {
        printf("    esp_wifi_connect gagal: %s\n", esp_err_to_name(err));
        return false;
    }

    EventBits_t bits = xEventGroupWaitBits(
        s_events, BIT_GOT_IP | BIT_FAILED,
        pdFALSE, pdFALSE, pdMS_TO_TICKS(CONNECT_TIMEOUT_MS));

    if (bits & BIT_GOT_IP) {
        int rssi = 0;
        esp_wifi_sta_get_rssi(&rssi);
        printf("    >>> BERHASIL — IP %s, RSSI %d dBm (%s)\n",
               s_ip, rssi, rssi_verdict(rssi));
        return true;
    }

    if (bits & BIT_FAILED) {
        printf("    GAGAL — reason %u: %s\n",
               s_last_reason, reason_str(s_last_reason));
        printf("    RSSI saat gagal: %d dBm (%s)\n",
               s_last_rssi, rssi_verdict(s_last_rssi));
    } else {
        printf("    GAGAL — timeout %d ms tanpa event apa pun\n",
               CONNECT_TIMEOUT_MS);
    }
    return false;
}

// Kembalikan radio ke kondisi baku setelah varian G / H
static uint8_t s_orig_mac[6];

static void restore_radio(void) {
    esp_wifi_stop();
    vTaskDelay(pdMS_TO_TICKS(300));
    esp_wifi_config_11b_rate(WIFI_IF_STA, false);
    esp_wifi_set_mac(WIFI_IF_STA, s_orig_mac);
    esp_wifi_start();
    vTaskDelay(pdMS_TO_TICKS(400));
}

// ==================== TES JARINGAN PEMBANDING ====================
// Board yang sama, AP berbeda. Memisahkan "TX board rusak" dari "AP menolak".

static bool try_alt_network(void) {
    if (strlen(TEST_SSID_ALT) == 0) {
        printf("\n(TEST_SSID_ALT kosong — tes jaringan pembanding dilewati)\n");
        return false;
    }

    printf("\n=========== TES JARINGAN PEMBANDING ===========\n");
    printf("SSID: \"%s\"\n", TEST_SSID_ALT);

    wifi_config_t cfg = {0};
    strncpy((char*)cfg.sta.ssid,     TEST_SSID_ALT,     sizeof(cfg.sta.ssid) - 1);
    strncpy((char*)cfg.sta.password, TEST_PASSWORD_ALT, sizeof(cfg.sta.password) - 1);
    cfg.sta.threshold.authmode = WIFI_AUTH_OPEN;
    cfg.sta.pmf_cfg.capable    = true;
    cfg.sta.sae_pwe_h2e        = WPA3_SAE_PWE_BOTH;

    s_last_reason = 0;
    s_last_rssi   = 0;
    s_ip[0]       = '\0';
    xEventGroupClearBits(s_events, BIT_GOT_IP | BIT_FAILED);

    esp_wifi_set_config(WIFI_IF_STA, &cfg);
    if (esp_wifi_connect() != ESP_OK) {
        printf("esp_wifi_connect gagal\n");
        return false;
    }

    EventBits_t bits = xEventGroupWaitBits(
        s_events, BIT_GOT_IP | BIT_FAILED,
        pdFALSE, pdFALSE, pdMS_TO_TICKS(CONNECT_TIMEOUT_MS));

    if (bits & BIT_GOT_IP) {
        int rssi = 0;
        esp_wifi_sta_get_rssi(&rssi);
        printf(">>> BERHASIL di jaringan pembanding — IP %s, RSSI %d dBm\n",
               s_ip, rssi);
        printf("TX board SEHAT. Masalahnya khusus di AP \"%s\".\n", TEST_SSID);
        printf("===============================================\n");
        return true;
    }

    printf("GAGAL juga — reason %u: %s (rssi %d)\n",
           s_last_reason, reason_str(s_last_reason), s_last_rssi);
    printf("Gagal di DUA AP berbeda menunjuk kuat ke TX board.\n");
    printf("===============================================\n");
    esp_wifi_disconnect();
    return false;
}

// ==================== TES TX (MODE SOFTAP) ====================
// Board memancarkan SSID sendiri. Ini menguji jalur TRANSMIT secara langsung —
// sesuatu yang tidak pernah diuji oleh RSSI (RSSI murni sisi terima).

static void tx_test_softap(void) {
    printf("\n============== TES TX (SOFTAP) ==============\n");

    esp_err_t e;

    esp_wifi_disconnect();
    e = esp_wifi_stop();
    printf("  esp_wifi_stop            : %s\n", esp_err_to_name(e));
    vTaskDelay(pdMS_TO_TICKS(300));

    e = esp_wifi_set_mode(WIFI_MODE_AP);
    printf("  esp_wifi_set_mode(AP)    : %s\n", esp_err_to_name(e));

    wifi_config_t ap = {0};
    strncpy((char*)ap.ap.ssid, TX_TEST_AP_SSID, sizeof(ap.ap.ssid) - 1);
    ap.ap.ssid_len        = strlen(TX_TEST_AP_SSID);
    ap.ap.channel         = 6;
    ap.ap.authmode        = WIFI_AUTH_OPEN;
    ap.ap.max_connection  = 4;
    ap.ap.beacon_interval = 100;
    ap.ap.ssid_hidden     = 0;

    e = esp_wifi_set_config(WIFI_IF_AP, &ap);
    printf("  esp_wifi_set_config(AP)  : %s\n", esp_err_to_name(e));

    e = esp_wifi_start();
    printf("  esp_wifi_start           : %s\n", esp_err_to_name(e));
    vTaskDelay(pdMS_TO_TICKS(800));

    // Verifikasi AP benar-benar aktif — kalau ini tidak sesuai, SSID tidak muncul
    // karena tesnya yang gagal, bukan karena TX board rusak.
    wifi_mode_t mode = WIFI_MODE_NULL;
    esp_wifi_get_mode(&mode);
    printf("  mode aktif               : %d (2 = WIFI_MODE_AP)\n", (int)mode);

    wifi_config_t verify = {0};
    if (esp_wifi_get_config(WIFI_IF_AP, &verify) == ESP_OK) {
        printf("  SSID terpasang di driver : \"%s\" (len %d, ch %d, hidden %d)\n",
               (char*)verify.ap.ssid, verify.ap.ssid_len,
               verify.ap.channel, verify.ap.ssid_hidden);
    }

    uint8_t apmac[6] = {0};
    esp_wifi_get_mac(WIFI_IF_AP, apmac);
    printf("  MAC SoftAP               : " MACSTR "\n", MAC2STR(apmac));

    int8_t txp = 0;
    esp_wifi_get_max_tx_power(&txp);

    printf("Board sekarang memancarkan SSID  : \"%s\"  (channel 6, tanpa password)\n",
           TX_TEST_AP_SSID);
    printf("Max TX power terkonfigurasi      : %d (satuan 0.25 dBm = %.2f dBm)\n",
           txp, txp * 0.25);
    printf("\nCEK DENGAN HP ANDA:\n");
    printf("  1. Buka daftar WiFi di HP, cari \"%s\"\n", TX_TEST_AP_SSID);
    printf("  2. Perhatikan kekuatan sinyalnya\n\n");
    printf("ARTINYA:\n");
    printf("  SSID terlihat kuat + bisa connect -> TX board SEHAT.\n");
    printf("      Masalah 100%% di sisi AP \"%s\".\n", TEST_SSID);
    printf("  SSID TIDAK terlihat / sangat lemah dari jarak 1 m -> TX board RUSAK.\n");
    printf("      Antena/matching board bermasalah. Ganti board.\n");
    printf("============================================\n\n");

    while (1) {
        wifi_sta_list_t list;
        if (esp_wifi_ap_get_sta_list(&list) == ESP_OK && list.num > 0) {
            printf("[TX OK] %d perangkat terhubung ke \"%s\" "
                   "-> TX board TERBUKTI BERFUNGSI\n",
                   list.num, TX_TEST_AP_SSID);
        } else {
            printf("[menunggu] belum ada perangkat yang terhubung ke \"%s\"\n",
                   TX_TEST_AP_SSID);
        }
        vTaskDelay(pdMS_TO_TICKS(5000));
    }
}

// ==================== MAIN ====================

void app_main(void) {
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES ||
        ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        nvs_flash_erase();
        nvs_flash_init();
    }

    s_events = xEventGroupCreate();

    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_sta();
    esp_netif_create_default_wifi_ap();   // dibutuhkan tes TX SoftAP di akhir

    wifi_init_config_t init_cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&init_cfg));
    ESP_ERROR_CHECK(esp_wifi_set_storage(WIFI_STORAGE_RAM));
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_ps(WIFI_PS_NONE));

    ESP_ERROR_CHECK(esp_event_handler_register(
        WIFI_EVENT, ESP_EVENT_ANY_ID, on_event, NULL));
    ESP_ERROR_CHECK(esp_event_handler_register(
        IP_EVENT, IP_EVENT_STA_GOT_IP, on_event, NULL));

    ESP_ERROR_CHECK(esp_wifi_start());

    uint8_t mac[6];
    esp_read_mac(mac, ESP_MAC_WIFI_STA);
    esp_wifi_get_mac(WIFI_IF_STA, s_orig_mac);   // untuk restore_radio()

    printf("\n\n");
    printf("################################################\n");
    printf("#  KAPITMAS — TES WIFI ESP32-C3 SUPER MINI     #\n");
    printf("################################################\n");
    printf("  SSID target : \"%s\"\n", TEST_SSID);
    printf("  Panjang pwd : %d karakter\n", (int)strlen(TEST_PASSWORD));
    printf("  MAC STA     : " MACSTR "\n", MAC2STR(mac));
    printf("  (daftarkan MAC ini kalau AP pakai MAC filter)\n");

    do_scan();

    bool any_ok = false;
    int  ok_idx = -1;

    for (int i = 0; i < (int)N_VARIANTS; i++) {
        bool ok = try_connect(&VARIANTS[i]);

        s_result_ok[i]     = ok;
        s_result_reason[i] = s_last_reason;
        s_result_rssi[i]   = s_last_rssi;

        if (ok) { any_ok = true; ok_idx = i; break; }

        esp_wifi_disconnect();
        vTaskDelay(pdMS_TO_TICKS(1500));

        // Varian G/H mengubah state radio — kembalikan sebelum varian berikutnya
        if (VARIANTS[i].disable_11b || VARIANTS[i].spoof_mac) {
            restore_radio();
        }
    }

    // ==================== RINGKASAN ====================
    printf("\n\n########## RINGKASAN ##########\n");
    for (int i = 0; i < (int)N_VARIANTS; i++) {
        if (s_result_ok[i]) {
            printf("  [ OK   ] %s\n", VARIANTS[i].name);
        } else if (i <= ok_idx || !any_ok) {
            printf("  [ GAGAL] %s  (reason %u, rssi %d)\n",
                   VARIANTS[i].name, s_result_reason[i], s_result_rssi[i]);
        } else {
            printf("  [ -    ] %s  (tidak dites)\n", VARIANTS[i].name);
        }
    }

    printf("\n########## KESIMPULAN ##########\n");

    if (any_ok) {
        printf("BERHASIL connect dengan varian:\n    %s\n\n",
               VARIANTS[ok_idx].name);

        if (VARIANTS[ok_idx].disable_11b) {
            printf("PENYEBAB DITEMUKAN: AP menolak frame dengan rate 802.11b.\n");
            printf("AP dikonfigurasi dengan minimum data rate / 11b disabled,\n");
            printf("sehingga auth frame ESP (dikirim 1 Mbps) diabaikan.\n\n");
            printf("PERBAIKAN di firmware timbangan — wifi_manager_init(),\n");
            printf("setelah esp_wifi_init() dan SEBELUM esp_wifi_start():\n");
            printf("    esp_wifi_config_11b_rate(WIFI_IF_STA, true);\n");
        } else if (VARIANTS[ok_idx].spoof_mac) {
            printf("PENYEBAB DITEMUKAN: AP memblokir MAC asli board.\n");
            printf("Dengan MAC " MACSTR " koneksi langsung berhasil,\n",
                   MAC2STR(ALT_MAC));
            printf("sedangkan " MACSTR " selalu diabaikan.\n\n",
                   MAC2STR(mac));
            printf("PERBAIKAN: hapus MAC itu dari daftar blokir / tambahkan ke\n");
            printf("whitelist di panel admin AP. Tidak ada yang perlu diubah\n");
            printf("di firmware.\n");
        } else {
            printf("Terapkan setelan varian ini ke do_connect() di\n");
            printf("firmware/timbangan-esp32c3/main/wifi/wifi_manager.cpp\n");
        }
    } else if (!s_target_found) {
        printf("SSID \"%s\" tidak pernah terlihat saat scan.\n", TEST_SSID);
        printf("Periksa ejaan SSID, SSID hidden, atau AP 5GHz-only.\n");
    } else if (s_target_rssi < -80) {
        printf("Semua varian gagal DAN sinyal lemah (%d dBm).\n", s_target_rssi);
        printf("Penyebab paling mungkin: ANTENA / JARAK.\n");
        printf("Dekatkan board ke AP lalu ulangi tes ini.\n");
    } else {
        printf("Semua varian gagal PADAHAL sinyal memadai (%d dBm, %s)\n",
               s_target_rssi, rssi_verdict(s_target_rssi));
        printf("dan AP memakai %s.\n\n", auth_str(s_target_auth));
        printf("Varian G (rate 11b dimatikan) dan H (MAC diganti) JUGA gagal,\n");
        printf("jadi dua penyebab tersering sudah tersingkir.\n\n");
        printf("Sisa kemungkinan, semuanya di sisi AP:\n");
        printf("  1. Batas jumlah client tercapai (mesh penuh)\n");
        printf("  2. Isolasi client / kebijakan keamanan AP\n");
        printf("  3. AP perlu di-reboot — tabel asosiasi bisa stuck\n\n");
        printf("Langkah pembanding: sambungkan HP ke \"%s\" di titik yang sama.\n",
               TEST_SSID);
        printf("HP lancar + board gagal di -41 dBm = pasti kebijakan AP.\n");
    }
    printf("###############################\n");

    if (!any_ok) {
        // Board yang sama di AP berbeda — pemisah paling tegas antara
        // "TX board rusak" dan "AP menolak".
        if (try_alt_network()) {
            printf("\nKESIMPULAN AKHIR: hardware board SEHAT.\n");
            printf("Perbaiki di sisi AP \"%s\" (Deco/mesh):\n", TEST_SSID);
            printf("  - reboot AP, tabel asosiasi bisa stuck\n");
            printf("  - cek daftar perangkat diblokir di aplikasi admin\n");
            printf("  - cek batas jumlah client\n");
            while (1) { vTaskDelay(pdMS_TO_TICKS(10000)); }
        }
        // Gagal di semua AP -> uji jalur transmit secara langsung
        tx_test_softap();
    }

    while (1) {
        int rssi = 0;
        esp_wifi_sta_get_rssi(&rssi);
        printf("[alive] IP %s  RSSI %d dBm\n", s_ip, rssi);
        vTaskDelay(pdMS_TO_TICKS(10000));
    }
}
