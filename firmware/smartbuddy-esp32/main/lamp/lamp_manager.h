#pragma once

#include "app_types.h"
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

void lamp_manager_init(void);
void lamp_manager_set_power(bool on);
void lamp_manager_set_mode(lamp_mode_t mode);
void lamp_manager_set_pir_timeout(uint32_t timeout_ms);
lamp_state_t lamp_manager_get_state(void);
void lamp_manager_load_nvs(void);
void lamp_manager_save_nvs(void);
void lamp_manager_check_auto_off(void);

// Dipanggil dari PIR sensor callback
void lamp_manager_on_pir(bool motion);

// Set callback — dipanggil setiap kali state berubah (power/mode/pir auto-off)
void lamp_manager_set_state_callback(void (*cb)(const lamp_state_t*));

#ifdef __cplusplus
}
#endif
