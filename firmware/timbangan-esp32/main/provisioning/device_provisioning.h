#pragma once

#include "app_types.h"

#ifdef __cplusplus
extern "C" {
#endif

bool device_provisioning_register(const device_config_t* cfg, const char* ip);

#ifdef __cplusplus
}
#endif