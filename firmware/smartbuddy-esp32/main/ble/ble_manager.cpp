#include "ble_manager.h"
#include "logger.h"
#include "app_config.h"

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/event_groups.h"
#include "nvs_flash.h"
#include "nvs.h"
#include "esp_bt.h"
#include "esp_gap_ble_api.h"
#include "esp_gatts_api.h"
#include "esp_bt_main.h"
#include "esp_gatt_common_api.h"
#include "esp_mac.h"
#include "cJSON.h"
#include <string.h>
#include <stdio.h>

static const char* TAG = "BLE";

static ble_state_t     s_state         = BLE_STATE_IDLE;
static bool            s_prov_done     = false;
static device_config_t s_prov_config   = {};
static uint32_t        s_start_time_ms = 0;

extern EventGroupHandle_t g_system_events;

// ==================== GATT ====================

#define APP_ID  0
#define IDX_NB  10

static uint16_t s_gatts_if     = ESP_GATT_IF_NONE;
static uint16_t s_conn_id      = 0;
static bool     s_is_connected = false;
static uint16_t s_handle_table[IDX_NB];

static char s_device_info_val[256] = {0};
static char s_prov_status_val[128] = {0};

static const uint16_t s_primary_service_uuid   = ESP_GATT_UUID_PRI_SERVICE;
static const uint16_t s_char_declare_uuid       = ESP_GATT_UUID_CHAR_DECLARE;
static const uint16_t s_char_client_config_uuid = ESP_GATT_UUID_CHAR_CLIENT_CONFIG;

static const uint8_t s_char_prop_read         = ESP_GATT_CHAR_PROP_BIT_READ;
static const uint8_t s_char_prop_write        = ESP_GATT_CHAR_PROP_BIT_WRITE |
                                                  ESP_GATT_CHAR_PROP_BIT_WRITE_NR;
static const uint8_t s_char_prop_read_notify  = ESP_GATT_CHAR_PROP_BIT_READ |
                                                  ESP_GATT_CHAR_PROP_BIT_NOTIFY;

// UUIDs — same structure as timbangan (different device type string)
static uint8_t s_service_uuid[16] = {
    0x4b, 0x91, 0x31, 0xc3, 0xc9, 0xc5, 0xcc, 0x8f,
    0xe5, 0x59, 0xb5, 0x1f, 0x01, 0xc2, 0xaf, 0x4f
};
static uint8_t s_char_device_info_uuid[16] = {
    0xa8, 0x26, 0x1b, 0x36, 0xf5, 0xb7, 0x88, 0xb7,
    0x68, 0x46, 0xe1, 0x36, 0x3e, 0x48, 0xb5, 0xbe
};
static uint8_t s_char_wifi_config_uuid[16] = {
    0xa9, 0x26, 0x1b, 0x36, 0xf5, 0xb7, 0x88, 0xb7,
    0x68, 0x46, 0xe1, 0x36, 0x3e, 0x48, 0xb5, 0xbe
};
static uint8_t s_char_device_config_uuid[16] = {
    0xaa, 0x26, 0x1b, 0x36, 0xf5, 0xb7, 0x88, 0xb7,
    0x68, 0x46, 0xe1, 0x36, 0x3e, 0x48, 0xb5, 0xbe
};
static uint8_t s_char_prov_status_uuid[16] = {
    0xab, 0x26, 0x1b, 0x36, 0xf5, 0xb7, 0x88, 0xb7,
    0x68, 0x46, 0xe1, 0x36, 0x3e, 0x48, 0xb5, 0xbe
};

typedef enum {
    IDX_SVC = 0,
    IDX_CHAR_DEVICE_INFO,
    IDX_CHAR_DEVICE_INFO_VAL,
    IDX_CHAR_WIFI_CFG,
    IDX_CHAR_WIFI_CFG_VAL,
    IDX_CHAR_DEV_CFG,
    IDX_CHAR_DEV_CFG_VAL,
    IDX_CHAR_PROV_STATUS,
    IDX_CHAR_PROV_STATUS_VAL,
    IDX_CHAR_PROV_STATUS_CCC,
} gatt_idx_t;

