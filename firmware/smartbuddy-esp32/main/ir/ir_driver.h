#pragma once

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>
#include "app_types.h"

#ifdef __cplusplus
extern "C" {
#endif

// ==================== TX ====================

void ir_driver_tx_init(uint32_t carrier_hz);
void ir_driver_tx_set_carrier(uint32_t carrier_hz);

// Kirim raw timing array (mark/space alternating, dalam microseconds)
bool ir_driver_send_raw(const uint16_t* timings, size_t count);

// ==================== RX (Learning mode) ====================

void ir_driver_rx_init(void);

// Mulai capture — callback dipanggil saat capture selesai
// callback: timings array (mark/space us), count, user_data
void ir_driver_learn_start(void (*done_cb)(const uint16_t* timings, size_t count, void* ctx),
                            void* ctx);
void ir_driver_learn_stop(void);
bool ir_driver_is_learning(void);

#ifdef __cplusplus
}
#endif
