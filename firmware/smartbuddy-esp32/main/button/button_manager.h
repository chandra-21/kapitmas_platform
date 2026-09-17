#pragma once

#ifdef __cplusplus
extern "C" {
#endif

void button_manager_init(void);
void button_manager_start(void (*ble_prov_cb)(void));

#ifdef __cplusplus
}
#endif
