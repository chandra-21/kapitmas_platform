<div align="center">

# KAIIS — Kapitmas AI IoT Integrated System

**Platform IoT industri: dari firmware ESP32 sampai dashboard realtime**

Mengelola timbangan digital dan pengendali AC/lampu di lapangan — provisioning
perangkat, telemetri lewat MQTT, penjadwalan, dan pemantauan langsung dalam satu
sistem.

`FastAPI` · `PostgreSQL` · `MQTT` · `React` · `TypeScript` · `ESP-IDF` · `Docker`

</div>

---

## Cakupan

Proyek ini menjangkau tiga lapisan sekaligus, dan tiap lapisan punya kendalanya
sendiri:

| Lapisan | Teknologi | Isi |
|---|---|---|
| **Perangkat** | ESP-IDF (C/C++) | firmware ESP32 dan ESP32-C3: timbangan, SmartBuddy, captive portal provisioning, OTA |
| **Backend** | FastAPI, SQLAlchemy, PostgreSQL, Mosquitto | registry perangkat, handler MQTT, scheduler, API, SSE |
| **Antarmuka** | React, TypeScript, TanStack Query | dashboard realtime, manajemen perangkat dan unit aset |

Dua jenis perangkat ditangani:

- **Timbangan** — mengirim pembacaan berat dan status secara berkala
- **SmartBuddy** — pengendali AC dan lampu, dengan mode PIR dan jadwal on/off

## Registry perangkat yang dapat diperluas

Model `Device` bersifat universal: satu tabel untuk semua jenis perangkat, dengan
field `type` yang menentukan modul mana yang menanganinya. Detail spesifik per jenis
tinggal di tabel ekstensi 1:1 — `TimbanganDevice` menyimpan berat dan konsumsi,
`SmartBuddyDevice` menyimpan status AC (`ac_power`, `ac_mode`, `ac_temp`, `ac_fan`,
`swing_v`), status lampu (`lamp_power`, `lamp_mode`, `pir_timeout`), dan array jadwal
dalam bentuk JSON.

Menambah jenis perangkat baru — doorlock, misalnya — berarti menambah satu modul dan
satu tabel ekstensi, bukan mengubah registry.

### Unit aset vs perangkat

Pemisahan yang membuat sistem ini berguna dalam operasi nyata: **`AssetUnit` adalah
posisi fisik, `Device` adalah perangkat yang sedang menempatinya.** Sebuah timbangan
rusak dapat ditukar tanpa kehilangan riwayat posisi itu.

`DeviceUnitHistory` mencatat setiap penugasan dengan **field snapshot**, bukan
referensi. Nama perangkat dan lokasi disalin pada saat penugasan dicatat, sehingga
riwayat tetap terbaca benar meskipun perangkatnya kemudian dihapus atau lokasinya
diganti nama.

## Dua jenis sesi database

Invarian paling penting di backend ini, dan sumber bug paling halus kalau dilanggar:

| Sesi | Dipakai oleh |
|---|---|
| `get_async_db` → `AsyncSession` | endpoint FastAPI |
| `get_sync_db` → `Session` (psycopg2) | handler MQTT dan scheduler |

Alasannya: callback MQTT dan scheduler berjalan di **thread**, bukan di dalam event
loop async. Memakai `AsyncSession` di sana gagal dengan cara yang sulit dilacak —
kadang jalan, kadang menggantung. Di jalur sinkron dipakai `SyncDBContext` atau
`get_sync_db`, tidak pernah dicampur.

## MQTT

Topik disusun berjenjang per perangkat:

```
kapitmas/timbangan/{device_name}/weight   status   config   ota
kapitmas/smartbuddy/{device_name}/...
```

Format lama (`weight/{device_name}`, `status/{device_name}`) masih didukung karena
perangkat yang sudah terpasang di lapangan tidak bisa di-flash serentak —
kompatibilitas mundur di sini bukan kemewahan, melainkan syarat agar migrasi bisa
bertahap.

Scheduler per modul menangani pekerjaan periodik: backup harian, deteksi perangkat
yang berhenti melapor, dan sinkronisasi jadwal SmartBuddy.

## Provisioning perangkat

Perangkat baru menyala dalam mode SoftAP dan menyajikan captive portal
(`web_portal.cpp`) di alamat standar ESP32, `192.168.4.1`. Teknisi memasukkan
kredensial WiFi dan alamat server lewat halaman itu; perangkat lalu mendaftarkan diri
ke `POST /api/provisioning/complete`.

Endpoint provisioning bersifat **upsert**: mendaftarkan ulang perangkat yang sudah ada
tidak menghasilkan duplikat, dan bila `type=timbangan` maka baris `TimbanganDevice`
dibuat otomatis. Ini penting karena di lapangan perangkat kerap di-reset dan
didaftarkan ulang.

