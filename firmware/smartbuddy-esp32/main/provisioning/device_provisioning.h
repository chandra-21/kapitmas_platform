#pragma once

#include "app_types.h"
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

bool device_provisioning_register(const device_config_t* cfg, const char* ip,
                                   const char* mac_str);

#ifdef __cplusplus
}
#endif
