#pragma once

#include "app_types.h"
#include "app_config.h"

#ifdef __cplusplus
extern "C" {
#endif

void web_portal_start(void);
bool web_portal_get_config(device_config_t* config);

#ifdef __cplusplus
}
#endif