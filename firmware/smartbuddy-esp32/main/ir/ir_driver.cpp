#include "ir_driver.h"
#include "logger.h"
#include "app_config.h"

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "driver/rmt_tx.h"
#include "driver/rmt_rx.h"
#include "driver/rmt_encoder.h"
#include <string.h>
#include <stdlib.h>

static const char* TAG = "IR";

// ==================== TX ====================

static rmt_channel_handle_t s_tx_chan     = NULL;
static rmt_encoder_handle_t s_copy_enc    = NULL;
static uint32_t             s_carrier_hz  = IR_CARRIER_HZ_DEFAULT;

void ir_driver_tx_init(uint32_t carrier_hz) {
    s_carrier_hz = carrier_hz;

    rmt_tx_channel_config_t tx_cfg = {};
    tx_cfg.gpio_num          = (gpio_num_t)PIN_IR_TX;
    tx_cfg.clk_src           = RMT_CLK_SRC_DEFAULT;
    tx_cfg.resolution_hz     = IR_TX_RESOLUTION_HZ;
    tx_cfg.mem_block_symbols = IR_TX_MEM_SYMBOLS;
    tx_cfg.trans_queue_depth = IR_TX_QUEUE_DEPTH;
    tx_cfg.flags.invert_out  = false;
    tx_cfg.flags.with_dma    = false;

    ESP_ERROR_CHECK(rmt_new_tx_channel(&tx_cfg, &s_tx_chan));

    ir_driver_tx_set_carrier(carrier_hz);

    rmt_copy_encoder_config_t copy_cfg = {};
    ESP_ERROR_CHECK(rmt_new_copy_encoder(&copy_cfg, &s_copy_enc));

    ESP_ERROR_CHECK(rmt_enable(s_tx_chan));

    LOG_I(TAG, "IR TX initialized (GPIO %d, %lu Hz)", PIN_IR_TX, (unsigned long)carrier_hz);
}

void ir_driver_tx_set_carrier(uint32_t carrier_hz) {
    if (!s_tx_chan) return;

    s_carrier_hz = carrier_hz;

    rmt_carrier_config_t carrier = {};
    carrier.frequency_hz = carrier_hz;
    carrier.duty_cycle   = 0.33f;

    ESP_ERROR_CHECK(rmt_apply_carrier(s_tx_chan, &carrier));
}

bool ir_driver_send_raw(const uint16_t* timings, size_t count) {
    if (!s_tx_chan || !s_copy_enc || !timings || count == 0) return false;

    // Konversi timing array ke rmt_symbol_word_t[]
    // Setiap symbol = satu mark+space pair
    size_t num_symbols = (count + 1) / 2;
    rmt_symbol_word_t* symbols = (rmt_symbol_word_t*)malloc(
        num_symbols * sizeof(rmt_symbol_word_t));
    if (!symbols) {
        LOG_E(TAG, "malloc failed for %d symbols", (int)num_symbols);
        return false;
    }

    for (size_t i = 0; i < num_symbols; i++) {
        size_t idx = i * 2;
        // level1=1 (mark: carrier ON), duration = mark time
        symbols[i].level0    = 1;
        symbols[i].duration0 = (idx < count) ? timings[idx] : 0;
        // level0=0 (space: carrier OFF), duration = space time
        symbols[i].level1    = 0;
        symbols[i].duration1 = (idx + 1 < count) ? timings[idx + 1] : 0;
    }

    // Pastikan simbol terakhir punya end pulse
    if (count % 2 == 1 && num_symbols > 0) {
        symbols[num_symbols - 1].duration1 = 10000; // 10ms trailing space
    }

    rmt_transmit_config_t tx_config = {};
    tx_config.loop_count = 0;

    esp_err_t err = rmt_transmit(s_tx_chan, s_copy_enc,
                                  symbols,
                                  num_symbols * sizeof(rmt_symbol_word_t),
                                  &tx_config);
    free(symbols);

    if (err != ESP_OK) {
        LOG_E(TAG, "rmt_transmit failed: %s", esp_err_to_name(err));
        return false;
    }

    // Tunggu selesai kirim (max 2 detik)
    err = rmt_tx_wait_all_done(s_tx_chan, pdMS_TO_TICKS(2000));
    if (err != ESP_OK) {
        LOG_W(TAG, "TX wait timeout");
        return false;
    }

    return true;
}

// ==================== RX (Learning) ====================

static rmt_channel_handle_t s_rx_chan    = NULL;
static QueueHandle_t        s_rx_queue   = NULL;
static bool                 s_learning   = false;
static TaskHandle_t         s_learn_task = NULL;

static void (*s_done_cb)(const uint16_t*, size_t, void*) = NULL;
static void* s_done_ctx = NULL;

static bool IRAM_ATTR rx_done_callback(rmt_channel_handle_t channel,
                                        const rmt_rx_done_event_data_t* edata,
                                        void* user_ctx) {
    QueueHandle_t q = (QueueHandle_t)user_ctx;
    BaseType_t woken = pdFALSE;
    xQueueSendFromISR(q, edata, &woken);
    return woken == pdTRUE;
}

