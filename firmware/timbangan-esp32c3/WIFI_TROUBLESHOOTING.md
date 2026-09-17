# WiFi Troubleshooting — ESP32 Timbangan

Rangkuman masalah WiFi yang ditemukan dan fix yang diterapkan pada firmware `v4.0.0-esp-idf`.

---

## Masalah yang Ditemukan

### 1. Tidak Ada Hostname (Prioritas Tinggi)

**Gejala:**  
Device sering disconnect, terutama jika ada beberapa ESP32 di jaringan yang sama.

**Penyebab:**  
ESP-IDF secara default mendaftarkan semua ESP32 dengan hostname `"espressif"`. Router melihat banyak perangkat dengan nama identik, menyebabkan konflik DHCP lease dan kick dari AP.

**Fix:**  
Set hostname unik berdasarkan WiFi MAC address, format sama dengan nama BLE advertising.

```cpp
// wifi_manager.cpp — wifi_manager_init()
esp_netif_t* netif = esp_netif_create_default_wifi_sta();

uint8_t mac[6];
esp_read_mac(mac, ESP_MAC_WIFI_STA);
char hostname[48];
snprintf(hostname, sizeof(hostname),
         "%s-timbangan-%02X%02X%02X",
         BLE_DEVICE_NAME_PREFIX, mac[3], mac[4], mac[5]);
esp_netif_set_hostname(netif, hostname);
```

**Hasil:**  
Device muncul di DHCP table router sebagai `Kapitmas-timbangan-670F40` (unik per device).

---

### 2. MQTT Connect Sebelum WiFi Ready (Prioritas Tinggi)

**Gejala:**  
Log penuh dengan error berulang saat booting, sebelum WiFi konek:

```
E esp-tls: connect() error: Host is unreachable
W MQTT: Disconnected
E esp-tls: connect() error: Host is unreachable
W MQTT: Disconnected
... (berulang puluhan kali)
```

**Penyebab:**  
`mqtt_manager_start()` memanggil `esp_mqtt_client_start()` langsung, tanpa menunggu WiFi connected. MQTT client mencoba connect ke broker padahal WiFi belum dapat IP.

**Fix:**  
Ubah `mqtt_manager_start()` menjadi spawn task yang monitor event group WiFi:

```cpp
// mqtt_manager.cpp
static void mqtt_wifi_monitor_task(void* arg) {
    while (true) {
        // Tunggu WiFi connected sebelum mulai MQTT
        xEventGroupWaitBits(g_system_events, SYS_EVENT_WIFI_CONNECTED,
                            pdFALSE, pdTRUE, portMAX_DELAY);

        esp_mqtt_client_start(s_client);

        // Tunggu WiFi disconnect, lalu stop MQTT
        xEventGroupWaitBits(g_system_events, SYS_EVENT_WIFI_DISCONNECTED,
                            pdFALSE, pdTRUE, portMAX_DELAY);

        esp_mqtt_client_stop(s_client);
        s_state = MQTT_STATE_DISCONNECTED;
    }
}
```

**Hasil:**  
MQTT hanya connect setelah WiFi mendapat IP. Saat WiFi putus, MQTT stop bersih. Saat WiFi reconnect, MQTT otomatis reconnect.

---

### 3. AP Men-kick Device (Prioritas Tinggi)

**Gejala:**  
Device disconnect tiba-tiba meskipun RSSI sangat bagus (-36 dBm). Pola di log:

```
wifi:state: run -> init (0xe00)   ← AP yang memutus, bukan device
wifi:pm stop, total sleep time: 0 us / 370327243 us
wifi:<ba-del>idx:0, tid:0
wifi:new:<5,0>, old:<5,1>         ← channel width: 40MHz → 20MHz (teardown)
W WiFi: STA disconnected
E transport_base: tcp_read error, errno=Software caused connection abort
```

**Penyebab:**  
Router modern (WPA2/WPA3 mixed mode) memerlukan **Protected Management Frames (PMF)**. Tanpa PMF:
- Router mengirim unprotected Deauthentication frame
- ESP32 menerimanya sebagai disconnect sah
- Atau router mencoba upgrade ke WPA3-SAE, gagal, lalu deauth

Disconnect reason `0xe00` dari internal WiFi driver menunjukkan AP-initiated disconnect, bukan sinyal drop.

**Fix:**  

```cpp
// wifi_manager.cpp — do_connect()
// PMF capable — wajib untuk router modern (WPA2/WPA3 mixed)
wifi_cfg.sta.pmf_cfg.capable  = true;   // aktif jika AP meminta
wifi_cfg.sta.pmf_cfg.required = false;  // tidak wajib (tetap konek ke AP lama)
```

**Hasil:**  
Device negotiate PMF dengan AP saat handshake. Router tidak lagi men-kick device karena PMF mismatch.