static const esp_gatts_attr_db_t s_gatt_db[IDX_NB] = {
    [IDX_SVC] = {
        {ESP_GATT_AUTO_RSP},
        {ESP_UUID_LEN_16, (uint8_t*)&s_primary_service_uuid,
         ESP_GATT_PERM_READ, sizeof(s_service_uuid),
         sizeof(s_service_uuid), s_service_uuid}
    },
    [IDX_CHAR_DEVICE_INFO] = {
        {ESP_GATT_AUTO_RSP},
        {ESP_UUID_LEN_16, (uint8_t*)&s_char_declare_uuid, ESP_GATT_PERM_READ,
         sizeof(uint8_t), sizeof(uint8_t), (uint8_t*)&s_char_prop_read}
    },
    [IDX_CHAR_DEVICE_INFO_VAL] = {
        {ESP_GATT_AUTO_RSP},
        {ESP_UUID_LEN_128, s_char_device_info_uuid, ESP_GATT_PERM_READ,
         sizeof(s_device_info_val), 0, NULL}
    },
    [IDX_CHAR_WIFI_CFG] = {
        {ESP_GATT_AUTO_RSP},
        {ESP_UUID_LEN_16, (uint8_t*)&s_char_declare_uuid, ESP_GATT_PERM_READ,
         sizeof(uint8_t), sizeof(uint8_t), (uint8_t*)&s_char_prop_write}
    },
    [IDX_CHAR_WIFI_CFG_VAL] = {
        {ESP_GATT_AUTO_RSP},
        {ESP_UUID_LEN_128, s_char_wifi_config_uuid, ESP_GATT_PERM_WRITE,
         256, 0, NULL}
    },
    [IDX_CHAR_DEV_CFG] = {
        {ESP_GATT_AUTO_RSP},
        {ESP_UUID_LEN_16, (uint8_t*)&s_char_declare_uuid, ESP_GATT_PERM_READ,
         sizeof(uint8_t), sizeof(uint8_t), (uint8_t*)&s_char_prop_write}
    },
    [IDX_CHAR_DEV_CFG_VAL] = {
        {ESP_GATT_AUTO_RSP},
        {ESP_UUID_LEN_128, s_char_device_config_uuid, ESP_GATT_PERM_WRITE,
         512, 0, NULL}
    },
    [IDX_CHAR_PROV_STATUS] = {
        {ESP_GATT_AUTO_RSP},
        {ESP_UUID_LEN_16, (uint8_t*)&s_char_declare_uuid, ESP_GATT_PERM_READ,
         sizeof(uint8_t), sizeof(uint8_t), (uint8_t*)&s_char_prop_read_notify}
    },
    [IDX_CHAR_PROV_STATUS_VAL] = {
        {ESP_GATT_AUTO_RSP},
        {ESP_UUID_LEN_128, s_char_prov_status_uuid, ESP_GATT_PERM_READ,
         sizeof(s_prov_status_val), 0, NULL}
    },
    [IDX_CHAR_PROV_STATUS_CCC] = {
        {ESP_GATT_AUTO_RSP},
        {ESP_UUID_LEN_16, (uint8_t*)&s_char_client_config_uuid,
         ESP_GATT_PERM_READ | ESP_GATT_PERM_WRITE, sizeof(uint16_t), 0, NULL}
    },
};

static void notify_status(const char* status, const char* ip, const char* error) {
    if (!s_is_connected) return;
    snprintf(s_prov_status_val, sizeof(s_prov_status_val),
             "{\"status\":\"%s\",\"ip\":\"%s\",\"error\":\"%s\"}",
             status, ip ? ip : "", error ? error : "");
    esp_ble_gatts_send_indicate(s_gatts_if, s_conn_id,
        s_handle_table[IDX_CHAR_PROV_STATUS_VAL],
        strlen(s_prov_status_val), (uint8_t*)s_prov_status_val, false);
    LOG_I(TAG, "Notify: %s", s_prov_status_val);
}

