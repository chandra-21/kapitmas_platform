#include "ac_manager.h"
#include "logger.h"
#include "app_config.h"

#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "nvs_flash.h"
#include "nvs.h"
#include <string.h>

static const char* TAG = "AC";

static ac_state_t   s_state   = {};
static ir_brand_t   s_brand   = IR_BRAND_DAIKIN;
static QueueHandle_t s_ir_q   = NULL;

void ac_manager_init(ir_brand_t brand, QueueHandle_t ir_cmd_queue) {
    s_brand = brand;
    s_ir_q  = ir_cmd_queue;

    // Default state
    s_state.power   = false;
    s_state.mode    = AC_MODE_COOL;
    s_state.temp    = 25;
    s_state.fan     = AC_FAN_AUTO;
    s_state.swing_v = false;

    ac_manager_load_nvs();
    LOG_I(TAG, "AC manager init — brand: %d, power: %d, temp: %d°C",
          brand, s_state.power, s_state.temp);
}

bool ac_manager_apply(const ac_state_t* cmd) {
    if (!cmd || !s_ir_q) return false;

    // Update state
    s_state = *cmd;

    // Kirim ke IR command queue (dieksekusi oleh ir_task di main)
    ir_command_t ir_cmd = {};
    ir_cmd.brand         = s_brand;
    ir_cmd.state         = s_state;
    ir_cmd.is_learn_result = false;

    if (xQueueSend(s_ir_q, &ir_cmd, pdMS_TO_TICKS(1000)) != pdTRUE) {
        LOG_W(TAG, "IR queue full, command dropped");
        return false;
    }

    ac_manager_save_nvs();
    LOG_I(TAG, "AC command queued: power=%d mode=%d temp=%d fan=%d",
          cmd->power, cmd->mode, cmd->temp, cmd->fan);
    return true;
}

ac_state_t ac_manager_get_state(void) {
    return s_state;
}

void ac_manager_load_nvs(void) {
    nvs_handle_t nvs;
    if (nvs_open(NVS_NS_AC, NVS_READONLY, &nvs) != ESP_OK) return;

    uint8_t val;
    if (nvs_get_u8(nvs, "power",   &val) == ESP_OK) s_state.power   = (bool)val;
    if (nvs_get_u8(nvs, "mode",    &val) == ESP_OK) s_state.mode    = (ac_mode_t)val;
    if (nvs_get_u8(nvs, "temp",    &val) == ESP_OK) s_state.temp    = val;
    if (nvs_get_u8(nvs, "fan",     &val) == ESP_OK) s_state.fan     = (ac_fan_t)val;
    if (nvs_get_u8(nvs, "swing_v", &val) == ESP_OK) s_state.swing_v = (bool)val;

    nvs_close(nvs);
    LOG_D(TAG, "AC state loaded from NVS");
}

void ac_manager_save_nvs(void) {
    nvs_handle_t nvs;
    if (nvs_open(NVS_NS_AC, NVS_READWRITE, &nvs) != ESP_OK) return;

    nvs_set_u8(nvs, "power",   (uint8_t)s_state.power);
    nvs_set_u8(nvs, "mode",    (uint8_t)s_state.mode);
    nvs_set_u8(nvs, "temp",    s_state.temp);
    nvs_set_u8(nvs, "fan",     (uint8_t)s_state.fan);
    nvs_set_u8(nvs, "swing_v", (uint8_t)s_state.swing_v);
    nvs_commit(nvs);
    nvs_close(nvs);
}
