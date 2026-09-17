#pragma once

#include <stdint.h>
#include <stdbool.h>
#include "app_config.h"

// ==================== SYSTEM EVENTS ====================

#define SYS_EVENT_WIFI_CONNECTED    (1 << 0)
#define SYS_EVENT_WIFI_DISCONNECTED (1 << 1)
#define SYS_EVENT_MQTT_CONNECTED    (1 << 2)
#define SYS_EVENT_REGISTERED        (1 << 3)
#define SYS_EVENT_NTP_SYNCED        (1 << 4)
#define SYS_EVENT_BLE_PROVISIONING  (1 << 5)
#define SYS_EVENT_OTA_IN_PROGRESS   (1 << 6)
#define SYS_EVENT_IR_LEARNING       (1 << 7)

// ==================== WIFI ====================

typedef enum {
    WIFI_STATE_BOOT,
    WIFI_STATE_CONNECTING,
    WIFI_STATE_CONNECTED,
    WIFI_STATE_WAITING_BACKOFF,
    WIFI_STATE_FAILED,
} wifi_state_t;

// ==================== MQTT ====================

typedef enum {
    MQTT_STATE_DISCONNECTED,
    MQTT_STATE_CONNECTING,
    MQTT_STATE_CONNECTED,
} mqtt_state_t;

// ==================== BLE ====================

typedef enum {
    BLE_STATE_IDLE,
    BLE_STATE_ADVERTISING,
    BLE_STATE_CONNECTED,
    BLE_STATE_DONE,
} ble_state_t;

// ==================== LED ====================

typedef enum {
    LED_OFF,
    LED_ON,
    LED_BLINK_SLOW,
    LED_BLINK_MEDIUM,
    LED_BLINK_FAST,
    LED_DOUBLE_BLINK,
} led_pattern_t;

// ==================== IR BRANDS ====================

typedef enum {
    IR_BRAND_DAIKIN    = 0,
    IR_BRAND_LG        = 1,
    IR_BRAND_PANASONIC = 2,
    IR_BRAND_SAMSUNG   = 3,
    IR_BRAND_GREE      = 4,
    IR_BRAND_MIDEA     = 5,
    IR_BRAND_LEARNED   = 6,
    IR_BRAND_UNKNOWN   = 7,
} ir_brand_t;

// ==================== AC TYPES ====================

typedef enum {
    AC_MODE_AUTO = 0,
    AC_MODE_COOL = 1,
    AC_MODE_HEAT = 2,
    AC_MODE_DRY  = 3,
    AC_MODE_FAN  = 4,
} ac_mode_t;

typedef enum {
    AC_FAN_AUTO   = 0,
    AC_FAN_QUIET  = 1,
    AC_FAN_LOW    = 2,
    AC_FAN_MEDIUM = 3,
    AC_FAN_HIGH   = 4,
} ac_fan_t;

typedef struct {
    bool      power;
    ac_mode_t mode;
    uint8_t   temp;     // 16-30°C
    ac_fan_t  fan;
    bool      swing_v;
} ac_state_t;

// ==================== IR COMMAND (queued) ====================

typedef struct {
    ir_brand_t brand;
    ac_state_t state;
    bool       is_learn_result;     // true jika ini hasil IR learning
    char       learn_slot[32];      // nama slot jika learning
} ir_command_t;

// ==================== LAMP TYPES ====================

typedef enum {
    LAMP_MODE_MANUAL   = 0,
    LAMP_MODE_AUTO_PIR = 1,
    LAMP_MODE_SCHEDULE = 2,
} lamp_mode_t;

typedef struct {
    bool       power;
    lamp_mode_t mode;
    bool       pir_motion;
    uint32_t   pir_timeout_ms;
    uint32_t   last_motion_ms;
} lamp_state_t;

// ==================== SCHEDULE ====================

typedef struct {
    bool     enabled;
    uint8_t  hour;
    uint8_t  minute;
    bool     days[7];       // 0=Sun, 1=Mon ... 6=Sat
    bool     action_power;  // true=ON, false=OFF
    char     target[8];     // "ac" or "lamp"
    // untuk AC: include temp, mode, fan
    uint8_t  ac_temp;
    ac_mode_t ac_mode;
    ac_fan_t  ac_fan;
    int64_t  valid_until;   // unix timestamp, 0=no expiry
} schedule_entry_t;

typedef struct {
    schedule_entry_t entries[SCHEDULE_MAX_ENTRIES];
    uint8_t          count;
} schedule_config_t;

// ==================== DEVICE CONFIG (dari NVS/BLE) ====================

typedef struct {
    char  ssid[64];
    char  password[64];
    char  device_name[32];
    char  room_id[32];
    char  mqtt_host[64];
    char  backend_host[64];
    int   backend_port;
    bool  has_ac;
    bool  has_lamp;
    char  ac_brand[16];     // "daikin","lg","panasonic","samsung","gree","midea","learned"
} device_config_t;