static void start_advertising(void) {
    uint8_t mac[6];
    esp_read_mac(mac, ESP_MAC_BT);

    char adv_name[48];
    snprintf(adv_name, sizeof(adv_name), "%s-%02X%02X%02X",
             BLE_DEVICE_NAME_PREFIX, mac[3], mac[4], mac[5]);

    esp_ble_gap_set_device_name(adv_name);
    LOG_I(TAG, "Advertising as: %s", adv_name);

    esp_ble_adv_data_t adv_data = {};
    adv_data.include_name    = true;
    adv_data.include_txpower = true;
    adv_data.flag = (ESP_BLE_ADV_FLAG_GEN_DISC | ESP_BLE_ADV_FLAG_BREDR_NOT_SPT);

    esp_ble_adv_params_t adv_params = {};
    adv_params.adv_int_min       = 0x20;
    adv_params.adv_int_max       = 0x40;
    adv_params.adv_type          = ADV_TYPE_IND;
    adv_params.own_addr_type     = BLE_ADDR_TYPE_PUBLIC;
    adv_params.channel_map       = ADV_CHNL_ALL;
    adv_params.adv_filter_policy = ADV_FILTER_ALLOW_SCAN_ANY_CON_ANY;

    esp_ble_gap_config_adv_data(&adv_data);
    esp_ble_gap_start_advertising(&adv_params);
}

static void save_config_to_nvs(void) {
    nvs_handle_t nvs;
    if (nvs_open(NVS_NAMESPACE, NVS_READWRITE, &nvs) != ESP_OK) return;

    nvs_set_str(nvs, NVS_KEY_SSID,        s_prov_config.ssid);
    nvs_set_str(nvs, NVS_KEY_PASS,        s_prov_config.password);
    nvs_set_str(nvs, NVS_KEY_DEVICE_NAME, s_prov_config.device_name);
    nvs_set_str(nvs, NVS_KEY_ROOM_ID,     s_prov_config.room_id);
    nvs_set_str(nvs, NVS_KEY_MQTT_HOST,   s_prov_config.mqtt_host);
    nvs_set_str(nvs, NVS_KEY_BACKEND_HOST, s_prov_config.backend_host);
    int32_t port = s_prov_config.backend_port > 0 ? s_prov_config.backend_port : 8000;
    nvs_set_i32(nvs, NVS_KEY_BACKEND_PORT, port);
    nvs_set_u8 (nvs, NVS_KEY_HAS_AC,     (uint8_t)s_prov_config.has_ac);
    nvs_set_u8 (nvs, NVS_KEY_HAS_LAMP,   (uint8_t)s_prov_config.has_lamp);
    nvs_set_str(nvs, NVS_KEY_AC_BRAND,   s_prov_config.ac_brand);
    nvs_set_u8 (nvs, NVS_KEY_PROVISIONED, 1);
    nvs_commit(nvs);
    nvs_close(nvs);
    LOG_I(TAG, "Config saved to NVS");
}

