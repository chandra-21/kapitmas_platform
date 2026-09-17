#include "button_manager.h"
#include "logger.h"

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/event_groups.h"
#include "driver/gpio.h"
#include "nvs_flash.h"
#include "nvs.h"
#include "esp_system.h"
#include <string.h>

static const char* TAG = "Button";

extern EventGroupHandle_t g_system_events;

// Callback untuk trigger BLE provisioning dari main
static void (*s_ble_prov_callback)(void) = NULL;

static void button_task(void* arg) {
    uint32_t press_start = 0;
    bool     pressed     = false;
    bool     ble_triggered    = false;
    bool     reset_triggered  = false;

    while (true) {
        bool is_pressed = (gpio_get_level((gpio_num_t)PIN_BOOT) == 0);

        if (is_pressed && !pressed) {
            pressed          = true;
            press_start      = xTaskGetTickCount() * portTICK_PERIOD_MS;
            ble_triggered    = false;
            reset_triggered  = false;
            LOG_I(TAG, "Button pressed");
        }

        if (is_pressed && pressed) {
            uint32_t duration = (xTaskGetTickCount() * portTICK_PERIOD_MS)
                                - press_start;

            // Tahan 5 detik → BLE provisioning mode
            if (!ble_triggered &&
                duration >= BUTTON_BLE_PROV_MS &&
                duration < BUTTON_FACTORY_RESET_MS) {

                ble_triggered = true;
                LOG_I(TAG, "BLE provisioning triggered!");

                // Visual feedback — blink cepat 3x
                for (int i = 0; i < 3; i++) {
                    gpio_set_level((gpio_num_t)PIN_LED1, LED1_LEVEL(1));
                    gpio_set_level((gpio_num_t)PIN_LED2, LED2_LEVEL(1));
                    vTaskDelay(pdMS_TO_TICKS(100));
                    gpio_set_level((gpio_num_t)PIN_LED1, LED1_LEVEL(0));
                    gpio_set_level((gpio_num_t)PIN_LED2, LED2_LEVEL(0));
                    vTaskDelay(pdMS_TO_TICKS(100));
                }

                if (s_ble_prov_callback) {
                    s_ble_prov_callback();
                }
            }

            // Tahan 10 detik → factory reset
            if (!reset_triggered &&
                duration >= BUTTON_FACTORY_RESET_MS) {

                reset_triggered = true;
                LOG_W(TAG, "Factory reset triggered!");

                // Visual feedback — blink cepat 10x
                for (int i = 0; i < 10; i++) {
                    gpio_set_level((gpio_num_t)PIN_LED1, LED1_LEVEL(1));
                    gpio_set_level((gpio_num_t)PIN_LED2, LED2_LEVEL(1));
                    vTaskDelay(pdMS_TO_TICKS(100));
                    gpio_set_level((gpio_num_t)PIN_LED1, LED1_LEVEL(0));
                    gpio_set_level((gpio_num_t)PIN_LED2, LED2_LEVEL(0));
                    vTaskDelay(pdMS_TO_TICKS(100));
                }

                nvs_flash_erase();
                LOG_W(TAG, "NVS erased - restarting...");
                vTaskDelay(pdMS_TO_TICKS(500));
                esp_restart();
            }
        }

        if (!is_pressed && pressed) {
            LOG_I(TAG, "Button released");
            pressed = false;
        }

        vTaskDelay(pdMS_TO_TICKS(50));
    }
}

void button_manager_init(void) {
    gpio_config_t io_cfg = {};
    io_cfg.pin_bit_mask = (1ULL << PIN_BOOT);
    io_cfg.mode         = GPIO_MODE_INPUT;
    io_cfg.pull_up_en   = GPIO_PULLUP_ENABLE;
    io_cfg.pull_down_en = GPIO_PULLDOWN_DISABLE;
    io_cfg.intr_type    = GPIO_INTR_DISABLE;
    gpio_config(&io_cfg);
    LOG_I(TAG, "Button manager initialized");
}

void button_manager_start(void (*ble_prov_cb)(void)) {
    s_ble_prov_callback = ble_prov_cb;
    // ESP32-C3 single-core — tidak ada core affinity
    xTaskCreate(
        button_task, "button_task",
        BUTTON_TASK_STACK, NULL,
        BUTTON_TASK_PRIORITY, NULL
    );
    LOG_I(TAG, "Button manager started");
}