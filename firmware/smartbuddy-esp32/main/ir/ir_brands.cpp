#include "ir_brands.h"
#include "logger.h"
#include <string.h>
#include <stdio.h>

static const char* TAG = "IRBrands";

// ==================== HELPER: append mark+space ke timing array ====================

static inline size_t append(uint16_t* buf, size_t pos, size_t max,
                              uint16_t mark, uint16_t space) {
    if (pos + 2 > max) return pos;
    buf[pos++] = mark;
    buf[pos++] = space;
    return pos;
}

static inline size_t append_mark(uint16_t* buf, size_t pos, size_t max, uint16_t mark) {
    if (pos + 1 > max) return pos;
    buf[pos++] = mark;
    return pos;
}

// ==================== HELPER: encode byte LSB-first ====================

static size_t encode_byte(uint16_t* buf, size_t pos, size_t max,
                            uint8_t byte,
                            uint16_t bit_mark, uint16_t one_space, uint16_t zero_space) {
    for (int i = 0; i < 8; i++) {
        uint16_t space = (byte & (1 << i)) ? one_space : zero_space;
        pos = append(buf, pos, max, bit_mark, space);
    }
    return pos;
}

// ==================== DAIKIN (ARC433B66) ====================
// 38kHz, 3 frames: fixed(8) + fixed(8) + command(19) bytes
// Ref: IRremoteESP8266 ir_Daikin.cpp

#define DAIKIN_HDR_MARK     3650
#define DAIKIN_HDR_SPACE    1623
#define DAIKIN_BIT_MARK     428
#define DAIKIN_ONE_SPACE    1280
#define DAIKIN_ZERO_SPACE   428
#define DAIKIN_GAP          29000

static uint8_t daikin_checksum(const uint8_t* frame, size_t len) {
    uint8_t sum = 0;
    for (size_t i = 0; i < len; i++) sum += frame[i];
    return sum & 0xFF;
}

static size_t encode_daikin_frame(uint16_t* buf, size_t pos, size_t max,
                                   const uint8_t* data, size_t len) {
    pos = append(buf, pos, max, DAIKIN_HDR_MARK, DAIKIN_HDR_SPACE);
    for (size_t i = 0; i < len; i++) {
        pos = encode_byte(buf, pos, max, data[i],
                           DAIKIN_BIT_MARK, DAIKIN_ONE_SPACE, DAIKIN_ZERO_SPACE);
    }
    pos = append_mark(buf, pos, max, DAIKIN_BIT_MARK);
    return pos;
}

static size_t encode_daikin(const ac_state_t* s, uint16_t* buf, size_t max) {
    // Frame 1: fixed preamble (8 bytes + checksum)
    uint8_t f1[8] = {0x11, 0xDA, 0x27, 0x00, 0xC5, 0x00, 0x00, 0x00};
    f1[7] = daikin_checksum(f1, 7);

    // Frame 2: fixed (8 bytes + checksum)
    uint8_t f2[8] = {0x11, 0xDA, 0x27, 0x00, 0x42, 0x00, 0x00, 0x00};
    f2[7] = daikin_checksum(f2, 7);

    // Frame 3: command (19 bytes)
    uint8_t f3[19] = {};
    f3[0] = 0x11;
    f3[1] = 0xDA;
    f3[2] = 0x27;
    f3[3] = 0x00;
    f3[4] = 0x00;

    // Byte 5: mode (bits 7-4) + power (bit 0) + fixed bit3
    uint8_t daikin_mode = 0;
    switch (s->mode) {
        case AC_MODE_AUTO: daikin_mode = 0; break;
        case AC_MODE_DRY:  daikin_mode = 2; break;
        case AC_MODE_COOL: daikin_mode = 3; break;
        case AC_MODE_HEAT: daikin_mode = 4; break;
        case AC_MODE_FAN:  daikin_mode = 6; break;
    }
    f3[5] = (daikin_mode << 4) | (s->power ? 0x09 : 0x08);

    // Byte 6: temperature * 2
    uint8_t temp = s->temp;
    if (temp < 16) temp = 16;
    if (temp > 30) temp = 30;
    f3[6] = temp * 2;

    // Byte 7: fan speed
    switch (s->fan) {
        case AC_FAN_AUTO:   f3[7] = 0xA0; break;
        case AC_FAN_QUIET:  f3[7] = 0x30; break;
        case AC_FAN_LOW:    f3[7] = 0x40; break;
        case AC_FAN_MEDIUM: f3[7] = 0x50; break;
        case AC_FAN_HIGH:   f3[7] = 0x70; break;
    }

    // Byte 8: swing V (0x0F = auto swing)
    f3[8] = s->swing_v ? 0x0F : 0x00;

    // Bytes 9-17: defaults (0x00)
    // f3[13] = 0xC0;  // comfortable airflow bit — optional

    // Checksum
    f3[18] = daikin_checksum(f3, 18);

    size_t pos = 0;
    pos = encode_daikin_frame(buf, pos, max, f1, 8);
    // Gap antar frame
    if (pos < max) buf[pos - 1] = DAIKIN_GAP; // override trailing space = gap
    pos = encode_daikin_frame(buf, pos, max, f2, 8);
    if (pos < max) buf[pos - 1] = DAIKIN_GAP;
    pos = encode_daikin_frame(buf, pos, max, f3, 19);

    return pos;
}