static void handle_write(uint16_t handle, uint8_t* data, uint16_t len) {
    char buf[512] = {0};
    if (len >= sizeof(buf)) len = sizeof(buf) - 1;
    memcpy(buf, data, len);

    if (handle == s_handle_table[IDX_CHAR_WIFI_CFG_VAL]) {
        LOG_I(TAG, "WiFi config: %s", buf);
        cJSON* json = cJSON_Parse(buf);
        if (json) {
            cJSON* ssid = cJSON_GetObjectItem(json, "ssid");
            cJSON* pass = cJSON_GetObjectItem(json, "password");
            if (ssid && cJSON_IsString(ssid))
                strncpy(s_prov_config.ssid, ssid->valuestring,
                        sizeof(s_prov_config.ssid) - 1);
            if (pass && cJSON_IsString(pass))
                strncpy(s_prov_config.password, pass->valuestring,
                        sizeof(s_prov_config.password) - 1);
            cJSON_Delete(json);
        }
    } else if (handle == s_handle_table[IDX_CHAR_DEV_CFG_VAL]) {
        // SmartBuddy extended device config
        // {name, room_id, mqtt_host, backend_host, backend_port,
        //  has_ac, has_lamp, ac_brand}
        LOG_I(TAG, "Device config: %s", buf);
        cJSON* json = cJSON_Parse(buf);
        if (json) {
            cJSON* name    = cJSON_GetObjectItem(json, "name");
            cJSON* room    = cJSON_GetObjectItem(json, "room_id");
            cJSON* mqtt    = cJSON_GetObjectItem(json, "mqtt_host");
            cJSON* backend = cJSON_GetObjectItem(json, "backend_host");
            cJSON* bport   = cJSON_GetObjectItem(json, "backend_port");
            cJSON* has_ac  = cJSON_GetObjectItem(json, "has_ac");
            cJSON* has_lmp = cJSON_GetObjectItem(json, "has_lamp");
            cJSON* brand   = cJSON_GetObjectItem(json, "ac_brand");

            if (name    && cJSON_IsString(name))
                strncpy(s_prov_config.device_name, name->valuestring,
                        sizeof(s_prov_config.device_name) - 1);
            if (room    && cJSON_IsString(room))
                strncpy(s_prov_config.room_id, room->valuestring,
                        sizeof(s_prov_config.room_id) - 1);
            if (mqtt    && cJSON_IsString(mqtt))
                strncpy(s_prov_config.mqtt_host, mqtt->valuestring,
                        sizeof(s_prov_config.mqtt_host) - 1);
            if (backend && cJSON_IsString(backend))
                strncpy(s_prov_config.backend_host, backend->valuestring,
                        sizeof(s_prov_config.backend_host) - 1);
            if (bport   && cJSON_IsNumber(bport))
                s_prov_config.backend_port = (int)bport->valuedouble;
            if (has_ac)
                s_prov_config.has_ac  = cJSON_IsTrue(has_ac);
            if (has_lmp)
                s_prov_config.has_lamp = cJSON_IsTrue(has_lmp);
            if (brand   && cJSON_IsString(brand))
                strncpy(s_prov_config.ac_brand, brand->valuestring,
                        sizeof(s_prov_config.ac_brand) - 1);
            else
                strncpy(s_prov_config.ac_brand, "daikin",
                        sizeof(s_prov_config.ac_brand) - 1);

            cJSON_Delete(json);

            // Simpan jika WiFi dan device name sudah ada
            if (strlen(s_prov_config.ssid) > 0 &&
                strlen(s_prov_config.device_name) > 0) {
                save_config_to_nvs();
                s_prov_done = true;
                s_state     = BLE_STATE_DONE;
                xEventGroupSetBits(g_system_events, SYS_EVENT_BLE_PROVISIONING);
                notify_status("connecting", "", "");
            }
        }
    }
}

static void gap_event_handler(esp_gap_ble_cb_event_t event,
                               esp_ble_gap_cb_param_t* param) {
    switch (event) {
        case ESP_GAP_BLE_ADV_DATA_SET_COMPLETE_EVT:
            esp_ble_gap_start_advertising(NULL);
            break;
        case ESP_GAP_BLE_ADV_START_COMPLETE_EVT:
            if (param->adv_start_cmpl.status == ESP_BT_STATUS_SUCCESS) {
                LOG_I(TAG, "Advertising started");
                s_state = BLE_STATE_ADVERTISING;
            }
            break;
        default: break;
    }
}

