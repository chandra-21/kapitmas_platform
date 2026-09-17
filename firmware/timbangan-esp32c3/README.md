# Timbangan — ESP32-C3 Super Mini

Port firmware timbangan (`firmware/timbangan-esp32`) ke board **ESP32-C3 Super Mini**.

Logika aplikasi — parsing serial timbangan, deteksi tare, MQTT, OTA, provisioning BLE —
**identik** dengan versi ESP32. Yang berbeda hanya hal-hal yang menempel ke hardware.
Backend tidak perlu diubah: `type` tetap `timbangan`, endpoint tetap
`/api/provisioning/complete`, topik MQTT tetap `kapitmas/timbangan/{device_name}/...`.

---

## Pinout

| Fungsi | GPIO | Catatan |
|---|---|---|
| LED status (LED1) | **8** | LED biru onboard — **active LOW** |
| LED data (LED2) | **10** | LED eksternal, active HIGH (opsional) |
| Tombol BOOT | **9** | Tombol onboard, active LOW |
| UART1 RX ← TX timbangan | **20** | Silkscreen `RX` |
| UART1 TX → RX timbangan | **21** | Silkscreen `TX` — tidak dipakai firmware ini |

GPIO yang **tidak boleh** dipakai: `11–17` (flash internal), `18`/`19` (USB D-/D+).

Wiring timbangan (TTL 9600 8N1):

```
Timbangan TX  ──►  GPIO20 (RX)
Timbangan GND ──►  GND
```

Kalau timbangan mengeluarkan level RS-232 (±12V), tetap butuh konverter MAX3232 —
sama seperti pada versi ESP32.

Alternatif jika GPIO20/21 sudah terpakai: GPIO4 (RX) dan GPIO5 (TX). Ubah
`PIN_UART1_RX` / `PIN_UART1_TX` di `main/config/app_config.h`.

---

## Perbedaan dari versi ESP32

| Hal | ESP32 | ESP32-C3 Super Mini |
|---|---|---|
| Core | Dual-core Xtensa | **Single-core RISC-V** |
| Pembuatan task | `xTaskCreatePinnedToCore(..., core)` | `xTaskCreate(...)` — tidak ada core affinity |
| UART timbangan | UART2 (GPIO16/17) | **UART1** (GPIO20/21) — C3 tidak punya UART2 |
| LED status | GPIO19, active HIGH | GPIO8 onboard, **active LOW** (`LED1_ACTIVE_LOW`) |
| Console serial | UART0 | **USB Serial/JTAG** (lewat port USB-C board) |
| Bluetooth | Bluedroid, Classic BT dilepas saat init | Controller BLE-only; `esp_bt_controller_mem_release(CLASSIC_BT)` di-guard `#if CONFIG_IDF_TARGET_ESP32` |
| Field `chip` | `"ESP32"` | `"ESP32-C3"` (macro `DEVICE_CHIP`) |
| `sdkconfig.defaults` | ada di `main/` (tidak terbaca ESP-IDF) | dipindah ke **root project** |

Polaritas LED diatur lewat macro di `app_config.h`, bukan disebar di kode:

```c
#define LED1_ACTIVE_LOW  1
#define LED1_LEVEL(on)   (LED1_ACTIVE_LOW ? !(on) : (on))
```

Kalau nanti pakai board C3 lain yang LED-nya active HIGH, cukup ubah satu baris.

---

## Build & Flash

```powershell
# Windows PowerShell
. C:\esp\v5.5.5\esp-idf\export.ps1

cd firmware/timbangan-esp32c3
idf.py set-target esp32c3      # WAJIB sekali di awal — lihat catatan di bawah
idf.py build
idf.py -p COM<n> flash monitor
```

### Kenapa `set-target` wajib

ESP-IDF memilih target dengan urutan (lihat `__target_init` di
`tools/cmake/targets.cmake`):

1. environment variable `IDF_TARGET`
2. variabel CMake `IDF_TARGET`
3. tebakan dari `sdkconfig` / `sdkconfig.defaults`

Kalau shell Anda masih membawa `IDF_TARGET=esp32` (umum terjadi kalau sebelumnya
kerja di `timbangan-esp32`, atau terminal dibuka lewat extension ESP-IDF VS Code
yang punya `idf.customExtraVars`), env var itu **menang** atas `sdkconfig.defaults`.
Dulu ini lolos diam-diam dan menghasilkan binary Xtensa yang baru ketahuan salah saat
`esptool` menolak flash (`This chip is ESP32-C3, not ESP32`).

