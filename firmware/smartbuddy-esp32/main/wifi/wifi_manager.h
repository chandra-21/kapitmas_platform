#pragma once

#include <stddef.h>
#include "app_types.h"

#ifdef __cplusplus
extern "C" {
#endif

void wifi_manager_init(void);
void wifi_manager_start(const char* ssid, const char* password);
wifi_state_t wifi_manager_get_state(void);
int  wifi_manager_get_rssi(void);
void wifi_manager_get_ip(char* buf, size_t len);

#ifdef __cplusplus
}
#endif
