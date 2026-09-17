#pragma once

#include "app_types.h"
#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>

// Ukuran buffer maksimum untuk timing array
// Daikin 3-frame = ~569 entries, brand lain lebih kecil. Margin 640 cukup untuk semua.
#define IR_MAX_TIMINGS  640

#ifdef __cplusplus
extern "C" {
#endif

// Encode AC command menjadi timing array (mark/space microseconds)
// Returns: jumlah timing yang diisi, 0 jika gagal
size_t ir_brand_encode(ir_brand_t brand, const ac_state_t* state,
                        uint16_t* out_timings, size_t max_timings);

// Helper: konversi string brand ke enum
ir_brand_t ir_brand_from_string(const char* str);
const char* ir_brand_to_string(ir_brand_t brand);

// Carrier frequency untuk brand tertentu (Panasonic = 36.7kHz, sisanya 38kHz)
uint32_t ir_brand_carrier_hz(ir_brand_t brand);

#ifdef __cplusplus
}
#endif
