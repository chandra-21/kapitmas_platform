#include "led_manager.h"
#include "logger.h"

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/event_groups.h"
#include "driver/gpio.h"

// ==================== PRIVATE ====================

static const char* TAG = "LED";

static volatile led_pattern_t s_led1_pattern = LED_OFF;
static volatile led_pattern_t s_led2_pattern = LED_OFF;

extern EventGroupHandle_t g_system_events;

// LED onboard ESP32-C3 Super Mini (GPIO8) active LOW — LED2 eksternal active HIGH.
// Semua penulisan lewat helper ini supaya polaritas tidak tercecer di banyak tempat.
static inline void led1_write(bool on) {
    gpio_set_level((gpio_num_t)PIN_LED1, LED1_LEVEL(on));
}

static inline void led2_write(bool on) {
    gpio_set_level((gpio_num_t)PIN_LED2, LED2_LEVEL(on));
}

// ==================== LED TASK ====================

static void led_task(void* arg) {
    TickType_t led1_timer  = 0;
    TickType_t led2_timer  = 0;
    bool       led1_state  = false;
    int        blink_phase = 0;

    while (true) {
        EventBits_t bits = xEventGroupGetBits(g_system_events);

        // Auto-set LED1 pattern berdasarkan system state
        if (bits & SYS_EVENT_OTA_IN_PROGRESS) {
            s_led1_pattern = LED_BLINK_FAST;
        } else if (bits & SYS_EVENT_WIFI_CONNECTED) {
            if (bits & SYS_EVENT_MQTT_CONNECTED) {
                s_led1_pattern = LED_ON;
            } else {
                s_led1_pattern = LED_BLINK_MEDIUM;
            }
        } else {
            s_led1_pattern = LED_BLINK_SLOW;
        }

        // Handle LED1
        TickType_t now = xTaskGetTickCount();
        switch (s_led1_pattern) {
            case LED_ON:
                led1_write(true);
                break;
            case LED_OFF:
                led1_write(false);
                break;
            case LED_BLINK_SLOW:
                if ((now - led1_timer) >= pdMS_TO_TICKS(1000)) {
                    led1_state = !led1_state;
                    led1_write(led1_state);
                    led1_timer = now;
                }
                break;
            case LED_BLINK_MEDIUM:
                if ((now - led1_timer) >= pdMS_TO_TICKS(500)) {
                    led1_state = !led1_state;
                    led1_write(led1_state);
                    led1_timer = now;
                }
                break;
            case LED_BLINK_FAST:
                if ((now - led1_timer) >= pdMS_TO_TICKS(200)) {
                    led1_state = !led1_state;
                    led1_write(led1_state);
                    led1_timer = now;
                }
                break;
            default:
                break;
        }

        // Handle LED2 — double blink saat data masuk
        now = xTaskGetTickCount();
        if (s_led2_pattern == LED_DOUBLE_BLINK) {
            switch (blink_phase) {
                case 0:
                    led2_write(true);
                    led2_timer  = now;
                    blink_phase = 1;
                    break;
                case 1:
                    if ((now - led2_timer) >= pdMS_TO_TICKS(100)) {
                        led2_write(false);
                        led2_timer  = now;
                        blink_phase = 2;
                    }
                    break;
                case 2:
                    if ((now - led2_timer) >= pdMS_TO_TICKS(100)) {
                        led2_write(true);
                        led2_timer  = now;
                        blink_phase = 3;
                    }
                    break;
                case 3:
                    if ((now - led2_timer) >= pdMS_TO_TICKS(100)) {
                        led2_write(false);
                        s_led2_pattern = LED_OFF;
                        blink_phase    = 0;
                    }
                    break;
            }
        } else {
            led2_write(s_led2_pattern == LED_ON);
        }

        vTaskDelay(pdMS_TO_TICKS(50));
    }
}

// ==================== PUBLIC API ====================

void led_manager_init(void) {
    gpio_config_t io_cfg = {};
    io_cfg.pin_bit_mask = (1ULL << PIN_LED1) | (1ULL << PIN_LED2);
    io_cfg.mode         = GPIO_MODE_OUTPUT;
    io_cfg.pull_up_en   = GPIO_PULLUP_DISABLE;
    io_cfg.pull_down_en = GPIO_PULLDOWN_DISABLE;
    io_cfg.intr_type    = GPIO_INTR_DISABLE;
    gpio_config(&io_cfg);

    led1_write(false);
    led2_write(false);

    LOG_I(TAG, "LED manager initialized");
}

void led_manager_start(void) {
    // ESP32-C3 single-core — tidak ada core affinity
    xTaskCreate(
        led_task,
        "led_task",
        LED_TASK_STACK,
        NULL,
        LED_TASK_PRIORITY,
        NULL
    );

    LOG_I(TAG, "LED manager started");
}

void led_manager_set(led_pattern_t pattern) {
    s_led2_pattern = pattern;
}