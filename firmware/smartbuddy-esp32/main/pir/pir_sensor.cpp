#include "pir_sensor.h"
#include "logger.h"
#include "app_config.h"

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/gpio.h"

static const char* TAG = "PIR";

static volatile bool     s_motion       = false;
static volatile uint32_t s_last_motion  = 0;
static void (*s_motion_cb)(bool)        = NULL;

static void pir_task(void* arg) {
    bool     last_state  = false;
    uint32_t debounce_ts = 0;

    while (true) {
        bool current = (gpio_get_level((gpio_num_t)PIN_PIR) == 1);
        uint32_t now = xTaskGetTickCount() * portTICK_PERIOD_MS;

        if (current != last_state) {
            if ((now - debounce_ts) >= PIR_DEBOUNCE_MS) {
                last_state   = current;
                s_motion     = current;
                debounce_ts  = now;

                if (current) {
                    s_last_motion = now;
                    LOG_I(TAG, "Motion detected");
                } else {
                    LOG_I(TAG, "Motion cleared");
                }

                if (s_motion_cb) s_motion_cb(current);
            }
        } else if (current) {
            // Refresh last_motion selama gerakan masih ada
            s_last_motion = now;
        }

        vTaskDelay(pdMS_TO_TICKS(PIR_CHECK_INTERVAL_MS));
    }
}

void pir_sensor_init(void) {
    gpio_config_t io_cfg = {};
    io_cfg.pin_bit_mask = (1ULL << PIN_PIR);
    io_cfg.mode         = GPIO_MODE_INPUT;
    io_cfg.pull_up_en   = GPIO_PULLUP_DISABLE;
    io_cfg.pull_down_en = GPIO_PULLDOWN_DISABLE;
    io_cfg.intr_type    = GPIO_INTR_DISABLE;
    gpio_config(&io_cfg);

    LOG_I(TAG, "PIR sensor initialized (GPIO %d)", PIN_PIR);
}

void pir_sensor_start(void (*motion_cb)(bool motion)) {
    s_motion_cb = motion_cb;
    xTaskCreatePinnedToCore(pir_task, "pir_task",
                             PIR_TASK_STACK, NULL,
                             PIR_TASK_PRIORITY, NULL, 1);
    LOG_I(TAG, "PIR sensor started");
}

bool pir_sensor_get_state(void) {
    return s_motion;
}

uint32_t pir_sensor_get_last_motion_ms(void) {
    return s_last_motion;
}
