cmake_minimum_required(VERSION 3.28)

project(ZorkVoiceBocfelWorkerSpike LANGUAGES C CXX)

set(CMAKE_INTERPROCEDURAL_OPTIMIZATION TRUE)

foreach(required_variable
        ZV_BOCFEL_SOURCE_DIR
        ZV_REMGLK_SOURCE_DIR
        ZV_EMGLKEN_GLUE_DIR
        ZV_REMGLK_LIBRARY)
    if(NOT DEFINED ${required_variable})
        message(FATAL_ERROR "${required_variable} must be an explicit absolute path")
    endif()
    if(NOT IS_ABSOLUTE "${${required_variable}}")
        message(FATAL_ERROR "${required_variable} must be absolute")
    endif()
endforeach()

if(EXISTS "${ZV_BOCFEL_SOURCE_DIR}/static-patches.h")
    message(FATAL_ERROR "Garglk static-patches.h is forbidden in this spike")
endif()

set(BOCFEL_SOURCES
    blorb.cpp
    branch.cpp
    dict.cpp
    glkautosave.cpp
    glkstart.cpp
    iff.cpp
    io.cpp
    mathop.cpp
    meta.cpp
    memory.cpp
    objects.cpp
    options.cpp
    osdep.cpp
    patches.cpp
    process.cpp
    random.cpp
    screen.cpp
    sound.cpp
    stack.cpp
    stash.cpp
    unicode.cpp
    util.cpp
    zterp.cpp)

list(TRANSFORM BOCFEL_SOURCES PREPEND "${ZV_BOCFEL_SOURCE_DIR}/")

add_executable(bocfel-noz6 ${BOCFEL_SOURCES})
set_property(TARGET bocfel-noz6 PROPERTY CXX_STANDARD 14)
set_property(TARGET bocfel-noz6 PROPERTY CXX_STANDARD_REQUIRED ON)
target_include_directories(
    bocfel-noz6
    PRIVATE
        "${ZV_BOCFEL_SOURCE_DIR}"
        "${ZV_REMGLK_SOURCE_DIR}/remglk_capi/src/glk")
target_compile_definitions(
    bocfel-noz6
    PRIVATE
        ZTERP_GLK
        ZTERP_GLK_BLORB
        ZTERP_GLK_NO_STDIO
        ZTERP_GLK_UNIX
        ZTERP_NO_OPTIONS
        ZTERP_NO_V6)
target_compile_options(bocfel-noz6 PRIVATE -Wall -fexceptions)
target_link_libraries(bocfel-noz6 PRIVATE "${ZV_REMGLK_LIBRARY}")

em_link_js_library(
    bocfel-noz6
    "${ZV_REMGLK_SOURCE_DIR}/remglk_capi/src/systems/library_emglken.js")
em_link_pre_js(bocfel-noz6 "${ZV_EMGLKEN_GLUE_DIR}/src/preamble.js")

target_link_options(
    bocfel-noz6
    PRIVATE
        -sALLOW_MEMORY_GROWTH=1
        -sALLOW_UNIMPLEMENTED_SYSCALLS
        -sASYNCIFY=1
        -sASYNCIFY_STACK_SIZE=8192
        -sEXIT_RUNTIME=1
        -sEXPORTED_FUNCTIONS=_main,_setThrew
        -sFILESYSTEM=0
        -sINCOMING_MODULE_JS_API=[locateFile,wasmBinary]
        -sINVOKE_RUN=0
        -sSTRICT=1
        --minify
        0
        --profiling-funcs
        -sENVIRONMENT=node,web,worker
        -sEXPORT_ES6=1
        -sMODULARIZE=1
        -sTEXTDECODER=2
        -sNO_DISABLE_EXCEPTION_CATCHING
        "-sASYNCIFY_REMOVE=@${ZV_EMGLKEN_GLUE_DIR}/src/asyncify-remove-list-bocfel-noz6.txt")
