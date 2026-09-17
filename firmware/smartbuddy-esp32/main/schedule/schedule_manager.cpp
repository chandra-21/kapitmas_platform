#include "schedule_manager.h"
#include "logger.h"
#include "app_config.h"

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "nvs_flash.h"
#include "nvs.h"
#include "cJSON.h"
#include <string.h>
#include <time.h>

static const char* TAG = "Schedule";

static schedule_config_t s_config = {};
static void (*s_ac_cb)(const ac_state_t*)  = NULL;
static void (*s_lamp_cb)(bool power)       = NULL;

// Track last-executed minute per entry (hindari eksekusi ganda dalam 1 menit)
static int s_last_exec_min[SCHEDULE_MAX_ENTRIES];

void schedule_manager_init(void) {
    memset(&s_config, 0, sizeof(s_config));
    memset(s_last_exec_min, -1, sizeof(s_last_exec_min));

    // Load dari NVS
    nvs_handle_t nvs;
    if (nvs_open(NVS_NS_SCHEDULE, NVS_READONLY, &nvs) == ESP_OK) {
        char buf[1024] = {};
        size_t len = sizeof(buf);
        if (nvs_get_str(nvs, "config", buf, &len) == ESP_OK && len > 2) {
            schedule_manager_set_from_json(buf);
        }
        nvs_close(nvs);
    }

    LOG_I(TAG, "Schedule manager init — %d entries", s_config.count);
}

void schedule_manager_set_callbacks(
    void (*ac_cb)(const ac_state_t*),
    void (*lamp_cb)(bool power)) {
    s_ac_cb   = ac_cb;
    s_lamp_cb = lamp_cb;
}

bool schedule_manager_set_from_json(const char* json_str) {
    if (!json_str) return false;

    cJSON* root = cJSON_Parse(json_str);
    if (!root) {
        LOG_W(TAG, "Invalid schedule JSON");
        return false;
    }

    memset(&s_config, 0, sizeof(s_config));
    memset(s_last_exec_min, -1, sizeof(s_last_exec_min));

    cJSON* entries = cJSON_GetObjectItem(root, "schedules");
    if (!cJSON_IsArray(entries)) {
        cJSON_Delete(root);
        return false;
    }

    int count = cJSON_GetArraySize(entries);
    if (count > SCHEDULE_MAX_ENTRIES) count = SCHEDULE_MAX_ENTRIES;

    for (int i = 0; i < count; i++) {
        cJSON* e = cJSON_GetArrayItem(entries, i);
        schedule_entry_t* entry = &s_config.entries[i];

        cJSON* enabled = cJSON_GetObjectItem(e, "enabled");
        entry->enabled = cJSON_IsTrue(enabled);

        cJSON* hour = cJSON_GetObjectItem(e, "hour");
        cJSON* min  = cJSON_GetObjectItem(e, "minute");
        if (cJSON_IsNumber(hour)) entry->hour   = (uint8_t)hour->valueint;
        if (cJSON_IsNumber(min))  entry->minute = (uint8_t)min->valueint;

        cJSON* days = cJSON_GetObjectItem(e, "days");
        if (cJSON_IsArray(days)) {
            for (int d = 0; d < 7 && d < cJSON_GetArraySize(days); d++) {
                cJSON* day = cJSON_GetArrayItem(days, d);
                entry->days[d] = cJSON_IsTrue(day);
            }
        }

        cJSON* target = cJSON_GetObjectItem(e, "target");
        if (cJSON_IsString(target))
            strncpy(entry->target, target->valuestring, sizeof(entry->target) - 1);

        cJSON* power = cJSON_GetObjectItem(e, "power");
        entry->action_power = cJSON_IsTrue(power);

        cJSON* temp = cJSON_GetObjectItem(e, "ac_temp");
        cJSON* mode = cJSON_GetObjectItem(e, "ac_mode");
        cJSON* fan  = cJSON_GetObjectItem(e, "ac_fan");
        if (cJSON_IsNumber(temp)) entry->ac_temp = (uint8_t)temp->valueint;
        if (cJSON_IsNumber(mode)) entry->ac_mode = (ac_mode_t)mode->valueint;
        if (cJSON_IsNumber(fan))  entry->ac_fan  = (ac_fan_t)fan->valueint;

        cJSON* valid = cJSON_GetObjectItem(e, "valid_until");
        if (cJSON_IsNumber(valid)) entry->valid_until = (int64_t)valid->valuedouble;

        s_config.count++;
    }

    cJSON_Delete(root);

    // Simpan ke NVS
    nvs_handle_t nvs;
    if (nvs_open(NVS_NS_SCHEDULE, NVS_READWRITE, &nvs) == ESP_OK) {
        nvs_set_str(nvs, "config", json_str);
        nvs_commit(nvs);
        nvs_close(nvs);
    }

    LOG_I(TAG, "Schedule updated: %d entries", s_config.count);
    return true;
}

void schedule_manager_check(void) {
    if (s_config.count == 0) return;

    struct tm timeinfo;
    time_t now;
    time(&now);
    localtime_r(&now, &timeinfo);

    // Buat "minute of week" sebagai unique ID untuk mencegah double-exec
    int cur_min = timeinfo.tm_wday * 1440 + timeinfo.tm_hour * 60 + timeinfo.tm_min;

    for (int i = 0; i < s_config.count; i++) {
        schedule_entry_t* entry = &s_config.entries[i];

        if (!entry->enabled) continue;

        // Cek expiry
        if (entry->valid_until > 0 && now > entry->valid_until) {
            LOG_D(TAG, "Schedule %d expired", i);
            continue;
        }

        // Cek hari
        int wday = timeinfo.tm_wday; // 0=Sun
        if (!entry->days[wday]) continue;

        // Cek waktu
        if (timeinfo.tm_hour != entry->hour ||
            timeinfo.tm_min  != entry->minute) continue;

        // Cek sudah dieksekusi di menit ini
        if (s_last_exec_min[i] == cur_min) continue;

        // Eksekusi!
        s_last_exec_min[i] = cur_min;
        LOG_I(TAG, "Schedule %d triggered: target=%s power=%d",
              i, entry->target, entry->action_power);

        if (strcmp(entry->target, "ac") == 0 && s_ac_cb) {
            ac_state_t cmd = {};
            cmd.power   = entry->action_power;
            cmd.mode    = entry->ac_mode;
            cmd.temp    = entry->ac_temp > 0 ? entry->ac_temp : 25;
            cmd.fan     = entry->ac_fan;
            cmd.swing_v = false;
            s_ac_cb(&cmd);
        } else if (strcmp(entry->target, "lamp") == 0 && s_lamp_cb) {
            s_lamp_cb(entry->action_power);
        }
    }
}

const schedule_config_t* schedule_manager_get_config(void) {
    return &s_config;
}
