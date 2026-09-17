#include "serial_reader.h"
#include "logger.h"

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "driver/uart.h"
#include "esp_wifi.h"
#include "esp_timer.h"
#include <string.h>
#include <stdlib.h>
#include <ctype.h>
#include <time.h>

// ==================== PRIVATE ====================

static const char* TAG = "Serial";

static QueueHandle_t s_weight_queue     = NULL;
static float         s_realtime_weight  = 0.0f;
static bool          s_waiting_for_zero = false;
static bool          s_tare_mode        = false;

// Spinlock untuk proteksi s_realtime_weight dari race condition
static portMUX_TYPE  s_weight_mux       = portMUX_INITIALIZER_UNLOCKED;

// Threshold deteksi nol dan negatif (tare)
#define ZERO_THRESHOLD   0.01f
#define TARE_THRESHOLD  -0.01f

extern EventGroupHandle_t g_system_events;
extern char g_device_name[32];

// ==================== HELPER ====================

// Format timbangan: "WTST    31.0   g" (16 char fixed-width)
// Status 4 char pertama: WTST=stable, WUNST=unstable, OL=overload, dll.
static bool is_weight_stable(const char* line) {
    return strncmp(line, "WTST", 4) == 0;
}

// Search longest known units first to avoid "g" matching inside "kg".
// Word-boundary check: char before and after must not be alpha.
static void extract_unit(const char* str, char* out, size_t out_len) {
    static const char* const known[] = {
        "ton", "TON",
        "kg",  "KG",  "Kg",
        "lb",  "LB",  "Lb",
        "g",   "G",
        "t",   "T",
    };
    for (int i = 0; i < (int)(sizeof(known) / sizeof(known[0])); i++) {
        const char* p = strstr(str, known[i]);
        if (!p) continue;

        bool before_ok = (p == str) || !isalpha((unsigned char)*(p - 1));
        size_t ulen    = strlen(known[i]);
        bool after_ok  = !isalpha((unsigned char)*(p + ulen));

        if (before_ok && after_ok) {
            strncpy(out, known[i], out_len - 1);
            out[out_len - 1] = '\0';
            // Normalize to lowercase
            for (size_t j = 0; out[j]; j++)
                out[j] = (char)tolower((unsigned char)out[j]);
            return;
        }
    }
    strncpy(out, "kg", out_len - 1);
    out[out_len - 1] = '\0';
}

// Ambil string angka verbatim dari serial line.
// Contoh: "WTST    31.0   g" → "31.0" (bukan "31.00" atau "31.000")
// Mendukung nilai negatif: "WTST   -31.0   g" → "-31.0"
static void extract_weight_str(const char* line, char* out, size_t out_len) {
    const char* p = line;
    // Lewati prefix non-angka (status code + spasi), tapi perhatikan tanda minus
    while (*p && *p != '-' && !(*p >= '0' && *p <= '9')) p++;
    const char* start = p;
    while (*p && ((*p >= '0' && *p <= '9') || *p == '.' || (*p == '-' && p == start))) p++;
    size_t len = (size_t)(p - start);
    if (len == 0 || len >= out_len) {
        strncpy(out, "0", out_len - 1);
        out[out_len - 1] = '\0';
        return;
    }
    strncpy(out, start, len);
    out[len] = '\0';
}

static float extract_weight(const char* str) {
    char num[16] = {0};
    int j = 0;

    for (int i = 0; str[i] && j < 15; i++) {
        if (str[i] == '-' && j == 0) {
            num[j++] = str[i];
        } else if (str[i] >= '0' && str[i] <= '9') {
            num[j++] = str[i];
        } else if (str[i] == '.' && j > 0) {
            num[j++] = str[i];
        }
    }
    num[j] = '\0';
    return (j > 0) ? atof(num) : 0.0f;
}

// ==================== SERIAL TASK ====================