// ==================== LG AC ====================
// 38kHz, 28 bits per frame
// Header: 8500/4250, Bit1: 500/1500, Bit0: 500/540
// Ref: IRremoteESP8266 ir_LG.cpp

#define LG_HDR_MARK     8500
#define LG_HDR_SPACE    4250
#define LG_BIT_MARK     500
#define LG_ONE_SPACE    1500
#define LG_ZERO_SPACE   540
#define LG_END_MARK     500

static uint8_t lg_checksum(uint32_t data) {
    // XOR nibbles
    uint8_t csum = 0;
    for (int i = 0; i < 7; i++) {
        csum ^= (data >> (i * 4)) & 0xF;
    }
    return csum & 0xF;
}

static size_t encode_bits_msb(uint16_t* buf, size_t pos, size_t max,
                                uint32_t data, int bits,
                                uint16_t bit_mark, uint16_t one_sp, uint16_t zero_sp) {
    for (int i = bits - 1; i >= 0; i--) {
        uint16_t space = (data & (1U << i)) ? one_sp : zero_sp;
        pos = append(buf, pos, max, bit_mark, space);
    }
    return pos;
}

static size_t encode_lg(const ac_state_t* s, uint16_t* buf, size_t max) {
    // LG AC 28-bit command format
    // bits[27:24] = signature 0x8 (most LG ACs)
    // bits[23:20] = mode + power
    // bits[19:16] = temperature (18-30°C encoded as 0-12: temp-18)
    // bits[15:12] = fan speed
    // bits[11:4]  = 0x00
    // bits[3:0]   = checksum (XOR of nibbles 27-4)

    uint8_t lg_mode = 0;
    if (!s->power) {
        // Power OFF: special code
        uint32_t off_code = 0x88C0051;
        size_t pos = 0;
        pos = append(buf, pos, max, LG_HDR_MARK, LG_HDR_SPACE);
        pos = encode_bits_msb(buf, pos, max, off_code, 28,
                               LG_BIT_MARK, LG_ONE_SPACE, LG_ZERO_SPACE);
        pos = append_mark(buf, pos, max, LG_END_MARK);
        return pos;
    }

    switch (s->mode) {
        case AC_MODE_COOL: lg_mode = 0x08; break;
        case AC_MODE_DRY:  lg_mode = 0x04; break;
        case AC_MODE_FAN:  lg_mode = 0x02; break;
        case AC_MODE_HEAT: lg_mode = 0x0C; break;
        case AC_MODE_AUTO: lg_mode = 0x00; break;
    }

    uint8_t temp = s->temp;
    if (temp < 18) temp = 18;
    if (temp > 30) temp = 30;
    uint8_t lg_temp = temp - 18;

    uint8_t lg_fan = 0;
    switch (s->fan) {
        case AC_FAN_AUTO:   lg_fan = 0x05; break;
        case AC_FAN_LOW:    lg_fan = 0x02; break;
        case AC_FAN_MEDIUM: lg_fan = 0x04; break;
        case AC_FAN_HIGH:   lg_fan = 0x06; break;
        case AC_FAN_QUIET:  lg_fan = 0x00; break;
    }

    // Build 28-bit command (before checksum nibble)
    uint32_t cmd = 0x88000000;
    cmd |= ((uint32_t)lg_mode  << 20);
    cmd |= ((uint32_t)lg_temp  << 16);
    cmd |= ((uint32_t)lg_fan   << 12);

    uint8_t csum = lg_checksum(cmd >> 4);
    cmd |= csum;

    size_t pos = 0;
    pos = append(buf, pos, max, LG_HDR_MARK, LG_HDR_SPACE);
    pos = encode_bits_msb(buf, pos, max, cmd, 28,
                           LG_BIT_MARK, LG_ONE_SPACE, LG_ZERO_SPACE);
    pos = append_mark(buf, pos, max, LG_END_MARK);
    return pos;
}

