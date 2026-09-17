#pragma once

#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

void relay_manager_init(void);
void relay_set(bool on);
bool relay_get(void);

#ifdef __cplusplus
}
#endif
