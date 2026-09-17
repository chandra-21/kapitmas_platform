# Tes WiFi — ESP32-C3 Super Mini

Firmware diagnostik mandiri untuk mencari penyebab `WIFI_REASON_AUTH_EXPIRE`
(reason 2) pada `timbangan-esp32c3`. Tidak ada BLE, MQTT, UART, NVS config,
maupun OTA — murni WiFi, supaya tidak ada variabel lain yang mengganggu.

> **Kredensial WiFi tertanam di source** (`main/wifi_test.c` baris `TEST_SSID` /
> `TEST_PASSWORD`). Ini project tes sekali pakai — ganti dulu atau jangan
> commit isinya ke repo publik.

## Cara pakai

```powershell
$env:IDF_TARGET = "esp32c3"
cd firmware/wifi-test-esp32c3
idf.py set-target esp32c3
idf.py build
idf.py -p COM3 flash monitor
```

## Yang dilakukan

1. **Scan lengkap** — tabel semua AP: SSID, RSSI, channel, authmode, BSSID.
   AP target ditandai `-->`.
2. **Enam varian koneksi** dicoba berurutan sampai ada yang berhasil:

   | Varian | Menguji hipotesis |
   |---|---|
   | A. Default | setelan yang dipakai firmware timbangan sekarang |
   | B. Threshold OPEN | threshold `WPA2_PSK` menolak AP |
   | C. PMF required | AP WPA3 yang mewajibkan PMF |
   | D. SAE hunt-and-peck | AP WPA3 lama yang belum mendukung H2E |
   | E. Tanpa PMF | PMF justru yang bikin AP menolak |
   | F. Kunci BSSID + channel | node mesh tertentu yang bermasalah |

3. **Ringkasan + kesimpulan otomatis** — menunjuk ke antena, sisi AP, atau
   setelan yang berhasil.
4. **Monitor RSSI** kalau semua gagal: scan tiap 3 detik supaya board bisa
   dibawa berjalan mendekati AP sambil mengamati angka RSSI.

## Membaca hasilnya

Kunci diagnosanya ada di **RSSI**, yang tetap terbaca walau koneksi tidak
pernah berhasil — `wifi_event_sta_disconnected_t` di ESP-IDF 5.x membawa field
`rssi`, jadi tiap kegagalan tetap melaporkan kekuatan sinyal saat itu.

| Hasil | Kesimpulan |
|---|---|
| Ada varian yang **OK** | Bukan masalah hardware. Terapkan setelan varian itu ke `wifi_manager.cpp` |
| Semua gagal, RSSI < −80 | Antena/jarak. Dekatkan board ke AP dan ulangi |
| Semua gagal, RSSI > −70 | Sisi AP: MAC filter, batas client, atau kebijakan keamanan |
| SSID tidak pernah muncul | Salah ejaan, SSID hidden, atau AP 5 GHz-only (C3 hanya 2.4 GHz) |

Pembanding paling cepat: sambungkan HP ke SSID yang sama **di titik yang sama**.
Kalau HP lancar sementara board gagal dengan RSSI bagus, masalahnya bukan
lingkungan RF.

## Hasil pemakaian pertama (Agustus 2026)

Firmware ini dipakai untuk melacak kegagalan `AUTH_EXPIRE` pada board C3 Super
Mini pertama. Hasilnya: **board cacat pada jalur transmit**.

| Bukti | Nilai |
|---|---|
| RSSI AP target | −41 dBm (sangat baik) |
| Authmode AP | `WPA2_PSK` — bukan WPA3 |
| Varian A–H | semua `AUTH_EXPIRE`, termasuk MAC diganti dan 11b dimatikan |
| SoftAP `KAPITMAS-TXTEST` | tidak terlihat sama sekali dari HP |
| HP di titik yang sama | connect normal |
| Board pengganti | langsung jalan, firmware identik |

Pelajarannya: **RSSI bagus tidak membuktikan radio sehat** — RSSI murni sisi
terima. Board bisa punya RX sempurna sekaligus TX mati. BLE yang berhasil juga
bukan bukti TX sehat, karena jaraknya beberapa sentimeter.

Karena itu urutan tes di firmware ini penting: varian A–H menyingkirkan
konfigurasi, jaringan pembanding menyingkirkan kebijakan AP, dan SoftAP adalah
satu-satunya bagian yang benar-benar menguji jalur transmit.

Pakai firmware ini sebagai **QC board masuk** sebelum board dipasang di lapangan.
