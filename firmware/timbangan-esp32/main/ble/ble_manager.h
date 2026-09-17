#pragma once

#include "app_types.h"
#include "app_config.h"

#ifdef __cplusplus
extern "C" {
#endif

void        ble_manager_init(void);
void        ble_manager_start_provisioning(void);
void        ble_manager_stop(void);
void        ble_manager_notify_connected(const char* ip);
void        ble_manager_notify_registered(void);
void        ble_manager_notify_failed(const char* error);
ble_state_t ble_manager_get_state(void);
bool        ble_manager_is_provisioning_done(void);
bool        ble_manager_is_timeout(void);
void        ble_manager_get_config(device_config_t* cfg);
void ble_manager_shutdown(void);

#ifdef __cplusplus
}
#endif