---

### 4. Reason Code Tidak Ter-log (Prioritas Rendah)

**Gejala:**  
Saat disconnect, log hanya menampilkan `"STA disconnected"` tanpa info penyebab. Sulit diagnosa apakah disconnect dari AP atau dari device sendiri.

**Fix:**  

```cpp
// wifi_manager.cpp — wifi_event_handler
case WIFI_EVENT_STA_DISCONNECTED: {
    wifi_event_sta_disconnected_t* disc =
        (wifi_event_sta_disconnected_t*)event_data;
    LOG_W(TAG, "STA disconnected — reason: %d (0x%02x)",
          disc->reason, disc->reason);
    ...
}
```

**Cara baca reason code:**  

| Reason | Kode | Artinya |
|--------|------|---------|
| `4` | `0x04` | Disassociated due to inactivity (AP kick karena idle) |
| `2` | `0x02` | Auth expired (PMF/re-auth timeout) |
| `200` | `0xC8` | Beacon timeout (tidak terima beacon dari AP) |
| `201` | `0xC9` | No AP found (AP tidak terdeteksi) |
| `204` | `0xCC` | Handshake timeout (WPA2 4-way handshake gagal) |

---

## Checklist Diagnosa WiFi

Jika ESP32 sering disconnect, cek urutan ini:

```
1. Apakah RSSI saat disconnect < -80 dBm?
   → Ya: Masalah sinyal. Pindahkan device atau perkuat AP.
   → Tidak: Lanjut ke 2.

2. Apakah log menunjukkan "run -> init" sebelum event disconnect?
   → Ya: AP yang memutus (bukan device). Cek fix PMF (#3).
   → Tidak: Device yang timeout. Cek WIFI_CONNECT_TIMEOUT_MS.

3. Apakah reason code 2 atau 4?
   → Ya: AP-side auth/inactivity. Pastikan PMF enabled.
   → Reason 200: Beacon timeout. Cek interferensi channel WiFi.

4. Apakah banyak ESP32 di jaringan yang sama?
   → Ya: Pastikan hostname unik (#1).

5. Apakah MQTT spam error saat booting?
   → Ya: Terapkan MQTT wifi-aware monitor task (#2).
```

---

## Konfigurasi WiFi yang Direkomendasikan

```c
// app_config.h
#define WIFI_CONNECT_TIMEOUT_MS     15000   // 15s per attempt
#define WIFI_RECONNECT_BASE_MS      2000    // backoff awal 2s
#define WIFI_RECONNECT_MAX_MS       30000   // backoff max 30s
#define WIFI_MAX_ATTEMPTS           10      // sebelum restart
#define WIFI_MIN_RSSI               -90     // threshold warning
```

```cpp
// do_connect() — wifi_manager.cpp
wifi_cfg.sta.threshold.authmode = WIFI_AUTH_WPA2_PSK;
wifi_cfg.sta.pmf_cfg.capable    = true;
wifi_cfg.sta.pmf_cfg.required   = false;
```

```cpp
// wifi_manager_init() — power save HARUS dimatikan
ESP_ERROR_CHECK(esp_wifi_set_ps(WIFI_PS_NONE));
```

---

## File yang Diubah

| File | Perubahan |
|------|-----------|
| `main/wifi/wifi_manager.cpp` | Hostname unik, PMF config, reason code logging |
| `main/mqtt/mqtt_manager.cpp` | WiFi-aware monitor task |

---

## Referensi Reason Code Lengkap

Definisi ada di `esp-idf/components/esp_wifi/include/esp_wifi_types.h`:

```
WIFI_REASON_UNSPECIFIED              = 1
WIFI_REASON_AUTH_EXPIRE              = 2   ← sering terjadi tanpa PMF
WIFI_REASON_AUTH_LEAVE               = 3
WIFI_REASON_ASSOC_EXPIRE             = 4   ← AP kick karena inaktif
WIFI_REASON_ASSOC_TOOMANY            = 5
WIFI_REASON_NOT_AUTHED               = 6
WIFI_REASON_NOT_ASSOCED              = 7
WIFI_REASON_ASSOC_LEAVE              = 8
WIFI_REASON_ASSOC_NOT_AUTHED         = 9
WIFI_REASON_BEACON_TIMEOUT           = 200
WIFI_REASON_NO_AP_FOUND              = 201
WIFI_REASON_AUTH_FAIL                = 202
WIFI_REASON_ASSOC_FAIL               = 203
WIFI_REASON_HANDSHAKE_TIMEOUT        = 204 ← WPA2 4-way gagal
WIFI_REASON_CONNECTION_FAIL          = 205
WIFI_REASON_AP_TSF_RESET             = 206
WIFI_REASON_ROAMING                  = 207
```
