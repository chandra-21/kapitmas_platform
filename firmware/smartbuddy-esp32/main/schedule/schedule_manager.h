#pragma once

#include "app_types.h"
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

// Inisialisasi — load dari NVS
void schedule_manager_init(void);

// Set schedule dari backend (JSON string)
bool schedule_manager_set_from_json(const char* json_str);

// Cek dan eksekusi jadwal yang jatuh tempo
// Dipanggil dari task periodik, butuh NTP sudah sync
void schedule_manager_check(void);

// Callback untuk eksekusi AC/lamp command dari schedule
void schedule_manager_set_callbacks(
    void (*ac_cb)(const ac_state_t*),
    void (*lamp_cb)(bool power)
);

const schedule_config_t* schedule_manager_get_config(void);

#ifdef __cplusplus
}
#endif
