cmake_minimum_required(VERSION 3.16)

# Target di-set lewat sdkconfig.defaults (CONFIG_IDF_TARGET="esp32c3").
#
# CATATAN PENTING: `set(IDF_TARGET esp32c3)` di sini TIDAK bisa diandalkan.
# Di tools/cmake/targets.cmake, __target_init() membaca $ENV{IDF_TARGET} lebih dulu
# dan baru melirik variabel CMake / sdkconfig.defaults kalau env var kosong. Kalau
# shell masih membawa IDF_TARGET=esp32 (mis. dari project timbangan-esp32 atau
# extension VS Code), build akan diam-diam menghasilkan binary Xtensa tanpa error.
#
# Guard di bawah membuat kasus itu gagal keras, bukan lolos diam-diam.
include($ENV{IDF_PATH}/tools/cmake/project.cmake)

if(NOT IDF_TARGET STREQUAL "esp32c3")
    message(FATAL_ERROR
        "Project ini khusus ESP32-C3, tapi IDF_TARGET='${IDF_TARGET}'.\n"
        "Penyebab paling umum: environment variable IDF_TARGET masih 'esp32'.\n"
        "Perbaikan: hapus sdkconfig dan build/, lalu jalankan:\n"
        "    idf.py set-target esp32c3")
endif()

project(timbangan-esp32c3)
