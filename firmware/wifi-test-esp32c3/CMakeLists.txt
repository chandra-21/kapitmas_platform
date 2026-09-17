cmake_minimum_required(VERSION 3.16)

include($ENV{IDF_PATH}/tools/cmake/project.cmake)

# Guard: env var IDF_TARGET menang atas sdkconfig.defaults, jadi salah target
# harus gagal keras — bukan diam-diam menghasilkan binary Xtensa.
if(NOT IDF_TARGET STREQUAL "esp32c3")
    message(FATAL_ERROR
        "Project ini khusus ESP32-C3, tapi IDF_TARGET='${IDF_TARGET}'.\n"
        "Jalankan: idf.py set-target esp32c3")
endif()

project(wifi-test-esp32c3)
