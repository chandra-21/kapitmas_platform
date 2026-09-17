#pragma once

#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

void pir_sensor_init(void);
void pir_sensor_start(void (*motion_cb)(bool motion));
bool pir_sensor_get_state(void);
uint32_t pir_sensor_get_last_motion_ms(void);

#ifdef __cplusplus
}
#endif