Sekarang `CMakeLists.txt` punya guard yang menghentikan build dengan pesan jelas
kalau `IDF_TARGET` bukan `esp32c3`. `idf.py set-target esp32c3` memaksa env var ke
nilai yang benar, jadi itu cara paling aman.

Kalau target sudah terlanjur salah:

```powershell
Remove-Item -Recurse -Force build, sdkconfig -ErrorAction SilentlyContinue
idf.py set-target esp32c3
idf.py build
```

Verifikasi cepat sebelum flash — harus `esp32c3` / `riscv`:

```powershell
Select-String -Path sdkconfig -Pattern '^CONFIG_IDF_TARGET(_ARCH)?='
```

**Catatan flashing:** board Super Mini pakai USB native. Kalau port COM tidak muncul,
masuk download mode manual: tahan **BOOT**, tekan **RESET**, lepas **RESET**, lalu lepas **BOOT**.
Setelah flash pertama, port serial berpindah ke USB Serial/JTAG dan `idf.py monitor`
akan jalan normal.

---

## Provisioning

Sama persis dengan versi ESP32 — aplikasi Flutter tidak perlu diubah.

- Nama BLE advertising: `Kapitmas-timbangan-XXXXXX`
- Service UUID: `4fafc201-1fb5-459e-8fcc-c5c9c331914b`
- Payload `CHAR_DEVICE_CONFIG`:

```json
{
  "name": "Timbangan_01",
  "room_id": "Gudang_A",
  "mqtt_host": "192.168.1.100",
  "backend_host": "192.168.1.100",
  "backend_port": 8000
}
```

Tombol BOOT (GPIO9):
- tahan **5 detik** (saat device jalan) → masuk mode BLE provisioning
- tahan **10 detik** (saat device jalan) → factory reset (NVS dihapus, device restart)

> GPIO9 juga strapping pin. Menahan BOOT **saat device di-reset** membuat chip masuk
> download mode, bukan factory reset. Tekan tombolnya setelah device booting normal.

---

## QC board sebelum pemasangan

Board ESP32-C3 Super Mini pertama yang dipakai ternyata **cacat pada jalur
transmit**: RX sempurna (−41 dBm, 9 AP terlihat saat scan) dan BLE provisioning
berhasil, tapi tidak satu pun frame auth WiFi sampai ke AP — semua percobaan
berakhir `WIFI_REASON_AUTH_EXPIRE` (reason 2). Board pengganti langsung jalan
dengan firmware yang sama persis.

Kegagalan ini menipu karena **RSSI hanya mengukur sisi terima**. RSSI bagus
tidak membuktikan board bisa memancar, dan BLE yang berhasil pun tidak — BLE
dipakai pada jarak beberapa sentimeter dan jauh lebih toleran.

Kalau ada board baru gagal connect padahal RSSI bagus, pakai
[`firmware/wifi-test-esp32c3/`](../wifi-test-esp32c3/) sebagai alat QC. Firmware
itu mencoba 8 varian konfigurasi, menguji jaringan pembanding, dan memancarkan
SoftAP untuk menguji jalur transmit secara langsung.

Untuk menyalakan scan diagnostik pada firmware ini, set
`WIFI_SCAN_DIAGNOSTIC` = 1 di `main/config/app_config.h`.

## Catatan operasional

- **Log saat tidak ada PC.** Console lewat USB Serial/JTAG. ESP-IDF punya connection
  monitor yang mendeteksi host lepas dan membuang output, jadi device tetap jalan
  normal walau hanya dicolok ke adaptor charger.
- **Simbol sdkconfig yang dibuang.** `CONFIG_LWIP_TCP_KEEPALIVE`, `KEEPIDLE`,
  `KEEPINTVL`, `KEEPCNT` di `timbangan-esp32/main/sdkconfig.defaults` bukan simbol
  Kconfig ESP-IDF yang valid (sudah dicek terhadap Kconfig IDF v5.5.5) — keepalive TCP
  diatur per-socket lewat `setsockopt`, bukan sdkconfig. Simbol itu tidak dibawa ke
  sini. Deteksi koneksi mati tetap ditangani heartbeat 10 detik +
  `MQTT_MAX_DISCONNECTED_MS`.
- `CONFIG_ESP_WIFI_TX_BUFFER_TYPE_DYNAMIC` juga bukan simbol valid; nama yang benar
  `CONFIG_ESP_WIFI_DYNAMIC_TX_BUFFER`.

---

## Partisi

Layout `partitions.csv` sengaja dibuat identik dengan versi ESP32 supaya batas ukuran
binary OTA sama (app partition 1.5MB). Total 3.5MB, muat di flash 4MB board Super Mini.
