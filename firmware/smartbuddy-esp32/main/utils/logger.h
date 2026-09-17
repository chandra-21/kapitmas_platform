#pragma once

#include "esp_log.h"
#include "app_config.h"

#if ENABLE_DEBUG
    #define LOG_I(tag, fmt, ...) ESP_LOGI(tag, fmt, ##__VA_ARGS__)
    #define LOG_W(tag, fmt, ...) ESP_LOGW(tag, fmt, ##__VA_ARGS__)
    #define LOG_E(tag, fmt, ...) ESP_LOGE(tag, fmt, ##__VA_ARGS__)
    #define LOG_D(tag, fmt, ...) ESP_LOGD(tag, fmt, ##__VA_ARGS__)
#else
    #define LOG_I(tag, fmt, ...)
    #define LOG_W(tag, fmt, ...)
    #define LOG_E(tag, fmt, ...)
    #define LOG_D(tag, fmt, ...)
#endif
