#pragma once

#include "app_types.h"
#include "app_config.h"

#ifdef __cplusplus
extern "C" {
#endif

void button_manager_init(void);
void button_manager_start(void (*ble_prov_callback)(void));

#ifdef __cplusplus
}
#endif