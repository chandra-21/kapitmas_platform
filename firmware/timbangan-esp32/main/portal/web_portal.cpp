#include "web_portal.h"
#include "logger.h"

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_wifi.h"
#include "esp_http_server.h"
#include "nvs_flash.h"
#include "nvs.h"
#include "esp_system.h"
#include <string.h>
#include <stdio.h>

// ==================== PRIVATE ====================

static const char* TAG = "Portal";

static device_config_t s_saved_config = {};
static bool            s_config_saved = false;
static httpd_handle_t  s_server       = NULL;

// ==================== HTML HELPERS ====================

static const char* HTML_HEADER =
    "<!DOCTYPE html><html><head>"
    "<meta name='viewport' content='width=device-width,initial-scale=1'>"
    "<meta charset='UTF-8'>"
    "<style>"
    "body{font-family:Arial;background:#f0f2f5;margin:0;padding:0;}"
    "header{background:linear-gradient(135deg,#0077cc,#0099ff);color:white;"
    "padding:20px;text-align:center;font-size:22px;font-weight:bold;}"
    "main{max-width:500px;margin:30px auto;background:white;padding:25px;"
    "border-radius:12px;box-shadow:0 4px 15px rgba(0,0,0,0.1);}"
    "h2{margin-top:0;text-align:center;color:#0077cc;}"
    "label{display:block;margin-top:15px;font-weight:600;}"
    "input,select{width:100%;padding:12px;margin-top:5px;border:1px solid #ddd;"
    "border-radius:6px;box-sizing:border-box;}"
    "button{background:linear-gradient(135deg,#0077cc,#0099ff);color:white;"
    "border:none;border-radius:6px;padding:14px;margin-top:20px;width:100%;"
    "font-size:16px;font-weight:600;cursor:pointer;}"
    ".info{background:#e7f3ff;padding:12px;border-left:4px solid #0077cc;"
    "margin:15px 0;border-radius:4px;}"
    "footer{text-align:center;margin-top:40px;padding:20px;color:#999;"
    "font-size:13px;}"
    "</style></head><body>"
    "<header>KAPITMAS IoT PLATFORM</header><main>";

// ==================== URL DECODE ====================

static void url_decode(char* dst, const char* src, size_t max_len) {
    size_t i = 0, j = 0;
    while (src[i] && j < max_len - 1) {
        if (src[i] == '%' && src[i+1] && src[i+2]) {
            char hex[3] = {src[i+1], src[i+2], 0};
            dst[j++] = (char)strtol(hex, NULL, 16);
            i += 3;
        } else if (src[i] == '+') {
            dst[j++] = ' ';
            i++;
        } else {
            dst[j++] = src[i++];
        }
    }
    dst[j] = '\0';
}

static bool parse_form_field(const char* body, const char* key,
                              char* out, size_t max_len) {
    char search[64];
    snprintf(search, sizeof(search), "%s=", key);

    const char* pos = strstr(body, search);
    if (!pos) return false;

    pos += strlen(search);
    const char* end = strchr(pos, '&');
    size_t len = end ? (size_t)(end - pos) : strlen(pos);
    if (len >= max_len) len = max_len - 1;

    char encoded[128] = {0};
    strncpy(encoded, pos, len);
    url_decode(out, encoded, max_len);
    return true;
}

// ==================== HTTP HANDLERS ====================

static esp_err_t handler_root(httpd_req_t* req) {
    char html[4096];
    snprintf(html, sizeof(html),
        "%s"
        "<h2>Konfigurasi Timbangan</h2>"
        "<div class='info'><strong>Firmware:</strong> %s</div>"
        "<form method='POST' action='/save'>"
        "<label>Nama Perangkat</label>"
        "<select name='name'>"
        "<option>Timbangan IoT1</option>"
        "<option>Timbangan IoT2</option>"
        "<option>Timbangan IoT3</option>"
        "<option>Timbangan IoT4</option>"
        "<option>Timbangan IoT5</option>"
        "<option>Timbangan IoT6</option>"
        "<option>Timbangan IoT7</option>"
        "<option>Timbangan IoT8</option>"
        "<option>Timbangan IoT9</option>"
        "<option>Timbangan IoT10</option>"
        "</select>"
        "<label>SSID WiFi</label>"
        "<input name='ssid' required placeholder='Nama WiFi'>"
        "<label>Password WiFi</label>"
        "<input type='password' name='pass' required placeholder='Password'>"
        "<label>MQTT Server</label>"
        "<input name='mqtt' required placeholder='192.168.1.100'>"
        "<button type='submit'>Simpan dan Restart</button>"
        "</form>"
        "</main><footer>&copy; 2025 PT. Kapitmas</footer></body></html>",
        HTML_HEADER, FIRMWARE_VERSION);

    httpd_resp_set_type(req, "text/html");
    httpd_resp_send(req, html, strlen(html));
    return ESP_OK;
}

