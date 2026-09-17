#pragma once

#include "app_types.h"
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

void mqtt_manager_init(const char* host, int port,
                        const char* device_name, const char* device_mac,
                        bool has_ac, bool has_lamp);
void mqtt_manager_start(void);
mqtt_state_t mqtt_manager_get_state(void);
bool mqtt_manager_publish(const char* topic, const char* payload, int qos, bool retain);

// Publish state helpers
void mqtt_manager_publish_status(const char* status);
void mqtt_manager_publish_heartbeat(void);
void mqtt_manager_publish_capabilities(bool has_ac, bool has_lamp,
                                        const char* ac_brand);
void mqtt_manager_publish_ac_state(const ac_state_t* state);
void mqtt_manager_publish_lamp_state(const lamp_state_t* state);
void mqtt_manager_publish_pir(bool motion);
void mqtt_manager_publish_ir_learn_result(const char* slot, bool success,
                                           const uint16_t* timings, size_t count);

// Subscription callbacks
void mqtt_manager_set_ac_callback(void (*cb)(const ac_state_t*));
void mqtt_manager_set_lamp_callback(void (*cb)(bool power, lamp_mode_t mode,
                                                 uint32_t pir_timeout_ms));
void mqtt_manager_set_schedule_callback(void (*cb)(const char* json));
void mqtt_manager_set_ota_callback(void (*cb)(const char* url));
void mqtt_manager_set_ir_learn_callback(void (*cb)(const char* slot));

#ifdef __cplusplus
}
#endif
