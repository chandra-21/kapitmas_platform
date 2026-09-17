#pragma once

#include <stdint.h>
#include <stddef.h>
#include "esp_bit_defs.h"

// ==================== WIFI STATES ====================
typedef enum {
    WIFI_STATE_BOOT,
    WIFI_STATE_CONNECTING,
    WIFI_STATE_CONNECTED,
    WIFI_STATE_WAITING_BACKOFF,
    WIFI_STATE_FAILED
} wifi_state_t;

// ==================== MQTT STATES ====================
typedef enum {
    MQTT_STATE_DISCONNECTED,
    MQTT_STATE_CONNECTING,
    MQTT_STATE_CONNECTED,
    MQTT_STATE_ERROR
} mqtt_state_t;

// ==================== BLE STATES ====================
typedef enum {
    BLE_STATE_IDLE,
    BLE_STATE_ADVERTISING,
    BLE_STATE_CONNECTED,
    BLE_STATE_PROVISIONING,
    BLE_STATE_DONE,
    BLE_STATE_TIMEOUT
} ble_state_t;

// ==================== LED PATTERNS ====================
typedef enum {
    LED_OFF,
    LED_ON,
    LED_BLINK_SLOW,       // 1000ms — WiFi disconnected
    LED_BLINK_MEDIUM,     // 500ms  — WiFi OK, MQTT disconnected
    LED_BLINK_FAST,       // 200ms  — OTA / BLE provisioning
    LED_DOUBLE_BLINK,     // data diterima
    LED_TRIPLE_BLINK      // BLE connected
} led_pattern_t;

// ==================== SYSTEM EVENTS ====================
typedef enum {
    SYS_EVENT_WIFI_CONNECTED    = BIT0,
    SYS_EVENT_WIFI_DISCONNECTED = BIT1,
    SYS_EVENT_MQTT_CONNECTED    = BIT2,
    SYS_EVENT_MQTT_DISCONNECTED = BIT3,
    SYS_EVENT_OTA_IN_PROGRESS   = BIT4,
    SYS_EVENT_NTP_SYNCED        = BIT5,
    SYS_EVENT_SERIAL_ACTIVE     = BIT6,
    SYS_EVENT_BLE_PROVISIONING  = BIT7,
    SYS_EVENT_REGISTERED        = BIT8
} sys_event_t;

// ==================== WEIGHT DATA ====================
typedef struct {
    float    weight;
    char     weight_str[16]; // string asli dari serial, mis. "31.0" bukan "31.00"
    int64_t  timestamp;
    char     device_name[32];
    char     unit[8];        // "kg", "lb", "g", "t", "ton"
    int      rssi;
} weight_data_t;

// ==================== DEVICE CONFIG ====================
typedef struct {
    char ssid[64];
    char password[64];
    char device_name[32];
    char mqtt_host[64];
    char backend_host[64];
    int  backend_port;
} device_config_t;