static esp_err_t handler_save(httpd_req_t* req) {
    char body[512] = {0};
    int  ret       = httpd_req_recv(req, body, sizeof(body) - 1);

    if (ret <= 0) {
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Bad request");
        return ESP_FAIL;
    }

    device_config_t cfg = {};
    bool ok = true;

    ok &= parse_form_field(body, "name", cfg.device_name, sizeof(cfg.device_name));
    ok &= parse_form_field(body, "ssid", cfg.ssid,        sizeof(cfg.ssid));
    ok &= parse_form_field(body, "pass", cfg.password,    sizeof(cfg.password));
    ok &= parse_form_field(body, "mqtt", cfg.mqtt_host,   sizeof(cfg.mqtt_host));

    if (!ok) {
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Missing fields");
        return ESP_FAIL;
    }

    // Simpan ke NVS
    nvs_handle_t nvs;
    if (nvs_open(NVS_NAMESPACE, NVS_READWRITE, &nvs) == ESP_OK) {
        nvs_set_str(nvs, NVS_KEY_SSID,        cfg.ssid);
        nvs_set_str(nvs, NVS_KEY_PASS,        cfg.password);
        nvs_set_str(nvs, NVS_KEY_DEVICE_NAME, cfg.device_name);
        nvs_set_str(nvs, NVS_KEY_MQTT_HOST,   cfg.mqtt_host);
        nvs_commit(nvs);
        nvs_close(nvs);
    }

    memcpy(&s_saved_config, &cfg, sizeof(cfg));
    s_config_saved = true;

    const char* html =
        "<!DOCTYPE html><html><body>"
        "<h2>Tersimpan! Restart dalam 3 detik...</h2>"
        "</body></html>";

    httpd_resp_set_type(req, "text/html");
    httpd_resp_send(req, html, strlen(html));

    LOG_I(TAG, "Config saved - restarting...");
    vTaskDelay(pdMS_TO_TICKS(3000));
    esp_restart();

    return ESP_OK;
}

// ==================== PUBLIC API ====================

void web_portal_start(void) {
    LOG_I(TAG, "Starting config portal...");

    // Setup AP
    esp_netif_t* ap_netif = esp_netif_get_handle_from_ifkey("WIFI_AP_DEF");
    if (ap_netif == NULL) {
        esp_netif_create_default_wifi_ap();
    }

    wifi_config_t ap_cfg = {};
    strncpy((char*)ap_cfg.ap.ssid,     PORTAL_SSID,     sizeof(ap_cfg.ap.ssid));
    strncpy((char*)ap_cfg.ap.password, PORTAL_PASSWORD, sizeof(ap_cfg.ap.password));
    ap_cfg.ap.ssid_len       = strlen(PORTAL_SSID);
    ap_cfg.ap.authmode       = WIFI_AUTH_WPA2_PSK;
    ap_cfg.ap.max_connection = 4;
    ap_cfg.ap.channel        = 6;

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_AP));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_AP, &ap_cfg));
    ESP_ERROR_CHECK(esp_wifi_start());

    LOG_I(TAG, "AP started - SSID: %s | IP: %s", PORTAL_SSID, PORTAL_IP);

    // Start HTTP server
    httpd_config_t http_cfg = HTTPD_DEFAULT_CONFIG();
    http_cfg.server_port    = 80;

    if (httpd_start(&s_server, &http_cfg) != ESP_OK) {
        LOG_E(TAG, "Failed to start HTTP server");
        return;
    }

    httpd_uri_t uri_root = {
        .uri     = "/",
        .method  = HTTP_GET,
        .handler = handler_root,
        .user_ctx = NULL
    };

    httpd_uri_t uri_save = {
        .uri     = "/save",
        .method  = HTTP_POST,
        .handler = handler_save,
        .user_ctx = NULL
    };

    httpd_register_uri_handler(s_server, &uri_root);
    httpd_register_uri_handler(s_server, &uri_save);

    LOG_I(TAG, "Portal ready - connect to WiFi '%s' lalu buka 192.168.4.1",
          PORTAL_SSID);

    // Portal timeout — restart setelah 5 menit
    uint32_t start = xTaskGetTickCount() * portTICK_PERIOD_MS;
    while (!s_config_saved) {
        uint32_t elapsed = (xTaskGetTickCount() * portTICK_PERIOD_MS) - start;
        if (elapsed >= PORTAL_TIMEOUT_MS) {
            LOG_W(TAG, "Portal timeout - restarting...");
            esp_restart();
        }
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}

bool web_portal_get_config(device_config_t* config) {
    if (!s_config_saved) return false;
    memcpy(config, &s_saved_config, sizeof(device_config_t));
    return true;
}