// ==================== PANASONIC AC (CS/CU series) ====================
// 36.7kHz, 27 bytes state, LSB first
// Ref: IRremoteESP8266 ir_Panasonic.cpp

#define PAN_HDR_MARK     3456
#define PAN_HDR_SPACE    1728
#define PAN_BIT_MARK     432
#define PAN_ONE_SPACE    1296
#define PAN_ZERO_SPACE   432
#define PAN_GAP          10000

static uint8_t pan_checksum(const uint8_t* data, size_t len) {
    uint8_t sum = 0;
    for (size_t i = 0; i < len; i++) sum += data[i];
    return sum & 0xFF;
}

static size_t encode_panasonic(const ac_state_t* s, uint16_t* buf, size_t max) {
    // 27 bytes state — split into 2 frames (8 + 19 bytes)
    uint8_t state[27] = {};

    // Fixed header
    state[0] = 0x02; state[1] = 0x20; state[2] = 0xE0;
    state[3] = 0x04; state[4] = 0x00; state[5] = 0x00;
    state[6] = 0x00; state[7] = 0x06;  // frame 1 checksum

    // Frame 2 header
    state[8]  = 0x02; state[9]  = 0x20; state[10] = 0xE0;
    state[11] = 0x04;

    // Power + mode
    uint8_t pan_mode = 0;
    switch (s->mode) {
        case AC_MODE_AUTO: pan_mode = 0x00; break;
        case AC_MODE_COOL: pan_mode = 0x03; break;
        case AC_MODE_DRY:  pan_mode = 0x02; break;
        case AC_MODE_HEAT: pan_mode = 0x04; break;
        case AC_MODE_FAN:  pan_mode = 0x06; break;
    }
    state[12] = (pan_mode << 4) | (s->power ? 0x01 : 0x00);

    // Temperature: (temp - 16) << 1
    uint8_t temp = s->temp;
    if (temp < 16) temp = 16;
    if (temp > 30) temp = 30;
    state[13] = (temp - 16) << 1;

    // Fan
    uint8_t pan_fan = 0xA0; // auto
    switch (s->fan) {
        case AC_FAN_AUTO:   pan_fan = 0xA0; break;
        case AC_FAN_QUIET:  pan_fan = 0x30; break;
        case AC_FAN_LOW:    pan_fan = 0x30; break;
        case AC_FAN_MEDIUM: pan_fan = 0x50; break;
        case AC_FAN_HIGH:   pan_fan = 0x70; break;
    }

    // Swing V
    state[14] = pan_fan | (s->swing_v ? 0x0F : 0x00);

    state[25] = 0x06;  // fixed
    state[26] = pan_checksum(state + 8, 18); // frame 2 checksum

    size_t pos = 0;
    // Frame 1 (8 bytes)
    pos = append(buf, pos, max, PAN_HDR_MARK, PAN_HDR_SPACE);
    for (int i = 0; i < 8; i++) {
        pos = encode_byte(buf, pos, max, state[i],
                           PAN_BIT_MARK, PAN_ONE_SPACE, PAN_ZERO_SPACE);
    }
    pos = append_mark(buf, pos, max, PAN_BIT_MARK);
    if (pos > 0) buf[pos - 1] = PAN_GAP; // gap between frames

    // Frame 2 (19 bytes)
    pos = append(buf, pos, max, PAN_HDR_MARK, PAN_HDR_SPACE);
    for (int i = 8; i < 27; i++) {
        pos = encode_byte(buf, pos, max, state[i],
                           PAN_BIT_MARK, PAN_ONE_SPACE, PAN_ZERO_SPACE);
    }
    pos = append_mark(buf, pos, max, PAN_BIT_MARK);
    return pos;
}

// ==================== SAMSUNG AC ====================
// 38kHz, 21 bytes state, LSB first
// Unusual: header space is 17844us
// Ref: IRremoteESP8266 ir_Samsung.cpp

