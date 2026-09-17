#pragma once

#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "app_types.h"
#include "app_config.h"

#ifdef __cplusplus
extern "C" {
#endif

void serial_reader_init(void);
void serial_reader_start(QueueHandle_t weight_queue);
float serial_reader_get_realtime_weight(void);

#ifdef __cplusplus
}
#endif