static void serial_task(void* arg) {
    uint8_t  buf[UART2_BUFFER_SIZE];
    char     line[UART2_BUFFER_SIZE];
    int      idx          = 0;
    uint32_t last_read_ms = 0;

    while (true) {
        int len = uart_read_bytes(UART_NUM_2, buf, sizeof(buf) - 1,
                                  pdMS_TO_TICKS(20));

        if (len <= 0) {
            vTaskDelay(pdMS_TO_TICKS(10));
            continue;
        }

        for (int i = 0; i < len; i++) {
            char c = (char)buf[i];

            if (c == '\n' || c == '\r') {
                if (idx > 0) {
                    line[idx] = '\0';
                    float weight = extract_weight(line);

                    // Selalu update realtime weight (dengan critical section)
                    portENTER_CRITICAL(&s_weight_mux);
                    s_realtime_weight = weight;
                    portEXIT_CRITICAL(&s_weight_mux);

                    if (!is_weight_stable(line)) {
                        LOG_D(TAG, "Skip (not stable): %s", line);
                        idx = 0;
                        continue;
                    }

                    char unit_tmp[8]        = {0};
                    char weight_str_tmp[16] = {0};
                    extract_unit(line, unit_tmp, sizeof(unit_tmp));
                    extract_weight_str(line, weight_str_tmp, sizeof(weight_str_tmp));
                    LOG_D(TAG, "Stable: %s -> %s %s", line, weight_str_tmp, unit_tmp);

                    uint32_t now_ms = (uint32_t)(esp_timer_get_time() / 1000ULL);

                    // ========== LOGIKA BERAT POSITIF ==========
                    if (weight > ZERO_THRESHOLD) {

                        if (!s_waiting_for_zero &&
                            (now_ms - last_read_ms) >= UART2_MIN_INTERVAL_MS) {

                            weight_data_t data = {};
                            data.weight    = weight;
                            data.timestamp = (int64_t)time(NULL);
                            data.rssi      = 0;

                            int rssi = 0;
                            esp_wifi_sta_get_rssi(&rssi);
                            data.rssi = rssi;

                            strncpy(data.device_name, g_device_name,
                                    sizeof(data.device_name) - 1);
                            strncpy(data.unit,       unit_tmp,       sizeof(data.unit)       - 1);
                            strncpy(data.weight_str, weight_str_tmp, sizeof(data.weight_str) - 1);

                            if (uxQueueSpacesAvailable(s_weight_queue) == 0) {
                                weight_data_t dummy;
                                xQueueReceive(s_weight_queue, &dummy, 0);
                                LOG_W(TAG, "Queue full - dropped oldest");
                            }

                            if (xQueueSend(s_weight_queue, &data,
                                           pdMS_TO_TICKS(100)) == pdTRUE) {
                                s_waiting_for_zero = true;
                                s_tare_mode        = false;
                                last_read_ms       = now_ms;
                                xEventGroupSetBits(g_system_events,
                                                   SYS_EVENT_SERIAL_ACTIVE);
                                LOG_I(TAG, "Weight queued: %.2f %s (tare_mode was: %s)",
                                      weight, data.unit,
                                      s_tare_mode ? "yes" : "no");
                            }
                        } else {
                            LOG_D(TAG, "Skipped positive: waiting_for_zero=%d interval=%lu ms",
                                  (int)s_waiting_for_zero,
                                  (unsigned long)(now_ms - last_read_ms));
                        }

                    // ========== LOGIKA BERAT NEGATIF (KONDISI TARE) ==========
                    } else if (weight < TARE_THRESHOLD) {
                        /*
                         * Berat negatif terjadi ketika:
                         * - Tare sudah ditekan dengan beban di atas timbangan
                         * - Kemudian beban diangkat → nilai jadi negatif
                         *
                         * Jika sebelumnya sudah ada penimbangan (waiting_for_zero=true),
                         * ini berarti siklus tare baru dimulai.
                         * Reset waiting_for_zero agar penimbangan berikutnya bisa masuk.
                         * Set s_tare_mode = true sebagai penanda kita dalam siklus tare.
                         */
                        if (s_waiting_for_zero) {
                            LOG_I(TAG, "Tare detected (prev weight recorded) - new cycle ready");
                            s_waiting_for_zero = false;
                            s_tare_mode        = true;
                        } else if (!s_tare_mode) {
                            /*
                             * Negatif tanpa penimbangan sebelumnya (tare ditekan
                             * di awal atau timbangan dikalibrasi ulang).
                             * Tandai tare_mode agar tidak langsung queue saat naik ke positif.
                             */
                            LOG_D(TAG, "Negative weight without prior record: %.2f %s"
                                       " - entering tare mode", weight, unit_tmp);
                            s_tare_mode = true;
                        } else {
                            LOG_D(TAG, "Tare mode ongoing: %.2f %s", weight, unit_tmp);
                        }

                    // ========== LOGIKA MENDEKATI NOL ==========
                    } else {
                        /*
                         * Nilai mendekati nol:
                         * - Timbangan kosong / beban diangkat setelah penimbangan normal
                         * - Atau tare selesai dan beban dikembalikan ke posisi nol
                         */
                        if (s_waiting_for_zero) {
                            LOG_D(TAG, "Back to zero after normal weigh - ready");
                        }
                        if (s_tare_mode) {
                            LOG_D(TAG, "Tare cycle returned to zero - ready");
                            s_tare_mode = false;
                        }
                        s_waiting_for_zero = false;
                    }

                    idx = 0;
                }
            } else if (idx < UART2_BUFFER_SIZE - 1) {
                line[idx++] = c;
            } else {
                // Buffer overflow: line terlalu panjang / data corrupt → reset
                LOG_W(TAG, "Line buffer overflow - resetting");
                idx = 0;
            }
        }

        vTaskDelay(pdMS_TO_TICKS(10));
    }
}

// ==================== PUBLIC API ====================

void serial_reader_init(void) {
    uart_config_t uart_cfg = {};
    uart_cfg.baud_rate  = UART2_BAUD_RATE;
    uart_cfg.data_bits  = UART_DATA_8_BITS;
    uart_cfg.parity     = UART_PARITY_DISABLE;
    uart_cfg.stop_bits  = UART_STOP_BITS_1;
    uart_cfg.flow_ctrl  = UART_HW_FLOWCTRL_DISABLE;
    uart_cfg.source_clk = UART_SCLK_DEFAULT;

    ESP_ERROR_CHECK(uart_driver_install(UART_NUM_2,
                                        UART2_BUFFER_SIZE * 2, 0, 0, NULL, 0));
    ESP_ERROR_CHECK(uart_param_config(UART_NUM_2, &uart_cfg));
    ESP_ERROR_CHECK(uart_set_pin(UART_NUM_2,
                                  PIN_UART2_TX, PIN_UART2_RX,
                                  UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE));

    LOG_I(TAG, "UART2 initialized - baud: %d | RX: %d | TX: %d",
          UART2_BAUD_RATE, PIN_UART2_RX, PIN_UART2_TX);
}

void serial_reader_start(QueueHandle_t weight_queue) {
    s_weight_queue = weight_queue;

    xTaskCreatePinnedToCore(
        serial_task,
        "serial_task",
        UART2_TASK_STACK,
        NULL,
        UART2_TASK_PRIORITY,
        NULL,
        1
    );

    LOG_I(TAG, "Serial reader started");
}

float serial_reader_get_realtime_weight(void) {
    float w;
    portENTER_CRITICAL(&s_weight_mux);
    w = s_realtime_weight;
    portEXIT_CRITICAL(&s_weight_mux);
    return w;
}