#define SAM_HDR_MARK     690
#define SAM_HDR_SPACE    17844
#define SAM_BIT_MARK     690
#define SAM_ONE_SPACE    1725
#define SAM_ZERO_SPACE   577
#define SAM_SEP_MARK     690
#define SAM_SEP_SPACE    7684

static uint8_t sam_checksum(const uint8_t* data, size_t start, size_t end) {
    uint8_t sum = 0;
    for (size_t i = start; i < end; i++) sum += data[i];
    return sum & 0xFF;
}

static size_t encode_samsung(const ac_state_t* s, uint16_t* buf, size_t max) {
    uint8_t state[21] = {};

    // Known Samsung AC fixed bytes
    state[0] = 0x02; state[1] = 0x92; state[2] = 0x0F;
    state[3] = 0x00; state[4] = 0x00; state[5] = 0x00;
    state[6] = 0xF0;

    // Byte 9: temperature + mode
    uint8_t sam_mode = 0;
    switch (s->mode) {
        case AC_MODE_AUTO: sam_mode = 0x00; break;
        case AC_MODE_COOL: sam_mode = 0x01; break;
        case AC_MODE_DRY:  sam_mode = 0x02; break;
        case AC_MODE_FAN:  sam_mode = 0x03; break;
        case AC_MODE_HEAT: sam_mode = 0x04; break;
    }

    uint8_t temp = s->temp;
    if (temp < 16) temp = 16;
    if (temp > 30) temp = 30;

    // Power
    state[7] = s->power ? 0x09 : 0x08;
    state[8] = (sam_mode << 4) | ((temp - 16) & 0x0F);

    // Fan
    uint8_t sam_fan = 0;
    switch (s->fan) {
        case AC_FAN_AUTO:   sam_fan = 0xA0; break;
        case AC_FAN_LOW:    sam_fan = 0x20; break;
        case AC_FAN_MEDIUM: sam_fan = 0x40; break;
        case AC_FAN_HIGH:   sam_fan = 0x60; break;
        case AC_FAN_QUIET:  sam_fan = 0x20; break;
    }
    state[9] = sam_fan;

    // Swing
    state[10] = s->swing_v ? 0x70 : 0x00;

    state[14] = sam_checksum(state, 7, 14);

    state[15] = 0x01; state[16] = 0xD2; state[17] = 0x0F;
    state[18] = 0x00; state[19] = 0x00;
    state[20] = sam_checksum(state, 15, 20);

    size_t pos = 0;
    // Frame 1 (7 bytes)
    pos = append(buf, pos, max, SAM_HDR_MARK, SAM_HDR_SPACE);
    for (int i = 0; i < 7; i++) {
        pos = encode_byte(buf, pos, max, state[i],
                           SAM_BIT_MARK, SAM_ONE_SPACE, SAM_ZERO_SPACE);
    }
    pos = append(buf, pos, max, SAM_SEP_MARK, SAM_SEP_SPACE);

    // Frame 2 (8 bytes)
    pos = append(buf, pos, max, SAM_HDR_MARK, SAM_HDR_SPACE);
    for (int i = 7; i < 15; i++) {
        pos = encode_byte(buf, pos, max, state[i],
                           SAM_BIT_MARK, SAM_ONE_SPACE, SAM_ZERO_SPACE);
    }
    pos = append(buf, pos, max, SAM_SEP_MARK, SAM_SEP_SPACE);

    // Frame 3 (6 bytes)
    pos = append(buf, pos, max, SAM_HDR_MARK, SAM_HDR_SPACE);
    for (int i = 15; i < 21; i++) {
        pos = encode_byte(buf, pos, max, state[i],
                           SAM_BIT_MARK, SAM_ONE_SPACE, SAM_ZERO_SPACE);
    }
    pos = append_mark(buf, pos, max, SAM_BIT_MARK);
    return pos;
}

// ==================== GREE AC ====================
// 38kHz, 64-bit (8 bytes), 2 blocks per frame
// Ref: IRremoteESP8266 ir_Gree.cpp

#define GREE_HDR_MARK     9000
#define GREE_HDR_SPACE    4000
#define GREE_BIT_MARK     620
#define GREE_ONE_SPACE    1600
#define GREE_ZERO_SPACE   540
#define GREE_MSG_SPACE    19000

