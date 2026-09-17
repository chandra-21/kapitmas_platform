#pragma once

#include "app_types.h"

#ifdef __cplusplus
extern "C" {
#endif

void led_manager_init(void);
void led_manager_start(void);
void led_manager_set(led_pattern_t pattern);

#ifdef __cplusplus
}
#endif