## Izin

Model izin berbasis **baris per izin** di tabel `user_permissions`, dengan satu jalan
pintas: peran `admin` melewati seluruh pemeriksaan.

```python
require_permission("key")   # admin selalu lolos; PIC dicek ke user_permissions
require_admin               # admin saja
get_current_user            # verifikasi Bearer token Firebase
get_current_user_sse        # menerima token dari header ATAU query ?token=
```

Varian `get_current_user_sse` ada karena `EventSource` di browser tidak dapat mengirim
header `Authorization`, sehingga token harus bisa datang lewat query string untuk
koneksi streaming.

## Catatan migrasi

`create_all_tables()` berjalan saat startup dan otomatis membuat tabel untuk model
baru. Konsekuensinya pada migrasi Alembic: tabel yang hendak di-rename atau dibuat
ulang mungkin **sudah ada** karena dibuat oleh `create_all_tables`. Karena itu setiap
migrasi semacam itu perlu penjaga `DROP TABLE IF EXISTS ... CASCADE` sebelum
`create_table` atau `rename_table`.

Pola `get_full()`: method service yang melakukan mutasi (create, update, assign)
mengembalikan data hasil JOIN, bukan objek ORM mentah. Dengan begitu schema respons
yang memuat field turunan (`location_name`, `device_name`, `available`) selalu
terpenuhi tanpa query tambahan di router.

---

## Arsitektur

```
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│ Timbangan    │   │ SmartBuddy   │   │ (doorlock)   │  ESP32 / ESP32-C3
│ ESP32        │   │ ESP32        │   │              │  ESP-IDF
└──────┬───────┘   └──────┬───────┘   └──────────────┘
       │  MQTT            │  MQTT
       └────────┬─────────┘
                ▼
        ┌───────────────┐
        │  Mosquitto    │
        └───────┬───────┘
                │
┌───────────────▼─────────────────────────────────────┐
│  FastAPI                                            │
│                                                     │
│  modules/   timbangan, smartbuddy, asset_units,     │
│             users, locations, notifications, auth   │
│             ├── service.py      operasi DB          │
│             ├── router.py       endpoint            │
│             ├── mqtt_handler.py pesan masuk (sync)  │
│             └── scheduler.py    tugas periodik      │
│                                                     │
│  api/       provisioning, devices, system           │
│  adapters/  odoo                                    │
└───────┬──────────────────────────────┬──────────────┘
        │ SQLAlchemy                   │ SSE + REST
┌───────▼────────┐           ┌─────────▼──────────────┐
│  PostgreSQL    │           │  React + TypeScript    │
│                │           │  TanStack Query        │
└────────────────┘           └────────────────────────┘
```

Daftar lengkap topik MQTT beserta format payload-nya ada di
[`docs/mqtt-topics.md`](docs/mqtt-topics.md).

---

## Menjalankan

Prasyarat: Docker dan Docker Compose. Untuk firmware: ESP-IDF v5.x.

```bash
cp backend/.env.example backend/.env    # isi DATABASE_URL, MQTT, Firebase
docker compose up -d                    # postgres, mosquitto, backend, frontend
```

| Layanan | Alamat |
|---|---|
| Backend | `http://localhost:8000` |
| Dokumentasi API | `http://localhost:8000/docs` |
| Frontend | `http://localhost:5173` |

### Backend tanpa Docker

```bash
cd backend
pip install -r requirements.txt
make migrate                            # alembic upgrade head
make dev                                # uvicorn --reload, port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

### Firmware

```bash
cd firmware/timbangan-esp32
idf.py build flash monitor
```

Tersedia empat target: `timbangan-esp32`, `timbangan-esp32c3`, `smartbuddy-esp32`,
dan `wifi-test-esp32c3` untuk pengujian konektivitas.

### Environment

Backend memerlukan service account Firebase untuk verifikasi token. Letakkan
berkasnya sesuai `FIREBASE_SERVICE_ACCOUNT_PATH` dan jangan pernah di-commit —
`.gitignore` menutup `backend/secrets/` dan seluruh pola `.env`.

`JWT_SECRET` default bernilai `change-me-in-production` dan wajib diganti sebelum
dipakai di luar pengembangan.

---

## Catatan

Repositori ini dipublikasikan sebagai portofolio dengan riwayat yang dimulai bersih.
Tidak ada kredensial, service account, berkas `.env`, atau data perangkat yang
disertakan. Alamat IP mesin pengembang dan hostname internal telah diganti
placeholder; alamat `192.168.4.1` yang muncul di firmware adalah alamat SoftAP
standar ESP32, bukan alamat jaringan internal.

Dibangun untuk kebutuhan PT. Kapitmas. Merek dan nama perusahaan adalah milik mereka.

## Author

**Candra Gd**