static void learn_task(void* arg) {
    static rmt_symbol_word_t rx_buf[512];
    static uint16_t timings[1024];

    rmt_receive_config_t rx_cfg = {};
    rx_cfg.signal_range_min_ns = 1250;       // ignore pulses < 1.25us (noise)
    rx_cfg.signal_range_max_ns = 12000000;   // stop after 12ms silence

    rmt_rx_done_event_data_t event;

    LOG_I(TAG, "IR learning started — waiting for remote signal...");

    while (s_learning) {
        // Mulai receive
        esp_err_t err = rmt_receive(s_rx_chan, rx_buf, sizeof(rx_buf), &rx_cfg);
        if (err != ESP_OK) {
            vTaskDelay(pdMS_TO_TICKS(100));
            continue;
        }

        // Tunggu data (timeout 12 detik = IR_LEARN_TIMEOUT_MS + 2s buffer)
        if (xQueueReceive(s_rx_queue, &event, pdMS_TO_TICKS(IR_LEARN_TIMEOUT_MS + 2000)) == pdTRUE) {
            size_t num_sym = event.num_symbols;
            size_t timing_count = 0;

            // Konversi rmt_symbol_word_t ke timing array
            for (size_t i = 0; i < num_sym && timing_count < 1020; i++) {
                if (event.received_symbols[i].duration0 > 0) {
                    timings[timing_count++] = event.received_symbols[i].duration0;
                }
                if (event.received_symbols[i].duration1 > 0) {
                    timings[timing_count++] = event.received_symbols[i].duration1;
                }
            }

            if (timing_count > 10) {
                // Validasi invert_in: symbol pertama harus level0=0 (mark=LOW dari TSOP38238)
                // Jika level0=1, berarti invert_in harus di-set ke true di ir_driver_rx_init()
                if (event.num_symbols > 0) {
                    uint8_t first_level = event.received_symbols[0].level0;
                    LOG_I(TAG, "IR captured: %d pulses, first_level=%d first_mark=%dus first_space=%dus",
                          (int)timing_count, first_level,
                          event.received_symbols[0].duration0,
                          event.received_symbols[0].duration1);
                    if (first_level == 1) {
                        LOG_W(TAG, "WARNING: first_level=1 — consider setting rx_cfg.flags.invert_in=true");
                    }
                }
                if (s_done_cb) {
                    s_done_cb(timings, timing_count, s_done_ctx);
                }
            } else {
                LOG_W(TAG, "IR signal too short (%d pulses), ignoring", (int)timing_count);
                continue; // coba lagi
            }

            break; // capture selesai
        } else {
            LOG_W(TAG, "IR learning timeout");
            if (s_done_cb) s_done_cb(NULL, 0, s_done_ctx); // gagal
            break;
        }
    }

    s_learning   = false;
    s_learn_task = NULL;
    vTaskDelete(NULL);
}

void ir_driver_rx_init(void) {
    s_rx_queue = xQueueCreate(4, sizeof(rmt_rx_done_event_data_t));
    if (!s_rx_queue) {
        LOG_E(TAG, "IR RX: failed to create queue");
        return;
    }

    rmt_rx_channel_config_t rx_cfg = {};
    rx_cfg.gpio_num          = (gpio_num_t)PIN_IR_RX;
    rx_cfg.clk_src           = RMT_CLK_SRC_DEFAULT;
    rx_cfg.resolution_hz     = IR_RX_RESOLUTION_HZ;
    rx_cfg.mem_block_symbols = IR_RX_MEM_SYMBOLS;
    rx_cfg.flags.invert_in   = IR_RX_INVERT_INPUT;
    rx_cfg.flags.with_dma    = false;

    esp_err_t err = rmt_new_rx_channel(&rx_cfg, &s_rx_chan);
    if (err != ESP_OK) {
        LOG_W(TAG, "IR RX channel init failed (%s) — learning mode disabled",
              esp_err_to_name(err));
        s_rx_chan = NULL;
        return;
    }

    rmt_rx_event_callbacks_t cbs = {};
    cbs.on_recv_done = rx_done_callback;
    err = rmt_rx_register_event_callbacks(s_rx_chan, &cbs, s_rx_queue);
    if (err != ESP_OK) {
        LOG_W(TAG, "IR RX callback register failed (%s)", esp_err_to_name(err));
        rmt_del_channel(s_rx_chan);
        s_rx_chan = NULL;
        return;
    }

    err = rmt_enable(s_rx_chan);
    if (err != ESP_OK) {
        LOG_W(TAG, "IR RX enable failed (%s)", esp_err_to_name(err));
        rmt_del_channel(s_rx_chan);
        s_rx_chan = NULL;
        return;
    }

    LOG_I(TAG, "IR RX initialized (GPIO %d, %d symbols)", PIN_IR_RX, IR_RX_MEM_SYMBOLS);
}

void ir_driver_learn_start(void (*done_cb)(const uint16_t* timings, size_t count, void* ctx),
                            void* ctx) {
    if (!s_rx_chan) {
        LOG_E(TAG, "IR RX not available — learning mode disabled");
        if (done_cb) done_cb(NULL, 0, ctx);
        return;
    }
    if (s_learning) {
        LOG_W(TAG, "Already learning");
        return;
    }

    s_done_cb  = done_cb;
    s_done_ctx = ctx;
    s_learning = true;

    xTaskCreatePinnedToCore(learn_task, "ir_learn",
                             4096, NULL, 4, &s_learn_task, 1);
}

void ir_driver_learn_stop(void) {
    s_learning = false;
    if (s_learn_task) {
        vTaskDelete(s_learn_task);
        s_learn_task = NULL;
    }
    LOG_I(TAG, "IR learning stopped");
}

bool ir_driver_is_learning(void) {
    return s_learning;
}
