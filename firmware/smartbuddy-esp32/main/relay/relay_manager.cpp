#include "relay_manager.h"
#include "logger.h"
#include "app_config.h"

#include "driver/gpio.h"

static const char* TAG = "Relay";
static bool s_state = false;

void relay_manager_init(void) {
    gpio_config_t io_cfg = {};
    io_cfg.pin_bit_mask = (1ULL << PIN_RELAY);
    io_cfg.mode         = GPIO_MODE_OUTPUT;
    io_cfg.pull_up_en   = GPIO_PULLUP_DISABLE;
    io_cfg.pull_down_en = GPIO_PULLDOWN_DISABLE;
    io_cfg.intr_type    = GPIO_INTR_DISABLE;
    gpio_config(&io_cfg);

    gpio_set_level((gpio_num_t)PIN_RELAY, 0);
    s_state = false;

    LOG_I(TAG, "Relay initialized (OFF)");
}

void relay_set(bool on) {
    s_state = on;
    gpio_set_level((gpio_num_t)PIN_RELAY, on ? 1 : 0);
    LOG_I(TAG, "Relay: %s", on ? "ON" : "OFF");
}

bool relay_get(void) {
    return s_state;
}
