#pragma once

#include <stddef.h>
#include "app_types.h"
#include "app_config.h"

#ifdef __cplusplus
extern "C" {
#endif

void mqtt_manager_init(const char* host, int port, const char* device_name, const char* device_mac);
void mqtt_manager_start(void);
mqtt_state_t mqtt_manager_get_state(void);
bool mqtt_manager_publish(const char* topic, const char* payload, int qos, bool retain);
void mqtt_manager_set_ota_callback(void (*cb)(const char* url));
const char* mqtt_manager_get_weight_topic(void);
const char* mqtt_manager_get_status_topic(void);

#ifdef __cplusplus
}
#endif