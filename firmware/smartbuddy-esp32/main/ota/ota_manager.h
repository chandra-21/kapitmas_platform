#pragma once

#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

void ota_manager_init(void);
void ota_manager_trigger(const char* url);
bool ota_manager_is_running(void);

#ifdef __cplusplus
}
#endif