static size_t encode_gree(const ac_state_t* s, uint16_t* buf, size_t max) {
    uint8_t state[8] = {};

    // Byte 0: mode + power
    uint8_t gree_mode = 0;
    switch (s->mode) {
        case AC_MODE_AUTO: gree_mode = 0; break;
        case AC_MODE_COOL: gree_mode = 1; break;
        case AC_MODE_DRY:  gree_mode = 2; break;
        case AC_MODE_FAN:  gree_mode = 3; break;
        case AC_MODE_HEAT: gree_mode = 4; break;
    }
    state[0] = gree_mode | (s->power ? 0x08 : 0x00);

    // Byte 1: temperature (temp - 16)
    uint8_t temp = s->temp;
    if (temp < 16) temp = 16;
    if (temp > 30) temp = 30;
    state[1] = (temp - 16) & 0x0F;

    // Byte 2: fan + swing V
    uint8_t gree_fan = 0; // auto
    switch (s->fan) {
        case AC_FAN_AUTO:   gree_fan = 0; break;
        case AC_FAN_LOW:    gree_fan = 1; break;
        case AC_FAN_MEDIUM: gree_fan = 2; break;
        case AC_FAN_HIGH:   gree_fan = 3; break;
        case AC_FAN_QUIET:  gree_fan = 0; break;
    }
    state[2] = gree_fan | (s->swing_v ? 0x08 : 0x00);

    // Byte 4: fixed = 0x50 (identifier)
    state[4] = 0x50;

    // Checksum: sum of nibbles 0-7 (lower) and nibbles 8-15 (upper) of bytes 0-3
    uint8_t csum = 0xA;
    for (int i = 0; i < 4; i++) {
        csum += (state[i] & 0x0F) + ((state[i] >> 4) & 0x0F);
    }
    state[4] |= (csum & 0x0F) << 4;

    size_t pos = 0;
    pos = append(buf, pos, max, GREE_HDR_MARK, GREE_HDR_SPACE);

    // Bytes 0-3 (first 4 bytes)
    for (int i = 0; i < 4; i++) {
        pos = encode_byte(buf, pos, max, state[i],
                           GREE_BIT_MARK, GREE_ONE_SPACE, GREE_ZERO_SPACE);
    }

    // Fixed inter-block: 1 (1) + 0 (0) + 0 (0)
    pos = append(buf, pos, max, GREE_BIT_MARK, GREE_ONE_SPACE);   // 1
    pos = append(buf, pos, max, GREE_BIT_MARK, GREE_ZERO_SPACE);  // 0
    pos = append(buf, pos, max, GREE_BIT_MARK, GREE_MSG_SPACE);   // gap

    // Bytes 4-7 (second 4 bytes)
    for (int i = 4; i < 8; i++) {
        pos = encode_byte(buf, pos, max, state[i],
                           GREE_BIT_MARK, GREE_ONE_SPACE, GREE_ZERO_SPACE);
    }
    pos = append_mark(buf, pos, max, GREE_BIT_MARK);
    return pos;
}

// ==================== MIDEA AC ====================
// 38kHz, 48-bit (6 bytes), sent twice
// Ref: IRremoteESP8266 ir_Midea.cpp

#define MIDEA_HDR_MARK     4500
#define MIDEA_HDR_SPACE    4500
#define MIDEA_BIT_MARK     560
#define MIDEA_ONE_SPACE    1680
#define MIDEA_ZERO_SPACE   560
#define MIDEA_RPT_MARK     560
#define MIDEA_RPT_SPACE    5000

