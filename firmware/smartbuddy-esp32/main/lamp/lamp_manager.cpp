#include "lamp_manager.h"
#include "relay_manager.h"
#include "logger.h"
#include "app_config.h"

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "nvs_flash.h"
#include "nvs.h"

static const char* TAG = "Lamp";

static lamp_state_t s_state = {};

// Callback untuk publish state change ke MQTT (di-set dari main)
static void (*s_state_change_cb)(const lamp_state_t*) = NULL;

void lamp_manager_init(void) {
    s_state.power          = false;
    s_state.mode           = LAMP_MODE_MANUAL;
    s_state.pir_motion     = false;
    s_state.pir_timeout_ms = PIR_TIMEOUT_DEFAULT_MS;
    s_state.last_motion_ms = 0;

    lamp_manager_load_nvs();
    relay_set(s_state.power);

    LOG_I(TAG, "Lamp manager init — power: %d, mode: %d, timeout: %lums",
          s_state.power, s_state.mode,
          (unsigned long)s_state.pir_timeout_ms);
}

void lamp_manager_set_power(bool on) {
    s_state.power = on;
    relay_set(on);
    lamp_manager_save_nvs();
    LOG_I(TAG, "Lamp: %s", on ? "ON" : "OFF");
    if (s_state_change_cb) s_state_change_cb(&s_state);
}

void lamp_manager_set_mode(lamp_mode_t mode) {
    s_state.mode = mode;
    lamp_manager_save_nvs();
    LOG_I(TAG, "Lamp mode: %d", mode);
    if (s_state_change_cb) s_state_change_cb(&s_state);
}

void lamp_manager_set_pir_timeout(uint32_t timeout_ms) {
    s_state.pir_timeout_ms = timeout_ms;
    lamp_manager_save_nvs();
    LOG_I(TAG, "PIR timeout: %lu ms", (unsigned long)timeout_ms);
}

lamp_state_t lamp_manager_get_state(void) {
    return s_state;
}

void lamp_manager_on_pir(bool motion) {
    s_state.pir_motion = motion;
    uint32_t now = xTaskGetTickCount() * portTICK_PERIOD_MS;

    if (motion) {
        s_state.last_motion_ms = now;

        if (s_state.mode == LAMP_MODE_AUTO_PIR && !s_state.power) {
            lamp_manager_set_power(true);
        }
    } else {
        // Motion cleared — auto-off akan dihandle di check_auto_off
    }

    if (s_state_change_cb) s_state_change_cb(&s_state);
}

// Dipanggil periodik dari main loop untuk check auto-off
void lamp_manager_check_auto_off(void) {
    if (s_state.mode != LAMP_MODE_AUTO_PIR) return;
    if (!s_state.power) return;
    if (s_state.pir_motion) return;

    uint32_t now     = xTaskGetTickCount() * portTICK_PERIOD_MS;
    uint32_t elapsed = now - s_state.last_motion_ms;

    if (elapsed >= s_state.pir_timeout_ms) {
        LOG_I(TAG, "Auto-OFF after %lu ms without motion",
              (unsigned long)elapsed);
        lamp_manager_set_power(false);
    }
}

void lamp_manager_set_state_callback(void (*cb)(const lamp_state_t*)) {
    s_state_change_cb = cb;
}

void lamp_manager_load_nvs(void) {
    nvs_handle_t nvs;
    if (nvs_open(NVS_NS_LAMP, NVS_READONLY, &nvs) != ESP_OK) return;

    uint8_t  val8;
    uint32_t val32;
    if (nvs_get_u8 (nvs, "power",   &val8)  == ESP_OK) s_state.power          = (bool)val8;
    if (nvs_get_u8 (nvs, "mode",    &val8)  == ESP_OK) s_state.mode           = (lamp_mode_t)val8;
    if (nvs_get_u32(nvs, "timeout", &val32) == ESP_OK) s_state.pir_timeout_ms = val32;

    nvs_close(nvs);
    LOG_D(TAG, "Lamp state loaded from NVS");
}

void lamp_manager_save_nvs(void) {
    nvs_handle_t nvs;
    if (nvs_open(NVS_NS_LAMP, NVS_READWRITE, &nvs) != ESP_OK) return;

    nvs_set_u8 (nvs, "power",   (uint8_t)s_state.power);
    nvs_set_u8 (nvs, "mode",    (uint8_t)s_state.mode);
    nvs_set_u32(nvs, "timeout", s_state.pir_timeout_ms);
    nvs_commit(nvs);
    nvs_close(nvs);
}