static void gatts_event_handler(esp_gatts_cb_event_t event,
                                  esp_gatt_if_t gatts_if,
                                  esp_ble_gatts_cb_param_t* param) {
    switch (event) {
        case ESP_GATTS_REG_EVT:
            s_gatts_if = gatts_if;
            esp_ble_gatts_create_attr_tab(s_gatt_db, gatts_if, IDX_NB, 0);
            break;

        case ESP_GATTS_CREAT_ATTR_TAB_EVT:
            if (param->add_attr_tab.status == ESP_GATT_OK &&
                param->add_attr_tab.num_handle == IDX_NB) {
                memcpy(s_handle_table, param->add_attr_tab.handles,
                       sizeof(s_handle_table));
                esp_ble_gatts_start_service(s_handle_table[IDX_SVC]);
            }
            break;

        case ESP_GATTS_START_EVT: {
            uint8_t mac[6];
            esp_read_mac(mac, ESP_MAC_WIFI_STA);
            char mac_str[18];
            snprintf(mac_str, sizeof(mac_str),
                     "%02X:%02X:%02X:%02X:%02X:%02X",
                     mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
            snprintf(s_device_info_val, sizeof(s_device_info_val),
                "{\"mac\":\"%s\",\"type\":\"%s\","
                "\"firmware\":\"%s\",\"chip\":\"ESP32\"}",
                mac_str, DEVICE_TYPE, FIRMWARE_VERSION);
            esp_ble_gatts_set_attr_value(
                s_handle_table[IDX_CHAR_DEVICE_INFO_VAL],
                strlen(s_device_info_val),
                (uint8_t*)s_device_info_val);
            start_advertising();
            break;
        }

        case ESP_GATTS_CONNECT_EVT:
            s_conn_id      = param->connect.conn_id;
            s_is_connected = true;
            s_state        = BLE_STATE_CONNECTED;
            LOG_I(TAG, "Client connected");
            esp_ble_gap_stop_advertising();
            break;

        case ESP_GATTS_DISCONNECT_EVT:
            s_is_connected = false;
            LOG_I(TAG, "Client disconnected");
            if (!s_prov_done) {
                start_advertising();
                s_state = BLE_STATE_ADVERTISING;
            }
            break;

        case ESP_GATTS_WRITE_EVT:
            if (!param->write.is_prep) {
                handle_write(param->write.handle,
                             param->write.value, param->write.len);
                if (param->write.need_rsp) {
                    esp_ble_gatts_send_response(gatts_if,
                        param->write.conn_id, param->write.trans_id,
                        ESP_GATT_OK, NULL);
                }
            }
            break;

        case ESP_GATTS_MTU_EVT:
            LOG_I(TAG, "MTU: %d", param->mtu.mtu);
            break;

        default: break;
    }
}

void ble_manager_init(void) {
    ESP_ERROR_CHECK(esp_bt_controller_mem_release(ESP_BT_MODE_CLASSIC_BT));
    esp_bt_controller_config_t bt_cfg = BT_CONTROLLER_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_bt_controller_init(&bt_cfg));
    ESP_ERROR_CHECK(esp_bt_controller_enable(ESP_BT_MODE_BLE));
    ESP_ERROR_CHECK(esp_bluedroid_init());
    ESP_ERROR_CHECK(esp_bluedroid_enable());
    ESP_ERROR_CHECK(esp_ble_gap_register_callback(gap_event_handler));
    ESP_ERROR_CHECK(esp_ble_gatts_register_callback(gatts_event_handler));
    ESP_ERROR_CHECK(esp_ble_gatts_app_register(APP_ID));
    ESP_ERROR_CHECK(esp_ble_gatt_set_local_mtu(512));
    LOG_I(TAG, "BLE initialized");
}

void ble_manager_start_provisioning(void) {
    if (s_state == BLE_STATE_ADVERTISING || s_state == BLE_STATE_CONNECTED) return;
    s_prov_done     = false;
    s_start_time_ms = xTaskGetTickCount() * portTICK_PERIOD_MS;
    memset(&s_prov_config, 0, sizeof(s_prov_config));
    xEventGroupSetBits(g_system_events, SYS_EVENT_BLE_PROVISIONING);
    start_advertising();
    LOG_I(TAG, "BLE provisioning started");
}

void ble_manager_shutdown(void) {
    esp_ble_gap_stop_advertising();
    esp_bluedroid_disable();
    esp_bluedroid_deinit();
    esp_bt_controller_disable();
    esp_bt_controller_deinit();
    esp_bt_controller_mem_release(ESP_BT_MODE_BLE);
    s_state = BLE_STATE_IDLE;
    LOG_I(TAG, "BLE shutdown");
}

void ble_manager_stop(void) {
    esp_ble_gap_stop_advertising();
    s_state = BLE_STATE_IDLE;
    xEventGroupClearBits(g_system_events, SYS_EVENT_BLE_PROVISIONING);
}

void ble_manager_notify_connected(const char* ip)  { notify_status("connected", ip, ""); }
void ble_manager_notify_registered(void)           { notify_status("registered", "", ""); }
void ble_manager_notify_failed(const char* error)  { notify_status("failed", "", error); }

ble_state_t ble_manager_get_state(void)           { return s_state; }
bool        ble_manager_is_provisioning_done(void) { return s_prov_done; }

bool ble_manager_is_timeout(void) {
    if (s_state == BLE_STATE_IDLE || s_prov_done) return false;
    uint32_t elapsed = (xTaskGetTickCount() * portTICK_PERIOD_MS) - s_start_time_ms;
    return elapsed >= BLE_PROV_TIMEOUT_MS;
}

void ble_manager_get_config(device_config_t* cfg) {
    memcpy(cfg, &s_prov_config, sizeof(device_config_t));
}