static size_t encode_midea(const ac_state_t* s, uint16_t* buf, size_t max) {
    // 48-bit Midea AC format (MSB first, inverted checksum byte appended)
    uint8_t data[6] = {};

    // Byte 0: device type + power
    data[0] = s->power ? 0xA1 : 0xA2;

    // Byte 1: temperature (temp - 17, range 0-13 for 17-30°C)
    uint8_t temp = s->temp;
    if (temp < 17) temp = 17;
    if (temp > 30) temp = 30;

    uint8_t midea_mode = 0;
    switch (s->mode) {
        case AC_MODE_AUTO: midea_mode = 0x08; break;
        case AC_MODE_COOL: midea_mode = 0x00; break;
        case AC_MODE_DRY:  midea_mode = 0x04; break;
        case AC_MODE_HEAT: midea_mode = 0x0C; break;
        case AC_MODE_FAN:  midea_mode = 0x04; break;
    }
    data[1] = midea_mode | ((temp - 17) & 0x0F);

    // Byte 2: fan speed
    uint8_t midea_fan = 0x80; // auto
    switch (s->fan) {
        case AC_FAN_AUTO:   midea_fan = 0x80; break;
        case AC_FAN_HIGH:   midea_fan = 0x20; break;
        case AC_FAN_MEDIUM: midea_fan = 0x40; break;
        case AC_FAN_LOW:    midea_fan = 0x60; break;
        case AC_FAN_QUIET:  midea_fan = 0x60; break;
    }
    data[2] = midea_fan;

    // Bytes 3-4: fixed
    data[3] = 0x00;
    data[4] = 0x00;

    // Byte 5: checksum (XOR of bytes 0-4)
    data[5] = data[0] ^ data[1] ^ data[2] ^ data[3] ^ data[4];

    size_t pos = 0;
    // Send twice (Midea AC requires repetition)
    for (int rep = 0; rep < 2; rep++) {
        pos = append(buf, pos, max, MIDEA_HDR_MARK, MIDEA_HDR_SPACE);
        // MSB first
        for (int i = 0; i < 6; i++) {
            for (int bit = 7; bit >= 0; bit--) {
                uint16_t sp = (data[i] & (1 << bit)) ? MIDEA_ONE_SPACE : MIDEA_ZERO_SPACE;
                pos = append(buf, pos, max, MIDEA_BIT_MARK, sp);
            }
        }
        pos = append_mark(buf, pos, max, MIDEA_RPT_MARK);
        if (rep == 0) {
            // Space between repetitions
            if (pos < max) buf[pos - 1] = MIDEA_RPT_SPACE;
        }
    }
    return pos;
}

// ==================== PUBLIC API ====================

size_t ir_brand_encode(ir_brand_t brand, const ac_state_t* state,
                        uint16_t* out_timings, size_t max_timings) {
    if (!state || !out_timings || max_timings == 0) return 0;

    switch (brand) {
        case IR_BRAND_DAIKIN:
            return encode_daikin(state, out_timings, max_timings);
        case IR_BRAND_LG:
            return encode_lg(state, out_timings, max_timings);
        case IR_BRAND_PANASONIC:
            return encode_panasonic(state, out_timings, max_timings);
        case IR_BRAND_SAMSUNG:
            return encode_samsung(state, out_timings, max_timings);
        case IR_BRAND_GREE:
            return encode_gree(state, out_timings, max_timings);
        case IR_BRAND_MIDEA:
            return encode_midea(state, out_timings, max_timings);
        default:
            LOG_W(TAG, "Brand not supported for native encoding: %d", brand);
            return 0;
    }
}

ir_brand_t ir_brand_from_string(const char* str) {
    if (!str) return IR_BRAND_UNKNOWN;
    if (strcmp(str, "daikin")    == 0) return IR_BRAND_DAIKIN;
    if (strcmp(str, "lg")        == 0) return IR_BRAND_LG;
    if (strcmp(str, "panasonic") == 0) return IR_BRAND_PANASONIC;
    if (strcmp(str, "samsung")   == 0) return IR_BRAND_SAMSUNG;
    if (strcmp(str, "gree")      == 0) return IR_BRAND_GREE;
    if (strcmp(str, "midea")     == 0) return IR_BRAND_MIDEA;
    if (strcmp(str, "learned")   == 0) return IR_BRAND_LEARNED;
    return IR_BRAND_UNKNOWN;
}

const char* ir_brand_to_string(ir_brand_t brand) {
    switch (brand) {
        case IR_BRAND_DAIKIN:    return "daikin";
        case IR_BRAND_LG:        return "lg";
        case IR_BRAND_PANASONIC: return "panasonic";
        case IR_BRAND_SAMSUNG:   return "samsung";
        case IR_BRAND_GREE:      return "gree";
        case IR_BRAND_MIDEA:     return "midea";
        case IR_BRAND_LEARNED:   return "learned";
        default:                 return "unknown";
    }
}

uint32_t ir_brand_carrier_hz(ir_brand_t brand) {
    // Panasonic menggunakan 36.7kHz, semua brand lain 38kHz
    return (brand == IR_BRAND_PANASONIC) ? IR_CARRIER_HZ_PANASONIC : IR_CARRIER_HZ_DEFAULT;
}
