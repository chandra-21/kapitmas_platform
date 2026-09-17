#pragma once

#include "app_types.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

void ac_manager_init(ir_brand_t brand, QueueHandle_t ir_cmd_queue);
bool ac_manager_apply(const ac_state_t* cmd);
ac_state_t ac_manager_get_state(void);
void ac_manager_load_nvs(void);
void ac_manager_save_nvs(void);

#ifdef __cplusplus
}
#endif
